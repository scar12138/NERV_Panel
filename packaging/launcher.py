# -*- coding: utf-8 -*-
"""
NERV Panel —— Windows 桌面托盘启动器（PyInstaller onefile 打包入口）

功能：
  - 双击 exe 即自动启动 5000 端口服务（后台常驻、无黑窗），并保证托盘图标必定出现
  - 任务栏托盘图标：
      · 左键单击 → 打开设置界面
      · 右键菜单 → 打开设置 / 打开面板 / 查看本机局域网 IP / 复制局域网与本机地址 /
                   开机自启开关 / 退出
  - 设置界面（tkinter）：Token、端口、开机自启等直接改，保存即生效，不用翻 config.json；
    端口等需重启的改动会自动重启服务
  - 服务崩溃自动重启（替代原 start.bat 的守护逻辑）
  - 首次运行自动尝试放行防火墙（保证平板可通过局域网 IP 访问）
  - 单实例：重复双击/开机自启重复拉起一律直接退出
  - 开机自启：在 Run 注册表写入自启命令，登录后后台静默启动，不弹网页、不弹黑窗
  - 打包模式下：服务端代码、前端页面、node.exe、npm 依赖全部从 exe 内自解压运行；
    用户数据（config.json / logs / data / cache）持久化到 %LOCALAPPDATA%\\NERV_Panel
"""

import ctypes
import json
import logging
import os
import socket
import subprocess
import sys
import threading
import time
import webbrowser
import winreg
from pathlib import Path

import pystray

APP_NAME = "NERV Panel"
MUTEX_NAME = "NERV_Panel_Desktop_Launcher_Mutex"
REG_RUN_VALUE = "NERV Panel"
DEFAULT_PORT = 5000
READY_TIMEOUT = 60  # 秒

_log = logging.getLogger("nerv.launcher")


# ---------------------------------------------------------------- 路径逻辑
def is_frozen():
    return getattr(sys, "frozen", False)


def app_dir():
    """服务端代码所在目录（冻结时是 PyInstaller 自解压出的 bundle 子目录）"""
    if is_frozen():
        return Path(sys._MEIPASS) / "bundle"
    return Path(__file__).resolve().parent.parent


def data_dir():
    """持久化数据目录（config.json / logs / data / cache）"""
    if is_frozen():
        base = os.environ.get("LOCALAPPDATA") or str(Path.home())
        d = Path(base) / "NERV_Panel"
    else:
        d = Path(__file__).resolve().parent.parent  # 开发模式：直接用项目根目录
    try:
        d.mkdir(parents=True, exist_ok=True)
    except Exception:
        pass
    return d


def log_path():
    return data_dir() / "launcher.log"


def node_exe():
    return app_dir() / "node.exe"


def server_entry():
    return app_dir() / "server" / "index.js"


def public_dir():
    return app_dir() / "public"


def get_port():
    cfg = data_dir() / "config.json"
    try:
        with open(cfg, "r", encoding="utf-8") as f:
            return int(json.load(f).get("port") or DEFAULT_PORT)
    except Exception:
        return DEFAULT_PORT


def server_status_ok(port, timeout=2.0):
    import urllib.request

    url = "http://127.0.0.1:%d/api/status" % port
    try:
        with urllib.request.urlopen(url, timeout=timeout) as r:
            if r.status == 200:
                j = json.loads(r.read().decode("utf-8"))
                return bool(j.get("ok"))
    except Exception:
        pass
    return False


# ---------------------------------------------------------------- 单实例
def acquire_single_instance():
    """返回 True 表示当前进程取得唯一实例；False 表示已有实例在跑。"""
    kernel32 = ctypes.windll.kernel32
    handle = kernel32.CreateMutexW(None, False, MUTEX_NAME)
    return kernel32.GetLastError() != 183  # ERROR_ALREADY_EXISTS


# ---------------------------------------------------------------- 托盘菜单动作
def open_panel(icon=None, item=None):
    port = get_port()
    try:
        webbrowser.open("http://127.0.0.1:%d" % port)
    except Exception:
        _log.exception("打开浏览器失败")


def clipboard_set(text):
    """用 ctypes 写入剪贴板（CF_UNICODETEXT），不依赖 pyperclip。"""
    if not text:
        return
    text = str(text)
    user32 = ctypes.windll.user32
    kernel32 = ctypes.windll.kernel32
    user32.OpenClipboard(0)
    try:
        user32.EmptyClipboard()
        data = text.encode("utf-16-le") + b"\x00\x00"
        h = kernel32.GlobalAlloc(0x0042, len(data))  # GMEM_MOVEABLE | GMEM_ZEROINIT
        if h:
            ptr = kernel32.GlobalLock(h)
            ctypes.memmove(ptr, data, len(data))
            kernel32.GlobalUnlock(h)
            user32.SetClipboardData(13, h)  # CF_UNICODETEXT
    finally:
        user32.CloseClipboard()


def copy_local(icon=None, item=None):
    clipboard_set("http://127.0.0.1:%d" % get_port())
    notify(icon, "已复制本机地址", "http://127.0.0.1:%d" % get_port())


def copy_lan(icon=None, item=None, ip=None):
    clipboard_set("http://%s:%d" % (ip or lan_ip(), get_port()))
    notify(icon, "已复制局域网地址", "http://%s:%d" % (ip or lan_ip(), get_port()))


def lan_ip():
    """取服务端 /api/status 给的主局域网 IP（与服务端 lanIPv4 同一套打分逻辑）"""
    port = get_port()
    import urllib.request

    try:
        with urllib.request.urlopen("http://127.0.0.1:%d/api/status" % port, timeout=3) as r:
            j = json.loads(r.read().decode("utf-8"))
            ip = j.get("ip")
            if ip and ip != "127.0.0.1":
                return ip
    except Exception:
        pass
    # 兜底：枚举本机非回环 IPv4
    try:
        for info in socket.getaddrinfo(socket.gethostname(), None, socket.AF_INET):
            ip = info[4][0]
            if not ip.startswith("127."):
                return ip
    except Exception:
        pass
    return "127.0.0.1"


def all_lan_ips():
    ips = []
    try:
        for info in socket.getaddrinfo(socket.gethostname(), None, socket.AF_INET):
            ip = info[4][0]
            if not ip.startswith("127.") and ip not in ips:
                ips.append(ip)
    except Exception:
        pass
    return ips


def notify(icon, title, body):
    try:
        icon.notify(body, title)
    except Exception:
        pass


# ---------------------------------------------------------------- 自带设置窗口
# 需求六.1：做一个简单的设置界面，Token 等配置直接在里面改，不用去翻 config.json。
# 走 loopback 的 /api/settings/local（仅本机可访问，无需 token），读取/写入配置。
# 需求六.2：启动 exe 不再自动弹网页，改从托盘手动打开面板。
def _local_api(port, method, payload=None):
    import urllib.request

    url = "http://127.0.0.1:%d/api/settings/local" % port
    try:
        if method == "GET":
            req = urllib.request.Request(url, method="GET")
        else:
            req = urllib.request.Request(
                url,
                data=json.dumps(payload or {}).encode("utf-8"),
                method="POST",
                headers={"Content-Type": "application/json"},
            )
        with urllib.request.urlopen(req, timeout=6) as r:
            return json.loads(r.read().decode("utf-8"))
    except Exception:
        return None


def open_settings_window(icon=None, item=None, icon_holder=None):
    """打开自带的设置窗口（tkinter，简单表单）。
    内容：Token、端口、开机自启等，保存即生效，不用去翻 config.json。
    端口等需要重启的改动，保存后自动重启服务（保持「保存即生效」）。"""

    def _run():
        port = get_port()
        try:
            import tkinter as tk
        except Exception as e:
            _log_raw("tkinter 不可用：%s" % e)
            try:
                ctypes.windll.user32.MessageBoxW(0, "本机没有可用的图形界面组件（tkinter）。", APP_NAME, 0x10)
            except Exception:
                pass
            return

        current = _local_api(port, "GET") or {}
        cfg = current.get("config") or {}

        win = tk.Tk()
        win.title("NERV Panel 设置")
        win.resizable(False, False)
        try:
            win.attributes("-topmost", True)
        except Exception:
            pass
        pad = 10
        rows = [
            ("访问令牌", "token", cfg.get("token", "")),
            ("天气城市", "weatherCity", cfg.get("weatherCity", "合肥")),
            ("刷新间隔（秒）", "refreshIntervalSec", str(cfg.get("refreshIntervalSec", 1))),
            ("服务端口", "port", str(cfg.get("port", 5000))),
            ("天气数据源 URL", "weatherApiUrl", cfg.get("weatherApiUrl", "")),
            ("平板唤醒地址", "tabletWakeUrl", cfg.get("tabletWakeUrl", "")),
            ("唤醒密钥 (X-Api-Key)", "tabletWakePassword", cfg.get("tabletWakePassword", "")),
        ]
        vars_ = {}
        widgets = []
        for i, (label, key, val) in enumerate(rows):
            tk.Label(win, text=label, anchor="w").grid(row=i, column=0, sticky="w", padx=(pad, 6), pady=4)
            var = tk.StringVar(value=val)
            vars_[key] = var
            ent = tk.Entry(win, textvariable=var, width=44)
            if key == "tabletWakePassword":
                ent.config(show="*")
            ent.grid(row=i, column=1, sticky="we", padx=(0, pad), pady=4)
            widgets.append(ent)

        last_row = len(rows)
        wake_var = tk.BooleanVar(value=bool(cfg.get("tabletWakeEnabled", False)))
        tk.Checkbutton(win, text="启动时唤醒平板", variable=wake_var).grid(
            row=last_row, column=0, columnspan=2, sticky="w", padx=pad, pady=(6, 2)
        )
        # 开机自启：此项直接写 Windows 注册表 Run 键（不走 config.json）
        autostart_var = tk.BooleanVar(value=bool(autostart_enabled()))
        tk.Checkbutton(win, text="开机自启（登录后后台静默启动）", variable=autostart_var).grid(
            row=last_row + 1, column=0, columnspan=2, sticky="w", padx=pad, pady=(2, 2)
        )

        status = tk.Label(win, text="", fg="#336633")
        status.grid(row=last_row + 2, column=0, columnspan=2, sticky="w", padx=pad)

        def _save():
            nonlocal port, current
            if not current:
                status.config(text="服务未连接，无法保存", fg="#cc0000")
                return
            try:
                int(vars_["refreshIntervalSec"].get())
                int(vars_["port"].get())
            except ValueError:
                status.config(text="刷新间隔与端口必须是数字", fg="#cc0000")
                return
            patch = {}
            for _, key, _ in rows:
                val = vars_[key].get()
                if key in ("refreshIntervalSec", "port"):
                    patch[key] = int(val)
                else:
                    patch[key] = val
            patch["tabletWakeEnabled"] = bool(wake_var.get())
            # 开机自启开关直接应用到注册表，保存即生效
            try:
                set_autostart(bool(autostart_var.get()))
            except Exception as e:
                _log_raw("设置窗口写开机自启失败：%s" % e)
            res = _local_api(port, "POST", patch)
            if not res:
                status.config(text="保存失败：服务未响应", fg="#cc0000")
                return
            restarting = bool(res.get("needsRestart"))
            changed = res.get("changed") or []
            if changed:
                status.config(text="已保存：" + "、".join(changed), fg="#336633")
            else:
                status.config(text="没有需要改动的内容", fg="#666666")
            # 端口变了：本窗口后续保存要打到新端口，并自动重启服务使其生效
            try:
                new_port = int(res["config"]["port"])
            except Exception:
                new_port = port
            port = new_port
            if restarting:
                status.config(text="已保存：服务正在重启使设置生效…", fg="#336633")
                sup = icon_holder and icon_holder.get("supervisor")
                if sup:
                    sup.restart()
            if icon is not None:
                try:
                    icon.update_menu()
                except Exception:
                    pass
            _log_raw("设置窗口已保存：%s%s" % (", ".join(changed), "（需重启服务）" if restarting else ""))

        def _reload():
            nonlocal port, current
            data = _local_api(port, "GET") or {}
            if data:
                port = int((data.get("config") or {}).get("port") or port)
            current = data
            cfg2 = current.get("config") or {}
            for _, key, _ in rows:
                if key in vars_:
                    vars_[key].set(str(cfg2.get(key, "")))
            wake_var.set(bool(cfg2.get("tabletWakeEnabled", False)))
            autostart_var.set(bool(autostart_enabled()))
            status.config(text="已重新读取配置", fg="#336633")

        btns = tk.Frame(win)
        btns.grid(row=last_row + 3, column=0, columnspan=2, sticky="e", padx=pad, pady=(8, pad))
        tk.Button(btns, text="重新读取", command=_reload, width=10).pack(side="left", padx=4)
        tk.Button(btns, text="保存", command=_save, width=10).pack(side="left", padx=4)

        win.update_idletasks()
        w = max(win.winfo_reqwidth(), 440)
        h = win.winfo_reqheight()
        scr_w = win.winfo_screenwidth()
        scr_h = win.winfo_screenheight()
        win.geometry("%dx%d+%d+%d" % (w, h, max(0, (scr_w - w) // 2), max(0, (scr_h - h) // 3)))
        win.mainloop()

    t = threading.Thread(target=_run, daemon=True)
    t.start()


# ---------------------------------------------------------------- 开机自启
def autostart_value():
    try:
        with winreg.OpenKey(winreg.HKEY_CURRENT_USER, r"Software\Microsoft\Windows\CurrentVersion\Run", 0, winreg.KEY_READ) as k:
            value, _ = winreg.QueryValueEx(k, REG_RUN_VALUE)
            return value
    except FileNotFoundError:
        return None


def autostart_enabled(item=None):
    val = autostart_value()
    if not val:
        return False
    return Path(sys.executable).resolve() == Path(val.split('"')[-2] if '"' in val else val).resolve()


def set_autostart(enabled):
    key = r"Software\Microsoft\Windows\CurrentVersion\Run"
    with winreg.OpenKey(winreg.HKEY_CURRENT_USER, key, 0, winreg.KEY_SET_VALUE) as k:
        if enabled:
            winreg.SetValueEx(k, REG_RUN_VALUE, 0, winreg.REG_SZ, '"%s" --autostart' % sys.executable)
        else:
            try:
                winreg.DeleteValue(k, REG_RUN_VALUE)
            except FileNotFoundError:
                pass
    _log.info("开机自启已%s" % ("开启" if enabled else "关闭"))


# ---------------------------------------------------------------- 防火墙
# 防火墙规则要点：监听 5000 端口的是 PyInstaller 解压出的 node.exe，其路径
# _MEI<pid>\bundle\node.exe 每次运行都变，所以「按程序」的规则下次启动就会失效。
# 因此这里给 TCP 5000 加一条「按端口」的入站放行规则——不依赖具体程序路径，
# 只服务于这个面板端口，永久有效。端口号跟随 config.json 的 port。
FIREWALL_NAME = "NERV-Panel-Server"


def _log_raw(text):
    """绕过 logging 直接落盘（托盘线程可能在 logging 未初始化时先跑）"""
    try:
        with open(log_path(), "a", encoding="utf-8") as f:
            f.write("%s [FW] %s\n" % (time.strftime("%Y-%m-%d %H:%M:%S"), text))
    except Exception:
        pass


def firewall_rule_exists(port):
    try:
        r = subprocess.run(
            ["netsh", "advfirewall", "firewall", "show", "rule", "name=%s" % FIREWALL_NAME],
            capture_output=True, text=True, timeout=20,
        )
        return r.returncode == 0 and FIREWALL_NAME in (r.stdout or "") and ("TCP" in r.stdout) and (str(port) in r.stdout)
    except Exception:
        return False


def ensure_firewall_rule(icon):
    """确保 TCP 监听端口在 Windows 防火墙里放行入站（平板走局域网 IP 访问必需）。
    普通权限直接添加（通常会失败）；失败时仅首次运行弹一次 UAC 提权重试，之后不再打扰。"""
    if not is_frozen():
        return
    port = get_port()
    if firewall_rule_exists(port):
        _log_raw("规则已存在（TCP %d），跳过" % port)
        return

    add_args = [
        "netsh", "advfirewall", "firewall", "add", "rule",
        "name=%s" % FIREWALL_NAME, "dir=in", "action=allow",
        "protocol=TCP", "localport=%d" % port,
        "enable=yes", "profile=private,domain,public",
    ]
    try:
        _log_raw("尝试普通权限添加：%s" % " ".join(add_args))
        p = subprocess.run(add_args, capture_output=True, text=True, timeout=30)
        _log_raw("普通权限 rc=%s out=%s err=%s" % (p.returncode, p.stdout.strip()[:200], p.stderr.strip()[:200]))
        if p.returncode == 0 and firewall_rule_exists(port):
            _log_raw("普通权限添加成功")
            return
        _log_raw("普通权限未生效，走 UAC 通道")
    except Exception as e:
        _log_raw("添加防火墙规则异常：%s" % e)

    # UAC 提权重试——只做一次，避免每次启动都弹窗。
    # 先落标记再异步拉起，绝不阻塞/重复弹窗。
    flag = data_dir() / ".firewall-uac-requested"
    if flag.exists():
        _log_raw("跳过 UAC 提权（已请求过一次）")
        return
    try:
        flag.write_text("requested once", encoding="utf-8")
    except Exception:
        pass
    try:
        ps = (
            "Start-Process -FilePath 'netsh.exe' -ArgumentList "
            "'advfirewall firewall add rule name=%s dir=in action=allow "
            "protocol=TCP localport=%d enable=yes profile=private,domain,public' "
            "-Verb RunAs -WindowStyle Hidden" % (FIREWALL_NAME, port)
        )
        _log_raw("尝试 UAC 提权添加（异步）")
        subprocess.Popen(
            ["powershell.exe", "-NoProfile", "-WindowStyle", "Hidden", "-Command", ps],
            creationflags=0x00000008,  # DETACHED_PROCESS：不占用父进程会话
        )
    except Exception as e:
        _log_raw("UAC 添加防火墙规则失败：%s" % e)
    _log_raw("UAC 已发起；若用户拒绝，本机访问不受影响，平板访问可能需要手动放行")


# ---------------------------------------------------------------- 服务守护
class ServerSupervisor(threading.Thread):
    """启动 node 服务端；进程异常退出时自动重启（最多连续 20 次）。"""

    def __init__(self, icon_holder):
        super().__init__(daemon=True)
        self.icon = icon_holder
        self.shutdown = False
        self.child = None
        self.crashes = 0
        self._restart_requested = False

    def run(self):
        # 端口每次循环都重读：设置里改端口并自动重启后，新的监听端口立即生效
        if server_status_ok(get_port()):
            _log.info("端口 %d 已有 NERV 服务在运行，直接使用" % get_port())
            self.crashes = -1  # 标记：服务不是本进程拉起
            return
        node = str(node_exe())
        entry = str(server_entry())
        env = os.environ.copy()
        if is_frozen():
            env["NERV_PANEL_ROOT"] = str(data_dir())
            env["NERV_PANEL_PUBLIC"] = str(public_dir())
        flags = subprocess.CREATE_NO_WINDOW
        while not self.shutdown:
            port = get_port()
            try:
                _log.info("启动服务端：%s %s" % (node, entry))
                self.child = subprocess.Popen(
                    [node, entry],
                    cwd=str(app_dir()),
                    env=env,
                    creationflags=flags,
                    stdout=subprocess.DEVNULL,
                    stderr=subprocess.DEVNULL,
                )
            except Exception as e:
                _log.exception("启动 node 失败：%s" % e)
                self._wait_before_restart()
                continue
            code = self.child.wait()
            if self.shutdown:
                break
            if self._restart_requested:
                # 手动重启（设置里改了端口等）：优先处理，不使用旧端口检测
                self._restart_requested = False
                _log.info("手动重启服务端（本次监听端口 %d）" % port)
            elif server_status_ok(port):
                _log.warning("服务端进程退出（code=%s）但端口仍在服务，不重启" % code)
                break
            else:
                self.crashes += 1
                _log.warning("服务端异常退出（code=%s，第 %d 次）" % (code, self.crashes))
                if self.crashes >= 20:
                    _log.error("连续崩溃 20 次，停止自动重启；日志见 %s" % log_path())
                    notify(self.icon["icon"], APP_NAME, "服务连续崩溃 20 次，已停止。请查看 launcher.log")
                    break
            self._wait_before_restart()

    def _wait_before_restart(self):
        for _ in range(30):  # 最多等 3 秒，随时可被退出打断
            if self.shutdown:
                return
            time.sleep(0.1)

    def restart(self):
        """重启服务端进程（设置里端口等改动保存后自动重启，让新配置立即生效）。
        只能在服务是由本进程拉起时使用；外部已有服务（crashes==-1）时直接忽略。"""
        if self.crashes == -1:
            _log.info("服务不是本进程拉起，跳过重启")
            return
        _log.info("收到重启请求")
        self._restart_requested = True
        child = self.child
        if child and child.poll() is None:
            try:
                subprocess.run(
                    ["taskkill", "/PID", str(child.pid), "/T", "/F"],
                    capture_output=True, timeout=15,
                )
            except Exception:
                try:
                    child.kill()
                except Exception:
                    pass
        # run() 的 wait() 返回后检测到手动重启标记，会自动用最新端口重新拉起

    def stop(self):
        self.shutdown = True
        child = self.child
        if child and child.poll() is None:
            # Windows 下 Popen.terminate() 就是 TerminateProcess —— 只杀 node 自己，
            # net-counters.ps1 / media-session.ps1 的常驻 PowerShell 子进程会变成孤儿。
            # 所以这里总是用 taskkill /T 按进程树整棵清理，保证退出后 5000 端口与
            # 后台 PowerShell 全部释放。
            try:
                subprocess.run(
                    ["taskkill", "/PID", str(child.pid), "/T", "/F"],
                    capture_output=True, timeout=15,
                )
            except Exception:
                try:
                    child.kill()
                except Exception:
                    pass


# ---------------------------------------------------------------- 托盘
def _make_copy_lan(ip):
    """返回 (icon, item) 双参回调，避免 pystray 对 >=3 参 callable 抛 ValueError。"""

    def action(icon, item):
        copy_lan(icon, item, ip)

    return action


def _make_open_settings(icon_holder):
    def action(icon, item):
        open_settings_window(icon, item, icon_holder)

    return action


def _show_lan_ip(icon, item):
    """右键菜单「查看本机局域网 IP」：以气泡通知展示所有局域网 IPv4。
    主 IP 与服务端 /api/status（lanIPv4 打分，会剔除虚拟网卡）保持一致。"""
    primary = lan_ip()
    ips = [i for i in all_lan_ips() if not i.startswith("127.")]
    if not ips:
        notify(icon, "本机局域网 IP", "未检测到局域网地址（仅回环网卡）")
        return
    if primary and primary not in ips:
        ips.insert(0, primary)
    # 从候选里再按 192.168 / 10. / 172.16-31 打分排序作为兜底主 IP
    def _score(a):
        s = 0
        if a.startswith("192.168."): s = 3
        elif a.startswith("10."): s = 2
        elif a[:4] == "172.":
            try:
                seg = int(a.split(".")[1])
                if 16 <= seg <= 31: s = 1
            except Exception:
                pass
        return s
    ordered = sorted(ips, key=_score, reverse=True)
    if primary and primary in ips:
        ordered = [primary] + [i for i in ordered if i != primary]
    body = "主 IP：" + ordered[0] + "\n全部：" + "、".join(ordered)
    notify(icon, "本机局域网 IP", body)


def build_menu(icon_holder):
    port = get_port()
    ip = lan_ip()
    ips = all_lan_ips()
    if ip not in ips and ip not in ("127.0.0.1",):
        ips.insert(0, ip)

    sub_items = []
    for i in ips:
        sub_items.append(
            pystray.MenuItem("复制 http://%s:%d" % (i, port), _make_copy_lan(i))
        )
    sub_items.append(pystray.Menu.SEPARATOR)
    sub_items.append(
        pystray.MenuItem("复制本机 http://127.0.0.1:%d" % port, copy_local)
    )

    def toggle_autostart(icon, item):
        new_state = not item.checked
        set_autostart(new_state)
        icon.update_menu()

    def quit_app(icon, item):
        icon_holder["supervisor"].stop()
        icon.stop()

    # 左键单击 = default 项 =「设置」；右键弹出完整菜单
    return pystray.Menu(
        pystray.MenuItem("打开设置", _make_open_settings(icon_holder), default=True),
        pystray.Menu.SEPARATOR,
        pystray.MenuItem("打开面板", open_panel),
        pystray.MenuItem(
            "查看本机局域网 IP：%s" % (ip if ip and ip != "127.0.0.1" else "未检测到"),
            _show_lan_ip,
        ),
        pystray.MenuItem("复制地址", pystray.Menu(*sub_items)),
        pystray.Menu.SEPARATOR,
        pystray.MenuItem("开机自启", toggle_autostart, checked=autostart_enabled),
        pystray.Menu.SEPARATOR,
        pystray.MenuItem("退出", quit_app),
    )


def make_icon_image():
    from PIL import Image, ImageDraw, ImageFont

    img = Image.new("RGBA", (64, 64), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    d.rounded_rectangle([2, 2, 62, 62], radius=14, fill=(200, 16, 32, 255))
    try:
        font = ImageFont.truetype("arialbd.ttf", 26)
    except Exception:
        font = ImageFont.load_default()
    d.text((32, 34), "NERV", font=font, fill="white", anchor="mm")
    # 下划线红标
    d.rounded_rectangle([18, 52, 46, 54], radius=1, fill=(255, 255, 255, 230))
    return img


# ---------------------------------------------------------------- 主流程
def start_firewall_async():
    """后台线程：放行防火墙（不依赖托盘回调）"""
    try:
        ensure_firewall_rule(None)
    except Exception:
        _log_raw("防火墙线程异常：%s" % sys.exc_info()[1])


def open_browser_when_ready(icon_holder):
    """后台线程：等服务就绪后自动打开浏览器（需求六.2：已移除自动弹网页，不再使用）。
    保留为空壳以兼容既有调用；打开面板只走托盘「打开面板」入口。"""
    return


def main():
    # 全局兜底：任何线程/主线程未捕获异常都要写进日志（windowed 模式下没有控制台可看）
    def _global_excepthook(exc_type, exc_value, exc_tb):
        import traceback as _tb

        try:
            with open(log_path(), "a", encoding="utf-8") as f:
                f.write("\n==== 未捕获异常 %s ====\n" % time.strftime("%Y-%m-%d %H:%M:%S"))
                _tb.print_exception(exc_type, exc_value, exc_tb, file=f)
        except Exception:
            pass

    sys.excepthook = _global_excepthook
    threading.excepthook = lambda args: _global_excepthook(args.exc_type, args.exc_value, args.exc_traceback)

    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s [%(levelname)s] %(message)s",
        handlers=[logging.FileHandler(str(log_path()), encoding="utf-8")],
    )
    _log.info("==== NERV Panel 启动 ====")
    _log.info("frozen=%s exe=%s" % (is_frozen(), sys.executable))
    _log.info("app_dir=%s data_dir=%s" % (app_dir(), data_dir()))

    # 单实例：已有一个实例在跑 → 直接退出（不弹网页，需求六.2）
    if not acquire_single_instance():
        _log.info("已有实例在运行，直接退出")
        return 0

    # 校验 bundle 完整性
    if not node_exe().exists():
        _log.error("缺少 node.exe：%s" % node_exe())
        ctypes.windll.user32.MessageBoxW(0, "缺少 node.exe，程序可能未完整打包。", APP_NAME, 0x10)
        return 1
    if not server_entry().exists():
        _log.error("缺少 server/index.js：%s" % server_entry())
        ctypes.windll.user32.MessageBoxW(0, "缺少 server/index.js，程序可能未完整打包。", APP_NAME, 0x10)
        return 1

    icon_holder = {"icon": None, "supervisor": None}

    sup = ServerSupervisor(icon_holder)
    icon_holder["supervisor"] = sup
    sup.start()

    # 后台任务：防火墙（不依赖托盘回调）。需求六.2：已不再自动打开浏览器。
    threading.Thread(target=start_firewall_async, daemon=True).start()

    try:
        image = make_icon_image()
        menu = build_menu(icon_holder)

        def on_ready(icon):
            icon_holder["icon"] = icon
            try:
                icon.title = "%s · http://127.0.0.1:%d" % (APP_NAME, get_port())
            except Exception:
                pass
            # 注意：pystray 提供了自定义 setup 回调时不会自动显示图标——
            # 必须显式置 visible = True，否则托盘图标永远不会出现（含展开的隐藏图标区）。
            try:
                icon.visible = True
            except Exception:
                _log.exception("显示托盘图标失败")

        icon = pystray.Icon(APP_NAME, image, APP_NAME + "（正在启动…）", menu)
        icon_holder["icon"] = icon
        icon.run(setup=on_ready)
    except Exception:
        _log.exception("托盘运行异常")
        # 托盘失败不应让服务跟着退出：保持进程空转（用户可从任务管理器结束）；
        # 服务端继续常驻。
        try:
            while True:
                time.sleep(3600)
        except KeyboardInterrupt:
            pass
    finally:
        sup.stop()
        _log.info("==== NERV Panel 已退出 ====")
    return 0


if __name__ == "__main__":
    sys.exit(main())