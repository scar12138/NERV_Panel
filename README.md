# NERV Panel

EVA 明日香主题的局域网电脑监控面板。一台 Windows 电脑跑服务端（同时提供网页和 API），一台安卓平板在同一个 Wi-Fi 下用 **FreeKiosk** 全屏打开，长期插电当作常亮状态屏。

面板只有**两页**：**监控**（默认页，标题「监控 MONITOR」，含大时钟、天气、当月月历（**卡面只显示日期**，节日 / 农历 / 节气在点开的日历详情里），以及 CPU / GPU / 内存 / 网络 / 磁盘 / 风扇六张硬件卡，每张都能点开看完整数值、历史走势和最高最低平均）与**启动**（标题「启动 LAUNCH」，含常用软件、搜索、音乐控制、页面最下方一排系统按钮）。右上角两个按钮切换，也可以左右滑动、点页码点或用键盘方向键。

两页都是**一屏放下、整页不滚动**：横竖屏都靠缩放下间距、字号与卡片高度来适配，只有详情层、挑选层、设置面板内部可以滚动，常用软件列表也在自己的小容器里滚动。

全站只有**一个设置面板**：入口在**启动页最下方第 5 个按钮「设置」**（那一排是 锁屏 / 睡眠 / 重启 / 关机 / 设置 共 5 个）。点开才显示服务端地址、访问令牌、刷新间隔、天气城市、连接状态详情、主视觉图片与平板唤醒配置。**桌面版 exe 另有托盘图标**：左键单击托盘 = 打开设置窗口（Token / 端口 / 开机自启直接改）、右键菜单包含 打开设置 / 打开面板 / 查看本机局域网 IP / 复制地址 / 开机自启 / 退出，开机自启开关直接写 Windows 注册表，不用翻 config.json。

只走局域网，不做公网、不做云端中转、不做账号登录。

---

## 怎么跑起来

**桌面版（推荐，免装 Node）**：两种成品都在 `dist/` 下：
- `NERV Panel.exe` —— **免安装版**：双击即用，右下角系统托盘出现图标（左键打开设置、右键弹出菜单），服务自动后台常驻。
- `NERV Panel 安装版.exe` —— **安装版**：向导安装到 Program Files，带开始菜单/桌面快捷方式与卸载程序，安装后同样进托盘。

源码运行前置：装好 [Node.js](https://nodejs.org/)（20 或更高版本，本项目在 v24.22.1 上开发）。

```bat
:: 首次：安装依赖
npm install

:: 之后每次启动：双击 start.bat，或在项目根目录执行
start.bat
```

`start.bat` 会做三件事：切 UTF-8 代码页（否则中文日志是乱码）、启动 `node server\index.js`、进程异常退出时 5 秒后自动重启（最多连续 20 次）。

也可以直接 `npm start`，但没有崩溃自动重启。

启动成功后控制台会打印：

```
  NERV PANEL / MAGI ONLINE
  ----------------------------------------
  http://192.168.x.x:5000
  ----------------------------------------
```

平板在 FreeKiosk 里填的就是这一行的地址。**平板要填电脑的局域网 IP，不能填 `localhost`。**

完整平板设置见 [TABLET-SETUP.md](TABLET-SETUP.md)。平板端用 **FreeKiosk**（免费开源 MIT，无广告无水印），采用**基础模式**安装即可：装 APK → 右下角连点 5 下输 PIN 进设置填 Start URL → 点 Start Kiosk Mode。不需要 Device Owner 模式、不需要连电脑跑 ADB、不需要买 PLUS 授权；需要简体中文时用 GitHub 上的 beta 版 APK。

---

## 技术栈

| 层 | 选型 | 实际版本 | 一句理由 |
| --- | --- | --- | --- |
| 运行时 | Node.js | v24.22.1（要求 >= 20） | 服务端与静态资源托管共用同一个进程，无需额外 Web 服务器 |
| 服务端框架 | Express | 5.3.0 | 轻量成熟，路由与静态托管开箱可用，适合这种小体量服务 |
| 实时推送 | ws | 8.23.0 | WebSocket 推送硬件数据，比轮询省电且延迟低 |
| 硬件采集 | systeminformation | 5.33.24 | Windows 上成熟的跨平台系统信息库，CPU / 内存 / GPU / 磁盘 / 网络一次覆盖 |
| GPU 补充采集 | `nvidia-smi` | 随 NVIDIA 驱动 | 显存、温度、频率、功耗只有驱动自带的它给得最准，systeminformation 取不到功耗 |
| 天气 | Open-Meteo | 免密钥公开接口 | 免费、无需 API Key、支持按中文城市名 geocoding |
| 前端 | 原生 HTML + CSS + JS | — | 零构建步骤，平板打开即用，不用为一块屏幕引入打包工具 |
| 字体 | `@fontsource/*`（本地 woff2） | @fontsource 5.3.0 | 字体文件随项目走，离线可用，不依赖任何在线 CDN |

字体文件位于 `public/assets/fonts/`：

| 文件 | 用途 |
| --- | --- |
| `barlow-condensed-400/500/600/700.woff2` | 英文与数字的窄体科技感字体 |
| `rajdhani-500/600/700.woff2` | 数字与英文小标签的等宽备用 |
| `noto-sans-sc-cn-400.woff2` / `noto-sans-sc-cn-700.woff2` | 中文正文（Noto Sans SC 简体全集，常规 + 粗体） |
| `noto-sans-sc-latin-400.woff2` / `noto-sans-sc-latin-700.woff2` | 该中文字体的拉丁子集（带 `unicode-range`，英文数字优先走 Barlow/Rajdhani） |

来源：npm 包 `@fontsource/barlow-condensed`、`@fontsource/rajdhani`、`@fontsource/noto-sans-sc`，均以 devDependencies 安装后复制进 `public/assets/fonts/`，运行时不依赖 `node_modules`。加载失败时 CSS 里已声明回退链（`Barlow Condensed` → `Rajdhani` → `Noto Sans SC` → `PingFang SC` → `Microsoft YaHei` → `sans-serif`），不会掉回系统默认衬线字体。

> **不提供 ZCOOL QingKe HuangYou**。早期版本曾用它做标题字体，实测简体中文缺字严重（出现糊字与方框），已按需求文档第 6.1 节全部移除，中文正文统一走 Noto Sans SC。

---

## 配置

根目录唯一配置文件是 `config.json`。它不会随仓库发布（已写进 `.gitignore`），首次启动时若不存在会自动生成，模板见 `config.example.json`。

**改完配置要重启服务端才生效**（服务端启动时读取一次）。「设置」面板 / 桌面版托盘设置窗口里保存的项立即生效；其中端口等需要重启的项，桌面版会在保存后**自动重启服务**。

| 字段 | 类型 | 默认值 | 说明 | 面板内可否改 |
| --- | --- | --- | --- | --- |
| `port` | int | `5000` | 服务端口，1–65535 | 可填，桌面版保存后自动重启生效 |
| `token` | string | 自动生成 | 控制类接口的鉴权令牌。留空时启动自动生成 24 字节随机值并写回文件 | 需在面板内填写同一值，见下 |
| `weatherCity` | string | `合肥` | 天气城市，中文名直接写 | 可改，立即生效 |
| `weatherApiUrl` | string | `https://api.open-meteo.com/v1/forecast` | 天气接口地址，换源时改这里 | 否（改文件 + 重启） |
| `heroImagePath` | string | `assets/hero.jpg` | 默认主视觉图片，路径相对于 `public/`。**这是出厂默认图，不会被更换主图覆盖** | 否（改文件 + 重启） |
| `customHeroImagePath` | string | 空 | 用户更换的主视觉图片（相对路径，如 `data/hero/hero-xxx.jpg`）。为空时用 `heroImagePath`，非空时优先 | 用面板「更换主图」按钮，立即生效 |
| `favoriteAppIds` | string[] | `[]` | 启动页常用软件，只存 `id` 不存路径，顺序即显示顺序。**不预置任何应用** | 用面板「添加常用」/ 星标，立即生效 |
| `refreshIntervalSec` | int | `1` | 数据刷新间隔（秒），1–60 | 可改，立即生效 |
| `tabletWakeEnabled` | boolean | `false` | 是否在服务端启动时唤醒平板屏幕 | 可改，下次启动生效 |
| `tabletWakeUrl` | string | 平板 IP 示例 | FreeKiosk REST API 亮屏地址 | 可改，下次启动生效 |
| `tabletWakePassword` | string | 空 | FreeKiosk REST API 的 API Key | 可改，下次启动生效 |

### Token 怎么用

`token` **不会**通过任何接口下发到前端（`/api/config` 只返回非敏感字段）。平板上需要手动填一次：

1. 桌面版：托盘左键 / 启动页「设置」按钮 → 设置窗口，Token 字段直接填；或源码版用文本编辑器打开电脑上的 `config.json` 复制 `token` 的值。
2. 平板打开面板 → 启动页底部「设置」→ 访问令牌 → 粘贴 → 保存设置。

令牌存在平板浏览器的 `localStorage` 里，之后启动应用、电源操作、系统操作都会自动带上 `X-NERV-Token` 头。

### 怎么换主视觉图片

**方式一（推荐，不用改文件）**：平板打开面板 → 启动页底部「设置」→「更换主图」→ 直接选本地图片。服务端会把它存到 `data/hero/` 并写回 `customHeroImagePath`，立即生效，刷新和重启后仍是新图。默认图 `public/assets/hero.jpg` 不会被覆盖；点「恢复默认」即可换回。

**方式二（改文件）**：把新图放进 `public/assets/`，把 `config.json` 里 `customHeroImagePath` 置空、`heroImagePath` 改成新路径（相对 `public/`，不要写盘符），重启服务端。

支持 jpg / png / webp，单张不超过 8 MB。服务端按**文件头魔数**判断真实类型，改后缀骗不过校验。

建议用**竖构图、人物居中偏右**的图：监控页顶部的展示区域是横长条，`object-position` 已设为 `68% 22%`，会把人物的头肩部分顶到画面里。图片宽高比与展示区差太多时，左右两侧会被裁掉。

找不到图片时页面不会白屏，会显示占位底色并记录到 `logs/`。

---

## 目录结构

```
.
├── start.bat                    # 启动脚本（UTF-8 代码页 + 崩溃自动重启）
├── NERV-Panel.vbs               # 无窗口启动（供开机自启使用）
├── config.json                  # 唯一配置文件（首次启动自动生成，不入库）
├── config.example.json          # 配置模板
├── package.json                 # 依赖与脚本
├── server/                      # 服务端
│   ├── index.js                 # 入口：HTTP/WS 服务、路由、优雅关闭
│   ├── config.js                # 配置读写校验、局域网 IP 探测、token 生成
│   ├── logger.js                # 按天 + 按大小滚动的本地日志
│   ├── metrics.js               # 硬件采集（systeminformation + nvidia-smi）、10 分钟历史缓冲
│   ├── netwatch.js              # 常驻子进程读网卡累计字节，按差值算实时速率
│   ├── media.js                 # 系统媒体会话（SMTC）的 Node 封装
│   ├── weather.js               # Open-Meteo 三件套（geocoding/forecast/air-quality）
│   ├── apps.js                  # 开始菜单 + Steam 库扫描、图标提取、运行状态、关闭应用
│   ├── procs.js                 # tasklist 进程表缓存、按进程名正常关闭
│   ├── favorites.js             # 常用软件（config.json 的 favoriteAppIds）
│   ├── hero.js                  # 主视觉图片上传、魔数校验、独立存储
│   ├── launcher.js              # 白名单启动（.lnk / steam://）
│   ├── power.js                 # 电源与系统操作白名单
│   ├── auth.js                  # Token 校验（timingSafeEqual）
│   ├── wake.js                  # 平板唤醒（默认关闭）
│   └── ps/                      # 常驻的 PowerShell 脚本（媒体会话、网卡计数）
├── public/                      # 前端（由 Express 直接托管）
│   ├── index.html               # 单页结构：MAGI 开机动画 + 2 页（监控 / 启动）
│   ├── css/style.css            # EVA 主题、字体、动效、横竖屏适配
│   ├── js/app.js                # 翻页、WebSocket、指标渲染、详情层、启动页
│   ├── js/lunar.js              # 农历 / 节日 / 节气（自包含，日历详情用）
│   └── assets/                  # 主视觉图片与本地字体
├── packaging/
│   ├── launcher.py              # 桌面版入口：托盘 + 设置窗口 + 开机自启 + 服务守护（PyInstaller 打包）
│   ├── build.py                 # 打包免安装 exe 的脚本
│   └── installer.iss            # Inno Setup 脚本：生成安装版
├── scripts/
│   ├── install-autostart.ps1    # 源码版安装/卸载开机自启（桌面版用托盘「开机自启」开关即可）
│   └── diag-*.js / shoot.js     # 开发期布局诊断 / 截图工具
├── TABLET-SETUP.md              # 平板端 FreeKiosk 完整设置（基础模式三步安装法）
├── PROGRESS.md                  # 各阶段开发记录、读不到的字段与降级方式
└── logs/                        # 运行日志（自动生成，不入库）
```

成品（`dist/`）：

```
dist/
├── NERV Panel.exe               # 免安装版：双击即用（托盘常驻）
└── NERV Panel 安装版.exe        # 安装版：Inno Setup 向导安装 + 卸载
```

---

## 开机自启

**桌面版（推荐）**：托盘右键菜单或设置窗口里的**「开机自启」开关**即可——它直接把 `"<exe路径>" --autostart` 写进当前用户的
`HKCU\Software\Microsoft\Windows\CurrentVersion\Run` 注册表。开启后每次登录**后台静默启动**（进托盘，不弹网页、不弹黑窗）；
关闭即删除该项。单实例：自启与手动双击重复拉起时，后到进程直接退出。

**源码版**：在项目根目录用 PowerShell 执行：

```powershell
.\scripts\install-autostart.ps1
```

它会在当前用户的启动文件夹 `%APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup` 里创建一个指向 `NERV-Panel.vbs` 的快捷方式。

原理：Windows 登录时会执行启动文件夹下的所有快捷方式 → 快捷方式调用 `NERV-Panel.vbs` → VBS 用 `WScript.Shell.Run(cmd, 0, False)` 以隐藏窗口方式启动 `start.bat` → `start.bat` 在 Node 进程异常退出时 5 秒后重新拉起（最多连续 20 次）。所以「开机自启」和「崩溃自动拉起」是同一套机制。

卸载（源码版）：

```powershell
.\scripts\install-autostart.ps1 -Remove
```

不需要管理员权限（只写当前用户目录）。

---

## 平板端怎么连（FreeKiosk）

平板端不装任何自研 App，只是在 **FreeKiosk** 里打开服务端网页。FreeKiosk 是免费开源软件（MIT 协议），无广告、无水印，全屏、开机自启、常亮、断线重载、REST API 亮屏**全部免费**，不需要买 PLUS 授权。

**基础模式三步安装法**（详细步骤、每一项开关的位置和取值见 [TABLET-SETUP.md](TABLET-SETUP.md)）：

1. **装 APK**：从 GitHub Releases 下载安装，打开 App。需要简体中文就用 beta 版（`v2.1.0-beta.2` 及以上含简体中文）；HarmonyOS 装不上时先到系统设置**关闭纯净模式**。
2. **填地址**：在界面**右下角连点 5 下**，输入自己设的 PIN 进入设置，把 **Start URL** 填成 `http://<电脑局域网IP>:<port>`（例如 `http://192.168.10.11:5000`）。
3. **进全屏**：点 **Start Kiosk Mode**，平板进入全屏锁定显示面板。

然后把这几项打开：**Auto-start on Boot**（开机自启）、**Keep Screen On**（充电常亮）、**Auto Reload**（断线自动重载）、**Screen Orientation = Auto**（不锁死方向）。

**不需要 Device Owner 模式，不需要连电脑跑 ADB，不需要删账号或恢复出厂设置。**

---

## 接口一览

| 方法 | 路径 | 需要 Token | 说明 |
| --- | --- | --- | --- |
| GET | `/api/status` | 否 | 电脑名、局域网 IP、版本、在线状态、已运行秒数 |
| GET | `/api/config` | 否 | 非敏感配置（不含 token / 密码） |
| GET | `/api/metrics` | 否 | 当前硬件快照（WebSocket 不可用时的轮询降级通道） |
| GET | `/api/metrics/history` | 否 | 最近 12 分钟历史（`?minutes=N` 可调，上限 12），历史不足时按实际时长返回 |
| WS | `/ws/metrics` | 否 | 每秒推送一次硬件数据 |
| GET | `/api/weather` | 否 | 配置城市当前天气 + 未来 3 天 |
| GET | `/api/apps` | 否 | 扫描到的可启动项目（含 `running`，`?refresh=1` 强制重扫）。**仅供「添加常用」挑选与搜索，不要据此在启动页铺满全部** |
| GET | `/api/apps/:id/icon` | 否 | 项目图标 PNG，取不到返回 404 |
| GET | `/api/favorites` | 否 | 常用软件列表，按 `favoriteAppIds` 顺序解析 |
| POST | `/api/favorites` | **是** | `{action:"add"\|"remove", id}`，id 须在全量列表内 |
| POST | `/api/launch` | **是** | 启动项目，只接受列表内的 `id` |
| POST | `/api/close-app` | **是** | 关闭该项目对应进程（正常关闭优先，不带 `/F`） |
| GET | `/api/media` | 否 | Windows 系统媒体会话：歌名 / 歌手 / 是否播放 / 来源应用 / 封面缩略图 |
| POST | `/api/media/control` | **是** | 接受 `play` / `pause` / `playPause` / `prev` / `next`（`play` 真正开始播放） |
| POST | `/api/power` | **是** | `shutdown` / `restart` / `sleep` / `lock` / `logout` |
| POST | `/api/system` | **是** | `displayOff` / `taskManager` |
| POST | `/api/settings` | **是** | 修改配置并写回 `config.json` |
| POST | `/api/hero-image` | **是** | 上传主视觉图片（jpg/png/webp，≤8 MB，按魔数校验），写回 `customHeroImagePath` |
| POST | `/api/hero-image/reset` | **是** | 清除用户上传的图，恢复默认 `heroImagePath` |
| GET | `/custom-hero/:file` | 否 | 提供用户上传的主视觉图片 |

Token 通过请求头 `X-NERV-Token` 传递（也接受请求体里的 `token` 字段）。缺失或错误一律 401 并返回明确错误码：`TOKEN_NOT_CONFIGURED` / `TOKEN_MISSING` / `TOKEN_INVALID`。

控制类接口的 `action` / `id` 白名单校验在**服务端做第二遍**（前端传什么都无法越权），且不接受任何前端传入的文件路径。

---

## 硬件数据来源与读不到的字段

**来源**：`systeminformation` 5.33.24 提供 CPU 占用/型号/频率/温度与每核心占用、内存、磁盘、GPUs 列表；`nvidia-smi` 提供 NVIDIA 显卡的占用、温度、显存、频率、功耗；网络速率来自常驻 PowerShell 读 `Get-NetAdapterStatistics`（`server/netwatch.js`）；进程与关闭应用来自 `tasklist` / `taskkill`（`server/procs.js`）；媒体会话来自 Windows SMTC（`server/media.js` + `server/ps/media-session.ps1`）。

**读不到时一律传 `null`，前端显示「—」，不编造数值。** 已知会读不到或可能读不到的：

| 字段 | 情况 | 降级方式 |
| --- | --- | --- |
| `cpu.temp` | 普通权限下 Windows 上的 CPU 温度传感器多数需要管理员权限或厂商驱动，`systeminformation` 常返回 null；WMI 的 `Win32_Processor.CurrentTemperature` 返回空，`MSAcpi_ThermalZoneTemperature` 普通权限报「拒绝访问」；**即使用管理员运行，也需要另装 LibreHardwareMonitor / HWiNFO64 并以其管理员服务提供 WMI/驱动数据** | 传 `null`，界面显示「—」；需要真实温度时安装 LibreHardwareMonitor（或 HWiNFO64）并以管理员运行其后台服务 |
| `gpu.power` | 仅在存在 `nvidia-smi` 时有值；非 NVIDIA 显卡一律为空 | 传 `null`，界面显示「—」 |
| `gpu.*` | 非 NVIDIA 机器上 `nvidia-smi` 不存在，退回 `systeminformation` 的 `graphics()`，此时通常只有型号与显存总量，占用/温度/频率为空 | 能读到的显示，读不到显示「—」 |
| `net.up` / `net.down` | 首次采样没有上一帧可对比，第一秒可能是 0；空闲时接近 0 是真实结果 | 第二次推送起为真实速率 |
| 网络累计流量 | 系统接口未提供真实的累计收发量 | 详情层不显示这一项，并在界面注明原因 |
| 应用图标 | 部分 Windows 商店应用 / UWP 快捷方式无法用 `ExtractAssociatedIcon` 提取 | 显示统一占位图标，不影响点击启动 |
| `running`（Steam 游戏） | 游戏没有可执行文件名可供匹配 | 返回 `null` 表示「未知」，界面不显示运行状态，不谎报「未运行」 |
| 媒体会话 | Windows SMTC 只覆盖注册了系统媒体会话的播放器；没有会话时读不到 | 显示「未在播放」，三个控制键置灰，**不回退到任何私有接口** |
| Steam 游戏 | 未安装 Steam，或游戏库目录读不到 | 游戏分组为空，软件分组照常 |

**可选的第三方对接方案**（本项目未实现，仅记录备查）：CPU 温度可用 HWiNFO64 的共享内存 + `HWiNFO Gadget` 读取，Open Hardware Monitor 也提供 WMI 接口。这两者都需要面板之外额外运行一个程序，属于超出本项目范围的做法。

---

## 常见问题

**平板打开是空白 / 一直转圈**
先在平板浏览器（不是 FreeKiosk）里访问 `http://<电脑IP>:5000/api/status`。
- 打不开 → Windows 防火墙没放行。见 [TABLET-SETUP.md](TABLET-SETUP.md) 的「Windows 防火墙放行」一节。
- 能打开 → 地址里的 IP 写错了，或者平板和电脑不在同一个 Wi-Fi（常见于路由器开了「访客网络」或「AP 隔离」）。

**启动报「端口 5000 已被占用」**
改 `config.json` 的 `port`（例如 `5050`），重启。平板地址跟着变成 `http://<电脑IP>:5050`。

**改完配置没反应**
`port` 和 `tabletWake*` 必须重启服务端。其余项在顶栏「设置」面板保存后立即生效；直接改文件的话仍然要重启。

**点应用 / 点电源提示「请先填入访问令牌」**
这是设计如此。复制 `config.json` 里的 `token`，点启动页底部「设置」，在访问令牌里填一次。

**点电源没反应 / 提示失败**
- 睡眠、注销、关机、重启依赖 Windows 账户权限，部分策略下会被拒绝，错误原因会原样显示在界面上。
- 关机与重启命令有 3 秒延迟（`shutdown /t 3`），这是系统命令本身的缓冲，不是面板卡住。

**监控页温度一直是「—」**
见上一节「读不到的字段」。需要装 LibreHardwareMonitor（或 HWiNFO64）并以管理员运行其后台服务，温度才会被读到。

**歌名是乱码 / 中文显示不对**
桌面版已在媒体桥接里把 PowerShell 输出强制为 UTF-8（`media-session.ps1`），中文歌名/歌手应正常显示。若仍乱码，确认 Windows 系统区域里的「Beta 版使用 UTF-8 提供全球语言支持」未干扰媒体进程，或重启面板服务。

**走势线不动**
走势线**只在本页可见时绘制**（需求 6.4）。停在监控页几秒即可看到线条长出来；切走就停止绘制。

**日志在哪**
`logs/YYYY-MM-DD.log`，按天切分，单文件超过 8 MB 追加序号，只保留最近 30 个文件。

**服务端崩了会怎样**
用 `start.bat` 或开机自启启动时会 5 秒后自动拉起（最多连续 20 次）。直接 `npm start` 没有守护。

---

## 说明

- 读不到的硬件或接口数据一律传 `null`，前端显示「—」，不编造数值。
- 监控页主视觉上的「同步率」是主题装饰数值，不对应任何真实硬件指标，代码与界面都注明了这一点。这是全站唯一的装饰数值。
- 只支持局域网访问，不做公网、云端中转、账号登录。
- 开机动画的 MAGI 表决区与日志区按屏幕方向分区排布（横屏左右、竖屏上下），日志区固定高度 + 内部滚动，**三个表决框与三枚印章全程不被遮挡**。
- 监控页月历卡面**只显示日期**（不显示节日 / 农历 / 节气），点开「详情」后的大日历才显示全部内容，并可切年 / 月。
- 监控页把原来重复的「总览小卡 + 硬件监控大卡」合并成一套：CPU / GPU / 内存 / 网络各只有一张卡，点开进同一份详情；时间、同步率、天气、日历、磁盘、风扇各只出现一次。横屏左边主图（时间 + 同步率）右边天气与日历、底部一排六张硬件卡；竖屏主图压矮、天气日历并排、硬件卡两行三列。
- 音乐控制走 Windows SMTC：上一首 / 播放暂停 / 下一首 3 个按钮，封面用系统媒体会话里的缩略图（没有就不显示，不编造）。点播放：有会话就真正播放、按钮跟随状态；没有会话就先启动网易云音乐，等它注册会话后自动接着播放。
- 风扇转速系统接口读不到（`systeminformation` 无风扇 API，WMI 的 `Win32_Fan` 只给设备名不给 RPM），卡片如实显示「—」并注明「系统接口未提供转速」，不编造数值。
- 启动页两栏（音乐 / 常用软件）**顶部对齐**；音乐封面盒子居中并占满卡片内部剩余高度，图片用 `object-fit:cover` 铺满不变形（没有 SMTC 缩略图时显示居中的音符占位，不编造封面）。
- 「＋ 添加常用」在**搜索框右侧**，搜索框相应缩短；常用软件卡上「启动」与「关闭」是两个分开的按钮，点「关闭」只关进程、不需要二次确认。
- 启动页**没有「常用软件 / FAVORITES」标题行**，常用软件直接从搜索框开始；常用列表为空时只留一条**紧凑条带**（一行提示，在常用软件列里**水平与垂直都居中**）。**「＋ 添加常用」全站只有搜索框右侧那一个按钮**。
- 竖屏启动页两块高度接近，**音乐卡比常用软件略小**（`0.92 : 1`）；音乐卡专辑封面放大居中显示，上一首 / 播放暂停 / 下一首**三个按钮完全等大**，只有中间那颗是红色；「未在播放」这类曲目 / 歌手文字与上面的「网易云音乐」标题**左对齐**（横竖屏一致）。
- 启动页底部一排 **5 个按钮**：锁屏 / 睡眠 / 重启 / 关机 / 设置。

## License

MIT
