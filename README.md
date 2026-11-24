# NERV Panel

EVA 明日香主题的局域网电脑监控面板。一台 Windows 电脑跑服务端（同时提供网页和 API），一台安卓平板在同一个 Wi-Fi 下用 **Fully Kiosk Browser** 全屏打开，长期插电当作常亮状态屏。

只走局域网，不做公网、不做云端中转、不做账号登录。

---

## 一条命令启动

前置：装好 [Node.js](https://nodejs.org/)（20 或更高版本，本项目在 v24.22.1 上开发）。

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

平板在 Fully Kiosk Browser 里填的就是这一行的地址。**平板要填电脑的局域网 IP，不能填 `localhost`。**

完整平板设置见 [TABLET-SETUP.md](TABLET-SETUP.md)。

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
| `zcool-qingke-huangyou-cn.woff2` | 中文（站酷庆科黄油体，简体全集） |
| `zcool-qingke-huangyou-latin.woff2` | 该中文字体的拉丁子集 |

来源：npm 包 `@fontsource/barlow-condensed`、`@fontsource/rajdhani`、`@fontsource/zcool-qingke-huangyou`，均以 devDependencies 安装后复制进 `public/assets/fonts/`，运行时不依赖 `node_modules`。加载失败时 CSS 里已声明回退链（`Barlow Condensed` → `Rajdhani` → `ZCOOL QingKe HuangYou` → `sans-serif`），不会掉回系统默认衬线字体。

---

## 配置

根目录唯一配置文件是 `config.json`。它不会随仓库发布（已写进 `.gitignore`），首次启动时若不存在会自动生成，模板见 `config.example.json`。

**改完配置要重启服务端才生效**（服务端启动时读取一次）。唯一的例外是系统页设置区保存的项，见下表。

| 字段 | 类型 | 默认值 | 说明 | 面板内可否改 |
| --- | --- | --- | --- | --- |
| `port` | int | `5000` | 服务端口，1–65535 | 可填，但需重启 |
| `token` | string | 自动生成 | 控制类接口的鉴权令牌。留空时启动自动生成 24 字节随机值并写回文件 | 需在面板内填写同一值，见下 |
| `weatherCity` | string | `合肥` | 天气城市，中文名直接写 | 可改，立即生效 |
| `weatherApiUrl` | string | `https://api.open-meteo.com/v1/forecast` | 天气接口地址，换源时改这里 | 否（改文件 + 重启） |
| `heroImagePath` | string | `assets/hero.jpg` | 主视觉图片，路径相对于 `public/` | 可改，保存后立即换图 |
| `refreshIntervalSec` | int | `1` | 数据刷新间隔（秒），1–60 | 可改，立即生效 |
| `tabletWakeEnabled` | boolean | `false` | 是否在服务端启动时唤醒平板屏幕 | 可改，下次启动生效 |
| `tabletWakeUrl` | string | 平板 IP 示例 | Fully Kiosk 远程管理接口地址 | 可改，下次启动生效 |
| `tabletWakePassword` | string | 空 | Fully Kiosk 远程管理密码 | 可改，下次启动生效 |

### Token 怎么用

`token` **不会**通过任何接口下发到前端（`/api/config` 只返回非敏感字段）。平板上需要手动填一次：

1. 用文本编辑器打开电脑上的 `config.json`，复制 `token` 的值。
2. 平板打开面板 → 系统页 → 设置 → 访问令牌 → 粘贴 → 保存设置。

令牌存在平板浏览器的 `localStorage` 里，之后启动应用、电源操作、系统操作都会自动带上 `X-NERV-Token` 头。

### 怎么换主视觉图片

1. 把新图放进 `public/assets/`，例如 `public/assets/hero2.jpg`。
2. `config.json` 里把 `heroImagePath` 改成 `assets/hero2.jpg`（相对 `public/` 的路径，不要写盘符）。
3. 重启服务端，或在平板系统页设置区改「主视觉图片路径」后保存，立即生效。

建议用**竖构图、人物居中偏右**的图：总览页的展示区域是竖长条，`object-position` 已设为 `68% 22%`，会把人物的头肩部分顶到画面里。图片宽高比与展示区差太多时，左右两侧会被裁掉。

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
│   ├── metrics.js               # 硬件采集（systeminformation + nvidia-smi）
│   ├── weather.js               # Open-Meteo 三件套（geocoding/forecast/air-quality）
│   ├── apps.js                  # 开始菜单 + Steam 库扫描、图标提取
│   ├── launcher.js              # 白名单启动（.lnk / steam://）
│   ├── power.js                 # 电源与系统操作白名单
│   ├── auth.js                  # Token 校验（timingSafeEqual）
│   └── wake.js                  # 平板唤醒（默认关闭）
├── public/                      # 前端（由 Express 直接托管）
│   ├── index.html               # 单页结构：开机动画 + 4 页 + 底部导航
│   ├── css/style.css            # EVA 主题、字体、动效、横竖屏适配
│   ├── js/app.js                # 翻页、导航、WebSocket、各页渲染
│   └── assets/                  # 主视觉图片与本地字体
├── scripts/
│   └── install-autostart.ps1    # 安装/卸载开机自启
├── TABLET-SETUP.md              # 平板端 Fully Kiosk Browser 完整设置
├── PROGRESS.md                  # 各阶段开发记录、读不到的字段与降级方式
└── logs/                        # 运行日志（自动生成，不入库）
```

---

## 开机自启

在项目根目录用 PowerShell 执行：

```powershell
.\scripts\install-autostart.ps1
```

它会在当前用户的启动文件夹
`%APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup`
里创建一个指向 `NERV-Panel.vbs` 的快捷方式。

原理：Windows 登录时会执行启动文件夹下的所有快捷方式 → 快捷方式调用 `NERV-Panel.vbs` → VBS 用 `WScript.Shell.Run(cmd, 0, False)` 以隐藏窗口方式启动 `start.bat` → `start.bat` 在 Node 进程异常退出时 5 秒后重新拉起（最多连续 20 次）。所以「开机自启」和「崩溃自动拉起」是同一套机制。

卸载：

```powershell
.\scripts\install-autostart.ps1 -Remove
```

不需要管理员权限（只写当前用户目录）。

---

## 接口一览

| 方法 | 路径 | 需要 Token | 说明 |
| --- | --- | --- | --- |
| GET | `/api/status` | 否 | 电脑名、局域网 IP、版本、在线状态、已运行秒数 |
| GET | `/api/config` | 否 | 非敏感配置（不含 token / 密码） |
| GET | `/api/metrics` | 否 | 当前硬件快照（WebSocket 不可用时的轮询降级通道） |
| WS | `/ws/metrics` | 否 | 每秒推送一次硬件数据 |
| GET | `/api/weather` | 否 | 配置城市当前天气 + 未来 3 天 |
| GET | `/api/apps` | 否 | 扫描到的可启动项目（`?refresh=1` 强制重扫） |
| GET | `/api/apps/:id/icon` | 否 | 项目图标 PNG，取不到返回 404 |
| POST | `/api/launch` | **是** | 启动项目，只接受列表内的 `id` |
| POST | `/api/power` | **是** | `shutdown` / `restart` / `sleep` / `lock` / `logout` |
| POST | `/api/system` | **是** | `display-off` / `taskmgr` |
| POST | `/api/settings` | **是** | 修改配置并写回 `config.json` |

Token 通过请求头 `X-NERV-Token` 传递（也接受请求体里的 `token` 字段）。缺失或错误一律 401 并返回明确错误码：`TOKEN_NOT_CONFIGURED` / `TOKEN_MISSING` / `TOKEN_INVALID`。

控制类接口的 `action` / `id` 白名单校验在**服务端做第二遍**（前端传什么都无法越权），且不接受任何前端传入的文件路径。

---

## 硬件数据来源与读不到的字段

**来源**：`systeminformation` 5.33.24 提供 CPU 占用/型号/频率/温度、内存、磁盘、网络、GPUs 列表；`nvidia-smi` 提供 NVIDIA 显卡的占用、温度、显存、频率、功耗。

**读不到时一律传 `null`，前端显示「—」，不编造数值。** 已知会读不到或可能读不到的：

| 字段 | 情况 | 降级方式 |
| --- | --- | --- |
| `cpu.temp` | 普通权限下 Windows 上的 CPU 温度传感器多数需要管理员权限或厂商驱动，`systeminformation` 常返回 `-1` | 传 `null`，界面显示「—」；需要真实温度时用**管理员身份**运行 `start.bat` 再试 |
| `gpu.power` | 仅在存在 `nvidia-smi` 时有值；非 NVIDIA 显卡一律为空 | 传 `null`，界面显示「—」 |
| `gpu.*` | 非 NVIDIA 机器上 `nvidia-smi` 不存在，退回 `systeminformation` 的 `graphics()`，此时通常只有型号与显存总量，占用/温度/频率为空 | 能读到的显示，读不到显示「—」 |
| `net.up` / `net.down` | 首次采样没有上一帧可对比，第一秒可能是 0 | 第二次推送起为真实速率 |
| 应用图标 | 部分 Windows 商店应用 / UWP 快捷方式无法用 `ExtractAssociatedIcon` 提取 | 显示统一占位图标，不影响点击启动 |
| Steam 游戏 | 未安装 Steam，或游戏库目录读不到 | 游戏分组为空，软件分组照常 |

**可选的第三方对接方案**（本项目未实现，仅记录备查）：CPU 温度可用 HWiNFO64 的共享内存 + `HWiNFO Gadget` 读取，Open Hardware Monitor 也提供 WMI 接口。这两者都需要面板之外额外运行一个程序，属于超出本项目范围的做法。

---

## 常见问题

**平板打开是空白 / 一直转圈**
先在平板浏览器（不是 Fully Kiosk）里访问 `http://<电脑IP>:5000/api/status`。
- 打不开 → Windows 防火墙没放行。见 [TABLET-SETUP.md](TABLET-SETUP.md) 的「Windows 防火墙放行」一节。
- 能打开 → 地址里的 IP 写错了，或者平板和电脑不在同一个 Wi-Fi（常见于路由器开了「访客网络」或「AP 隔离」）。

**启动报「端口 5000 已被占用」**
改 `config.json` 的 `port`（例如 `5050`），重启。平板地址跟着变成 `http://<电脑IP>:5050`。

**改完配置没反应**
`port` 和 `tabletWake*` 必须重启服务端。其余项在系统页保存后立即生效；直接改文件的话仍然要重启。

**点应用 / 点电源提示「请先填入访问令牌」**
这是设计如此。复制 `config.json` 里的 `token`，在系统页设置区填一次。

**点电源没反应 / 提示失败**
- 睡眠、注销、关机、重启依赖 Windows 账户权限，部分策略下会被拒绝，错误原因会原样显示在界面上。
- 关机与重启命令有 3 秒延迟（`shutdown /t 3`），这是系统命令本身的缓冲，不是面板卡住。

**硬件监控页温度一直是「—」**
见上一节「读不到的字段」。用管理员身份运行 `start.bat` 可以解决大部分情况。

**走势线不动**
走势线**只在本页可见时绘制**（需求 6.4）。切到硬件监控页停留几秒即可看到线条长出来；切走就停止绘制。

**日志在哪**
`logs/YYYY-MM-DD.log`，按天切分，单文件超过 8 MB 追加序号，只保留最近 30 个文件。

**服务端崩了会怎样**
用 `start.bat` 或开机自启启动时会 5 秒后自动拉起（最多连续 20 次）。直接 `npm start` 没有守护。

---

## 说明

- 读不到的硬件或接口数据一律传 `null`，前端显示「—」，不编造数值。
- 总览页的「同步率」是主题装饰数值，不对应任何真实硬件指标，代码与界面都注明了这一点。
- 只支持局域网访问，不做公网、云端中转、账号登录。
- 开机动画里 CASPER-3 的红色「否定」印章会被标题和日志部分遮挡，这是需求文档第 6.2 节明确记录并接受的表现，不作为缺陷处理。

## License

MIT
