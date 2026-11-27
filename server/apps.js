'use strict';

/**
 * NERV Panel —— 可启动项目扫描与图标提取
 *
 * 数据来源（全部读取本机真实信息，不写死任何名单）：
 *   1. Windows 开始菜单快捷方式（.lnk），类型记为 software
 *   2. Steam 游戏库 appmanifest_*.acf，类型记为 game
 *
 * 图标：按需从 exe / lnk 提取并缓存到 cache/icons/，提取失败时前端用统一占位图。
 */

const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const { execFile } = require('child_process');
const logger = require('./logger');
const procsApi = require('./procs');
const gameProcs = require('./game-procs');
const { ROOT_DIR } = require('./config');

const CACHE_DIR = path.join(ROOT_DIR, 'cache', 'icons');
const SCAN_TTL_MS = 60 * 1000; // 扫描结果缓存，避免每次进页面都全盘遍历

/* 开始菜单里这些条目不是"可启动应用"，直接过滤。
   除了常规的卸载/说明类，还要滤掉各种工具目录里的子项 ——
   它们躺在开始菜单的文件夹里，但用户从来不会主动去点，
   混在启动页里只会让真正想启动的软件被淹没。 */
const JUNK = /(uninstall|卸载|移除|remove |readme|read me|帮助|help|网站|website|文档|documentation|licen[cs]e|更新|update|cmd|命令提示符|release notes|changelog|反激活|deactivate|激活|activate|数字签名|signature|关于 |about |从早期版本|migrat|日志|log viewer|配置|config|设置|settings|诊断|diagnos|修复|repair|注册|register|许可证|管理系统|manual|使用手册|教程|tutorial|示例|sample|demo|guide|getting started|installation|install additional|Administrative Tools)/i;

function ensureCacheDir() {
  try {
    fs.mkdirSync(CACHE_DIR, { recursive: true });
  } catch (err) {
    /* 目录已存在 */
  }
}

/* ------------------------------------------------------------ PowerShell --- */

function runPs(script, timeoutMs) {
  return new Promise((resolve, reject) => {
    const outFile = path.join(os.tmpdir(), 'nerv-ps-' + process.pid + '-' + Date.now() + '-' + Math.random().toString(36).slice(2, 8) + '.json');
    const full =
      '$ErrorActionPreference="SilentlyContinue";' +
      '[Console]::OutputEncoding=New-Object System.Text.UTF8Encoding($false);' +
      script +
      ' | ConvertTo-Json -Depth 5 -Compress | Out-File -FilePath "' +
      outFile.replace(/\\/g, '\\\\') +
      '" -Encoding UTF8';
    execFile(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', full],
      { timeout: timeoutMs || 20000, windowsHide: true, maxBuffer: 8 * 1024 * 1024 },
      (err) => {
        if (err && !fs.existsSync(outFile)) {
          reject(err);
          return;
        }
        try {
          const raw = fs.readFileSync(outFile, 'utf8').replace(/^\uFEFF/, '').trim();
          fs.unlinkSync(outFile);
          if (!raw || raw === 'null') {
            resolve([]);
            return;
          }
          const parsed = JSON.parse(raw);
          resolve(Array.isArray(parsed) ? parsed : [parsed]);
        } catch (e) {
          try {
            if (fs.existsSync(outFile)) fs.unlinkSync(outFile);
          } catch (_) {
            /* 忽略 */
          }
          reject(e);
        }
      }
    );
  });
}

/* --------------------------------------------------------------- 开始菜单 --- */

function startMenuDirs() {
  const dirs = [];
  const programData = process.env.ProgramData || 'C:\\ProgramData';
  const appData = process.env.APPDATA || '';
  dirs.push(path.join(programData, 'Microsoft', 'Windows', 'Start Menu', 'Programs'));
  if (appData) dirs.push(path.join(appData, 'Microsoft', 'Windows', 'Start Menu', 'Programs'));
  return dirs.filter((d) => {
    try {
      return fs.statSync(d).isDirectory();
    } catch (err) {
      return false;
    }
  });
}

/**
 * 有的旧安装器把 UTF-8 文件名按 GBK 写盘，开始菜单里就会出现「绉婚櫎 MathType」
 * 这种乱码条目（真实内容是「移除 MathType」）。原样显示会误导用户。
 *
 * 还原原理：乱码是「UTF-8 字节被按 GBK 解码」造成的，所以反向操作
 * （先把乱码按 GBK 编码回字节，再按 UTF-8 解码）就能还原。
 * iconv-lite 是 express 的间接依赖，不保证一定存在 —— 拿不到就原样返回，
 * 仅靠 JUNK 正则过滤，不影响主流程。
 */
let iconv = null;
try {
  iconv = require('iconv-lite');
} catch (err) {
  logger.warn('iconv-lite 不可用，开始菜单乱码名不做还原（不影响扫描）');
}

function decodedName(name) {
  const raw = String(name || '');
  if (!iconv || !raw) return raw;
  try {
    const restored = iconv.encode(raw, 'gbk').toString('utf8');
    /* 还原成功必须满足两个条件：结果变了、且不含替换符。
       正常中文按这个流程走会出现替换符，因此会被正确拒绝。 */
    if (restored && restored !== raw && restored.indexOf('\uFFFD') < 0) return restored;
  } catch (err) {
    /* 忽略，保持原名 */
  }
  return raw;
}

async function scanStartMenu() {
  const dirs = startMenuDirs();
  if (!dirs.length) return [];

  /* 一次 PowerShell 调用解析全部 .lnk，避免逐条进程开销 */
  const ps =
    '$s=New-Object -ComObject WScript.Shell;' +
    '$list=@();' +
    'foreach($d in @(' +
    dirs.map((d) => '"' + d.replace(/"/g, '""') + '"').join(',') +
    ')){' +
    ' Get-ChildItem -LiteralPath $d -Recurse -Filter *.lnk -ErrorAction SilentlyContinue | ForEach-Object {' +
    '  $lnk=$_.FullName;' +
    '  $sc=$s.CreateShortcut($lnk);' +
    '  $list+=[pscustomobject]@{name=[System.IO.Path]::GetFileNameWithoutExtension($lnk);path=$lnk;target=$sc.TargetPath;args=$sc.Arguments};' +
    ' }' +
    '}' +
    '$list';

  let items = [];
  try {
    items = await runPs(ps, 25000);
  } catch (err) {
    logger.warn('开始菜单扫描失败：' + (err && err.message));
    return [];
  }

  const seen = new Set();
  const apps = [];
  items.forEach((it) => {
    if (!it || !it.path) return;
    let name = String(it.name || '').trim();
    if (!name || name.length > 60) return;
    /* 原名的乱码还原（GBK→UTF-8），用于判断和显示 */
    const fixed = decodedName(name);
    if (fixed !== name && fixed.indexOf('\uFFFD') < 0) name = fixed;
    if (JUNK.test(name)) return;
    if (JUNK.test(path.basename(it.path))) return;
    const key = name.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    /* 保留真实 exe 路径供启动器转交检测；文档、URL 和空目标不作为进程身份。
       exeName 仍是唯一允许按名关闭的身份，转交检测不会替换它。 */
    const target = String(it.target || '').trim();
    apps.push({
      id: 'app:' + crypto.createHash('sha1').update(it.path).digest('hex').slice(0, 12),
      name,
      type: 'software',
      launch: { kind: 'lnk', path: it.path },
      exeName: /\.exe$/i.test(target) ? path.win32.basename(target) : null,
      targetPath: /\.exe$/i.test(target) ? target : null,
      iconKey: crypto.createHash('sha1').update(it.path).digest('hex')
    });
  });
  return apps;
}

/* ------------------------------------------------------------------ Steam --- */

function readTextIfExists(p) {
  try {
    return fs.readFileSync(p, 'utf8');
  } catch (err) {
    return null;
  }
}

function vdfString(text, key) {
  const re = new RegExp('"' + key + '"\\s+"([^"]*)"', 'i');
  const m = re.exec(text || '');
  return m ? m[1] : null;
}

function steamRoots() {
  const roots = new Set();
  const candidates = [
    'C:\\Program Files (x86)\\Steam',
    'C:\\Program Files\\Steam',
    'D:\\Steam',
    'D:\\SteamLibrary',
    'E:\\Steam'
  ];
  /* 注册表里的 Steam 安装路径优先级最高 */
  const reg = process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)';
  candidates.unshift(path.join(reg, 'Steam'));
  candidates.forEach((c) => {
    try {
      if (fs.statSync(c).isDirectory()) roots.add(c);
    } catch (err) {
      /* 不存在 */
    }
  });
  return Array.from(roots);
}

function readLibraryFolders(steamRoot) {
  const vdfPath = path.join(steamRoot, 'steamapps', 'libraryfolders.vdf');
  const text = readTextIfExists(vdfPath);
  const libs = new Set([steamRoot]);
  if (!text) return Array.from(libs);
  /* 新版格式："path" "D:\\SteamLibrary" */
  const re = /"path"\s+"([^"]+)"/gi;
  let m;
  while ((m = re.exec(text)) !== null) {
    const p = m[1].replace(/\\\\/g, '\\');
    try {
      if (fs.statSync(p).isDirectory()) libs.add(p);
    } catch (err) {
      /* 库目录已移除 */
    }
  }
  /* 旧版格式：直接把盘符路径写在 数字键 下 */
  const re2 = /"\d+"\s+"([A-Za-z]:\\\\\\\\[^"]+)"/g;
  while ((m = re2.exec(text)) !== null) {
    const p = m[1].replace(/\\\\/g, '\\');
    try {
      if (fs.statSync(p).isDirectory()) libs.add(p);
    } catch (err) {
      /* 忽略 */
    }
  }
  return Array.from(libs);
}

function steamInstallDir(appsDir, value) {
  // Manifest installdir must remain within steamapps/common, never a drive root
  // or an escaped parent which could authorize unrelated executables.
  if (!value || path.win32.isAbsolute(value) || /(^|[\\/])\.\.([\\/]|$)/.test(value)) return null;
  const base = path.join(appsDir, 'common');
  const dir = path.resolve(base, value.replace(/\\/g, path.sep));
  const relative = path.relative(base, dir);
  return relative && relative !== '..' && !relative.startsWith('..' + path.sep) && !path.isAbsolute(relative) ? dir : null;
}

function scanSteam() {
  const roots = steamRoots();
  if (!roots.length) return [];
  const rootsWithLibrary = [];
  roots.forEach((r) => {
    readLibraryFolders(r).forEach((l) => {
      if (rootsWithLibrary.indexOf(l) < 0) rootsWithLibrary.push(l);
    });
  });

  const games = [];
  const seen = new Set();
  rootsWithLibrary.forEach((lib) => {
    const appsDir = path.join(lib, 'steamapps');
    let files;
    try {
      files = fs.readdirSync(appsDir);
    } catch (err) {
      return;
    }
    files.forEach((f) => {
      const m = /^appmanifest_(\d+)\.acf$/i.exec(f);
      if (!m) return;
      const appid = m[1];
      if (seen.has(appid)) return;
      const text = readTextIfExists(path.join(appsDir, f));
      if (!text) return;
      const name = vdfString(text, 'name');
      if (!name) return;
      /* StateFlags 是位掩码：FullyInstalled (4) 可同时带更新/暂停等标记。
         本机 Apex 的 1030 (4 | 2 | 1024) 仍有已安装内容，不能按等于 4 过滤。 */
      const stateFlags = vdfString(text, 'StateFlags');
      if (stateFlags && (!/^\d+$/.test(stateFlags) || !Number.isSafeInteger(Number(stateFlags)) || !(Number(stateFlags) & 4))) return;
      seen.add(appid);
      games.push({
        id: 'steam:' + appid,
        name: name.trim(),
        type: 'game',
        appid,
        installDir: steamInstallDir(appsDir, vdfString(text, 'installdir')),
        launch: { kind: 'steam', appid },
        iconKey: null
      });
    });
  });
  return games;
}

/* ----------------------------------------------------------------- 扫描出口 --- */

let cache = { at: 0, list: [] };
let scanning = null;

async function scanApps(force) {
  const now = Date.now();
  if (!force && cache.list.length && now - cache.at < SCAN_TTL_MS) return cache.list;
  if (scanning) return scanning;

  scanning = (async () => {
    const [apps, games] = await Promise.all([scanStartMenu(), Promise.resolve(scanSteam())]);
    const list = apps.concat(games);
    list.sort((a, b) => {
      if (a.type !== b.type) return a.type === 'game' ? -1 : 1;
      return a.name.localeCompare(b.name, 'zh-Hans-CN');
    });
    cache = { at: Date.now(), list };
    logger.info('可启动项目扫描完成：软件 ' + apps.length + ' 项，游戏 ' + games.length + ' 项');
    /* 扫描完在后台把图标逐个提取好。不预热的话，前端第一次打开启动页会同时
       请求上百张图标，每张都要起一个 PowerShell 进程，用户要干等半分钟。
       这里限并发 3 个，避免把机器拖慢；失败不影响任何功能。 */
    prewarmIcons(list);
    return list;
  })();

  try {
    return await scanning;
  } finally {
    scanning = null;
  }
}

let prewarming = false;

async function prewarmIcons(list) {
  if (prewarming || !Array.isArray(list) || !list.length) return;
  prewarming = true;
  const queue = list.slice();
  let okCount = 0;
  let failCount = 0;

  async function worker() {
    while (queue.length) {
      const item = queue.shift();
      const png = iconPathFor(item.iconKey);
      if (item.iconKey && fs.existsSync(png) && fs.statSync(png).size > 0) {
        okCount++;
        continue;
      }
      const got = await ensureIcon(item);
      if (got) okCount++;
      else failCount++;
    }
  }

  try {
    await Promise.all([worker(), worker(), worker()]);
    logger.info('图标预热完成：成功 ' + okCount + ' 张，失败 ' + failCount + ' 张');
  } catch (err) {
    logger.warn('图标预热中断：' + err.message);
  } finally {
    prewarming = false;
  }
}

function getById(id) {
  return cache.list.find((a) => a.id === id) || null;
}

/** 已扫描到的完整列表（不发运行状态，供 favorites 等内部逻辑用） */
function list() {
  return cache.list;
}

// A launcher may exit after handing off to a versioned executable (e.g. WPS).
// Only exact product + description metadata inside its own directory tree is
// evidence of that handoff. Never use display-name similarity or directory alone.
function fallbackCandidate(item, proc) {
  const target = gameProcs.normalized(item.targetPath);
  const executable = gameProcs.normalized(proc.path);
  if (!target || !executable || !/\.exe$/i.test(executable)) return false;
  const dir = path.win32.dirname(target);
  if (path.win32.dirname(dir) === dir || /^(?:[a-z]:\\(?:windows|program files(?: \(x86\))?|programdata)|[a-z]:\\users\\[^\\]+(?:\\appdata(?:\\local|\\roaming)?)?)$/i.test(dir)) return false;
  return executable !== target && executable.startsWith(dir + '\\');
}
let metadataCache = { at: 0, key: '', rows: [] };
async function fallbackMetadata(items, snapshot) {
  const paths = new Set();
  items.forEach((item) => snapshot.processes.forEach((proc) => {
    if (fallbackCandidate(item, proc)) { paths.add(item.targetPath); paths.add(proc.path); }
  }));
  if (!paths.size) return [];
  const values = Array.from(paths).sort();
  const key = JSON.stringify(values);
  if (metadataCache.key === key && Date.now() - metadataCache.at < SCAN_TTL_MS) return metadataCache.rows;
  const script = '$rows=@();foreach($p in @(' + values.map(psQuote).join(',') + ')){' +
    '$f=Get-Item -LiteralPath $p -ErrorAction SilentlyContinue;' +
    'if($f){$v=$f.VersionInfo;$rows+=[pscustomobject]@{path=$p;product=$v.ProductName;description=$v.FileDescription}}};$rows';
  try {
    const rows = await runPs(script, 15000);
    metadataCache = { at: Date.now(), key, rows };
    return rows;
  } catch (_) { return []; }
}
function softwareState(item, procs, available, snapshot, metadata) {
  const name = String(item.exeName || '').toLowerCase();
  if (!name) return { running: null, canClose: false, closeReason: '运行状态未知' };
  const direct = (available && procs.set.has(name)) || (snapshot && snapshot.available && snapshot.processes.some((p) => String(p.name || '').toLowerCase() === name));
  if (direct) return { running: true, canClose: true };
  const target = gameProcs.normalized(item.targetPath);
  const original = metadata.find((m) => gameProcs.normalized(m.path) === target);
  if (original && original.product && original.description && snapshot && snapshot.available) {
    const found = snapshot.processes.some((p) => fallbackCandidate(item, p) && metadata.some((m) =>
      gameProcs.normalized(m.path) === gameProcs.normalized(p.path) &&
      m.product === original.product && m.description === original.description));
    if (found) return { running: true, canClose: false, closeReason: '检测到启动器转交的应用进程，无法按启动器名称安全关闭' };
  }
  return { running: available ? false : null, canClose: false, closeReason: available ? '应用未运行' : '运行状态未知' };
}

/**
 * 给列表里的每一项补上 running 字段。
 *
 * 判断依据是快捷方式指向的 exe 文件名是否出现在进程表里。
 *   - 能判断 → true / false
 *   - 判断不了（exeName 缺失，或进程表从没读到过）→ null
 * 前端将 true / false / null 显示为运行中 / 未运行 / 状态未知，不猜。
 *
 * Steam 游戏按安装目录中的实际 ExecutablePath 关联，失败或路径不可读时未知。
 */
async function withRunning(items) {
  const arr = Array.isArray(items) ? items : [];
  const associations = require('./process-associations');
  let records, associationError = false;
  try { records = associations.current(); } catch (_) { records = {}; associationError = true; }
  const hasAssociations = arr.some((a) => Object.hasOwn(records, a.id));
  const [procs, games] = await Promise.all([
    arr.some((a) => a.type !== 'game') ? procsApi.runningSet() : Promise.resolve(null),
    (hasAssociations || arr.some((a) => a.type === 'game')) ? gameProcs.snapshot() : Promise.resolve(null)
  ]);
  const available = procs && procsApi.isAvailable();
  const missing = arr.filter((a) => a.type !== 'game' && a.exeName && (!available || !procs.set.has(String(a.exeName).toLowerCase())));
  // CIM emits explicit UTF-8 and supplies paths. It also recovers non-ASCII names
  // that tasklist's locale-dependent output cannot represent as UTF-8.
  const snapshot = missing.length ? (games || await gameProcs.snapshot()) : null;
  const metadata = snapshot && snapshot.available ? await fallbackMetadata(missing, snapshot) : [];
  const overrides = gameProcs.readOverrides();
  return arr.map((a) => {
    let state = a.type === 'game' ? gameProcs.status(a, games, overrides) : softwareState(a, procs, available, snapshot, metadata);
    const record = Object.hasOwn(records, a.id) ? records[a.id] : null;
    const associatedSnapshot = games || snapshot;
    if (state.running !== true) {
      const manual = associations.associationState(record, associatedSnapshot);
      if (manual) state = manual;
      else if (associationError) state = { running: null, canClose: false, closeReason: '进程关联配置无法读取，状态未知' };
      else if (record && (!associatedSnapshot || !associatedSnapshot.available)) state = { running: null, canClose: false, closeReason: '关联进程查询失败，状态未知' };
      else if (record && state.running === null) state = { running: false, canClose: false, closeReason: '关联进程未运行' };
    }
    return {
      id: a.id,
      name: a.name,
      type: a.type,
      hasIcon: Boolean(a.iconKey),
      processAssociation: associations.summary(record),
      ...(associationError ? { processAssociationError: '关联配置无法读取，请检查服务端配置文件' } : {}),
      ...state
    };
  });
}

/**
 * 关闭某个已扫描到的应用。按快捷方式指向的映像名匹配，该应用的全部进程
 * （例如浏览器的多个子进程）会一起关闭；不会波及别的应用。
 * 需求二.1：先正常关闭，没响应再强制结束（procs.killByName 内部两级），
 * 保证点「关闭」真的结束进程；关不掉才如实返回原因。
 */
async function closeApp(id) {
  const item = getById(id);
  if (!item) return { ok: false, error: 'ID_NOT_ALLOWED', message: '这个项目不在可启动列表里' };
  if (item.type === 'game') {
    const result = await gameProcs.close(item);
    if (result.ok) procsApi.invalidate();
    return { ...result, id: item.id, name: item.name };
  }
  if (!item.exeName) {
    return {
      ok: false,
      error: 'NO_PROCESS',
      message: '读不到这个项目对应的进程名，无法关闭'
    };
  }
  procsApi.invalidate();
  const [state] = await withRunning([item]);
  if (state.running === false) return { ok: true, id, name: item.name, message: '进程已经不在运行' };
  if (!state.canClose) return { ok: false, error: 'UNSAFE_PROCESS_IDENTITY', message: state.closeReason };
  const r = await procsApi.killByName(item.exeName);
  if (r.ok) {
    logger.info('关闭应用：' + item.name + '（' + item.exeName + '）' + (r.forced ? '［强制结束］' : ''));
    return { ok: true, id, name: item.name, forced: !!r.forced, message: r.message };
  }
  logger.warn('关闭应用失败：' + item.name + ' → ' + r.message);
  return { ok: false, error: 'CLOSE_FAILED', message: r.message };
}

/* ------------------------------------------------------------------ 图标 --- */

function iconPathFor(key) {
  return path.join(CACHE_DIR, key + '.png');
}

/**
 * 把 Windows 路径安全地塞进 PowerShell 双引号字符串。
 * PowerShell 里反斜杠不是转义字符，只有反引号和双引号需要处理；
 * 早先这里把 \ 替换成 \\ 是错的，会让 ExtractAssociatedIcon 收到不存在的路径，
 * 结果静默返回一张通用白图标（所有应用图标一模一样）。
 */
function psQuote(p) {
  return '"' + String(p).replace(/`/g, '``').replace(/"/g, '`"').replace(/\$/g, '`$') + '"';
}

/**
 * 提取图标（带磁盘缓存）。返回 PNG 的绝对路径，失败返回 null。
 */
async function ensureIcon(item) {
  if (!item || !item.iconKey) return null;
  ensureCacheDir();
  const png = iconPathFor(item.iconKey);
  if (fs.existsSync(png) && fs.statSync(png).size > 0) return png;

  const source = item.launch && item.launch.kind === 'lnk' ? item.launch.path : null;
  if (!source) return null;

  const ps =
    '$ErrorActionPreference="Stop";' +
    'Add-Type -AssemblyName System.Drawing;' +
    '$src=' +
    psQuote(source) +
    ';' +
    '$dst=' +
    psQuote(png) +
    ';' +
    'if(-not (Test-Path -LiteralPath $src)){Write-Output "NOSRC";exit 1};' +
    '$ico=[System.Drawing.Icon]::ExtractAssociatedIcon($src);' +
    'if(-not $ico){Write-Output "NOICON";exit 1};' +
    '$bmp=$ico.ToBitmap();' +
    '$bmp.Save($dst,[System.Drawing.Imaging.ImageFormat]::Png);' +
    '$bmp.Dispose();$ico.Dispose();' +
    'Write-Output "OK"';

  try {
    await new Promise((resolve, reject) => {
      execFile(
        'powershell.exe',
        ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', ps],
        { timeout: 15000, windowsHide: true },
        (err) => (err ? reject(err) : resolve())
      );
    });
  } catch (err) {
    return null;
  }
  if (fs.existsSync(png) && fs.statSync(png).size > 0) return png;
  return null;
}

module.exports = { scanApps, getById, list, withRunning, closeApp, ensureIcon, CACHE_DIR };
