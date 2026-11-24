'use strict';

/**
 * NERV Panel —— 进程运行状态与关闭应用
 *
 * 为什么要单独一个模块：
 *   apps.js 负责「这台机器上有什么可以启动」，本模块负责「它现在是不是在跑」
 *   以及「把它正常关掉」。两件事的数据来源完全不同（前者读开始菜单与 Steam 库，
 *   后者读进程表），放在一起会让 apps.js 变得难读。
 *
 * 读不到就返回 false / 明确失败原因，绝不猜、绝不假装成功。
 */

const { execFile } = require('child_process');
const logger = require('./logger');

/* tasklist 实测 660–780ms，每秒调一次太浪费；5 秒缓存足够反映「刚启动/刚关闭」 */
const PROC_TTL_MS = 5 * 1000;

let cache = { at: 0, set: new Set(), names: [] };
let inFlight = null;

function execFileAsync(bin, args, timeoutMs) {
  return new Promise((resolve, reject) => {
    execFile(
      bin,
      args,
      { timeout: timeoutMs, windowsHide: true, maxBuffer: 8 * 1024 * 1024 },
      (err, stdout) => (err ? reject(err) : resolve(String(stdout || '')))
    );
  });
}

/**
 * 解析 `tasklist /fo csv /nh` 的输出。
 * 每行形如 "微信.exe","12345","Console","1","123,456 K"
 * 用 CSV 解析而不是 split(',')，因为内存列自带千分位逗号。
 */
function parseTasklist(text) {
  const set = new Set();
  const names = [];
  text.split(/\r?\n/).forEach((line) => {
    const raw = line.trim();
    if (!raw || raw.indexOf('"') !== 0) return;
    /* 第一个引号到第二个引号之间就是进程名 */
    const end = raw.indexOf('"', 1);
    if (end < 0) return;
    const name = raw.slice(1, end).toLowerCase();
    if (!name) return;
    set.add(name);
    names.push(name);
  });
  return { set, names };
}

/**
 * 当前运行的进程名集合（小写、含扩展名，如 "wechat.exe"）。
 * 5 秒内的重复调用直接返回缓存，并发调用合并成一次查询。
 */
function runningSet() {
  const now = Date.now();
  if (cache.at && now - cache.at < PROC_TTL_MS) return Promise.resolve(cache);
  if (inFlight) return inFlight;

  inFlight = (async () => {
    try {
      const out = await execFileAsync('tasklist', ['/fo', 'csv', '/nh'], 12000);
      const parsed = parseTasklist(out);
      cache = { at: Date.now(), set: parsed.set, names: parsed.names };
    } catch (err) {
      /* 查询失败时保留上一份结果（比清空好：清空会让所有应用瞬间显示"未运行"）。
         从未成功过时 cache.at 仍为 0，调用方据此区分「未知」与「确实没在跑」。 */
      logger.warn('进程列表查询失败：' + (err && err.message));
    }
    return cache;
  })();

  try {
    return inFlight;
  } finally {
    inFlight.finally(() => {
      inFlight = null;
    });
  }
}

/** 从未成功读到过进程表 → 前端不该显示运行状态 */
function isAvailable() {
  return cache.at > 0;
}

/**
 * 挂起等待 ms 毫秒。关闭应用后要给进程一点时间真正退出，
 * 否则立刻复查会得到"还在跑"的错误结论。
 */
function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

/**
 * 按进程名正常关闭（taskkill 不带 /F 会先发 WM_CLOSE 给窗口，属于正常关闭）。
 * 返回 {ok, message}。
 */
async function killByName(exeName, waitMs) {
  const name = String(exeName || '').trim();
  if (!name) return { ok: false, message: '没有可用的进程名' };

  try {
    await execFileAsync('taskkill', ['/IM', name, '/T'], 12000);
  } catch (err) {
    const msg = String((err && err.message) || '');
    /* 进程本来就不在，对调用方来说等价于"已经关掉了" */
    if (/not found|没有运行|找不到/i.test(msg)) {
      return { ok: true, message: '进程已经不在运行' };
    }
    return { ok: false, message: msg || 'taskkill 失败' };
  }

  await sleep(waitMs == null ? 1200 : waitMs);
  const fresh = await runningSet();
  if (fresh.set.has(name.toLowerCase())) {
    return {
      ok: false,
      message: '应用没有响应关闭请求，可能正在等待保存或用户确认'
    };
  }
  /* 关闭成功后立刻清缓存，让下一次查询马上反映真实状态 */
  cache = { at: 0, set: new Set(), names: [] };
  return { ok: true, message: '已关闭' };
}

module.exports = { runningSet, isAvailable, killByName };
