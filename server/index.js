'use strict';

/**
 * NERV Panel —— 服务端入口
 *
 * 职责（阶段 0）：读配置、起 HTTP 服务、暴露 /api/status、托管 public 静态资源、
 * 启动时在控制台打印局域网访问地址。
 */

const path = require('path');
const http = require('http');
const os = require('os');
const configModule = require('./config');
const logger = require('./logger');
const express = require('express');

const { loadConfig, getConfig, SERVER_VERSION, ROOT_DIR, lanIPv4 } = configModule;

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
app.use(express.static(path.join(ROOT_DIR, 'public'), {
  etag: true,
  maxAge: 0,
  setHeaders(res, filePath) {
    // 字体长缓存，页面自身不缓存，保证改版后平板刷新即生效
    if (/\.woff2?$/i.test(filePath)) res.setHeader('Cache-Control', 'public, max-age=604800');
  }
}));

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

app.use((req, res) => {
  res.status(404).json({ ok: false, error: 'NOT_FOUND', message: '接口或资源不存在' });
});

app.use((err, req, res, next) => {
  logger.error('未处理异常：' + (err && err.stack ? err.stack : err));
  res.status(500).json({ ok: false, error: 'INTERNAL', message: '服务端内部错误' });
});

const server = http.createServer(app);

const PORT = Number(config.port) || 5000;
server.listen(PORT, '0.0.0.0', () => {
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
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 3000);
}
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));

module.exports = { app, server };
