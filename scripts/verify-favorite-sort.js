'use strict';
// Isolated regression checks: real config/favorites persistence, fixture scan and browser UI.
// No production server, user config, application launch, or real system scan is used.
const assert = require('assert/strict');
const fs = require('fs');
const path = require('path');
const os = require('os');
const http = require('http');
const { spawn } = require('child_process');
const express = require('express');
const WebSocket = require('ws');
const ROOT = path.resolve(__dirname, '..');
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'nerv-favorite-sort-'));
process.env.NERV_PANEL_ROOT = temp;
const fixtures = ['a', 'b', 'c', 'd'].map(id => ({ id, name: 'Fixture ' + id, running: false }));
// Stub only the scan boundary; persistence and favorite validation remain production code.
require.cache[require.resolve('../server/apps')] = { id: require.resolve('../server/apps'), filename: require.resolve('../server/apps'), loaded: true, exports: { scanApps: async () => fixtures, withRunning: async items => items } };
const config = require('../server/config');
const favorites = require('../server/favorites');
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
const results = [];
function pass(name, evidence) { results.push({ name, evidence }); console.log('PASS ' + name + ': ' + JSON.stringify(evidence)); }
function getJson(url) { return new Promise((resolve, reject) => http.get(url, res => { let text = ''; res.on('data', chunk => text += chunk); res.on('end', () => { try { resolve(JSON.parse(text)); } catch (error) { reject(error); } }); }).on('error', reject)); }
class CDP {
  constructor(ws) { this.ws = ws; this.next = 0; this.pending = new Map(); ws.on('message', raw => { const msg = JSON.parse(raw); const job = this.pending.get(msg.id); if (job) { this.pending.delete(msg.id); msg.error ? job.reject(Error(JSON.stringify(msg.error))) : job.resolve(msg.result); } }); }
  send(method, params = {}) { return new Promise((resolve, reject) => { const id = ++this.next; this.pending.set(id, { resolve, reject }); this.ws.send(JSON.stringify({ id, method, params })); }); }
  async ev(expression) { const result = await this.send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true }); if (result.exceptionDetails) throw Error(JSON.stringify(result.exceptionDetails)); return result.result.value; }
}
async function main() {
  const realConfig = path.join(ROOT, 'config.json');
  const original = fs.existsSync(realConfig) ? fs.readFileSync(realConfig) : null;
  config.loadConfig();
  config.saveConfig({ favoriteAppIds: ['a', 'missing:uninstalled', 'b', 'c'] });
  const accepted = await favorites.reorder(['c', 'a', 'b']);
  assert.equal(accepted.ok, true);
  assert.deepEqual(config.loadConfig().config.favoriteAppIds, ['c', 'missing:uninstalled', 'a', 'b']);
  assert.deepEqual((await favorites.list()).map(x => x.id), ['c', 'a', 'b']);
  pass('reorder persists and reloads; unresolved IDs retain their slot', config.getConfig().favoriteAppIds);
  for (const [ids, error] of [[null, 'ORDER_INVALID'], [['a', 1], 'ORDER_INVALID'], [[' a', 'b', 'c'], 'ORDER_INVALID'], [['a', 'a', 'b'], 'ORDER_DUPLICATE'], [['a', 'b'], 'ORDER_STALE'], [['a', 'b', 'd'], 'ORDER_STALE']]) {
    const before = fs.readFileSync(config.CONFIG_PATH, 'utf8');
    assert.equal((await favorites.reorder(ids)).error, error);
    assert.equal(fs.readFileSync(config.CONFIG_PATH, 'utf8'), before);
  }
  pass('invalid, duplicate, unknown and stale requests leave disk unchanged', 6);
  const concurrent = await Promise.all([favorites.update('add', 'd'), favorites.reorder(['c', 'a', 'b'])]);
  assert.equal(concurrent[0].ok, true); assert.equal(concurrent[1].error, 'ORDER_STALE');
  assert.deepEqual(config.loadConfig().config.favoriteAppIds, ['c', 'missing:uninstalled', 'a', 'b', 'd']);
  pass('queued add appends and stale reorder cannot overwrite it', config.getConfig().favoriteAppIds);
  config.saveConfig({ favoriteAppIds: ['a', 'b', 'c'] });
  let failNext = false;
  const posts = [];
  const app = express(); app.use(express.json());
  app.get('/favorite-sort.js', (req, res) => res.sendFile(path.join(ROOT, 'public/js/favorite-sort.js')));
  app.post('/api/apps/order', async (req, res) => {
    posts.push(req.body);
    await pause(150);
    if (failNext) { failNext = false; res.status(500).json({ ok: false, message: 'Injected failure' }); return; }
    const result = await favorites.reorder(req.body.ids);
    res.status(result.ok ? 200 : 409).json(result);
  });
  app.get('/', (req, res) => res.type('html').send(`<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><style>body{margin:20px}#grid{display:flex;gap:10px;width:620px}.app{width:130px;height:130px;flex-shrink:0;border:1px solid;padding:5px;user-select:none}.add{width:130px;height:130px;border:1px solid}</style><p>示例数据 · favorite sorting regression fixture</p><div id="grid"><div class="add"><button id="add">Add</button></div><div class="app" data-id="a">A<button id="launch">Launch</button><button id="already" disabled>Disabled</button></div><div class="app" data-id="b">B<button>Launch</button></div><div class="app" data-id="c">C<button>Launch</button></div></div><button id="done">Done</button><script src="/favorite-sort.js"></script><script>window.clicks=0;window.orders=[];window.errors=[];document.querySelector('#launch').onclick=function(){window.clicks++};window.sort=NervFavoriteSort.init({grid:document.querySelector('#grid'),doneButton:document.querySelector('#done'),onOrder:function(ids,result){window.orders.push({ids:ids,rollback:!!result.rollback})},onError:function(e){window.errors.push(e.message)}});</script>`));
  const server = app.listen(0, '127.0.0.1'); await new Promise(resolve => server.once('listening', resolve));
  // Reserve a currently free CDP port; use a separate profile per invocation.
  const probe = http.createServer(); await new Promise(resolve => probe.listen(0, '127.0.0.1', resolve)); const debugPort = probe.address().port; await new Promise(resolve => probe.close(resolve));
  const browser = spawn(process.env.EDGE_PATH || 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe', ['--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check', '--user-data-dir=' + path.join(temp, 'edge-profile'), '--remote-debugging-port=' + debugPort, 'about:blank'], { stdio: 'ignore' });
  let ws;
  try {
    let target;
    for (let i = 0; i < 60 && !target; i++) { await pause(100); try { target = (await getJson('http://127.0.0.1:' + debugPort + '/json/list')).find(item => item.type === 'page'); } catch (_) {} }
    assert.ok(target, 'Edge CDP did not start');
    ws = new WebSocket(target.webSocketDebuggerUrl); await new Promise((resolve, reject) => { ws.once('open', resolve); ws.once('error', reject); });
    const c = new CDP(ws); await c.send('Page.enable'); await c.send('Emulation.setDeviceMetricsOverride', { width: 900, height: 650, deviceScaleFactor: 1, mobile: false });
    await c.send('Page.navigate', { url: 'http://127.0.0.1:' + server.address().port });
    for (let i = 0; i < 30 && !(await c.ev('!!window.sort')); i++) await pause(50);
    const order = () => c.ev('Array.from(document.querySelectorAll("#grid > .app")).map(e=>e.dataset.id)');
    const rect = selector => c.ev(`(()=>{const r=document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect();return {x:r.left+r.width/2,y:r.top+r.height/2,left:r.left,right:r.right}})()`);
    const mouse = (type, point) => c.send('Input.dispatchMouseEvent', { type, x: point.x, y: point.y, button: 'left', buttons: type === 'mouseReleased' ? 0 : 1, clickCount: 1 });
    assert.equal(await c.ev('document.querySelector("#grid").lastElementChild.className'), 'add');
    const shortPoint = await rect('#launch'); await mouse('mousePressed', shortPoint); await pause(80); await mouse('mouseReleased', shortPoint);
    assert.equal(await c.ev('window.clicks'), 1); assert.equal(await c.ev('sort.isSorting()'), false); assert.equal(posts.length, 0);
    pass('short mouse press still launches and does not save', { clicks: 1, posts: 0 });
    const from = await rect('[data-id="a"]'); await mouse('mousePressed', from); await pause(400); assert.equal(await c.ev('sort.isSorting()'), false); await pause(180);
    assert.equal(await c.ev('sort.isSorting() && !!document.querySelector(".favorite-sort-floating")'), true);
    assert.equal(await c.ev('Array.from(document.querySelectorAll("#grid button")).every(b=>b.disabled)'), true);
    const to = await rect('[data-id="c"]'); to.x = to.right - 10; await mouse('mouseMoved', to); await mouse('mouseReleased', to);
    assert.equal(await c.ev('sort.isSaving()'), true); await c.ev('sort.whenSaved()');
    assert.deepEqual(await order(), ['b', 'c', 'a']); assert.deepEqual(config.loadConfig().config.favoriteAppIds, ['b', 'c', 'a']); assert.deepEqual(posts[0], { ids: ['b', 'c', 'a'] });
    assert.equal(await c.ev('document.querySelector("#grid").lastElementChild.className'), 'add');
    await c.ev('sort.exit()'); assert.equal(await c.ev('document.querySelector("#launch").disabled'), false); assert.equal(await c.ev('document.querySelector("#already").disabled'), true);
    pass('mouse 500ms hold, disabled buttons, add-last, POST persistence and restore', { posts: posts.slice(), order: await order() });
    await c.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 1 });
    const touch = (type, point) => c.send('Input.dispatchTouchEvent', { type, touchPoints: point ? [{ x: point.x, y: point.y, id: 1 }] : [] });
    const touchFrom = await rect('[data-id="a"]'); await touch('touchStart', touchFrom); await pause(400); assert.equal(await c.ev('sort.isSorting()'), false); await pause(180); assert.equal(await c.ev('sort.isSorting()'), true);
    const touchTo = await rect('[data-id="b"]'); touchTo.x = touchTo.left + 10; await touch('touchMove', touchTo); await touch('touchEnd'); await c.ev('sort.whenSaved()');
    assert.deepEqual(await order(), ['a', 'b', 'c']); assert.deepEqual(config.loadConfig().config.favoriteAppIds, ['a', 'b', 'c']);
    pass('touch 500ms hold, native move and release persist', { posts: posts.length, order: await order() });
    // Existing sort mode starts immediately. Reject the next HTTP save and assert rollback.
    failNext = true;
    const rollbackFrom = await rect('[data-id="a"]'); await touch('touchStart', rollbackFrom); const rollbackTo = await rect('[data-id="c"]'); rollbackTo.x = rollbackTo.right - 10; await touch('touchMove', rollbackTo); await touch('touchEnd'); await c.ev('sort.whenSaved()');
    assert.deepEqual(await order(), ['a', 'b', 'c']); assert.deepEqual(config.loadConfig().config.favoriteAppIds, ['a', 'b', 'c']);
    assert.equal(await c.ev('window.orders.at(-1).rollback'), true); assert.deepEqual(await c.ev('window.errors'), ['Injected failure']);
    pass('HTTP failure rolls DOM back without changing persisted order', await c.ev('({last:window.orders.at(-1),errors:window.errors})'));
    // Touch cancel must restore the prior order without posting.
    const count = posts.length; await touch('touchStart', await rect('[data-id="a"]')); const cancelTo = await rect('[data-id="c"]'); cancelTo.x = cancelTo.right - 10; await touch('touchMove', cancelTo); await touch('touchCancel');
    assert.deepEqual(await order(), ['a', 'b', 'c']); assert.equal(posts.length, count); await c.ev('sort.exit()');
    await pause(850); const tap = await rect('#launch'); await touch('touchStart', tap); await pause(80); await touch('touchEnd'); await pause(100);
    assert.equal(await c.ev('window.clicks'), 2); assert.equal(await c.ev('sort.isSorting()'), false);
    pass('touch cancellation rolls back and short tap launches', { clicks: 2, noCancelPost: true });
    const scrollFrom = await rect('[data-id="a"]'); await touch('touchStart', scrollFrom);
    await touch('touchMove', { x: scrollFrom.x, y: scrollFrom.y + 35 }); await pause(580); await touch('touchEnd');
    assert.equal(await c.ev('sort.isSorting()'), false); assert.equal(posts.length, count);
    pass('movement before hold cancels sorting without saving', true);
    // Failed saves must not poison the next write.
    await touch('touchStart', await rect('[data-id="a"]')); await pause(580); const retryTo = await rect('[data-id="c"]'); retryTo.x = retryTo.right - 10; await touch('touchMove', retryTo); await touch('touchEnd'); await c.ev('sort.whenSaved()');
    assert.deepEqual(config.loadConfig().config.favoriteAppIds, ['b', 'c', 'a']);
    pass('next save succeeds after rejected save', config.getConfig().favoriteAppIds);
    await c.ev('sort.destroy()'); assert.equal(await c.ev('document.querySelectorAll(".favorite-sort-floating").length'), 0);
  } finally { if (ws) ws.close(); browser.kill(); await new Promise(resolve => server.close(resolve)); }
  if (original) assert.deepEqual(fs.readFileSync(realConfig), original); else assert.equal(fs.existsSync(realConfig), false);
  pass('real user config remains byte-identical', true);
  console.log(JSON.stringify({ ok: true, checks: results.length, isolatedRoot: temp, results }, null, 2));
}
main().catch(error => { console.error(error); process.exitCode = 1; });
