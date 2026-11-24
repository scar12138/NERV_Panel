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
const { ROOT_DIR } = require('./config');

const CACHE_DIR = path.join(ROOT_DIR, 'cache', 'icons');
const SCAN_TTL_MS = 60 * 1000; // 扫描结果缓存，避免每次进页面都全盘遍历

/* 开始菜单里这些条目不是"可启动应用"，直接过滤 */
const JUNK = /(uninstall|卸载|remove |readme|read me|帮助|help|网站|website|文档|documentation|licen[cs]e|更新|update|cmd|命令提示符|release notes|changelog)/i;

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
    const outFile = path.join(os.tmpdir(), 'nerv-ps-' + process.pid + '-' + Date.now() + '.json');
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
    const name = String(it.name || '').trim();
    if (!name || name.length > 60) return;
    if (JUNK.test(name)) return;
    if (JUNK.test(path.basename(it.path))) return;
    const key = name.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    apps.push({
      id: 'app:' + crypto.createHash('sha1').update(it.path).digest('hex').slice(0, 12),
      name,
      type: 'software',
      launch: { kind: 'lnk', path: it.path },
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
  candidates.forEach((c) => {
    try {
      if (fs.statSync(c).isDirectory()) roots.add(c);
    } catch (err) {
      /* 不存在 */
    }
  });
  /* 注册表里的 Steam 安装路径优先级最高 */
  const reg = process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)';
  candidates.unshift(path.join(reg, 'Steam'));
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
      /* 只看真正装在本地的游戏 */
      const stateFlags = vdfString(text, 'StateFlags');
      if (stateFlags && Number(stateFlags) !== 4) return;
      seen.add(appid);
      games.push({
        id: 'steam:' + appid,
        name: name.trim(),
        type: 'game',
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
    return list;
  })();

  try {
    return await scanning;
  } finally {
    scanning = null;
  }
}

function getById(id) {
  return cache.list.find((a) => a.id === id) || null;
}

/* ------------------------------------------------------------------ 图标 --- */

function iconPathFor(key) {
  return path.join(CACHE_DIR, key + '.png');
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
    '$ErrorActionPreference="SilentlyContinue";' +
    'Add-Type -AssemblyName System.Drawing;' +
    '$ico=[System.Drawing.Icon]::ExtractAssociatedIcon("' +
    source.replace(/\\/g, '\\\\').replace(/"/g, '`"') +
    '");' +
    'if($ico){$bmp=$ico.ToBitmap();$bmp.Save("' +
    png.replace(/\\/g, '\\\\') +
    '",[System.Drawing.Imaging.ImageFormat]::Png);$bmp.Dispose();$ico.Dispose();Write-Output "OK"}else{Write-Output "NONE"}';

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

module.exports = { scanApps, getById, ensureIcon, CACHE_DIR };
