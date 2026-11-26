'use strict';

// Steam identity comes only from server-owned install metadata / exact exe overrides.
const fs = require('fs');
const path = require('path');
const { execFile } = require('child_process');
const CONFIG_FILE = path.join(__dirname, 'game-processes.json');
const TTL_MS = 5000;
const BLOCKED = /^(steam(?:webhelper|service|errorreporter)?|steamerrorreporter64|gameoverlayui|steam_monitor)\.exe$/i;

function normalized(value) {
  if (typeof value !== 'string' || !/^(?:[a-z]:[\\/]|\\\\[^\\/]+[\\/][^\\/]+)/i.test(value)) return null;
  const result = path.win32.normalize(value).replace(/[\\/]+$/, '').toLowerCase();
  if (/^[a-z]:$/i.test(result)) return null;
  return result;
}
function safeExe(value) {
  const p = normalized(value);
  return p && /\.exe$/i.test(p) && !BLOCKED.test(path.win32.basename(p)) ? p : null;
}
function quote(value) { return "'" + String(value).replace(/'/g, "''") + "'"; }
function readOverrides() {
  try {
    const parsed = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8'));
    return parsed && !Array.isArray(parsed) && typeof parsed === 'object' ? parsed : {};
  } catch (err) {
    if (err.code !== 'ENOENT') return { invalid: true };
    return {};
  }
}
function pathsFor(item, overrides) {
  const dir = normalized(item.installDir);
  const values = overrides[item.id];
  const extra = Array.isArray(values) ? values.map(safeExe).filter(Boolean) : [];
  return { dir, extra };
}
function matches(item, proc, overrides = {}) {
  const exe = safeExe(proc.path);
  if (!exe) return false;
  const { dir, extra } = pathsFor(item, overrides);
  return Boolean((dir && exe.startsWith(dir + '\\')) || extra.includes(exe));
}
const inventoryCache = new Map();
function executableInventory(dir) {
  const key = normalized(dir);
  if (!key) return { complete: false, names: [] };
  const previous = inventoryCache.get(key);
  if (previous && Date.now() - previous.at < 60000) return previous;
  const names = new Set();
  let count = 0;
  let complete = true;
  function visit(folder, depth) {
    if (depth > 8) { complete = false; return; }
    let entries;
    try { entries = fs.readdirSync(folder, { withFileTypes: true }); }
    catch (_) { complete = false; return; }
    for (const entry of entries) {
      if (++count > 10000) { complete = false; return; }
      if (entry.isSymbolicLink()) { complete = false; continue; }
      if (entry.isDirectory()) visit(path.join(folder, entry.name), depth + 1);
      else if (entry.isFile() && /\.exe$/i.test(entry.name) && !BLOCKED.test(entry.name)) names.add(entry.name.toLowerCase());
    }
  }
  visit(dir, 0);
  const result = { at: Date.now(), complete, names: Array.from(names) };
  inventoryCache.set(key, result);
  return result;
}
function status(item, snapshot, overrides = {}, inventory = executableInventory) {
  const { dir, extra } = pathsFor(item, overrides);
  if (!dir && !extra.length) return { running: null, canClose: false, closeReason: '没有可信的游戏安装目录或进程路径' };
  if (!snapshot.available) return { running: null, canClose: false, closeReason: '进程路径查询失败，状态未知' };
  const found = snapshot.processes.filter((p) => matches(item, p, overrides));
  if (found.length) {
    const canClose = found.every((p) => p.pid > 0 && p.created);
    return { running: true, canClose, ...(canClose ? {} : { closeReason: '无法验证进程身份，不能安全关闭' }) };
  }
  const known = dir ? inventory(item.installDir) : { complete: true, names: [] };
  const names = new Set(known.names.concat(extra.map((p) => path.win32.basename(p))));
  if (!known.complete || snapshot.processes.some((p) => !p.path && p.pid > 4 && names.has(String(p.name || '').toLowerCase()))) {
    return { running: null, canClose: false, closeReason: '游戏进程路径或安装目录不可完整读取，状态未知' };
  }
  return { running: false, canClose: false, closeReason: '游戏未运行' };
}
function runPs(script) {
  return new Promise((resolve, reject) => {
    execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script],
      { windowsHide: true, timeout: 20000, maxBuffer: 16 * 1024 * 1024 },
      (err, stdout) => {
        if (err) return reject(err);
        try { resolve(JSON.parse(String(stdout).replace(/^\uFEFF/, '').trim())); } catch (e) { reject(e); }
      });
  });
}
const SNAPSHOT_SCRIPT = '$ErrorActionPreference="Stop";[Console]::OutputEncoding=New-Object System.Text.UTF8Encoding($false);' +
  '$rows=@(Get-CimInstance Win32_Process -ErrorAction Stop | ForEach-Object {' +
  '[pscustomobject]@{pid=[int]$_.ProcessId;name=$_.Name;path=$_.ExecutablePath;created=$(if($_.CreationDate){$_.CreationDate.ToUniversalTime().ToString("o")}else{$null})}});' +
  'ConvertTo-Json -InputObject $rows -Compress';

// Injected transport/clock make the complete close flow testable without touching processes.
function createTracker(run = runPs, now = Date.now) {
  let cache = null;
  let inFlight = null;
  let generation = 0;
  function invalidate() { generation++; cache = null; }
  function snapshot() {
    if (cache && now() - cache.at < TTL_MS) return Promise.resolve(cache);
    if (inFlight && inFlight.generation === generation) return inFlight.promise;
    const epoch = generation;
    const promise = (async () => {
      let result;
      try {
        const rows = await run(SNAPSHOT_SCRIPT);
        if (!Array.isArray(rows) || rows.some((p) => !p || !Number.isInteger(p.pid) || p.pid < 0 || (p.path != null && typeof p.path !== 'string') || (p.created != null && typeof p.created !== 'string'))) throw new Error('Invalid process snapshot');
        result = { at: now(), available: true, processes: rows };
      } catch (_) { result = { at: now(), available: false, processes: [] }; }
      if (epoch === generation) cache = result;
      return result;
    })();
    inFlight = { generation: epoch, promise };
    promise.finally(() => { if (inFlight && inFlight.promise === promise) inFlight = null; });
    return promise;
  }
  async function close(item, overrides = readOverrides()) {
    // Never authorize a close from a stale poll result.
    invalidate();
    const snap = await snapshot();
    const state = status(item, snap, overrides);
    if (state.running === false) return { ok: true, message: '游戏已经不在运行' };
    if (!state.canClose) return { ok: false, message: state.closeReason };
    const targets = snap.processes.filter((p) => matches(item, p, overrides));
    try {
      const result = await run(closeScript(targets));
      if (!result || typeof result.ok !== 'boolean') throw new Error('Invalid close result');
      return result;
    } catch (_) { return { ok: false, message: '关闭或身份复核失败，未确认游戏已退出' }; }
    finally { invalidate(); }
  }
  return { snapshot, invalidate, close };
}
function closeScript(targets) {
  const literals = targets.map((p) => '@{pid=' + p.pid + ';path=' + quote(p.path) + ';created=' + quote(p.created) + '}').join(',');
  // Hold a Process handle before re-querying CIM. All actions use that object rather
  // than resolving the PID again, so a recycled PID cannot redirect a kill.
  return '$ErrorActionPreference="Stop";[Console]::OutputEncoding=New-Object System.Text.UTF8Encoding($false);' +
    '$targets=@(' + literals + ');$held=@();$opened=@();$ok=$true;$forced=$false;' +
    'try{foreach($t in $targets){' +
    '$p=$null;try{$p=[System.Diagnostics.Process]::GetProcessById($t.pid);$null=$p.Handle}catch{' +
    '$check=@(Get-CimInstance Win32_Process -Filter ("ProcessId="+$t.pid) -ErrorAction Stop);if($check.Count -gt 0){$ok=$false};continue};' +
    '$opened+=,$p;if($p.HasExited){continue};' +
    '$c=Get-CimInstance Win32_Process -Filter ("ProcessId="+$t.pid) -ErrorAction Stop;' +
    'if(-not $c){continue};' +
    'if(-not $c.ExecutablePath -or -not $c.CreationDate -or $c.ExecutablePath -ine $t.path -or ' +
    '$c.CreationDate.ToUniversalTime().ToString("o") -cne $t.created -or $p.Path -ine $t.path){$ok=$false;continue};' +
    'if($p.HasExited){continue};$held+=,$p;$null=$p.CloseMainWindow()};' +
    // Wait collectively rather than once per process; no descendant / name kills.
    'Start-Sleep -Milliseconds 1200;' +
    'foreach($p in $held){if($p.HasExited){continue};' +
    '$t=$targets | Where-Object {$_.pid -eq $p.Id} | Select-Object -First 1;' +
    '$c=Get-CimInstance Win32_Process -Filter ("ProcessId="+$p.Id) -ErrorAction Stop;' +
    'if(-not $c -or -not $c.ExecutablePath -or -not $c.CreationDate -or $c.ExecutablePath -ine $t.path -or ' +
    '$c.CreationDate.ToUniversalTime().ToString("o") -cne $t.created -or $p.Path -ine $t.path){$ok=$false;continue};' +
    '$p.Kill();$forced=$true};Start-Sleep -Milliseconds 500;' +
    'foreach($p in $held){if(-not $p.HasExited){$ok=$false}}' +
    '}catch{$ok=$false}finally{foreach($p in $opened){$p.Dispose()}};' +
    '@{ok=$ok;forced=$forced;message=$(if($ok){"游戏进程已退出"}else{"部分进程未退出或身份已变化，已停止不安全操作"})} | ConvertTo-Json -Compress';
}
const tracker = createTracker();
module.exports = { ...tracker, matches, status, readOverrides, createTracker, closeScript, normalized, executableInventory };
