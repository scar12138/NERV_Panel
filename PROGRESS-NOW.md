# NERV Panel 进度记录

> **第十六轮：功能自检及 exe/安装包构建完成。管理员安装、卸载重装及防火墙生效仍待实装验证。** 当前为 CPU/GPU 共用样式的底部调音窗口；历史预览状态以末尾正式验收记录为准。

> 记录时间：2026-11-25 20:0x（Asia/Hong_Kong）
> 记录时间：2026-11-25 21:0x（Asia/Hong_Kong）
> 记录时间：2026-11-25 21:4x（Asia/Hong_Kong）
> 状态：第十五轮已交付；第十六轮功能自检与打包完成；管理员安装/防火墙待实装。

---


### 第十一轮：去掉「常用软件」标题行 / 空态紧凑条带 / 封面放大居中 / 三键等大 / 音乐占比与文字对齐修正

- 竖屏 `.launch-grid` 为 `minmax(0,0.92fr) minmax(0,1fr)`（**音乐比常用软件略小**），空态不再改变比例；实测音乐 510px / 常用 554px。
- 删除「常用软件 / FAVORITES」标题行（横竖屏都删），常用软件直接从搜索框开始；`#favCount` 占位与 JS 死代码一并清理。
- 空态只留紧凑条带（一行提示，竖屏 760×42，在列内**水平与垂直都居中**，实测中心差值 ≤1px）；**「＋ 添加常用」全站只有搜索框右侧那一个**，条带里的第二个按钮已删除。
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
| 第十一轮 | 删「常用软件」标题行 / 空态紧凑条带 / 封面放大居中 / 三键等大 / 竖屏音乐略小于常用 / 添加常用只留一个 / 音乐文字左对齐 | 已完成 |
| 第十二轮 | 横屏日历完整显示 / 竖屏同步率与时间分开 / 天气不再丢（重试 + stale 兜底 + 退避）/ 天气详情 7 日温度曲线 / 常用应用关闭真结束进程 / 熄屏点亮重播开机动画 | 已完成 |
| 第十三轮 | 正式自检（布局 + 13 条行为断言 + 接口层）/ 关闭链路改三级并用 `HasExited` 复查（修 tasklist 残留误判）/ 重新打包免安装 + 安装版 / 针对打包版 exe 的最终验证 | 已完成 |
| 第十四轮 | 启动页 MAGI 三框改 3 行网格（中间六边形 168×118，不再被左右夹）/ 删掉下方 7 个进度圆点（元素与 CSS 一并删除） | 已完成 |
| 第十五轮 | 离线告警改到顶部悬浮（顶栏下方、主内容上方，绝对定位不吃空间）/ 主图·天气·日历·硬件卡零位移 / 断开显示·恢复消失 / 横竖屏 | 已完成 |

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
  - 页头那行（「监控 MONITOR」与右上分页菱形之间）：**离线告警悬浮条**，只在断线时出现，绝对定位不占高度、不顶下任何卡片
  - 右上：天气卡（合肥实时天气 + 未来 7 天；接口抖动时保留上一次成功数据，不闪成「—」）
  - 右下：月历卡（当月，今天高亮；**行高按剩余空间均分，整月含 6 周也完整可见**；卡面只显示日期）
  - 底部：**六张硬件卡**，CPU / GPU / 内存 / 网络 / 磁盘 / 风扇，**各只出现一次**
- **启动页**（页头标题「启动 LAUNCH」，已无「音乐 MUSIC」小标题）
  - 音乐卡（SMTC 系统媒体会话，**占满音乐列**；封面居中；三个按钮改小；歌名/歌手中文正常；点播放真播放、按钮状态跟随）
  - 常用软件（默认只显示常用；空态有「＋ 添加常用」入口可见可点；搜索框搜全量）
  - 页面最下方：**五个系统按钮一排**（锁屏 / 睡眠 / 重启 / 关机 / **设置**）
- **开机动画 / 启动界面**（页面加载时、以及平板熄屏点亮后自动重播）
  - MAGI 表决图：上框 BALTHASAR-2、中央六边形 MAGI（全票通过后显示「ALL APPROVED / 全票通过」）、下排 CASPER-3 / MELCHIOR-1，**三块各占网格一行，互不重叠**；中央六边形 168×118（占图宽约 30%），印记文字完整落在六边形内
  - MAGI 下方**已无 7 个进度圆点**（元素与 CSS 均已删除），盖印行紧贴三框下方，不留空块
- **顶栏右上角**：只留「监控 / 启动」两个切换按钮（贴右上角，已无设置齿轮）
- **8 类卡片详情层**：时间 / 天气 / 日历 / CPU / GPU / 内存 / 网络 / 磁盘，点卡片打开，层内可滚动
  - 天气详情含**当日气温逐小时曲线** 与 **7 日温度变化曲线**（最高温实线 / 最低温虚线），并列出全部 7 天
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
- **两个版本打包**：`dist\NERV Panel.exe`（免安装，58.8 MB）+ `dist\NERV Panel 安装版.exe`（Inno，59.9 MB）；安装版静默安装到测试目录 → 存在 exe + unins → 卸载后清空 ✅（第十三轮复核尺寸）。
- `--autostart` 静默启动、单实例直接退出、端口设置自动重启等沿用第八轮实测结论。

**没有做的功能测试**：没有真的点关机/重启/睡眠（会把机器搞挂）、没有在物理平板上验证。

---

## 七、打包内容

成品（`dist/`，两个版本）：

```
NERV Panel.exe          免安装版  58.8 MB（PyInstaller onefile，双击即用进托盘）
NERV Panel 安装版.exe   安装版    59.9 MB（Inno Setup 安装向导 + 卸载）
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

---

### 第十二轮：横屏日历裁切 / 竖屏同步率重叠 / 天气常丢 / 7 日曲线 / 关闭真结束 / 熄屏点亮重播开机动画

> 记录时间：2026-11-25 19:2x（Asia/Hong_Kong）。需求来自用户第十二轮，横竖屏都要改。

- **横屏日历被裁**：`.cal-grid` 行高 `minmax(clamp(24px,4.1vh,38px),1fr)` → `minmax(0,1fr)`。原最小行高 × 6 行 + 表头超过 `.cal-card` 可用高度，`overflow:hidden` 切掉底部几行。改为按剩余空间均分，任何月份都装得下。
- **竖屏同步率与时间重叠**：`.syncbox` 从 `.hero-visual` 直接子元素挪进 `.hv-in` 内部；竖屏 `.hv-in` 改 3 行网格（同步率整行 / 时钟 + 日期 / 状态行），`.hv-in .syncbox{position:static}`。横屏 `.syncbox` 的 `top/left` 由 `clamp(...)` 收为 `0`（定位基准改为 `.hv-in` 的 padding 盒）。
- **天气有时读不到**：服务端 `weather.js` 重试 4 次 + 指数退避 + 6 小时 stale 兜底（`stale:true`、`staleAgeMin`）；前端 `loadWeather()` 失败不再 `wxEmpty()` 清屏，保留旧数据并 15s/30s/60s 退避重试，定时刷新 10 分钟 → 5 分钟。
- **天气详情 7 日温度曲线**：新增 `drawWeatherWeek()`（最高温橙色实线 + 面积、最低温蓝色虚线），`FORECAST_DAYS=7`，「未来 3 天」列表改为全部 7 天。
- **常用应用「关闭」不结束进程**：`procs.killByName` 改三级 —— 先 `taskkill /IM x /T`，1.2 秒复查；仍在则 `/T /F` 强杀，0.6 秒复查；仍在则按 PID 用 PowerShell `Stop-Process` 兜底，再 0.7 秒复查。三次复查都用 `HasExited` 判定，不用 `tasklist`（后者对已结束的进程会残留 8~9 秒，会把「已关掉」误判成「还在跑」）。成功带 `forced:true`。前端改为接口返回后立即刷新 + 900ms 补刷。
- **熄屏点亮弹启动界面**：`visibilitychange` 记录 `hiddenAt`，离开 ≥3 秒后回到前台即 `replayBoot()` 重播开机动画（新增 `resetBootUi()` 复位全部动画状态），不足 3 秒不触发。
- **新增脚本**：`scripts/shoot-fixes.js`（4 张验收图 → `preview/fixes/`，含日历溢出与同步率相交的 DOM 自检）、`scripts/verify-fixes.js`（13 条断言全通过）。

---

### 第十三轮：正式自检 + 关闭链路修正 + 重新打包

> 记录时间：2026-11-25 20:0x（Asia/Hong_Kong）。用户要求「正式自检并重新打包 exe」。

自检分四层，全部通过：

1. **布局几何**（`scripts/diag-flow.js` + `scripts/verify-ui.js`）：横竖屏 × 监控/启动 四视图 `pageOverflow:0`、`innerOverflow:0`；5 张硬件卡 `stCpu/stGpu/ram/stNet/disk` 全部 `ok` 无溢出；`pageScroll` 等于视口高，无不必要滚动。顺手修了 `verify-ui.js` 自身的一个 bug（`cardOverflow` 因运算符优先级丢了卡片名，只输出 `ok`/`OVERFLOW n`）。
2. **行为断言**（`scripts/verify-fixes.js`）：13 通过 / 0 失败 —— 熄屏 4 秒重播开机动画且状态复位、1 秒不重播；天气 502 时不清空、保留数据对象、`hits:2` 触发退避重试、恢复后刷新。
3. **接口层**：`/api/weather` 200（7 天 + 24 小时）；鉴权 401 `TOKEN_MISSING`/`TOKEN_INVALID`；白名单 400 `ID_NOT_ALLOWED`/`ACTION_NOT_ALLOWED`；`/api/config` 不下发 token；`/api/metrics`、`/api/metrics/history`、`/api/media`、`/api/favorites` 均 200；WebSocket 无 token 401、带 `?token=` 通且帧结构完整；静态资源 200、未知图标 404。
4. **关闭链路（本轮唯一改动处）**：自检时发现 `wordpad.exe` 会被判成「关闭失败」（400 `CLOSE_FAILED`），而实际进程已经在退。根因是 `tasklist` 对强杀后的进程仍残留 8~9 秒（`/FO LIST /V` 连 Status 都是 Running），而 PowerShell 的 `HasExited` 已是 `True` —— 复查用错了数据源。修法：三级关闭 + 三次复查全部走 `isAlive()`（PowerShell `HasExited`）；新增 `recentlyClosed` + `reconcileClosed()` 剔掉卡片上的「运行中」假阳性。

复测数据：
- `killByName('wordpad.exe')` → `{"ok":true,"message":"已关闭"}` 2048ms，复查 `wordpad in set? false`（同一次调用里 `tasklist` 还有残留，验证复核确实起作用）。
- `POST /api/close-app`（Wordpad）→ 200 `{"ok":true,"name":"Wordpad","forced":false,"message":"已关闭"}` 1883ms，随后 `/api/apps` 该项 `running:false`。
- `killByName('nervtest2.exe')`（`PING.EXE` 副本、无窗口）→ `{"ok":true,"message":"已强制结束","forced":true}` 3252ms；重复调用 → `{"ok":true,"message":"已关闭"}` 1806ms（幂等）；不存在的映像名 → `{"ok":true,"message":"已关闭"}`。

打包（`D:\Python\Python312\python.exe packaging\build.py`）：
- `dist\NERV Panel.exe` **58.8 MB**，自检 `外层归档条目：1618；PYZ 条目：236 / pystray 模块数：13 / PIL 模块数：80 / bundle 条目数：617` + `[自检通过]`。
- staging 与源码逐文件 SHA256 一致（weather.js / procs.js / apps.js / app.js / style.css / index.html 全 `same=True`）。
- 安装版 `& "$env:LOCALAPPDATA\Programs\Inno Setup 6\ISCC.exe" packaging\installer.iss` → `dist\NERV Panel 安装版.exe` **59.9 MB**，`Successful compile`。
- 实机启动新 exe：2.2 秒后 `/api/status` 200；`/` 200 len=20219；打包体内 `/js/app.js` 含 `drawWeatherWeek`/`replayBoot`/`SCREEN_OFF_MIN_MS`/`onWeatherFail`；`/css/style.css` 含 `wx-week`；`/api/weather` 7 天 24 小时；EnumWindows 找到 `SystemTrayIcon` 窗口（托盘已建）；`launcher.log` 无「托盘运行异常」。

**重新打包（用户要求把修好的 procs.js 真正送进 exe 后再验一遍）**
- 第二次重打包 rc=0，`dist\NERV Panel.exe` 58.8 MB（20:06:51），自检仍 `[自检通过]`（PYZ 236 条 / pystray 13 / PIL 80 / bundle 617）。
- **进包核验（三重一致）**：源码 `server\procs.js` SHA256 `CA770D3D27F884F0970CD861ACA1A90BD46C95B4C67AEF6631B5E2B9C47A97CC` = `build\bundle\server\procs.js` = 从 exe 里 `CArchiveReader.extract('bundle\\server\\procs.js')` 抽出的内容（9361 字符，含 `isAlive`/`HasExited`/`reconcileClosed`/`recentlyClosed`/`forceByPid`）。
- 安装版重编 `Successful compile (7.672 sec)` → `dist\NERV Panel 安装版.exe` 59.9 MB（20:07:34）。
- 打包版 exe SHA256 `169FAC1703D2EF7D86A4918D98D593B9EE014C12D7843B0D03B7E4F42D41FBDA`。

**最后一次验证（全部针对打包版 exe，不是源码服务）**
- 启动：`/api/status` 200，**1 秒内**就绪（`{"ok":true,"name":"T0","ip":"192.168.0.104","port":5000,"version":"1.0.0","online":true}`）；EnumWindows 找到 `NERV Panel...SystemTrayIcon`（两个句柄）+ `PyInstallerOnefileHiddenWindow`；`launcher.log` 无托盘异常。
- **关闭应用端到端（本轮核心）**：`wordpad.exe` 启动后 `running=true` → `POST /api/close-app` → **200 `{"ok":true,"id":"app:e90abfd6942f","name":"Wordpad","forced":false,"message":"已关闭"}` 1818ms** → 700ms 后 `/api/apps` 该项 `running:false`；同时刻 `tasklist` 原始输出**仍残留该进程**（证明假阳性来源）、`Get-Process | Where-Object {-not $_.HasExited}` 计数为 **0**（证明判定权威）。与修复前的 400 `CLOSE_FAILED` 对比，问题已实际解决。
- `scripts\verify-fixes.js`：**13 通过 / 0 失败**（基线天气 `11°` / `阴 · 合肥·安徽` / `体感 7° · 湿度 66% · 南风 3 级 · 空气重度污染`；熄屏重播、1 秒不重播、502 不清屏 + `hits:2` 退避重试、恢复刷新）。
- `scripts\diag-flow.js`：横竖屏 × 监控/启动 四视图 `pageOverflow:0`、`innerOverflow:0`（portrait `pageClientH` 1170、landscape 691；`powerRow` 底边 1268 / 788 均在视口内）。
- `scripts\verify-ui.js`：5 张硬件卡全 `ok`；`heroPct/wxPct/hwPct` portrait 13/24/60、landscape 69/69/26；`pageScroll` 等于视口高。
- 打包体内静态资源：`/js/app.js` 99960 字节且 `drawWeatherWeek`/`replayBoot`/`onWeatherFail` 全在；`/css/style.css` 70051 字节含 `wx-week`；`/` 20219 字节含 `hv-in`。
- `/api/weather` 返回完整 7 天 + 24 小时（今天 15/5 阴 … 周二 24/12 小毛毛雨），`temp=11`、`feels=7`、`humidity=66`。
- WebSocket：无 token → **401**；带 `?token=14000605` → 收到 `type:metrics`（`cpu=20.1`、`intervalSec=1`）与 `type:config` 帧。

**本轮踩到的一个真实环境坑（已写进 README）**：第一次启动打包版时服务反复 `code=2` 退出、`/api/status` 20 秒都不通，日志是「端口 5000 已被占用」。查到占用者是 **Clash Verge 的 `verge-mihomo.exe`**（PID 7836 临时 Bind 0.0.0.0:5000，另一条 UDP 5000 属于 `lkcitdl.exe`）。等它释放后重启面板即正常（`bind 0.0.0.0:5000 OK`）。README「启动报端口 5000 已被占用」一节已补这段排查命令与这个真实案例。

---

### 第十四轮：MAGI 表决图三框不再挤压 + 删掉下方 7 个进度圆点

> 记录时间：2026-11-25 21:0x（Asia/Hong_Kong）。用户要求「修改启动页，不要改其他内容，按步骤改，改完自检」；横竖屏都要改，且先出预览图确认再自检。

**改前实测（`scripts/probe-magi.js`，作为对照基线）**
- 旧实现三框全是 `position:absolute`：`.vote-box{width:47%}`，`.vote-box.top{left:50%;translateX(-50%)}`、`.bl{left:0}`、`.br{right:0}`，左右合计 94%；中间 `.vote-magi{position:absolute;left:50%;top:50%;translate(-50%,-50%)}` 宽仅 `clamp(74px,17vw,96px)`。
- 结果：中央六边形**96×84（占图宽 17.1%）**，与左框 / 右框 / 上框**三向全部重叠**（`center_gap` 为 −31.2 / −31.1px）；`.core-approve` 文字框被挤到 54×23.5。

**改法**
- `.vote-diagram` 改为 **3 行 2 列网格**：`grid-template-rows:auto minmax(0,1fr) auto`，上框占第 1 行横跨两列、中央核心占第 2 行横跨两列、左右两框各占第 3 行一列（左贴左、右贴右）。`height` 改 `min-height:clamp(198px,31dvh,266px)`。**三块各占一行，结构上不可能再互相覆盖。**
- `.vote-magi` 放大到 **168×118**（`clamp(120px,21vw,168px)` × `clamp(88px,15vw,118px)`），占图宽 **29.9%（横屏）/ 30.3%（竖屏）**（首版放到 196×136，用户看预览图后要求「再小点」，最终 168×118）；`.core-approve` 改为网格项、字号提到 `clamp(9px,1.7vw,12px)`。
- **7 个进度圆点整个删除**：`public/index.html` 的 `<div class="vote-foot">…</div>` 整行删除，CSS 三条规则（`.vote-foot` / `.vote-foot i` / `.vote-foot i.hot`）一并删除，不是隐藏；删完下方不留空块、盖印行位置正常。
- **连线跟随实测坐标**：新增 `layoutVoteLines()`，用 `getBoundingClientRect()` 量三框与核心的实际中心，换成百分比写回 `#lineTop/#lineBl/#lineBr`；`startBoot()`、`resetBootUi()` 末尾调用，另在 120ms / 600ms 与窗口 `resize` 后各重算一次。原连线是写死百分比，网格化后会飘出框外。

**实测（改后）**
- 横屏 1280×800：核心 **168×118**（占图宽 29.9%），上框 300×71，左右框各 271×71，八项相交判定**全部 false**；核心与下排两框纵向行距 9.2px、与上框 10.1px。
- 竖屏 800×1280：核心 168×118（占图宽 30.3%），行距 11.6 / 12.5px，八项相交判定全 false。
- 「ALL APPROVED / 全票通过」文字框 76.4×32.7，**四角全部落在六边形多边形内**（左右余 3.8px、上下余 42.6px；左右按顶部平边保守口径算，实际斜边处更宽）。
- 小屏复测 1280×540 / 960×540 / 1024×600 / 560×900 / 480×800：三框无相交、不溢出 `.magi-term`、不溢出视口。
- 两个视口 `vote-foot` 均为 **ABSENT**。
- 页面级无新增溢出：`scripts/diag-flow.js` 四视图仍 `pageOverflow:0`、`innerOverflow:0`。

**新增脚本（开发期）**：`scripts/probe-magi.js`（矩形 / 8 组相交 / 行距 / 六边形四角判定 / `vote-foot` 存在性）、`scripts/shoot-boot.js`（横竖屏各 2 张图 → `preview/boot-fix/`，覆盖动画进行中与全票通过两态）。

**踩坑**：截图脚本第一次只把 `#boot` 设成 `display:flex`，1 秒后被开机动画定时器滑走，拍出的图上半部分空白；改为注入 `window.__forceBoot` 并用 `setInterval(…,100)` 持续钉住样式再截图。

### 第十五轮：离线告警改到顶部悬浮 + 主内容零位移

> 记录时间：2026-11-25 21:4x（Asia/Hong_Kong）。用户要求「告警信息调到顶部」：原来那条「电脑端未连接 / 数据暂停更新，等待服务端恢复」压在监控页最底下、占一整行。

**改前实测（`build/probe-band.js`，作为对照基线）**
- 告警条是 `.page-in.mon-in` 里 `.hw-row` 之后的最后一个子元素，样式 `.offline-banner{display:flex;...;flex:none}`；`.page-in` 是 flex 列，`flex:none` 直接**吃掉一整行高度**。
- 可用空白带：`header.top` 底边 65，`.pager-head` y65–109（横屏 h44）/ y65–110（竖屏 h45），`.mon-top` 顶边 119/120。`.pager-head` 里标题（右边界 140）与分页菱形（左边界 1196）之间是唯一够宽的空白。

**改法**
- 节点从 `.page-in.mon-in` 移进 `.pager-head`（`.dots` 之后），拆成 `.ob-dot` + `b` + `.ob-tx` 三段。
- `.pager-head{position:relative}`，条子 `position:absolute;left:50%;top:50%;transform:translate(-50%,-50%)` —— **绝对定位、脱离文档流**，所以不占空间、不顶下面任何卡片；`pointer-events:none` 保证不挡点击；`max-width:min(560px,72vw)` 防撑破；`@media (max-width:760px)` 收窄到 62vw 并隐藏后半句。
- JS 用 `connStateName` + `refreshOfflineBanner()`：显隐 = `connStateName === "offline" && current === 0`；`setConnUI` 只记状态，`visibleHooks` 里每次翻页重算（`.pager-head` 不在 pager-track 内，不随页面平移）。

**改后实测（`scripts/verify-offline-banner.js`，40 条断言全通过）**
- 横屏条子 `{x:485,y:73,w:311,h:28}`、竖屏 `{x:245,y:74,w:311,h:28}`；顶栏底边 65 < 73/74，条子底边 101 < `.mon-top` 顶边 119/120 —— 位置正好夹在两者之间。
- **零位移**：在线 ↔ 离线两态下 `.mon-top`（横 `22,119,1236,478`；竖 `19,120,762,440`）、`#hwRow`（y608 / y570）、`.hero-visual`（h478 / h150）、`.wx-cal`（y119 / y278）矩形完全一致；`pageOverflow:0`、`bodyOverflow:0`。
- 不与标题（y77/74）、分页菱形（x1196/718）相交；断开即显、恢复即消失；翻去启动页不显示、翻回仍断线时重现。
- 七档尺寸复测 `inRow/hitTitle/hitDots/overflow` 全部通过，≤760px 条子宽 119px 仍居中。

**验收脚本**
- `scripts/verify-offline-banner.js`（一次 evaluate 内「切状态 + 关动画 + 量矩形」，否则被 WS 每秒的在线帧抹掉）。
- `scripts/shoot-offline-banner.js`（4 张图 → `preview/offline-banner/`；切状态→截图→复核显隐，不一致重拍）。

**踩坑**：① 放 `.page-in` 里 `absolute;top:0` 会落在 y=109/110，盖住 `.mon-top` 与竖屏 `.syncbox`；② 分两次 evaluate 切状态与测量会被 WS 在线帧覆盖；③ 不关入场动画量出的 y 会偏几像素；④ 截图脚本用固定 sleep 会拍到「条子已消失」的空图。

**第十五轮补充：正式自检 + 重新打包 + 真实断线实测**
- 自检四层全过：`diag-flow`（四视图 0 溢出）、`verify-ui`（五卡全 ok）、`verify-fixes`（13/13）、`verify-offline-banner`（40/40）。
- 打包：`dist\NERV Panel.exe` 58.76 MB（SHA256 `A19D532ED5EE1195BEE8ABE5DF37EC671F5B49BA12281C8A9944F48186254260`）、`dist\NERV Panel 安装版.exe` 59.87 MB；exe 内 `public/index.html`/`style.css`/`app.js`/`server/procs.js`/`weather.js` 五个文件用 `CArchiveReader` 抽出，SHA256 与源码**逐字节相同**。
- 打包版复测：`verify-offline-banner` 40/40、`verify-fixes` 13/13、`diag-flow` 0 溢出；Wordpad 关闭 200「已关闭」1681ms、随后 `running:false`。
- **真杀进程断线测试**（`build\probe-offline-cycle.js`，无任何调试注入）：杀掉 5000 端口 node 进程后前端 **7 秒**自己弹出告警条，launcher 1 秒拉起服务后前端 **2 秒**自己收起；横屏 `.mon-top=[22,119,1236,478]`、竖屏 `[19,120,762,440]` 在 在线/断开/恢复 三态逐字段相同（`sameLayout: PASS`）。
- 预览图按真断线画面重拍：`preview/offline-banner/` 4 张（21:59:47–22:00:13）。


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
