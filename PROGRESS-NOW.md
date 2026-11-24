# NERV Panel 进度记录

> 记录时间：2026-11-24 17:56（Asia/Hong_Kong）
> 状态：**已暂停**（按用户要求暂停任务、打包、留档）
> 代码版本：git `964ae1e`

---

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

代码、文档、截图三者已对齐到同一版本。`git status` 干净（只有待发布的 zip 未跟踪）。

---

## 二、项目现在长什么样

### 页面结构（2 页，一屏不滚动）

- **监控页**（默认页）
  - 上区：主视觉（明日香 + 大字时钟 + 日期星期 + 同步率 + 状态文案）
  - 右上：天气卡（合肥实时天气 + 未来 4 天）
  - 右下：月历卡（当月，今天高亮）
  - 底部：**六张硬件卡**，CPU / GPU / 内存 / 网络 / 磁盘 / 风扇，**各只出现一次**
- **启动页**
  - 音乐卡（SMTC 系统媒体会话，歌名 / 歌手 / 上一首 / 播放暂停 / 下一首）
  - 常用软件（默认只显示常用；空态有「添加常用」入口；搜索框搜全量）
  - 页面最下方：**七个系统按钮一排**（锁屏 / 注销 / 睡眠 / 重启 / 关机 / 熄灭显示器 / 任务管理器）
- **顶栏右上角**：监控 / 启动 滑动胶囊切换 + 齿轮「设置」按钮（全站唯一设置入口）
- **8 类卡片详情层**：时间 / 天气 / 日历 / CPU / GPU / 内存 / 网络 / 磁盘，点卡片打开，层内可滚动

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
GET  /api/media               SMTC 媒体会话
GET  /custom-hero/:file       用户自定义主视觉
WS   /ws/metrics              每秒推送监控数据
POST /api/launch              启动应用（Token + 白名单）
POST /api/close-app           关闭应用（Token + 白名单，正常关闭优先）
POST /api/power               电源 5 项（Token + 白名单）
POST /api/system              displayOff / taskManager（Token + 白名单）
POST /api/settings            写配置（Token）
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

## 四、已知缺口（如实记录，没有隐瞒）

1. **CPU 温度读不到**。`Win32_Processor.CurrentTemperature` 返回空；`MSAcpi_ThermalZoneTemperature` 普通权限「拒绝访问」。显示「—」。
2. **风扇转速读不到**。`systeminformation@5.33.24` 没有风扇 API；`Win32_Fan` 的 `DesiredSpeed` 为空；未装 Open Hardware Monitor 或 HWiNFO64。风扇卡显示「—」并注明「系统接口未提供转速」，不编转速。
3. **GPU 功耗仅 NVIDIA 有值**。本机 GTX 1660 SUPER 能读到；换 AMD / Intel 为空。
4. **网络累计流量不显示**。系统接口没有真实累计值，详情层注明后不画这一项。
5. **媒体会话依赖 SMTC**。本机当前无播放器注册会话，显示「未在播放」+ 三键置灰。**不回退任何音乐软件私有接口**。
6. **Steam 游戏 `running` 为 `null`**。游戏没有可执行文件名可匹配，不谎报「未运行」。本机未装 Steam，游戏分组为 0。
7. **部分商店应用图标提取不到**。回退统一占位图，点击启动不受影响。
8. **开始菜单过滤到 126 项**。卸载 / 激活 / 诊断 / 教程类快捷方式被 `JUNK` 正则排除。
9. **主视觉是原型内嵌 base64 裁出来的**（1120×797 → 970×797），不是高分辨率原图。
10. **同步率是主题装饰数值**。需求 5.2 明文允许，代码与文档都注明了。
11. **参考机型写 RTX 4060 Ti，实机是 GTX 1660 SUPER**。面板不写死型号，功能不受影响。
12. **2 小时长跑未实测**、**平板与唤醒未实测**、**开机自启未安装**（需你执行一次 `.\scripts\install-autostart.ps1`）。

---

## 五、怎么跑起来

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

**首次使用要填 Token**：打开 `config.json` 复制 `token`，在面板顶栏「设置」→ 访问令牌里粘贴保存。之后启动应用、关闭应用、电源操作才会生效。

---

## 六、这一轮验证做了什么（只是静态与 DOM 层面，不是功能测试）

- `node --check` 全部 16 个 JS 文件通过。
- 静态断言脚本核对：CSS 无 `.mon-grid` / `.mini-grid` / `.util-row` 残留，HTML 只有 2 个 `section.page`、无 `miniCpu`、角标只剩 3 个、`.hw-row` 与 `.power-row` 存在、`#settingsSheet` 与 `#settingsBtn` 存在、JS 有 `openSettings` 与 `fanRpm` 渲染。
- `scripts/diag-flow.js` DOM 实测：横竖屏 × 两页 `pageOverflow: 0`、`innerOverflow: 0`。
- 12 张截图重拍并逐张目视核对（`preview/` 目录）。

**按你的要求没有做功能测试**（没有点电源、没有启动应用、没有点音乐控制）。

---

## 七、打包内容

`NERV-Panel-v1.0.zip`（3.34 MB）包含：

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

1. 你运行起来看一眼，重点核对：
   - 监控页 / 启动页在平板横竖屏下是不是真的一屏放下；
   - CPU / GPU / 内存 / 网络是不是各只有一张卡；
   - 设置是不是只有顶栏那一个齿轮按钮。
2. 如果版面还有不满意的，告诉我具体哪一页哪一块，我按你的口径改。
3. 功能测试你来做，出问题把现象告诉我。
4. 开机自启需要执行一次 `.\scripts\install-autostart.ps1`。
5. 平板端配置见 `TABLET-SETUP.md`，REST API 默认端口 8080、亮屏端点 `/api/screen/on`、鉴权头 `X-Api-Key`。
