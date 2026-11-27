'use strict';
// Temporary files and injected snapshots only. Never launches/stops a real process.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const associations = require('../server/process-associations');
const game = require('../server/game-procs');
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'nerv-associations-test-'));
const app = { id: 'app:test', type: 'software', name: 'Test', exeName: 'launcher.exe', targetPath: 'D:\\Test\\launcher.exe' };
const gameItem = { id: 'steam:42', type: 'game', name: 'Game', installDir: 'D:\\Game' };
const actual = { pid: 42, name: 'actual.exe', path: 'D:\\Test\\actual.exe', created: '2026-01-01' };
let checks = 0;
async function test(name, fn) { await fn(); checks++; console.log('PASS ' + name); }
function fixture(options = {}) {
  let rows = [{ ...actual }], available = true, now = 1000, reads = 0;
  const folder = fs.mkdtempSync(path.join(root, 'case-'));
  const tracker = { invalidate() {}, async snapshot() { reads++; return { available, processes: rows }; } };
  const api = associations.createAssociations({ root: folder, tracker, scan: async () => [app, gameItem], now: () => now, ...options });
  return { api, tracker, folder, rows: (r) => { rows = r; }, fail: () => { available = false; }, tick: () => { now += 61000; }, reads: () => reads };
}
async function bind(f, id = app.id) {
  const listed = await f.api.list();
  return f.api.update({ action: 'bind', id, snapshotId: listed.snapshotId, selectionId: listed.processes[0].selectionId });
}
function loadApps(f, recordApi = f.api, direct = false) {
  let kills = 0;
  const mod = { exports: {} };
  const deps = {
    './config': { ROOT_DIR: root }, './logger': { warn() {}, info() {} },
    './process-associations': { ...recordApi, associationState: associations.associationState, summary: associations.summary },
    './procs': { async runningSet() { return { set: new Set(direct ? ['launcher.exe'] : []) }; }, isAvailable: () => true, invalidate() {}, async killByName() { kills++; return { ok: true }; } },
    './game-procs': { ...game, snapshot: f.tracker.snapshot, executableInventory: () => ({ complete: true, names: [] }), status: (item, snap) => game.status(item, snap, {}, () => ({ complete: true, names: [] })) }
  };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../server/apps.js'), 'utf8') + '\nmodule.exports._seed = (items) => { cache.list=items; }; module.exports._metadata = () => {runPs=async()=>[];};', {
    module: mod, Buffer, process: { env: {} }, require(id) { return deps[id] || require(id); }
  });
  mod.exports._seed([app, gameItem]); mod.exports._metadata();
  return { api: mod.exports, kills: () => kills };
}
async function main() {
  await test('actual snapshot selection persisted with server-derived identity and survives reload', async () => {
    const f = fixture(); assert.equal((await bind(f)).ok, true); assert.equal(f.reads(), 2);
    const record = f.api.current()[app.id]; assert.equal(record.name, 'actual.exe'); assert.equal(record.path, actual.path.toLowerCase());
    const again = associations.createAssociations({ root: f.folder }); assert.deepEqual(again.current()[app.id], record);
    assert.equal((await f.api.update({ action: 'bind', id: app.id, path: 'C:\\arbitrary.exe' })).error, 'ASSOCIATION_INVALID');
    assert.equal((await f.api.update({ action: 'unbind', id: 'unknown' })).error, 'ID_NOT_ALLOWED');
  });
  await test('PID reuse, changed name/path, exited selection and expiration rejected', async () => {
    for (const changed of [[], [{ ...actual, created: 'new' }], [{ ...actual, name: 'other.exe' }], [{ ...actual, path: 'C:\\Other.exe' }]]) {
      const f = fixture(); const listed = await f.api.list(); f.rows(changed);
      assert.equal((await f.api.update({ action: 'bind', id: app.id, snapshotId: listed.snapshotId, selectionId: listed.processes[0].selectionId })).error, 'PROCESS_SELECTION_STALE');
      assert(!fs.existsSync(path.join(f.folder, 'process-associations.json')));
    }
    const f = fixture(); const listed = await f.api.list(); f.tick();
    assert.equal((await f.api.update({ action: 'bind', id: app.id, snapshotId: listed.snapshotId, selectionId: listed.processes[0].selectionId })).error, 'PROCESS_SELECTION_STALE');
  });
  await test('bounded snapshot memory and fresh query failures are explicit', async () => {
    const f = fixture(); const old = await f.api.list();
    for (let i = 0; i < 20; i++) await f.api.list();
    assert.equal((await f.api.update({ action: 'bind', id: app.id, snapshotId: old.snapshotId, selectionId: old.processes[0].selectionId })).error, 'PROCESS_SELECTION_STALE');
    const listed = await f.api.list(); f.fail();
    assert.equal((await f.api.list()).error, 'PROCESS_QUERY_FAILED');
    assert.equal((await f.api.update({ action: 'bind', id: app.id, snapshotId: listed.snapshotId, selectionId: listed.processes[0].selectionId })).error, 'PROCESS_QUERY_FAILED');
  });
  await test('serialized concurrent binds/unbind preserve other IDs', async () => {
    const f = fixture(); const listed = await f.api.list();
    const selection = { snapshotId: listed.snapshotId, selectionId: listed.processes[0].selectionId };
    const results = await Promise.all([f.api.update({ action: 'bind', id: app.id, ...selection }), f.api.update({ action: 'bind', id: gameItem.id, ...selection }), f.api.update({ action: 'unbind', id: app.id })]);
    assert(results.every((r) => r.ok)); assert(!f.api.current()[app.id]); assert(f.api.current()[gameItem.id]);
    assert.deepEqual(fs.readdirSync(f.folder), ['process-associations.json']);
  });
  await test('write failure retains old file and queue recovers without temporary residue', async () => {
    let fail = false;
    const io = { ...fs, promises: { ...fs.promises, rename: async (...args) => { if (fail) throw Error('simulated rename failure'); return fs.promises.rename(...args); } } };
    const f = fixture({ io }); await bind(f); const before = fs.readFileSync(path.join(f.folder, 'process-associations.json'), 'utf8'); fail = true;
    await assert.rejects(f.api.update({ action: 'unbind', id: app.id }), /simulated rename failure/);
    assert.equal(fs.readFileSync(path.join(f.folder, 'process-associations.json'), 'utf8'), before);
    fail = false; assert.equal((await f.api.update({ action: 'unbind', id: app.id })).ok, true);
    assert.deepEqual(fs.readdirSync(f.folder), ['process-associations.json']);
  });
  await test('manual path + protected name fallback are read-only for software and games', async () => {
    for (const pathValue of [actual.path, null]) {
      const f = fixture(); f.rows([{ ...actual, path: pathValue }]); await bind(f); await bind(f, gameItem.id);
      const loaded = loadApps(f); const states = await loaded.api.withRunning([app, gameItem]);
      for (const state of states) { assert.equal(state.running, true); assert.equal(state.canClose, false); assert.equal(state.processAssociation.mode, pathValue ? 'path' : 'name'); }
      assert.equal((await loaded.api.closeApp(app.id)).ok, false); assert.equal(loaded.kills(), 0);
      f.rows([]); for (const state of await loaded.api.withRunning([app, gameItem])) assert.equal(state.running, false);
      f.fail(); for (const state of await loaded.api.withRunning([app, gameItem])) assert.equal(state.running, null);
    }
  });
  await test('saved path can display protected exact-name but readable different path does not match', async () => {
    const f = fixture(); await bind(f);
    f.rows([{ ...actual, path: null }]); assert.equal((await loadApps(f).api.withRunning([app]))[0].running, true);
    f.rows([{ ...actual, path: 'C:\\Other\\actual.exe' }]); assert.equal((await loadApps(f).api.withRunning([app]))[0].running, false);
  });
  await test('independent original close identity retained, corrupt config yields unknown and no overwrite', async () => {
    const f = fixture(); await bind(f);
    assert.equal((await loadApps(f, f.api, true).api.withRunning([app]))[0].canClose, true);
    fs.writeFileSync(path.join(f.folder, 'process-associations.json'), '{broken');
    const loaded = loadApps(f); const [state] = await loaded.api.withRunning([app]);
    assert.equal(state.running, null); assert(state.processAssociationError); assert.equal((await loaded.api.closeApp(app.id)).ok, false); assert.equal(loaded.kills(), 0);
    await assert.rejects(f.api.update({ action: 'unbind', id: app.id }));
    assert.equal(fs.readFileSync(path.join(f.folder, 'process-associations.json'), 'utf8'), '{broken');
  });
  await test('real HTTP route handlers enforce token, no-store, status codes and allowed IDs', async () => {
    const source = fs.readFileSync(path.join(__dirname, '../server/index.js'), 'utf8');
    const auth = { exports: {} };
    vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../server/auth.js'), 'utf8'), { module: auth, Buffer,
      require(id) { return id === './config' ? { getConfig: () => ({ token: 'fixture-token' }) } : require(id); } });
    const express = require('express'); const web = express(); web.use(express.json());
    const f = fixture();
    const routes = source.slice(source.indexOf("const processAssociations = require('./process-associations');"), source.indexOf('// ---- 关闭应用'));
    vm.runInNewContext(routes, { app: web, Promise, requireToken: auth.exports.requireToken, logger: { warn() {} }, require() { return f.api; } });
    const server = await new Promise((resolve) => { const s = web.listen(0, '127.0.0.1', () => resolve(s)); });
    const url = 'http://127.0.0.1:' + server.address().port;
    const request = (route, body, token = 'fixture-token') => fetch(url + route, { method: body ? 'POST' : 'GET', headers: { 'Content-Type': 'application/json', ...(token ? { 'X-NERV-Token': token } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) });
    try {
      for (const token of ['', 'wrong']) {
        assert.equal((await request('/api/processes', null, token)).status, 401);
        assert.equal((await request('/api/apps/process-association', { action: 'unbind', id: app.id }, token)).status, 401);
      }
      const listedResponse = await request('/api/processes'); assert.equal(listedResponse.status, 200); assert.equal(listedResponse.headers.get('cache-control'), 'no-store');
      const listed = await listedResponse.json();
      const bindBody = { action: 'bind', id: app.id, snapshotId: listed.snapshotId, selectionId: listed.processes[0].selectionId };
      assert.equal((await request('/api/apps/process-association', { ...bindBody, id: 'unknown' })).status, 400);
      assert.equal((await request('/api/apps/process-association', { ...bindBody, path: 'C:\\arbitrary.exe' })).status, 400);
      assert.equal((await request('/api/apps/process-association', bindBody)).status, 200);
      f.rows([]); assert.equal((await request('/api/apps/process-association', bindBody)).status, 409);
      f.fail(); assert.equal((await request('/api/processes')).status, 503);
      assert.equal((await request('/api/apps/process-association', { action: 'unbind', id: app.id })).status, 200);
    } finally { await new Promise((resolve) => server.close(resolve)); }
  });
  console.log(checks + ' process association groups passed (temporary fixtures only)');
}
main().catch((err) => { console.error(err); process.exitCode = 1; }).finally(() => {
  // root is the literal mkdtemp directory created above, never a user-config path.
  if (path.dirname(root) === os.tmpdir() && path.basename(root).startsWith('nerv-associations-test-')) fs.rmSync(root, { recursive: true, force: true });
});
