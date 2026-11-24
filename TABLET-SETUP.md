# 平板端设置指引（Fully Kiosk Browser）

本文件对应需求第 7.3 节「电脑开机、平板自动显示」的两层方案。

- **第一层（必做）**：电脑开机自启面板服务 → 平板用 Fully Kiosk Browser 全屏打开面板地址 → 平板开机自启该浏览器 → 充电常亮 → 断线自动重载。
- **第二层（默认关闭）**：面板服务启动后，主动调用平板的 Fully Kiosk 远程管理接口点亮屏幕。适用于平板长期挂墙、平时息屏的场景。

适用设备：华为 MatePad Pro 11 (2022) 性能版，HarmonyOS 4.0，11 英寸 2560×1600 120Hz，长期插电。

---

## 一、先确认电脑端已跑起来

1. 在电脑上双击 `start.bat`（带窗口，方便看日志）或 `NERV-Panel.vbs`（无窗口后台运行）。
2. 启动后窗口会打印两行地址，例如：

   ```
   http://localhost:5000
   http://192.168.10.11:5000
   ```

   **平板要填的是第二行那个局域网地址**，不是 `localhost`（`localhost` 在平板上指的是平板自己）。

3. 确保平板和电脑连的是**同一个 Wi-Fi / 同一路由器**。如果电脑插网线、平板走 Wi-Fi，只要是同一台路由器下的同一网段（例如都是 `192.168.10.x`）就可以。

4. 电脑换网络（换路由器、重启路由器）后局域网 IP 可能变化。若确实变了，用新地址更新平板的 Start URL，或在路由器里给电脑做 DHCP 静态绑定。

---

## 二、Windows 防火墙放行（电脑端，必须做）

平板连不上电脑，九成是防火墙拦了。二选一即可。

### 方式 A：首次启动时允许（最简单）

第一次运行 `start.bat` 时 Windows 会弹出「是否允许 Node.js 通过防火墙」的对话框，勾选 **专用网络**（家里/办公室的 Wi-Fi 通常就是专用网络），然后点「允许访问」。

### 方式 B：手动放行（已错过弹窗时）

1. 按 `Win + R`，输入 `wf.msc`，回车，打开「高级安全 Windows Defender 防火墙」。
2. 左侧点「入站规则」→ 右侧点「新建规则…」。
3. 规则类型选 **端口** → 下一步。
4. 选 **TCP**，特定本地端口填服务端口（默认是 `5000`，如果你改过 `config.json` 里的 `port`，填改后的值）→ 下一步。
5. 选 **允许连接** → 下一步。
6. 配置文件三个都勾上（域、专用、公用），家里用可以只勾专用 → 下一步。
7. 名称填 `NERV Panel`，描述可留空 → 完成。

> 提示：用端口规则比用程序规则更稳，因为 Node.js 升级换了安装路径也不受影响。

### 验证电脑端是否真的对局域网开放

在**平板浏览器**（任意浏览器）地址栏输入 `http://<电脑IP>:<端口>/api/status`，能返回一段 JSON（含 `"ok":true`）就说明网络通了；打不开就回到本节的防火墙步骤排查。

---

## 三、平板端：安装 Fully Kiosk Browser

1. 打开平板的**华为应用市场**，搜索 "Fully Kiosk Browser" 安装。
2. 若应用市场没有，用平板浏览器访问 <https://www.fully-kiosk.com/> 下载 APK 手动安装（安装时允许「安装未知来源应用」）。

> 说明：Fully Kiosk Browser 是安卓通用的 Kiosk（锁定式全屏浏览器）应用。面板本身是**网页**，不需要单独为平板开发任何 App，只要给这个浏览器一个网址即可。

---

## 四、第一层：平板自动全屏显示面板（必做）

打开 Fully Kiosk Browser，进入 **Settings（设置）**，按下面几项配置。不同版本菜单位置略有差异，按键名即可找到。

### 1. Start URL（必填）

`Settings → Web Content Settings → Start URL`

填入电脑端打印的局域网地址，格式：

```
http://<电脑局域网IP>:<端口>
```

例如：`http://192.168.10.11:5000`

> 只填到端口，**不要**在后面加 `/index.html`。

### 2. Fullscreen（隐藏全部浏览器元素）

`Settings → Web Content Settings → Fullscreen mode`

- 打开 **Enable Fullscreen Mode**（开启全屏模式）

关联项建议一并打开（按键名）：

| 设置项 | 值 | 作用 |
| --- | --- | --- |
| Show Action Bar | 关闭 | 去掉顶部工具条 |
| Show Status Bar | 关闭 | 去掉系统状态栏 |
| Show Navigation Bar | 关闭 | 去掉底部导航栏 |
| Show Progress Bar | 关闭 | 去掉加载进度条 |
| Enable Fullscreen Mode | 打开 | 网页内容铺满整屏 |

### 3. Launch on Boot（平板开机自启）

`Settings → Device Management → Launch on Boot`

- 打开 **Launch on Boot**（开机自启）
- 打开 **Launch on Boot Delay**，填 `15` 秒左右

开机后系统还在初始化网络，留一点延迟能避免启动时加载失败。

### 4. Keep Screen On（充电时常亮）

`Settings → Device Management → Keep Screen On`

- 打开 **Keep Screen On**（保持屏幕常亮）

> 平板长期插电时务必开启，避免息屏后看不到面板。

### 5. 断线自动重载

`Settings → Web Content Settings → Reload on Error`

- 打开 **Reload on Error**（页面加载失败时自动重载）
- 建议把 **Reload on Idle** 打开，间隔填 `300` 秒，作为长时间运行的兜底

### 6. 不锁定屏幕方向（重要）

`Settings → Device Management → Screen Orientation`

- **不要**选择锁定竖屏或锁定横屏，选择 **Auto / System**（跟随系统）

原因：面板本身做了横竖屏自适应，横屏时主视觉和信息密度更好看；如果被浏览器锁死方向，面板的横屏布局就永远用不上。平板自己的「自动旋转」也要开着。

### 7. 关闭 Kiosk 退出干扰（可选，但推荐）

| 设置项 | 值 | 作用 |
| --- | --- | --- |
| Kiosk Mode | 打开 | 锁定单页，防止误触回到桌面 |
| Exit Kiosk Gesture | 按需 | 关闭手势退出，防止小孩误触 |
| Show Volume Controls | 关闭 | 面板不需要音量键 |

> 注意：开启 Kiosk Mode 后，退出方式是**快速连点屏幕右上角 7 次**（默认）或你在设置里指定的手势。先记下来，否则以后不好退。

### 8. 平板系统侧设置（HarmonyOS）

| 位置 | 设置 | 作用 |
| --- | --- | --- |
| 设置 → 显示 → 休眠 | 设为「永不」或最长 | 与 Keep Screen On 双保险 |
| 设置 → 电池 → 更多电池设置 | 关闭「休眠时始终保持网络连接」的省电限制，允许 Fully Kiosk 后台运行 | 断线重载需要网络常在 |
| 设置 → 应用 → Fully Kiosk Browser → 电池 | 设为「不受限制」/「允许后台活动」 | 防止长时间运行被系统杀掉 |
| 设置 → 应用 → Fully Kiosk Browser → 权限 | 允许「在其他应用上层显示」 | Kiosk 全屏需要 |

---

## 五、第二层：面板主动点亮平板（默认关闭，可选）

### 适用场景

平板长期挂墙、由系统或省电策略息屏时，可以让人从电脑端（或重启服务端时）主动下发一次「点亮屏幕」。

### 实现原理

Fully Kiosk Browser 内置 **Remote Administration**（远程管理）功能：开启后平板会监听一个 HTTP 端口（默认 `2323`），向

```
http://<平板IP>:2323/?cmd=screenOn
```

发一次 GET 请求即可点亮屏幕。面板服务在启动成功后会按需发这一次请求。

### 平板端开启步骤

1. `Settings → Remote Administration`
2. 打开 **Enable Remote Administration**（启用远程管理）
3. 记下 **Remote Admin Port**，默认 `2323`（如果你改了，下一步的地址要跟着改）
4. 设置 **Remote Admin Password**（远程管理密码），记下来，下一步要填
5. 在同一页打开 **Remote Admin from LAN**（允许局域网访问），否则电脑连不上
6. 建议同时打开 **Remote Admin on Boot**（开机自动启用），否则平板重启后要手动进一次

### 获取平板 IP

在平板 `设置 → WLAN → 当前连接的网络` 里查看 IP 地址，例如 `192.168.10.42`。

（建议在路由器里给平板也做一次 DHCP 静态绑定，否则平板 IP 变化后唤醒会失效。）

### 在面板里填写（二选一）

**方式 A：面板界面（推荐）**

1. 在平板或电脑浏览器打开面板，进 **系统** 页。
2. 在「设置」区填写：
   - **平板唤醒地址**：`http://192.168.10.42:2323/?cmd=screenOn`
   - **平板唤醒密码**：上一步设置的 Remote Admin 密码
   - 打开 **启用平板唤醒** 开关
3. 填入访问令牌（在电脑端 `config.json` 的 `token` 字段里，见 README），点保存。

**方式 B：直接改 `config.json`（改完需重启服务）**

```json
{
  "tabletWakeEnabled": true,
  "tabletWakeUrl": "http://192.168.10.42:2323/?cmd=screenOn",
  "tabletWakePassword": "你在平板上设置的密码"
}
```

### 生效时机

- 服务端每次启动成功后，会按配置尝试点亮一次平板。
- 唤醒在后台执行，**失败只写日志（`logs/` 目录），不影响面板本身运行**。
- 若 `tabletWakeUrl` 还是占位值 `http://<平板IP>:2323/?cmd=screenOn`（含有尖括号），服务端会跳过并记一条警告，不会报错。

### 手动测试唤醒是否可用

在电脑浏览器地址栏直接访问：

```
http://192.168.10.42:2323/?cmd=screenOn&password=你的密码
```

平板屏幕应立刻点亮。打不开就检查：平板是否同一 Wi-Fi、Remote Administration 是否开启且允许 LAN、端口和密码是否正确、平板系统是否限制了后台网络。

---

## 六、日常使用流程（配好之后）

1. 开电脑 → Windows 登录 → 面板服务自动在后台启动（若已安装开机自启，见 README）。
2. 平板开机 → 自动进入 Fully Kiosk 全屏 → 自动加载面板 → 默认停在「总览」页。
3. 平板上的页面自带开机动画（MAGI 三贤人表决），点「EVA-02，启动！」或等它自动结束即进入总览。
4. 面板每秒更新一次数据；电脑关机或断网时，页面显示「离线」并自动重连，不会白屏。

---

## 七、常见问题

| 现象 | 原因 | 处理 |
| --- | --- | --- |
| 平板打不开面板 | 防火墙拦截 / 不在同一网段 / 地址写错 | 见第二节；在平板浏览器直接访问 `http://<电脑IP>:<端口>/api/status` 验证 |
| 打开后一片黑或一直转圈 | 电脑端服务没启动 | 电脑上确认 `start.bat` 窗口还在、日志无报错 |
| 数据一直是「—」 | 电脑端采集失败或上游不可达 | 看电脑窗口日志；CPU 温度读不到属已知缺口（见 README） |
| 点应用图标提示「需要令牌」 | 未填写访问令牌 | 在面板「系统 → 设置」里填入 `config.json` 的 `token` |
| 电源按钮点了没反应 | 未填令牌 / 服务端拒绝 | 看 toast 提示的具体原因 |
| 平板自动息屏 | Keep Screen On 未开或系统省电策略 | 见第四节第 4、8 项 |
| 电脑重启后平板停在旧页面 | Fully Kiosk 未开 Reload on Error | 见第四节第 5 项 |
| 唤醒接口打不开 | Remote Administration 未开/未允许 LAN/密码错 | 见第五节 |
