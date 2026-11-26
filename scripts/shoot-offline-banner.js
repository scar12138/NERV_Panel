'use strict';
/*
 * 离线告警悬浮条截图（开发期脚本，不属于面板运行时）
 *
 * 需求「告警信息调到顶部」：告警从监控页底部移到顶部，做成悬浮条，
 * 不占其他空间、不把主图/天气/日历/硬件卡往下顶、断开显示恢复消失。
 *
 * 输出 4 张图到 preview/offline-banner/：
 *   banner-landscape.jpg        横屏 · 在线（告警条隐藏，作为对照，布局应与离线完全一致）
 *   banner-landscape-off.jpg    横屏 · 断开（告警条出现在顶栏下面、主内容上面）
 *   banner-portrait.jpg         竖屏 · 在线
 *   banner-portrait-off.jpg     竖屏 · 断开
 *
 * 用法：node scripts/shoot-offline-banner.js [输出目录]
 * 依赖：本机 http://127.0.0.1:5000 有 NERV Panel 服务，Edge 已安装。
 */
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const http = require('http');
const os = require('os');
const WebSocket = require('ws');

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const PORT = 9345;
const BASE = 'http://127.0.0.1:5000/';
const OUT = path.resolve(process.argv[2] || path.join(__dirname, '..', 'preview', 'offline-banner'));
const SCALE = 1.5;
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

/* 切连接状态：必须在同一次 evaluate 里「关掉入场动画 + 切状态 + 立刻量」，
   因为 WebSocket 每 1 秒推一帧 metrics 会把连接状态改回 online，
   分两次调用中间插进来的在线帧会让告警条又消失。
   返回的几何量也一并带回，省一次往返。 */
async function setState(cdp, state) {
  return cdp.ev(`(function(){
    var b=document.getElementById('monOffline');
    if(b) b.style.animation='none';
    window.NERV_DEBUG.setConnUI(${JSON.stringify(state)});
    if(!b) return null;
    var r=b.getBoundingClientRect();
    var h=document.querySelector('header.top').getBoundingClientRect();
    var m=document.querySelector('.mon-in .mon-top').getBoundingClientRect();
    return { shown: !b.hidden && r.height>0, y: Math.round(r.top), bottom: Math.round(r.bottom),
             headerBottom: Math.round(h.bottom), monTopY: Math.round(m.top),
             w: Math.round(r.width), h: Math.round(r.height) };
  })()`);
}

/* 截图：切状态后立刻抓帧，抓完再核一次状态是否被 WS 在线帧抹掉；被抹就重来。
   这样既不依赖 700ms 的动画等待，也不会因为撞上 1 秒一次的 metrics 帧而拍到错误的画面。 */
async function shoot(cdp, state, file) {
  for (let attempt = 0; attempt < 8; attempt++) {
    const before = await setState(cdp, state);
    const shot = await cdp.send('Page.captureScreenshot', { format: 'jpeg', quality: 90 });
    const after = await cdp.ev(`(function(){ var b=document.getElementById('monOffline');
      return !!b && !b.hidden && b.getBoundingClientRect().height>0; })()`);
    const wantShown = state === 'offline';
    if (after === wantShown) {
      fs.writeFileSync(file, Buffer.from(shot.data, 'base64'));
      return before;
    }
    await sleep(120);
  }
  throw new Error('截图时状态不稳定：' + state);
}

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const profile = path.join(os.tmpdir(), 'nerv-obshot-' + Date.now());
  const child = spawn(EDGE, [
    '--headless=new', '--disable-gpu', '--hide-scrollbars', '--no-first-run',
    '--no-default-browser-check', '--user-data-dir=' + profile,
    '--remote-debugging-port=' + PORT, 'about:blank'
  ], { stdio: 'ignore' });

  let target = null;
  for (let i = 0; i < 40 && !target; i++) {
    await sleep(250);
    try { target = (await httpJson('/json/list')).find((x) => x.type === 'page'); } catch (e) { /* 端口还没起 */ }
  }
  if (!target) { child.kill(); throw new Error('Edge 远程调试端口没起来'); }

  const ws = new WebSocket(target.webSocketDebuggerUrl, { perMessageDeflate: false });
  await new Promise((res, rej) => { ws.once('open', res); ws.once('error', rej); });
  const cdp = new CDP(ws);
  await cdp.send('Page.enable');
  await cdp.send('Runtime.enable');

  for (const v of VIEWS) {
    await cdp.send('Emulation.setDeviceMetricsOverride', {
      width: v.width, height: v.height, deviceScaleFactor: SCALE, mobile: true
    });
    await cdp.send('Page.navigate', { url: BASE });
    await sleep(7000); // 等开机动画退场

    // 确认停在监控页
    await cdp.ev(`(function(){ var b=document.querySelectorAll('.page-switch button'); if(b[0]) b[0].click(); return 1; })()`);
    await sleep(600);

    // 1) 在线：告警条隐藏（对照图）
    await shoot(cdp, 'online', path.join(OUT, 'banner-' + v.slug + '.jpg'));

    // 2) 断开：告警条出现
    const geo = await shoot(cdp, 'offline', path.join(OUT, 'banner-' + v.slug + '-off.jpg'));
    console.log('[' + v.slug + '] 告警条 ' + JSON.stringify(geo));
  }

  console.log('\n输出目录：' + OUT);
  ws.close();
  child.kill();
  await sleep(200);
  process.exit(0);
})().catch((e) => { console.error('FAIL', e.message); process.exit(1); });
