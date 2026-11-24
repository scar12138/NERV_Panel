# NERV Panel 交付报告

> 本报告按需求文档第 10 节的六个栏目输出，不增减栏目。
>
> **关于自检状态**：按你的要求，本轮开发全程**未做运行测试**。因此第 4 栏里凡是需要「跑起来才能确认」的项，统一标注为 **待你运行后验证**，并写明代码上已做了什么、如果不过该看哪里。只有静态可确认的项（文件是否齐全、语法是否能过、配置字段是否对齐、结构是否存在）标为「静态确认通过」。这是有意为之：没有真跑过的项不写成「通过」。

---

## 1. 技术栈

| 项 | 选型 | 版本 | 一句理由 |
| --- | --- | --- | --- |
| 语言 | JavaScript（CommonJS） | Node.js v24.22.1（要求 >= 20） | 服务端与静态资源共用一个进程，不需要额外装 Web 服务器 |
| 服务端框架 | Express | 5.3.0 | 轻量成熟，路由、静态托管、JSON 解析开箱可用，适合这个体量 |
| 实时推送 | ws | 8.23.0 | WebSocket 每秒推送硬件数据，比轮询省电且延迟低 |
| 硬件采集库 | systeminformation | 5.33.24 | Windows 上成熟的跨平台系统信息库，CPU / 内存 / 磁盘 / 网络 / GPU 列表一次覆盖 |
| GPU 补充采集 | `nvidia-smi`（NVIDIA 驱动自带） | 随驱动器 | 显存、温度、频率、功耗只有它给得最准，systeminformation 取不到功耗 |
| 媒体会话 | Windows SMTC（WinRT，经 PowerShell 调用） | 系统自带 | 系统级媒体控制接口，能拿到任意播放器的歌名/歌手并控制播放，不必对接各家私有接口 |
| 网卡速率 | `Get-NetAdapterStatistics`（常驻 PowerShell） | 系统自带 | 只读累计字节，Node 侧做差值，避免 systeminformation 每次查询起子进程的秒级开销 |
| 进程管理 | `tasklist` / `taskkill`（系统命令） | 系统自带 | 判断应用是否在跑、按进程名正常关闭，都是系统原生能力 |
| 编码转换 | iconv-lite | 0.7.3 | 修复开始菜单里被按 GBK 误解码的乱码快捷方式名 |
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
| `.gitignore` | 忽略 `node_modules/`、`logs/`、`cache/`、`data/hero/`、`config.json` |
| `server/index.js` | 服务端入口：HTTP 路由、WebSocket、静态托管、优雅关闭 |
| `server/config.js` | 配置读取 / 校验 / 写回、局域网 IP 探测、token 生成、旧配置迁移、损坏配置备份重建 |
| `server/logger.js` | 本地日志：按天切分 + 单文件 8MB 上限 + 只留最近 30 个 |
| `server/metrics.js` | 硬件采集：CPU / GPU / 内存 / 磁盘 / 网络 + 每核心占用 + 12 分钟历史缓冲 |
| `server/netwatch.js` | 常驻子进程读网卡累计字节，按两次采样差值算实时速率 |
| `server/media.js` | Windows 系统媒体会话（SMTC）的 Node 封装：常驻轮询 + 一次性控制 |
| `server/weather.js` | Open-Meteo 三件套（geocoding + forecast + air-quality），10 分钟缓存 |
| `server/apps.js` | 可启动项目扫描：开始菜单 `.lnk` + Steam 库（`StateFlags=4`），图标提取 PNG、运行状态、关闭应用 |
| `server/procs.js` | `tasklist` 进程表缓存（5 秒）、按进程名正常关闭 |
| `server/favorites.js` | 常用软件增删与解析（读写 `favoriteAppIds`） |
| `server/hero.js` | 主视觉图片上传：魔数校验、独立存储、不覆盖默认图 |
| `server/launcher.js` | 启动白名单：只接受列表内 `id`，走 `.lnk` 或 `steam://rungameid/` |
| `server/power.js` | 电源 5 项 + 系统操作 2 项白名单，白名单外直接拒绝 |
| `server/auth.js` | Token 校验（`crypto.timingSafeEqual`），统一 401 错误码 |
| `server/wake.js` | 平板唤醒（默认关闭），参数全读配置，失败重试 2 次只写日志 |
| `server/ps/net-counters.ps1` | 常驻脚本：每秒输出各物理网卡的累计收发字节 |
| `server/ps/media-session.ps1` | 常驻脚本：读取 / 控制 Windows 系统媒体会话 |
| `public/index.html` | 单页结构：MAGI 开机动画 + 2 页（监控 / 启动）+ 顶栏切换与设置按钮 + 详情层 + 挑选层 + 设置面板 |
| `public/css/style.css` | EVA 主题配色、切角卡片、警戒斜纹、按钮动效、横竖屏媒体查询、降级 |
| `public/js/app.js` | 翻页与胶囊、WebSocket 连接层、指标渲染、8 类详情层、启动页（常用/搜索/音乐）+ 设置面板开关 |
| `public/assets/hero.jpg` | 默认主视觉（明日香坐二号机肩膀），已裁掉左侧多余天空，970×797 |
| `public/assets/fonts/*.woff2` | 本地字体 11 个文件：Barlow Condensed 400/500/600/700、Rajdhani 500/600/700、Noto Sans SC 400/700 各含拉丁子集与中文全集 |
| `scripts/install-autostart.ps1` | 安装 / 卸载开机自启（写当前用户启动文件夹快捷方式，免管理员） |
| `scripts/shoot.js` | 开发期截图工具（无头 Edge + CDP），按平板真实分辨率截两方向各页 |
| `scripts/diag-hero.js` | 开发期诊断脚本：检查主视觉加载状态 |
| `scripts/diag-scroll.js` | 开发期诊断脚本：检查各页滚动高度与关键按钮可见性 |
| `scripts/diag-flow.js` | 开发期诊断脚本：逐页核对「一屏不滚动」——比较 `.page` / `.page-in` 的 `scrollHeight` 与 `clientHeight`，并检查常用软件滚动容器与底部按钮位置 |
| `README.md` | 安装、配置逐项解释、开机自启、接口一览、硬件来源、读不到字段、常见问题 |
| `TABLET-SETUP.md` | 平板端 FreeKiosk 完整设置（基础模式三步安装法 + 两层：必做 + 可选唤醒） |
| `PROGRESS.md` | 各阶段开发记录、实测环境、v3 改版记录、读不到的字段与降级方式 |
| `DELIVERY-REPORT.md` | 本报告 |
| `NERV Panel-complete.md` | 需求与执行文档（原件，未改动） |
| `NERV Panel.html` | 视觉与交互参考原型（原件，未改动） |
| `logs/`（运行时生成） | 日志目录，不入库 |
| `cache/icons/`（运行时生成） | 提取出的应用图标 PNG 缓存，不入库 |
| `data/hero/`（运行时生成） | 用户更换的主视觉图片，不入库 |

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

复制 `config.json` 里的 `token`，在平板面板的**启动页 → 设置 → 访问令牌**填一次并保存。之后启动应用、关闭应用、电源操作、常用软件增删才会生效。

---

## 4. 总自检结果

按需求文档第 9 节逐项列出。**「待验证」= 需要真实运行/真实平板才能确认，本轮按你的要求未测试。**

### 界面

| 项 | 结果 | 说明 / 不过时看哪里 |
| --- | --- | --- |
| 项目名处处是 NERV Panel | 静态确认通过 | `<title>`、页面品牌标牌、`package.json` 的 `name`、四份文档一致 |
| 只有 2 页：监控、启动；监控是第一页且默认打开 | 静态确认通过 | `public/index.html` 只有 2 个 `section.page`，顺序为监控 / 启动；`app.js` 的 `boot0()` 里 `goTo(0)`，`current` 初值 0 |
| 无控制页、无一键清理加速、无摄像头元素 | 静态确认通过 | 全仓检索无「清理」「加速」「摄像头」「camera」相关实现与元素 |
| 标题无数字编号、无多余说明文字 | 静态确认通过 | 页标题为「监控 / 启动」，`data-title` 同；原型里的 `page-note` 解释段落、`.steps` 步骤卡、`.flow` 数据流图均已删除 |
| 字体按第 6.1 节执行 | 静态确认通过 | 英文/数字 Barlow Condensed / Rajdhani；中文正文 Noto Sans SC（回退 PingFang SC / Microsoft YaHei）；**ZCOOL 已彻底移除**（字体文件与 `--eva-title` 变量均已删除），不存在正文用 ZCOOL 的情况 |
| 中文无缺字、无重叠、无方框 | 待验证 | 已删掉缺字严重的 ZCOOL 并改用 Noto Sans SC 全集（1.1 MB/字重）。截图逐张看过两方向三界面，未发现缺字/方框；实际平板仍需你核一遍 |
| 主视觉默认是明日香图片、人物完整；更换主图立即生效、刷新重启仍是新图、默认图未被覆盖 | 待验证 | 接口层已实测：上传真实 PNG 返回 `customHeroImagePath`，`config.json` 正确写回，`heroImagePath` 保持不变；上传非图片被 `BAD_TYPE` 拒绝。前端 `#heroPickBtn` 打开本地文件选择器（不是手填路径框） |
| 开机动画是 MAGI 依次表决，CASPER-3 先否定后翻转承認，三台全承認后上滑退场 | 静态确认通过 | `voteSteps` 定时：500ms MELCHIOR 承認 → 1250ms BALTHASAR 承認 → 2000ms CASPER 红色否定+呼吸 → 3050ms CASPER 翻转成承認 + 中央核心全亮；`.vote-box:not(.lit)` 首帧绝无「承認」；`#boot.done{transform:translateY(-102%)}` 是上滑不是淡出；**无进入按钮** |
| 顶栏分开机与主界面两种 | 静态确认通过 | 开机顶栏三格 `NERV HQ · MAGI SYSTEM` / `● REC` / `EVA-02`；主界面顶栏左侧只有 `.mark` NERV 红色标牌 + `EVA-02`，无「电脑监控面板」、无 `PC MONITOR DECK · UNIT-02` |
| 开机界面没有大字标题组 | 静态确认通过 | 大字 NERV 标牌、`EVA-02` 大字、「明日香 · 指挥面板」、`PC MONITOR SYSTEM` 行、「系统启动中...」、「EVA-02，启动！」按钮全部不存在于 `index.html` |
| 切换按钮在主界面右上角，只有监控/启动 2 个 | 静态确认通过 | `header.top .conn` 内 `.page-switch` 有 2 个 `button[data-page]`；点击走 `goTo()`；底部无 Dock、无底部导航、无 Home 小横条（`nav.dock` / `.dock-glider` / `.home-bar` 已全部删除） |
| 页码点只有 2 个菱形 | 静态确认通过 | `#dots` 内写死 2 个 `button`，各含一个 `<i>` 菱形 |
| 高亮胶囊滑动有动画 | 静态确认通过 | `movePsInd()` 设 `transform: translate3d(b.offsetLeft,0,0)` + `width`；`.ps-ind` 过渡 `.3s cubic-bezier(.22,1,.36,1)`；`.page-switch.has-ind button.on{background:transparent}` 确保只有一颗胶囊在滑，不是两个高亮靠显隐 |
| 按钮动效齐全（第 6.5 节） | 静态确认通过 | 统一 `transition: transform .38s cubic-bezier(.34,1.56,.64,1)`；`:active{transform:scale(.93) translateY(1px)}` 且 `transition-duration:.07s`（按下 80–120ms）；松开走回弹曲线；置灰按钮 `transform:none!important`；`.pwr`/`.music-head button`/`.save-btn` 有 `::after` 扫光；`.app.busy`/`.mctrl button.busy` 呼吸脉动；`#playIcon.swapping` 淡出缩放 200ms 后换图标；`#modal.open .modal-box` 有 `modalIn` 缩放淡入 |
| 整页不滚动：横竖屏的监控页与启动页所有控件同屏可见 | 静态确认通过（DOM 实测） | `.page{overflow:hidden}`，`.page-in{height:100%;min-height:0}`；尺寸全部走 `clamp(...vh...)`。`scripts/diag-flow.js` 实测横竖屏 × 两页 `.page` 与 `.page-in` 的 `scrollHeight - clientHeight` 均为 0；只有详情层 / 挑选层 / 设置面板与常用软件小容器内部可滚动 |
| 监控页不再分总览与硬件监控两段，同一指标全站只出现一次 | 静态确认通过 | 原 `#miniCpu` / `#miniGpu` / `#miniRam` / `#miniNet` 四张小卡与 `.mon-grid` 大卡已删除（HTML 无 `miniCpu`/`mon-grid`，CSS 无 `.mon-grid`/`.mini-grid`/`.util-row`）。现为 `.hw-row` 六张卡：CPU / GPU / 内存 / 网络 / 磁盘 / 风扇，各一张；时间与同步率在主视觉内、天气与日历各一张。`data-detail` 仍覆盖 8 类 |
| 横屏监控页左主图右天气日历、底部一排硬件卡；竖屏主图压矮 + 紧凑网格 | 静态确认通过（DOM 实测） | 横屏 `.mon-top` 1.55fr/1fr、`.hw-row` 六列；竖屏 `.mon-top` 单列（0.8fr/1fr）、`.hw-row` 三列两行。实测竖屏 `hwRow` bottom 1268 / 视口 1280，横屏 788 / 视口 800 |
| 启动页横屏音乐左、常用软件右；竖屏上下紧凑；均一屏 | 静态确认通过（DOM 实测） | `.launch-grid` 横屏两列，实测 `musicCol w=553`（左）/ `appsCol w=670`（右），高度同为 586；竖屏单列音乐在上、常用软件在下。`.app-scroll` 是唯一内部滚动容器 |
| 系统按钮在页面最下方一排，空间不够时次要项收进设置面板且功能不删 | 静态确认通过 | `.power-row` 七列一排：锁屏 / 注销 / 睡眠 / 重启 / 关机 / 熄灭显示器 / 任务管理器，位于 `.page-launch` 末尾。窄屏与矮屏压缩档里次要三项同时保留在设置面板的「更多系统操作」（`#logoutBtn2` / `#displayOffBtn2` / `#taskMgrBtn2`） |
| 全站只有一个设置入口（顶栏右上角「设置」按钮），页面上无平铺设置字段 | 静态确认通过 | `#settingsBtn` 在 `header.top .conn` 内；`#settingsSheet` 承载连接状态 5 项 + 7 个设置字段 + 唤醒开关 + 保存 + 更多系统操作。启动页原平铺的 `.conn-grid` 与 `.set-grid` 已从页面删除，`app.js` 的 `focusSetup()` 改为 `openSettings()` |
| 横竖屏旋转过渡丝滑不溢出，120Hz 不卡 | 待验证 | `orientIn` 0.56s 缩放+淡入；翻页/胶囊/开机只动 `transform`/`opacity`；时钟改整秒定时器（非 rAF）；进度条改 `scaleX`（不触发重排）；`will-change` 只在 `body.orienting` 期间生效；`.boot-log` 固定高度内部滚动，横竖屏都不溢出 |

### 功能

| 项 | 结果 | 说明 / 不过时看哪里 |
| --- | --- | --- |
| 监控数据真实，读不到显示「—」 | 静态确认通过（数据实测） | 实测 `/api/metrics` 返回真实值：CPU i5-12400F 占用/频率 2500MHz、GPU GTX 1660 SUPER 29°C 1.5/6.0 GB、内存 92%、磁盘 C/D/E 三块、网络速率；`renderMetrics` 对每个 `null` 输出「—」；无一处随机数（同步率除外，见第 5 栏第 12 条） |
| 8 类卡片都能点进详情，含完整数值+走势+最高/最低/平均，打开时实时刷新，不新增页面 | 静态确认通过 | `data-detail` 覆盖 time / weather / calendar / cpu / gpu / ram / net / disk 八类；`#detailSheet` 是监控页内的浮层不是新页面；`detailTimer` 1 秒重渲染，`refreshDetailLive()` 只改文本不重建 DOM |
| 时钟、日历、合肥天气真实，断网不编造 | 静态确认通过（天气实测） | `/api/weather` 实测返回 `{"city":"合肥","desc":"晴","temp":12,"feels":9,"humidity":48,"windDir":"北风","windLevel":1,"air":"中度污染","days":[4 天]}`；任一字段缺失或整体失败都落到全「—」 |
| 启动页默认只显示常用，不铺满全部；添加/移除重启后生效 | 静态确认通过 | 默认只调 `GET /api/favorites`（实测空态返回 `[]`）；全量 `GET /api/apps` 只在挑选层与搜索时调；`favoriteAppIds` 落盘到 `config.json` |
| 软件控制真实：能启动、能关闭运行中的应用，列表外 id 被拒 | 静态确认通过（拒绝路径实测） | `POST /api/launch` 与 `POST /api/close-app` 均查 `apps.getById()`；实测白名单外 id 返回 `ID_NOT_ALLOWED`「这个项目不在可启动列表里」；关闭用 `taskkill /IM <name> /T`（不带 `/F`，先发 WM_CLOSE） |
| 音乐卡片真实：真实歌名/歌手，三键走 SMTC，无会话显示「—」，不调私有接口 | 静态确认通过（无会话路径实测） | SMTC 接口实测 `{"ok":true,"available":false,"isPlaying":false,"title":null,"artist":null}`（本机当前无播放）；`POST /api/media/control` 实测返回 `NO_SESSION`；代码只调 `TrySkipPreviousAsync`/`TryTogglePlayPauseAsync`/`TrySkipNextAsync`，无任何网易云私有接口 |
| 系统控制齐全：5 电源全二次确认、2 系统操作真实执行、Token 有效 | 静态确认通过（拒绝路径实测） | 5 个 `.pwr` 都过 `confirmBox()`；`displayOff`/`taskManager` 按需求不二次确认；实测无 token → 401 `TOKEN_MISSING`、错误 token → 401 `TOKEN_INVALID`、`formatC` → `ACTION_NOT_ALLOWED` |
| Wi-Fi 断开重连后自动恢复 | 待验证 | WS 断线按 `[1,2,3,5,8,13,21,30]` 秒退避重连；连续失败降级 HTTP 轮询（间隔读 `refreshIntervalSec`）；6 秒无消息看门狗主动重连 |

### 部署

| 项 | 结果 | 说明 / 不过时看哪里 |
| --- | --- | --- |
| 电脑重启后服务端自启，平板自动显示面板 | 待验证 | 自启靠 `install-autostart.ps1` 写入启动文件夹；**需要你执行一次该脚本**才有自启；平板侧靠 FreeKiosk 的 Auto-start on Boot |
| 平板用 FreeKiosk 基础模式全屏运行，开机自启、充电常亮、断线重载、隐藏浏览器元素 | 待验证 | 步骤全部写在 `TABLET-SETUP.md` 第三、四节；明确不需要 Device Owner / ADB / PLUS；中文需 beta 版 |
| 配置能改端口 / Token / 城市 / 图片路径（含 `customHeroImagePath`）/ 唤醒地址 / `favoriteAppIds` 并生效 | 静态确认通过（部分实测） | `/api/config` 实测下发 8 个非敏感项（不含 token）；`POST /api/settings` 白名单含上述全部；上传主图实测写回成功；刷新间隔改变会热重建采样定时器 |
| `README.md` 和 `TABLET-SETUP.md` 完整，换台电脑照着能装起来 | 静态确认通过 | README 覆盖安装/配置/自启/接口/排错/换图/新增的 FreeKiosk 一节；TABLET-SETUP 覆盖防火墙与两层设置，含 REST API 8080 + `X-Api-Key` |
| 连续运行 2 小时稳定 | **未实测** | 已消除已知增长源（WS 订阅 close 时注销 + 30 秒心跳清理、走势线固定 60 点、服务端历史 12 分钟按时间淘汰、采集有 TTL 缓存、常驻子进程退避重启、日志滚动），但 2 小时长跑按你的要求未执行 |

---

## 5. 已知缺口

1. **CPU 温度读不到**。两条 WMI 路径都试过：`Win32_Processor.CurrentTemperature` 返回空值；`root/wmi:MSAcpi_ThermalZoneTemperature` 普通权限报「拒绝访问」。因此 `cpu.temp` 为 `null`，界面显示「—」。备选方案（未实现，仅记录）：以管理员身份运行 `start.bat`、HWiNFO64 共享内存 + HWiNFO Gadget、Open Hardware Monitor 的 WMI 接口。
2. **GPU 功耗仅在 NVIDIA + `nvidia-smi` 可用时有值**。本机为 GTX 1660 SUPER，实测能读到；换 AMD / Intel 显卡时为 `null`。
3. **非 NVIDIA 显卡的占用、温度、频率通常为空**。退回 `systeminformation` 的 `graphics()` 一般只给型号与显存总量。
4. **网络首帧可能为 0**。首次采样没有上一帧可对比，第二帧起为真实值。已实测：空闲时接近 0 是真实结果，制造流量后能正确反映。
5. **网络累计流量不显示**。系统接口未提供真实的累计收发量，按降级处理不在详情里画这一项，界面已注明原因。
6. **媒体会话依赖 Windows SMTC**。能读到才显示，读不到就显示「未在播放」。部分老播放器不注册 SMTC 时控件会置灰；此时不 fallback 到私有接口（需求明确禁止）。
7. **Steam 游戏不显示运行状态**。游戏没有可执行文件名可供匹配，`running` 返回 `null` 表示「未知」，不谎报「未运行」。本机未装 Steam，游戏分组为 0 项，此路径未在真实游戏上验证。
8. **部分应用图标提取不到**。Windows 商店应用（`shell:AppsFolder\...`）与图标内嵌在资源里的 exe 无法用 `ExtractAssociatedIcon` 提取，回退统一占位图标；点击启动不受影响。
9. **开始菜单条目经过过滤**。卸载/激活/注册/诊断/教程/示例/日志/配置等非启动用途的快捷方式被 `JUNK` 正则排除，本机从 154 项减到 126 项。若你认为某项被误删，可调整 `server/apps.js` 的 `JUNK`。
10. **需求文档提到的「主视觉顶部小字」在原图中不存在**。已放大检查顶部 90px 条带，只有蓝天、头发与二号机肩甲，因此裁剪时未为文字预留空间。左侧多余天空已裁掉，人物完整保留。
11. **主视觉用的是原型内嵌图片，不是独立原图**。从原型 HTML 的 base64 解出（1120×797），裁为 970×797，不是更高分辨率的原始素材；放大看会有压缩痕迹。
12. **同步率是主题装饰数值**。按需求 5.2 的明确例外，它是主题装饰、不对应任何真实硬件指标，代码注释与 README 均已注明。除此之外全站无随机数。
13. **参考机型与实机不符**。需求文档写 RTX 4060 Ti，本机为 GTX 1660 SUPER。面板不写死型号，全部从采集结果读，功能不受影响；温度/功耗的具体数值会与你预期不同。
14. **2 小时长跑未实测**，见第 4 栏最后一项。
15. **平板端和平板唤醒未实测**。需要真实平板 + FreeKiosk；`tabletWakeEnabled` 默认 `false`，不配置时服务端跳过并只写一行日志。代码里不含任何 IP、端口或密钥，全部读配置。
16. **开机自启未安装**。脚本已就绪，但需要你手动执行一次 `.\scripts\install-autostart.ps1`。
17. **风扇转速读不到**。`systeminformation@5.33.24` 没有风扇 API（60 个导出里只有 `cpuTemperature` 与温度相关）；`Win32_Fan` WMI 能返回两个 Cooling Device 但 `DesiredSpeed` 为空；`root/wmi:MSAcpi_ThermalZoneTemperature` 普通权限报「拒绝访问」；`root/OpenHardwareMonitor` 命名空间不存在（未装 OHM）。风扇卡因此显示「—」并注明「系统接口未提供转速」，不编造 RPM。可选方案（未实现）：装 Open Hardware Monitor 或 HWiNFO64 后用其 WMI / 共享内存接口。

---

## 6. 承诺

- 本轮未新增需求文档未要求的功能、页面、按钮或接口。原型里的音乐播放器碟片/进度条/歌单、风扇转速卡、SSD 读写速度、`.steps` 步骤卡、`.flow` 数据流图、两处 `page-note` 解释段落等，全部按需求移除，未保留为「额外功能」。
- 唯一保留的装饰是监控页主视觉上的「同步率」，依据是需求 5.2 的明文例外，且已在代码与文档双处注明。
- 第六轮（一屏不滚动 / 监控页去重 / 启动页横屏左右 / 系统按钮一排 / 设置收进按钮）只改版面结构与信息归并，**没有新增或删除任何功能**；被收进设置面板的注销、熄灭显示器、任务管理器仍然可用。
- 交付内容与 `PROGRESS.md` 记录的阶段 0–7、「v3 改版记录」及「第六轮」一致。
