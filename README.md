# NERV Panel

EVA 明日香主题的局域网电脑监控面板：一台 Windows 电脑跑服务端，一台安卓平板在同一个 Wi-Fi 下全屏网页查看实时状态。

## 技术栈

| 层 | 选型 | 版本 | 说明 |
| --- | --- | --- | --- |
| 运行时 | Node.js | >= 20 | 服务端与静态资源托管共用 |
| 服务端框架 | Express | ^5.3.0 | 提供 `/api/*` 接口与 `public/` 静态资源 |
| 实时推送 | ws | ^8.23.0 | WebSocket 推送硬件数据 |
| 采集 | systeminformation | ^5.33.24 | CPU / 内存 / GPU / 磁盘 / 网络等真实数据 |
| 前端 | 原生 HTML + CSS + JS | — | 单页全屏面板，无构建步骤 |
| 字体 | @fontsource 系列（本地 woff2） | ^5.3.0 | 离线可用，不依赖外网 CDN |

选型原则：零构建、离线可用、只走局域网，平板端用 Fully Kiosk Browser 全屏运行即可，无需自研 App。

## 快速开始

```bash
# 1. 安装依赖
npm install

# 2. 准备配置（首次启动也会自动生成）
cp config.example.json config.json   # Windows: copy config.example.json config.json

# 3. 启动
npm start
```

启动后控制台会打印两个地址：

```
本机访问：http://localhost:5000
平板访问：http://192.168.x.x:5000
```

平板用 Fully Kiosk Browser 打开「平板访问」那一行地址，开启全屏、开机自启、充电时屏幕常亮即可。

## 配置

根目录唯一配置文件为 `config.json`（已被 `.gitignore` 忽略，不随仓库发布；模板见 `config.example.json`）。修改后重启服务生效。

| 字段 | 类型 | 默认值 | 说明 |
| --- | --- | --- | --- |
| `port` | int | `5000` | 服务端口，1–65535 |
| `token` | string | 自动生成 | 接口鉴权 token，留空时启动自动生成随机值并写回；**不要提交到仓库** |
| `weatherCity` | string | `合肥` | 天气城市 |
| `weatherApiUrl` | string | 空 | 自定义天气接口地址，空则用默认源 |
| `heroImagePath` | string | `assets/hero.jpg` | 主视觉图片，相对 `public/` |
| `refreshIntervalSec` | int | `1` | 数据刷新间隔（秒），1–60 |
| `tabletWakeEnabled` | boolean | `false` | 是否通过 Fully Kiosk REST 接口唤醒平板屏幕 |
| `tabletWakeUrl` | string | 平板 IP 示例 | 平板唤醒接口地址 |
| `tabletWakePassword` | string | 空 | 平板唤醒接口密码 |

## 目录结构

```
.
├── server/              # 服务端
│   ├── index.js         # 入口：HTTP 服务、/api/status、静态资源
│   ├── config.js        # 配置读取/校验/写回、局域网 IP 探测
│   └── logger.js        # 按天滚动日志（写入 logs/）
├── public/              # 前端页面（由 Express 直接托管）
│   ├── index.html
│   ├── css/style.css
│   ├── js/app.js
│   └── assets/          # 主视觉图片与本地字体
├── config.example.json  # 配置模板
└── NERV Panel-complete.md  # 需求与执行文档
```

## 说明

- 只支持局域网访问，不做公网、云端中转、账号登录。
- 读不到的硬件或接口数据一律传 `null`，前端显示「—」，不编造数值。
- 日志写入 `logs/`（同样被 `.gitignore` 忽略）。

## License

MIT
