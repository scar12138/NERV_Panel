'use strict';
/* 本轮自检：顶栏 / 5 按钮 / 标题 / 音乐布局 / 添加常用 / 日历节气可见性 */
const { spawn } = require('child_process');
const path = require('path');
const http = require('http');
const WebSocket = require('ws');

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const PORT = 9336;
const URL = 'http://127.0.0.1:5000/';

const VIEWS = [
  { slug: 'portrait', width: 800, height: 1280 },
  { slug: 'landscape', width: 1280, height: 800 }
];

function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

class CDP {
  constructor(ws) {
    this.ws = ws; this.id = 0; this.pending = new Map();
    ws.on('message', (raw) => {
      const msg = JSON.parse(raw);
      if (msg.id && this.pending.has(msg.id)) {
        const { resolve, reject } = this.pending.get(msg.id);
        this.pending.delete(msg.id);
        if (msg.error) reject(new Error(JSON.stringify(msg.error))); else resolve(msg.result);
      }
    });
  }
  send(method, params) {
    const id = ++this.id;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.ws.send(JSON.stringify({ id, method, params: params || {} }));
      setTimeout(() => { if (this.pending.has(id)) { this.pending.delete(id); reject(new Error('CDP timeout ' + method)); } }, 20000);
    });
  }
  async evaluate(expr) {
    const r = await this.send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
    if (r.exceptionDetails) throw new Error(JSON.stringify(r.exceptionDetails));
    return r.result && r.result.value;
  }
}

const PROBE = `(function(){
  function box(sel){ var el=document.querySelector(sel); if(!el) return null; var r=el.getBoundingClientRect(); return {w:Math.round(r.width),h:Math.round(r.height),top:Math.round(r.top),bottom:Math.round(r.bottom),visible: !!(r.width&&r.height)}; }
  var track=document.getElementById('pagerTrack'), pages=track?track.querySelectorAll('.page'):[], vp=document.getElementById('pagerViewport').getBoundingClientRect(), page=pages[0];
  for(var k=0;k<pages.length;k++){ var rk=pages[k].getBoundingClientRect(); if(rk.left>=vp.left-2&&rk.left<vp.left+2){page=pages[k];break;} }
  var inner=page.querySelector('.page-in');
  function overflow(el){ return el? el.scrollHeight - el.clientHeight : null; }
  var pwrBtns = page.querySelectorAll('.power-row .pwr');
  var pwrData = [];
  for (var i=0;i<pwrBtns.length;i++){ var t=pwrBtns[i].querySelector('b'); pwrData.push(t?t.textContent : pwrBtns[i].getAttribute('data-power')||'SETTINGS'); }
  return {
    view: window.innerWidth>window.innerHeight?'landscape':'portrait',
    pageTitle: document.getElementById('pageTitle').textContent,
    pageOverflow: overflow(page),
    innerOverflow: overflow(inner),
    headerHasSettingsBtn: !!document.getElementById('settingsBtn'),
    headerSwitchBtns: document.querySelectorAll('header .page-switch button').length,
    pageSwitchRightEdge: (function(){var r=document.querySelector('header .page-switch').getBoundingClientRect(); return {right:Math.round(r.right), winW:window.innerWidth};})(),
    powerRowBtns: pwrData,
    powerRowCount: pwrData.length,
    lastPwrBottom: (function(){var bs=pwrBtns; return bs.length?Math.round(bs[bs.length-1].getBoundingClientRect().bottom):null;})(),
    addFavVisible: (function(){var b=document.getElementById('addFavBtn'); return b? box('#addFavBtn') : null;})(),
    musicCover: box('#mediaCover'),
    hasMusicSecHead: !!document.querySelector('.music-col .sec-head'),
    coverAfterTrack: (function(){var t=document.getElementById('trackName'), c=document.getElementById('mediaCover'); return t&&c? (t.compareDocumentPosition(c)&Node.DOCUMENT_POSITION_FOLLOWING)!==0 : null;})(),
    lunTagVisible: (function(){var g=document.getElementById('calGrid'); if(!g) return null; var tags=g.querySelectorAll('.lun-tag'); if(!tags.length) return null; var r=tags[0].getBoundingClientRect(); return {w:Math.round(r.width),h:Math.round(r.height),text:tags[0].textContent};})(),
    todayCell: (function(){var g=document.getElementById('calGrid'); if(!g) return null; var d=g.querySelector('.day.today'); return d? d.textContent : null;})()
  };
})()`;

async function waitForTarget() {
  for (let i = 0; i < 60; i++) {
    const list = await new Promise((resolve) => {
      http.get({ host: '127.0.0.1', port: PORT, path: '/json/list' }, (res) => {
        let buf = ''; res.on('data', (d) => (buf += d)); res.on('end', () => { try { resolve(JSON.parse(buf)); } catch (e) { resolve(null); } });
      }).on('error', () => resolve(null));
    });
    if (list && list.length) { const p = list.find((t) => t.type === 'page'); if (p) return p; }
    await sleep(200);
  }
  throw new Error('cannot connect Edge');
}

async function main() {
  const child = spawn(EDGE, [
    '--headless=new', '--disable-gpu', '--hide-scrollbars', '--no-first-run',
    '--user-data-dir=' + path.join(process.env.TEMP || '.', 'nerv-diag-r9'),
    '--remote-debugging-port=' + PORT, 'about:blank'
  ], { stdio: 'ignore' });
  const target = await waitForTarget();
  const ws = new WebSocket(target.webSocketDebuggerUrl, { perMessageDeflate: false });
  await new Promise((res, rej) => { ws.once('open', res); ws.once('error', rej); });
  const cdp = new CDP(ws);
  await cdp.send('Page.enable');
  await cdp.send('Runtime.enable');

  let allOk = true;
  const results = [];
  for (const view of VIEWS) {
    await cdp.send('Emulation.setDeviceMetricsOverride', { width: view.width, height: view.height, deviceScaleFactor: 2, mobile: true });
    await cdp.send('Page.navigate', { url: URL });
    await sleep(6200);
    for (const idx of [0, 1]) {
      await cdp.evaluate(`(function(){var b=document.querySelectorAll('.page-switch button')[${idx}];if(b)b.click();return true;})()`);
      await sleep(1200);
      const info = await cdp.evaluate(PROBE);
      results.push({ view: view.slug, idx, info });
      console.log('\n=== ' + view.slug + ' page' + idx + ' ===');
      console.log(JSON.stringify(info, null, 2));
      const p = info;
      if (p.pageOverflow !== 0 || p.innerOverflow !== 0) { allOk = false; console.log('  !! OVERFLOW'); }
      if (p.headerHasSettingsBtn) { allOk = false; console.log('  !! header still has settingsBtn'); }
      if (idx === 1 && p.powerRowCount !== 5) { allOk = false; console.log('  !! powerRow count != 5 on launch page'); }
      if (p.pageTitle.indexOf(idx === 0 ? '监控' : '启动') < 0) { allOk = false; console.log('  !! wrong pageTitle'); }
      if (!p.addFavVisible || !p.addFavVisible.visible) { allOk = false; console.log('  !! addFav not visible'); }
      if (idx === 0 && p.lunTagVisible && p.lunTagVisible.h < 8) { allOk = false; console.log('  !! lun-tag too short (clipped)'); }
    }
  }

  console.log('\n==== SUMMARY: ' + (allOk ? 'ALL CHECKS PASS' : 'SOME CHECKS FAILED') + ' ====');
  ws.close();
  child.kill();
  process.exit(allOk ? 0 : 1);
}

main().catch((e) => { console.error('diag failed:', e.message); process.exit(1); });