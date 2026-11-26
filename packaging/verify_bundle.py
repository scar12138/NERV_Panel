# -*- coding: utf-8 -*-
"""
打包产物自检：确认 exe 里真的带着托盘依赖（pystray / Pillow）。

背景：launcher.py 顶层 `import pystray`，若打包用的 Python 环境里没装 pystray，
PyInstaller 只会在 warn 文件里记一行 “missing module named pystray”，
然后照常生成一个「能双击、但一启动就 ModuleNotFoundError 闪退」的 exe。
这里改成构建后必查，缺依赖直接让打包失败，避免再发出坏包。

用法：
    python packaging/verify_bundle.py "dist/NERV Panel.exe"
不带参数时默认校验 dist/NERV Panel.exe。
"""
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
ROOT = HERE.parent

# 必需的托盘运行时模块（PYZ 里的纯 Python 模块名前缀）
REQUIRED_PYZ = ["pystray", "runtime_paths"]

# 必需的二进制的 / 包数据（外层归档里的名字片段）
REQUIRED_OUTER = ["PIL"]


def main(argv):
    exe = Path(argv[1]) if len(argv) > 1 else ROOT / "dist" / "NERV Panel.exe"
    if not exe.is_file():
        print("找不到产物：%s" % exe)
        return 2

    from PyInstaller.archive.readers import CArchiveReader

    reader = CArchiveReader(str(exe))
    outer = list(reader.toc.keys())
    inner = list(reader.open_embedded_archive("PYZ.pyz").toc.keys())

    problems = []

    pyz_names = "\n".join(inner)
    for prefix in REQUIRED_PYZ:
        if prefix not in pyz_names:
            problems.append("PYZ 中缺少模块包：%s" % prefix)

    # Pillow 是延迟导入，模块在 PYZ，_imaging 等 .pyd 在外层
    for prefix in REQUIRED_OUTER:
        if not any(n.split(".")[0] == prefix for n in inner):
            problems.append("PYZ 中缺少模块包：%s" % prefix)
    if not any(n.lower().startswith("pil") or "_imaging" in n.lower() for n in outer):
        problems.append("外层归档中缺少 Pillow 二进制（_imaging*.pyd 等）")

    # Stable portable runtime requires a complete manifest and shared tray icon.
    normalized = {name.replace("\\", "/") for name in outer}
    for required in ("bundle/node.exe", "bundle/server/index.js", "bundle/runtime-manifest.json", "NERV-Panel.ico"):
        if required not in normalized:
            problems.append("外层归档中缺少：" + required)

    print("产物：%s（%.1f MB）" % (exe, exe.stat().st_size / (1024 * 1024)))
    print("外层归档条目：%d；PYZ 条目：%d" % (len(outer), len(inner)))
    print("pystray 模块数：%d" % len([n for n in inner if n.startswith("pystray")]))
    print("PIL 模块数：%d" % len([n for n in inner if n.split(".")[0] == "PIL"]))
    print("bundle 条目数：%d" % len([n for n in outer if n.startswith("bundle")]))

    if problems:
        print("\n[自检失败] 这个 exe 发出去会闪退：")
        for p in problems:
            print("  - " + p)
        print("\n多半是打包用的 Python 环境里没装依赖。用装了 pystray/pillow 的解释器重打：")
        print('  "D:\\Python\\Python312\\python.exe" packaging\\build.py')
        return 1

    print("\n[自检通过] 托盘依赖与 bundle 都在。")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
