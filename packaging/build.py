# -*- coding: utf-8 -*-
"""
NERV Panel 桌面版打包脚本（Windows only）

流程：
  1. 清理并重建 staging 目录 build\\bundle
  2. 从 node_modules 拷贝运行时依赖（express / ws / systeminformation / iconv-lite 及其传递依赖）
  3. 拷贝 server/、public/、package.json、config.example.json
  4. 拷贝 node.exe（来自 where node，约 70~130MB）
  5. 用 PyInstaller 把 launcher.py 打成单个 exe，bundle 整体作为数据文件打进 exe
     （间接再注入静态资源，保证 --onefile 自解压后能正确定位）

用法：
  py build.py            # 产物在 dist\\NERV Panel.exe
  py build.py --quick    # 跳过 PyInstaller 只做 staging（调试用）
"""
import argparse
import shutil
import subprocess
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent          # packaging/
ROOT = HERE.parent                               # 项目根
STAGE = HERE.parent / "build" / "bundle"         # 自解压内容
DIST = HERE.parent / "dist"
ICO = HERE / "NERV-Panel.ico"

# 直接运行时依赖（prod 依赖），含其传递依赖：用 npm ls 展开
PROD_DEPS = ["express", "ws", "systeminformation", "iconv-lite"]


def node_executable():
    """定位 node.exe，优先 PATH 里的 node，其次常见安装路径。"""
    for cand in _find_on_path("node") + [
        r"C:\Program Files\nodejs\node.exe",
        r"C:\Program Files (x86)\nodejs\node.exe",
        str(Path.home() / "AppData" / "Roaming" / "nvm" / "current" / "node.exe"),
    ]:
        p = Path(cand)
        if p.is_file():
            return p
    raise RuntimeError("找不到 node.exe，请先安装 Node.js 并把 node 加入 PATH")


def _find_on_path(name):
    from shutil import which

    exe = which(name)
    return [exe] if exe else []


def npm_prod_packages():
    """返回 node_modules 下需要拷贝的顶层包名（prod 依赖 + 传递依赖）。"""
    import os as _os

    node_dir = str(node_executable().parent)
    env = dict(_os.environ)
    env["PATH"] = node_dir + _os.pathsep + env.get("PATH", "")
    # npm 是 .cmd 包装脚本，必须经 cmd.exe 运行
    out = subprocess.run(
        ["cmd.exe", "/c", "npm", "ls", "--omit=dev", "--all", "--parseable"],
        cwd=ROOT,
        env=env,
        capture_output=True,
        text=True,
        timeout=120,
    )
    pkgs = set()
    for line in (out.stdout or "").splitlines():
        line = line.strip()
        if not line:
            continue
        # 形如: <root>\node_modules\<pkg>
        parts = line.replace("/", "\\").split("\\")
        if "node_modules" in parts:
            idx = parts.index("node_modules")
            if idx + 1 < len(parts):
                pkgs.add(parts[idx + 1])
    return sorted(pkgs)


def stage():
    if STAGE.exists():
        shutil.rmtree(STAGE)
    STAGE.mkdir(parents=True, exist_ok=True)

    # 1) node.exe
    node = node_executable()
    shutil.copy2(node, STAGE / "node.exe")
    print("[1/5] node.exe ->", STAGE / "node.exe", node.stat().st_size // (1024 * 1024), "MB")

    # 2) prod 依赖
    src_nm = ROOT / "node_modules"
    dst_nm = STAGE / "node_modules"
    for pkg in npm_prod_packages():
        src = src_nm / pkg
        if src.is_dir():
            shutil.copytree(src, dst_nm / pkg, ignore=shutil.ignore_patterns("*.map", "__tests__", "test", "tests"))
    print("[2/5] node_modules 依赖已拷贝（%d 个包）" % len(npm_prod_packages()))

    # 3) server / public / package.json / config.example.json
    shutil.copytree(ROOT / "server", STAGE / "server")
    shutil.copytree(ROOT / "public", STAGE / "public")
    shutil.copy2(ROOT / "package.json", STAGE / "package.json")
    shutil.copy2(ROOT / "config.example.json", STAGE / "config.example.json")
    print("[3/5] server/ public/ package.json config.example.json 已拷贝")

    # 4) 关键资源存在性检查
    for rel in ["node.exe", "server/index.js", "public/index.html", "public/js/app.js",
                "public/css/style.css", "public/assets/hero.jpg"]:
        if not (STAGE / rel).exists():
            raise RuntimeError("staging 缺少关键文件：" + rel)
    print("[4/5] 关键资源校验通过")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--quick", action="store_true", help="只做 staging，不跑 PyInstaller")
    args = ap.parse_args()

    print("== NERV Panel 打包 ==")
    stage()

    if args.quick:
        print("quick 模式：staging 完成于", STAGE)
        return

    import PyInstaller.__main__

    DIST.mkdir(parents=True, exist_ok=True)
    name = "NERV Panel"
    cmd = [
        "--noconfirm",
        "--clean",
        "--onefile",
        "--windowed",
        "--name", name,
        "--icon", str(ICO),
        "--distpath", str(DIST),
        "--workpath", str(HERE.parent / "build" / "pywork"),
        "--specpath", str(HERE),
        "--add-data", "%s;%s" % (STAGE, "bundle"),
        str(HERE / "launcher.py"),
    ]
    print("[5/5] PyInstaller:", "pyinstaller " + " ".join(cmd))
    PyInstaller.__main__.run(cmd)
    out = DIST / (name + ".exe")
    if not out.exists():
        raise RuntimeError("打包失败：未生成 " + str(out))
    print("== 完成：", out, "%.1f MB" % (out.stat().st_size / (1024 * 1024)), "==")


if __name__ == "__main__":
    main()