'use strict';

/**
 * NERV Panel —— 网络速率采集
 *
 * 为什么不用 si.networkStats()：在 Windows 上 systeminformation 每次调用都要起一个
 * PowerShell 子进程，实测 1.8–4.6 秒。放在每秒一次的采样循环里会把整个 tick 拖到 5 秒，
 * 直接违背「监控数据每秒推送一次」的要求。
 *
 * 这里的做法是起一个常驻 PowerShell 进程，用 Get-NetAdapterStatistics 每秒输出一次
 * 各网卡的累计收发字节数，Node 侧按两次采样的差值算出速率。常驻进程只在启动时慢一次，
 * 之后每次采样几乎零成本。
 *
 * 读不到就返回 null（前端显示「—」），绝不估算。
 */

const path = require('path');
const { spawn } = require('child_process');
const logger = require('./logger');

const SCRIPT = path.join(__dirname, 'ps', 'net-counters.ps1');

/* 虚拟网卡：这些不是真实的局域网链路，混进来会把速率算歪 */
const VIRTUAL_RE = /loopback|virtual|vmware|virtualbox|vethernet|hyper-v|bluetooth|teredo|isatap|\btap\b|\btun\b|vpn|zerotier|tailscale|npcap|wsl/i;

let child = null;
let running = false;
let buffer = '';
let lastSample = null; // { ts, adapters: Map<name, {rx, tx}> }
let rate = { up: null, down: null };
let startTimer = null;
let retryDelay = 1000;

function isReal(name) {
  return !VIRTUAL_RE.test(name || '');
}

function handleSample(payload) {
  if (!payload || !Array.isArray(payload.adapters)) return;
  const now = typeof payload.ts === 'number' ? payload.ts : Date.now();

  let rx = 0;
  let tx = 0;
  let counted = 0;
  const map = new Map();

  for (const a of payload.adapters) {
    if (!a || typeof a.n !== 'string') continue;
    const rxBytes = Number(a.rx);
    const txBytes = Number(a.tx);
    if (!Number.isFinite(rxBytes) || !Number.isFinite(txBytes)) continue;
    map.set(a.n, { rx: rxBytes, tx: txBytes });
    if (!isReal(a.n)) continue;
    counted += 1;
    rx += rxBytes;
    tx += txBytes;
  }
  if (counted === 0) return; // 只有虚拟网卡时不参与速率计算

  if (lastSample) {
    const dt = (now - lastSample.ts) / 1000;
    if (dt > 0.2) {
      let dRx = 0;
      let dTx = 0;
      map.forEach((cur, name) => {
        if (!isReal(name)) return;
        const prev = lastSample.adapters.get(name);
        if (!prev) return; // 新出现的网卡这一轮不计
        // 计数器回绕或重置时跳过，不产生负数或假峰值
        dRx += Math.max(0, cur.rx - prev.rx);
        dTx += Math.max(0, cur.tx - prev.tx);
      });
      rate = {
        up: Math.round((dTx / dt / 1024 / 1024) * 100) / 100,
        down: Math.round((dRx / dt / 1024 / 1024) * 100) / 100
      };
    }
  }

  lastSample = { ts: now, adapters: map };
}

function handleLine(line) {
  const text = line.trim();
  if (!text) return;
  let payload;
  try {
    payload = JSON.parse(text);
  } catch (err) {
    return; // 非 JSON 的输出（例如 PowerShell 的告警）直接忽略
  }
  if (payload.error) {
    logger.warn('网络计数采样失败：' + payload.error);
    return;
  }
  handleSample(payload);
}

function spawnWatcher() {
  if (running) return;
  running = true;
  try {
    child = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', SCRIPT], {
      windowsHide: true
    });
  } catch (err) {
    running = false;
    logger.warn('网络计数进程启动失败：' + (err && err.message));
    scheduleRetry();
    return;
  }

  child.stdout.setEncoding('utf8');
  child.stdout.on('data', (chunk) => {
    buffer += chunk;
    let idx;
    while ((idx = buffer.indexOf('\n')) >= 0) {
      const line = buffer.slice(0, idx);
      buffer = buffer.slice(idx + 1);
      handleLine(line);
    }
  });

  child.stderr.setEncoding('utf8');
  child.stderr.on('data', (chunk) => {
    const msg = String(chunk).trim();
    if (msg) logger.warn('网络计数进程 stderr：' + msg.slice(0, 300));
  });

  child.on('exit', (code) => {
    running = false;
    child = null;
    buffer = '';
    lastSample = null;
    rate = { up: null, down: null };
    if (!stopping) {
      logger.warn('网络计数进程退出（code=' + code + '），' + retryDelay + 'ms 后重启');
      scheduleRetry();
    }
  });

  const p = child;
  child.on('error', (err) => {
    logger.warn('网络计数进程异常：' + (err && err.message));
    /* spawn 失败（例如找不到 powershell.exe）不会触发 exit，必须在这里复位并排重试，
       否则 running 一直是 true，网络速率永远不再恢复 */
    if (child === p) {
      child = null;
      running = false;
      buffer = '';
      if (!stopping) scheduleRetry();
    }
  });
}

let stopping = false;

function scheduleRetry() {
  if (startTimer) return;
  startTimer = setTimeout(() => {
    startTimer = null;
    retryDelay = Math.min(retryDelay * 2, 30000);
    if (!stopping) spawnWatcher();
  }, retryDelay);
  if (startTimer.unref) startTimer.unref();
}

function start() {
  stopping = false;
  retryDelay = 1000;
  spawnWatcher();
}

function stop() {
  stopping = true;
  if (startTimer) {
    clearTimeout(startTimer);
    startTimer = null;
  }
  if (child) {
    try {
      child.kill();
    } catch (err) {
      /* 忽略 */
    }
    child = null;
  }
  running = false;
  lastSample = null;
  rate = { up: null, down: null };
}

function current() {
  return { up: rate.up, down: rate.down };
}

/** 是否已经拿到至少两次采样（否则速率只能是 null） */
function ready() {
  return rate.up !== null && rate.down !== null;
}

module.exports = { start, stop, current, ready };
