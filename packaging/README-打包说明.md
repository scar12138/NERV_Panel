# NERV Panel 打包与安装设计

用户已于 2026-11-26 确认预览，现已进入正式构建与运行自检；管理员安装、防火墙和实机平板验收结果以交付报告最新记录为准。

## 路径和启动挂接

- `build.py` 将 node.exe、server、public、生产 node_modules、package.json 和示例配置复制到 `build/bundle`，生成每文件 SHA-256 的 `runtime-manifest.json`；onefile 内嵌完整 bundle。
- 安装包将同一份 `build/bundle` 安装至 `{app}\runtime`，launcher 优先使用此目录并验证完整内容。若安装 runtime 损坏，报错并写 launcher.log，不回退到随机解压目录。
- portable 将内嵌 bundle 完整复制并验证到 `%LOCALAPPDATA%\NERV_Panel\runtime\<完整内容SHA-256>`。同一版本的路径跨启动固定；任意代码、依赖或前端变化生成新目录。先写临时目录，逐文件校验并检查文件集合后原子改名；校验失败不运行部分更新。旧版本运行时缓存保留，不混入新版本，也不删除用户配置。
- launcher 获取全局单实例互斥体后才准备 runtime。服务使用其固定 node.exe 路径；配置、日志、缓存与数据仍通过 `NERV_PANEL_ROOT` 指向 `%LOCALAPPDATA%\NERV_Panel`。
- 不自动打开浏览器，从托盘打开设置/面板。启动器不运行 netsh、PowerShell 防火墙脚本或 UAC 提权。

## 安装与防火墙

- `installer.iss` 要求管理员安装，只在安装完成、实际 runtime 已落盘后执行 `firewall.ps1 -Mode Install`。
- 规则精确限定 `{app}\runtime\node.exe`、TCP、入站 Allow、Private 配置文件（2）；不放行其他程序，不修改全局通知或防火墙开关。允许该应用变更监听端口，无须启动期重配规则。
- 规则名由固定前缀和安装路径摘要组成。重复安装/升级先移除同名旧规则再添加唯一一条；同时迁移删除历史应用规则 `NERV-Panel-Server`（旧版端口规则）。不删除系统或第三方规则。
- 卸载在删除 helper 前用同一脚本 `-Mode Uninstall` 删除同一规则与历史应用规则。失败通过非零退出码传给安装器并显示错误；详细日志保留于 `%ProgramData%\NERV Panel\firewall-Install.log` / `firewall-Uninstall.log`，可区分文件/权限/策略失败。
- 升级替换整个 `{app}\runtime`，避免残留旧依赖和静态资源。安装器用 AppMutex 提示先退出正在运行的程序；安装后的立即启动使用原用户权限。
- 卸载保留 `%LOCALAPPDATA%\NERV_Panel` 的配置、数据、日志与 portable runtime 缓存。
- portable 不自动配置规则或提权；第一次网络访问可能仍由 Windows 请求用户授权，已有授权在相同内容版本稳定路径上可复用。内容版本变化后 Windows 可能再次要求授权。要使用安装期 Private-only 规则请用安装版。不要手工添加全程序或所有配置文件的放行规则。

## 图标

`make_icon.py` 从根目录 `nerv.jpg` 生成 `packaging/NERV-Panel.ico`，保持完整图片比例并透明补齐方形，包含 16/24/32/48/64/128/256 尺寸。build.py 构建前重新生成；exe 资源、内嵌托盘图片与 Inno Setup 使用同一 ICO。

## 待确认后执行的构建

Windows + Node.js + Python 3.9+，使用同一个装有 pyinstaller、pystray、pillow 的解释器。

```bat
python packaging\build.py
ISCC packaging\installer.iss
```

`--quick` 仍会重建 staging 并运行 node 依赖检查，并非纯语法检查。`build.py` 后续会检查 PyInstaller 归档包含 pystray、Pillow、runtime_paths、bundle node/server/manifest 与共享图标。直接构建 spec 前需先准备带 manifest 的 staging。

正式运行验证建议在用户确认后依次检查：干净安装时 UAC、实际 node 命令行路径、Private-only 唯一规则、重复启动/改端口不提权、重复安装不增规则、runtime 内容更新无旧文件、卸载规则移除且配置保留、拒绝/策略阻止时可见错误、portable 完整升级与缓存修复。当前未执行这些操作。

### 第十六轮正式验收与打包（2026-11-26，最新结论）

用户已确认进入自检与打包。当前调音窗口继承 CPU/GPU 共用 sheet 尺寸（最大 860px / 88dvh，底部弹出），不采用此前全屏方案。

- 真实 Core Audio / SMTC 后端验收通过；默认设备、独立应用会话及系统声音均可读取，音量/静音仅写原值并恢复。没有触发播放、切歌或 seek。
- 修复 PowerShell 5.1 未投影封面流、旧 256KiB 上限及复合 MIME 问题：新增 media-thumbnail.cs，以系统自带 WinRT 元数据编译，原图 313786 字节转换为 320px 标准 JPEG，真实缓存 19193 字节。最终 raw / Node 缓存字节与 hash 一致。
- 排序 11 组真实鼠标/触摸验收通过。修复长按开始后浏览器 pointercancel：拖动期间 nonpassive touchmove.preventDefault，长按前保留滚动。正式 app.js 整页 POST、token、磁盘持久化、刷新恢复、新收藏末尾及 401/400/409 路由验证通过，未改真实用户收藏。
- 前端源码验收 35/35；成品 exe 服务验收 37/37，横 1280×800、竖 800×1280 均通过，小封面真实解码 320×320。滑块节流及播放动画用 Mock，浏览器写未到真实网络；音频读与鉴权探针为真实请求。
- 天气/可见性回归 13/13、顶部告警 40/40；四视图页面及 inner overflow 均为 0（几何测量前结束装饰动画，避免 headless 动画中间帧假溢出）。未做实体平板、听感、输出设备切换或拔插测试。
- PyInstaller 产物依赖检查通过：pystray 13 模块、PIL 75 模块，626 bundle 项；8 项核心源码与 exe 内资源逐字节一致，7 档 ICO 已生成。原 pystray 缺失闪退没有在新 exe 重现。
- 安装包 Inno Setup 6.7.4 编译通过。首次编译不支持 UninstallAppMutex，已改为 InitializeUninstall + CheckForMutexes 检查运行实例。
- 新 exe 已真实启动，5000 服务使用 LocalAppData/NERV_Panel/runtime/27b173b0775f3f1ffd3003bdce6e4440c90c24437990416e34176da7c05e1229/node.exe。重复启动退出码 0；系统已创建该进程的 SystemTrayIcon 窗口，未目视核验托盘外观。未发现新启动日志中的 UAC/防火墙配置动作。
- portable 固定路径复用、内容变更换目录、损坏修复、安装目录优先、安装目录损坏拒绝均通过隔离测试。
- **未验收：管理员安装/卸载重装与防火墙实际落地。** 当前 Windows 为 Medium token，管理员组 deny-only，IsInRole(Administrator)=false；会话不允许权限升级审批，因此未执行安装器/防火墙写入，不能声称 Private 规则已生效或不再弹系统提示。安装器源码已限定固定 runtime/node.exe、TCP 入站、Private，仅迁移本应用规则；待管理员实装验证。
- 隔离 5016 测试服务已停止，新便携版 5000 服务保留供实装查看。Git 历史对象已有损坏，本轮未修复或依赖 Git。

成品校验：

- NERV Panel 安装版.exe：90929113 字节；SHA256 2ccee9e0879b546c0217698ec6a8b99befde433074463ce769a280363edb1311

- NERV Panel.exe：60812505 字节；SHA256 f08a067180fe5498273c62037362981ea665e96ed008110953db64bac301283c
