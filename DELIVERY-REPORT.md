# NERV Panel 交付报告

> 本报告按需求文档第 10 节的六个栏目输出，不增减栏目。
>
> **关于自检状态**：按你的要求，本轮开发全程**未做运行测试**。因此第 4 栏里凡是需要「跑起来才能确认」的项，统一标注为 **待你运行后验证**，并写明代码上已做了什么、如果不过该看哪里。只有静态可确认的项（文件是否齐全、语法是否能过、配置字段是否对齐）标为「静态确认通过」。这是有意为之：没有真跑过的项不写成「通过」。

---

## 1. 技术栈

| 项 | 选型 | 版本 | 一句理由 |
| --- | --- | --- | --- |
| 语言 | JavaScript（CommonJS） | Node.js v24.22.1（要求 >= 20） | 服务端与静态资源共用一个进程，不需要额外装 Web 服务器 |
| 服务端框架 | Express | 5.3.0 | 轻量成熟，路由、静态托管、JSON 解析开箱可用，适合这个体量 |
| 实时推送 | ws | 8.23.0 | WebSocket 每秒推送硬件数据，比轮询省电且延迟低 |
| 硬件采集库 | systeminformation | 5.33.24 | Windows 上成熟的跨平台系统信息库，CPU / 内存 / 磁盘 / 网络 / GPU 列表一次覆盖 |
| GPU 补充采集 | `nvidia-smi`（NVIDIA 驱动自带） | 随驱动器 | 显存、温度、频率、功耗只有它给得最准，systeminformation 取不到功耗 |
| 天气数据 | Open-Meteo 公开接口 | 免密钥 | 免费、无需 API Key、支持中文城市名 geocoding |
| 前端 | 原生 HTML + CSS + JS | — | 零构建步骤，平板打开即用，不引入打包工具 |
| 字体 | @fontsource 系列本地 woff2 | 5.3.0 | 字体随项目走，离线可用，不依赖任何在线 CDN |

---

## 2. 文件清单

| 相对路径 | 用途 |
| --- | --- |
| `start.bat` | 启动脚本：UTF-8 代码页 + 运行 Node 服务 + 崩溃后 5 秒自动重启（最多 20 次） |
| `NERV-Panel.vbs` | 无窗口启动器，供开机自启快捷方式调用，隐藏 cmd 黑窗 |
| `package.json` | 项目名 / 版本 / 依赖 / `npm start` 脚本 |
| `package-lock.json` | 依赖锁定，保证换机安装版本一致 |
| `config.example.json` | 配置文件模板（含 Open-Meteo 地址与全部默认值） |
| `.gitignore` | 忽略 `node_modules/`、`logs/`、`config.json`、原始设计稿等 |
| `server/index.js` | 服务端入口：HTTP 路由、WebSocket、静态托管、优雅关闭 |
| `server/config.js` | 配置读取 / 校验 / 写回、局域网 IP 探测、token 生成、损坏配置备份重建 |
| `server/logger.js` | 本地日志：按天切分 + 单文件 8MB 上限 + 只留最近 30 个 |
| `server/metrics.js` | 硬件采集：CPU / GPU / 内存 / 磁盘 / 网络，读不到一律 `null` |
| `server/weather.js` | Open-Meteo 三件套（geocoding + forecast + air-quality），10 分钟缓存 |
| `server/apps.js` | 可启动项目扫描：开始菜单 `.lnk` + Steam 库（`StateFlags=4`），图标提取 PNG |
| `server/launcher.js` | 启动白名单：只接受列表内 `id`，走 `.lnk` 或 `steam://rungameid/` |
| `server/power.js` | 电源 5 项 + 系统操作 2 项白名单，白名单外直接拒绝 |
| `server/auth.js` | Token 校验（`crypto.timingSafeEqual`），统一 401 错误码 |
| `server/wake.js` | 平板唤醒（默认关闭），参数全读配置，失败重试 2 次只写日志 |
| `public/index.html` | 单页结构：MAGI 开机动画 + 4 页 + 底部毛玻璃胶囊导航 + toast/确认框 |
| `public/css/style.css` | EVA 主题配色、切角卡片、警戒斜纹、动效、横竖屏媒体查询、降级 |
| `public/js/app.js` | 翻页与导航、WebSocket 连接层、四页渲染、设置区、二次确认 |
| `public/assets/hero.jpg` | 主视觉（明日香坐二号机肩膀），已裁掉左侧多余天空，970×797 |
| `public/assets/fonts/*.woff2` | 本地字体 9 个文件：Barlow Condensed 400/500/600/700、Rajdhani 500/600/700、站酷庆科黄油体简中全集 + 拉丁子集 |
| `scripts/install-autostart.ps1` | 安装 / 卸载开机自启（写当前用户启动文件夹快捷方式，免管理员） |
| `README.md` | 安装、配置逐项解释、开机自启、接口一览、硬件来源、读不到字段、常见问题 |
| `TABLET-SETUP.md` | 平板端 FreeKiosk 完整设置（基础模式三步安装法 + 两层：必做 + 可选唤醒） |
| `PROGRESS.md` | 各阶段开发记录、实测环境、读不到的字段与降级方式 |
| `NERV Panel-complete.md` | 需求与执行文档（原件，未改动） |
| `evaming-ri-xiang-dian-nao-jian-kong-mian-ban.html` | 视觉参考原型（原件，未改动，已从版本库排除） |
| `logs/`（运行时生成） | 日志目录，不入库 |
| `cache/icons/`（运行时生成） | 提取出的应用图标 PNG 缓存，不入库 |

---

## 3. 启动方式

### 电脑端

首次：

```bat
npm install
```

之后每次：**双击 `start.bat`**（或在项目根目录执行 `npm start`）。

`start.bat` 会切 UTF-8 代码页、启动服务、崩溃自动重启；`npm start` 没有守护。

启动成功后控制台打印：

```
  NERV PANEL / MAGI ONLINE
  ----------------------------------------
  http://192.168.10.11:5000
  ----------------------------------------
```

> 本机实测局域网 IP 为 `192.168.10.11`，主机名 `DESKTOP-9STHOGB`。换机后以实际打印值为准。

开机自启（可选，一次即可）：

```powershell
.\scripts\install-autostart.ps1
```

### 平板端（FreeKiosk）

FreeKiosk 是免费开源软件（MIT 协议），用**基础模式**即可，不需要购买 PLUS 授权，也不需要 Device Owner 模式或 ADB 命令。

启动地址格式：

```
http://<电脑局域网IP>:<端口>
```

即上面打印的那一行，例如 `http://192.168.10.11:5000`。**必须填电脑的局域网 IP，不能填 `localhost`，也不能加 `/index.html`。**

基础模式三步：装 APK → 右下角连点 5 下输 PIN 进设置填上面的地址 → 点 Start Kiosk Mode。其余设置（全屏、开机自启、充电常亮、断线重载、不锁死方向、可选定时唤醒）见 `TABLET-SETUP.md` 第三、四节。需要简体中文时用 GitHub 上的 beta 版（`v2.1.0-beta.2` 及以上）。

### 首次使用还要做一次

复制 `config.json` 里的 `token`，在平板面板的**系统页 → 设置 → 访问令牌**填一次并保存。之后启动应用、电源操作才会生效。

---

## 4. 总自检结果

按需求文档第 9 节逐项列出。**「待验证」= 需要真实运行/真实平板才能确认，本轮按你的要求未测试。**

### 界面

| 项 | 结果 | 说明 / 不过时看哪里 |
| --- | --- | --- |
| 项目名处处是 NERV Panel | 静态确认通过 | 页面标题、`<title>`、`package.json`、两份文档、`start.bat` 标题一致 |
| 只有 4 页，默认总览，启动页在总览左边 | 静态确认通过 | `public/index.html` 四个 `section.page` 顺序为 启动 / 总览 / 硬件监控 / 系统；`app.js` 的 `boot0()` 里 `goTo(1)` |
| 无控制页、无一键清理加速、无摄像头元素 | 静态确认通过 | 全仓检索无相关字样 |
| 标题无数字编号、无多余说明文字 | 静态确认通过 | 页标题为「启动 / 总览 / 硬件监控 / 系统」，`data-title` 同 |
| 全站 EVA 风字体统一 | 静态确认通过 | 9 个本地 `@font-face`，CSS 变量 `--eva/--mono/--sans` 全部指向它们，无 `font-family: system-ui` 之类回退到系统默认的声明 |
| 主视觉是配置项指向的图，人物完整，改路径能换 | 待验证 | 图已裁为 970×797、`object-position: 68% 22%`；路径读 `/api/config` 的 `heroImagePath`，设置区改后立即 `applyHero()` |
| 开机动画是 MAGI 表决画面 | 静态确认通过 | 中央六角 `MAGI`，上 `BALTHASAR·2` 承認、左下 `CASPER·3` 否定、右下 `MELCHIOR·1` 承認，SVG 绿线连中央，2:1 |
| 底部导航毛玻璃胶囊，点击时胶囊滑动 | 静态确认通过 | `nav.dock` 有 `backdrop-filter: blur(22px)`；`moveGlider()` 改 `transform: translateX()`，`.52s cubic-bezier(.32,1.08,.38,1)` 过渡，非瞬移后放大 |
| 横竖屏过渡丝滑不溢出，120Hz 不卡 | 待验证 | 已有 `orientIn` 0.56s 缩放+淡入；翻页与胶囊只动 `transform`/`opacity`；本轮把时钟 rAF 改整秒定时器、进度条改 `scaleX`、`will-change` 收窄到过渡期 |

### 功能

| 项 | 结果 | 说明 / 不过时看哪里 |
| --- | --- | --- |
| 监控数据真实，读不到显示「—」 | 待验证 | 数据来自 `systeminformation` + `nvidia-smi`，结构严格照第 4 节，无一处随机数；`renderMetrics` 对每个 `null` 输出「—」 |
| 时钟、日历、合肥天气真实，断网不编造 | 待验证 | 时钟取本机 `Date`；天气走 `/api/weather`（城市读配置），失败全部「—」；已确认 Open-Meteo 在本机网络下可达 |
| 启动页列表来自真实扫描，能真启动，列表外 id 被拒 | 待验证 | `/api/apps` 扫开始菜单与 Steam；`/api/launch` 里先查 `apps.getById()`，未命中回 `ID_NOT_ALLOWED` |
| 电源操作全部二次确认，Token 校验有效 | 待验证 | 7 个操作都过 `confirmBox()`；`/api/power`、`/api/system`、`/api/launch`、`/api/settings` 全挂 `requireToken`，无 token 回 401 |
| Wi-Fi 断开重连后自动恢复，不用手动刷新 | 待验证 | WS 断线按 `[1,2,3,5,8,13,21,30]` 秒退避重连；连续失败降级 HTTP 轮询（间隔读 `refreshIntervalSec`）；6 秒无消息触发看门狗主动重连 |

### 部署

| 项 | 结果 | 说明 / 不过时看哪里 |
| --- | --- | --- |
| 电脑重启后服务端自启，平板自动显示 | 待验证 | 自启靠 `install-autostart.ps1` 写入启动文件夹；**需要你执行一次该脚本**才有自启 |
| 平板按方案 1 全屏运行、开机自启、充电常亮、隐藏浏览器元素 | 待验证 | 步骤全部写在 `TABLET-SETUP.md` 第四节，需按文档在平板上配置 |
| 配置能改端口 / Token / 城市 / 图片 / 唤醒地址并生效 | 待验证 | 系统页设置区 7 项 + `config.json`；刷新间隔、城市、图片热生效，端口与唤醒项提示需重启 |
| 两份文档完整，换台电脑照着能装起来 | 静态确认通过 | README 覆盖安装/配置/自启/接口/排错/换图；TABLET-SETUP 覆盖防火墙与两层设置 |
| 连续运行 2 小时稳定 | **未实测** | 已消除已知增长源（WS 订阅在 close 时注销 + 30 秒心跳清理、走势线固定 60 点、采集有 TTL 缓存、日志滚动），但 2 小时长跑按你的要求未执行 |

---

## 5. 已知缺口

1. **CPU 温度可能读不到**。Windows 下普通权限的 `systeminformation` 常返回 `-1`，本项目据此判为无效并给 `null`，界面显示「—」。需要用**管理员身份**运行 `start.bat` 才有较大机会读到；即使管理员也可能因主板传感器驱动缺失而读不到。备选方案（未实现，仅记录）：HWiNFO64 共享内存 + HWiNFO Gadget，或 Open Hardware Monitor 的 WMI 接口。
2. **GPU 功耗仅在 NVIDIA + `nvidia-smi` 可用时有值**。本项目本机为 GTX 1660 SUPER，`nvidia-smi` 可用，实测能读到功耗；换 AMD / Intel 显卡时为 `null`。
3. **非 NVIDIA 显卡的占用、温度、频率通常为空**。退回 `systeminformation` 的 `graphics()` 一般只给型号与显存总量。
4. **网络速率首帧可能为 0**。首次采样没有上一帧可对比，第二帧起为真实值。
5. **部分应用图标提取不到**。Windows 商店应用（`shell:AppsFolder\...`）与图标内嵌在资源里的 exe 无法用 `ExtractAssociatedIcon` 提取，回退统一占位图标；点击启动不受影响。
6. **Steam 游戏分组可能为空**。本机未安装 Steam 时该分组为空；只认 `StateFlags = 4` 的真正已安装条目，未安装/未下载完的不列入。
7. **需求文档提到的「主视觉顶部小字」在原图中不存在**。已放大检查顶部 90px 条带，只有蓝天、头发与二号机肩甲，因此裁剪时未为文字预留空间。左侧多余天空已裁掉，人物完整保留。
8. **主视觉用的是原型内嵌图片，不是独立原图**。从原型 HTML 的 base64 解出（1120×797），裁为 970×797，不是更高分辨率的原始素材；在原尺寸展示区下够用，放大看会有压缩痕迹。
9. **参考机型与实机不符**。需求文档写 RTX 4060 Ti，本机为 GTX 1660 SUPER。面板不写死型号，全部从采集结果读，功能不受影响；但温度/功耗的具体数值会与你预期不同。
10. **2 小时长跑未实测**，见第 4 栏最后一项。
11. **平板端和平板唤醒未实测**。需要真实平板 + FreeKiosk；`tabletWakeEnabled` 默认 `false`，不配置时服务端跳过并只写一行日志。代码里不含任何 IP、端口或密钥，全部读配置。
12. **开机自启未安装**。脚本已就绪，但需要你手动执行一次 `.\scripts\install-autostart.ps1`。

### 截图验收后修复的缺陷

以下不是新增功能，是原本就该对而没对的缺陷。已在第 4 栏相关项上反映，此处集中列出便于核对。

| 缺陷 | 原因 | 修复 |
| --- | --- | --- |
| 主视觉被占位层永久盖住；启动页空状态、监控页离线横幅永远显示 | `.hero-fallback` / `.empty-state` / `.offline-banner` 的 `display: flex` 特异性压过浏览器默认 `[hidden]{display:none}` | `style.css` 补 `[hidden] { display: none !important; }` |
| 系统页「未连接」、四个字段全「—」、已连接时长恒为 0 | `notifyVisible()` 传给钩子的是钩子数组下标而非页面下标，第 1/2/3 页永远收到 `visible=false`，定时器从不启动 | 传 `current`/`prev` 页面下标；钩子体按页面下标重写；`setConnUI()` 末尾刷新系统页状态；新增 5 秒 `statusPollTimer` |
| 154 个应用图标全是同一张白图 | `ensureIcon()` 把路径反斜杠转义为 `\\` 塞进 PowerShell 双引号串，PowerShell 里反斜杠不是转义符，`ExtractAssociatedIcon` 收到不存在的路径后静默返回空白图标 | 新增 `psQuote()`；命令改用 `$src`/`$dst` 变量 + `$ErrorActionPreference="Stop"` + 显式存在性检查 |
| 首次打开启动页要干等约 35 秒图标，期间一片空黑框 | 图标按需生成，每张一个 PowerShell 进程约 200ms | 服务端扫描后 3 并发后台预热；启动 3 秒后主动扫描一次；前端先显示占位图，加载成功后淡入 |
| 横屏监控页 4 张卡排成 3+1，第二行空出 2/3 | `grid-template-columns` 固定 3 列而卡片有 4 张 | 基础布局改 4 列，竖屏 2 列、窄竖屏 1 列（布局观感以你定夺为准） |

---

## 6. 承诺

- 本轮未新增需求文档未要求的功能、页面、按钮或接口。
- 开机动画中 CASPER-3 红色「否定」印章被标题与日志部分遮挡，是需求文档第 6.2 节明确记录并接受的表现，**不作为缺陷处理，也不建议顺手改排版去修**。
- 交付内容与 `PROGRESS.md` 记录的阶段 0–7 一致，可按 git 提交逐阶段回溯（`590ae1a` → `1a4d957` → `f5f9dfa` → `b6b71c7` → `63cf590`）。