'use strict';
/*
 * 离线告警悬浮条验收（需求：告警信息调到顶部）
 *
 * 验三件事：
 *  1. 位置：告警条在监控页顶部（顶栏下面、主内容上面），不是原来页面最底部。
 *  2. 不占位：显示 / 隐藏前后，.mon-top、.hw-row、hero、wx-cal 的矩形完全一致，
 *     页面不出现滚动、硬件卡不被往下顶。
 *  3. 显隐：断开时出现、恢复后自动消失；横屏竖屏都要过。
 *
 * 用法：node scripts/verify-offline-banner.js
 * 依赖：本机 http://127.0.0.1:5000 有 NERV Panel 服务，Edge 已安装。
 */
const { spawn } = require('child_process');
const http = require('http');
const os = require('os');
const path = require('path');
const WebSocket = require('ws');

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const PORT = 9344;
const BASE = process.env.NERV_VERIFY_URL || 'http://127.0.0.1:5000/';
const VIEWS = [
  { slug: 'landscape', width: 1280, height: 800 },
  { slug: 'portrait', width: 800, height: 1280 }
];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function httpJson(p) {
  return new Promise((resolve, reject) => {
    http.get({ host: '127.0.0.1', port: PORT, path: p }, (res) => {
      let b = '';
      res.on('data', (d) => (b += d));
      res.on('end', () => { try { resolve(JSON.parse(b)); } catch (e) { reject(e); } });
    }).on('error', reject);
  });
}

class CDP {
  constructor(ws) {
    this.ws = ws; this.id = 0; this.pending = new Map();
    ws.on('message', (raw) => {
      const m = JSON.parse(raw);
      if (m.id && this.pending.has(m.id)) {
        const { resolve, reject } = this.pending.get(m.id);
        this.pending.delete(m.id);
        m.error ? reject(new Error(JSON.stringify(m.error))) : resolve(m.result);
      }
    });
  }
  send(method, params) {
    const id = ++this.id;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.ws.send(JSON.stringify({ id, method, params: params || {} }));
      setTimeout(() => { if (this.pending.has(id)) { this.pending.delete(id); reject(new Error('timeout ' + method)); } }, 20000);
    });
  }
  async ev(expr) {
    const r = await this.send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
    if (r.exceptionDetails) throw new Error(JSON.stringify(r.exceptionDetails));
    return r.result && r.result.value;
  }
}

/* 页面内测量：返回各块矩形 + 告警条矩形 + 位置关系
   注意：状态切换与测量必须在同一次 evaluate 里完成 —— WS 每 1s 推一帧会把状态改回
   online，分两次调用会被插进来的在线帧抹掉。
   量之前先关掉出现动画，否则 translateY 的半途值会让 y 偏几像素。 */
const MEASURE = `(function(){
  function R(el){ if(!el) return null; var r=el.getBoundingClientRect();
    return {x:Math.round(r.left),y:Math.round(r.top),w:Math.round(r.width),h:Math.round(r.height),
            bottom:Math.round(r.bottom),right:Math.round(r.right)}; }
  function hit(a,b){ if(!a||!b) return false;
    return !(a.right<=b.x || b.right<=a.x || a.bottom<=b.y || b.bottom<=a.y); }
  var banner=document.getElementById('monOffline');
  if(banner && !banner.hidden) banner.style.animation='none';
  var monTop=document.querySelector('.mon-in .mon-top');
  var hw=document.getElementById('hwRow');
  var hero=document.querySelector('.mon-in .hero-visual');
  var wxcal=document.querySelector('.mon-in .wx-cal');
  var pageIn=document.querySelector('.mon-in');
  var page=document.querySelector('.page-monitor');
  var head=document.querySelector('header.top');
  var phead=document.querySelector('.pager-head');
  var title=document.querySelector('.pager-head h2');
  var dots=document.getElementById('dots');
  var br=R(banner), hd=R(head), mt=R(monTop), ti=R(title), dt=R(dots);
  var shown=!!(banner && !banner.hidden && br && br.h>0);
  return {
    bannerShown: shown,
    bannerParent: banner ? (banner.parentElement && banner.parentElement.className) : null,
    bannerStyle: banner ? (getComputedStyle(banner).position + '/' + getComputedStyle(banner).pointerEvents) : null,
    banner: br,
    monTop: mt, hw: R(hw), hero: R(hero), wxcal: R(wxcal),
    pageIn: R(pageIn), page: R(page), head: hd, pagerHead: R(phead),
    title: ti, dots: dt,
    pageScrollH: page ? page.scrollHeight : 0,
    pageClientH: page ? page.clientHeight : 0,
    pageOverflow: page ? page.scrollHeight - page.clientHeight : 0,
    bodyOverflow: document.documentElement.scrollHeight - document.documentElement.clientHeight,
    belowHeader: !!(shown && br && hd && br.y >= hd.bottom - 1),
    aboveContent: !!(shown && br && mt && br.bottom <= mt.y),
    clearOfTitle: !(shown && hit(br, ti)),
    clearOfDots: !(shown && hit(br, dt)),
    clearOfHero: !(shown && hit(br, R(hero))),
    clearOfWeather: !(shown && hit(br, R(wxcal)))
  };
})()`;

/* 先切状态再测量，返回同一帧内的结果 */
function measureWith(cdp, state) {
  return cdp.ev(`(function(){ window.NERV_DEBUG.setConnUI(${JSON.stringify(state)}); return ${MEASURE}; })()`);
}

(async () => {
  const profile = path.join(os.tmpdir(), 'nerv-ob-' + Date.now());
  const child = spawn(EDGE, [
    '--headless=new', '--disable-gpu', '--hide-scrollbars', '--no-first-run',
    '--no-default-browser-check', '--user-data-dir=' + profile,
    '--remote-debugging-port=' + PORT, 'about:blank'
  ], { stdio: 'ignore' });

  let target = null;
  for (let i = 0; i < 40 && !target; i++) {
    await sleep(250);
    try { target = (await httpJson('/json/list')).find((t) => t.type === 'page'); } catch (e) { /* retry */ }
  }
  if (!target) { child.kill(); throw new Error('Edge 远程调试端口没起来'); }

  const ws = new WebSocket(target.webSocketDebuggerUrl, { perMessageDeflate: false });
  await new Promise((res, rej) => { ws.once('open', res); ws.once('error', rej); });
  const cdp = new CDP(ws);
  await cdp.send('Page.enable');
  await cdp.send('Runtime.enable');

  let pass = 0, fail = 0;
  const check = (ok, label, extra) => {
    if (ok) { pass++; console.log('  ✓ ' + label + (extra ? '  ' + JSON.stringify(extra) : '')); }
    else { fail++; console.log('  ✗ ' + label + (extra ? '  ' + JSON.stringify(extra) : '')); }
  };

  for (const v of VIEWS) {
    console.log('\n===== ' + v.slug + ' ' + v.width + 'x' + v.height + ' =====');
    await cdp.send('Emulation.setDeviceMetricsOverride', {
      width: v.width, height: v.height, deviceScaleFactor: 1, mobile: true
    });
    await cdp.send('Page.navigate', { url: BASE });
    await sleep(7000); // 等开机动画退场

    // 确保停在监控页
    await cdp.ev(`(function(){ var b=document.querySelectorAll('.page-switch button'); if(b[0]) b[0].click(); return 1; })()`);
    await sleep(600);

    // --- 基线：在线，告警条应隐藏 ---
    const online = await measureWith(cdp, 'online');
    check(online.bannerShown === false, '在线时告警条隐藏', { bannerShown: online.bannerShown });

    // --- 断开：告警条出现，且不改变任何块的位置 ---
    const offline = await measureWith(cdp, 'offline');
    check(offline.bannerShown === true, '断开时告警条显示', { banner: offline.banner });

    const sameGeom = (a, b) => a && b &&
      a.x === b.x && a.y === b.y && a.w === b.w && a.h === b.h;
    check(sameGeom(online.monTop, offline.monTop), '主图+天气日历区位置未变',
      { online: online.monTop, offline: offline.monTop });
    check(sameGeom(online.hw, offline.hw), '硬件卡行未被往下顶',
      { onlineY: online.hw.y, offlineY: offline.hw.y });
    check(sameGeom(online.hero, offline.hero), '主视觉未被挤压/位移',
      { onlineH: online.hero.h, offlineH: offline.hero.h });
    check(sameGeom(online.wxcal, offline.wxcal), '天气日历列未变',
      { onlineY: online.wxcal.y, offlineY: offline.wxcal.y });
    check(sameGeom(online.pagerHead, offline.pagerHead), '顶部标题行高度未被撑开',
      { onlineH: online.pagerHead.h, offlineH: offline.pagerHead.h });
    check(offline.pageOverflow === 0 && online.pageOverflow === 0,
      '不产生页内滚动（一屏布局不变）',
      { onlineOverflow: online.pageOverflow, offlineOverflow: offline.pageOverflow });
    check(offline.bodyOverflow <= 0, '不产生整页滚动');
    check(offline.belowHeader === true, '告警条在顶栏下面（不是页面底部）', {
      bannerY: offline.banner.y, headerBottom: offline.head.bottom
    });
    check(offline.aboveContent === true, '告警条在主内容上面', {
      bannerBottom: offline.banner.bottom, monTopY: offline.monTop.y
    });
    check(offline.clearOfTitle === true, '不压住页面标题', {
      banner: offline.banner, title: offline.title
    });
    check(offline.clearOfDots === true, '不压住分页圆点', {
      dots: offline.dots
    });
    check(offline.clearOfHero === true, '不压住主图', { hero: offline.hero });
    check(offline.clearOfWeather === true, '不压住天气/日历卡片', { wxcal: offline.wxcal });
    check(offline.bannerStyle === 'absolute/none',
      '绝对定位 + 不拦截点击（pointer-events:none）', { computed: offline.bannerStyle });

    // --- 翻到启动页：告警条不能跟着过去 ---
    await cdp.ev(`(function(){ document.querySelectorAll('.page-switch button')[1].click(); return 1; })()`);
    await sleep(700);
    const onLaunch = await measureWith(cdp, 'offline');
    check(onLaunch.bannerShown === false, '告警条只属于监控页，翻到启动页不显示',
      { bannerShown: onLaunch.bannerShown });
    await cdp.ev(`(function(){ document.querySelectorAll('.page-switch button')[0].click(); return 1; })()`);
    await sleep(700);
    const backMon = await measureWith(cdp, 'offline');
    check(backMon.bannerShown === true, '翻回监控页且仍断线时告警条重新出现');

    // --- 恢复：在线后自动消失 ---
    const back = await measureWith(cdp, 'online');
    check(back.bannerShown === false, '连接恢复后告警条自动消失', { bannerShown: back.bannerShown });
    check(sameGeom(online.monTop, back.monTop) && sameGeom(online.hw, back.hw),
      '恢复后布局与基线完全一致');
  }

  console.log('\n结果：' + pass + ' 通过 / ' + fail + ' 失败');
  ws.close();
  child.kill();
  await sleep(200);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('FAIL', e.message); process.exit(1); });
