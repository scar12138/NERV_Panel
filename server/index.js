'use strict';

/**
 * NERV Panel —— 服务端入口
 *
 * 阶段 0：读配置、起 HTTP 服务、暴露 /api/status、托管 public 静态资源、打印局域网地址。
 * 阶段 2：WebSocket /ws/metrics 每秒推送真实硬件数据 + /api/metrics 作为 HTTP 降级通道。
 * 阶段 3：/api/weather 真实天气（Open-Meteo，城市读配置）。
 * 阶段 4：/api/apps 扫描可启动项目、/api/apps/:id/icon 图标、/api/launch 白名单启动。
 * 阶段 5：/api/power、/api/system 白名单操作，/api/settings 读写配置；控制类接口全部校验 token。
 * 阶段 6：/api/metrics/history 十分钟历史、/api/favorites 常用软件、/api/close-app 关闭应用、
 *         /api/media 与 /api/media/control 系统媒体会话、/api/hero-image 更换主视觉图片。
 */

const path = require('path');
const fs = require('fs');
const http = require('http');
const os = require('os');
const configModule = require('./config');
const logger = require('./logger');
const metrics = require('./metrics');
const netwatch = require('./netwatch');
const media = require('./media');
const weather = require('./weather');
const apps = require('./apps');
const favorites = require('./favorites');
const hero = require('./hero');
const launcher = require('./launcher');
const power = require('./power');
const { requireToken, verifyRawToken } = require('./auth');
const wake = require('./wake');
const express = require('express');
const { WebSocketServer } = require('ws');

const { loadConfig, getConfig, saveConfig, SERVER_VERSION, ROOT_DIR, PUBLIC_DIR, lanIPv4 } = configModule;

logger.init();

const { config, created, tokenGenerated, migrated } = loadConfig();
if (created) logger.info('未找到 config.json，已生成默认配置');
if (tokenGenerated) logger.info('config.json 中 token 为空，已生成随机 token 并写回');
if (Array.isArray(migrated) && migrated.length) {
  migrated.forEach((m) => logger.info('配置已迁移：' + m));
}

const app = express();
app.disable('x-powered-by');
app.set('trust proxy', false);

// 请求体只接受 JSON，限制大小，防止误传大文件
app.use(express.json({ limit: '256kb' }));

// 静态资源（前端页面、字体、主视觉图片）
app.use(
  express.static(PUBLIC_DIR, {
    etag: true,
    maxAge: 0,
    setHeaders(res, filePath) {
      // 字体长缓存，页面自身不缓存，保证改版后平板刷新即生效
      if (/\.woff2?$/i.test(filePath)) res.setHeader('Cache-Control', 'public, max-age=604800');
    }
  })
);

/**
 * 用户上传的主视觉图片。
 * data/hero 不在 public 下（避免整个 data 目录被静态托管），这里只暴露这一个前缀，
 * 并且用 path.basename 掐掉任何 ../ 之类的路径穿越企图。
 */
app.get('/custom-hero/:file', (req, res) => {
  const name = path.basename(String(req.params.file || ''));
  if (!/^hero-\d+\.(jpg|png|webp)$/i.test(name)) {
    res.status(404).json({ ok: false, error: 'NOT_FOUND', message: '图片不存在' });
    return;
  }
  const full = path.join(hero.HERO_DIR, name);
  if (!fs.existsSync(full)) {
    res.status(404).json({ ok: false, error: 'NOT_FOUND', message: '图片不存在' });
    return;
  }
  res.setHeader('Cache-Control', 'public, max-age=86400');
  res.sendFile(full);
});

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

// 前端配置只暴露非敏感字段（token 不下发；tabletWakeUrl 含内网 IP，也不下发）
app.get('/api/config', (req, res) => {
  const c = getConfig();
  res.json({
    ok: true,
    config: {
      weatherCity: c.weatherCity,
      heroImagePath: c.heroImagePath,
      customHeroImagePath: c.customHeroImagePath,
      favoriteAppIds: c.favoriteAppIds,
      refreshIntervalSec: c.refreshIntervalSec,
      tabletWakeEnabled: c.tabletWakeEnabled,
      port: c.port
    }
  });
});

// ---- 硬件数据（HTTP 轮询降级通道） ----
const sampler = metrics.createSampler(Math.max(1, Number(getConfig().refreshIntervalSec) || 1) * 1000);
/* 最近 12 分钟的标量历史，供详情层的走势图用（文档要求至少 10 分钟） */
const history = metrics.createHistory(sampler);

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

/**
 * 最近 10 分钟监控历史。
 * 服务端刚起来时序列可能是空的 —— 就返回空数组并把实际积累时长（spanSec）一起给出，
 * 前端据此显示「历史不足，当前仅 N 秒」，绝不补假点。
 * ?minutes=N 可缩短范围（详情层的图表用），上限就是缓冲容量。
 */
app.get('/api/metrics/history', (req, res) => {
  const wantMin = Number(req.query.minutes);
  const limitMs =
    Number.isFinite(wantMin) && wantMin > 0
      ? Math.min(metrics.HISTORY_CAPACITY_MS, wantMin * 60 * 1000)
      : 10 * 60 * 1000;
  try {
    res.json({ ok: true, history: history.get(limitMs) });
  } catch (err) {
    logger.error('读取监控历史失败：' + (err && err.message));
    res.status(500).json({ ok: false, error: 'HISTORY_FAILED', message: '读取监控历史失败' });
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
/**
 * 全量列表。每项带 running（true / false / null —— null 表示这台机器上判断不了）。
 * 文档明确：这是全量列表，只供「添加常用」挑选和搜索用，
 * 不要在启动页默认铺满全部应用（默认只显示常用）。
 */
app.get('/api/apps', async (req, res) => {
  try {
    const list = await apps.scanApps(req.query.refresh === '1');
    const withRun = await apps.withRunning(list);
    res.json({ ok: true, apps: withRun });
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
  try {
    const body = req.body || {};
    const result = await launcher.launch(body.id);
    res.status(result.ok ? 200 : 400).json(result);
  } catch (err) {
    logger.error('启动应用异常：' + (err && err.message));
    res.status(500).json({ ok: false, error: 'LAUNCH_FAILED', message: '启动时发生内部错误' });
  }
});

// ---- 关闭应用（控制类：必须校验 token，只关该 id 对应的一个进程） ----
app.post('/api/close-app', requireToken, async (req, res) => {
  try {
    const body = req.body || {};
    const result = await apps.closeApp(body.id);
    res.status(result.ok ? 200 : 400).json(result);
  } catch (err) {
    logger.error('关闭应用失败：' + (err && err.message));
    res.status(500).json({ ok: false, error: 'CLOSE_FAILED', message: '关闭应用时出错' });
  }
});

// ---- 常用软件（GET 只读不必鉴权；POST 是控制类，必须校验 token） ----
app.get('/api/favorites', async (req, res) => {
  try {
    res.json({ ok: true, favorites: await favorites.list() });
  } catch (err) {
    logger.error('读取常用软件失败：' + (err && err.message));
    res.status(500).json({ ok: false, error: 'FAVORITES_FAILED', message: '读取常用软件失败' });
  }
});

app.post('/api/favorites', requireToken, async (req, res) => {
  try {
    const body = req.body || {};
    const result = await favorites.update(body.action, body.id);
    res.status(result.ok ? 200 : 400).json(result);
  } catch (err) {
    logger.error('更新常用软件失败：' + (err && err.message));
    res.status(500).json({ ok: false, error: 'FAVORITES_FAILED', message: '更新常用软件失败' });
  }
});

// ---- 系统媒体会话（读音乐信息与三个控制键） ----
app.get('/api/media', (req, res) => {
  const m = media.current();
  res.json({
    ok: true,
    media: {
      available: m.available,
      title: m.title,
      artist: m.artist,
      isPlaying: m.isPlaying,
      app: m.app,
      thumbHash: m.thumbHash || null
    }
  });
});

// ---- 专辑封面（需求二.5）：SMTC 通道里有缩略图就返回，没有就 404 ----
app.get('/api/media/thumbnail', (req, res) => {
  const hash = String(req.query.hash || '');
  if (!hash || hash.length > 128) {
    res.status(404).json({ ok: false, error: 'NO_THUMB', message: '没有缩略图信息' });
    return;
  }
  const hit = media.thumb(hash);
  if (!hit || !hit.b64) {
    res.status(404).json({ ok: false, error: 'NO_THUMB', message: '缩略图不存在或已过期' });
    return;
  }
  const buf = Buffer.from(hit.b64, 'base64');
  res.setHeader('Content-Type', hit.mime || 'image/jpeg');
  res.setHeader('Cache-Control', 'private, max-age=3600');
  res.setHeader('Content-Length', buf.length);
  res.send(buf);
});

app.post('/api/media/control', requireToken, async (req, res) => {
  const body = req.body || {};
  const result = await media.control(body.action);
  res.status(result.ok ? 200 : 400).json(result);
});

// ---- 更换主视觉图片（控制类：必须校验 token，文件类型与大小服务端再校验） ----
app.post(
  '/api/hero-image',
  requireToken,
  express.raw({ type: ['image/jpeg', 'image/png', 'image/webp'], limit: '8mb' }),
  (req, res) => {
    const result = hero.saveHeroImage(req.body);
    res.status(result.ok ? 200 : 400).json(result);
  }
);

// ---- 恢复默认主视觉图片 ----
app.post('/api/hero-image/reset', requireToken, (req, res) => {
  const result = hero.resetHeroImage();
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
    if (Object.prototype.hasOwnProperty.call(body, 'customHeroImagePath')) {
      patch.customHeroImagePath = body.customHeroImagePath;
    }
    if (Object.prototype.hasOwnProperty.call(body, 'favoriteAppIds')) {
      patch.favoriteAppIds = body.favoriteAppIds;
    }
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

    // 刷新间隔改了：让采样器按新间隔重启，前端不必等重启服务端
    if (result.changed.indexOf('refreshIntervalSec') >= 0) {
      sampler.stop();
      sampler.setIntervalSec(result.config.refreshIntervalSec);
      sampler.start();
      logger.info('采样间隔已切换为 ' + result.config.refreshIntervalSec + ' 秒');
    }

    res.json({
      ok: true,
      changed: result.changed,
      needsRestart: result.needsRestart,
      config: {
        weatherCity: result.config.weatherCity,
        heroImagePath: result.config.heroImagePath,
        customHeroImagePath: result.config.customHeroImagePath,
        favoriteAppIds: result.config.favoriteAppIds,
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

/* 本机（loopback）专用设置读写 —— 提供给 exe 自带设置窗口（需求六.1）。
   只允许 127.0.0.1 / ::1 来源，局域网其他设备访问一律拒绝，所以不需要 token。
   读写范围与 /api/settings 完全一致，前端网页仍走 token 版接口。 */
function isLoopback(req) {
  const addr = (req.socket && req.socket.remoteAddress) || '';
  return addr === '127.0.0.1' || addr === '::1' || addr === '::ffff:127.0.0.1';
}

/* 双重校验（来源 IP + Host 请求头）防御 DNS rebinding：
   恶意域名解析到 127.0.0.1 后，浏览器发起的请求 Host 头仍是那个域名，
   而非 localhost/127.0.0.1，因此 isLoopbackHost() 会拒绝它。
   两项校验缺一不可，共同构成对 DNS rebinding 的完整防御。 */
function isLoopbackHost(req) {
  const raw = String((req.headers && req.headers.host) || '').trim().toLowerCase();
  if (!raw) return false;
  const host = raw.replace(/:\d+$/, '').replace(/^\[/, '').replace(/\]$/, '');
  return host === 'localhost' || host === '127.0.0.1' || host === '::1';
}

function isLocalRequest(req) {
  return isLoopback(req) && isLoopbackHost(req);
}

app.get('/api/settings/local', (req, res) => {
  if (!isLocalRequest(req)) {
    res.status(403).json({ ok: false, error: 'NOT_LOOPBACK', message: '该接口仅限本机访问' });
    return;
  }
  const c = getConfig();
  res.json({
    ok: true,
    config: {
      port: c.port,
      token: c.token,
      weatherCity: c.weatherCity,
      weatherApiUrl: c.weatherApiUrl,
      refreshIntervalSec: c.refreshIntervalSec,
      tabletWakeEnabled: c.tabletWakeEnabled,
      tabletWakeUrl: c.tabletWakeUrl,
      tabletWakePassword: c.tabletWakePassword,
      heroImagePath: c.heroImagePath,
      customHeroImagePath: c.customHeroImagePath,
      favoriteAppIds: c.favoriteAppIds
    }
  });
});

app.post('/api/settings/local', (req, res) => {
  if (!isLocalRequest(req)) {
    res.status(403).json({ ok: false, error: 'NOT_LOOPBACK', message: '该接口仅限本机访问' });
    return;
  }
  try {
    const body = req.body || {};
    const patch = {};
    const keys = [
      'port', 'token', 'weatherCity', 'weatherApiUrl', 'refreshIntervalSec',
      'tabletWakeEnabled', 'tabletWakeUrl', 'tabletWakePassword',
      'heroImagePath', 'customHeroImagePath', 'favoriteAppIds'
    ];
    keys.forEach((k) => {
      if (Object.prototype.hasOwnProperty.call(body, k)) patch[k] = body[k];
    });
    if (!Object.keys(patch).length) {
      res.status(400).json({ ok: false, error: 'EMPTY_PATCH', message: '没有需要保存的设置项' });
      return;
    }
    const result = saveConfig(patch);
    logger.info('本机设置已更新：' + (result.changed.length ? result.changed.join(', ') : '无变化'));
    if (result.changed.indexOf('refreshIntervalSec') >= 0) {
      sampler.stop();
      sampler.setIntervalSec(result.config.refreshIntervalSec);
      sampler.start();
    }
    const c = result.config;
    res.json({
      ok: true,
      changed: result.changed,
      needsRestart: result.needsRestart,
      config: {
        port: c.port, token: c.token, weatherCity: c.weatherCity, weatherApiUrl: c.weatherApiUrl,
        refreshIntervalSec: c.refreshIntervalSec, tabletWakeEnabled: c.tabletWakeEnabled,
        tabletWakeUrl: c.tabletWakeUrl, tabletWakePassword: c.tabletWakePassword,
        heroImagePath: c.heroImagePath, customHeroImagePath: c.customHeroImagePath,
        favoriteAppIds: c.favoriteAppIds
      }
    });
  } catch (err) {
    logger.warn('本机保存设置失败：' + (err && err.message));
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
/* 浏览器发起的连接必须与本页面同源；没有 Origin 的非浏览器客户端（脚本、测试）放行 */
function isAllowedWsOrigin(req) {
  const origin = req.headers && req.headers.origin;
  if (!origin) return true;
  let u;
  try {
    u = new URL(origin);
  } catch (err) {
    return false;
  }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return false;
  const host = String(req.headers.host || '').toLowerCase();
  return Boolean(host) && u.host.toLowerCase() === host;
}

const wss = new WebSocketServer({
  server,
  path: '/ws/metrics',
  verifyClient: (info, cb) => {
    // 同源检查：浏览器必须与服务端同域
    if (!isAllowedWsOrigin(info.req)) {
      cb(false, 403, 'Origin 不被允许');
      return;
    }
    // Token 鉴权：从 URL 查询串 ?token=... 读取
    // 浏览器 WebSocket API 不支持自定义请求头，改用 URL 参数传递
    let token = '';
    try {
      const u = new URL(info.req.url, 'http://localhost');
      token = u.searchParams.get('token') || '';
    } catch (_) {}
    const r = verifyRawToken(token);
    if (!r.ok) {
      cb(false, 401, r.message);
      return;
    }
    cb(true);
  }
});

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
  /* 网络计数器是常驻子进程，越早开越早有数据 */
  netwatch.start();
  /* 媒体会话同理：先跑起来，第一个 /api/media 请求就能拿到东西 */
  media.start();
  /* 历史缓冲从第一个采样点开始记录，越早订上越早满足「至少 10 分钟」的要求 */
  history.start();
  /* 预热硬件缓存（首次查询很慢：graphics 1.6s、mem 0.6s…），
     预热完再启动采样，避免前几帧数据全是 null */
  metrics
    .warmUp()
    .catch((err) => logger.warn('硬件缓存预热失败：' + (err && err.message)))
    .then(() => {
      sampler.start();
    });

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

  // 阶段 6 第二层：平板唤醒（config.json 的 tabletWakeEnabled 默认 false，
  // 关闭时此调用会立即返回且不产生任何网络请求）
  wake.wakeTablet('服务端启动').then((r) => {
    if (r.skipped === 'DISABLED') logger.info('平板唤醒未开启（tabletWakeEnabled=false），跳过');
  });

  // 启动后主动扫描一次可启动项目：顺带把图标在后台提取好。
  // 不预热的话，第一次打开启动页要等上百张图标逐个生成（约半分钟）。
  // 这里延迟 3 秒，先让首个页面请求和监控数据跑起来，不跟它们抢 CPU。
  setTimeout(() => {
    apps.scanApps().catch((err) => logger.warn('启动扫描失败：' + (err && err.message)));
  }, 3000);
});

/* ws 在构造时会把 HTTP server 的 'error' 原样转发到 WebSocketServer 上
   （见 ws/lib/websocket-server.js 的 addListeners）。这里必须挂一个监听器，
   否则端口占用时那次转发会在 EventEmitter 里直接抛出，抢在下面的 EADDRINUSE
   处理之前变成「未捕获异常」，退出码 2 就永远发不出去。 */
wss.on('error', (err) => {
  logger.warn('WebSocket 服务异常：' + (err && err.message));
});

server.on('error', (err) => {
  if (err && err.code === 'EADDRINUSE') {
    logger.error('端口 ' + PORT + ' 已被占用，请修改 config.json 的 port 后重启');
    process.exit(2); // 2 = 配置错误，start.bat 不再自动重启
  } else {
    logger.error('HTTP 服务异常：' + (err && err.message));
    process.exit(1);
  }
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
  netwatch.stop();
  media.stop();
  clearInterval(wssHeartbeat);
  // 先主动断开所有 WebSocket 客户端，避免 server.close() 因连接未断而挂起
  wss.clients.forEach((ws) => { try { ws.terminate(); } catch (err) { /* 忽略 */ } });
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 3000);
}
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));

module.exports = { app, server, wss };
