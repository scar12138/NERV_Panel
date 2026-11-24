'use strict';

/**
 * NERV Panel —— 服务端入口
 *
 * 阶段 0：读配置、起 HTTP 服务、暴露 /api/status、托管 public 静态资源、打印局域网地址。
 * 阶段 2：WebSocket /ws/metrics 每秒推送真实硬件数据 + /api/metrics 作为 HTTP 降级通道。
 * 阶段 3：/api/weather 真实天气（Open-Meteo，城市读配置）。
 * 阶段 4：/api/apps 扫描可启动项目、/api/apps/:id/icon 图标、/api/launch 白名单启动。
 * 阶段 5：/api/power、/api/system 白名单操作，/api/settings 读写配置；控制类接口全部校验 token。
 */

const path = require('path');
const http = require('http');
const os = require('os');
const configModule = require('./config');
const logger = require('./logger');
const metrics = require('./metrics');
const weather = require('./weather');
const apps = require('./apps');
const launcher = require('./launcher');
const power = require('./power');
const { requireToken } = require('./auth');
const express = require('express');
const { WebSocketServer } = require('ws');

const { loadConfig, getConfig, saveConfig, SERVER_VERSION, ROOT_DIR, lanIPv4 } = configModule;

logger.init();

const { config, created, tokenGenerated } = loadConfig();
if (created) logger.info('未找到 config.json，已生成默认配置');
if (tokenGenerated) logger.info('config.json 中 token 为空，已生成随机 token 并写回');

const app = express();
app.disable('x-powered-by');
app.set('trust proxy', false);

// 请求体只接受 JSON，限制大小，防止误传大文件
app.use(express.json({ limit: '256kb' }));

// 静态资源（前端页面、字体、主视觉图片）
app.use(
  express.static(path.join(ROOT_DIR, 'public'), {
    etag: true,
    maxAge: 0,
    setHeaders(res, filePath) {
      // 字体长缓存，页面自身不缓存，保证改版后平板刷新即生效
      if (/\.woff2?$/i.test(filePath)) res.setHeader('Cache-Control', 'public, max-age=604800');
    }
  })
);

// ---- 状态接口 ----
const startedAt = Date.now();

app.get('/api/status', (req, res) => {
  res.json({
    ok: true,
    name: os.hostname(),
    ip: lanIPv4(),
    port: getConfig().port,
    version: SERVER_VERSION,
    online: true,
    uptimeSec: Math.floor((Date.now() - startedAt) / 1000),
    ts: Date.now()
  });
});

// 前端配置只暴露非敏感字段（token 不下发，见阶段 5 说明）
app.get('/api/config', (req, res) => {
  const c = getConfig();
  res.json({
    ok: true,
    config: {
      weatherCity: c.weatherCity,
      heroImagePath: c.heroImagePath,
      refreshIntervalSec: c.refreshIntervalSec,
      tabletWakeEnabled: c.tabletWakeEnabled,
      tabletWakeUrl: c.tabletWakeUrl,
      port: c.port
    }
  });
});

// ---- 硬件数据（HTTP 轮询降级通道） ----
const sampler = metrics.createSampler(Math.max(1, Number(getConfig().refreshIntervalSec) || 1) * 1000);

app.get('/api/metrics', async (req, res) => {
  try {
    const data = await sampler.once();
    if (!data) {
      res.status(503).json({ ok: false, error: 'NOT_READY', message: '硬件数据尚未采集完成' });
      return;
    }
    res.json({ ok: true, metrics: data });
  } catch (err) {
    logger.error('读取硬件数据失败：' + (err && err.message));
    res.status(500).json({ ok: false, error: 'METRICS_FAILED', message: '硬件数据读取失败' });
  }
});

// ---- 天气（阶段 3） ----
app.get('/api/weather', async (req, res) => {
  try {
    const data = await weather.getWeather();
    res.json({ ok: true, weather: data });
  } catch (err) {
    const msg = err && err.message ? err.message : 'UNKNOWN';
    logger.warn('天气获取失败：' + msg);
    if (msg === 'CITY_NOT_FOUND') {
      res.status(404).json({ ok: false, error: 'CITY_NOT_FOUND', message: '未找到城市：' + getConfig().weatherCity });
      return;
    }
    res.status(502).json({ ok: false, error: 'WEATHER_UPSTREAM', message: '天气服务暂时不可用' });
  }
});

// ---- 可启动项目（阶段 4） ----
app.get('/api/apps', async (req, res) => {
  try {
    const list = await apps.scanApps(req.query.refresh === '1');
    res.json({
      ok: true,
      apps: list.map((a) => ({
        id: a.id,
        name: a.name,
        type: a.type,
        hasIcon: !!a.iconKey
      }))
    });
  } catch (err) {
    logger.error('扫描可启动项目失败：' + (err && err.message));
    res.status(500).json({ ok: false, error: 'SCAN_FAILED', message: '扫描可启动项目失败' });
  }
});

app.get('/api/apps/:id/icon', async (req, res) => {
  const item = apps.getById(req.params.id);
  if (!item) {
    res.status(404).json({ ok: false, error: 'APP_NOT_FOUND', message: '项目不存在' });
    return;
  }
  let file = null;
  try {
    file = await apps.ensureIcon(item);
  } catch (err) {
    file = null;
  }
  if (!file) {
    res.status(404).json({ ok: false, error: 'ICON_UNAVAILABLE', message: '图标未提取到，使用占位图' });
    return;
  }
  res.setHeader('Cache-Control', 'public, max-age=86400');
  res.sendFile(file);
});

// ---- 启动项目（控制类：必须校验 token） ----
app.post('/api/launch', requireToken, async (req, res) => {
  const body = req.body || {};
  const result = await launcher.launch(body.id);
  res.status(result.ok ? 200 : 400).json(result);
});

// ---- 电源（控制类：必须校验 token，服务端再次白名单校验） ----
app.post('/api/power', requireToken, async (req, res) => {
  const body = req.body || {};
  const result = await power.power(body.action);
  res.status(result.ok ? 200 : 400).json(result);
});

// ---- 系统操作（控制类：熄灭显示器 / 打开任务管理器） ----
app.post('/api/system', requireToken, async (req, res) => {
  const body = req.body || {};
  const result = await power.systemAction(body.action);
  res.status(result.ok ? 200 : 400).json(result);
});

// ---- 设置读写（阶段 5） ----
app.post('/api/settings', requireToken, (req, res) => {
  try {
    const body = req.body || {};
    const patch = {};

    if (Object.prototype.hasOwnProperty.call(body, 'weatherCity')) patch.weatherCity = body.weatherCity;
    if (Object.prototype.hasOwnProperty.call(body, 'heroImagePath')) patch.heroImagePath = body.heroImagePath;
    if (Object.prototype.hasOwnProperty.call(body, 'refreshIntervalSec')) {
      patch.refreshIntervalSec = body.refreshIntervalSec;
    }
    if (Object.prototype.hasOwnProperty.call(body, 'tabletWakeEnabled')) {
      patch.tabletWakeEnabled = body.tabletWakeEnabled;
    }
    if (Object.prototype.hasOwnProperty.call(body, 'tabletWakeUrl')) patch.tabletWakeUrl = body.tabletWakeUrl;
    if (Object.prototype.hasOwnProperty.call(body, 'tabletWakePassword')) {
      patch.tabletWakePassword = body.tabletWakePassword;
    }
    if (Object.prototype.hasOwnProperty.call(body, 'port')) patch.port = body.port;

    if (!Object.keys(patch).length) {
      res.status(400).json({ ok: false, error: 'EMPTY_PATCH', message: '没有需要保存的设置项' });
      return;
    }

    const result = saveConfig(patch);
    logger.info('设置已更新：' + (result.changed.length ? result.changed.join(', ') : '无变化'));
    res.json({
      ok: true,
      changed: result.changed,
      needsRestart: result.needsRestart,
      config: {
        weatherCity: result.config.weatherCity,
        heroImagePath: result.config.heroImagePath,
        refreshIntervalSec: result.config.refreshIntervalSec,
        tabletWakeEnabled: result.config.tabletWakeEnabled,
        tabletWakeUrl: result.config.tabletWakeUrl,
        port: result.config.port
      }
    });
  } catch (err) {
    logger.warn('保存设置失败：' + (err && err.message));
    res.status(400).json({ ok: false, error: 'INVALID_SETTINGS', message: err && err.message ? err.message : '设置不合法' });
  }
});

app.use((req, res) => {
  res.status(404).json({ ok: false, error: 'NOT_FOUND', message: '接口或资源不存在' });
});

app.use((err, req, res, next) => {
  logger.error('未处理异常：' + (err && err.stack ? err.stack : err));
  res.status(500).json({ ok: false, error: 'INTERNAL', message: '服务端内部错误' });
});

const server = http.createServer(app);

// ---- WebSocket：每秒推送一次 ----
const wss = new WebSocketServer({ server, path: '/ws/metrics' });

wss.on('connection', (ws, req) => {
  const peer = (req.socket && req.socket.remoteAddress) || 'unknown';
  logger.info('WebSocket 客户端接入：' + peer);
  ws.isAlive = true;
  ws.on('pong', () => {
    ws.isAlive = true;
  });

  const unsub = sampler.subscribe((data) => {
    if (ws.readyState !== ws.OPEN) return;
    try {
      ws.send(JSON.stringify({ type: 'metrics', data }));
    } catch (err) {
      /* 发送失败交由 close 处理 */
    }
  });

  ws.on('close', () => {
    unsub();
    logger.info('WebSocket 客户端断开：' + peer);
  });
  ws.on('error', (err) => {
    logger.warn('WebSocket 错误（' + peer + '）：' + (err && err.message));
  });
});

// 心跳：清理掉线但不发 close 的连接，避免订阅者泄漏
const wssHeartbeat = setInterval(() => {
  wss.clients.forEach((ws) => {
    if (ws.isAlive === false) {
      ws.terminate();
      return;
    }
    ws.isAlive = false;
    try {
      ws.ping();
    } catch (err) {
      /* 忽略 */
    }
  });
}, 30000);
wssHeartbeat.unref && wssHeartbeat.unref();

const PORT = Number(config.port) || 5000;
server.listen(PORT, '0.0.0.0', () => {
  sampler.start();
  const ip = lanIPv4();
  logger.info('NERV Panel 服务已启动，版本 ' + SERVER_VERSION);
  logger.info('本机访问：http://localhost:' + PORT);
  logger.info('平板访问：http://' + ip + ':' + PORT);
  console.log('');
  console.log('  NERV PANEL / MAGI ONLINE');
  console.log('  ----------------------------------------');
  console.log('  http://' + ip + ':' + PORT);
  console.log('  ----------------------------------------');
  console.log('');
});

server.on('error', (err) => {
  if (err && err.code === 'EADDRINUSE') {
    logger.error('端口 ' + PORT + ' 已被占用，请修改 config.json 的 port 后重启');
  } else {
    logger.error('HTTP 服务异常：' + (err && err.message));
  }
  process.exit(1);
});

process.on('uncaughtException', (err) => {
  logger.error('未捕获异常：' + (err && err.stack ? err.stack : err));
});
process.on('unhandledRejection', (reason) => {
  logger.error('未处理的 Promise 拒绝：' + (reason && reason.stack ? reason.stack : reason));
});

function shutdown(signal) {
  logger.info('收到 ' + signal + '，正在关闭服务');
  sampler.stop();
  clearInterval(wssHeartbeat);
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 3000);
}
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));

module.exports = { app, server, wss };
