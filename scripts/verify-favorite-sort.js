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
  app.get('/audio.css', (req, res) => res.sendFile(path.join(ROOT, 'public/css/audio.css')));
  app.get('/style.css', (req, res) => res.sendFile(path.join(ROOT, 'public/css/style.css')));
  app.post('/api/apps/order', async (req, res) => {
    posts.push(req.body);
    await pause(150);
    if (failNext) { failNext = false; res.status(500).json({ ok: false, message: 'Injected failure' }); return; }
    const result = await favorites.reorder(req.body.ids);
    res.status(result.ok ? 200 : 409).json(result);
  });
  app.get('/', (req, res) => res.type('html').send(`<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/audio.css"><style>body{margin:20px}#appGrid{display:flex;gap:10px;width:620px}.app{width:130px;height:130px;flex-shrink:0;border:1px solid;padding:5px}.add{width:130px;height:130px;border:1px solid}#outside{margin:30px 0;width:600px;font:20px sans-serif}#scroll{height:140px;overflow:auto;width:620px}#scroll-tail{height:700px}</style><p>示例数据 · favorite sorting regression fixture</p><div id="scroll"><div id="appGrid"><div class="add"><button id="add">Add</button></div><div class="app" data-id="a">A<img alt="fixture" draggable="false" width="20" height="20" src="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='20' height='20'%3E%3C/svg%3E"><button id="launch">Launch</button><button id="already" disabled>Disabled</button></div><div class="app" data-id="b">B<button>Launch</button></div><div class="app" data-id="c">C<button>Launch</button></div></div><div id="scroll-tail"></div></div><button id="done">Done</button><p id="outside">Ordinary adjacent selectable text for real mouse dragging selection regression.</p><script src="/favorite-sort.js"></script><script>window.clicks=0;window.orders=[];window.errors=[];document.querySelector('#launch').onclick=function(){window.clicks++};window.sort=NervFavoriteSort.init({grid:document.querySelector('#appGrid'),doneButton:document.querySelector('#done'),onOrder:function(ids,result){window.orders.push({ids:ids,rollback:!!result.rollback})},onError:function(e){window.errors.push(e.message)}});</script>`));
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
    const order = () => c.ev('Array.from(document.querySelectorAll("#appGrid > .app")).map(e=>e.dataset.id)');
    const rect = selector => c.ev(`(()=>{const r=document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect();return {x:r.left+r.width/2,y:r.top+r.height/2,left:r.left,right:r.right}})()`);
    const mouse = (type, point) => c.send('Input.dispatchMouseEvent', { type, x: point.x, y: point.y, button: 'left', buttons: type === 'mouseReleased' ? 0 : 1, clickCount: 1 });
    assert.equal(await c.ev('document.querySelector("#appGrid").lastElementChild.className'), 'add');
    const shortPoint = await rect('#launch'); await mouse('mousePressed', shortPoint); await pause(80); await mouse('mouseReleased', shortPoint);
    assert.equal(await c.ev('window.clicks'), 1); assert.equal(await c.ev('sort.isSorting()'), false); assert.equal(posts.length, 0);
    pass('short mouse press still launches and does not save', { clicks: 1, posts: 0 });
    const from = await rect('[data-id="a"]'); await mouse('mousePressed', from); await pause(400); assert.equal(await c.ev('sort.isSorting()'), false); await pause(180);
    assert.equal(await c.ev('sort.isSorting() && !!document.querySelector(".favorite-sort-floating")'), true);
    assert.equal(await c.ev('Array.from(document.querySelectorAll("#appGrid button")).every(b=>b.disabled)'), true);
    const to = await rect('[data-id="c"]'); to.x = to.right - 10; await mouse('mouseMoved', to); await mouse('mouseReleased', to);
    assert.equal(await c.ev('sort.isSaving()'), true); await c.ev('sort.whenSaved()');
    assert.deepEqual(await order(), ['b', 'c', 'a']); assert.deepEqual(config.loadConfig().config.favoriteAppIds, ['b', 'c', 'a']); assert.deepEqual(posts[0], { ids: ['b', 'c', 'a'] });
    assert.equal(await c.ev('document.querySelector("#appGrid").lastElementChild.className'), 'add');
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
    await c.ev('sort.exit()');
    await c.send('Emulation.setTouchEmulationEnabled', { enabled: false });
    const out = await rect('#outside');
    const begin = await rect('[data-id="a"]');
    await mouse('mousePressed', begin); await pause(580);
    assert.equal(await c.ev('document.documentElement.classList.contains("favorite-sort-dragging")'), true);
    await mouse('mouseMoved', { x: out.left + 20, y: out.y });
    await mouse('mouseMoved', { x: out.right - 20, y: out.y });
    assert.equal(await c.ev('String(getSelection())'), '');
    assert.equal(await c.ev('(()=>{const e=new Event("selectstart",{bubbles:true,cancelable:true});document.querySelector("#outside").dispatchEvent(e);return e.defaultPrevented})()'), true);
    assert.equal(await c.ev('(()=>{const e=new Event("dragstart",{bubbles:true,cancelable:true});document.querySelector("#outside").dispatchEvent(e);return e.defaultPrevented})()'), true);
    await mouse('mouseReleased', { x: out.right - 20, y: out.y });
    assert.equal(await c.ev('document.documentElement.classList.contains("favorite-sort-dragging")'), false);
    await c.ev('sort.exit()');
    await mouse('mousePressed', { x: out.left + 3, y: out.y });
    await mouse('mouseMoved', { x: out.right - 10, y: out.y });
    await mouse('mouseReleased', { x: out.right - 10, y: out.y });
    assert.ok((await c.ev('String(getSelection())')).length > 0, 'ordinary outside text must be selectable again');
    pass('production CSS: real mouse drag outside grid selects no adjacent text; release restores selection', true);
    await c.ev('sort.whenSaved()');
    await c.ev('getSelection().removeAllRanges()');
    for (const end of ['blur', 'hidden', 'pointercancel']) {
      await c.ev('document.querySelector("#scroll").scrollTop=0'); await pause(80);
      await mouse('mousePressed', await rect('[data-id="a"]')); await pause(580);
      assert.equal(await c.ev('!!document.querySelector(".favorite-sort-floating")'), true, JSON.stringify({end, state:await c.ev('({scroll:document.querySelector("#scroll").scrollTop,rect:document.querySelector("[data-id=a]").getBoundingClientRect().toJSON(),sorting:sort.isSorting(),saving:sort.isSaving()})')}));
      await c.ev(end === 'blur' ? 'window.dispatchEvent(new Event("blur"))' : end === 'hidden' ? 'Object.defineProperty(document,"hidden",{configurable:true,value:true});document.dispatchEvent(new Event("visibilitychange"));delete document.hidden' : 'document.dispatchEvent(new PointerEvent("pointercancel",{pointerId:1,bubbles:true}))');
      assert.equal(await c.ev('!!document.querySelector(".favorite-sort-floating") || document.documentElement.classList.contains("favorite-sort-dragging")'), false);
      await mouse('mouseReleased', begin); await c.ev('sort.exit()');
    }
    pass('blur, hidden and pointercancel clean global selection guard and floating card', true);
    await c.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 1 });
    await c.ev('document.querySelector("#scroll").scrollTop=0');
    const scrollStart = await rect('[data-id="a"]');
    await touch('touchStart', scrollStart);
    await touch('touchMove', { x: scrollStart.x, y: scrollStart.y - 45 });
    await touch('touchMove', { x: scrollStart.x, y: scrollStart.y - 85 });
    await pause(100); await touch('touchEnd'); await pause(100);
    assert.ok(await c.ev('document.querySelector("#scroll").scrollTop > 0'), 'ordinary touch must actually scroll');
    assert.equal(await c.ev('sort.isSorting()'), false);
    pass('production CSS leaves ordinary pre-hold touch scrolling intact', true);
    await c.ev('sort.destroy()'); assert.equal(await c.ev('document.querySelectorAll(".favorite-sort-floating").length'), 0);
    // A long grid exercises stationary edge holds through many offscreen rows.
    await c.ev(`document.querySelector('#scroll-tail').remove();document.querySelector('#scroll').style.height='360px';document.querySelector('#appGrid').style.cssText='display:grid;grid-template-columns:repeat(4,130px);gap:10px;width:590px;overflow-anchor:none';document.querySelector('#appGrid').innerHTML=Array.from({length:40},(_,i)=>'<div class="app" data-id="long-'+i+'">App '+i+'</div>').join('')+'<div class="add">Add</div>';window.autoSaves=[];window.sort=NervFavoriteSort.init({grid:document.querySelector('#appGrid'),saveOrder:async function(ids){autoSaves.push(ids);return {ok:true}}});document.querySelector('#scroll').scrollTop=99999`);
    await c.send('Emulation.setTouchEmulationEnabled', { enabled: false });
    await pause(120);
    const bottomCard = await rect('[data-id="long-39"]');
    const edgePoints = await c.ev(`(()=>{const s=document.querySelector('#scroll').getBoundingClientRect();const a=document.querySelector('[data-id="long-0"]').getBoundingClientRect();return {top:{x:a.left+12,y:s.top+2},bottom:{x:document.querySelector('[data-id="long-39"]').getBoundingClientRect().right-12,y:s.bottom-2}}})()`);
    await mouse('mousePressed', bottomCard); await pause(580);
    await mouse('mouseMoved', edgePoints.top); await pause(3600);
    assert.equal(await c.ev('document.querySelector("#scroll").scrollTop'), 0);
    assert.equal((await order())[0], 'long-39');
    await mouse('mouseReleased', edgePoints.top); await c.ev('sort.whenSaved()');
    assert.equal(await c.ev('autoSaves.length'), 1);
    await pause(150); assert.equal(await c.ev('document.querySelector("#scroll").scrollTop'), 0);
    pass('mouse: stationary top-edge hold moves last of 40 apps to first in one drag and saves once', true);
    await c.ev('sort.exit()');
    await c.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 1 });
    await touch('touchStart', await rect('[data-id="long-39"]')); await pause(580);
    await touch('touchMove', edgePoints.bottom); await pause(3600);
    assert.equal((await order()).at(-1), 'long-39');
    assert.ok(await c.ev('document.querySelector("#scroll").scrollTop > 1000'));
    await touch('touchEnd'); await c.ev('sort.whenSaved()');
    assert.equal(await c.ev('autoSaves.length'), 2);
    const stopped = await c.ev('document.querySelector("#scroll").scrollTop');
    await pause(200); assert.equal(await c.ev('document.querySelector("#scroll").scrollTop'), stopped);
    pass('touch: stationary bottom-edge hold moves first app to last; release stops scrolling', true);
    await touch('touchStart', await rect('[data-id="long-39"]'));
    await touch('touchMove', edgePoints.top); await pause(300); await touch('touchCancel');
    const cancelledScroll = await c.ev('document.querySelector("#scroll").scrollTop');
    await pause(200); assert.equal(await c.ev('document.querySelector("#scroll").scrollTop'), cancelledScroll);
    assert.equal((await order()).at(-1), 'long-39'); assert.equal(await c.ev('autoSaves.length'), 2);
    pass('edge-scroll cancellation restores order, stops scrolling and does not save', true);
    await c.ev('sort.destroy()');
    // At an exact-fit boundary, shake rotation must not create transient overflow.
    // Use the real scroll styles and grid geometry in both viewport orientations.
    await c.ev(`sort.exit();document.querySelector('#scroll').innerHTML='<div id="appGrid"><div class="app favorite-sort-shake" data-id="boundary">Boundary</div></div>';document.querySelector('#scroll').className='app-scroll';document.querySelector('#appGrid').style.cssText='display:grid;grid-template-columns:repeat(4,1fr);gap:10px;width:100%;flex:none';document.querySelector('#scroll').style.cssText='width:600px;height:140px;flex:none';document.querySelector('#appGrid .app').style.cssText='height:140px;min-height:140px;width:auto;box-sizing:border-box';`);
    await c.ev(`new Promise(resolve=>{const link=document.createElement('link');link.rel='stylesheet';link.href='/style.css';link.onload=resolve;document.head.appendChild(link)})`);
    for (const viewport of [{width:900,height:650},{width:650,height:900}]) {
      await c.send('Emulation.setDeviceMetricsOverride', {...viewport,deviceScaleFactor:1,mobile:false});
      const samples = await c.ev(`new Promise(resolve=>{const samples=[];const box=document.querySelector('#scroll');function sample(){samples.push({height:box.scrollHeight,client:box.clientHeight,width:box.clientWidth});if(samples.length<65)requestAnimationFrame(sample);else resolve(samples)}requestAnimationFrame(sample)})`);
      assert.ok(samples.every(s=>s.height===s.client), 'shake must not create scrollbars for exact-fit content: '+JSON.stringify({viewport,samples}));
      assert.equal(new Set(samples.map(s=>s.width)).size,1,'scrollbar must not toggle content width');
    }
    pass('landscape and portrait: sorting shake keeps exact-fit scrollbar geometry stable for 65 frames',true);
  } finally { if (ws) ws.close(); browser.kill(); await new Promise(resolve => server.close(resolve)); }
  if (original) assert.deepEqual(fs.readFileSync(realConfig), original); else assert.equal(fs.existsSync(realConfig), false);
  pass('real user config remains byte-identical', true);
  console.log(JSON.stringify({ ok: true, checks: results.length, isolatedRoot: temp, results }, null, 2));
}
main().catch(error => { console.error(error); process.exitCode = 1; });
