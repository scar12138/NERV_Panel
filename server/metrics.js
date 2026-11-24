'use strict';

/**
 * NERV Panel —— 硬件数据采集
 *
 * 数据结构严格遵循需求文档第 4 节，字段一律不删减：
 * {
 *   cpu:  { usage, temp, freq, name },
 *   gpu:  { usage, temp, vramUsed, vramTotal, freq, power, name },
 *   ram:  { usage, used, total },
 *   disks: [{ name, usage, used, total }],
 *   net:  { up, down },
 *   ts
 * }
 *
 * 规则：读不到的一律 null（前端显示「—」），绝不使用随机数或估算值伪造。
 */

const os = require('os');
const path = require('path');
const { execFile } = require('child_process');
const si = require('systeminformation');
const logger = require('./logger');

/* nvidia-smi 不写死绝对路径：先走 PATH，再退到系统目录派生路径 */
function nvidiaSmiCandidates() {
  const list = ['nvidia-smi'];
  const root = process.env.SystemRoot || process.env.windir || 'C:\\Windows';
  list.push(path.join(root, 'System32', 'nvidia-smi.exe'));
  return list;
}

const GB = 1024 * 1024 * 1024;

/* 简单 TTL 缓存：慢速采集项不必每秒都查 */
function makeCache(ttlMs) {
  let value = null;
  let ts = 0;
  return {
    async get(fn) {
      const now = Date.now();
      if (ts && now - ts < ttlMs) return value;
      try {
        const v = await fn();
        value = v;
        ts = Date.now();
        return v;
      } catch (err) {
        logger.warn('采集失败（' + (err && err.message) + '），沿用上次结果');
        return value;
      }
    }
  };
}

const cpuStatic = makeCache(30 * 60 * 1000); // CPU 型号几乎不变
const gpuStatic = makeCache(5 * 60 * 1000); // GPU 型号
const graphicsCache = makeCache(15 * 1000); // WMI 查询较慢
const diskCache = makeCache(5 * 1000); // 磁盘容量变化缓慢
const tempCache = makeCache(3 * 1000); // 温度偶发缺失，稍放宽

let netPrev = null; // 上一次网卡计数，用于自行计算速率
let netPrevTs = 0;

/* --------------------------------------------------------------- CPU ---- */

async function collectCpu() {
  let name = '';
  try {
    const info = await cpuStatic.get(() => si.cpu());
    if (info) {
      const brand = (info.manufacturer || '') + ' ' + (info.brand || '');
      name = brand.replace(/\s+/g, ' ').trim();
      if (info.speed) name += ' @ ' + info.speed + 'GHz';
    }
  } catch (err) {
    /* 读不到就保持空字符串 */
  }

  let usage = null;
  let freq = null;
  try {
    const load = await si.currentLoad();
    if (load && Number.isFinite(load.currentLoad)) usage = Math.round(load.currentLoad * 10) / 10;
  } catch (err) {
    usage = null;
  }
  try {
    const speed = await si.cpuCurrentSpeed();
    if (speed && Number.isFinite(speed.avg) && speed.avg > 0) freq = Math.round(speed.avg * 100) / 100;
  } catch (err) {
    freq = null;
  }

  let temp = null;
  try {
    const t = await tempCache.get(() => si.cpuTemperature());
    if (t && Number.isFinite(t.main) && t.main > 0 && t.main < 130) temp = Math.round(t.main);
  } catch (err) {
    temp = null;
  }

  return { usage, temp, freq, name };
}

/* --------------------------------------------------------------- GPU ---- */

function execFileAsync(file, args, timeout) {
  return new Promise((resolve, reject) => {
    execFile(file, args, { timeout: timeout || 2500, windowsHide: true }, (err, stdout) => {
      if (err) reject(err);
      else resolve(stdout);
    });
  });
}

function numOrNull(raw) {
  if (raw == null) return null;
  const s = String(raw).trim();
  if (!s || /N\/A|Not Supported|Unknown/i.test(s)) return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

async function queryNvidiaSmi() {
  const args = [
    '--query-gpu=name,utilization.gpu,temperature.gpu,memory.used,memory.total,clocks.current.graphics,power.draw',
    '--format=csv,noheader,nounits'
  ];
  const candidates = nvidiaSmiCandidates();
  let lastErr = null;
  for (const bin of candidates) {
    try {
      const out = await execFileAsync(bin, args);
      const line = String(out).split(/\r?\n/).find((l) => l.trim().length > 0);
      if (!line) throw new Error('nvidia-smi 无输出');
      const parts = line.split(',').map((s) => s.trim());
      if (parts.length < 7) throw new Error('nvidia-smi 字段不足');
      return {
        name: parts[0] || '',
        usage: numOrNull(parts[1]),
        temp: numOrNull(parts[2]),
        vramUsed: numOrNull(parts[3]) != null ? numOrNull(parts[3]) * 1024 * 1024 : null,
        vramTotal: numOrNull(parts[4]) != null ? numOrNull(parts[4]) * 1024 * 1024 : null,
        freq: numOrNull(parts[5]),
        power: numOrNull(parts[6])
      };
    } catch (err) {
      lastErr = err;
    }
  }
  throw lastErr || new Error('nvidia-smi 不可用');
}

async function querySysteminformationGpu() {
  const graphics = await graphicsCache.get(() => si.graphics());
  if (!graphics || !Array.isArray(graphics.controllers) || !graphics.controllers.length) {
    return { name: '', usage: null, temp: null, vramUsed: null, vramTotal: null, freq: null, power: null };
  }
  /* 优先独显：显存最大的一颗 */
  const sorted = graphics.controllers.slice().sort((a, b) => (b.vram || 0) - (a.vram || 0));
  const c = sorted[0];
  const vramTotal = c.vram ? c.vram * 1024 * 1024 : null;
  let vramUsed = null;
  if (Number.isFinite(c.memoryUsed)) vramUsed = c.memoryUsed * 1024 * 1024;
  else if (vramTotal != null && Number.isFinite(c.utilizationGpu)) {
    /* systeminformation 在 Windows 上不提供显存占用时不猜，保持 null */
    vramUsed = null;
  }
  return {
    name: c.model || '',
    usage: Number.isFinite(c.utilizationGpu) ? c.utilizationGpu : null,
    temp: Number.isFinite(c.temperatureGpu) && c.temperatureGpu > 0 ? c.temperatureGpu : null,
    vramUsed,
    vramTotal,
    freq: Number.isFinite(c.clockCore) ? c.clockCore : null,
    power: Number.isFinite(c.powerDraw) ? c.powerDraw : null
  };
}

async function collectGpu() {
  try {
    const g = await queryNvidiaSmi();
    const cachedName = await gpuStatic.get(() => Promise.resolve(g.name));
    return {
      usage: g.usage,
      temp: g.temp,
      vramUsed: g.vramUsed,
      vramTotal: g.vramTotal,
      freq: g.freq,
      power: g.power,
      name: cachedName || g.name || ''
    };
  } catch (err) {
    try {
      const g = await querySysteminformationGpu();
      const cachedName = await gpuStatic.get(() => Promise.resolve(g.name));
      return {
        usage: g.usage,
        temp: g.temp,
        vramUsed: g.vramUsed,
        vramTotal: g.vramTotal,
        freq: g.freq,
        power: g.power,
        name: cachedName || g.name || ''
      };
    } catch (err2) {
      return { usage: null, temp: null, vramUsed: null, vramTotal: null, freq: null, power: null, name: '' };
    }
  }
}

/* --------------------------------------------------------------- RAM ---- */

async function collectRam() {
  try {
    const m = await si.mem();
    if (!m || !m.total) return { usage: null, used: null, total: null };
    const used = m.active || m.used || 0;
    return {
      usage: Math.round((used / m.total) * 1000) / 10,
      used: Math.round(used),
      total: Math.round(m.total)
    };
  } catch (err) {
    return { usage: null, used: null, total: null };
  }
}

/* ------------------------------------------------------------- disks ---- */

function isVirtualFs(fs) {
  const label = ((fs.fs || '') + ' ' + (fs.type || '')).toLowerCase();
  if (!fs.size) return true;
  return /tmpfs|devfs|overlay|squashfs|proc|sysfs|ramfs/.test(label);
}

async function collectDisks() {
  try {
    const list = await diskCache.get(() => si.fsSize());
    if (!Array.isArray(list)) return [];
    const seen = new Set();
    return list
      .filter((fs) => !isVirtualFs(fs))
      .filter((fs) => {
        const key = (fs.mount || '') + '|' + (fs.size || 0);
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      })
      .map((fs) => ({
        name: fs.mount || fs.fs || '',
        usage: Number.isFinite(fs.use) ? Math.round(fs.use * 10) / 10 : null,
        used: Number.isFinite(fs.used) ? Math.round(fs.used) : null,
        total: Number.isFinite(fs.size) ? Math.round(fs.size) : null
      }))
      .slice(0, 8);
  } catch (err) {
    return [];
  }
}

/* --------------------------------------------------------------- net ---- */

function pickNetInterfaces(stats) {
  if (!Array.isArray(stats) || !stats.length) return [];
  const virtualRe = /loopback|virtual|vmware|virtualbox|vethernet|hyper-v|loopback pseudo|bluetooth|teredo|isatap|tap|tun|vpn|zerotier|tailscale/i;
  const real = stats.filter((s) => s && !virtualRe.test(s.iface || '') && !virtualRe.test(s.operstate === 'unknown' ? '' : ''));
  return real.length ? real : stats;
}

async function collectNet() {
  try {
    const now = Date.now();
    const stats = await si.networkStats();
    const list = pickNetInterfaces(stats);
    let rx = 0;
    let tx = 0;
    let hasValue = false;
    list.forEach((s) => {
      if (Number.isFinite(s.rx_sec) && s.rx_sec >= 0) {
        rx += s.rx_sec;
        hasValue = true;
      }
      if (Number.isFinite(s.tx_sec) && s.tx_sec >= 0) {
        tx += s.tx_sec;
        hasValue = true;
      }
    });

    let down = hasValue ? rx / 1024 / 1024 : null; // MB/s
    let up = hasValue ? tx / 1024 / 1024 : null;

    /* systeminformation 首帧可能返回 0，用累计字节自行补算一次 */
    if ((!hasValue || (rx === 0 && tx === 0)) && netPrev) {
      const dt = (now - netPrevTs) / 1000;
      if (dt > 0.2) {
        let rxBytes = 0;
        let txBytes = 0;
        list.forEach((s) => {
          const prev = netPrev[s.iface];
          if (!prev) return;
          if (Number.isFinite(s.rx_bytes)) rxBytes += Math.max(0, s.rx_bytes - prev.rx);
          if (Number.isFinite(s.tx_bytes)) txBytes += Math.max(0, s.tx_bytes - prev.tx);
        });
        down = rxBytes / dt / 1024 / 1024;
        up = txBytes / dt / 1024 / 1024;
      }
    }

    const snapshot = {};
    list.forEach((s) => {
      snapshot[s.iface] = { rx: s.rx_bytes, tx: s.tx_bytes };
    });
    netPrev = snapshot;
    netPrevTs = now;

    return {
      up: up == null ? null : Math.round(up * 100) / 100,
      down: down == null ? null : Math.round(down * 100) / 100
    };
  } catch (err) {
    return { up: null, down: null };
  }
}

/* ------------------------------------------------------------ 汇总出口 --- */

async function collect() {
  const [cpu, gpu, ram, disks, net] = await Promise.all([
    collectCpu(),
    collectGpu(),
    collectRam(),
    collectDisks(),
    collectNet()
  ]);
  return { cpu, gpu, ram, disks, net, ts: Date.now() };
}

/**
 * 定义一个按固定间隔采集、并把结果交给订阅者的采样器。
 * 上一轮未结束时直接跳过本轮，避免堆积。
 */
function createSampler(intervalMs) {
  const listeners = new Set();
  let timer = null;
  let busy = false;
  let latest = null;
  let interval = Math.max(500, Number(intervalMs) || 1000);

  async function tick() {
    if (busy) return;
    busy = true;
    try {
      latest = await collect();
      listeners.forEach((fn) => {
        try {
          fn(latest);
        } catch (err) {
          /* 单个订阅者异常不影响其它订阅者 */
        }
      });
    } catch (err) {
      logger.warn('硬件采集整体失败：' + (err && err.message));
    } finally {
      busy = false;
    }
  }

  return {
    start() {
      if (timer) return;
      tick();
      timer = setInterval(tick, interval);
    },
    stop() {
      if (timer) clearInterval(timer);
      timer = null;
    },
    /** 修改采样间隔（毫秒）；运行中调用会按新间隔重新计时 */
    setIntervalMs(ms) {
      const next = Math.max(500, Number(ms) || 1000);
      if (next === interval) return;
      interval = next;
      if (timer) {
        clearInterval(timer);
        timer = setInterval(tick, interval);
      }
    },
    /** 修改采样间隔（秒），与配置项 refreshIntervalSec 对齐 */
    setIntervalSec(sec) {
      this.setIntervalMs((Number(sec) || 1) * 1000);
    },
    subscribe(fn) {
      listeners.add(fn);
      if (latest) {
        try {
          fn(latest);
        } catch (err) {
          /* 忽略 */
        }
      }
      return () => listeners.delete(fn);
    },
    latest() {
      return latest;
    },
    async once() {
      if (!latest) await tick();
      return latest;
    }
  };
}

module.exports = { collect, createSampler, GB, os };
