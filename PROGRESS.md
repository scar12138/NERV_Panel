# NERV PANEL · 开发进度

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

> 文档中参考机型写的是 RTX 4060 Ti，实际本机为 GTX 1660 SUPER。面板不写死型号，全部从采集结果读取，因此不影响功能。

## 阶段状态

| 阶段 | 内容 | 状态 |
| --- | --- | --- |
| 0 | 骨架与配置 | 已完成 |
| 1 | 界面静态版（演示数据） | 已完成 |
| 2 | 监控打通 | 已完成 |
| 3 | 总览补全 | 已完成 |
| 4 | 启动页打通 | 已完成 |
| 5 | 系统页与电源 | 已完成 |
| 6 | 开机自启与平板自动显示 | 已完成 |
| 7 | 性能收尾 | 未开始 |

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

### 完成内容

- `public/index.html`：MAGI 开机序列（正中绿色六角形核心 `MAGI`、上方 `BALTHASAR·2` 承認、左下 `CASPER·3` 否定、右下 `MELCHIOR·1` 承認、绿线连中央、扫描线与光束、NERV 霓虹闪烁、标题呼吸发光、印章浮动呼吸、日志逐行滚动＋末尾闪光标、分段进度条、背景缓慢推进、跳过按钮、完成后「EVA-02，启动！」按钮）；四页结构 `启动 / 总览 / 硬件监控 / 系统`；底部毛玻璃胶囊导航（`.dock-glider` 滑动选中块）；页码圆点；toast 与二次确认框。
- `public/css/style.css`：EVA 主题配色（`--red:#e8321e` 主色、橙黄绿状态色）、切角卡片（`.cut`）、警戒斜纹（`.hazard`）、毛玻璃 dock、横竖屏媒体查询、`orientIn` 旋转过渡、`prefers-reduced-motion` 降级。
- `public/js/app.js`：`goTo()` 翻页（`translate3d` + 视差入场）、`moveGlider()` 胶囊滑动、滑动/键盘/圆点三种翻页入口、开机序列脚本、时钟与月历、走势线 `drawSpark()`、演示监控数据、演示应用列表、电源按钮二次确认、横竖屏过渡调度、页面可见性调度（离开页面停表）。
- 字体：全部本地 `@font-face`（Barlow Condensed 400/500/600/700、Rajdhani 500/600/700、ZCOOL QingKe HuangYou 简体全集＋拉丁子集），无任何在线字体请求。

### 演示数据清单（阶段 2 起必须删除）

| 位置 | 内容 |
| --- | --- |
| `app.js` → `demoMetrics()` | CPU/GPU/内存/磁盘/网络全部为 `Math.random()` 生成 |
| `app.js` → `DEMO_APPS` | 7 条应用与游戏条目 |
| `app.js` → `DEMO_WEATHER` | 合肥晴天 11°C 等天气数值 |
| `app.js` → `DEMO_STATUS` | 连接信息写死为 `DESKTOP-9STHOGB / 192.168.10.11` |

> 阶段 1 界面右上角与系统页连接状态显示「演示模式」标识，符合文档第 4 节「演示数据必须标记」。阶段 2 接入真实数据时同步删除。

### 主视觉

- `public/assets/hero.jpg` 由原型内嵌 base64 提取后重裁：原图 1120×797，左侧 0–150px 为纯蓝天（无人物），已裁掉；**最终 970×797**，人物（头部/上身/双臂/双腿）完整保留。
- 原图顶部 90px 条带经放大检查**不含任何小字或水印**，文档所述「顶部小字」在本图不存在，因此未做额外留白。
- 前端通过 `GET /api/config` 的 `heroImagePath` 加载；加载失败时显示占位块并记入本文件。

### 未能读取的字段

（阶段 1 为演示数据，不涉及真实硬件读取）

### 降级方式

- 字体：`@font-face` 全部本地文件，不依赖网络；若文件缺失则回退到 `--sans` 链上的同类窄体字。
- 主视觉：`heroImagePath` 指向的图片加载失败时显示 `HERO IMAGE / 主视觉图片未找到` 占位块。
- 天气：`GET /api/weather` 不可用时显示「—」。

## 阶段 2 记录（监控打通）

### 完成内容

- `server/metrics.js`（新建）：采集 `cpu`（usage/temp/freq/name）、`gpu`（usage/temp/vramUsed/vramTotal/freq/power/name）、`ram`（usage/used/total）、`disks[]`、`net`（up/down）、`ts`，字段与文档第 4 节完全一致，不增不减。
- GPU 优先走 `nvidia-smi --query-gpu=...`（不写死路径，先试 PATH 再试 `%SystemRoot%\System32\nvidia-smi.exe`），失败回退 `systeminformation.graphics()`；回退路径拿不到的温度/功耗/频率返回 `null`。
- 每条采集都做 TTL 缓存（CPU 型号 30 分钟、GPU 型号 5 分钟、显卡 15 秒、磁盘 5 秒、温度 3 秒），避免每秒重复调用拖慢平板端。
- `server/index.js`：新增 `WebSocketServer({ server, path: '/ws/metrics' })`，每秒向每个连接推一次 `{type:'metrics', data}`；30 秒 ping/pong 心跳清理僵尸连接；`GET /api/metrics` 作为 HTTP 轮询降级通道。
- 前端连接层：优先 WebSocket；`onclose` 按 `[1s,2s,3s,5s,8s,13s,21s,30s]` 退避重连；连续重连失败自动降级为 HTTP 轮询（间隔读配置 `refreshIntervalSec`）；看门狗 6 秒无数据判定掉线；断线期间显示「离线」不白屏。
- 硬件监控页走势线（CPU/GPU/内存各 60 点）只在**本页可见时**绘制，离开本页立即停止，返回时补画。
- 删除了阶段 1 的 `demoMetrics()`，演示数据归零。

### 未能读取的字段

| 字段 | 状态 | 原因 |
| --- | --- | --- |
| `cpu.temp` | 待用户实机确认 | Windows 需管理员权限的传感器驱动才能读，普通权限下 `systeminformation` 常返回 `-1`；读不到时已按文档给 `null`，前端显示「—」 |
| `gpu.temp` / `gpu.power` / `gpu.freq` | 可读（nvidia-smi 路径） | 本机实测 nvidia-smi 可用，三个字段均有值；若用户环境 nvidia-smi 不可用则会变为 `null` |
| `net` 首次采样 | 可能为 0 | 需要两次采样求差，服务刚启动的第一个采样点上下行可能为 0，属正常 |

### 降级方式

- 任一硬件字段读不到 → 服务端返回 `null` → 前端显示「—」，绝不填随机数。
- WebSocket 不可用 → 自动 HTTP 轮询，界面标注「轮询模式」。
- 两者都失败 → 顶部状态显示「离线」，硬件监控页显示离线横幅，数据保持最后已知值不清零。

## 阶段 3 记录（总览补全）

### 完成内容

- `server/weather.js`（新建）：Open-Meteo 三接口（geocoding 取经纬度 → forecast 取当前与未来 3 天 → air-quality 取空气质量）。城市读 `config.json` 的 `weatherCity`，接口地址读 `weatherApiUrl`（首次运行已写入 `https://api.open-meteo.com/v1/forecast`）。
- 天气结果缓存 10 分钟，并发请求合并为一次上游调用，避免平板频繁刷新打爆上游。
- 前端 `GET /api/weather`：状况、当前温度、体感、湿度、风向风力、空气质量、未来 3 天全部按服务端返回渲染；任一字段缺失显示「—」；请求失败整体显示「—」，不编造。
- 时钟：时分大字、秒小字，`requestAnimationFrame` 驱动，只在总览页可见时运行，离开立即停表。
- 月历：当月网格、今天高亮，随月份自动重排。
- 状态文案随连接状态切换：在线「EVA-02 · 同步中 · A.T. FIELD ALL GREEN」；轮询「EVA-02 · 轮询链路 · A.T. FIELD STABLE」；离线「EVA-02 · 连接中断 · A.T. FIELD LOST」。
- 主视觉：读 `GET /api/config` 的 `heroImagePath`，改为 `object-fit: cover` + `68% 22%` 焦点，横竖屏都保留人物主体。

### 未能读取的字段

| 字段 | 状态 | 原因 |
| --- | --- | --- |
| 空气质量 | 可读 | Open-Meteo air-quality 提供 `pm2_5`/`pm10`/`us_aqi`，按其换算等级 |
| 天气（断网时） | 显示「—」 | 上游不可达时不做任何猜测 |

### 降级方式

- 天气三接口任一失败 → 该字段显示「—」；forecast 失败则整块显示「—」并保持上一次成功值 10 分钟内有效。
- 主视觉图缺失 → 占位块 + 文字 `HERO IMAGE / 主视觉图片未找到`。

## 阶段 4 记录（启动页打通）

### 完成内容

- `server/apps.js`（新建）：扫描两处开始菜单（`%ProgramData%` 与 `%APPDATA%`）的 `.lnk` 快捷方式，并解析 Steam 库（`libraryfolders.vdf` → `steamapps/appmanifest_*.acf`，仅收录 `StateFlags=4` 即真正已安装的游戏）。扫描结果缓存 60 秒，`?refresh=1` 强制重扫。过滤 uninstall/readme/help 一类无用项。
- 条目字段：`id`（`app:<sha1前12位>` 或 `steam:<appid>`）、`name`、`type`（`game` / `software`）、`hasIcon`。**前端不写死任何名单，分组也只依据服务端 `type`**。
- 图标：`GET /api/apps/:id/icon` 用 PowerShell + `System.Drawing.Icon.ExtractAssociatedIcon` 从 `.lnk` 提取 PNG，缓存在 `cache/icons/`；提取失败返回 404，前端自动回退统一占位图标。
- `server/launcher.js`（新建）：`POST /api/launch` 只接受 `/api/apps` 返回过的 `id`；未命中时先强制重扫一次再判定，仍不存在则拒绝（`ID_NOT_ALLOWED`）。Steam 游戏走 `steam://rungameid/<appid>`，快捷方式走系统默认启动。
- `server/auth.js`（新建）：所有控制类接口校验 `X-NERV-Token`（也接受 body.token），使用 `crypto.timingSafeEqual` 常量时间比较；未配置/缺失/错误分别返回 `TOKEN_NOT_CONFIGURED` / `TOKEN_MISSING` / `TOKEN_INVALID`。
- 前端：网格大图标、按名称即时搜索、按「游戏 / 软件」分组、空态提示、点击后立即进入「启动中…」状态并 toast 结果，失败显示服务端返回的原文原因。
- token 存于浏览器 `localStorage`，由用户从 `config.json` 抄入系统页设置区；服务端从不下发 token。

### 未能读取的字段

| 字段 | 状态 | 原因 |
| --- | --- | --- |
| 部分快捷方式图标 | 可能缺失 | 目标是 Windows 商店应用（`shell:AppsFolder\...`）或图标嵌在 exe 资源里时无法用 `ExtractAssociatedIcon` 提取，前端回退统一占位 |
| Steam 库 | 取决于安装情况 | 未装 Steam 或库中无已安装游戏时该分组为空 |

### 降级方式

- 图标缺失 → 统一占位图标（文档允许）。
- 扫描结果为空 → 启动页显示「服务端未扫描到任何可启动项目」空态，不造假条目。
- 扫描失败 → 显示「读取可启动项目失败：<原因>」。

## 阶段 5 记录（系统页与电源）

### 完成内容

- `server/power.js`（新建）：电源白名单 5 项 `lock` / `logout` / `sleep` / `restart` / `shutdown`，系统操作白名单 2 项 `display-off`（发送 `WM_SYSCOMMAND` + `SC_MONITORPOWER` 熄灭显示器）/ `taskmgr`（打开任务管理器）。白名单外的 key 直接返回 `ACTION_NOT_ALLOWED`，不执行任何命令。
- `POST /api/power`、`POST /api/system`、`POST /api/launch`、`POST /api/settings` 全部挂 `requireToken`。
- `POST /api/settings`：只接受 `config.json` 已定义的键，做类型/范围校验后写回文件，返回 `changed` 列表与 `needsRestart`（端口、平板唤醒相关项需重启生效）。
- 系统页连接信息：电脑名、IP:端口、服务端版本、已连接时长（本地计时）、当前延迟（`/api/status` 往返毫秒），每秒刷新，只在系统页可见时运行。
- 电源 5 个操作与 2 个系统操作全部走「二次确认 → 调接口 → toast 结果」，确认框的确认/取消触控区已放大到适合平板点击。
- 设置区 7 项：访问令牌、刷新间隔、天气城市、主视觉图片路径、平板唤醒地址、唤醒密码、唤醒开关；保存后立即写回 `config.json`，能热生效的立即生效（刷新间隔、主视觉、天气城市），需要重启的明确提示。

### 未能读取的字段

（本阶段无硬件字段，全部为可写配置与白名单操作）

### 降级方式

- 未填 token → 点击任何受控操作时提示「请先在下方设置中填入访问令牌」并聚焦输入框，不发送请求。
- 唤醒密码属敏感字段，服务端不下发，设置区始终留空表示「不修改」。
- 某项设置需重启 → 保存成功但以 `spMsg` 明确提示「需重启服务端后生效」。

## 阶段 6 记录（开机自启与平板自动显示）

### 完成内容

- `start.bat`（新建）：`chcp 65001` 解决中文乱码 → `cd /d "%~dp0"` 保证相对路径正确 → 循环执行 `node server\index.js`。退出码为 0（用户正常关闭）时不再重启；非 0（崩溃）时打印崩溃次数并在 5 秒后自动重启，连续 20 次后停止并提示查看日志。**这就是「服务端崩溃自动重启」的实现，不依赖任何第三方进程守护工具。**
- `NERV-Panel.vbs`（新建）：用 `WScript.Shell.Run(cmd, 0, False)` 隐藏窗口调用 `start.bat`，用于开机自启时不留黑窗。
- `scripts/install-autostart.ps1`（新建）：在当前用户的启动文件夹（`%APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup`）创建指向 `NERV-Panel.vbs` 的快捷方式，实现**登录即自启**；支持 `-Remove` 卸载。不需要管理员权限。
- `server/wake.js`（新建）：第二层平板唤醒。读 `tabletWakeEnabled` / `tabletWakeUrl` / `tabletWakePassword`，向 Fully Kiosk 的 Remote Administration 发 `screenOn` 请求；失败重试 2 次（间隔 2 秒）；地址仍是含 `<>` 的占位值或未开启开关时**直接跳过并写日志**，绝不报错；全程参数来自配置，代码里没有任何 IP/端口/密码。
- `server/index.js`：`server.listen` 成功后调用 `wake.wakeTablet('服务端启动')`，默认关闭状态下这一行只产生一条「已跳过」日志。
- `TABLET-SETUP.md`（新建）：平板端设置指引。含 Windows 防火墙放行（弹窗与手动 `wf.msc` 两种方式）、Fully Kiosk 的 Start URL（格式 `http://<电脑IP>:<port>`）、Fullscreen 隐藏全部浏览器元素、Launch on Boot、Keep Screen On、Reload on Error、**不锁死屏幕方向**、Kiosk 模式与退出方式、HarmonyOS 侧省电与后台限制设置，以及第二层远程管理的开关步骤、平板 IP 获取、面板设置区填写方式、手动验证方法和常见问题表。
- 日志滚动：`server/logger.js` 已实现按天切分（`YYYY-MM-DD.log`）、单文件超 8MB 追加 `.1.log` 序号、保留最近 30 个文件，本次复核无需改动。

### 未能读取的字段

（本阶段不涉及硬件字段读取）

### 降级方式

- 未安装开机自启 → 手动双击 `start.bat` 或 `NERV-Panel.vbs` 即可，功能不受影响。
- 平板唤醒未开启或地址是占位值 → 服务端跳过并记日志，第一层（浏览器自启动 + 常亮）仍照常工作。
- 平板唤醒请求失败 → 服务端重试 2 次后放弃，只写日志，面板本身不受影响。


