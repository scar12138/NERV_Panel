'use strict';
/* 布局实测（开发期辅助）：用 CDP 量几何尺寸，替代肉眼看图。node scripts/verify-ui.js */
const { spawn } = require('child_process');
const path = require('path');
const http = require('http');
const WebSocket = require('ws');
const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const PORT = 9335, URL = process.env.NERV_VERIFY_URL || 'http://127.0.0.1:5000/';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const getJson = (p) => new Promise((ok, no) => http.get({ host: '127.0.0.1', port: PORT, path: p }, (r) => { let b = ''; r.on('data', (d) => (b += d)); r.on('end', () => { try { ok(JSON.parse(b)); } catch (e) { no(e); } }); }).on('error', no));

(async () => {
  const child = spawn(EDGE, ['--headless=new', '--disable-gpu', '--no-first-run', '--user-data-dir=' + path.join(require('os').tmpdir(), 'nerv-vfy-' + Date.now()), '--remote-debugging-port=' + PORT, 'about:blank'], { stdio: 'ignore' });
  let t = null;
  for (let i = 0; i < 40 && !t; i++) { await sleep(250); try { t = (await getJson('/json/list')).find((x) => x.type === 'page'); } catch (e) {} }
  const ws = new WebSocket(t.webSocketDebuggerUrl, { perMessageDeflate: false });
  await new Promise((r) => ws.once('open', r));
  let id = 0; const pend = new Map();
  ws.on('message', (raw) => { const m = JSON.parse(raw); if (m.id && pend.has(m.id)) { pend.get(m.id)(m); pend.delete(m.id); } });
  const send = (method, params) => new Promise((r) => { const i = ++id; pend.set(i, r); ws.send(JSON.stringify({ id: i, method, params: params || {} })); });
  const ev = async (e) => { const r = await send('Runtime.evaluate', { expression: e, returnByValue: true, awaitPromise: true }); if (r.result.exceptionDetails) throw new Error(JSON.stringify(r.result.exceptionDetails)); return r.result.result.value; };
  const page = (i) => ev(`document.querySelectorAll('.page-switch button')[${i}].click();true`);

  const R = `function R(s){var e=document.querySelector(s);if(!e)return null;var r=e.getBoundingClientRect();return {x:Math.round(r.left),y:Math.round(r.top),w:Math.round(r.width),h:Math.round(r.height),sw:e.scrollWidth,sh:e.scrollHeight,cw:e.clientWidth,ch:e.clientHeight};}`;

  for (const v of [{ n: 'portrait', w: 800, h: 1280 }, { n: 'landscape', w: 1280, h: 800 }]) {
    await send('Page.enable');
    await send('Emulation.setDeviceMetricsOverride', { width: v.w, height: v.h, deviceScaleFactor: 1, mobile: true });
    await send('Page.navigate', { url: URL });
    await sleep(6500);
    console.log('\n===== ' + v.n + ' ' + v.w + 'x' + v.h + ' =====');
    await page(0); await sleep(1800);
    console.log('MONITOR', await ev(`(function(){${R}
      var out={vp:R('.pager-viewport'),hero:R('.hero-visual'),clock:R('.clock'),date:R('.dateline'),wxcal:R('.wx-cal'),hw:R('#hwRow'),
        cpu:R('#stCpu'),gpu:R('#stGpu'),ram:R('[data-detail=ram]'),net:R('#stNet'),disk:R('.stat-disk'),cpuCv:R('#cpuSpark'),fan:R('#stFan')};
      var cards=[].slice.call(document.querySelectorAll('.hw-row .stat')).filter(function(e){return !e.hidden});
      out.cardOverflow=cards.map(function(e){var r=e.getBoundingClientRect(),ch=[].slice.call(e.children).map(function(c){return c.getBoundingClientRect().bottom}).reduce(function(a,b){return Math.max(a,b)},0);return (e.id||e.getAttribute('data-detail')||'x')+':'+(ch>r.bottom+1?'OVERFLOW '+Math.round(ch-r.bottom):'ok')});
      var vp=out.vp;out.heroPct=Math.round(out.hero.h/vp.h*100);out.wxPct=Math.round(out.wxcal.h/vp.h*100);out.hwPct=Math.round(out.hw.h/vp.h*100);
      out.pageScroll=[document.documentElement.scrollHeight,innerHeight];
      return JSON.stringify(out);})()`));
    await page(1); await sleep(1500);
    console.log('LAUNCH', await ev(`(function(){${R}
      var g=R('.launch-grid'),l=R('.music-col'),r=R('.apps-col'),a=document.querySelector('#appGrid'),cols=0;
      var out={grid:g,left:l,right:r,leftPct:Math.round(l.w/(l.w+r.w)*100),power:R('.power-row'),eq:R('#eqBars'),badge:R('#mcBadge'),cover:R('#mediaCover')};
      if(a){var kids=[].slice.call(a.children);if(kids.length){var y0=kids[0].getBoundingClientRect().top;cols=kids.filter(function(k){return Math.abs(k.getBoundingClientRect().top-y0)<3}).length;}}
      out.appCols=cols;out.appCount=a?a.children.length:0;out.gridTemplate=a?getComputedStyle(a).gridTemplateColumns:'';
      return JSON.stringify(out);})()`));
    /* 强制多个应用，测横屏列数 */
    await ev(`(function(){var i=document.getElementById('appSearch');i.value='e';i.dispatchEvent(new Event('input',{bubbles:true}));return true})()`);
    await sleep(2000);
    console.log('SEARCH-GRID', await ev(`(function(){var a=document.querySelector('#searchGrid'),k=[].slice.call(a.children),n=0;if(k.length){var y=k[0].getBoundingClientRect().top;n=k.filter(function(e){return Math.abs(e.getBoundingClientRect().top-y)<3}).length}
      var hex=document.querySelectorAll('#searchGrid .ph-hex').length;var tx=document.querySelector('#searchGrid .ph-hex text');
      var ic=document.querySelector('#searchGrid .ic').getBoundingClientRect();return JSON.stringify({cols:n,count:k.length,hexSvgs:hex,firstGlyph:tx&&tx.textContent,icon:[Math.round(ic.width),Math.round(ic.height)],tpl:getComputedStyle(a).gridTemplateColumns})})()`));
  }

  /* 热区实测：伪元素外延后的可点击尺寸 */
  await send('Emulation.setDeviceMetricsOverride', { width: 800, height: 1280, deviceScaleFactor: 1, mobile: true });
  await send('Page.navigate', { url: URL }); await sleep(6500); await page(0); await sleep(1500);
  console.log('\nHOTZONE', await ev(`(function(){var m=document.querySelector('.clickable .more'),b=getComputedStyle(m,'::before');var r=m.getBoundingClientRect();
    return JSON.stringify({moreBox:[Math.round(r.width),Math.round(r.height)],beforeW:b.width,beforeH:b.height,total:[Math.round(parseFloat(b.width)),Math.round(parseFloat(b.height))]})})()`));
  /* 命中测试：在 more 外延区（超出可见角标 12px）点一下，能否落到 clickable 卡片内 */
  console.log('HITTEST', await ev(`(function(){var m=document.querySelector('.weather .more'),r=m.getBoundingClientRect();var el=document.elementFromPoint(r.left-9,r.top+r.height/2);return JSON.stringify({hit:el&&(el.className||el.tagName),insideCard:!!(el&&el.closest('.clickable'))})})()`));
  /* 星标热区 */
  await page(1); await sleep(1000);
  console.log('STAR', await ev(`(function(){var s=document.querySelector('.star');if(!s)return 'no star rendered (no favorites)';var b=getComputedStyle(s,'::before');var r=s.getBoundingClientRect();return JSON.stringify({visual:[Math.round(r.width),Math.round(r.height)],pseudoInset:b.top+' '+b.left})})()`));
  /* :active 反馈规则是否存在 */
  console.log('RULES', await ev(`(function(){var f=0,hot=0,eq=0;for(var s of document.styleSheets)for(var r of s.cssRules){var t=r.selectorText||'';if(t.indexOf('.clickable:active')>=0)f=r.style.transform;if(t.indexOf('.stat.hot')===0&&r.style.animation)hot=1;if(r.name==='eqJump')eq=1;}return JSON.stringify({clickableActive:f,hotAnim:hot,eqKeyframes:eq})})()`));
  ws.close(); child.kill();
})().catch((e) => { console.error(e); process.exit(1); });
