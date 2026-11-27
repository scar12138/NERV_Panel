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
      bin === 'powershell.exe' ? args.map((arg, i) => i === args.length - 1
        ? '[Console]::OutputEncoding=New-Object System.Text.UTF8Encoding($false);' + arg : arg) : args,
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
      /* 刚被关掉的名字可能在 tasklist 里残留几秒，复核一次剔掉假阳性 */
      await reconcileClosed();
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
 * taskkill 的报错里哪些其实是「它已经不在跑了」。
 *
 * 实测（Windows 11 + wordpad.exe）会遇到一种中间状态：进程正在退出，
 * `tasklist` 还能列出映像名，但 `taskkill /F` 报
 *   ERROR: The process with PID 7304 could not be terminated.
 *   Reason: There is no running instance of the task.
 * 这时报「关闭失败」是错的 —— 用户看到的进程其实已经在消失。
 * 同理 /IM 匹配不到时会报 "not found" / "没有运行"。
 */
const GONE_RE = /not found|no running instance|no tasks are running|not running|没有运行|找不到|未找到|不存在/i;
function isGoneMessage(msg) {
  return GONE_RE.test(String(msg || ''));
}

/**
 * 判定某个映像名是否真的还有活着的进程。
 *
 * 为什么不用 tasklist：进程被强杀后会在 tasklist 里残留 8~9 秒
 * （状态仍是 Running，但 PowerShell 里 HasExited=True），
 * 用它判断会把「已经关掉」误判成「还在跑」，正好是用户抱怨的那个现象。
 * PowerShell 的 Process 对象带 HasExited，能区分「活着」和「正在退出」。
 *
 * 只用在关闭流程的几次复查上（不是每秒轮询），多花 ~300ms 可以接受。
 */
function psQuote(s) {
  return "'" + String(s).replace(/'/g, "''") + "'";
}

function baseNameOf(exeName) {
  return String(exeName || '').replace(/\.exe$/i, '');
}

async function isAlive(exeName) {
  const base = baseNameOf(exeName);
  if (!base) return false;
  const script =
    '$p = @(Get-Process -Name ' + psQuote(base) + ' -ErrorAction SilentlyContinue | ' +
    'Where-Object { -not $_.HasExited }); ' +
    'if ($p.Count -gt 0) { Write-Output $p[0].Id } ';
  try {
    const out = await execFileAsync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], 15000);
    return String(out || '').trim().length > 0;
  } catch (err) {
    /* PowerShell 起不来时保守一点：退回 tasklist 的结论 */
    const fresh = await runningSet();
    return fresh.set.has(String(exeName || '').toLowerCase());
  }
}

/**
 * 刚被关闭过的映像名（小写 → 时间戳）。
 *
 * 用途：tasklist 对「已经结束但句柄还没释放」的进程仍会列出 8~9 秒，
 * 于是刚点完「关闭」，卡片上还会显示「运行中」和关闭按钮。这里记下
 * 最近关掉的名字，在 runningSet 重建缓存时对它们做一次 HasExited 复核，
 * 把假阳性剔掉。
 */
const recentlyClosed = new Map();
const CLOSED_TTL_MS = 20 * 1000;

function markClosed(exeName) {
  const key = String(exeName || '').toLowerCase();
  if (key) recentlyClosed.set(key, Date.now());
}

/** 批量复核：返回这些名字里「确实还活着」的子集 */
async function aliveAmong(names) {
  const alive = new Set();
  const bases = [];
  names.forEach((n) => {
    const b = baseNameOf(n);
    if (b && bases.indexOf(b) < 0) bases.push(b);
  });
  if (!bases.length) return alive;
  const parts = bases.map((b) =>
    'if (@(Get-Process -Name ' + psQuote(b) + ' -ErrorAction SilentlyContinue | ' +
    'Where-Object { -not $_.HasExited }).Count -gt 0) { Write-Output ' + psQuote(b) + ' }'
  );
  try {
    const out = await execFileAsync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', parts.join('; ')], 15000);
    String(out || '').split(/\r?\n/).forEach((line) => {
      const t = line.trim().toLowerCase();
      if (t) alive.add(t + '.exe');
    });
  } catch (err) {
    /* 复核失败就信 tasklist 的结果，宁多报不少报 */
    names.forEach((n) => alive.add(n));
  }
  return alive;
}

/**
 * 从 cache 里剔掉「刚关掉、其实已经退出、但 tasklist 还留着」的名字。
 * 只处理 CLOSED_TTL_MS 内被标记过的名字，且必须先确认这些名字确实
 * 还在 tasklist 里（不在就不必多起一次 PowerShell）。
 */
async function reconcileClosed() {
  if (!recentlyClosed.size) return;
  const now = Date.now();
  const suspects = [];
  recentlyClosed.forEach((at, key) => {
    if (now - at > CLOSED_TTL_MS) {
      recentlyClosed.delete(key);
      return;
    }
    if (cache.set.has(key)) suspects.push(key);
  });
  if (!suspects.length) return;
  const alive = await aliveAmong(suspects);
  suspects.forEach((key) => {
    if (!alive.has(key)) {
      cache.set.delete(key);
      cache.names = cache.names.filter((n) => n !== key);
    }
  });
}

/**
 * 第三级兜底：taskkill 对「正在退出 / 半僵死」的进程会报
 * "There is no running instance of the task" 并拒绝结束，
 * 这时直接按 PID 用 Stop-Process 收掉（只动还没退出的那些）。
 */
async function forceByPid(exeName) {
  const base = baseNameOf(exeName);
  if (!base) return { ok: false, message: '没有可用的进程名' };
  const script =
    'Get-Process -Name ' + psQuote(base) + ' -ErrorAction SilentlyContinue | ' +
    'Where-Object { -not $_.HasExited } | ForEach-Object { Stop-Process -Id $_.Id -Force -ErrorAction SilentlyContinue }';
  try {
    await execFileAsync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], 15000);
  } catch (err) {
    return { ok: false, message: String((err && err.message) || '未知原因') };
  }
  return { ok: true };
}

/** 丢掉进程表缓存，保证下面 runningSet() 拿到的是关闭之后的新快照而不是旧快照 */
function invalidate() {
  require('./game-procs').invalidate();
  cache = { at: 0, set: new Set(), names: [] };
  inFlight = null;
}

/**
 * 按进程名关闭应用（需求二.1：点「关闭」必须真的结束进程）。
 *
 * 之前只发 `taskkill /IM x /T`（不带 /F，等于只发 WM_CLOSE）
 * 然后 1.2 秒复查，仍在就报失败 —— 实测大量程序根本收不到/不理会 WM_CLOSE：
 *   - 没有窗口的后台进程（更新器、托盘常驻进程）没有消息循环；
 *   - 停在模态对话框（保存确认）的程序不会退；
 *   - 多进程应用的主窗口退了，子进程还挂着（/T 只覆盖 taskkill 执行那一刻的树）。
 * 于是「点关闭结束不了进程」。
 *
 * 现在分三级：
 *   1) 先优雅关闭（不带 /F），给用户保存数据的机会；
 *   2) 复查仍在 → 用 /F 强制结束（/T 连子树），再复查；
 *   3) 仍在 → 按 PID 用 Stop-Process 收一次（专治 taskkill 的
 *      "no running instance of the task" 半僵死状态），再复查。
 * 三次复查都用 isAlive()（HasExited 判定），不用 tasklist —— 强杀后
 * tasklist 会残留 8~9 秒，用它会误报「没关掉」。
 * 只有三级都试过复查仍活着才返回失败。
 * /IM 按映像名匹配，同名多实例会一起关闭，这正是「关闭这个应用」的期望语义。
 * 返回 {ok, message, forced?}。
 */
async function killByName(exeName, waitMs) {
  const name = String(exeName || '').trim();
  if (!name) return { ok: false, message: '没有可用的进程名' };
  const wait = waitMs == null ? 1200 : waitMs;
  const closed = () => {
    markClosed(name);
    invalidate();
  };

  /* ---- 第一级：优雅关闭 ---- */
  let gracefulErr = null;
  try {
    await execFileAsync('taskkill', ['/IM', name, '/T'], 12000);
  } catch (err) {
    const msg = String((err && err.message) || '');
    /* 进程本来就不在，对调用方来说等价于"已经关掉了" */
    if (isGoneMessage(msg)) {
      return { ok: true, message: '进程已经不在运行' };
    }
    /* 其它失败（无响应/拒绝访问）不直接返回，继续往下走强杀 */
    gracefulErr = err;
  }

  invalidate();
  await sleep(wait);
  if (!(await isAlive(name))) {
    closed();
    return { ok: true, message: '已关闭' };
  }

  /* ---- 第二级：强制结束 ---- */
  let forceErrMsg = '';
  try {
    await execFileAsync('taskkill', ['/IM', name, '/T', '/F'], 12000);
  } catch (err) {
    forceErrMsg = String((err && err.message) || '');
    if (isGoneMessage(forceErrMsg)) {
      return { ok: true, message: '进程已经不在运行' };
    }
    /* 其它失败先记下来，还有第三级兜底，不在这里就判失败 */
  }

  invalidate();
  await sleep(600);
  if (!(await isAlive(name))) {
    closed();
    return { ok: true, message: '已强制结束', forced: true };
  }

  /* ---- 第三级：按 PID 兜底 ----
     taskkill 会对"正在退出但还没释放"的进程报
     "There is no running instance of the task" 并拒绝结束，
     这种半僵死状态用 Stop-Process 直接按 PID 收一次。 */
  const byPid = await forceByPid(name);
  invalidate();
  await sleep(700);
  if (!(await isAlive(name))) {
    closed();
    return { ok: true, message: '已强制结束', forced: true };
  }

  /* 三级都试过还在，如实说清楚，不谎报成功 */
  const detail = forceErrMsg || gracefulErr && gracefulErr.message || byPid.message || '未知原因';
  return {
    ok: false,
    message: '强制结束命令已发出，但进程仍在运行（可能被系统保护或以其它用户身份运行）',
    detail: String(detail).split('\n')[0]
  };
}

module.exports = { runningSet, isAvailable, killByName, invalidate };
