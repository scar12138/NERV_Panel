# NERV Panel 桌面版（单文件 exe）

把原来的 `start.bat + Node 服务端` 打包成了一个双击即用的 Windows 桌面程序。
不需要安装 Node.js / Python，不需要点 bat，不弹黑窗。

## 文件

| 文件 | 说明 |
| --- | --- |
| `dist\NERV Panel.exe` | 成品：单个 exe，约 138 MB，双击就能跑 |
| `packaging\launcher.py` | 桌面托盘启动器源码 |
| `packaging\build.py` | 打包脚本（staging + PyInstaller onefile） |
| `packaging\make_icon.py` | 生成托盘/程序图标 |
| `packaging\NERV-Panel.ico` | 图标 |
| `packaging\README-打包说明.md` | 本文档 |

## 用法

1. 把 `NERV Panel.exe` 拷到任何 Windows 10/11 64 位电脑，双击。
2. 等 3~5 秒，自动打开浏览器显示 `http://127.0.0.1:5000`（原 start.bat 行为不变，页面、接口、功能完全一样）。
3. 任务栏托盘出现红色 NERV 图标，右键菜单：
   - 「打开面板」再次打开浏览器
   - 「局域网地址」子菜单列出本机全部局域网 IP，点某项复制 `http://<该IP>:5000`，发给平板直接可开
   - 「开机自启」勾选后写入当前用户登录自启（默认不勾）；下次开机自动后台运行、不弹浏览器
   - 「退出」停止服务并退出托盘（会连后台 PowerShell 子进程一起清掉，不留孤儿）
4. 服务异常退出会自动重启（最多连续 20 次）；所有日志在
   `%LOCALAPPDATA%\NERV_Panel\launcher.log`（服务端日志在 `%LOCALAPPDATA%\NERV_Panel\logs\`）。
5. 用户数据（`config.json`、换的主图、应用图标缓存）全部保存在 `%LOCALAPPDATA%\NERV_Panel\`，
   与 exe 位置无关；换电脑重新拷 exe 即可，各自独立。重复双击 exe 不会起第二个服务，只会重新打开面板。

## 首次运行与防火墙

- 服务端监听 5000 端口的 node.exe 是 PyInstaller 自解压到 `%TEMP%\_MEI<pid>\` 的临时副本，
  路径每次运行都变，所以不能按程序加防火墙规则；本程序改为给 **TCP 端口**（默认 5000）加一条
  入站放行规则 `NERV-Panel-Server`，与程序路径无关、永久有效，保证平板用局域网 IP 能访问。
- 普通权限直接加不了规则时，**首次运行会异步弹一次 UAC** 去提权（只弹一次，之后不再打扰；
  拒绝也不影响本机访问）。
- 若规则未创建成功，手动放行一条即可：
  `netsh advfirewall firewall add rule name=NERV-Panel-Server dir=in action=allow protocol=TCP localport=5000`
- 在面板里改了端口，重启 exe 后会自动为新端口补规则。

## 如何重新打包

要求：Windows 上装有 Python 3.9+（含 pip）和 Node.js（打包时复制 node.exe 和 npm 依赖）。

```bat
pip install pyinstaller pystray pillow -i https://mirrors.aliyun.com/pypi/simple/
python packaging\build.py
```

产物在 `dist\NERV Panel.exe`。`python packaging\build.py --quick` 只做 staging 排查用。

## 实现要点

- **单文件**：PyInstaller `--onefile --windowed`；启动时自解压到 `%TEMP%\_MEI<pid>\`，
  里面是 `bundle\`（node.exe + 服务端代码 + public 前端 + node_modules 依赖）。
- **不改服务端逻辑**：服务端代码原样运行，仅通过两个环境变量指向持久化目录：
  `NERV_PANEL_ROOT`（config/logs/data/cache）与 `NERV_PANEL_PUBLIC`（前端目录）。
  源码直接 `node server/index.js` 运行的行为完全不变（已回归验证）。
- **单实例**：命名互斥体；重复双击只会重新打开浏览器。
- **托盘**：pystray + Pillow 纯 ctypes 实现，不依赖 pywin32。
- **已修复的关键坑**：
  - pystray 的 `MenuItem` 回调接收 ≥3 个位置参数会抛 `ValueError`，导致托盘建不起来、
    进程静默退出、node 变孤儿 —— 已改双参闭包并加全局异常钩子写日志。
  - `checked=` 回调 pystray 会传入 item 参数 —— 签名已兼容。
  - Windows 下 `Popen.terminate()` 只杀 node 自己、常驻 PowerShell 子进程会泄漏 ——
    退出时统一用 `taskkill /PID x /T /F` 整树清理。