'use strict';
// All process transports, Steam files and OS process objects are mocked.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { execFileSync } = require('node:child_process');
const game = require('../server/game-procs');
const item = { id: 'steam:42', type: 'game', installDir: 'D:\\SteamLibrary\\steamapps\\common\\Game' };
const proc = (pid, exe = 'game.exe', created = '2026-01-01T00:00:00.0000000Z') => ({ pid, path: item.installDir + '\\' + exe, created });
let checks = 0;
function test(name, fn) { return Promise.resolve().then(fn).then(() => { checks++; console.log('PASS ' + name); }); }
function loadApps(fakeFs, procApi = {}, gameApi = game) {
  const mod = { exports: {} };
  const deps = { fs: fakeFs, './logger': { info() {}, warn() {} }, './procs': procApi,
    './game-procs': gameApi, './config': { ROOT_DIR: 'D:\\panel' },
    './process-associations': { current: () => ({}), summary: () => null, associationState: () => null } };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../server/apps.js'), 'utf8'), {
    module: mod, exports: mod.exports, process: { env: {} }, Buffer,
    require(id) { return Object.hasOwn(deps, id) ? deps[id] : require(id); }
  });
  return mod.exports;
}
async function main() {
  await test('directory boundaries, case, separators, traversal and Steam exclusion', () => {
    assert(game.matches(item, { path: 'd:/STEAMLIBRARY/steamapps/common/GAME/bin/RUN.EXE' }));
    assert(!game.matches(item, { path: item.installDir + ' Other\\game.exe' }));
    assert(!game.matches(item, { path: item.installDir + '\\..\\other\\game.exe' }));
    assert(!game.matches(item, proc(10, 'steam.exe')));
    assert(!game.matches(item, proc(10, 'steamwebhelper.exe')));
    assert(!game.matches(item, { path: null }));
    assert(!game.matches({ installDir: 'D:\\' }, { path: 'D:\\other.exe' }));
    assert(game.matches(item, { path: 'C:\\Special\\real.exe' }, { 'steam:42': ['C:\\Special\\real.exe'] }));
    assert(!game.matches(item, { path: 'C:\\Special\\steam.exe' }, { 'steam:42': ['C:\\Special\\steam.exe'] }));
    assert(!game.matches(item, { path: 'C:\\Special\\real.exe' }, { 'steam:43': ['C:\\Special\\real.exe'] }));
  });
  await test('unknown failure, unreadable paths, missing identity, true and false', () => {
    assert.equal(game.status(item, { available: false }).running, null);
    const inventory = () => ({ complete: true, names: ['game.exe'] });
    assert.equal(game.status(item, { available: true, processes: [{ pid: 99, name: 'GAME.exe', path: null }] }, {}, inventory).running, null);
    assert.equal(game.status(item, { available: true, processes: [{ pid: 99, name: 'ProtectedSystem.exe', path: null }] }, {}, inventory).running, false);
    assert.equal(game.status(item, { available: true, processes: [] }, {}, inventory).running, false);
    assert.equal(game.status(item, { available: true, processes: [] }, {}, () => ({ complete: false, names: [] })).running, null);
    assert.equal(game.status(item, { available: true, processes: [proc(8)] }).canClose, true);
    assert.equal(game.status(item, { available: true, processes: [proc(8, 'game.exe', null)] }).canClose, false);
  });
  await test('batch cache, concurrent coalescing, invalidation and no stale success on failure', async () => {
    let calls = 0, fail = false;
    let now = 1;
    const tracker = game.createTracker(async () => { calls++; if (fail) throw Error('CIM unavailable'); return [proc(7)]; }, () => now);
    const [a, b] = await Promise.all([tracker.snapshot(), tracker.snapshot()]);
    assert.equal(a, b); assert.equal(calls, 1);
    await tracker.snapshot(); assert.equal(calls, 1);
    tracker.invalidate(); await tracker.snapshot(); assert.equal(calls, 2);
    now += 6000; fail = true;
    assert.equal((await tracker.snapshot()).available, false);
    assert.equal(calls, 3);
  });
  await test('invalidated in-flight query cannot repopulate cache', async () => {
    const pending = [];
    const tracker = game.createTracker(() => new Promise((resolve) => pending.push(resolve)));
    const first = tracker.snapshot(); tracker.invalidate(); const second = tracker.snapshot();
    pending[1]([proc(2)]); await second;
    pending[0]([proc(1)]); await first;
    assert.equal((await tracker.snapshot()).processes[0].pid, 2);
  });
  await test('fresh close includes every associated PID and never unrelated or Steam', async () => {
    let count = 0;
    const tracker = game.createTracker(async (script) => {
      count++;
      if (script.includes('$rows=')) return [proc(10), proc(11, 'bin\\worker.exe'), proc(12, 'steam.exe'), { ...proc(13), path: 'C:\\Other\\game.exe' }];
      assert(script.includes('pid=10;')); assert(script.includes('pid=11;'));
      assert(!script.includes('pid=12;')); assert(!script.includes('pid=13;'));
      assert(!/taskkill|Stop-Process|Get-Process/.test(script));
      return { ok: true, forced: true };
    });
    await tracker.snapshot(); assert.equal(count, 1);
    assert.equal((await tracker.close(item)).ok, true); assert.equal(count, 3);
    await tracker.snapshot(); assert.equal(count, 4);
    const unknown = game.createTracker(async () => { throw Error('denied'); });
    assert.equal((await unknown.close(item)).ok, false);
  });
  await test('Steam scan retains installed+update flags (Apex 1030), appid / installdir and rejects escape', async () => {
    const root = 'C:\\Program Files (x86)\\Steam';
    const appsDir = path.join(root, 'steamapps');
    const manifests = { '42': ['Display name is not exe', 'Actual Folder'], '43': ['Escape', '..\\Other'], '44': ['Missing', null],
      '1172470': ['Apex Legends', 'Apex Legends', '1030'], '45': ['Uninstalled', 'Removed', '2'],
      '46': ['Invalid flags', 'Invalid', 'not-a-number'], '47': ['Zero flags', 'Empty', '0'] };
    const fakeFs = {
      statSync(p) { if (p === root) return { isDirectory: () => true }; throw Error('absent'); },
      readdirSync(p) { if (p === appsDir) return Object.keys(manifests).map((id) => 'appmanifest_' + id + '.acf'); throw Error('absent'); },
      readFileSync(p) {
        const m = /appmanifest_(\d+)\.acf$/.exec(p);
        if (!m) throw Error('absent');
        const [name, dir, flags = '4'] = manifests[m[1]];
        return '"name" "' + name + '" "StateFlags" "' + flags + '"' + (dir ? ' "installdir" "' + dir + '"' : '');
      }
    };
    const api = loadApps(fakeFs);
    const rows = await api.scanApps(true);
    assert.equal(rows.length, 4);
    assert.equal(api.getById('steam:1172470').installDir, path.join(appsDir, 'common', 'Apex Legends'));
    for (const id of ['45', '46', '47']) assert.equal(api.getById('steam:' + id), null);
    const a = api.getById('steam:42');
    assert.equal(a.appid, '42'); assert.equal(a.launch.appid, '42');
    assert.equal(a.installDir, path.join(appsDir, 'common', 'Actual Folder'));
    assert.equal(api.getById('steam:43').installDir, null);
    assert.equal(api.getById('steam:44').installDir, null);
    const decorated = await loadApps(fakeFs, {}, { ...game, snapshot: async () => ({ available: true, processes: [{ pid: 9, path: a.installDir + '\\real.exe', created: 'time' }] }) }).withRunning([a]);
    assert.equal(decorated[0].running, true); assert.equal(decorated[0].canClose, true);
  });
  await test('bounded directory inventory caches reads and refuses symlink uncertainty', () => {
    let reads = 0;
    const mod = { exports: {} };
    const entry = (name, kind) => ({ name, isSymbolicLink: () => kind === 'link', isDirectory: () => kind === 'dir', isFile: () => kind === 'file' });
    const fakeFs = { readdirSync(dir) {
      reads++;
      if (dir.endsWith('bin')) return [entry('Worker.EXE', 'file')];
      return [entry('Game.exe', 'file'), entry('steam.exe', 'file'), entry('bin', 'dir'), entry('external', 'link')];
    } };
    vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../server/game-procs.js'), 'utf8'), {
      module: mod, __dirname: path.join(__dirname, '../server'), Date,
      require(id) { return id === 'fs' ? fakeFs : require(id); }
    });
    const result = mod.exports.executableInventory(item.installDir);
    assert.equal(result.complete, false);
    assert.deepEqual(Array.from(result.names).sort(), ['game.exe', 'worker.exe']);
    mod.exports.executableInventory(item.installDir); assert.equal(reads, 2);
  });
  await test('launcher invalidates only after successful shell spawn without launching anything', async () => {
    let invalidated = 0;
    const mod = { exports: {} };
    const deps = {
      child_process: { spawn() { return { once(event, cb) { if (event === 'spawn') cb(); }, unref() {} }; } },
      './logger': { info() {}, warn() {}, error() {} },
      './apps': { getById(id) { return id === item.id ? { ...item, launch: { kind: 'steam', appid: '42' } } : null; }, async scanApps() {} },
      './procs': { invalidate() { invalidated++; } }
    };
    vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../server/launcher.js'), 'utf8'), {
      module: mod, require(id) { return deps[id]; }
    });
    assert.equal((await mod.exports.launch('steam:42')).ok, true); assert.equal(invalidated, 1);
    assert.equal((await mod.exports.launch('steam:999')).ok, false); assert.equal(invalidated, 1);
  });
  if (process.platform === 'win32') {
    await test('PowerShell mock validates actual close script: identity, path, PID reuse, graceful and force', () => {
      const target = proc(91);
      const cases = [
        { name: 'force', path: target.path, created: target.created, graceful: false, ok: true, kills: 1, closes: 1 },
        { name: 'graceful', path: target.path, created: target.created, graceful: true, ok: true, kills: 0, closes: 1 },
        { name: 'reused pid', path: target.path, created: '2026-02-01T00:00:00.0000000Z', graceful: false, ok: false, kills: 0, closes: 0 },
        { name: 'different path', path: 'C:\\Other\\different.exe', created: target.created, graceful: false, ok: false, kills: 0, closes: 0 },
        { name: 'identity changed before force', path: target.path, created: target.created, change: true, graceful: false, ok: false, kills: 0, closes: 1 }
      ];
      for (const c of cases) {
        const q = (s) => "'" + s.replace(/'/g, "''") + "'";
        const prelude = '$script:kills=0;$script:closes=0;$script:queries=0;' +
          '$script:p=[pscustomobject]@{Id=91;Handle=1;HasExited=$false;Path=' + q(c.path) + '};' +
          '$script:p | Add-Member ScriptMethod CloseMainWindow {$script:closes++;' + (c.graceful ? '$this.HasExited=$true;' : '') + 'return $true};' +
          '$script:p | Add-Member ScriptMethod Kill {$script:kills++;$this.HasExited=$true};' +
          '$script:p | Add-Member ScriptMethod Dispose {};' +
          'function Get-MockProcess($id){return $script:p};function Start-Sleep {};' +
          'function Get-CimInstance {param($ClassName,$Filter,$ErrorAction);$script:queries++;' +
          '$date=' + q(c.created) + ';' + (c.change ? 'if($script:queries -gt 1){$date="2026-02-01T00:00:00.0000000Z"};' : '') +
          '[pscustomobject]@{ExecutablePath=' + q(c.path) + ';CreationDate=[datetime]::Parse($date).ToUniversalTime()}};';
        const script = game.closeScript([target]).replace('[System.Diagnostics.Process]::GetProcessById($t.pid)', '(Get-MockProcess $t.pid)');
        assert(!script.includes('::GetProcessById'));
        const wrapped = prelude + '$result= & {' + script + '};@{result=($result | ConvertFrom-Json);kills=$script:kills;closes=$script:closes} | ConvertTo-Json -Compress';
        const result = JSON.parse(execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', wrapped], { encoding: 'utf8', windowsHide: true }));
        assert.equal(result.result.ok, c.ok, c.name);
        assert.equal(result.kills, c.kills, c.name); assert.equal(result.closes, c.closes, c.name);
      }
    });
  }
  console.log(checks + ' test groups passed (no real games or processes touched)');
}
main().catch((err) => { console.error(err); process.exitCode = 1; });
