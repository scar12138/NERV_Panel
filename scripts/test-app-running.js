'use strict';
// No real process mutations: VM dependencies intercept every process operation.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const game = require('../server/game-procs');
const item = { id: 'app:wps', type: 'software', name: 'WPS Office', exeName: 'ksolaunch.exe', targetPath: 'D:\\WPS Office\\ksolaunch.exe' };
const actual = { pid: 42, name: 'wps.exe', path: 'D:\\WPS Office\\12.1\\office6\\wps.exe' };
const metadata = [item.targetPath, actual.path].map((p) => ({ path: p, product: 'WPS Office', description: 'WPS Office' }));
function load({ names = [], available = true, processes = [actual], snapshotAvailable = true, rows = metadata } = {}) {
  let kills = 0, snapshots = 0, metadataCalls = 0;
  const proc = { runningSet: async () => ({ set: new Set(names) }), isAvailable: () => available, invalidate() {}, killByName: async () => { kills++; return { ok: true }; } };
  const deps = { './logger': { warn() {}, info() {} }, './config': { ROOT_DIR: 'D:\\panel' }, './procs': proc,
    './process-associations': { current: () => ({}), summary: () => null, associationState: () => null },
    './game-procs': { ...game, snapshot: async () => { snapshots++; return { available: snapshotAvailable, processes }; } } };
  const mod = { exports: {} };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../server/apps.js'), 'utf8') + '\nmodule.exports._state = softwareState; module.exports._candidate = fallbackCandidate; module.exports._seed = (x) => {cache.list=x}; module.exports._metadata = (fn) => { runPs=fn; };', {
    module: mod, Buffer, process: { env: {} }, require(id) { return deps[id] || require(id); }
  });
  mod.exports._seed([item]);
  mod.exports._metadata(async () => { metadataCalls++; return rows; });
  return { api: mod.exports, counts: () => ({ kills, snapshots, metadataCalls }) };
}
async function main() {
  let count = 0;
  async function test(name, fn) { await fn(); count++; console.log('PASS ' + name); }
  await test('launcher handoff: exact metadata + subtree, cached read, close denied', async () => {
    const { api, counts } = load();
    const [s] = await api.withRunning([item]); assert.equal(s.running, true); assert.equal(s.canClose, false);
    assert.equal((await api.closeApp(item.id)).error, 'UNSAFE_PROCESS_IDENTITY');
    assert.equal(counts().kills, 0); assert.equal(counts().metadataCalls, 1);
  });
  await test('same directory alone, product alone, description alone are insufficient', async () => {
    for (const rows of [[], [{ ...metadata[0] }, { ...metadata[1], product: 'Other' }], [{ ...metadata[0] }, { ...metadata[1], description: 'Helper' }], metadata.map((m) => ({ ...m, product: '' }))]) {
      assert.equal((await load({ rows }).api.withRunning([item]))[0].running, false);
    }
  });
  await test('directory sibling, traversal, drive root and shared folders rejected', () => {
    const { api } = load();
    assert(api._candidate(item, actual));
    for (const p of ['D:\\WPS Office Other\\wps.exe', 'D:\\WPS Office\\..\\Other\\wps.exe', 'D:\\WPS Office\\document.txt']) assert(!api._candidate(item, { path: p }));
    for (const p of ['D:\\launch.exe', 'C:\\Program Files\\launch.exe', 'C:\\Windows\\launch.exe', 'C:\\Users\\user\\AppData\\Local\\launch.exe']) assert(!api._candidate({ targetPath: p }, { path: path.win32.dirname(p) + '\\version\\real.exe' }));
  });
  await test('CIM Unicode exact name recovers tasklist miss and preserves close identity', async () => {
    const app = { ...item, exeName: '测试.exe', targetPath: 'D:\\App\\测试.exe' };
    const { api } = load({ processes: [{ name: '测试.exe', path: null }] });
    const [s] = await api.withRunning([app]); assert.equal(s.running, true); assert.equal(s.canClose, true);
  });
  await test('known exact image stays closeable without fallback inventory', async () => {
    const { api, counts } = load({ names: ['ksolaunch.exe'] });
    assert.equal((await api.withRunning([item]))[0].canClose, true); assert.equal(counts().snapshots, 0);
    assert.equal((await api.closeApp(item.id)).ok, true); assert.equal(counts().kills, 1);
  });
  await test('already-exited close remains idempotent without a process command', async () => {
    const { api, counts } = load({ processes: [] });
    assert.equal((await api.closeApp(item.id)).ok, true); assert.equal(counts().kills, 0);
  });
  await test('query failure and missing identity remain unknown, never guessed', async () => {
    const { api } = load({ available: false, snapshotAvailable: false });
    assert.equal((await api.withRunning([item]))[0].running, null);
    assert.equal((await api.withRunning([{ ...item, exeName: null }]))[0].running, null);
    assert.equal((await api.closeApp(item.id)).ok, false);
    assert.equal((await load({ processes: [{ ...actual, path: null }] }).api.withRunning([item]))[0].running, false);
  });
  await test('tasklist cache keeps last successful result on query failure', async () => {
    let now = 1, calls = 0;
    const mod = { exports: {} };
    class Clock extends Date { static now() { return now; } }
    vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../server/procs.js'), 'utf8'), { module: mod, Date: Clock, require(id) {
      if (id === './logger') return { warn() {} };
      if (id === 'child_process') return { execFile(bin, args, opts, done) { calls++; if (calls === 1) done(null, '\"APP.EXE\",\"1\",\"Console\",\"1\",\"1,000 K\"'); else done(Error('query failed')); } };
      return require(id);
    } });
    const a = await mod.exports.runningSet(); assert(a.set.has('app.exe')); assert.equal(mod.exports.isAvailable(), true);
    await Promise.resolve(); now += 6000;
    const b = await mod.exports.runningSet(); assert(b.set.has('app.exe')); assert.equal(calls, 2);
  });
  await test('PowerShell liveness checks explicitly emit UTF-8', () => {
    const source = fs.readFileSync(path.join(__dirname, '../server/procs.js'), 'utf8');
    let captured;
    const mod = { exports: {} };
    vm.runInNewContext(source + '\nmodule.exports._exec = execFileAsync;', { module: mod, require(id) {
      if (id === './logger') return { warn() {} };
      if (id === 'child_process') return { execFile(bin, args, opts, done) { captured = args; done(null, '测试.exe'); } };
      return require(id);
    } });
    return mod.exports._exec('powershell.exe', ['-Command', 'Write-Output "测试.exe"'], 10).then((out) => {
      assert.equal(out, '测试.exe'); assert(captured[1].startsWith('[Console]::OutputEncoding='));
    });
  });
  console.log(count + ' app running checks passed');
}
main().catch((err) => { console.error(err); process.exitCode = 1; });
