'use strict';
/**
 * 本轮修改的验收截图（开发期脚本，不属于面板运行时）
 *
 * 覆盖用户本轮提出的、肉眼可验证的改动点：
 *   fix-monitor-landscape  横屏监控页：右侧日历 7 行（表头 + 6 周）必须完整可见
 *   fix-monitor-portrait   竖屏监控页：同步率与时间分两行，不再重叠
 *   fix-weather-landscape  天气详情（横屏）：当日逐小时曲线 + 7 日温度变化曲线
 *   fix-weather-portrait   天气详情（竖屏）：同上，验证窄屏下曲线不挤
 *
 * 用法：node scripts/shoot-fixes.js [输出目录]   （面板服务需已在 5000 端口运行）
 */
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const http = require('http');
const WebSocket = require('ws');

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const PORT = 9335;
const URL = 'http://127.0.0.1:5000/';
const OUT = path.resolve(process.argv[2] || path.join(__dirname, '..', 'preview', 'fixes'));
const SCALE = 1.5;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function httpJson(p) {
  return new Promise((resolve, reject) => {
    http
      .get({ host: '127.0.0.1', port: PORT, path: p }, (res) => {
        let b = '';
        res.on('data', (d) => (b += d));
        res.on('end', () => { try { resolve(JSON.parse(b)); } catch (e) { reject(e); } });
      })
      .on('error', reject);
  });
}

class CDP {
  constructor(ws) {
    this.ws = ws; this.id = 0; this.pending = new Map(); this.handlers = [];
    ws.on('message', (raw) => {
      const msg = JSON.parse(raw);
      if (msg.id && this.pending.has(msg.id)) {
        const { resolve, reject } = this.pending.get(msg.id);
        this.pending.delete(msg.id);
        msg.error ? reject(new Error(JSON.stringify(msg.error))) : resolve(msg.result);
      } else if (msg.method) {
        this.handlers.forEach((h) => h(msg));
      }
    });
  }
  on(h) { this.handlers.push(h); }
  send(method, params) {
    const id = ++this.id;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.ws.send(JSON.stringify({ id, method, params: params || {} }));
      setTimeout(() => { if (this.pending.has(id)) { this.pending.delete(id); reject(new Error('CDP 超时：' + method)); } }, 20000);
    });
  }
  async evaluate(expr) {
    const r = await this.send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
    if (r.exceptionDetails) throw new Error(JSON.stringify(r.exceptionDetails));
    return r.result && r.result.value;
  }
}

async function shot(cdp, name) {
  const r = await cdp.send('Page.captureScreenshot', { format: 'jpeg', quality: 92 });
  const file = path.join(OUT, name + '.jpg');
  fs.writeFileSync(file, Buffer.from(r.data, 'base64'));
  console.log('✓ ' + path.basename(file));
  return file;
}

/** 日历完整性自检：最后一行日期必须完整落在 .cal-card 可视范围内。
 *  默认只测当月（可能是 5 行），6 周月份（如 2026-08）才是真会溢出的场景，
 *  所以先补一行 7 个格子把网格强行撑到 6 行再量，两种月份都能覆盖。 */
const CAL_PROBE = `(function(){
  var card=document.querySelector('.cal-card'), grid=document.getElementById('calGrid');
  if(!card||!grid) return {error:'no cal'};
  var rows0=grid.querySelectorAll('.day').length;
  /* 撑满 6 行：日历最多的月份是 6 周，补 7 个 .dim 占位格子就能复现最坏情况 */
  var probe=[];
  for(var i=0;i<7;i++){var d=document.createElement('div');d.className='day dim';d.textContent='1';grid.appendChild(d);probe.push(d);}
  var cr=card.getBoundingClientRect(), rows=[];
  var cells=grid.querySelectorAll('.day');
  for(var j=0;j<cells.length;j++){
    var r=cells[j].getBoundingClientRect();
    if(r.height<=0) continue;
    rows.push({t:Math.round(r.top),b:Math.round(r.bottom)});
  }
  var lastTop=Math.max.apply(null,rows.map(function(x){return x.t;}));
  var lastRow=rows.filter(function(x){return x.t>=lastTop-2;});
  var lastBottom=Math.max.apply(null,lastRow.map(function(x){return x.b;}));
  var out={
    cardTop:Math.round(cr.top), cardBottom:Math.round(cr.bottom),
    lastRowBottom:lastBottom,
    visible: lastBottom <= cr.bottom + 0.5,
    overflowPx: Math.max(0, Math.round(lastBottom-cr.bottom)),
    forcedSixRows: true,
    dayCount: rows0
  };
  probe.forEach(function(d){grid.removeChild(d);});
  return out;
})()`;

/** 同步率/时钟重叠自检：两个矩形不能相交 */
const SYNC_PROBE = `(function(){
  var s=document.querySelector('.syncbox'), c=document.querySelector('.hv-in .clock'), d=document.querySelector('.hv-in .dateline');
  if(!s||!c) return {error:'no el'};
  var a=s.getBoundingClientRect(), b=c.getBoundingClientRect(), e=d?d.getBoundingClientRect():null;
  var overlap=!(a.right<=b.left||b.right<=a.left||a.bottom<=b.top||b.bottom<=a.top);
  return {
    sync:{x:Math.round(a.left),y:Math.round(a.top),w:Math.round(a.width),h:Math.round(a.height)},
    clock:{x:Math.round(b.left),y:Math.round(b.top),w:Math.round(b.width),h:Math.round(b.height)},
    overlapClock:overlap,
    overlapDate: e ? !(a.right<=e.left||e.right<=a.left||a.bottom<=e.top||e.bottom<=a.top) : null
  };
})()`;

async function main() {
  fs.mkdirSync(OUT, { recursive: true });
  const profile = path.join(require('os').tmpdir(), 'nerv-fix-profile-' + Date.now());
  const child = spawn(EDGE, [
    '--headless=new', '--disable-gpu', '--hide-scrollbars', '--no-first-run', '--no-default-browser-check',
    '--user-data-dir=' + profile, '--remote-debugging-port=' + PORT, 'about:blank'
  ], { stdio: 'ignore' });

  let target = null;
  for (let i = 0; i < 40 && !target; i++) {
    await sleep(250);
    try { target = (await httpJson('/json/list')).find((t) => t.type === 'page'); } catch (e) { /* 还没起来 */ }
  }
  if (!target) { child.kill(); throw new Error('无法连接 Edge 调试端口'); }

  const ws = new WebSocket(target.webSocketDebuggerUrl, { perMessageDeflate: false });
  await new Promise((res, rej) => { ws.once('open', res); ws.once('error', rej); });
  const cdp = new CDP(ws);
  await cdp.send('Page.enable');
  await cdp.send('Runtime.enable');

  const views = [
    { slug: 'landscape', width: 1280, height: 800 },
    { slug: 'portrait', width: 800, height: 1280 }
  ];
  const files = [];

  for (const v of views) {
    await cdp.send('Emulation.setDeviceMetricsOverride', { width: v.width, height: v.height, deviceScaleFactor: SCALE, mobile: true });
    await cdp.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'no-preference' }] });
    await cdp.send('Page.navigate', { url: URL });
    await sleep(7000); /* 等开机动画退场 + 天气首帧到位 */

    /* 监控页 */
    const cal = await cdp.evaluate(CAL_PROBE);
    const sync = await cdp.evaluate(SYNC_PROBE);
    console.log('[' + v.slug + '] 日历：' + JSON.stringify(cal));
    console.log('[' + v.slug + '] 同步率：' + JSON.stringify(sync));
    files.push(await shot(cdp, 'fix-monitor-' + v.slug));

    /* 天气详情：点开 .weather 主卡 */
    await cdp.evaluate(`(function(){var el=document.querySelector('.weather.clickable');if(el){el.click();return true;}return false;})()`);
    await sleep(1600);
    const chart = await cdp.evaluate(`(function(){
      var w=document.getElementById('wxWeekChart'), h=document.getElementById('wxHourChart');
      var rows=document.querySelectorAll('#detailBody .d-row').length;
      return {weekChart:!!w, weekH:w?Math.round(w.getBoundingClientRect().height):0,
              hourChart:!!h, hourH:h?Math.round(h.getBoundingClientRect().height):0, dayRows:rows};
    })()`);
    console.log('[' + v.slug + '] 天气详情：' + JSON.stringify(chart));
    files.push(await shot(cdp, 'fix-weather-' + v.slug));
    await cdp.evaluate(`(function(){var b=document.getElementById('detailClose');if(b)b.click();return true;})()`);
    await sleep(700);
  }

  ws.close();
  child.kill();
  await sleep(300);
  console.log('\n共 ' + files.length + ' 张，输出目录：' + OUT);
}

main().catch((err) => { console.error('截图失败：', err && err.message ? err.message : err); process.exit(1); });
