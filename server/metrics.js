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
const netwatch = require('./netwatch');

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

/**
 * 后台自刷新缓存（非阻塞）。
 *
 * 为什么需要它：systeminformation 在 Windows 上每个查询都要起 PowerShell 子进程，
 * mem() 0.57 秒、fsSize() 0.49 秒、cpuTemperature() 0.56 秒、graphics() 1.3 秒。
 * 如果每秒一次的采样循环里同步 await 它们，一次 tick 就要 3 秒以上，
 * 根本做不到「每秒推一次」。
 *
 * 这里的语义是：采样循环只 peek() 上一轮的现成结果，永远不等；
 * 真正耗时查询交给 refresh() 在后台按自己的节奏跑，跑完更新缓存。
 * 首次还没拿到结果时返回 null —— 按需求文档第 4 节，读不到就是 null，不编造。
 */
function makeAsyncCache(ttlMs) {
  let value = null;
  let ts = 0;
  let inflight = null;
  let lastError = null;

  function refresh(fn) {
    // 距上次成功刷新还不到 ttl，或者上一轮还在跑，就直接跳过
    if (Date.now() - ts < ttlMs) return inflight || Promise.resolve(value);
    if (inflight) return inflight;
    inflight = (async () => {
      try {
        const v = await fn();
        // 查询本身失败时 fn 会抛，这里不覆盖旧值，也不把旧值当新值刷时间戳
        if (v !== undefined) {
          value = v;
          ts = Date.now();
          lastError = null;
        }
      } catch (err) {
        lastError = err && err.message ? err.message : String(err);
        logger.warn('后台采集失败（' + lastError + '），沿用上次结果');
      } finally {
        inflight = null;
      }
      return value;
    })();
    return inflight;
  }

  return {
    /** 同步取当前缓存值，可能是 null，永远不会等待 */
    peek() {
      return value;
    },
    /** 触发一次后台刷新（受 ttl 与 in-flight 保护），返回 Promise 供预热用 */
    refresh,
    /** 是否已经拿到过至少一次结果 */
    has() {
      return ts > 0;
    },
    lastError() {
      return lastError;
    }
  };
}

const cpuStatic = makeCache(30 * 60 * 1000); // CPU 型号几乎不变
const gpuStatic = makeCache(5 * 60 * 1000); // GPU 型号
// 以下四项走后台自刷新，不阻塞每秒采样
const memCache = makeAsyncCache(900); // 内存占用，1 秒内复用
const tempCacheAsync = makeAsyncCache(1500); // CPU 温度
const diskCacheAsync = makeAsyncCache(3000); // 磁盘容量变化缓慢
const graphicsCacheAsync = makeAsyncCache(15000); // WMI 显卡查询最慢

const tempCache = makeCache(3 * 1000); // 温度偶发缺失，稍放宽

/* --------------------------------------------------------------- CPU ---- */

/* systeminformation 的 manufacturer（如 "Intel"）和 brand（如
   "Gen Intel® Core™ i7-12700H"）常常重复包含厂商名，拼接后会出现
   "Intel Gen Intel® Core™ ..." 这种重复。这里统一清洗：去掉厂商名前缀
   与 "Gen" / "12th Gen" 这类代次前缀，只保留 "Intel® Core™ i7-12700H"。 */
function cleanCpuName(info) {
  let brand = String(info.brand || '').trim();
  const mfr = String(info.manufacturer || '').trim();
  const vendor = String(info.vendor || '').trim();
  const prefixes = [];
  if (mfr) prefixes.push(mfr);
  if (vendor && vendor.toLowerCase() !== mfr.toLowerCase()) prefixes.push(vendor);
  let changed = false;
  for (const pre of prefixes) {
    const esc = pre.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const r1 = new RegExp('^' + esc + '\\s+Gen\\s+', 'i'); // "Intel Gen Intel®..."
    const r2 = new RegExp('^' + esc + '\\s+', 'i'); // "Intel Intel®..." / "AMD AMD..."
    const before = brand;
    brand = brand.replace(r1, '').replace(r2, '');
    if (brand !== before) changed = true;
  }
  /* 剩下的 "Gen " / "12th Gen " 代次前缀也剥掉（只保留一次型号名） */
  brand = brand
    .replace(/^(?:[A-Za-z]+)?\s*\d{0,2}(?:st|nd|rd|th)\s+Gen\s+/i, '')
    .replace(/^\s*Gen\s+/i, '')
    .replace(/\s+/g, ' ')
    .trim();
  /* 防呆：剥完如果品牌没了（罕见布局），退回原始 brand */
  if (!brand) return String(info.brand || '').trim();
  /* 去重：万一厂商名以别的形式重复出现（"Intel(R) Intel(R) Core..."） */
  if (mfr) {
    const mfrEsc = mfr.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const dup = new RegExp('^(' + mfrEsc + '[^A-Za-z]*){2,}', 'i');
    brand = brand.replace(dup, mfr + ' ');
  }
  return brand.replace(/\s+/g, ' ').trim();
}

async function collectCpu() {
  let name = '';
  try {
    const info = await cpuStatic.get(() => si.cpu());
    if (info) {
      name = cleanCpuName(info);
      if (info.speed) name += ' @ ' + info.speed + 'GHz';
    }
  } catch (err) {
    /* 读不到就保持空字符串 */
  }

  let usage = null;
  let freq = null;
  let cores = null;
  try {
    const load = await si.currentLoad();
    if (load && Number.isFinite(load.currentLoad)) usage = Math.round(load.currentLoad * 10) / 10;
    /* 每核心占用：currentLoad().cpus[].load 是系统接口真实给出的，能给就给，
       给不了保持 null，前端据此显示「系统接口未提供」而不是编造。 */
    if (load && Array.isArray(load.cpus) && load.cpus.length) {
      const arr = load.cpus.map((c) => (c && Number.isFinite(c.load) ? Math.round(c.load) : null));
      if (arr.some((v) => v !== null)) cores = arr;
    }
  } catch (err) {
    usage = null;
  }
  try {
    const speed = await si.cpuCurrentSpeed();
    /* systeminformation 的 cpuCurrentSpeed().avg 单位是 GHz（本机实测返回 2.5），
       不是 MHz。这里统一换算成 MHz 存（2500），前端按 MHz 显示，
       避免前端各自猜单位导致「0.00 GHz」这种错误。 */
    if (speed && Number.isFinite(speed.avg) && speed.avg > 0) freq = Math.round(speed.avg * 1000);
  } catch (err) {
    freq = null;
  }

  // 只读后台缓存，不在这里等 PowerShell
  const t = tempCacheAsync.peek();
  const temp = t && Number.isFinite(t.main) && t.main > 0 && t.main < 130 ? Math.round(t.main) : null;

  return { usage, temp, freq, name, cores };
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
  const graphics = graphicsCacheAsync.peek();
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
  // 内存走后台缓存（si.mem() 在 Windows 上要 0.57 秒）
  const m = memCache.peek();
  if (!m || !m.total) return { usage: null, used: null, total: null };
  const used = m.active || m.used || 0;
  return {
    usage: Math.round((used / m.total) * 1000) / 10,
    used: Math.round(used),
    total: Math.round(m.total)
  };
}

/* ------------------------------------------------------------- disks ---- */

function isVirtualFs(fs) {
  const label = ((fs.fs || '') + ' ' + (fs.type || '')).toLowerCase();
  if (!fs.size) return true;
  return /tmpfs|devfs|overlay|squashfs|proc|sysfs|ramfs/.test(label);
}

async function collectDisks() {
  const list = diskCacheAsync.peek();
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
}

/* --------------------------------------------------------------- net ---- */

/**
 * 网络速率。
 *
 * 不用 si.networkStats()：它在 Windows 上每次都起 PowerShell 子进程，实测 1.8–4.6 秒，
 * 会把每秒一次的采样拖垮。改由 netwatch 常驻进程提供，详见 server/netwatch.js。
 * 常驻进程还没攒够两次采样时返回 null，前端显示「—」，不补 0、不估算。
 */
async function collectNet() {
  const r = netwatch.current();
  return {
    up: r.up == null ? null : Math.round(r.up * 100) / 100,
    down: r.down == null ? null : Math.round(r.down * 100) / 100
  };
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
 * 触发一轮后台刷新。采样循环每秒调它一次，所有慢查询都在这里被 ttl 限流，
 * 绝不会阻塞 collect()。
 */
function refreshSlowCaches() {
  // 显卡：只有 nvidia-smi 不可用时才需要 WMI 兜底，但那也放进后台
  graphicsCacheAsync.refresh(() => si.graphics());
  memCache.refresh(() => si.mem());
  tempCacheAsync.refresh(() => si.cpuTemperature());
  diskCacheAsync.refresh(() => si.fsSize());
}

/**
 * 预热：启动时先把慢速查询跑一遍，让第一条快照就带真实数据。
 * 返回的 Promise 只用于日志，采样循环本身不等它。
 */
async function warmUp() {
  const jobs = [
    cpuStatic.get(() => si.cpu()),
    /* GPU 型号由 collectGpu() 自己在第一次采样时写入 gpuStatic，
       这里绝不能拿 si.cpu() 去预热 —— 那会把 CPU 信息对象塞进 GPU 型号缓存，
       前端就会显示成 [object Object]。 */
    graphicsCacheAsync.refresh(() => si.graphics()),
    memCache.refresh(() => si.mem()),
    tempCacheAsync.refresh(() => si.cpuTemperature()),
    diskCacheAsync.refresh(() => si.fsSize())
  ];
  await Promise.allSettled(jobs);
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
      // 先让慢查询在后台跑起来，再取当前缓存值：这一轮用的可能是上一轮的结果，
      // 但对 1 秒粒度的仪表盘足够，而且永远不会被 PowerShell 拖住。
      refreshSlowCaches();
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

/* --------------------------------------------------------- 历史序列 --- */

/**
 * 在内存里保留最近一段监控历史，供 GET /api/metrics/history 给详情页画长走势。
 *
 * 需求文档第 4 节：至少保留最近 10 分钟，按 refreshIntervalSec 采样；重启后从零积累，
 * 绝不写入编造的历史。这里按 12 分钟容量留一点余量。
 *
 * 每条记录只存画曲线需要的标量，不存完整快照，避免长时间运行后内存膨胀。
 */
const HISTORY_CAPACITY_MS = 12 * 60 * 1000;

function createHistory(sampler) {
  /** @type {Array<{ts:number,cpu:number|null,gpu:number|null,ram:number|null,netUp:number|null,netDown:number|null}>} */
  const points = [];
  let unsubscribe = null;

  function num(v) {
    return typeof v === 'number' && Number.isFinite(v) ? v : null;
  }

  function push(snapshot) {
    if (!snapshot || !snapshot.ts) return;
    points.push({
      ts: snapshot.ts,
      cpu: num(snapshot.cpu && snapshot.cpu.usage),
      gpu: num(snapshot.gpu && snapshot.gpu.usage),
      ram: num(snapshot.ram && snapshot.ram.usage),
      netUp: num(snapshot.net && snapshot.net.up),
      netDown: num(snapshot.net && snapshot.net.down)
    });
    // 按时间淘汰，而不是只按条数，这样采样间隔改大也不会过早丢历史
    const cutoff = Date.now() - HISTORY_CAPACITY_MS;
    let drop = 0;
    while (drop < points.length && points[drop].ts < cutoff) drop += 1;
    if (drop > 0) points.splice(0, drop);
  }

  function start() {
    if (unsubscribe) return;
    unsubscribe = sampler.subscribe(push);
  }

  function stop() {
    if (unsubscribe) unsubscribe();
    unsubscribe = null;
  }

  /**
   * 返回历史序列。磁盘占用率是按盘的容量数据，不随时间变化画出走势，
   * 所以磁盘详情不画曲线（需求文档第 5.1 节明确这一项不算缺失）。
   */
  function get(limitMs) {
    if (!points.length) {
      return { points: [], from: null, to: null, spanSec: 0, capacitySec: HISTORY_CAPACITY_MS / 1000 };
    }
    const windowMs = Math.max(1000, Math.min(HISTORY_CAPACITY_MS, Number(limitMs) || HISTORY_CAPACITY_MS));
    const cutoff = Date.now() - windowMs;
    const slice = points.filter((p) => p.ts >= cutoff);
    const use = slice.length ? slice : points;
    const from = use[0].ts;
    const to = use[use.length - 1].ts;
    return {
      points: use,
      from,
      to,
      // 实际已积累时长（秒）：历史不足 10 分钟时前端据此注明真实时长，不补假数据
      spanSec: Math.max(0, Math.round((to - from) / 1000)),
      capacitySec: HISTORY_CAPACITY_MS / 1000
    };
  }

  return { start, stop, get, push };
}

module.exports = { collect, createSampler, createHistory, HISTORY_CAPACITY_MS, warmUp, GB, os };
