# NERV Panel 交付报告

> **第十六轮：功能自检及 exe/安装包构建完成。管理员安装、卸载重装及防火墙生效仍待实装验证。** 当前为 CPU/GPU 共用样式的底部调音窗口；历史预览状态以末尾正式验收记录为准。

> 本报告按需求文档第 10 节的六个栏目输出，不增减栏目。
>
> **关于自检状态**：按你的要求，本轮开发全程**未做运行测试**。因此第 4 栏里凡是需要「跑起来才能确认」的项，统一标注为 **待你运行后验证**，并写明代码上已做了什么、如果不过该看哪里。只有静态可确认的项（文件是否齐全、语法是否能过、配置字段是否对齐、结构是否存在）标为「静态确认通过」。这是有意为之：没有真跑过的项不写成「通过」。
>
> **后续轮次**：第六轮（一屏不滚动 / 去重）、第七轮（横竖屏统一 / 音乐 / 农历节日 / exe 设置窗口）、第八轮（托盘图标 / 左键设置 / 开机自启 / 保存即生效）、第九轮（顶栏只留监控启动 / 设置移底部 / 标题中英 / 音乐乱码与真播放 / 日历加高 / 双版本打包）、第十轮（日历只显日期 / 两栏顶部对齐 / 封面铺满 / 关闭按钮 / 底部 5 键）、第十一轮（去标题行 / 空态条带 / 封面放大 / 三键等大 / 文字左对齐）、第十二轮（横屏日历裁切 / 竖屏同步率重叠 / 天气重试与 stale / 7 日曲线 / 关闭真结束 / 熄屏点亮重播开机动画）、第十三轮（正式自检 / 关闭链路改用 HasExited 复查 / 重新打包 58.8 MB + 59.9 MB）、第十四轮（启动页 MAGI 三框改 3 行网格 / 中央六边形按确认稿定为 168×118 / 删除下方 7 个进度圆点）的改动已在 `PROGRESS.md`「v3 改版记录」各轮节与 `PROGRESS-NOW.md` 记录，本报告正文保留初版（阶段 0–7 + v3 + 第六轮）的原始结论，已过时的个别条目在下方标注。

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
| `server/weather.js` | Open-Meteo 三件套（geocoding + forecast + air-quality），10 分钟缓存 + 4 次退避重试 + 6 小时 stale 兜底，7 日预报与当日逐小时 |
| `server/apps.js` | 可启动项目扫描：开始菜单 `.lnk` + Steam 库（`StateFlags=4`），图标提取 PNG、运行状态、关闭应用 |
| `server/procs.js` | `tasklist` 进程表缓存（5 秒）、按进程名三级关闭（优雅 `/T` → 1.2 秒复查 → `/T /F` 强杀 → 0.6 秒复查 → `Stop-Process` 兜底 → 0.7 秒复查；复查用 `HasExited` 判定，避开 tasklist 残留 8~9 秒的假阳性） |
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
| `scripts/shoot-fixes.js` | 开发期验收脚本：横竖屏各截监控页与天气详情（`preview/fixes/`），并用 DOM 矩形自检日历是否溢出、同步率与时钟是否相交 |
| `scripts/verify-fixes.js` | 开发期验收脚本：模拟熄屏点亮验证开机动画重播、拦截 `/api/weather` 返回 502 验证天气不清屏与退避重试（13 条断言） |
| `scripts/verify-offline-banner.js` | 离线告警条验收：横竖屏 × 在线/断开两态，40 条断言（位置在顶栏下、主内容上、不与标题/分页菱形相交、切换状态后主内容矩形零位移、翻页显隐正确） |
| `scripts/shoot-offline-banner.js` | 离线告警条预览图：横竖屏 × 在线/断开 4 张 → `preview/offline-banner/`，切状态后立即截图并复核显隐 |
| `scripts/probe-magi.js` | 开发期验收脚本：量 MAGI 三框与中央六边形的矩形、8 组相交判定、行距、印记文字是否落在六边形多边形内、`.vote-foot` 是否存在 |
| `scripts/shoot-boot.js` | 开发期验收脚本：横竖屏各截「动画进行中」与「全票通过」两态（`preview/boot-fix/`） |
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

桌面版（**推荐，免装 Node**，成品在 `dist/`）：

- `NERV Panel.exe` —— 免安装版：双击即用，进右下角系统托盘（左键设置 / 右键菜单）。
- `NERV Panel 安装版.exe` —— 安装版：Inno Setup 向导安装（开始菜单/桌面快捷方式 + 卸载）。

源码运行：首次 `npm install`，之后双击 `start.bat`（或在项目根目录执行 `npm start`）。

`start.bat` 会切 UTF-8 代码页、启动服务、崩溃自动重启；`npm start` 没有守护。

开机自启：
- 桌面版：托盘右键 / 设置窗口里的「开机自启」开关直接写 Run 注册表，登录后后台静默启动。
- 源码版：`.\scripts\install-autostart.ps1`（写当前用户启动文件夹快捷方式）。

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
| 时钟、日历、合肥天气真实，断网不编造 | 已实测（第十二轮复测） | `/api/weather` 实测返回 `{"city":"合肥·安徽","desc":"阴","temp":11,"feels":8,"humidity":64,"windDir":"南风","windLevel":3,"air":"重度污染","days":[7 天],"hourly":[24 点]}`；上游抖动时先重试 4 次（指数退避），仍失败则回退到最近 6 小时内的成功数据并标 `stale`，界面注明「数据 N 分钟前」；从未成功过才整块显示「—」，不编造数字 |
| 启动页默认只显示常用，不铺满全部；添加/移除重启后生效 | 静态确认通过 | 默认只调 `GET /api/favorites`（实测空态返回 `[]`）；全量 `GET /api/apps` 只在挑选层与搜索时调；`favoriteAppIds` 落盘到 `config.json` |
| 软件控制真实：能启动、能关闭运行中的应用，列表外 id 被拒 | 已实测（第十三轮复测） | `POST /api/launch` 与 `POST /api/close-app` 均查 `apps.getById()`；实测白名单外 id 返回 `ID_NOT_ALLOWED`「这个项目不在可启动列表里」；关闭三级：先 `taskkill /IM <name> /T`（不带 `/F`，发 WM_CLOSE），1.2 秒后复查仍在则 `taskkill /IM <name> /T /F` 强杀，0.6 秒复查，仍在则 PowerShell `Stop-Process` 按 PID 兜底、0.7 秒复查；三次复查都用 `HasExited`（`tasklist` 会残留 8~9 秒导致误判）。实测 `nervtest2.exe`（无窗口）→ `"已强制结束"` `forced:true` 3252ms；`notepad.exe`（正常窗口）→ `"已关闭"` 1880ms；`Wordpad` 经接口 → 200 `"已关闭"` 1883ms 且卡片 `running:false` |
| 音乐卡片真实：真实歌名/歌手，三键走 SMTC，无会话显示「—」，不调私有接口 | 静态确认通过（无会话路径实测） | SMTC 接口实测 `{"ok":true,"available":false,"isPlaying":false,"title":null,"artist":null}`（本机当前无播放）；`POST /api/media/control` 实测返回 `NO_SESSION`；代码只调 `TrySkipPreviousAsync`/`TryTogglePlayPauseAsync`/`TrySkipNextAsync`，无任何网易云私有接口 |
| 系统控制齐全：5 电源全二次确认、2 系统操作真实执行、Token 有效 | 静态确认通过（拒绝路径实测） | 5 个 `.pwr` 都过 `confirmBox()`；`displayOff`/`taskManager` 按需求不二次确认；实测无 token → 401 `TOKEN_MISSING`、错误 token → 401 `TOKEN_INVALID`、`formatC` → `ACTION_NOT_ALLOWED` |
| Wi-Fi 断开重连后自动恢复 | 待验证 | WS 断线按 `[1,2,3,5,8,13,21,30]` 秒退避重连；连续失败降级 HTTP 轮询（间隔读 `refreshIntervalSec`）；6 秒无消息看门狗主动重连 |

### 部署

| 项 | 结果 | 说明 / 不过时看哪里 |
| --- | --- | --- |
| 电脑重启后服务端自启，平板自动显示面板 | 待验证 | 桌面版用托盘/设置窗口「开机自启」开关（写 Run 注册表）；源码版用启动文件夹 + `NERV-Panel.vbs`。平板侧靠 FreeKiosk 的 Auto-start on Boot |
| 平板用 FreeKiosk 基础模式全屏运行，开机自启、充电常亮、断线重载、隐藏浏览器元素 | 待验证 | 步骤全部写在 `TABLET-SETUP.md` 第三、四节；明确不需要 Device Owner / ADB / PLUS；中文需 beta 版 |
| 配置能改端口 / Token / 城市 / 图片路径（含 `customHeroImagePath`）/ 唤醒地址 / `favoriteAppIds` 并生效 | 静态确认通过（部分实测） | `/api/config` 实测下发 8 个非敏感项（不含 token）；`POST /api/settings` 白名单含上述全部；上传主图实测写回成功；刷新间隔改变会热重建采样定时器。桌面版另有 `POST /api/settings/local`（loopback 免 token，供托盘设置窗口用），端口等改动保存后自动重启服务 |
| `README.md` 和 `TABLET-SETUP.md` 完整，换台电脑照着能装起来 | 静态确认通过 | README 覆盖安装/配置/自启/接口/排错/换图/新增的 FreeKiosk 一节；TABLET-SETUP 覆盖防火墙与两层设置，含 REST API 8080 + `X-Api-Key` |
| 连续运行 2 小时稳定 | **未实测** | 已消除已知增长源（WS 订阅 close 时注销 + 30 秒心跳清理、走势线固定 60 点、服务端历史 12 分钟按时间淘汰、采集有 TTL 缓存、常驻子进程退避重启、日志滚动），但 2 小时长跑按你的要求未执行 |


### 第十四轮对初版表格的修正

| 初版 / 前轮条目 | 最新状态（第十四轮：启动页 MAGI 三框 + 删除进度圆点） |
| --- | --- |
| MAGI 三框布局 | 旧实现三框全是 `position:absolute`、`.vote-box{width:47%}`，左右合计 94%，中间核心 `absolute` 居中 → **必然骑在两框上**（实测横屏 `core_vs_casper/core_vs_melchior/core_vs_balthasar` 三向全相交，`center_gap` −31.2 / −31.1px）。已改为 **3 行 2 列网格**：上框占第 1 行、核心占第 2 行、左右两框各占第 3 行一列，`height` → `min-height:clamp(198px,31dvh,266px)`。实测横竖屏八项相交判定**全部 false**，核心与下排两框纵向行距 9.2 / 11.6px |
| 中央六边形宽度 | 由 **96×84（占图宽 17.1%）** 放大到 **168×118（横屏 29.9% / 竖屏 30.3%）**（首版放到 196×136，用户看预览图后要求「再小点」，最终 168×118）；`.core-approve` 由绝对定位改网格项、字号 `clamp(6.5px,1.25vw,8.5px)` → `clamp(9px,1.7vw,12px)`。实测文字框 76.4×32.7，**四角全部落在六边形多边形内**（左右余 3.8px、上下余 42.6px） |
| 三框连线 | 原来是写死的百分比坐标，网格化后会飘出框外。新增 `layoutVoteLines()`，按 `getBoundingClientRect()` 实测中心换算写回 `#lineTop/#lineBl/#lineBr`；`startBoot()`、`resetBootUi()`、窗口 `resize` 后各重算一次（另在 120ms / 600ms 补算，等字体加载完） |
| MAGI 下方 7 个圆点 | **元素与样式一并删除**（不是隐藏）：`index.html` 的 `<div class="vote-foot">…</div>` 整行删除，CSS `.vote-foot` / `.vote-foot i` / `.vote-foot i.hot` 三条规则删除，全仓无残留引用。删完下方不留空块，盖印行位置正常（`probe-magi.js` 两视口 `voteFoot:ABSENT`） |
| 小屏适配 | `@media (max-width:560px)` 里 `.vote-diagram{height:176px}` 改 `min-height:176px`（写死高度会把 3 行网格压扁、三框重新重叠）。另在 1280×540 / 960×540 / 1024×600 / 560×900 / 480×800 五档复测：三框无相交、不溢出 `.magi-term`、不溢出视口，`vote-foot` 均不存在 |

### 第十一轮对初版表格的修正

| 前轮条目 | 最新状态（第十一轮） |
| --- | --- |
| 竖屏启动页两块的比例 | **音乐比常用软件略小**：`.launch-grid` 竖屏为 `minmax(0,0.92fr) minmax(0,1fr)`，空态不再改变比例（实测音乐 510px / 常用 554px） |
| 「常用软件 / FAVORITES」标题行 | **横竖屏都已删除**，常用软件直接从搜索框开始；`#favCount` 占位与对应 JS 死代码一并清理 |
| 常用为 0 项时的空态 | 只保留一条**紧凑条带**（一行提示，竖屏实测 760×42），并在常用软件列里**水平与垂直都居中**（CDP 实测中心差值横竖屏均 ≤1px），不再占大半屏 |
| 「添加常用」入口 | **全站只有一个**：搜索框右侧那颗 `#addFavBtn`；条带内的第二个按钮与其 CSS/JS 已全部删除（CDP 实测 `addButtons` 长度 1） |
| 音乐卡文字对齐 | 「未在播放」曲目 / 歌手文字与上方「网易云音乐」标题**左对齐**（`.music .track{text-align:left}`、竖屏 `.music-head{justify-content:flex-start}`）；CDP 实测左边缘差值横竖屏均为 0 |
| 音乐专辑封面 | 放大并放到卡片中间居中：竖屏最小高 `clamp(96px,14vh,150px)`、宽度撑满；占位音符放大到 44% / 120px |
| 音乐三键尺寸 | 上一首 / 播放暂停 / 下一首**完全等大**（删掉了 `.main` 的加大尺寸），只有中间那颗是红色；CDP 实测竖屏 42×42、横屏 35.2×35.2，`equal: true` |

### 第十三轮对初版表格的修正

| 初版 / 前轮条目 | 最新状态（第十三轮：正式自检 + 重新打包） |
| --- | --- |
| 「关闭」按钮的判定数据源 | 自检中复现了「关闭返回失败但其实已经关掉」：`wordpad.exe` 走完强杀后仍被判 `CLOSE_FAILED`。根因是复查用了 `tasklist`，它对已结束的进程会残留 8~9 秒（`/FO LIST /V` 连 Status 都还是 Running），而 PowerShell 的 `HasExited` 已是 `True`。已改为三次复查全部走 `isAlive()`（`Get-Process | Where-Object { -not $_.HasExited }`），并加 `recentlyClosed` + `reconcileClosed()` 剔掉卡片上「运行中」的假阳性。**打包版 exe 实测**：`POST /api/close-app` → 200 「已关闭」1818ms，700ms 后 `/api/apps` 该项 `running:false`，而同一刻 `tasklist` 仍残留该进程、`HasExited` 计数为 0（同一现象、两套判定，对比见请求失败已彻底消失） |
| 交付体积 | 第十二轮记录的 140.7 MB / 141.4 MB 是早期（含完整 node_modules 调试依赖）的旧数字，实际成品为 `dist\NERV Panel.exe` **58.76 MB**（SHA256 `169FAC17…D41FBDA`）、`dist\NERV Panel 安装版.exe` **59.87 MB**（均为第十三轮重新打包产物） |
| 打包产物可信度 | 新增并接入两道防线：`preflight_python_deps()` 在打包前校验 pystray/Pillow/PyInstaller（缺则立刻报错并给出正确解释器路径），`verify_bundle.py` 在打包后解析 exe 断言 pystray 13 个模块、PIL 80 个模块、bundle 617 条都在。第十三轮重打包实测 `[自检通过]`；**修复是否真进包**用三重 SHA256 核验：源码 `server\procs.js` = `build\bundle\server\procs.js` = 从 exe 内 `CArchiveReader` 抽出的 `bundle\server\procs.js`，三者同为 `CA770D3D…A97CC` |
| 自检覆盖 | 布局（四视图 `pageOverflow:0`、5 张硬件卡无溢出）+ 13 条行为断言 + 接口层（鉴权 401 / 白名单 400 / config 不泄 token / WebSocket 鉴权 / 静态资源）+ **打包版 exe 实机复验**（1 秒内 `/api/status` 200、托盘 `SystemTrayIcon` 窗口存在、打包体内 app.js/style.css 含本轮新增函数、`POST /api/close-app` 200、`launcher.log` 无托盘异常） |
| 端口冲突（环境噪音，非缺陷） | 首次启动打包版时服务反复 `code=2` 退出、`/api/status` 20 秒不通，日志「端口 5000 已被占用」；占用者是 Clash Verge 的 `verge-mihomo.exe`（临时 Bind 0.0.0.0:5000）。README「启动报端口 5000 已被占用」已补 `netstat -ano \| findstr :5000` + `tasklist /FI "PID eq <PID>"` 排查步骤与该真实案例 |

### 第十二轮对初版表格的修正

| 初版 / 前轮条目 | 最新状态（第十二轮） |
| --- | --- |
| 横屏右侧日历底部几行被裁 | 已修：`.cal-grid` 行高由 `minmax(clamp(24px,4.1vh,38px),1fr)` 改为 `minmax(0,1fr)`。原最小行高 × 6 行 + 表头超过 `.cal-card` 可用高度，`overflow:hidden` 把底部切掉。DOM 实测强制 6 行占位后 `overflowPx:0`（横竖屏都是） |
| 竖屏同步率与时间重叠 | 已修：`.syncbox` 从 `.hero-visual` 子元素挪进 `.hv-in` 内部，竖屏 `.hv-in` 改 3 行网格（同步率整行 / 时钟 + 日期 / 状态行），`position:static`。DOM 实测横竖屏 `overlapClock:false`、`overlapDate:false` |
| 天气「有时读不到」 | 已修：服务端 4 次退避重试 + 6 小时 stale 兜底；前端失败不再清屏、保留旧数据并 15s/30s/60s 退避重试，定时刷新 10 分钟 → 5 分钟。拦截成 502 实测：温度/描述保持 `11°` / `阴 · 合肥·安徽`，触发重试 `hits:2`，恢复后正常刷新 |
| 天气详情缺少 7 日曲线 | 已加：`drawWeatherWeek()` 画最高温（橙实线 + 面积）与最低温（蓝虚线），`FORECAST_DAYS=7`，「未来 3 天」列表改为全部 7 天。实测两视口 `weekChart:true, weekH:150, dayRows:7` |
| 「关闭」点了不结束进程 | 已修：`killByName` 三级关闭（优雅 `/T` → 1.2 秒复查 → `/T /F` 强杀 → 0.6 秒复查 → PowerShell `Stop-Process` 兜底 → 0.7 秒复查），成功带 `forced:true`。三次复查都用 `HasExited` 而非 `tasklist`（后者对已结束进程残留 8~9 秒，会误判成「还在跑」）。实测无窗口进程 3252ms 强杀成功、正常窗口进程 1940ms 优雅关闭、Wordpad 经 `POST /api/close-app` 1883ms 返回「已关闭」且卡片 `running:false` |
| 无「熄屏点亮弹启动界面」 | 已加：`visibilitychange` 记录离开时长，≥3 秒后回到前台 `replayBoot()` 重播 MAGI 开机动画并落在监控页；不足 3 秒不触发。实测熄屏 4 秒 → `#boot` 重新可见、进度从 35% 重走、退场正常；切后台 1 秒不重播 |

### 第十轮对初版表格的修正

| 初版 / 前轮条目 | 最新状态（第十轮） |
| --- | --- |
| 监控页月历卡面 | 卡面**只显示日期**；节日 / 农历 / 节气只在点开的日历详情里显示（详情仍可切上一年 / 上月 / 下月 / 下一年） |
| 启动页音乐卡布局 | 音乐与常用软件两栏**顶部对齐**；封面盒子居中并占满卡片内部剩余高度（横屏实测 563×389），图片 `object-fit:cover` 铺满不变形 |
| 常用软件卡的「关闭」 | 已修：`.app .app-ctrl` 缺 `position/z-index`，被 `.ico-hit`（`inset:0;z-index:1`）盖住导致点关闭命中启动层。改为 `position:relative;z-index:2`，CDP `elementFromPoint` 实测横竖屏都命中关闭按钮本身 |
| 「添加常用」位置 | 移到**搜索框右侧**（`.search-row` 并排），搜索框相应缩短；旧 `.fav-actions` 规则已删 |
| 启动页底部按钮 | 一排 **5 个**：锁屏 / 睡眠 / 重启 / 关机 / 设置（设置是第 5 个，点击打开设置面板） |

### 第九轮对初版表格的修正（初版结论保留在上方，这里列出已过期项的最新状态）

| 初版条目 | 最新状态（第九轮起） |
| --- | --- |
| 「切换按钮在主界面右上角，只有监控/启动 2 个」 | 仍成立，且**顶栏已经只剩这两个按钮**（设置齿轮已移除） |
| 「系统按钮七列 / 次要项收进设置面板」 | 已改为**启动页底部 5 个按钮**：锁屏 / 睡眠 / 重启 / 关机 / **设置**；注销、熄灭显示器、任务管理器已永久移除（第七轮决定），不再进设置面板 |
| 「全站只有一个设置入口（顶栏右上角「设置」按钮）」 | 设置入口改为**启动页底部第 5 个按钮**「设置」；桌面版另有托盘入口（左键/右键菜单） |
| 「页标题为『监控 / 启动』」 | 改为「**监控 MONITOR**」「**启动 LAUNCH**」（中英一体） |
| 「音乐三键置灰 / 无会话」 | 歌名/歌手中文乱码已修（PS 输出强制 UTF-8）；点播放：有会话真播放、按钮状态跟随，无会话先启动网易云再自动接着播；封面居中、按钮改小 |
| 「`POST /api/media/control` 只接受 prev/playPause/next」 | 现接受 **play / pause / playPause / prev / next** |
| 「开机自启需要执行 install-autostart.ps1」 | 桌面版设置窗口/托盘「开机自启」开关即可（写 Run 注册表，登录后后台静默启动） |

---

## 5. 已知缺口

1. **CPU 温度读不到**。两条 WMI 路径都试过：`Win32_Processor.CurrentTemperature` 返回空值；`root/wmi:MSAcpi_ThermalZoneTemperature` 普通权限报「拒绝访问」。**第九轮再次查证**：LibreHardwareMonitor / OpenHardwareMonitor / HWiNFO / CoreTemp 均无进程、无服务，`root\LibreHardwareMonitor` WMI 命名空间不存在，`si.cpuTemperature()` 实测返回 `{"main":null,"cores":[],"max":null,"socket":[],"chipset":null}` → 界面显示「—」。**需要真实温度时，安装 LibreHardwareMonitor（或 HWiNFO64）并以管理员运行其后台服务**，之后 NERV Panel 才能从同一 WMI 命名空间读到。
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
16. **开机自启未安装**（初版记录）。桌面版已内置：托盘/设置窗口「开机自启」开关直接写 Run 注册表；源码版仍可用 `.\scripts\install-autostart.ps1`。
17. **风扇转速读不到**。`systeminformation@5.33.24` 没有风扇 API（60 个导出里只有 `cpuTemperature` 与温度相关）；`Win32_Fan` WMI 能返回两个 Cooling Device 但 `DesiredSpeed` 为空；`root/wmi:MSAcpi_ThermalZoneTemperature` 普通权限报「拒绝访问」；`root/OpenHardwareMonitor` 命名空间不存在（未装 OHM）。风扇卡因此显示「—」并注明「系统接口未提供转速」，不编造 RPM。可选方案（未实现）：装 Open Hardware Monitor 或 HWiNFO64 后用其 WMI / 共享内存接口。

---

## 6. 承诺

- 本轮未新增需求文档未要求的功能、页面、按钮或接口。原型里的音乐播放器碟片/进度条/歌单、风扇转速卡、SSD 读写速度、`.steps` 步骤卡、`.flow` 数据流图、两处 `page-note` 解释段落等，全部按需求移除，未保留为「额外功能」。
- 唯一保留的装饰是监控页主视觉上的「同步率」，依据是需求 5.2 的明文例外，且已在代码与文档双处注明。
- 第六轮（一屏不滚动 / 监控页去重 / 启动页横屏左右 / 系统按钮一排 / 设置收进按钮）只改版面结构与信息归并，**没有新增或删除任何功能**；被收进设置面板的注销、熄灭显示器、任务管理器仍然可用。
- 交付内容与 `PROGRESS.md` 记录的阶段 0–7、「v3 改版记录」及「第六轮」一致。

### 第十五轮对初版表格的修正

| 初版 / 前轮条目 | 最新状态（第十五轮：离线告警改到顶部悬浮） |
| --- | --- |
| 离线告警条的位置 | 原本是 `.page-in` 里 `.hw-row` 之后的最后一项，`flex:none` 在 flex 列里**独占一整行高度**。现已移到 `.pager-head` 内（页标题与右上分页菱形之间），`position:absolute` 悬浮，**不占文档流、不吃空间** |
| 是否影响一屏布局 | **不影响**。CDP 实测在线 ↔ 离线两态下 `.mon-top`（横 `22,119,1236,478` / 竖 `19,120,762,440`）、`#hwRow`（y608 / y570）、`.hero-visual`（h478 / h150）、`.wx-cal`（y119 / y278）、`.pager-head`（h44 / h45）矩形**完全一致**，`pageOverflow:0`、`bodyOverflow:0` |
| 会不会挡住下面的卡片 / 按钮 | **不会**。条子 `pointer-events:none`，且位置在 `.mon-top` 之上（条子底边 101，`.mon-top` 顶边 119/120），与标题框、分页菱形矩形均不相交 |
| 显隐逻辑 | 条件改为 `connStateName === "offline" && current === 0`：断开即显、恢复即隐；翻去启动页自动不显示、翻回监控页仍断线时重现（`.pager-head` 不在 pager-track 内，必须按当前页主动重算） |
| 窄屏表现 | `@media (max-width:760px)` 条子收窄到 `max-width:62vw` 并隐藏「数据暂停更新，等待服务端恢复」后半句，只留「电脑端未连接」；实测 480×800 宽 119px 仍居中、不撑破顶栏 |
| 验证覆盖 | 新增 `scripts/verify-offline-banner.js`（**40 条断言全通过**，横屏 20 + 竖屏 20）+ `scripts/shoot-offline-banner.js`（4 张预览图）；另在 1280×800 / 1280×540 / 960×540 / 1024×600 / 800×1280 / 560×900 / 480×800 七档复测全部通过 |

#### 第十五轮交付物与最终验证

- 产物：`dist\NERV Panel.exe` **58.76 MB**（2026-11-25 21:53:19，SHA256 `A19D532ED5EE1195BEE8ABE5DF37EC671F5B49BA12281C8A9944F48186254260`）、`dist\NERV Panel 安装版.exe` **59.87 MB**（21:54:03）。
- 包内一致性：`public/index.html`、`public/css/style.css`、`public/js/app.js`、`server/procs.js`、`server/weather.js` 从 exe 内抽出后 SHA256 与源码**逐字节相同**（`build\verify_in_exe15.py`，`ALL_SAME: True`）。
- 打包版四层自检：`diag-flow` 四视图 0 溢出；`verify-ui` 五卡 ok；`verify-fixes` 13/13；`verify-offline-banner` 40/40。
- **真实断线（真杀进程，无调试注入）**：前端 7 秒发现断开并弹出告警条，launcher 1 秒拉起服务后前端 2 秒自动收起；在线 / 断开 / 恢复 三态主内容矩形逐字段相同。
- 关闭应用端到端（打包版）：Wordpad 200 `{"ok":true,"forced":false,"message":"已关闭"}` 1681ms → `running:false`。
- 新增开发期脚本：`build\verify_in_exe15.py`（包内一致性）、`build\probe-offline-cycle.js`（断线循环）、`build\shoot-real-offline.js`（真断线截图）、`build\docpatch15.js` / `docpatch15b.js`（本轮文档补丁）。


## 第十六轮：通用音频入口 / 全屏调音 / 常用排序 / 安装防火墙 / 图标

- 启动页按当前 SMTC 来源显示应用名，无会话时显示“暂无播放”；显示标题及可选歌手。保留雷达底图，删除音符与封面下三键，17 根居中放大波动条联动播放/暂停状态。它是状态动画，不是音频频谱采样。点封面进入全屏调音，返回回到启动页。
- 调音页包含小封面、来源、标题、歌手、三键及只读进度条；主音量与每个 active 音频会话的音量、百分比和静音；每秒刷新，拖动请求按 140ms 节流并提交最终值。系统声音采用真实 Core Audio 会话；无会话时保留不可用提示行，不伪造可控会话；无 active 应用时显示空态。
- 后端直接用 C# COM interop 调 Windows Core Audio（IAudioSessionManager2 / ISimpleAudioVolume / IAudioEndpointVolume），无额外 NAudio 下载依赖。新增 GET /api/audio/sessions、POST /api/audio/volume、POST /api/audio/mute、GET /api/audio/icons/:hash；写请求沿用 token。ID 绑定设备和会话实例，防止旧 ID 误控。SMTC 选择播放中的来源并提供名称、进度和能力信息。
- 常用卡片长按约 500ms 进入轻微抖动排序；Pointer Events 拖动、自动让位、松手保存 POST /api/apps/order；服务端串行校验并保存完整顺序。排序期间按钮禁用，完成/空白退出，添加常用固定末尾，取消/失败回滚。浏览器若接管第一次触摸滚动导致 pointercancel，模式保留，下一次触摸可拖动。
- 安装版使用固定安装目录 runtime/node.exe；管理员安装时维护仅 Private 的 TCP 入站规则，按实际路径标识、避免重复，卸载移除；启动不再请求 UAC 或写防火墙。portable 改用按内容版本区分的固定本地缓存，首次或内容升级仍可能需要 Windows 授权；安装版是此次“安装时放行”的适用交付。
- 根目录 nerv.jpg 已转换为七尺寸 ICO，exe/托盘/setup 共用。待重新打包后才能反映在 dist 成品中。
- 新增 public/js/audio-ui.js、public/css/audio.css、public/js/favorite-sort.js、server/audio.js、server/ps/audio-session.ps1、server/ps/audio-core.cs、packaging/runtime_paths.py、packaging/firewall.ps1、packaging/make_icon.py；其余入口、媒体、排序与打包文件已同步。
- 预览：preview/audio-mixer/launch-landscape.jpg、launch-portrait.jpg、mixer-landscape.jpg、mixer-portrait.jpg；由 scripts/preview-audio.js 在独立内存服务生成，画面标注“示例数据”。不读写真实音量或用户配置，不能作为真实音频/触屏/局域网验收。
- 已做的仅限语法/编译检查和预览生成。待确认后：真实音频枚举、主/应用音量与静音、播放控制、排序保存与重启、横竖屏鼠标触屏交互回归、重新打包、安装卸载与规则验证、托盘及局域网连接；物理平板与原生防火墙弹窗结果必须据实记录。

### 第十六轮预览调整：调音统一详情弹层

按最新反馈，删除封面“点击进入调音”提示，仍点击封面直接打开。调音改用 CPU/GPU 详情相同的 sheet / sheet-box / sheet-head / sheet-close：底部滑入、相同遮罩与宽高限制、内部滚动，点关闭、遮罩或 Escape 返回启动页。替代此前全屏独立调音页的表现，音频功能保持。横竖屏示例预览重新生成，正式自检与打包仍待预览确认。

### 调音弹层二次调整

前版虽共用 sheet 外壳，内部仍采用大尺寸卡片与留白，横屏内容顶到 88dvh 上限，未达到统一紧凑详情窗口的效果。本次删除内部大卡片式排布，改为小封面、同行播放信息与按钮、紧凑主音量及应用列表；继续使用原详情层的窗口、遮罩、标题及滚动样式。重新生成示例预览供确认，正式功能验收与重打包未执行。

### 调音窗口尺寸约束修订

按用户再次明确的非全屏要求，调音窗口限定最大宽度 760px、宽度不超过视口减 32px、最大高度 62dvh；底部停靠，长内容在窗口内部滚动，顶部与左右保留底页可见区域。遮罩与标题关闭样式沿用详情层。新示例预览在 preview/audio-sheet-compact/，取代此前 audio-mixer 预览；待用户确认，正式自检和打包未执行。

### 调音窗口与 CPU 详情统一尺寸（最新）

用户认可底部局部窗口形态，但要求放大到 CPU 详情相同规格。已删除调音专属 760px/62dvh/左右留边规则，窗口完全继承共用 .sheet-box：width:100%、max-width:860px、max-height:88dvh，保留紧凑音频内容与窗口内部滚动。该修订取代上节尺寸约束。最新示例预览在 preview/audio-sheet-unified/，待确认后再正式自检和打包。

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
