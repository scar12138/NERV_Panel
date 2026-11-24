'use strict';
/**
 * 诊断脚本（开发期辅助，非面板运行时）
 * 用无头 Edge 打开面板，打印主视觉图片的加载状态。
 */

const { spawn } = require('child_process');
const http = require('http');
const path = require('path');
const WebSocket = require('ws');

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const PORT = 9334;

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}
function httpJson(p) {
  return new Promise((resolve, reject) => {
    http
      .get({ host: '127.0.0.1', port: PORT, path: p }, (res) => {
        let b = '';
        res.on('data', (d) => (b += d));
        res.on('end', () => {
          try {
            resolve(JSON.parse(b));
          } catch (e) {
            reject(e);
          }
        });
      })
      .on('error', reject);
  });
}

async function main() {
  const profile = path.join(require('os').tmpdir(), 'nerv-diag-' + Date.now());
  const child = spawn(
    EDGE,
    [
      '--headless=new',
      '--disable-gpu',
      '--no-first-run',
      '--user-data-dir=' + profile,
      '--remote-debugging-port=' + PORT,
      'about:blank'
    ],
    { stdio: 'ignore' }
  );

  let target = null;
  for (let i = 0; i < 40; i++) {
    await sleep(250);
    try {
      const list = await httpJson('/json/list');
      target = list.find((t) => t.type === 'page');
      if (target) break;
    } catch (e) {
      /* wait */
    }
  }
  const ws = new WebSocket(target.webSocketDebuggerUrl, { perMessageDeflate: false });
  await new Promise((res, rej) => {
    ws.once('open', res);
    ws.once('error', rej);
  });

  let id = 0;
  const pending = new Map();
  ws.on('message', (raw) => {
    const m = JSON.parse(raw);
    if (m.id && pending.has(m.id)) {
      const { resolve, reject } = pending.get(m.id);
      pending.delete(m.id);
      if (m.error) reject(new Error(JSON.stringify(m.error)));
      else resolve(m.result);
    }
  });
  const send = (method, params) =>
    new Promise((resolve, reject) => {
      const mid = ++id;
      pending.set(mid, { resolve, reject });
      ws.send(JSON.stringify({ id: mid, method, params: params || {} }));
      setTimeout(() => {
        if (pending.has(mid)) {
          pending.delete(mid);
          reject(new Error('timeout ' + method));
        }
      }, 20000);
    });
  const evaluate = async (expr) => {
    const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
    if (r.exceptionDetails) return { error: JSON.stringify(r.exceptionDetails) };
    return r.result.value;
  };

  await send('Page.enable');
  await send('Runtime.enable');
  await send('Emulation.setDeviceMetricsOverride', { width: 800, height: 1280, deviceScaleFactor: 2, mobile: true });
  await send('Page.navigate', { url: 'http://127.0.0.1:5000/' });
  await sleep(3500);
  await evaluate('window.__bootDismiss && window.__bootDismiss()');
  await sleep(1500);

  const info = await evaluate(`(function(){
    var img=document.getElementById('heroImg');
    var fb=document.getElementById('heroFallback');
    return {
      src: img.getAttribute('src'),
      currentSrc: img.currentSrc,
      complete: img.complete,
      naturalWidth: img.naturalWidth,
      naturalHeight: img.naturalHeight,
      display: getComputedStyle(img).display,
      opacity: getComputedStyle(img).opacity,
      visibility: getComputedStyle(img).visibility,
      rect: (function(r){return {w:r.width,h:r.height};})(img.getBoundingClientRect()),
      fbHidden: fb.hidden,
      fbDisplay: getComputedStyle(fb).display
    };
  })()`);
  console.log('HERO:', JSON.stringify(info, null, 2));

  ws.close();
  child.kill();
}

main().catch((e) => {
  console.error('FAIL', e && e.message);
  process.exit(1);
});
