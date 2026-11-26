# NERV PANEL · 开发进度

> **第十六轮：功能自检及 exe/安装包构建完成。管理员安装、卸载重装及防火墙生效仍待实装验证。** 当前为 CPU/GPU 共用样式的底部调音窗口；历史预览状态以末尾正式验收记录为准。

> 本文件记录各阶段完成状态、实际读到的硬件字段、以及无法读取的项与降级方式。
> 规则来源：`NERV Panel-complete.md` 第 4 节（数据真实性）与第 8 节（阶段清单）。

## 环境事实

| 项目 | 实测值 |
| --- | --- |
| 操作系统 | Windows（`os.version` 见 `/api/status`） |
| Node.js | v24.22.1 |
| npm | 11.19.1 |
| 显卡 | NVIDIA GeForce GTX 1660 SUPER（6 GB） |
| 采集命令 | `nvidia-smi` 可用，字段映射正常 |
| 天气数据源 | Open-Meteo（geocoding + forecast + air-quality） |
| 媒体会话 | Windows SMTC（`GlobalSystemMediaTransportControlsSessionManager`）可用 |

> 文档中参考机型写的是 RTX 4060 Ti，实际本机为 GTX 1660 SUPER。面板不写死型号，全部从采集结果读取，因此不影响功能。

## 阶段状态

按当前 `NERV Panel-complete.md`（v3，两页结构）的阶段划分：

| 阶段 | 内容 | 状态 |
| --- | --- | --- |
| 0 | 项目骨架与配置 | 已完成 |
| 1 | 界面静态版（演示数据） | 已完成 |
| 2 | 监控数据打通 | 已完成 |
| 3 | 监控页上区补全 | 已完成 |
| 4 | 启动页上区打通 | 已完成 |
| 5 | 启动页下区系统控制 | 已完成 |
| 6 | 开机自启与平板自动显示 | 已完成 |
| 7 | 性能与收尾 | 已完成 |
| v3 | 四页改两页、新增接口与详情层（见下方「v3 改版记录」） | 已完成 |

> 早期按 v2 需求（四页：启动 / 总览 / 硬件监控 / 系统，底部 Dock 导航）实现过一版，v3 需求把页面结构改成两页（监控 / 启动），切换按钮移到顶栏右上角。下文阶段 1、3、5 的记录保留了当时的实现描述，v3 的改动集中在文末「v3 改版记录」一节，以该节为准。

## 阶段 0 记录

- 目录结构：`server/`（服务端）、`public/`（前端静态资源）、`logs/`（日志）、`config.json`（唯一配置文件）。
- `config.json` 首次启动自动生成；`token` 为空时生成 24 字节随机值并写回文件。
- 配置文件损坏时会备份为 `config.json.broken-<时间戳>` 并用默认值重建，避免服务无法启动。
- 启动日志打印本机与平板访问地址，例如 `http://192.168.10.11:5000`。
- 控制台中文在 GBK 代码页下显示为乱码，用 `start.bat`（内部 `chcp 65001`）启动即正常；不影响网页端。

### 未能读取的字段

（阶段 0 无硬件字段读取，暂无）

### 降级方式

（阶段 0 无）

## 阶段 1 记录

> 本阶段最初按 v2 的四页结构实现，v3 已改为两页。以下为当时的原始记录，实际交付结构见文末「v3 改版记录」。

### 完成内容

- `public/index.html`：MAGI 开机序列（六角形核心、三台主机表决印章、扫描线与光束、日志逐行滚动＋末尾闪光标、分段进度条、背景缓慢推进）。
- `public/css/style.css`：EVA 主题配色（`--red:#e8321e` 主色、橙黄绿状态色）、切角卡片（`.cut`）、警戒斜纹（`.hazard`）、横竖屏媒体查询、`orientIn` 旋转过渡、`prefers-reduced-motion` 降级。
- `public/js/app.js`：`goTo()` 翻页（`translate3d` + 视差入场）、滑动/键盘/圆点三种翻页入口、开机序列脚本、时钟与月历、走势线 `drawSpark()`、演示监控数据、演示应用列表、电源按钮二次确认、横竖屏过渡调度、页面可见性调度（离开页面停表）。

### 演示数据清单（阶段 2 起已全部删除）

| 位置 | 内容 | 现状 |
| --- | --- | --- |
| `app.js` → `demoMetrics()` | CPU/GPU/内存/磁盘/网络全部为 `Math.random()` 生成 | 阶段 2 已删除，改真实采集 |
| `app.js` → `DEMO_APPS` | 7 条应用与游戏条目 | 阶段 4 已删除，改 `/api/apps` |
| `app.js` → `DEMO_WEATHER` | 合肥晴天 11°C 等天气数值 | 阶段 3 已删除，改 `/api/weather` |
| `app.js` → `DEMO_STATUS` | 连接信息写死 | 阶段 3 已删除，改 `/api/status` |

> 「演示模式」标识随演示数据一起删除（v3 起界面不再有该标识，因为已无演示数据）。

### 主视觉

- `public/assets/hero.jpg` 由原型内嵌 base64 提取后重裁：原图 1120×797，左侧 0–150px 为纯蓝天（无人物），已裁掉；**最终 970×797**，人物（头部/上身/双臂/双腿）完整保留。
- 原图顶部 90px 条带经放大检查**不含任何小字或水印**，文档所述「顶部小字」在本图不存在，因此未做额外留白。
- 前端优先加载 `customHeroImagePath`（用户换的图），为空时用 `heroImagePath`（默认图）；加载失败显示占位块。

### 未能读取的字段

（阶段 1 为演示数据，不涉及真实硬件读取）

### 降级方式

- 字体：`@font-face` 全部本地文件，不依赖网络；若文件缺失则回退到 `--sans` 链上的同类字体。
- 主视觉：图片加载失败时显示 `HERO IMAGE / 主视觉图片未找到` 占位块。
- 天气：`GET /api/weather` 不可用时显示「—」。

## 阶段 2 记录（监控数据打通）

### 完成内容

- `server/metrics.js`：采集 `cpu`（usage/temp/freq/name/cores）、`gpu`（usage/temp/vramUsed/vramTotal/freq/power/name）、`ram`（usage/used/total）、`disks[]`、`net`（up/down）、`ts`，字段与文档第 4 节一致。
- GPU 优先走 `nvidia-smi --query-gpu=...`（不写死路径，先试 PATH 再试 `%SystemRoot%\System32\nvidia-smi.exe`），失败回退 `systeminformation.graphics()`；回退路径拿不到的温度/功耗/频率返回 `null`。
- **采样性能重构（关键）**：`systeminformation` 在 Windows 上每次查询都起 PowerShell 子进程。实测耗时：`si.networkStats()` 冷 4606ms / 热 1793–1999ms、`si.graphics()` 冷 1674ms / 热 1276–1332ms、`si.cpu()` 1988ms、`si.fsSize()` 522ms、`si.mem()` 573ms。原实现全部串行 await，导致每 tick 3–5 秒。
  - 引入 `makeAsyncCache(ttlMs)`：采样循环只 `peek()` 上一轮现成结果、**永不等待**，耗时查询交给后台 `refresh()`；受 TTL 与 in-flight 双重保护，失败不覆盖旧值。
  - 网络改为 `server/netwatch.js` + 常驻 `server/ps/net-counters.ps1` 子进程：每秒读 `Get-NetAdapterStatistics` 累计字节，Node 侧按两次采样差值算速率。`VIRTUAL_RE` 过滤 loopback/virtual/vmware/hyper-v/tailscale 等虚拟网卡。
  - 实测重构后 tick 间隔 **728ms / 974ms**，达到需求要求的每秒一次。
- `server/index.js`：`WebSocketServer({ server, path: '/ws/metrics' })`，每秒向每个连接推一次 `{type:'metrics', data}`；30 秒 ping/pong 心跳清理僵尸连接；`GET /api/metrics` 作为 HTTP 轮询降级通道。
- 前端连接层：优先 WebSocket；`onclose` 按 `[1s,2s,3s,5s,8s,13s,21s,30s]` 退避重连；连续重连失败自动降级为 HTTP 轮询（间隔读配置 `refreshIntervalSec`）；看门狗 6 秒无数据判定掉线；断线期间显示「离线」不白屏。
- 走势线（CPU/GPU/内存/网络）只在**监控页可见时**绘制，离开立即停止，返回时补画。

### 未能读取的字段

| 字段 | 状态 | 原因 |
| --- | --- | --- |
| `cpu.temp` | 读不到 | Windows 需管理员权限的传感器驱动；`Win32_Processor.CurrentTemperature` 返回空，`root/wmi:MSAcpi_ThermalZoneTemperature` 普通权限报「拒绝访问」。按文档给 `null`，前端显示「—」 |
| `gpu.temp` / `gpu.power` / `gpu.freq` | 可读（nvidia-smi 路径） | 本机实测 nvidia-smi 可用，三个字段均有值；非 NVIDIA 或 nvidia-smi 不可用时会变为 `null` |
| `net` 首次采样 | 可能为 0 | 需要两次采样求差，服务刚启动的第一个采样点可能为 0，属正常（已实测：空闲时接近 0 是真实结果，制造流量后能正确反映） |

### 降级方式

- 任一硬件字段读不到 → 服务端返回 `null` → 前端显示「—」，绝不填随机数。
- WebSocket 不可用 → 自动 HTTP 轮询，界面标注「轮询模式」。
- 两者都失败 → 顶部状态显示「离线」，显示离线横幅，数据保持最后已知值不清零。

## 阶段 3 记录（监控页上区补全）

### 完成内容

- `server/weather.js`：Open-Meteo 三接口（geocoding 取经纬度 → forecast 取当前与未来 3 天 → air-quality 取空气质量）。城市读 `config.json` 的 `weatherCity`，接口地址读 `weatherApiUrl`。
- 天气结果缓存 10 分钟，并发请求合并为一次上游调用，避免平板频繁刷新打爆上游。
- 前端 `GET /api/weather`：状况、当前温度、体感、湿度、风向风力、空气质量、未来 3 天全部按服务端返回渲染；任一字段缺失显示「—」；请求失败整体显示「—」，不编造。
- 时钟：时分大字、秒小字，整秒对齐 `setTimeout` 驱动（不是 rAF），只在监控页可见时运行，离开立即停表。
- 月历：当月网格、今天高亮，随月份自动重排。
- 状态文案随连接状态切换：在线「EVA-02 · 同步中 · A.T. FIELD ALL GREEN」；轮询「EVA-02 · 轮询链路 · A.T. FIELD STABLE」；离线「EVA-02 · 连接中断 · A.T. FIELD LOST」。
- 主视觉：读配置，`object-fit: cover` + `68% 22%` 焦点，横竖屏都保留人物主体。
- 连接信息：电脑名、IP:端口、服务端版本、已连接时长（本地计时）、当前延迟（`/api/status` 往返毫秒）。

### 未能读取的字段

| 字段 | 状态 | 原因 |
| --- | --- | --- |
| 空气质量 | 可读 | Open-Meteo air-quality 提供 `pm2_5`/`pm10`/`us_aqi`，按其换算等级 |
| 天气（断网时） | 显示「—」 | 上游不可达时不做任何猜测 |

### 降级方式

- 天气三接口任一失败 → 该字段显示「—」；forecast 失败则整块显示「—」并保持上一次成功值 10 分钟内有效。
- 主视觉图缺失 → 占位块 + 文字 `HERO IMAGE / 主视觉图片未找到`。

## 阶段 4 记录（启动页上区打通）

### 完成内容

- `server/apps.js`：扫描两处开始菜单（`%ProgramData%` 与 `%APPDATA%`）的 `.lnk` 快捷方式，并解析 Steam 库（`libraryfolders.vdf` → `steamapps/appmanifest_*.acf`，仅收录 `StateFlags=4` 即真正已安装的游戏）。扫描结果缓存 60 秒，`?refresh=1` 强制重扫。
- 条目字段：`id`、`name`、`type`（`game` / `software`）、`hasIcon`、`running`。**前端不写死任何名单，分组也只依据服务端 `type`**。
- 图标：`GET /api/apps/:id/icon` 用 PowerShell + `System.Drawing.Icon.ExtractAssociatedIcon` 从 `.lnk` 提取 PNG，缓存在 `cache/icons/`；提取失败返回 404，前端回退统一占位图标。
- `server/launcher.js`：`POST /api/launch` 只接受 `/api/apps` 返回过的 `id`；未命中时先强制重扫一次再判定，仍不存在则拒绝（`ID_NOT_ALLOWED`）。Steam 游戏走 `steam://rungameid/<appid>`，快捷方式走系统默认启动。
- `server/auth.js`：所有控制类接口校验 `X-NERV-Token`（也接受 body.token），使用 `crypto.timingSafeEqual` 常量时间比较；未配置/缺失/错误分别返回 `TOKEN_NOT_CONFIGURED` / `TOKEN_MISSING` / `TOKEN_INVALID`。
- token 存于浏览器 `localStorage`，由用户从 `config.json` 抄入设置区；服务端从不下发 token。

### v3 增补

- `GET /api/apps` 每项加 `running`；`server/procs.js` 用 `tasklist /fo csv /nh` 拿进程表（5 秒缓存，失败保留上一份，从未成功过返回 `null` 表示「未知」而非「未运行」）。
- `POST /api/close-app`：只关该 id 对应进程，`taskkill /IM <name> /T`（**不带 `/F`**，先发 WM_CLOSE 属正常关闭），1.2 秒后复查，仍在跑如实返回原因。
- `GET/POST /api/favorites`：按 `config.json` 的 `favoriteAppIds` 顺序解析，只接受 `add`/`remove` + 列表内 id。
- `server/hero.js` + `POST /api/hero-image`：接收 jpg/png/webp，用**文件头魔数**校验（不信 Content-Type 与后缀），存入独立的 `data/hero/`，写回 `customHeroImagePath`，**不覆盖默认图 `heroImagePath`**。

### 未能读取的字段

| 字段 | 状态 | 原因 |
| --- | --- | --- |
| 部分快捷方式图标 | 可能缺失 | 目标是 Windows 商店应用（`shell:AppsFolder\...`）或图标嵌在 exe 资源里时无法用 `ExtractAssociatedIcon` 提取，前端回退统一占位 |
| Steam 库 | 取决于安装情况 | 未装 Steam 或库中无已安装游戏时该分组为空（本机实测：软件 126 项，游戏 0 项） |
| `running`（Steam 游戏） | 恒为 `null` | 游戏没有可执行文件名可供匹配，按「未知」处理而非谎报「未运行」 |

### 降级方式

- 图标缺失 → 统一占位图标（文档允许）。
- 扫描结果为空 → 显示「服务端未扫描到任何可启动项目」空态，不造假条目。
- 扫描失败 → 显示「读取可启动项目失败：<原因>」。
- 关闭应用失败 → toast 服务端返回的原文原因（如「应用没有响应关闭请求，可能正在等待保存或用户确认」）。

## 阶段 5 记录（启动页下区系统控制）

### 完成内容

- `server/power.js`：电源白名单 5 项 `lock` / `logout` / `sleep` / `restart` / `shutdown`，系统操作白名单 2 项 `displayOff`（发送 `WM_SYSCOMMAND` + `SC_MONITORPOWER` 熄灭显示器）/ `taskManager`（打开任务管理器）。白名单外的 key 直接返回 `ACTION_NOT_ALLOWED`，不执行任何命令。
- `POST /api/power`、`POST /api/system`、`POST /api/launch`、`POST /api/settings`、`POST /api/close-app`、`POST /api/favorites`、`POST /api/media/control`、`POST /api/hero-image` 全部挂 `requireToken`。
- `POST /api/settings`：只接受 `config.json` 已定义的键，做类型/范围校验后写回文件，返回 `changed` 列表与 `needsRestart`（端口、平板唤醒相关项需重启生效）。
- 电源 5 个操作走「二次确认 → 调接口 → toast 结果」，确认框触控区已放大到适合平板点击。**熄灭显示器与任务管理器按需求不做二次确认**（文档 5.2 明确）。
- 设置区：访问令牌、刷新间隔、天气城市、主视觉（**「更换主图」是直接选本地图片的文件选择器，不是手填路径框**）、平板唤醒地址、唤醒 API Key、唤醒开关；保存后立即写回 `config.json`，能热生效的立即生效（刷新间隔、主视觉、天气城市），需要重启的明确提示。

### 未能读取的字段

（本阶段无硬件字段，全部为可写配置与白名单操作）

### 降级方式

- 未填 token → 点击任何受控操作时提示「请先在下方设置中填入访问令牌」并聚焦输入框，不发送请求。
- 唤醒 API Key 属敏感字段，服务端不下发，设置区始终留空表示「不修改」。
- 某项设置需重启 → 保存成功但明确提示「需重启服务端后生效」。

## 阶段 6 记录（开机自启与平板自动显示）

### 完成内容

- `start.bat`：`chcp 65001` 解决中文乱码 → `cd /d "%~dp0"` 保证相对路径正确 → 循环执行 `node server\index.js`。退出码为 0（用户正常关闭）时不再重启；非 0（崩溃）时打印崩溃次数并在 5 秒后自动重启，连续 20 次后停止并提示查看日志。**这就是「服务端崩溃自动重启」的实现，不依赖任何第三方进程守护工具。**
- `NERV-Panel.vbs`：用 `WScript.Shell.Run(cmd, 0, False)` 隐藏窗口调用 `start.bat`，用于开机自启时不留黑窗。
- `scripts/install-autostart.ps1`：在当前用户的启动文件夹创建指向 `NERV-Panel.vbs` 的快捷方式，实现**登录即自启**；支持 `-Remove` 卸载。不需要管理员权限。
- `server/wake.js`：第二层平板唤醒。读 `tabletWakeEnabled` / `tabletWakeUrl` / `tabletWakePassword`，通过 FreeKiosk 的 REST API 发亮屏请求（端点写法一律以 `tabletWakeUrl` 配置为准，代码不假定端口与路径；密码以 `X-Api-Key` 请求头带上）；失败重试 2 次（间隔 2 秒）；地址仍是含 `<>` 的占位值或未开启开关时**直接跳过并写日志**，绝不报错；全程参数来自配置，代码里没有任何 IP/端口/密码。
- `server/index.js`：`server.listen` 成功后调用 `wake.wakeTablet('服务端启动')`，默认关闭状态下这一行只产生一条「已跳过」日志。
- `TABLET-SETUP.md`：平板端设置指引。含 Windows 防火墙放行、**FreeKiosk 基础模式三步安装法**、简体中文需用 GitHub beta 版、HarmonyOS 纯净模式拦截的处理、Start URL 格式、隐藏全部浏览器元素、Auto-start on Boot、Keep Screen On、Auto Reload、Screen Orientation = Auto、Screen Scheduler 定时唤醒/睡眠（可选）、Kiosk 模式与退出方式，以及第二层 REST API 的开启步骤（**默认端口 8080、端点 `/api/screen/on`、`X-Api-Key`**）、平板 IP 获取、三个配置项对应关系、手动验证方法和常见问题表。**明确写明不使用 Device Owner 模式、不需要 ADB、不需要购买 PLUS 授权。**
- 日志滚动：`server/logger.js` 按天切分（`YYYY-MM-DD.log`）、单文件超 8MB 追加 `.1.log` 序号、保留最近 30 个文件。

### 未能读取的字段

（本阶段不涉及硬件字段读取）

### 降级方式

- 未安装开机自启 → 手动双击 `start.bat` 或 `NERV-Panel.vbs` 即可，功能不受影响。
- 平板唤醒未开启或地址是占位值 → 服务端跳过并记日志，第一层（浏览器自启动 + 常亮）仍照常工作。
- 平板唤醒请求失败 → 服务端重试 2 次后放弃，只写日志，面板本身不受影响。

## 阶段 7 记录（性能与收尾）

### 完成内容

- **时钟改为整秒对齐定时器**：不再用 `requestAnimationFrame` 递归（120Hz 屏每秒唤醒 120 次、119 次空跑）。改为 `setTimeout(1000 - now.getMilliseconds())` 递归，只在真正跨秒时唤醒。
- **进度条改用 `transform: scaleX()`**：`.bar i` 原来是 `transition: width`，每秒刷新会触发重排。现在固定 `width: 100%` + `transform: scaleX(n)` + `transform-origin: left center`，只走合成层。`setBar(el, v)` 统一处理，磁盘条同改。
- **`will-change` 收窄**：`.page-in` 原来常驻 `will-change: transform, opacity`，等于给每个页面各预留一个合成层。改为只在 `body.orienting .page-in` 生效（横竖屏过渡那 0.56 秒），过渡结束自动释放。
- **开机动画时长对齐需求**：分段进度条每次 +5%（20 段 × 160ms = 3.2 秒）+ 上滑退场，总时长落在第 6.2 节要求的 3–5 秒区间。
- **页面隐藏时全量暂停**：`visibilitychange` 挂起，平板息屏或切走时停掉时钟、天气、系统计时与走势线，回来再恢复。
- **走势线不补零**：取不到值时跳过这一帧，避免图表被假的 0 拉出尖谷。
- **README 全量重写**：补技术栈与版本、字体来源、配置项逐条解释、Token 使用流程、换主视觉图步骤、目录结构、开机自启原理、接口一览、硬件数据来源与读不到字段表、可选第三方方案、常见问题排错。

### 长时间运行

需求要求「连续运行 2 小时，数据不断流，内存没有明显持续增长」。按用户要求**不做运行测试**，因此这一项未实测，记录为待用户验证项。代码层面已消除已知的增长源：

- WebSocket 订阅在 `ws.close` 时 `unsub()` 注销，服务端另有 30 秒心跳 `terminate()` 清理僵尸连接，不会累积订阅者。
- 走势线历史数组 `HIST_LEN = 60`，`push` 后超长 `shift`；服务端历史缓冲 `HISTORY_CAPACITY_MS = 12 分钟`，按时间淘汰。
- 磁盘扫描、GPU 信息、CPU 静态信息、进程表、媒体会话均有 TTL 缓存，不会每秒重复起子进程。
- 日志按天切分 + 8MB 上限 + 只留 30 个文件，不会写爆磁盘。
- `netwatch` / `media` 的常驻子进程退出后按指数退避重启（1s→30s 上限），不会进程风暴。

### 未能读取的字段

（本阶段无新增硬件字段读取）

### 降级方式

- 120Hz 平板上若仍有卡顿，先确认 FreeKiosk 内置 WebView 是否开启了硬件加速；其次可在 `config.json` 把 `refreshIntervalSec` 调大到 2–3 秒降低刷新负载。
- `prefers-reduced-motion: reduce` 下所有动画均降级为无动画，功能不受影响。
- 无法实测 2 小时长跑的环境里，可观察 `logs/` 是否出现重复的「WebSocket 客户端接入/断开」冲刷，以及任务管理器里 `node.exe` 内存是否稳定在几十 MB。

## v3 改版记录（四页 → 两页 + 新接口）

### 结构改动

| 项目 | v2（旧） | v3（当前） |
| --- | --- | --- |
| 页面数 | 4 页：启动 / 总览 / 硬件监控 / 系统 | **2 页：监控 / 启动** |
| 默认页 | 总览 | **监控**（第一页） |
| 页面切换 | 底部毛玻璃 Dock + 胶囊滑块 | **顶栏右上角 2 个按钮 + 滑动高亮胶囊** |
| 底部导航 | 有（含 Home 小横条） | **全部删除，无 Dock、无 Home 条** |
| 页码点 | 4 个 | **2 个菱形** |
| 开机动画 | 大字标题组 + NERV 霓虹闪烁 + 「EVA-02，启动！」按钮 | **删除全部大字与按钮**，MAGI 上/日志下（竖）或 MAGI 左/日志右（横），表决依次播放，结束时整体 `translateY` 上滑退场 |
| 字体 | ZCOOL 用于大标题 | **删除 ZCOOL**，中文正文一律 Noto Sans SC |
| 卡片详情 | 无 | **8 类卡片可点开详情层** |

### 新增文件

- `server/netwatch.js` + `server/ps/net-counters.ps1`：常驻子进程读网卡累计字节，算实时速率。
- `server/media.js` + `server/ps/media-session.ps1`：Windows 系统媒体会话（SMTC）的 Node 封装，常驻循环模式 + 一次性控制模式。**不调用任何音乐软件私有接口。**
- `server/procs.js`：`tasklist` 进程表缓存、按进程名正常关闭。
- `server/favorites.js`：常用软件增删与解析。
- `server/hero.js`：主视觉图片上传（魔数校验、独立存储、不覆盖默认图）。

### 新增接口

| 接口 | 说明 |
| --- | --- |
| `GET /api/metrics/history` | 最近 12 分钟历史（需求要求至少 10 分钟），`?minutes=N` 可调 |
| `GET /api/favorites` | 按 `favoriteAppIds` 顺序解析，含 `running` |
| `POST /api/favorites` | `{action:"add"\|"remove", id}`，id 须在全量列表内 |
| `POST /api/close-app` | 只关该 id 对应进程，正常关闭优先 |
| `GET /api/media` | SMTC 当前会话：歌名/歌手/是否播放/来源应用 |
| `POST /api/media/control` | 只接受 `prev`/`playPause`/`next` |
| `POST /api/hero-image` | 上传本地图片，写回 `customHeroImagePath` |
| `POST /api/hero-image/reset` | 恢复默认图 |
| `GET /custom-hero/:file` | 提供用户上传的图 |

### 新增配置项

- `customHeroImagePath`（默认空）：用户换的主视觉图，为空时用 `heroImagePath`。
- `favoriteAppIds`（默认 `[]`）：只存 id，顺序即显示顺序，由服务端写回，**不预置任何应用**。
- `tabletWakeUrl` 默认值改为 `http://<平板IP>:8080/api/screen/on`（FreeKiosk REST API 格式）。
- 旧配置自动迁移：`weatherApiUrl` 为空补默认源；`tabletWakeUrl` 若还是「命令塞进查询串」的旧格式（含 `cmd=` 参数）则换成 FreeKiosk 默认地址。

### 详情层（8 类卡片）

时间 / 天气 / 日历 / CPU / GPU / 内存 / 网络 / 磁盘。上区小卡与下区大卡指向同一份详情，监控页内打开，不新增页面。通用内容：完整数值 + 最近 10 分钟走势（历史 + 实时续接）+ 最高/最低/平均值；历史不足时按实际时长注明；读不到显示「—」。

- 时间：完整日期时间含秒、服务端运行时长、本次连接时长、网络延迟。
- 天气：全部字段 + 未来 3 天。
- 日历：放大月历 + 可切上月/下月（只改显示，不动系统日期）。
- CPU：含**每核心占用**（`currentLoad().cpus[].load`，本机 12 线程全部读到）。
- GPU：含显存占用率。
- 内存：含可用量。
- 网络：上下行曲线 + 最高/最低/平均；**累计流量不显示**（系统接口未提供真实累计值，按降级处理并在界面注明）。
- 磁盘：**逐盘容量明细，不画曲线**（文档明确这不算缺失）。

### 启动页改动

- 上区：默认只显示 `GET /api/favorites`，空态给「添加常用」入口；挑选界面才调 `GET /api/apps` 全量（带搜索 + 游戏/软件分组，依据服务端 `type`）。运行中的应用有独立「关闭」按钮，与图标启动区明确分开。
- 中区搜索：空词只显示常用，有词才在全量里搜。
- 音乐卡片：常驻，标题「网易云音乐」；启动入口从扫描列表解析 id；歌名/歌手来自 SMTC；**只有 3 个按钮**（上/播/下），播放暂停图标按 `isPlaying` 切换并带淡入淡出+缩放。无媒体会话时显示「—」，三键置灰。
- 下区：电源与系统按钮在最下方一排（电源 5 项全部二次确认，显示/系统 2 项不二次确认）；连接状态与设置收进顶栏右上角的「设置」面板（含更换主图）。

### 开机动画改动

- 顶栏恢复原样：左 `NERV HQ · MAGI SYSTEM`、右 `EVA-02`、中间 ● REC 眨眼。
- **删除**：大字 NERV 标牌、`EVA-02` 大字、「明日香 · 指挥面板」、`PC MONITOR SYSTEM` 那行、「系统启动中...」、「EVA-02，启动！」按钮。
- 表决依次播放：初始三台都不亮 → MELCHIOR-1 承認（500ms）→ BALTHASAR-2 承認（1250ms）→ CASPER-3 红色否定 + 呼吸（2000ms）→ CASPER-3 翻转成绿色承認 + 中央核心全亮（3050ms）。
- 三台全承認后整体 `transform: translateY(-102%)` 上滑退场，不是淡出。兜底 6 秒强制退出。
- 进度条固定步进（去掉原型的随机数）。
- **遮挡问题已修复**：日志区 `.boot-log` 设固定高度 + 内部滚动，永不压 MAGI 区；横竖屏三种窗口尺寸下三个框与三枚印章全程完整可见（截图逐张核对过）。

### v3 改版中修掉的缺陷

1. **GPU 型号显示 `[object Object]`**：`metrics.js` 的 `warmUp()` 里误写 `gpuStatic.get(() => si.cpu())`，把 CPU 对象塞进了 GPU 型号缓存（TTL 5 分钟）。删掉该行，GPU 型号由 `collectGpu()` 自己写入。
2. **页标题「监控」糊字重影**：ZCOOL 缺字。删除 ZCOOL 字体与 `--eva-title` 变量，中文回落 Noto Sans SC。
3. **CPU 频率显示 0.00 GHz**：`si.cpuCurrentSpeed().avg` 单位本就是 GHz，原代码当 MHz 处理，前端又除 1000。改为 `Math.round(speed.avg * 1000)` 统一存 MHz。
4. **延迟一直显示「—」**：`fetchStatus()` 里多了个 `conn.online` 判断，且 `startStatusTimer()` 不立即拉一次。去掉多余判断 + 启动时立刻量一次。
5. **开始菜单垃圾项过多**：`JUNK` 正则扩充（卸载/激活/注册/诊断/教程/示例/日志/配置等），154 项 → 126 项。
6. **开始菜单乱码名「绉婚櫎 MathType」**：「移除」的 UTF-8 字节被按 GBK 解码。新增 `decodedName()`，把乱码串按 GBK 编码回字节再按 UTF-8 解码；判据是「结果变了且不含替换符」。`iconv-lite` 提为直接依赖。
7. **`history.start()` 从未调用**：`/api/metrics/history` 一直返回空。在 `server.listen` 回调里补上。
8. **`[hidden]` 被 `display:flex` 覆盖**：补全局 `[hidden] { display: none !important; }`。
9. **`notifyVisible()` 传错参数**：传的是钩子下标而非页面下标，导致页面 1/2/3 的定时器从不启动。
10. **154 个应用图标全是同一张白图**：`ensureIcon()` 把反斜杠转义成 `\\` 塞进 PowerShell 双引号串，PowerShell 里反斜杠不是转义符，`ExtractAssociatedIcon` 收到不存在的路径后静默返回通用空白图标。新增 `psQuote()` 只处理反引号/双引号/`$`，并加 `$ErrorActionPreference="Stop"` 与显式存在性检查。
11. **首次打开启动页要干等约 35 秒**：图标按需生成太慢。新增 `prewarmIcons()` 3 并发后台预热 + 启动 3 秒后主动扫描触发 + 前端先显示占位再淡入。

### 截图验收后修的 UI 缺陷（第五轮）

| 缺陷 | 原因 | 修复 |
| --- | --- | --- |
| 设置区「服务端地址」输入框空白 | 该字段是 `<input>`，`fillSettings()` 用 `setText()` 走 `textContent` 赋值，对表单控件不生效 | 改成直接写 `.value`；另把全站 50 个 `setText()` 目标 id 与 HTML 标签逐个核对，确认只有这一处是表单控件 |

### v3 未能读取的字段

- **CPU 温度**：仍为 `null`（WMI 两条路径都已试过，普通权限读不到）。
- **网络累计流量**：SMTC 与系统接口均未提供，按降级不显示，界面注明。
- **媒体会话**：本机当前无正在播放的媒体，`/api/media` 返回 `available:false`。这是如实结果，不是缺陷。
- **Steam 游戏**：本机未装 Steam，游戏分组为空。

### v3 降级方式

- 媒体会话读不到 → 显示「未在播放」+「电脑上没有正在播放的媒体」，三个控制键置灰。
- 历史不足 10 分钟 → 详情层按实际积累时长注明（如「最近 6 分钟（历史已积累）」）。
- 应用无执行文件名（Steam 游戏）→ `running` 返回 `null`，界面不显示运行状态，不谎报「未运行」。

### 第六轮：一屏不滚动 / 监控页去重 / 启动页横屏左右 / 系统按钮一排 / 设置收进按钮

按用户新提的五条改造要求执行（本轮不改功能范围，只改版面结构与信息归并）。

#### 1. 一屏不滚动
- `.page` 由 `overflow-y:auto` 改为 `overflow:hidden`，高度锁死视口；`.page-in` 加 `height:100%;min-height:0`，用 flex 撑满。
- 竖屏与横屏两套尺寸全部改用 `clamp(...vh...)` 随视口缩放：卡片内边距、字号、进度条高度、主图高度、电源按钮高度都跟着走。
- 只有三处允许内部滚动：详情层 `#detailSheet`、挑选层 `#pickSheet`、设置面板 `#settingsSheet`；另外常用软件列表 `.app-scroll` 在自己的小容器里滚动，不影响整页。
- 实测（`scripts/diag-flow.js` + `_diag_cards.js`，均为开发期脚本）：横竖屏 × 监控/启动两页，`.page` 与 `.page-in` 的 `scrollHeight - clientHeight` 均为 `0`；硬件卡、磁盘列表、天气卡、日历卡内部溢出全部为 `0`。

#### 2. 监控页整合去重
- 删除原「上区总览」的 CPU / GPU / 内存 / 网络四张小卡（`#miniCpu` / `#miniGpu` / `#miniRam` / `#miniNet`），只保留下方一套硬件卡；`renderMetrics()` 里对应的 8 行 `setText` 一并删除。
- 保留的六张硬件卡：CPU、GPU、内存、网络、磁盘、风扇，各只出现一次。时间与同步率在主视觉里各出现一次，天气与日历各一张卡。
- 横屏：`.mon-top` 左主图（时间 + 同步率）右天气与日历，底部 `.hw-row` 六列一排。
- 竖屏：`.mon-top` 单列两行（主图压矮 0.8fr，天气日历并排 1fr），`.hw-row` 三列两行。
- 硬件卡整块可点即进同一份详情；卡片上的「详情 ›」角标已移除（原来绝对定位压住右上角的温度/容量数值），只保留主视觉、天气、日历三处角标。

#### 3. 启动页横屏左右排布
- 横屏 `.launch-grid` 两列：左 `.music-col`（音乐卡片），右 `.apps-col`（常用软件 + 搜索 + 结果）。
- 竖屏 `.launch-grid` 单列：音乐在上（横向紧凑排），常用软件在下，`.app-scroll` 内部滚动。
- 常用软件空态挪进 `.app-scroll` 并设 `flex:1`，占满整列高度居中显示，不再在下方留一片空白。

#### 4. 系统按钮下方一排
- `.power-row` 七列一排：锁屏 / 注销 / 睡眠 / 重启 / 关机 / 熄灭显示器 / 任务管理器，全部在页面最下方。
- 窄屏（`@media (max-width:720px)`）与矮屏压缩档里，次要的「注销 / 熄灭显示器 / 任务管理器」同时在设置面板的「更多系统操作」里保留一份，功能不删。
- 电源 5 项仍需二次确认；显示与系统 2 项按需求不做二次确认。

#### 5. 设置收进一个按钮
- 顶栏右上角新增 `#settingsBtn` 齿轮按钮，全站唯一设置入口。
- 新增 `#settingsSheet`（底部升起面板）：连接状态 5 项（电脑名称 / 局域网地址 / 服务端版本 / 已连接时长 / 当前延迟）+ 7 个设置字段（服务端地址只读、访问令牌、刷新间隔、天气城市、主视觉图片 + 更换主图 / 恢复默认、平板唤醒地址、唤醒 API Key）+ 唤醒开关 + 保存按钮 + 「更多系统操作」。
- 启动页原来平铺的 `.conn-grid` 连接状态区与 `.set-grid` 设置区已从页面删除，页面上不再有任何设置字段。
- `app.js` 新增 `openSettings()` / `closeSettings()`；`focusSetup()` 由「跳启动页 + 滚到令牌框」改为「打开设置面板 + 聚焦令牌框」；Escape 判断链与方向键忽略逻辑都补上了设置面板。

#### 本轮修掉的问题
| 现象 | 原因 | 修复 |
| --- | --- | --- |
| 竖屏硬件卡内部被压扁（4 张卡溢出 27–30px、风扇卡溢出 16px） | 竖屏 `.mon-top` 两行比例 0.95fr/0.85fr 把上半区撑太高，`.hw-row` 只给 150–206px | 行比例改 `minmax(0,0.8fr) minmax(0,1fr)`，`.hw-row` 改 `clamp(212px,22.6vh,292px)`，并收窄卡片内边距 |
| 硬件卡「详情 ›」角标压住右上角温度 / 容量数值 | `.more` 绝对定位 `top:10px;right:12px`，与 `.stat-top` 右侧数值同位 | 硬件卡不再放角标（整块可点已够），角标只留主视觉 / 天气 / 日历 |
| 日历卡「详情」压住 `TODAY·24` | `.cal-head` 没有右侧留白 | 给 `.cal-head` 加 `padding-right:52px` |
| 竖屏天气卡内容偏上、下方大片空白 | `.weather` 用 `justify-content:center` | 改 `space-evenly` + 放大图标/温度/副文字号 |
| 启动页常用软件为空时下方一大片空黑 | `#favEmpty` 在 `.app-scroll` 外面，撑不满列高 | 挪进 `.app-scroll` 并设 `flex:1` 居中 |

#### 本轮未能读取的字段
- **风扇转速**：`systeminformation@5.33.24` 没有风扇 API（60 个导出里只有 `cpuTemperature`）；`Win32_Fan` WMI 能返回两个 Cooling Device，但 `DesiredSpeed` 为空；`MSAcpi_ThermalZoneTemperature` 普通权限拒绝访问；`root/OpenHardwareMonitor` 命名空间不存在（未装 OHM）。风扇卡显示「—」并注明「系统接口未提供转速」。
- **CPU 温度**：仍为 `null`（与之前一致）。

#### 本轮降级方式
- 风扇卡读不到转速 → 数值位显示「—」，副标题写「系统接口未提供转速」，进度条空置；不编造 RPM。
- 整页不滚动后若用户把系统字号调得很大 → 各卡片仍按 `clamp` 缩放，极端情况下靠内部 `.app-scroll` 与详情层承接；不新增横向滚动。

### 第七轮：横竖屏 UI 统一 / 音乐卡占满 / 4 按钮 / 农历节日 / 天气曲线 / CPU 名修复 / exe 设置窗口 / 不弹网页

改动：顶栏右上角监控/启动/设置三合一、主图缩小硬件卡放大、天气详情当日逐小时曲线、日历详情可切年月 + 农历/节日/节气、去左右翻页箭头；音乐卡占满 + 无红色启动按钮（点播放即启动网易云）+ SMTC 封面；竖屏监控页硬件优先、顶栏补网址；横竖屏底部只留锁屏/睡眠/重启/关机 4 个；CPU 型号去「Intel Gen」前缀；天气统一一天一种；exe 自带 TK 设置窗口（Token 等直接改）且启动不弹网页。

关键技术点：
- 农历/节日/节气做成自包含 `public/js/lunar.js`（零外链），日历详情与主卡共用。
- SMTC 缩略图：`server/ps/media-session.ps1` 读 `MediaProperties.Thumbnail` → Node 缓存 → `/api/media/thumbnail?hash=`。
- exe：PyInstaller onefile + pystray 托盘 + loopback 专用 `/api/settings/local`（仅本机可访问、免 token）供设置窗口读写。
- 服务端 `config.js` 增加 mojibake 迁移（旧版按 GBK 写盘导致 `weatherCity=鍚堣偉`，自动还原为 合肥）。

### 第八轮：托盘图标必定出现 / 左键=设置 / 右键菜单完善 / 设置窗口开机自启 / 保存即生效

- 根因修复：pystray 提供自定义 setup 时不会自动 `visible=True`（只有默认 setup 会），`on_ready` 显式置 `icon.visible = True`，否则托盘图标「注册了却不显示」。
- 左键单击托盘 = 打开设置（default 菜单项）；右键菜单：打开设置 / 打开面板 / 查看本机局域网 IP / 复制地址（子菜单）/ 开机自启 / 退出。
- 设置窗口新增开机自启开关（写 `HKCU\...\CurrentVersion\Run` 的 `"<exe>" --autostart`）；端口等 `needsRestart` 改动保存后自动 `ServerSupervisor.restart()`，无需重启 exe。
- `--autostart` 后台静默启动（不弹网页、不弹黑窗）；单实例重复拉起直接退出。

### 第九轮：顶栏只留监控/启动 + 设置移底部第 5 键 / 标题中英 / 日历节气加高 / 音乐改小封面居中 / 中文乱码修复 / 点播放真播放 / 常用可添加 / 托盘像素实证 / 双版本打包

- **顶栏**：右上角只留「监控 / 启动」两个按钮（无设置齿轮，贴右上角）；设置入口改到**启动页底部第 5 个按钮**（锁屏/睡眠/重启/关机/设置）。
- **标题**：`data-title` 直接含中英「监控 MONITOR」「启动 LAUNCH」；删除启动页「音乐 MUSIC」分区标题（`.p-en` 废弃隐藏）。
- **日历**：`.cal-grid` 行高 `minmax(clamp(24px,4.1vh,38px),1fr)`，`.lun-tag` 字号/行高提升、去掉裁切，节气/节日小字完整显示。
- **音乐**：三个控制键改小（普通 `clamp(30px,4.4vh,42px)`、主键 `clamp(36px,5.4vh,50px)`）；封面移到曲目与按钮之间居中。
- **中文乱码修复**：`media-session.ps1` 强制 `[Console]::OutputEncoding = UTF8`（PS 5.1 默认 ANSI/GBK 输出会把 UTF-8 中文打烂）；实测真实会话歌名「解药」/歌手「陈奕迅」正常。
- **点播放真播放**：SMTC 有会话时 `isPlaying=false → play`、`true → pause`，播放键图标跟随；无会话先启动网易云，轮询等会话出现自动发 `play`；PS `control` 新增 `play`/`pause`（`TryPlayAsync`/`TryPauseAsync`）。
- **常用软件**：确认「＋ 添加常用」按钮存在且横竖屏可见可点（打开 `pickSheet`）。
- **CPU 温度（先查不改）**：LHM/OHM/HWiNFO/CoreTemp 均无进程无服务、`root\LibreHardwareMonitor` WMI 命名空间不存在、`si.cpuTemperature()` 实测 `{"main":null,"cores":[],"max":null,...}` → 如实「—」。需要装 LibreHardwareMonitor（或 HWiNFO64）并以管理员运行其后台服务。
- **托盘实证**：任务栏右下角聚类到 36×36 红色实心块（RGB≈220,3,30 ≈ NERV 红），`SystemTrayIcon` 窗口由 NERV 进程持有。
- **双版本交付**：`dist\NERV Panel.exe`（免安装 onefile，140.7MB）+ `dist\NERV Panel 安装版.exe`（Inno Setup 6，141.4MB；静默安装/卸载实测通过）。

### 第十轮：日历卡只显日期 / 启动页顶部对齐 / 封面居中铺满 / 关闭按钮修复 / 底部 5 键 / 添加常用右移

需求（用户第十轮）：监控页日历卡面只显示日期，节日/农历/节气留给日历详情；启动页横屏音乐与常用软件顶部对齐、音乐封面居中且内部占满；常用软件卡的「关闭」必须能关；启动页底部一排 5 键（锁屏/睡眠/重启/关机/设置）；「添加常用」移到搜索框右边并缩短搜索框。横竖屏都要改。

实现：
- `public/js/app.js` `renderCalendar()`：删除卡面的 `lun-tag`（农历/节日/节气）输出，只渲染日期；`monthGridHtml()`（详情层大日历）保持原样，仍显示 `dl-sub` 农历/节日/节气。卡面日期字号因此从 `clamp(10.5px,1.5vh,13px)` 提到 `clamp(11px,1.6vh,14px)`，`.lun-tag` 三条规则随之删除。
- 顶部对齐：`.music-col .music-card{justify-content:flex-start}`、`.music-body{justify-content:flex-start}`、`.music{justify-content:flex-start}`（原都是 center），`.mctrl` 单独 `justify-content:center`。
- 封面居中铺满：`.music-cover` 改为 `flex:1 1 auto;align-self:stretch;width:100%;margin:0 auto;min-height:0`，图片 `object-fit:cover` 铺满；占位音符 `.mc-ph` 限制在 36% / 96px 内不撑爆。竖屏单独给 `flex:0 0 clamp(96px,13vh,140px)` 的正方形位（实测横屏 cover 563×389、占卡片 66.5% 高；竖屏 140×98）。
- 关闭按钮修复（真 bug）：`.app .ico-hit` 是 `position:absolute;inset:0;z-index:1` 的整卡点击层，`.app .app-ctrl` 原来没定位，控制条被压在下面 → 点「关闭」命中的是启动层。改为 `.app .app-ctrl{position:relative;z-index:2}`，用 CDP `elementFromPoint` 实测横竖屏 `closeBtn.isSelf === true`（命中自己）。
- 「添加常用」右移：`index.html` 新增 `.search-row` 容器，把 `.search-box` 与 `#addFavBtn`（新类 `.add-fav`）并排；`.search-row .search-box{flex:1 1 auto;min-width:0}`。旧 `.fav-actions` 三条规则与其在按压动效表里的引用一并删除。
- 底部一排 5 键：`.power-row` 为 `lock / sleep / restart / shutdown / 设置(#openSettingsRowBtn)`，横竖屏各 5 列。

未能读取的字段：本轮无新增。

降级方式：封面没有 SMTC 缩略图时仍显示居中音符占位（不编造封面）。

### 第十一轮：去掉「常用软件」标题行 / 空态紧凑条带 / 封面放大居中 / 三键等大 / 音乐占比与文字对齐修正

需求（用户第十一轮，含随后的三条修正）：启动页删掉「常用软件 FAVORITES」标题行（横竖屏都删），常用软件直接从搜索框开始；常用为 0 项时空态改为紧凑条带、不占大半屏；音乐专辑封面放大并居中；上一首 / 播放暂停 / 下一首三个按钮一样大（横竖屏都要）。随后修正：**「＋ 添加常用」全站只保留搜索框右侧那一个**（m03707）；**竖屏音乐比常用软件稍微小一点**（m03728）；**音乐卡里的「未在播放」等文字与上方标题左对齐**（m03789）。

实现：
- 标题行删除：`public/index.html` 里 `.apps-col` 内的 `<div class="sec-head"><h3>常用软件</h3>…</div>` 整块删掉，`#favCount` 占位 span 一并删除（`app.js` 里对应的 `setText($("favCount"), …)` 死代码也删了）。搜索结果的 `.sec-head` 在 `#searchBlock` 内部，属于搜索态，保留。
- 竖屏比例（按 m03728 的修正）：`.launch-grid` 竖屏为 `grid-template-rows:minmax(0,0.92fr) minmax(0,1fr)` —— 音乐略小于常用软件；`.launch-grid.is-empty` 的行高覆写已删除，空态不再改变比例。CDP 实测竖屏 `gridRows "509.828px 554.156px"`（音乐 510px / 常用 554px）。
- 空态紧凑条带：`#favEmpty` 加 `.strip` 类，`.app-empty.strip{flex:0 0 auto;justify-content:center;text-align:center;…}` 只有一行 `#favEmptyTx` 文案；`.apps-col.is-empty .app-scroll{justify-content:center}` 负责垂直居中。CDP 实测竖屏条带 760×42、文字 91×20，与滚动容器中心差值 `dxCenter=-1`、`dyCenter=0`；横屏 `dxCenter=-1`、`dyCenter=0` —— 即**水平与垂直都居中**（后续按 m03846 的修正）。
- 「添加常用」单入口（按 m03707 的修正）：条带内的 `#addFavBtn2` 按钮、`.strip-add` 规则、`.apps-col.is-empty .search-row .add-fav{display:none}` 反向规则、以及对应的 JS 绑定全部删除。CDP 实测 `addButtons` 只剩 `[{id:"addFavBtn", visible:true}]`（横竖屏都是）。
- 封面放大居中：竖屏 `.music-cover` 改 `flex:1 1 auto;width:100%;min-height:clamp(96px,14vh,150px)`、`.mc-ph` 放大到 34% / 200px；`.music` 竖屏改 `flex-direction:column`。
- 文字左对齐（按 m03789 的修正）：`.music .track{text-align:left}`（基础规则与竖屏覆写都改）、竖屏 `.music-head{justify-content:flex-start;text-align:left}`。CDP 实测「网易云音乐」标题与 `#trackName` / `#trackArtist` 左边缘差值 `alignName: 0`、`alignArtist: 0`（横竖屏均为 0）。
- 三键等大：删掉 `.mctrl button.main` 的 `width/height`（原 `clamp(36px,5.4vh,50px)`，比两侧 `clamp(30px,4.4vh,42px)` 大一圈），只保留红色配色与边框；`.main svg` 从 48% 回落到 44% 与两侧一致。CDP 实测：竖屏三键均 42×42、横屏均 35.2×35.2，`equal: true`。

未能读取的字段：本轮无新增。

降级方式：专辑封面仍无 SMTC 缩略图时显示居中音符占位，不编造封面图片。
### 第十二轮：横屏日历裁切 / 竖屏同步率重叠 / 天气常丢 / 7 日曲线 / 关闭真结束 / 熄屏点亮重播开机动画

需求（用户第十二轮）：监控页横屏右侧日历底部几行被裁；竖屏同步率与时间重叠；天气有时读不到；天气详情加 7 日温度曲线；启动页常用应用点「关闭」结束不了进程；平板每次熄屏点亮都弹出启动界面。横竖屏都要改。

实现：
- **日历裁切（CSS）**：`.cal-grid` 行高由 `grid-auto-rows:minmax(clamp(24px,4.1vh,38px),1fr)` 改为 `minmax(0,1fr)`。原来 6 行 × 最小 24~38px 再加表头，总最小高超过 `.cal-card` 可用高度，`overflow:hidden` 把底部几行直接切掉。改为只按剩余空间均分后横竖屏都装得下（CDP 实测强制 6 行占位后 `overflowPx:0`）。
- **竖屏同步率重叠（CSS + HTML）**：`.syncbox` 从 `.hero-visual` 直接子元素挪进 `.hv-in` 作为第一个子元素。竖屏 `.hv-in` 改为 3 行网格：同步率 `grid-column:1/-1;grid-row:1`、时钟 col1/row2、日期 col2/row2、状态行 col1/-1/row3，`.hv-in .syncbox{position:static}`。原来同步率绝对定位钉左上、时钟也在左上，必然重叠。横屏 `.syncbox` 的 `top/left` 由 `clamp(...)` 收为 `0`（定位基准变成 `.hv-in` 的 padding 盒）。CDP 实测横竖屏 `overlapClock:false`、`overlapDate:false`。
- **天气不再丢失（server/weather.js）**：`MAX_ATTEMPTS=4`、`RETRY_DELAY_MS` 指数退避（600/1200/2400ms）、HTTP 4xx 不重试；新增 `STALE_TTL_MS=6h` 兜底缓存，`getWeather()` 刷新失败时返回最近一次成功数据并标 `stale:true, staleAgeMin`；`FORECAST_DAYS=7`。
- **天气不再丢失（public/js/app.js）**：`loadWeather()` 失败不再 `wxEmpty()` 清屏，改走 `onWeatherFail()`：保留旧数据 + `15s/30s/60s` 退避重试；定时刷新从 10 分钟改为 5 分钟；`renderWeather` 在 `w.stale` 时于 `wxMeta` 追加「数据 N 分钟前」。
- **7 日温度曲线**：新增 `drawWeatherWeek(id, days)`（canvas 640×150，最高温橙色实线带渐变面积、最低温蓝色虚线，逐日标数值 + 日期）。`renderDetail('weather')` 把「未来 3 天」改为全部 7 天列表并插入该曲线；CSS 新增 `.sheet-box canvas.wx-week{height:150px}`。
- **关闭真结束进程（server/procs.js + apps.js + app.js）**：`killByName` 改三级——① 先 `taskkill /IM x /T`（优雅），清缓存 sleep 1200ms 复查；② 仍在则 `taskkill /IM x /T /F` 强杀，再 sleep 600ms 复查；③ 仍在则按 PID 用 PowerShell `Stop-Process -Force` 兜底，再 sleep 700ms 复查；只有三级都试过仍存活才返回失败，成功时带 `forced:true`。新增 `invalidate()` 统一清进程表缓存。
  **第十三轮修正（正式自检中发现）**：三次复查全部改用 `isAlive()`（PowerShell `Get-Process -Name x | Where-Object { -not $_.HasExited }`）判定，不再用 `tasklist`。实测确认——进程被强杀后 `tasklist` 仍会列出该映像约 8~9 秒（`/FO LIST /V` 连 Status 都还是 Running），而 PowerShell 的 `HasExited` 已经是 `True`；用 `tasklist` 复查会把「已经关掉」判成「还在跑」，于是返回 400 `CLOSE_FAILED`、界面上也继续显示「运行中」。这正是用户抱怨的现象在自检里的复现。另新增 `recentlyClosed` Map + `reconcileClosed()`：关闭成功后 20 秒内对缓存里的同名条目做一次 `HasExited` 复核，剔掉 tasklist 残留导致的卡片假阳性。`apps.closeApp` 记录「［强制结束］」并透传 `forced`。前端 `closeApp` 不再用固定 1.6 秒后刷新，改为接口返回后立即刷新 + 900ms 再补一次，并在 toast 里注明「（已强制结束）」。
- **熄屏点亮重播开机动画（public/js/app.js）**：`visibilitychange` 里记录 `hiddenAt`，重新可见时若离开 ≥ `SCREEN_OFF_MIN_MS=3000` 则 `replayBoot()`。新增 `resetBootUi()`（清 `bootTimers` 的 setTimeout 与 setInterval、复位 `progress/progressDone/voteDone/bootDismissed/unlockScheduled/bootAlert/bootApproved`、移除 `done/boot-unlocked/boot-alert/boot-approved`、清 `#bootLog`、三台主机 `.lit/.deny/.thinking` 与印章文字回「待機」、三条连线与 `#voteCore` 熄灭、`setCaption` 复位、`setSegs()`）与 `replayBoot()`（`goTo(0,{instant:true})` 后 `startBoot()`）。
- **调试钩子**：`window.NERV_DEBUG.loadWeather` / `window.NERV_DEBUG.weatherData()`，仅供 `scripts/verify-fixes.js` 自动化验收使用。

验收脚本（新增，均为开发期脚本）：
- `scripts/shoot-fixes.js`：Edge headless + CDP，输出横竖屏监控页与天气详情 4 张图到 `preview/fixes/`；同时用 DOM 矩形自检日历是否溢出（会临时补 7 个占位格子强制 6 行）与同步率/时钟是否相交。
- `scripts/verify-fixes.js`：13 条断言全通过 —— 熄屏 4 秒后 `#boot` 重新可见且动画状态复位、重播后正常退场、短暂切后台 1 秒不重播；天气接口 502 时温度/描述不被清空、仍保留数据对象、触发退避重试、恢复后能正常刷新。

实测数据：`/api/weather` 返回 `days=7`（今天 15/5、周四 19/8、周五 17/8、周六 15/5、周日 18/4、周一 21/7、周二 24/12）与 `hourly=24`；`killByName('nervtest.exe')`（`PING.EXE` 副本，无窗口）→ `{"ok":true,"message":"已强制结束","forced":true}` 2914ms；`killByName('notepad.exe')`（正常窗口）→ `{"ok":true,"message":"已关闭"}` 1880ms，走优雅路径；wordpad.exe 经 `POST /api/close-app` → 200 `{"ok":true,"name":"Wordpad","forced":false,"message":"已关闭"}` 1883ms，关闭后 `/api/apps` 中该项 `running:false`。

未能读取的字段：本轮无新增。

降级方式：天气上游持续不可用且无任何历史成功数据时，仍显示「—」（不编造数值）；三级关闭都试过进程仍存活时如实返回失败原因（`detail` 带原始 taskkill 报错首行）。

补充（重打包 + 打包版复验）：`D:\Python\Python312\python.exe packaging\build.py` 重打包后，`dist\NERV Panel.exe` 58.8 MB、SHA256 `169FAC1703D2EF7D86A4918D98D593B9EE014C12D7843B0D03B7E4F42D41FBDA`；从 exe 内抽出的 `bundle\server\procs.js` 与源码 SHA256 同为 `CA770D3D27F884F0970CD861ACA1A90BD46C95B4C67AEF6631B5E2B9C47A97CC`，确认修复已真正进包。针对打包版 exe 复验：`/api/status` 1 秒内 200、`POST /api/close-app` 关 Wordpad **200「已关闭」1818ms**（修复前同一路径是 400 `CLOSE_FAILED`）、700ms 后 `/api/apps` 该项 `running:false`、而同一刻 `tasklist` 仍残留该进程且 `HasExited` 计数为 0；`verify-fixes.js` 13/13、`diag-flow.js` 四视图无溢出、`verify-ui.js` 五卡全 ok、WebSocket 无 token 401 / 带 token 通。

另记一个真实环境坑：首次启动打包版时服务反复 `code=2` 退出、`/api/status` 20 秒不通，日志「端口 5000 已被占用」；占用者是 Clash Verge 的 `verge-mihomo.exe`（临时 Bind 0.0.0.0:5000），另有 `lkcitdl.exe` 占 UDP 5000。释放后重启即正常，README 的「启动报端口 5000 已被占用」已补排查命令与该案例。

### 第十四轮：MAGI 表决图三框不再挤压（中间六边形加宽）/ 删掉下方 7 个进度圆点

需求（用户第十四轮）：启动页 MAGI 中间的六边形被左右 CASPER-3 / MELCHIOR-1 两个框夹住、太窄，「ALL APPROVED / 全票通过」显示不下；去掉 MAGI 下面 7 个橙色/紫色小圆点（元素与样式整个删掉，不留空块）。横竖屏都要改，且改完先出预览图确认再自检。

定位（改动前实测，`scripts/probe-magi.js`）：
- 旧实现三框全是 `position:absolute`：`.vote-box{width:47%}`，`.vote-box.top{left:50%;translateX(-50%)}`，`.bl{left:0}` / `.br{right:0}`（左右合计 94%），中间 `.vote-magi{position:absolute;left:50%;top:50%;translate(-50%,-50%);width:clamp(74px,17vw,96px)}`。**所以中间六边形必然骑在左右两框上**——横屏实测 `core_vs_casper` / `core_vs_melchior` / `core_vs_balthasar` 三向全部相交，`center_gap` 为 −31.2 / −31.1px；核心只有 96×84（占图宽 17.1%），`.core-approve` 文字框被压到 54×23.5。
- 7 个圆点是 `public/index.html` 里的 `<div class="vote-foot" aria-hidden="true"><i></i>…</div>`（7 个 `<i>`，中间一个 `.hot`），样式在 CSS 的 `.vote-foot` / `.vote-foot i` / `.vote-foot i.hot` 三条规则。

实现：
- **`.vote-diagram` 改成 3 行 2 列网格**（`grid-template-rows:auto minmax(0,1fr) auto`）：上框占第 1 行横跨两列，中央核心占第 2 行横跨两列，左右两框各占第 3 行一列（左贴左、右贴右）。`height` 改 `min-height:clamp(198px,31dvh,266px)`，让三段按内容撑开、不再被压扁。三块各占一行，**结构上就不可能再互相覆盖**。
- `.vote-box` 由 `position:absolute;width:47%` 改为网格项 `position:relative;grid-row:3;width:100%;max-width:300px`；删除 `.top/.bl/.br` 上的 `top/left/right/transform`。
- `.vote-magi` 由 96×84 放大到 **168×118**（`width:clamp(120px,21vw,168px)`、`height:clamp(88px,15vw,118px)`），占图宽 29.9%（横屏）/ 30.3%（竖屏，原 17.1% / 17.3%）。首版曾放大到 196×136，按用户看预览图后的反馈「中间六边形再小点」收到 168×118；`.core-approve` 由绝对定位改为网格项（`grid-row:2;grid-column:1/-1`），字号 `clamp(9px,1.7vw,12px)`（原 6.5~8.5px）；`@keyframes approveMark` 去掉 `translate(-50%,-50%)`。
- `@media (max-width:560px)` 的 `.vote-diagram{height:176px}` 改 `min-height:176px`（写死高度会把 3 行网格压扁，三框会重新重叠）。
- **7 个圆点整个删除**：`index.html` 那一整行删掉，CSS 三条规则一并删掉（不是 `display:none`）。全仓已无 `vote-foot` 引用（只有探针脚本里的检查语句还提到这个名字）。
- **连线跟随实测坐标**：新增 `layoutVoteLines()`，用 `getBoundingClientRect()` 量三个框与核心的实际中心，换算成 `.vote-diagram` 内百分比写回 `#lineTop` / `#lineBl` / `#lineBr` 的 `x1/y1/x2/y2`。原来这些是写死的百分比（`x1="50" y1="24"` 等），网格化后会飘出框外。`startBoot()` 与 `resetBootUi()` 末尾调用，并延迟 120ms / 600ms 各补一次（字体加载会改变尺寸）；`resize` 防抖回调里也重算（转向后）。

实测（`scripts/probe-magi.js`，横屏 1280×800 / 竖屏 800×1280）：
- 横屏：`.vote-diagram` 562×301.7；核心 **168×118**；上框 300×71 居中，左右框各 271×71；八项相交判定**全部 false**（`core_vs_casper` / `core_vs_melchior` / `core_vs_balthasar` / `casper_vs_melchior` / `casper_vs_term` / `melchior_vs_term` / `balthasar_vs_term` / `diagram_overflows_term`）。核心与下排两框的**纵向行距** 9.2px、与上框 10.1px，均不相交。
- 竖屏：同上，核心 168×118（占图宽 30.3%），行距 11.6 / 12.5px，八项相交判定全 false。
- 「ALL APPROVED / 全票通过」文字框 76.4×32.7，**四角全部落在六边形多边形内部**（`insideHexagon:true`），左右各余 3.8px、上下各余 42.6px（左右余量按六边形顶部平边 25%~75% 的保守口径算，实际斜边处余量更大）。
- 两个视口 `voteFoot:"ABSENT"`（7 个圆点已彻底消失）。
- 另在 1280×540 / 960×540 / 1024×600 / 560×900 / 480×800 五种小屏尺寸复测：核心 168×118（≤560px 时 120×88），三框仍无相交、`.vote-diagram` 不溢出 `.magi-term`、不溢出视口、`vote-foot` 均 ABSENT。

验收脚本（新增，开发期脚本）：
- `scripts/probe-magi.js`：量三框与核心矩形、8 组相交判定、行距、六边形四角判定（按斜边收窄计算，比内切矩形更严格）、`vote-foot` 是否存在。
- `scripts/shoot-boot.js`：输出 4 张图到 `preview/boot-fix/`（动画进行中 + 全票通过，横竖屏各一对）。踩坑记录：只把 `#boot` 设成 `display:flex` 会被开机动画的定时器在约 1 秒后滑走，必须先注入 `window.__forceBoot` 并用 `setInterval(…,100)` 反复钉住样式再截图。

未能读取的字段：本轮无新增。

降级方式：`layoutVoteLines()` 在元素尚未布局（尺寸为 0）时直接返回，不改连线坐标；纯 CSS 网格在极窄屏仍靠 `min-height` 兜底，不会被压成重叠。

### 第十五轮：离线告警改到顶部悬浮（不再占一整行）/ 主内容零位移

需求（用户第十五轮）：监控页底部那条「电脑端未连接 / 数据暂停更新，等待服务端恢复」占了一整行，要把告警从底部移走、改到监控页顶部——放在顶栏下面、主内容上面，做成**悬浮条**；悬浮条不占其他空间，不把主图 / 天气 / 日历 / 硬件卡往下顶，不改变一屏布局；断开时显示、连接恢复时自动消失；横屏竖屏都要改。

定位（改动前实测，`build/probe-band.js`）：
- 告警条原本是 `.page-in.mon-in` 里 `.hw-row` 之后的最后一个子元素，CSS 为 `.offline-banner{display:flex;...;padding:8px 14px;flex:none}`。`.page-in` 是 flex 列，`flex:none` 的条子**必然独占一行高度**，这就是用户说的「占一整行」。
- 布局带位置：`header.top` 底边 65；`.pager-head`（页标题 + 右上分页菱形那一行）y65–109（横屏 h44）/ y65–110（竖屏 h45）；`.page-monitor` 从 109/110 起；`.mon-in` 顶边 119/120（`.page` 有 `padding:10px`）。**`.pager-head` 左右两块内容之间是大片空白**（横屏标题右边界 140、分页菱形左边界 1196），是唯一真正的「顶栏下面、主内容上面」空白带。
- 第一次尝试把条子放 `.page-in` 里 `position:absolute;top:0`：实测落在 y=109/110，会**盖住** `.mon-top` 顶边（y=119/120）与竖屏左上角的 `.syncbox`（y142 起）→ 否决，改放 `.pager-head` 内居中。

实现：
- **HTML**：`public/index.html` 把告警节点从 `.page-in.mon-in` 移到 `.pager-head` 内（`.dots` 之后），内容拆成 `.ob-dot` / `b` / `.ob-tx` 三段（`.ob-tx` 是给窄屏隐藏后半句用的类）。
- **CSS**：`.pager-head{position:relative}`；`.offline-banner` 改为 `position:absolute;left:50%;top:50%;transform:translate(-50%,-50%);z-index:9`，`max-width:min(560px,72vw)`、`background:rgba(28,6,4,.86)` + `backdrop-filter:blur(6px) saturate(1.2)`、`padding:5px 14px`、`pointer-events:none`、`box-shadow` 双层（投影 + 红色微光），配 `@keyframes offlineDrop` 0.3s 下落淡入；`@media (max-width:760px)` 收窄到 `max-width:62vw` 并 `.ob-tx{display:none}`（只留「电脑端未连接」，不撑出顶栏）。**绝对定位 + 不参与文档流 + `pointer-events:none`**，所以既不吃空间、也不挡下面任何点击。
- **JS**：新增 `var connStateName = "connecting";` 与 `refreshOfflineBanner()`，显隐条件改为 `connStateName === "offline" && current === 0`；`setConnUI(state)` 只记状态再调它。之所以要记状态而不是当场写 `hidden`：`.pager-head` 不在 pager-track 里，翻页时它不跟着平移，必须在 `visibleHooks` 里按当前页重算一次，否则从启动页翻回监控页时条子会漏显。

实测（`scripts/verify-offline-banner.js`，Edge headless + CDP，横屏 1280×800 / 竖屏 800×1280）：**40 条断言全通过（横屏 20 + 竖屏 20）**。
- 位置：横屏条子 `{x:485,y:73,w:311,h:28,bottom:101}`、竖屏 `{x:245,y:74,w:311,h:28,bottom:101}` —— 顶栏底边 65 之下、`.mon-top` 顶边 119/120 之上，左右均居中。
- 不压别的元素：标题框（横屏 y77 h28 / 竖屏 y74 h29）、右上分页菱形（y78/79，x1196 / x718）与条子**矩形不相交**。
- **零位移**：切换在线 ↔ 离线两种状态，`.mon-top`（横屏 `22,119,1236,478`；竖屏 `19,120,762,440`）、`#hwRow`（y608 / y570）、`.hero-visual`（h478 / h150）、`.wx-cal`（y119 / y278）、`.pager-head`（h44 / h45）矩形**完全一致**，`pageOverflow:0`、`bodyOverflow:0`。
- 显隐：离线时可见、恢复在线后自动消失、翻到启动页不显示、翻回监控页仍断线时重现。
- 七档视口（1280×800 / 1280×540 / 960×540 / 1024×600 / 800×1280 / 560×900 / 480×800）复测：`inRow` 全 true、不压标题、不压分页菱形、`overflow:0`；≤760px 时条子宽 119px（隐藏后半句）仍居中。

验收脚本（新增，开发期脚本）：
- `scripts/verify-offline-banner.js`：`MEASURE` 模板一次 evaluate 内完成「切连接状态 + 关掉入场动画 + 量矩形」，再在 Node 侧跑 `hit(a,b)` 相交判定与零位移比对。**必须一次 evaluate 完成**——分两次调用会被 WS 每秒推送的在线帧把状态改回去；也必须先 `animation:none`，否则下落动画的中间 translate 会让 y 偏几像素。
- `scripts/shoot-offline-banner.js`：输出 4 张图到 `preview/offline-banner/`（横竖屏 × 在线 / 断开）。切完状态立刻截图、截完再核一次 `#monOffline` 显隐是否与预期一致，不一致就重拍 —— 固定 sleep 会被 WS 帧抹掉，第一版就是这么拍出两张「没有告警条」的空图。

未能读取的字段：本轮无新增。

降级方式：告警条是纯 CSS 绝对定位悬浮，`backdrop-filter` 不支持时退化为半透明深色底（文字仍清晰）；`.pager-head` 若因极端窄屏放不下，`max-width:62vw` + 隐藏后半句保证不撑破顶栏；连接状态另有一处显示在顶栏右侧的「已连接 / 离线」指示灯，条子被挡也仍能判断连通性。

#### 第十五轮补充：正式自检 + 重新打包 + 真实断线实测

自检（源码服务在 5000 端口）四层全部通过：
- 布局：`scripts/diag-flow.js` 四视图（portrait/landscape × 监控/启动）`pageOverflow:0`、`innerOverflow:0`，`pageScrollH` portrait 1170 / landscape 691。
- 卡片：`scripts/verify-ui.js` `cardOverflow:["stCpu:ok","stGpu:ok","ram:ok","stNet:ok","disk:ok"]`；`heroPct/wxPct/hwPct` portrait 13/24/60、landscape 69/69/26。
- 行为：`scripts/verify-fixes.js` **13 通过 / 0 失败**（天气 10° 阴·合肥·安徽；熄屏重播；502 不清屏 + `hits:2` 退避重试）。
- 本轮专项：`scripts/verify-offline-banner.js` **40 通过 / 0 失败**；`scripts/probe-magi.js` 两视口八项 overlap 全 false、`voteFoot:ABSENT`、`insideHexagon:true`；`scripts/shoot-fixes.js` 两视口日历 `overflowPx:0`、`overlapClock/overlapDate:false`、天气详情 `weekChart:true weekH:150 dayRows:7`。

接口层：`/api/status` 200；`/api/weather` `ok=True days=7 hourly=24 temp=10 desc=阴`；无 token → 401、`bogus-id` → 400；`/api/metrics`、`/api/apps`（243 项）正常；WS 无 token → 401、带 `?token=` 收到 `type:metrics intervalSec=1`。

重新打包（`D:\Python\Python312\python.exe packaging\build.py`）：
- `dist\NERV Panel.exe` **58.76 MB**（21:53:19），SHA256 `A19D532ED5EE1195BEE8ABE5DF37EC671F5B49BA12281C8A9944F48186254260`；产物自检 `外层归档条目：1618；PYZ 条目：236 / pystray 模组 13 / PIL 80 / bundle 617` + `[自检通过]`。
- staging 与源码逐文件 SHA256 全一致（index.html / style.css / app.js / procs.js / weather.js）；另用 `CArchiveReader` 从 exe 内直接抽出同样五个文件，SHA256 与源码**逐字节相同**（`build\verify_in_exe15.py`），并确认 exe 内含 `monOffline`、`ob-tx`、`offlineDrop`、`pointer-events:none`、`.pager-head{position:relative}`、`refreshOfflineBanner`、`connStateName`。
- 安装版 `dist\NERV Panel 安装版.exe` **59.87 MB**（21:54:03），`Successful compile (8.344 sec)`。

打包版实测（针对 exe，不针对源码服务）：
- 启动 4 秒后 `/api/status` 200；托盘窗口类 `NERV Panel...SystemTrayIcon` 存在。
- exe 内置页面：`/` 20224 字节含 `monOffline`/`ob-tx`；`/css/style.css` 71697 字节含 `offlineDrop`/`pointer-events:none`；`/js/app.js` 101850 字节含 `refreshOfflineBanner`/`connStateName`。
- `verify-offline-banner.js` 对打包版 **40 通过 / 0 失败**；`verify-fixes.js` **13 通过 / 0 失败**；`diag-flow.js` 四视图 0 溢出。
- 关闭应用端到端：Wordpad `running:true` → `POST /api/close-app` **200 `{"ok":true,"forced":false,"message":"已关闭"}` 1681ms** → `running:false`、`Get-Process` 存活计数 0。

**真实断线实测（关键：不用任何调试钩子，真杀进程）** `build\probe-offline-cycle.js`：
- 横屏：在线 `.mon-top=[22,119,1236,478] hwY=608 wxY=119 pagerH=44` → `taskkill` 掉 5000 端口 node 进程 → **前端自己在 7 秒后弹出告警条** `{x:485,y:73,w:311,h:28,bottom:101}`，主内容矩形**一字未变** → launcher 的 supervisor 1 秒拉起新服务 → **前端 2 秒后自己收起告警条**，布局仍与基线完全一致。`pageOverflow` 全程 0。
- 竖屏：同一流程，告警条 `{x:245,y:74,w:311,h:28,bottom:101}`，`.mon-top=[19,120,762,440] hwY=570 wxY=278 pagerH=45` 在三种状态下完全一致。
- 结果文件：`build\offline-cycle-1280x800.json`、`build\offline-cycle-800x1280.json`，均 `sameLayout: PASS`。
- 按此重拍预览图（`build\shoot-real-offline.js`，真断线画面，非注入），4 张覆盖 21:59:47–22:00:13。


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
