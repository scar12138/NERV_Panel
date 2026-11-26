'use strict';
/**
 * 布局诊断脚本（开发期辅助，不属于面板运行时）
 *
 * 逐页检查是否真的「一屏放下、不出现竖向滚动」：
 *   - .page 的 scrollHeight / clientHeight（页面本身 overflow:hidden，若溢出就是被裁掉，必须为 0 溢出）
 *   - .page-in 的 offsetHeight 是否超过容器高度
 *   - 内部滚动容器（.app-scroll）的高度是否 > 0
 *   - 关键按钮是否在视口内可点到
 *
 * 用法：node scripts/diag-flow.js
 */

const { spawn } = require('child_process');
const path = require('path');
const http = require('http');
const WebSocket = require('ws');

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const PORT = 9334;
const URL = process.env.NERV_VERIFY_URL || 'http://127.0.0.1:5000/';
const SCALE = 2;

const VIEWS = [
  { slug: 'portrait', width: 800, height: 1280 },
  { slug: 'landscape', width: 1280, height: 800 }
];

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

class CDP {
  constructor(ws) {
    this.ws = ws;
    this.id = 0;
    this.pending = new Map();
    ws.on('message', (raw) => {
      const msg = JSON.parse(raw);
      if (msg.id && this.pending.has(msg.id)) {
        const { resolve, reject } = this.pending.get(msg.id);
        this.pending.delete(msg.id);
        if (msg.error) reject(new Error(JSON.stringify(msg.error)));
        else resolve(msg.result);
      }
    });
  }
  send(method, params) {
    const id = ++this.id;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.ws.send(JSON.stringify({ id, method, params: params || {} }));
      setTimeout(() => {
        if (this.pending.has(id)) {
          this.pending.delete(id);
          reject(new Error('CDP 超时：' + method));
        }
      }, 20000);
    });
  }
  async evaluate(expr) {
    const r = await this.send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
    if (r.exceptionDetails) throw new Error(JSON.stringify(r.exceptionDetails));
    return r.result && r.result.value;
  }
}

const PROBE = `(function(){
  function box(sel){
    var el=document.querySelector(sel); if(!el) return null;
    var r=el.getBoundingClientRect();
    return {w:Math.round(r.width),h:Math.round(r.height),top:Math.round(r.top),bottom:Math.round(r.bottom)};
  }
  var idx = Array.prototype.indexOf.call(document.querySelectorAll('.page'), document.querySelector('.pager-viewport .page')) ;
  var page = document.querySelectorAll('.page')[0];
  /* .page 元素都在轨道里，取当前显示的（transform 归零的那一页） */
  var track = document.getElementById('pagerTrack');
  if (track) {
    var pages = track.querySelectorAll('.page');
    var rect = pages[0].getBoundingClientRect();
    var vp = document.getElementById('pagerViewport').getBoundingClientRect();
    for (var k = 0; k < pages.length; k++) {
      var rk = pages[k].getBoundingClientRect();
      if (rk.left >= vp.left - 2 && rk.left < vp.left + 2) { page = pages[k]; break; }
    }
  }
  var inner=page.querySelector('.page-in');
  var appScroll=page.querySelector('.app-scroll');
  return {
    title: page.getAttribute('data-title'),
    viewportH: window.innerHeight,
    pageScrollH: page.scrollHeight,
    pageClientH: page.clientHeight,
    pageOverflow: page.scrollHeight - page.clientHeight,
    innerH: inner ? Math.round(inner.getBoundingClientRect().height) : null,
    innerScrollH: inner ? inner.scrollHeight : null,
    innerOverflow: inner ? inner.scrollHeight - Math.round(inner.getBoundingClientRect().height) : null,
    appScroll: appScroll ? {h:Math.round(appScroll.getBoundingClientRect().height), scrollH:appScroll.scrollHeight} : null,
    heroBox: box('.page-on .hero-visual') || box('.hero-visual'),
    hwRow: box('.hw-row'),
    powerRow: box('.power-row'),
    settingsBtn: box('#settingsBtn'),
    lastPwrBottom: (function(){var b=document.querySelectorAll('.power-row .pwr');if(!b.length)return null;var r=b[b.length-1].getBoundingClientRect();return Math.round(r.bottom);})()
  };
})()`;

async function waitForTarget() {
  for (let i = 0; i < 60; i++) {
    const list = await new Promise((resolve, reject) => {
      http
        .get({ host: '127.0.0.1', port: PORT, path: '/json/list' }, (res) => {
          let buf = '';
          res.on('data', (d) => (buf += d));
          res.on('end', () => {
            try {
              resolve(JSON.parse(buf));
            } catch (e) {
              reject(e);
            }
          });
        })
        .on('error', reject);
    }).catch(() => null);
    if (list && list.length) {
      const page = list.find((t) => t.type === 'page');
      if (page) return page;
    }
    await sleep(200);
  }
  throw new Error('无法连接 Edge 调试端口');
}

async function main() {
  const child = spawn(
    EDGE,
    [
      '--headless=new',
      '--disable-gpu',
      '--hide-scrollbars',
      '--no-first-run',
      '--user-data-dir=' + path.join(process.env.TEMP || '.', 'nerv-diag-flow'),
      '--remote-debugging-port=' + PORT,
      'about:blank'
    ],
    { stdio: 'ignore', detached: false }
  );

  const target = await waitForTarget();
  const ws = new WebSocket(target.webSocketDebuggerUrl, { perMessageDeflate: false });
  await new Promise((res, rej) => {
    ws.once('open', res);
    ws.once('error', rej);
  });
  const cdp = new CDP(ws);
  await cdp.send('Page.enable');
  await cdp.send('Runtime.enable');

  for (const view of VIEWS) {
    await cdp.send('Emulation.setDeviceMetricsOverride', {
      width: view.width,
      height: view.height,
      deviceScaleFactor: SCALE,
      mobile: true
    });
    await cdp.send('Page.navigate', { url: URL });
    await sleep(6200); // 等开机动画走完

    for (const idx of [0, 1]) {
      await cdp.evaluate(
        `(function(){var b=document.querySelectorAll('.page-switch button')[${idx}];if(b)b.click();return true;})()`
      );
      await sleep(1200);
      // Headless Edge may throttle animation frames; settle decorative transforms before geometry.
      await cdp.evaluate("document.getAnimations().forEach(function(a){if(a.effect && a.effect.target && a.effect.target.matches('.page-in'))a.finish();});true");
      const info = await cdp.evaluate(PROBE);
      console.log('\n=== ' + view.slug + ' / ' + info.title + ' ===');
      console.log(JSON.stringify(info, null, 2));
    }
  }

  ws.close();
  child.kill();
}

main().catch((e) => {
  console.error('诊断失败：', e && e.message ? e.message : e);
  process.exit(1);
});
