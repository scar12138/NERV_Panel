# NERV Panel 进度记录

> 记录时间：2026-11-25 00:2x（Asia/Hong_Kong）
> 状态：**第十一轮已完成**（去掉「常用软件」标题行 / 空态紧凑条带 / 封面放大居中 / 音乐三键等大 / 竖屏音乐略小于常用 / 添加常用只留一个 / 音乐文字左对齐）
> 代码版本：`aaa36de`（打包当时仓库对象库曾报损坏；11-25 已用 `git fsck` 复查通过、历史完整，内容已全部提交推送）

---


### 第十一轮：去掉「常用软件」标题行 / 空态紧凑条带 / 封面放大居中 / 三键等大 / 音乐占比与文字对齐修正

- 竖屏 `.launch-grid` 为 `minmax(0,0.92fr) minmax(0,1fr)`（**音乐比常用软件略小**），空态不再改变比例；实测音乐 510px / 常用 554px。
- 删除「常用软件 / FAVORITES」标题行（横竖屏都删），常用软件直接从搜索框开始；`#favCount` 占位与 JS 死代码一并清理。
- 空态只留紧凑条带（一行提示，竖屏 760×42，在列内垂直居中）；**「＋ 添加常用」全站只有搜索框右侧那一个**，条带里的第二个按钮已删除。
- 音乐封面放大居中：竖屏最小高 `clamp(96px,14vh,150px)`、宽度撑满，占位音符放大到 44% / 120px。
- 三键等大：删掉 `.mctrl button.main` 的加大尺寸，只保留红色配色；CDP 实测竖屏 42×42、横屏 35.2×35.2，`equal: true`。
- 音乐卡文字左对齐：「未在播放」等曲目 / 歌手文字与上方「网易云音乐」标题左边缘对齐（CDP 实测差值横竖屏均为 0）。

### 第十轮：日历卡只显日期 / 启动页顶部对齐 / 封面居中铺满 / 关闭按钮修复 / 底部 5 键 / 添加常用右移

- 监控页月历卡面只显示日期，节日 / 农历 / 节气移到日历详情（详情仍可切年 / 月）。
- 启动页音乐与常用软件两栏顶部对齐；音乐封面盒子居中并占满卡片内部（横屏实测 563×389，占卡片高 66.5%；竖屏 140×98），图片 `object-fit:cover` 铺满。
- 常用软件的「关闭」按钮修复：`.app .app-ctrl` 补 `position:relative;z-index:2`（原来被 `inset:0;z-index:1` 的 `.ico-hit` 整卡点击层盖住，点关闭命中启动层）。CDP `elementFromPoint` 实测横竖屏 `closeBtn.isSelf === true`。
- 「＋ 添加常用」移到搜索框右侧（`.search-row`），搜索框缩短。
- 启动页底部一排 5 个按钮：锁屏 / 睡眠 / 重启 / 关机 / 设置。

## 一、当前进度总览

| 阶段 | 内容 | 状态 |
| --- | --- | --- |
| 阶段 0 | 项目骨架与配置 | 已完成 |
| 阶段 1 | 界面静态版 | 已完成（已按 v3 改造覆盖） |
| 阶段 2 | 监控数据打通 | 已完成 |
| 阶段 3 | 监控页上区补全 | 已完成 |
| 阶段 4 | 启动页上区打通 | 已完成 |
| 阶段 5 | 启动页下区系统控制 | 已完成 |
| 阶段 6 | 开机自启与平板自动显示 | 已完成 |
| 阶段 7 | 性能与收尾 | 已完成 |
| v3 改版 | 四页改两页 + 8 类详情层 + 一批新接口 | 已完成 |
| 第六轮 | 一屏不滚动 / 监控页去重 / 启动页横屏左右 / 系统按钮一排 / 设置收进按钮 | 已完成 |
| 第七轮 | 横竖屏 UI 统一 / 音乐卡占满 / 4 按钮 / 农历节日 / 天气曲线 / CPU 名修复 / exe 设置窗口 / 不弹网页 | 已完成 |
| 第八轮 | 托盘图标必定出现 / 左键=设置 / 右键菜单含查看本机 IP+退出 / 设置窗口加开机自启 / 保存即生效自动重启 | 已完成 |
| 第九轮 | 顶栏只留监控/启动贴右上角 / 设置移到底部第 5 键 / 标题「监控 MONITOR」「启动 LAUNCH」/ 删「音乐 MUSIC」 / 日历节气加高 / 音乐按钮改小+封面居中 / 中文乱码修复 / 点播放真播放 / 常用可添加 / 托盘像素实证 / 免安装+安装版双打包 | 已完成 |
| 第十轮 | 日历卡只显日期（节日/农历/节气移到详情）/ 启动页两栏顶部对齐 / 音乐封面居中铺满 / 常用软件「关闭」按钮修复 / 底部一排 5 键 / 「添加常用」移到搜索框右边 | 已完成 |

本轮改动：右上角只留「监控 / 启动」两个按钮（贴右上角），顶栏齿轮「设置」删除、改到**启动页最下方第 5 个按钮**（锁屏/睡眠/重启/关机/设置）；
页标题改中英「监控 MONITOR」「启动 LAUNCH」并删掉启动页「音乐 MUSIC」小标题；
日历格子行高加高、节气/节日字不再被裁；
音乐三个按钮改小、专辑封面移到曲名与按钮之间（居中）；`media-session.ps1` 输出强制 UTF-8，中文歌名/歌手不再乱码；
点播放：有 SMTC 会话就真正 `play`/`pause`、按钮图标跟随状态，无会话先启动网易云再自动接着播；
「添加常用」按钮确认在（横竖屏均可见可点，空态引导文案同步）；
CPU 温度按「先查不改」确认：LibreHardwareMonitor 未安装/未运行、无 `root\LibreHardwareMonitor` WMI 命名空间、`si.cpuTemperature()` 实测全 null → 如实显示「—」；
托盘图标像素级实证：任务栏右下角出现 36×36 的 NERV 红色图标（SystemTrayIcon 窗口注册 + 红色像素簇）；
交付打包两个版本：`dist\NERV Panel.exe`（免安装）+ `dist\NERV Panel 安装版.exe`（Inno Setup 安装/卸载实测通过）。

---

## 二、项目现在长什么样

### 页面结构（2 页，一屏不滚动）

- **监控页**（默认页，页头标题「监控 MONITOR」）
  - 上区：主视觉（明日香 + 大字时钟 + 日期星期 + 同步率 + 状态文案）
  - 右上：天气卡（合肥实时天气 + 未来 4 天）
  - 右下：月历卡（当月，今天高亮；行高已加高，日期下方的节日/节气小字完整显示）
  - 底部：**六张硬件卡**，CPU / GPU / 内存 / 网络 / 磁盘 / 风扇，**各只出现一次**
- **启动页**（页头标题「启动 LAUNCH」，已无「音乐 MUSIC」小标题）
  - 音乐卡（SMTC 系统媒体会话，**占满音乐列**；封面居中；三个按钮改小；歌名/歌手中文正常；点播放真播放、按钮状态跟随）
  - 常用软件（默认只显示常用；空态有「＋ 添加常用」入口可见可点；搜索框搜全量）
  - 页面最下方：**五个系统按钮一排**（锁屏 / 睡眠 / 重启 / 关机 / **设置**）
- **顶栏右上角**：只留「监控 / 启动」两个切换按钮（贴右上角，已无设置齿轮）
- **8 类卡片详情层**：时间 / 天气 / 日历 / CPU / GPU / 内存 / 网络 / 磁盘，点卡片打开，层内可滚动
  - 天气详情含**当日气温逐小时曲线**
  - 日历详情可切**年 / 月**，并显示**农历 / 节日 / 节气**

### 已实现的服务端接口（18 个）

```
GET  /api/status              电脑名 / IP / 版本 / 在线 / 运行时长
GET  /api/config              非敏感配置（不含 token）
GET  /api/metrics             当前监控快照
GET  /api/metrics/history     最近 12 分钟历史（按需 ?minutes=N）
GET  /api/weather             合肥天气（服务端取，前端不直连）
GET  /api/apps                全量可启动项目（含 running）
GET  /api/apps/:id/icon       应用图标
GET  /api/favorites           常用软件（按 favoriteAppIds 顺序）
GET  /api/media               SMTC 媒体会话（含 thumbHash）
GET  /api/media/thumbnail     专辑封面（?hash=，有缩略图返回图片，无则 404）
GET  /custom-hero/:file       用户自定义主视觉
WS   /ws/metrics              每秒推送监控数据
POST /api/launch              启动应用（Token + 白名单）
POST /api/close-app           关闭应用（Token + 白名单，正常关闭优先）
POST /api/power               电源 5 项（Token + 白名单）
POST /api/system              displayOff / taskManager（Token + 白名单）
POST /api/settings            写配置（Token）
GET/POST /api/settings/local  本机（loopback 专用）读写配置，无需 token（exe 设置窗口用）
POST /api/favorites           常用增删（Token + 白名单）
POST /api/media/control       prev / playPause / next（Token）
POST /api/hero-image          上传主图（Token + 魔数校验）
POST /api/hero-image/reset    恢复默认主图（Token）
```

### 技术栈

- 后端：Node.js 24.22.1 + Express 5.3.0 + ws 8.23.0 + systeminformation 5.33.24 + iconv-lite 0.7.3
- 前端：原生 JS + CSS，无构建步骤
- 字体：本地 woff2（Barlow Condensed / Rajdhani / Noto Sans SC），无外链
- 硬件采集：`nvidia-smi`（GPU）、`Get-NetAdapterStatistics` 常驻进程（网络）、`tasklist`/`taskkill`（进程）、Windows SMTC（媒体）、WMI（温度，权限不足时为 null）

---

## 三、这一轮（第六轮）改了什么

按你提的五条：

1. **一屏不滚动**
   `.page{overflow:hidden}`，`.page-in{height:100%}`，尺寸全部走 `clamp(...vh...)`。
   只有详情层 / 挑选层 / 设置面板、以及常用软件那个小容器内部可以滚动。
   实测 `scripts/diag-flow.js`：横竖屏 × 两页，`scrollHeight - clientHeight` 全为 0。

2. **监控页整合去重**
   删掉原来的「上区四张小卡」（`#miniCpu` / `#miniGpu` / `#miniRam` / `#miniNet`）与下半区大卡的重叠，合并为一套六张卡。
   硬件卡上的「详情 ›」角标也删了（原来会压住右上角的温度 / 容量数值），整块卡片可点即进详情。

3. **启动页横屏左右**
   横屏：音乐在左、常用软件在右；竖屏：音乐在上、常用软件在下。
   实测横屏 `musicCol w=553` / `appsCol w=670`，两列等高。

4. **系统按钮下方一排**
   `.power-row` 七列一排。窄屏 / 矮屏时次要的注销、熄灭显示器、任务管理器同时保留在设置面板的「更多系统操作」里，**功能没删**。

5. **设置收进一个按钮**
   顶栏右上角齿轮按钮 → `#settingsSheet` 面板，里面是连接状态 5 项 + 7 个设置字段 + 唤醒开关 + 保存。
   启动页原来平铺的连接状态区与设置区已从页面删除。

### 本轮顺带修掉的 5 个真实缺陷

| 现象 | 原因 | 修法 |
| --- | --- | --- |
| 竖屏硬件卡内部被压扁（4 张卡溢出 27–30px） | 竖屏 `.mon-top` 行比例把上半区撑太高 | 行比例改 `minmax(0,0.8fr) minmax(0,1fr)`，`.hw-row` 加到 212–292px |
| 硬件卡「详情 ›」压住温度 / 容量数值 | `.more` 绝对定位与 `.stat-top` 右侧数值同位 | 硬件卡去掉角标，只留主视觉 / 天气 / 日历 |
| 日历卡「详情」压住 `TODAY·24` | `.cal-head` 没有右侧留白 | 加 `padding-right:52px` |
| 竖屏天气卡内容偏上、下方空一片 | `.weather` 用 `justify-content:center` | 改 `space-evenly` + 放大字号 |
| 常用软件空态下方一片空黑 | `#favEmpty` 在 `.app-scroll` 外面，撑不满列高 | 挪进 `.app-scroll` 并设 `flex:1` 居中 |

---

## 三之二、第七轮改了什么

按你提的四大块 + 老问题 + 可执行程序需求：

1. **横屏监控页**
   - 顶栏右上角：监控 / 启动 / 设置三合一挨在一起（原来设置单独的按钮，监控启动在胶囊里）。
   - 删除「横屏 LANDSCAPE / 竖屏 PORTRAIT」标志（一.3）。
   - 人物主图列宽 `1.55fr` → `1.32fr` 缩小，`hw-row` 高度 `20.5vh` → `22.5vh` 放大硬件卡（一.2）。
   - 天气详情新增**当日逐小时气温曲线**（Open-Meteo hourly，`/api/weather` 增加 `hourly` 24 点，需求一.4）。
   - 日历详情可切换**上一年 / 上月 / 下月 / 下一年**，并显示**农历 / 节日 / 节气**（自包含 `public/js/lunar.js`，需求一.5）。
   - 删除左右两边的翻页 `< >` 箭头（一.6），翻页只走顶栏胶囊 / 滑动 / 方向键。

2. **横屏启动页**
   - 音乐卡改成**左右布局：封面占满音乐列**（cover 位 + 曲目 + 控制键），不再只占一半（二.1）。
   - 网易云与常用软件整体缩小（`0.95fr 1.15fr` → `1fr 1.05fr`），给底部按钮挤空间（二.2）。
   - 底部按钮只留 **4 个**：锁屏 / 睡眠 / 重启 / 关机；注销 / 任务管理器 / 熄灭显示器彻底删除（含设置面板里的副本，二.3）。
   - 删除红色「启动网易云音乐」按钮，**点播放即自动启动网易云**（二.4）。
   - 专辑封面走 **SMTC 缩略图**：PS 桥读 `MediaProperties.Thumbnail`，Node 缓存，`/api/media/thumbnail?hash=` 提供；没有就留空，不做歌词（二.5）。

3. **竖屏监控页**
   - 布局改为硬件优先：主图压矮（`0.8fr 1fr` → `0.55fr 0.62fr`），硬件卡两行三列给足高度（三.1）。
   - 顶栏补上网址牌（原来竖屏 `.addr-pill{display:none}` 隐藏了，现在竖屏也显示，三.2）。

4. **竖屏启动页**
   - 音乐比例相对放大、常用软件相对缩小，与横屏同口径（四.1）。
   - 底部同样只留 4 个按钮（四.2）。

5. **三个老问题**
   - CPU 型号重复：`Intel Gen Intel® Core™ i7-12700H` → `Intel® Core™ i7-12700H`（`cleanCpuName()` 统一去前缀，实测 i7-12700H / i5 样例都对了；全站再无「Intel Gen」类前缀）。
   - 天气前后对不上：主卡「今天」用 current，未来名单 days[0] 原本用 daily 聚合，现在**统一为 current**，一天只说一种天气（实测主卡 晴 6°C = 今天 晴）。
   - CPU 温度「—」：**按你的要求先查不改代码**——LibreHardwareMonitor 未安装/未运行、无 WMI 命名空间，MSAcpi 权限不足，systeminformation 返回 null，如实显示「—」，报告见文末。

6. **可执行程序（桌面版）**
   - 新增**自带设置窗口**（托盘「设置」→ tkinter 表单），Token / 天气城市 / 刷新间隔 / 端口 / 数据源 / 平板唤醒 / 唤醒密钥直接改，不用翻 config.json（六.1）。
   - 服务端新增 `GET/POST /api/settings/local`，**仅本机 loopback 可访问、无需 token**（供设置窗口读写，局域网设备访问会被 403 拒绝）。
   - **启动不再自动弹网页**：移除浏览器自动打开，单实例分支也直接退出；托盘保留「打开面板」（六.2）。

7. **顺带修复**：`config.js` 增加 mojibake 迁移（旧版把 UTF-8 中文按 GBK 写盘导致 `weatherCity=鍚堣偉`，读盘时自动还原为 合肥）。

---

## 三之三、第八轮改了什么（托盘图标 + 设置窗口完善）

按你这次明确的 5 点可执行程序要求：

1. **托盘图标必定出现（含展开的隐藏图标区）**
   - 根因：`main()` 里 `icon.run(setup=on_ready)` 传了自定义 setup，而 pystray 的 `_base.py`
     `_start_setup` 规定「提供自定义 setup 时不会自动 `visible = True`」——默认 setup 才会显示图标。
     `on_ready` 只设了标题，从未 `icon.visible = True`，所以图标被**注册但从未显示**。
   - 修法：`on_ready` 里显式 `icon.visible = True`（并打日志兜底）。实测枚举窗口可见
     `NERV Panel...SystemTrayIcon`（2 个：图标窗 + 菜单窗，pystray 标准结构）。

2. **左键 / 右键行为**
   - 左键单击托盘 = **打开设置**（把「打开设置」设为菜单 default 项，pystray 左键激活 default）。
   - 右键菜单现在包含：**打开设置 / 打开面板 / 查看本机局域网 IP / 复制地址（子菜单）/ 开机自启 / 退出**。
   - 「查看本机局域网 IP」可点击 → 气泡通知，主 IP 与服务端 `/api/status`（剔除虚拟网卡）一致。
   - 「退出」走 `supervisor.stop()`（taskkill /T 整树）+ `icon.stop()`。

3. **设置界面：Token / 端口 / 开机自启，保存即生效**
   - tkinter 窗口新增**开机自启开关**（独立于 config.json，直接写
     `HKCU\...\CurrentVersion\Run` 的 `"NERV Panel"` 值 = `"<exe>" --autostart`）。
   - 保存时若改动了**端口**等 `needsRestart` 项：自动 `ServerSupervisor.restart()`
     （杀掉 node 子进程，supervisor 循环重读 `get_port()` 用新端口立刻重启）——**不用重启 exe**。
   - `restart()` 有手动重启标记，不计入 20 次崩溃上限；判定顺序改为「手动重启优先，其次才检查端口是否仍在服务」。

4. **开机自启后台静默启动**
   - `--autostart` 分支：启动即进托盘，不弹网页、不弹黑窗（服务端 `CREATE_NO_WINDOW`）。
   - 单实例：开机自启 + 双击重复拉起时，后到进程一律「已有实例在运行，直接退出」。

5. **改完后自检（本轮实测）**
   - 双击 exe 冷启动：服务 8s 内就绪，托盘 `SystemTrayIcon` 窗口存在（图标区外层的隐藏窗口对）；
   - **没有自动弹浏览器**（对比启动前后浏览器进程，仅新增 Edge 后台 extension renderer，非面板窗口）；
   - 重复启动走单实例直接退出（日志「已有实例在运行，直接退出」，进程数回到 2）；
   - `--autostart` 启动同样注册托盘、无弹窗；退出用 taskkill /T 整树清理后**无孤儿进程、端口释放**；
   - 保存端口 5000→5001→5000 实测：服务自动重启后分别监听 5001 / 5000，`/api/status ok=True`；
   - 开机自启注册表往返实测：写入 `"<exe>" --autostart` → `autostart_enabled()=True` → 删除后读回 None。

---

## 三之四、第九轮改了什么

按你这轮提的七块：

1. **顶栏设置按钮（一）**
   - 右上角只留「监控 / 启动」两个切换按钮，整体贴右上角（横竖屏 `page-switch` 都在 header 右侧边缘）。
   - 顶栏齿轮「设置」按钮**删除**，改到**启动页最下方一排的第 5 个按钮**：锁屏 / 睡眠 / 重启 / 关机 / **设置**。
   - 设置面板本体不变（点那个按钮打开）。

2. **监控页（二）**
   - CPU 温度「—」：按「先查不改」查证——LibreHardwareMonitor / OpenHardwareMonitor / HWiNFO / CoreTemp **均无进程、无服务**，
     `root\LibreHardwareMonitor` WMI 命名空间**不存在**，`si.cpuTemperature()` 实测返回
     `{"main":null,"cores":[],"max":null,"socket":[],"chipset":null}` → 服务端如实传 `temp:null` → 前端「—」。**要显示需装 LibreHardwareMonitor（或 HWiNFO64）并以管理员运行其后台服务**，本轮未改代码。
   - 横屏日历：`.cal-grid` 行高从 `minmax(0,1fr)` 改为 `minmax(clamp(24px,4.1vh,38px),1fr)`，`.lun-tag` 字号与行高提升、去掉 `overflow:hidden` 裁切；实测节气「寒露」等小字完整可见（portrait h=13px / landscape h=11px，不再是 0 高度的被裁格）。

3. **启动页音乐（三）**
   - 三个按钮改小：普通键 `clamp(30px,4.4vh,42px)`（原 38–52px）、主键 `clamp(36px,5.4vh,50px)`（原 46–62px）。
   - 专辑封面从卡片最左侧移到**曲目名与按钮之间**（DOM 顺序：曲目 → 封面 → 控制键；实测 `coverAfterTrack=true`）。
   - **中文乱码修复**：`media-session.ps1` 开头 `[Console]::OutputEncoding = [System.Text.Encoding]::UTF8`（PowerShell 5.1 默认 ANSI/GBK 输出，会把 UTF-8 中文打烂）。实测真实 SMTC 会话歌名 `解药` / 歌手 `陈奕迅` 正常。
   - **点播放真播放 + 状态跟随**：无会话时先启动网易云，然后轮询等 SMTC 会话出现并自动发 `play`（最多 12 次 × 1.5s）；有会话时点播放：`isPlaying=false → play`，`isPlaying=true → pause`，播放键图标同步切「暂停/播放」。PS 桥 `control` 新增 `play` / `pause` 指令（`TryPlayAsync` / `TryPauseAsync`）。端到端实测：点播放 → `/api/media isPlaying=true`、`playIcon.dataset.state='pause'` ✅。

4. **启动页常用软件（四）**
   - 「＋ 添加常用」按钮**确认存在**（`#addFavBtn`，横竖屏均可见可点，点击打开挑选层 `pickSheet`）；空态引导文案同步。

5. **标题（五）**
   - 页头标题改「**监控 MONITOR**」「**启动 LAUNCH**」（`data-title` 直接含中英文，去掉了原来的中文 + 小英文两段式）；`.p-en` 废弃隐藏。
   - 启动页「音乐 MUSIC」小标题**删除**（音乐卡直接撑满音乐列，无分区标题）。

6. **可执行程序托盘图标（六）**
   - 沿用第八轮 `icon.visible = True` 修复，本轮**像素级实证**：截取任务栏右下角通知区，聚类到 **36×36 红色实心块（平均 RGB 220,3,30 ≈ 图标红 (200,16,32)）**，且 `SystemTrayIcon` 消息窗口由 NERV 启动进程持有 → 图标确实显示在托盘区（含展开区同样适用）。
   - 左键 = 打开设置、右键菜单（打开设置 / 打开面板 / 查看本机局域网 IP / 复制地址 / 开机自启 / 退出）均由第八轮实现并验证。

7. **交付（七）**
   - 两个版本都已产出（本机实际编译验证）：
     - `dist\NERV Panel.exe` —— **免安装版**（PyInstaller onefile，140.7 MB）
     - `dist\NERV Panel 安装版.exe` —— **安装版**（Inno Setup 6 向导，141.4 MB；静默安装到用户目录 + 桌面/开始菜单快捷方式 + 卸载；**静默安装与卸载实测通过**）
   - 全部 `.md` 已同步更新（README / PROGRESS-NOW / DELIVERY-REPORT / PROGRESS / 本文件）。

9 轮自检结论：
- 横竖屏 × 监控/启动 四视图 `pageOverflow:0`（无整页滚动）；顶栏只有 2 个切换按钮且贴右上角；启动页底部 **5 个按钮**（含设置）；「添加常用」可见可点；点播放真实播放且按钮状态跟随；中文歌名不乱码。

---

## 四、已知缺口（如实记录，没有隐瞒）

1. **CPU 温度读不到**（本轮已查证）：`LibreHardwareMonitor` **未安装 / 未运行**（无进程、无服务、无 `root\LibreHardwareMonitor` WMI 命名空间）；`Win32_Processor.CurrentTemperature` 返回空；`MSAcpi_ThermalZoneTemperature` 普通权限「拒绝访问」。systeminformation 返回 null，前端如实显示「—」。**要显示真实 CPU 温度，需要装 LibreHardwareMonitor（或 HWiNFO64）并以管理员运行其后台服务**，之后 NERV Panel 才能在同一个 WMI 命名空间里读到。
2. **风扇转速读不到**。`systeminformation@5.33.24` 没有风扇 API；`Win32_Fan` 的 `DesiredSpeed` 为空；未装 Open Hardware Monitor 或 HWiNFO64。风扇卡显示「—」并注明「系统接口未提供转速」，不编转速。
3. **GPU 功耗仅 NVIDIA 有值**。本机 GTX 1660 SUPER 能读到；换 AMD / Intel 为空。
4. **网络累计流量不显示**。系统接口没有真实累计值，详情层注明后不画这一项。
5. **媒体会话依赖 SMTC**。本机当前无播放器注册会话，显示「未在播放」+ 上一首/下一首置灰；**播放键保留可点，用于启动网易云**。封面仅在 SMTC 提供缩略图时显示，否则留空。**不回退任何音乐软件私有接口**。
6. **Steam 游戏 `running` 为 `null`**。游戏没有可执行文件名可匹配，不谎报「未运行」。本机未装 Steam，游戏分组为 0。
7. **部分商店应用图标提取不到**。回退统一占位图，点击启动不受影响。
8. **开始菜单过滤到 126 项**。卸载 / 激活 / 诊断 / 教程类快捷方式被 `JUNK` 正则排除。
9. **主视觉是原型内嵌 base64 裁出来的**（1120×797 → 970×797），不是高分辨率原图。
10. **同步率是主题装饰数值**。需求 5.2 明文允许，代码与文档都注明了。
11. **参考机型写 RTX 4060 Ti，实机是 GTX 1660 SUPER**。面板不写死型号，功能不受影响。
12. **2 小时长跑未实测**、**平板与唤醒未实测**。开机自启现在由 exe 设置窗口/托盘菜单的**开机自启开关**管理（写 Run 注册表），不再需要 `install-autostart.ps1`；「下次继续」里的安装步骤已同步更新。

---

## 五、怎么跑起来

**桌面版（推荐，免装 Node）**：产物在 `dist/`：
- `NERV Panel.exe` 免安装版：双击即用，托盘图标常驻（左键设置 / 右键菜单）。
- `NERV Panel 安装版.exe` 安装版：向导安装 + 卸载。

源码运行：

```bat
:: 双击 start.bat，或者在项目目录执行
npm install
node server/index.js
```

启动后控制台会打印：

```
本机访问：http://localhost:5000
平板访问：http://192.168.10.11:5000
```

平板端用 FreeKiosk 基础模式打开那个「平板访问」地址，详细步骤见 `TABLET-SETUP.md`。

**首次使用要填 Token**：桌面版在托盘设置窗口的 Token 字段直接改（或源码版打开 `config.json` 复制 `token`），在面板启动页底部「设置」→ 访问令牌里粘贴保存。之后启动应用、关闭应用、电源操作才会生效。

---

## 六、这一轮验证做了什么

第九轮实测（不是仅静态）：

- `node --check` 全部修改过的 JS 通过，`python -m py_compile packaging/launcher.py` 通过，PS 脚本纯 ASCII + 真机解析通过。
- `scripts/diag-r9.js` CDP 无头实测横竖屏 × 监控 / 启动：
  - 四视图 `pageOverflow: 0` / `innerOverflow: 0`（不整页滚动）；
  - 顶栏 `#settingsBtn` 不存在、`.page-switch` 按钮 = 2、贴右上角（横屏 right=1254/1280、竖屏 right=776/800）；
  - 页头标题 = 「监控 MONITOR」/「启动 LAUNCH」；
  - 启动页 `.power-row` = **5 个按钮**（锁屏/睡眠/重启/关机/设置）；
  - `#addFavBtn` 可见可点（95×34）；`#mediaCover` 在 `#trackName` 之后（封面居中）；
  - 日历节气小字可见（portrait h=13px / landscape h=11px，非被裁）。
- 设置面板 / 添加常用交互：点 `#openSettingsRowBtn` → `settingsSheet.open=true`；点 `#addFavBtn` → `pickSheet.open=true` ✅。
- **音乐三.4 端到端**（CDP 点播放，真实 SMTC 会话）：初始 `isPlaying=false`、`playIcon=play` → 点播放 → `isPlaying=true`、`playIcon=pause` ✅；再点 → 切回暂停。
- **中文不乱码**：PS 桥输出 `{"title":"解药","artist":"陈奕迅"}`（`cloudmusic.exe`）✅。
- **托盘像素实证**：任务栏右下角聚类出 **36×36 红色实心块（RGB≈220,3,30）** + `SystemTrayIcon` 窗口由 NERV 进程持有 ✅。
- **两个版本打包**：`dist\NERV Panel.exe`（免安装，140.7MB）+ `dist\NERV Panel 安装版.exe`（Inno，141.4MB）；安装版静默安装到测试目录 → 存在 exe + unins → 卸载后清空 ✅。
- `--autostart` 静默启动、单实例直接退出、端口设置自动重启等沿用第八轮实测结论。

**没有做的功能测试**：没有真的点关机/重启/睡眠（会把机器搞挂）、没有在物理平板上验证。

---

## 七、打包内容

成品（`dist/`，两个版本）：

```
NERV Panel.exe          免安装版  140.7 MB（PyInstaller onefile，双击即用进托盘）
NERV Panel 安装版.exe   安装版    141.4 MB（Inno Setup 安装向导 + 卸载）
```

源码包 `NERV-Panel-v1.0.zip` 包含：

```
NERV Panel-complete.md     需求与执行文档（原件）
NERV Panel.html            视觉与交互参考原型（原件）
README.md                  安装 / 配置 / 接口 / 排错
TABLET-SETUP.md            平板端 FreeKiosk 设置
PROGRESS.md                逐阶段开发记录（含第六轮）
DELIVERY-REPORT.md         交付报告（6 栏）
PROGRESS-NOW.md            本文件
package.json               依赖清单
package-lock.json          依赖锁定
config.example.json        配置样例（不含真实 token）
start.bat                  一条命令启动 + 崩溃自动重启
NERV-Panel.vbs             无窗口启动
.gitignore
server/                    15 个 js + ps/ 两个常驻脚本
public/                    index.html / css / js / assets（主视觉 + 11 个字体）
scripts/                   install-autostart.ps1 / shoot.js / diag-*.js
```

**不含**：`node_modules/`、`config.json`（含你的 token）、`logs/`、`cache/`、`preview/`、`.git/`。
第一次运行会自动生成 `config.json` 和 `token`。

> 注意：`data/hero/` 目录是空的（你上传的自定义主图会存这里），打包时未包含。

---

## 八、下次继续时从这里开始

1. 你运行起来看一眼（源码 `node server/index.js` 或成品 `dist\NERV Panel.exe`），重点核对：
   - 顶栏右上角**只有「监控 / 启动」两个按钮**、贴右上角；**没有**设置齿轮；
   - 启动页底部**5 个按钮**：锁屏 / 睡眠 / 重启 / 关机 / **设置**；
   - 页头标题「监控 MONITOR」「启动 LAUNCH」，启动页无「音乐 MUSIC」小标题；
   - 横竖屏 × 监控 / 启动是否一屏放下、不整页滚动；日历节气小字完整可见；
   - 音乐三按钮改小、封面居中；歌名/歌手中文不乱码；点播放真的播、按钮状态跟着变；
   - 「＋ 添加常用」可见可点。
2. 托盘（沿用第八轮，重点核对）：
   - 双击 exe 后**右下角托盘必须出现图标**（点开 `^` 展开的隐藏图标区里也要能看到）；
   - **左键**点图标 → 打开设置界面；**右键** → 菜单里有 打开设置 / 查看本机局域网 IP / 退出；
   - 设置界面里 **Token / 端口 / 开机自启** 直接改，保存即生效；改端口后服务自动重启到新端口；
   - 打开「开机自启」后，重启电脑应自动后台启动（不弹网页、不弹黑窗）。
3. 功能测试你来做：点播放是否真的在网易云里开始播、SMTC 会话下封面是否出现、托盘「设置」窗口改 Token 是否生效。出问题把现象告诉我。
4. 交付两个版本：`dist\NERV Panel.exe`（免安装）+ `dist\NERV Panel 安装版.exe`（安装版，Inno 静默安装/卸载已实测）。开机自启用托盘/设置窗口的**开机自启开关**即可。
5. 平板端配置见 `TABLET-SETUP.md`，REST API 默认端口 8080、亮屏端点 `/api/screen/on`、鉴权头 `X-Api-Key`。
6. **CPU 温度**：装 LibreHardwareMonitor（或 HWiNFO64）并以管理员运行后，温度即可读到；建议装完后再确认一次。
