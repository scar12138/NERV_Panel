'use strict';
// Real isolated frontend acceptance. Browser writes are intercepted; HTTP auth probes
// contain no valid session ID/value and cannot control playback or change volume.
// Usage: D:\nodejs\node.exe scripts/verify-audio-ui.js
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const net = require('node:net');
const { spawn } = require('node:child_process');
const WebSocket = require('ws');
const ROOT = path.resolve(__dirname, '..');
const BASE = process.env.AUDIO_VERIFY_URL || 'http://127.0.0.1:5016';
if (new URL(BASE).protocol !== 'http:' || new URL(BASE).hostname !== '127.0.0.1' || !['5016', '5000'].includes(new URL(BASE).port)) throw Error('Acceptance requires an explicitly selected local service on port 5016 or 5000');
const TOKEN = process.env.AUDIO_VERIFY_TOKEN || (process.env.AUDIO_VERIFY_CONFIG ? JSON.parse(fs.readFileSync(path.resolve(process.env.AUDIO_VERIFY_CONFIG), 'utf8').replace(/^\uFEFF/, '')).token : new URL(BASE).port === '5016' ? 'verify16-local-only' : '');
if (!TOKEN) throw Error('AUDIO_VERIFY_TOKEN or AUDIO_VERIFY_CONFIG is required for the packaged service');
const OUT = process.env.AUDIO_VERIFY_OUT ? path.resolve(process.env.AUDIO_VERIFY_OUT) : path.join(ROOT, 'preview', new URL(BASE).port === '5000' ? 'audio-ui-verification-packaged' : 'audio-ui-verification');
const report = { startedAt: new Date().toISOString(), base: BASE, checks: [], failures: [], consoleErrors: [], exceptions: [], browserLogErrors: [], failedRequests: [], httpErrors: [], networkWrites: [], viewports: [], limitations: ['Audio writes and media snapshots for deterministic UI cases are mocked in the browser. No playback controls are clicked.', 'Real audio sessions are read, but device/session lifecycles and audible output are not assessed.'] };
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
function check(name, pass, evidence) { report.checks.push({ name, pass: !!pass, evidence }); if (!pass) report.failures.push(name); }
async function json(url, options) { const r = await fetch(url, options); const body = await r.json(); return { status: r.status, body }; }
class CDP {
  constructor(ws) { this.ws = ws; this.n = 0; this.pending = new Map(); this.handlers = {}; ws.on('message', raw => { const j = JSON.parse(raw); if (j.id && this.pending.has(j.id)) { const p = this.pending.get(j.id); this.pending.delete(j.id); clearTimeout(p.timer); j.error ? p.reject(Error(JSON.stringify(j.error))) : p.resolve(j.result); } else if (this.handlers[j.method]) this.handlers[j.method](j.params); }); }
  on(name, fn) { this.handlers[name] = fn; }
  send(method, params = {}) { return new Promise((resolve, reject) => { const id = ++this.n; const timer = setTimeout(() => { this.pending.delete(id); reject(Error('CDP timeout: ' + method)); }, 15000); this.pending.set(id, { resolve, reject, timer }); this.ws.send(JSON.stringify({ id, method, params })); }); }
  async ev(expression) { const r = await this.send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true }); if (r.exceptionDetails) throw Error(JSON.stringify(r.exceptionDetails)); return r.result.value; }
}
async function port() { const s = net.createServer(); await new Promise(r => s.listen(0, '127.0.0.1', r)); const p = s.address().port; await new Promise(r => s.close(r)); return p; }
async function waitFor(c, expression, ms = 12000) { const until = Date.now() + ms; while (Date.now() < until) { if (await c.ev(expression)) return; await delay(100); } throw Error('Timed out: ' + expression); }
async function click(c, selector) { const pt = await c.ev(`(()=>{const e=document.querySelector(${JSON.stringify(selector)});if(!e)throw Error('Missing click target');e.scrollIntoView({block:'center'});const r=e.getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2};})()`); await c.send('Input.dispatchMouseEvent', { type: 'mousePressed', ...pt, button: 'left', clickCount: 1 }); await c.send('Input.dispatchMouseEvent', { type: 'mouseReleased', ...pt, button: 'left', clickCount: 1 }); }
async function screenshot(c, name) { const shot = await c.send('Page.captureScreenshot', { format: 'png' }); fs.writeFileSync(path.join(OUT, name + '.png'), Buffer.from(shot.data, 'base64')); }
async function open(c) { await click(c, '#mediaCover'); await waitFor(c, "document.getElementById('audioPage').classList.contains('open')"); await delay(400); }
async function closed(c) { return c.ev("document.getElementById('audioPage').hidden && !document.getElementById('audioPage').classList.contains('open') && !document.getElementById('pagerViewport').hasAttribute('inert') && document.activeElement.id === 'mediaCover'"); }
async function main() {
  fs.mkdirSync(OUT, { recursive: true });
  const real = await json(BASE + '/api/audio/sessions');
  check('real HTTP sessions read', real.status === 200 && real.body.ok && Array.isArray(real.body.sessions), { status: real.status, master: !!real.body.master, sessions: real.body.sessions?.map(s => ({ name: s.name, active: s.active, isSystemSounds: s.isSystemSounds })) });
  const media = await json(BASE + '/api/media');
  check('real HTTP media read', media.status === 200 && media.body.ok, media.body);
  for (const endpoint of ['/api/audio/volume', '/api/audio/mute', '/api/media/control']) {
    for (const [label, token, expected] of [['missing', '', 401], ['invalid', 'verify-invalid-local-only', 401], ['valid malformed body', TOKEN, 400]]) {
      const r = await json(BASE + endpoint, { method: 'POST', headers: { 'Content-Type': 'application/json', ...(token ? { 'X-NERV-Token': token } : {}) }, body: '{}' });
      check(`HTTP auth ${endpoint}: ${label}`, r.status === expected && r.body.ok === false, r);
    }
  }
  const appResponse = await fetch(BASE + '/js/app.js');
  if (!appResponse.ok) throw Error('Served app.js is unavailable');
  const app = await appResponse.text();
  check('app.js integrates audio UI, tokenized apiPost and Escape', /NervAudioUI\.init\(\{ post: apiPost, toast: toast \}\)/.test(app) && /audioUI\.isOpen\(\)/.test(app) && /audioUI\.close\(\)/.test(app) && /"X-NERV-Token": getToken\(\)/.test(app));
  const debugPort = await port();
  const profile = path.join(os.tmpdir(), 'nerv-audio-verify-' + Date.now());
  const edge = spawn('C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe', ['--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check', '--user-data-dir=' + profile, '--remote-debugging-port=' + debugPort, 'about:blank'], { stdio: 'ignore' });
  let ws;
  try {
    let target;
    for (let i = 0; i < 60 && !target; i++) { await delay(150); try { const list = await (await fetch('http://127.0.0.1:' + debugPort + '/json/list')).json(); target = list.find(x => x.type === 'page'); } catch (_) {} }
    if (!target) throw Error('Edge CDP unavailable');
    ws = new WebSocket(target.webSocketDebuggerUrl); await new Promise((r, j) => { ws.once('open', r); ws.once('error', j); });
    const c = new CDP(ws);
    c.on('Runtime.consoleAPICalled', p => { if (p.type === 'error') report.consoleErrors.push(p.args.map(a => a.value || a.description).join(' ')); });
    c.on('Runtime.exceptionThrown', p => report.exceptions.push(p.exceptionDetails));
    c.on('Network.requestWillBeSent', p => { if (!['GET', 'HEAD', 'OPTIONS'].includes(p.request.method)) report.networkWrites.push({ url: p.request.url, method: p.request.method }); });
    c.on('Log.entryAdded', p => { if (p.entry.level === 'error') report.browserLogErrors.push(p.entry); });
    c.on('Network.loadingFailed', p => report.failedRequests.push({ type: p.type, errorText: p.errorText, canceled: p.canceled }));
    c.on('Network.responseReceived', p => { if (p.response.status >= 400) report.httpErrors.push({ url: p.response.url, status: p.response.status }); });
    await c.send('Page.enable'); await c.send('Runtime.enable'); await c.send('Network.enable'); await c.send('Log.enable');
    await c.send('Page.addScriptToEvaluateOnNewDocument', { source: `localStorage.setItem('nerv.token',${JSON.stringify(TOKEN)});window.__audioTest={mock:false,playing:true,writes:[],blocked:[],reads:0,sessions:[{id:'test:active',name:'Active App',volume:34,muted:false,active:true},{id:'test:inactive',name:'Inactive App',volume:49,muted:false,active:false},{id:'test:system',name:'',volume:57,muted:false,active:false,isSystemSounds:true},{id:'test:legacy',name:'Legacy App',volume:22,muted:false}],master:{id:'test:master',volume:68,muted:false}};const originalFetch=window.fetch.bind(window);window.fetch=function(input,init){const u=new URL(typeof input==='string'?input:input.url,location.href);const method=((init&&init.method)||(input&&input.method)||'GET').toUpperCase();const t=window.__audioTest;const response=j=>new Response(JSON.stringify(j),{status:200,headers:{'Content-Type':'application/json'}});if(!['GET','HEAD','OPTIONS'].includes(method)){const body=JSON.parse(init&&init.body||'{}');t.blocked.push({url:u.pathname,body});if(u.pathname==='/api/audio/volume'){t.writes.push({body,time:performance.now(),tokenMatches:new Headers(init.headers).get('X-NERV-Token')===localStorage.getItem('nerv.token')});return new Promise(resolve=>setTimeout(()=>{const row=body.id===t.master.id?t.master:t.sessions.find(s=>s.id===body.id);if(row)row.volume=body.volume;resolve(response({ok:true}));},220));}return Promise.reject(Error('Acceptance blocked write: '+u.pathname));}if(t.mock&&u.pathname==='/api/audio/sessions'){t.reads++;return Promise.resolve(response({ok:true,master:t.master,sessions:t.sessions}));}if(t.mock&&u.pathname==='/api/media')return Promise.resolve(response({ok:true,media:{available:true,app:'acceptance.mock',appName:'示例播放器',title:'示例数据 · CDP 音频验收',artist:'浏览器隔离 Mock',isPlaying:t.playing,position:93,duration:252,thumbHash:null}}));return originalFetch(input,init);};` });
    for (const view of [{ name: 'landscape', width: 1280, height: 800 }, { name: 'portrait', width: 800, height: 1280 }]) {
      await c.send('Emulation.setDeviceMetricsOverride', { width: view.width, height: view.height, deviceScaleFactor: 1, mobile: true });
      await c.send('Page.navigate', { url: BASE });
      await waitFor(c, "!!document.getElementById('audioPage') && getComputedStyle(document.getElementById('boot')).display === 'none'", 14000);
      await click(c, '.page-switch button[data-page="1"]'); await delay(650);
      await open(c);
      await waitFor(c, "document.getElementById('audioStatus').textContent !== '正在连接…'");
      check(view.name + ': real cover opens bottom sheet with inert background', await c.ev("document.getElementById('pagerViewport').hasAttribute('inert') && document.getElementById('audioPage').getAttribute('role') === 'dialog'"));
      if (media.body.media?.hasThumb && media.body.media?.thumbHash) {
        await waitFor(c, "(()=>{const i=document.getElementById('audioArtwork');return !i.hidden&&i.complete&&i.naturalWidth>0;})()", 6000);
        check(view.name + ': real media thumbnail decodes', await c.ev("(()=>{const i=document.getElementById('audioArtwork');return {decoded:!i.hidden&&i.complete&&i.naturalWidth>0,width:i.naturalWidth,height:i.naturalHeight};})()").then(x => { report.viewports.push({ name: view.name + '-thumbnail', ...x }); return x.decoded; }));
      }
      await screenshot(c, 'real-sheet-' + view.name);
      await click(c, '#audioBack'); check(view.name + ': close button and focus restoration', await closed(c));
      await open(c);
      await c.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: 4, y: 4, button: 'left', clickCount: 1 }); await c.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: 4, y: 4, button: 'left', clickCount: 1 });
      check(view.name + ': backdrop closes', await closed(c));
      await open(c); await c.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 }); await c.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
      check(view.name + ': Escape closes through app.js', await closed(c));
      await c.ev('window.__audioTest.mock=true'); await open(c); await waitFor(c, "!!document.querySelector('[data-id=\"test:active\"]')");
      const rendered = await c.ev(`Array.from(document.querySelectorAll('.audio-session')).map(e=>({id:e.dataset.id,name:e.querySelector('b').textContent,icon:e.querySelector('.audio-app-icon').textContent,disabled:e.querySelector('input').disabled}))`);
      check(view.name + ': active and legacy sessions shown; inactive filtered; system retained', rendered.some(r => r.id === 'test:active') && rendered.some(r => r.id === 'test:legacy') && !rendered.some(r => r.id === 'test:inactive') && rendered.some(r => r.id === 'test:system' && r.name === '系统声音' && r.icon === '◈'), rendered);
      const rects = await c.ev(`(()=>{const b=document.querySelector('.audio-box'),r=b.getBoundingClientRect();return {viewport:[innerWidth,innerHeight],rect:r.toJSON(),scrollWidth:b.scrollWidth,clientWidth:b.clientWidth,scrollHeight:b.scrollHeight,clientHeight:b.clientHeight,bodyOverflow:document.body.scrollWidth-innerWidth,rows:Array.from(document.querySelectorAll('.audio-session')).map(e=>({width:e.clientWidth,scroll:e.scrollWidth}))};})()`);
      check(view.name + ': bottom aligned and no horizontal overflow', Math.abs(rects.rect.bottom - view.height) < 2 && rects.rect.width <= 862 && rects.rect.height <= view.height * 0.88 + 2 && rects.scrollWidth <= rects.clientWidth + 1 && rects.bodyOverflow <= 1 && rects.rows.every(r => r.scroll <= r.width + 1), rects);
      report.viewports.push({ ...view, layout: rects }); await screenshot(c, 'mock-sheet-' + view.name);
      for (const selector of ['#audioMaster', '[data-id="test:active"] input']) {
        const result = await c.ev(`(async()=>{const t=window.__audioTest;t.writes=[];const s=document.querySelector(${JSON.stringify(selector)});s.dispatchEvent(new PointerEvent('pointerdown',{bubbles:true}));let immediate=true;for(let i=0;i<32;i++){s.value=10+i*2;s.dispatchEvent(new Event('input',{bubbles:true}));immediate=immediate&&s.parentElement.querySelector('output').textContent===s.value+'%';await new Promise(r=>setTimeout(r,12));}s.value=87;s.dispatchEvent(new Event('input',{bubbles:true}));s.dispatchEvent(new Event('change',{bubbles:true}));s.dispatchEvent(new PointerEvent('pointerup',{bubbles:true}));await new Promise(r=>setTimeout(r,1100));return {immediate,writes:t.writes,value:s.value,output:s.parentElement.querySelector('output').textContent};})()`);
        const writes = result.writes;
        check(view.name + ': realtime throttled final value ' + selector, result.immediate && writes.length >= 2 && writes.length <= 6 && writes.at(-1).body.volume === 87 && result.value === '87' && result.output === '87%' && writes.every(w => w.tokenMatches === true) && writes.slice(1).every((w, i) => w.time - writes[i].time >= 130), result);
      }
      await click(c, '#audioBack');
      await waitFor(c, "document.getElementById('eqBars').classList.contains('on')", 4000);
      const anim = () => c.ev(`({on:document.getElementById('eqBars').classList.contains('on'),playing:document.getElementById('mediaCover').classList.contains('playing'),state:getComputedStyle(document.querySelector('#eqBars i'),'::before').animationPlayState,transform:getComputedStyle(document.querySelector('#eqBars i'),'::before').transform})`);
      const playing = await anim(); await c.ev('window.__audioTest.playing=false'); await waitFor(c, "!document.getElementById('eqBars').classList.contains('on')", 4000); const paused1 = await anim(); await delay(250); const paused2 = await anim();
      check(view.name + ': pause freezes decorative animation', playing.on && playing.playing && playing.state === 'running' && !paused1.playing && paused1.state === 'paused' && paused1.transform === paused2.transform, { playing, paused1, paused2 });
      // No-system-session fixture must render an explicit disabled fallback.
      await c.ev("window.__audioTest.sessions=window.__audioTest.sessions.filter(s=>!s.isSystemSounds)"); await open(c);
      await waitFor(c, "!!document.querySelector('[data-id=\"system-unavailable\"]')");
      check(view.name + ': absent system session has disabled fallback', await c.ev("document.querySelector('[data-id=\"system-unavailable\"] input').disabled && document.querySelector('[data-id=\"system-unavailable\"] button').disabled"));
      await click(c, '#audioBack');
    }
    check('no browser write reached network', report.networkWrites.length === 0, report.networkWrites);
    check('no console.error or uncaught exceptions', report.consoleErrors.length === 0 && report.exceptions.length === 0, { consoleErrors: report.consoleErrors, exceptions: report.exceptions });
    check('no browser resource errors', report.browserLogErrors.length === 0 && report.httpErrors.length === 0 && report.failedRequests.filter(r => !r.canceled).length === 0, { browserLogErrors: report.browserLogErrors, httpErrors: report.httpErrors, failedRequests: report.failedRequests });
  } finally { if (ws) ws.close(); edge.kill(); }
}
main().catch(error => { report.failures.push('fatal'); report.error = error.stack || String(error); }).finally(() => { report.finishedAt = new Date().toISOString(); report.ok = report.failures.length === 0; fs.mkdirSync(OUT, { recursive: true }); const serialized = JSON.stringify(report, null, 2).split(TOKEN).join('[REDACTED]'); fs.writeFileSync(path.join(OUT, 'report.json'), serialized); console.log(serialized); if (!report.ok) process.exitCode = 1; });
