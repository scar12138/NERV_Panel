'use strict';

/**
 * NERV Panel —— 系统媒体会话（SMTC）封装
 *
 * Windows 有一个系统级的媒体传输控件（System Media Transport Controls），
 * 网易云音乐、QQ 音乐、浏览器里的播放器只要接入了 SMTC，都能从这里读到
 * 当前曲目与播放状态，并且能发「上一首/播放暂停/下一首」指令。
 *
 * 这里**不调用任何一家音乐软件的私有接口**（网易云没有公开 API，
 * 逆向私有接口既违反文档要求也极易失效）。读不到就如实返回 available:false。
 *
 * PowerShell 部分见 server/ps/media-session.ps1：
 *   - 常驻一个 loop 进程，每 1.5 秒输出一行 JSON，Node 侧只读最后一行
 *   - 这样避免每次查询都起一个 PowerShell（实测 600–900ms），
 *     切歌时前端能在一秒内跟上
 */

const path = require('path');
const { spawn } = require('child_process');
const logger = require('./logger');

const SCRIPT = path.join(__dirname, 'ps', 'media-session.ps1');
const POLL_MS = 1500;
/** 超过这个时间没收到新快照，就当数据失效，不要拿旧歌名一直显示 */
const STALE_MS = 6000;

let child = null;
let restartTimer = 0;
let restartDelay = 1000;
let stopped = true;
let buf = '';

/** 最近一次解析出的快照。null = 还没有任何数据 */
let latest = null;
let latestAt = 0;

/** 缩略图缓存：hash → { b64, mime }。只在 PS 传回新 hash 时更新。 */
const thumbCache = new Map();

const EMPTY = { available: false, title: null, artist: null, isPlaying: false, app: null, thumbHash: null, hasThumb: false };

function handleLine(line) {
  const raw = line.trim();
  if (!raw || raw.charAt(0) !== '{') return;
  let j;
  try {
    j = JSON.parse(raw);
  } catch (err) {
    return;
  }
  if (!j || j.ok !== true) return;
  latest = {
    available: Boolean(j.available),
    title: j.title == null ? null : String(j.title),
    artist: j.artist == null ? null : String(j.artist),
    isPlaying: Boolean(j.isPlaying),
    app: j.app == null ? null : String(j.app),
    thumbHash: j.thumbHash ? String(j.thumbHash) : null,
    hasThumb: Boolean(j.thumbHash)
  };
  latestAt = Date.now();
  /* 能持续收到快照说明子进程稳定，重置退避，下一次崩溃仍从 1 秒开始重试 */
  restartDelay = 1000;
  /* 有新缩略图数据时写进缓存（hash 不变则 PS 不会带 base64，沿用旧缓存） */
  if (j.thumbHash && j.thumbnail) {
    thumbCache.set(String(j.thumbHash), { b64: String(j.thumbnail), mime: j.thumbnailMime ? String(j.thumbnailMime) : 'image/jpeg' });
    /* 只留最近 3 张，防止长时间播放切歌把内存撑大 */
    if (thumbCache.size > 3) {
      const first = thumbCache.keys().next().value;
      if (first) thumbCache.delete(first);
    }
  }
}

/**
 * 取某张缩略图。返回 { b64, mime } 或 null。
 * @param {string} hash
 */
function thumb(hash) {
  if (!hash) return null;
  const hit = thumbCache.get(String(hash));
  return hit || null;
}

function startLoop() {
  if (stopped || child) return;
  try {
    child = spawn(
      'powershell.exe',
      [
        '-NoProfile',
        '-NonInteractive',
        '-ExecutionPolicy',
        'Bypass',
        '-File',
        SCRIPT,
        '-Mode',
        'loop',
        '-PollMs',
        String(POLL_MS)
      ],
      { windowsHide: true, stdio: ['ignore', 'pipe', 'ignore'] }
    );
  } catch (err) {
    logger.warn('媒体会话进程启动失败：' + (err && err.message));
    scheduleRestart();
    return;
  }

  child.stdout.setEncoding('utf8');
  child.stdout.on('data', (chunk) => {
    buf += chunk;
    let nl;
    while ((nl = buf.indexOf('\n')) >= 0) {
      handleLine(buf.slice(0, nl));
      buf = buf.slice(nl + 1);
    }
    /* 防止极端情况下缓冲区无限增长 */
    if (buf.length > 64 * 1024) buf = '';
  });

  child.on('error', (err) => {
    logger.warn('媒体会话进程错误：' + (err && err.message));
  });

  child.on('exit', (code) => {
    child = null;
    buf = '';
    if (!stopped) {
      logger.warn('媒体会话进程退出（code ' + code + '），稍后重启');
      scheduleRestart();
    }
  });
}

function scheduleRestart() {
  if (stopped || restartTimer) return;
  restartTimer = setTimeout(() => {
    restartTimer = 0;
    restartDelay = Math.min(30000, restartDelay * 2);
    startLoop();
  }, restartDelay);
}

function start() {
  if (!stopped) return;
  stopped = false;
  startLoop();
}

function stop() {
  stopped = true;
  clearTimeout(restartTimer);
  restartTimer = 0;
  if (child) {
    try {
      child.kill();
    } catch (err) {
      /* 已经退出 */
    }
    child = null;
  }
  buf = '';
}

/**
 * 当前媒体状态。永远返回同一形状的对象：
 *   { available, title, artist, isPlaying, app, thumbHash, hasThumb }
 * 没有任何会话或数据过期时 available=false，其余字段为 null / false。
 */
function current() {
  if (!latest || Date.now() - latestAt > STALE_MS) {
    return Object.assign({}, EMPTY);
  }
  return Object.assign({}, latest);
}

/**
 * 发送控制指令。只接受 prev / play / pause / playPause / next。
 * 走一次性的 PowerShell 调用（不是常驻进程），因为点击本身是低频操作。
 */
function control(action) {
  const ALLOWED = ['prev', 'play', 'pause', 'playPause', 'next'];
  if (ALLOWED.indexOf(action) < 0) {
    return Promise.resolve({ ok: false, error: 'ACTION_NOT_ALLOWED', message: '不支持的控制指令' });
  }
  return new Promise((resolve) => {
    let out = '';
    let done = false;
    const finish = (r) => {
      if (done) return;
      done = true;
      resolve(r);
    };
    let p;
    try {
      p = spawn(
        'powershell.exe',
        [
          '-NoProfile',
          '-NonInteractive',
          '-ExecutionPolicy',
          'Bypass',
          '-File',
          SCRIPT,
          '-Mode',
          'control',
          '-Action',
          action
        ],
        { windowsHide: true, stdio: ['ignore', 'pipe', 'ignore'] }
      );
    } catch (err) {
      finish({ ok: false, error: 'SPAWN_FAILED', message: String((err && err.message) || '') });
      return;
    }
    p.stdout.setEncoding('utf8');
    p.stdout.on('data', (c) => {
      out += c;
    });
    p.on('error', (err) => {
      finish({ ok: false, error: 'SPAWN_FAILED', message: String((err && err.message) || '') });
    });
    p.on('exit', () => {
      const line = out.split(/\r?\n/).filter((l) => l.trim().charAt(0) === '{').pop();
      if (!line) {
        finish({ ok: false, error: 'NO_OUTPUT', message: '媒体会话没有返回结果' });
        return;
      }
      let j;
      try {
        j = JSON.parse(line);
      } catch (err) {
        finish({ ok: false, error: 'BAD_OUTPUT', message: '媒体会话返回的内容无法解析' });
        return;
      }
      if (j.ok) finish({ ok: true });
      else finish({ ok: false, error: j.message || 'CONTROL_FAILED', message: mediaErrorText(j.message) });
    });
    setTimeout(() => {
      /* 超时后把 PowerShell 子进程杀掉，否则它会一直挂着占资源 */
      try {
        p.kill();
      } catch (err) {
        /* 已经退出 */
      }
      finish({ ok: false, error: 'TIMEOUT', message: '媒体会话没有响应' });
    }, 8000);
  });
}

function mediaErrorText(code) {
  if (code === 'NO_SESSION') return '电脑上没有正在播放的媒体';
  if (code === 'SESSION_REFUSED') return '播放器拒绝了这次操作';
  return String(code || '操作失败');
}

module.exports = { start, stop, current, control, thumb };
