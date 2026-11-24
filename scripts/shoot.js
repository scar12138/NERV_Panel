'use strict';
/**
 * 预览截图脚本（仅开发期辅助工具，不属于面板运行时）
 *
 * 用 Edge 无头模式 + CDP 抓取 4 个页面在横屏 / 竖屏下的截图。
 * 不修改任何面板代码：翻页靠点击底部导航按钮，开机动画靠调用页面已暴露的
 * window.__bootDismiss()。
 *
 * 用法：node scripts/shoot.js [输出目录]
 */

const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const http = require('http');
const WebSocket = require('ws');

const EDGE =
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const PORT = 9333;
const URL = 'http://127.0.0.1:5000/';
const OUT = path.resolve(process.argv[2] || path.join(__dirname, '..', 'preview'));
const SCALE = 2; // deviceScaleFactor：模拟平板的高 DPI

const PAGES = [
  { index: 0, slug: 'launch', name: '启动' },
  { index: 1, slug: 'overview', name: '总览' },
  { index: 2, slug: 'monitor', name: '硬件监控' },
  { index: 3, slug: 'system', name: '系统' }
];

const VIEWS = [
  { slug: 'portrait', name: '竖屏', width: 800, height: 1280 }, // 1600×2560 @2x
  { slug: 'landscape', name: '横屏', width: 1280, height: 800 } // 2560×1600 @2x
];

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function httpJson(urlPath) {
  return new Promise((resolve, reject) => {
    http
      .get({ host: '127.0.0.1', port: PORT, path: urlPath }, (res) => {
        let buf = '';
        res.on('data', (d) => (buf += d));
        res.on('end', () => {
          try {
            resolve(JSON.parse(buf));
          } catch (err) {
            reject(err);
          }
        });
      })
      .on('error', reject);
  });
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
    const r = await this.send('Runtime.evaluate', {
      expression: expr,
      returnByValue: true,
      awaitPromise: true
    });
    if (r.exceptionDetails) throw new Error(JSON.stringify(r.exceptionDetails));
    return r.result && r.result.value;
  }
}

async function main() {
  fs.mkdirSync(OUT, { recursive: true });

  const profile = path.join(require('os').tmpdir(), 'nerv-shot-profile-' + Date.now());
  const child = spawn(
    EDGE,
    [
      '--headless=new',
      '--disable-gpu',
      '--hide-scrollbars',
      '--no-first-run',
      '--no-default-browser-check',
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
    } catch (err) {
      /* 还没起来 */
    }
  }
  if (!target) {
    child.kill();
    throw new Error('无法连接 Edge 调试端口');
  }

  const ws = new WebSocket(target.webSocketDebuggerUrl, { perMessageDeflate: false });
  await new Promise((res, rej) => {
    ws.once('open', res);
    ws.once('error', rej);
  });
  const cdp = new CDP(ws);

  await cdp.send('Page.enable');
  await cdp.send('Runtime.enable');
  await cdp.send('Network.enable');

  const files = [];

  for (const view of VIEWS) {
    await cdp.send('Emulation.setDeviceMetricsOverride', {
      width: view.width,
      height: view.height,
      deviceScaleFactor: SCALE,
      mobile: true
    });
    // 120Hz 平板的刷新率提示，浏览器据此调整动画节奏
    await cdp.send('Emulation.setEmulatedMedia', {
      features: [{ name: 'prefers-reduced-motion', value: 'no-preference' }]
    });

    await cdp.send('Page.navigate', { url: URL });
    await sleep(2600); // 等字体、首帧、开机动画起播

    // 先截一张开机动画（只在竖屏 + 横屏各一张，作为 6.2 的视觉记录）
    const bootShot = await cdp.send('Page.captureScreenshot', {
      format: 'jpeg',
      quality: 88
    });
    const bootFile = path.join(OUT, `boot-${view.slug}.jpg`);
    fs.writeFileSync(bootFile, Buffer.from(bootShot.data, 'base64'));
    files.push(bootFile);

    // 关掉开机动画，进入面板
    await cdp.evaluate('window.__bootDismiss && window.__bootDismiss()');
    await sleep(1100);

    for (const page of PAGES) {
      await cdp.evaluate(
        `(function(){var b=document.querySelectorAll('nav.dock button')[${page.index}];if(b)b.click();return true;})()`
      );
      // 等翻页动画（0.58s）+ 数据渲染
      await sleep(1500);
      const shot = await cdp.send('Page.captureScreenshot', {
        format: 'jpeg',
        quality: 88
      });
      const file = path.join(OUT, `${page.slug}-${view.slug}.jpg`);
      fs.writeFileSync(file, Buffer.from(shot.data, 'base64'));
      files.push(file);
      console.log('✓ ' + path.basename(file));
    }
  }

  ws.close();
  child.kill();
  await sleep(400);

  console.log('\n共 ' + files.length + ' 张，输出目录：' + OUT);
}

main().catch((err) => {
  console.error('截图失败：', err && err.message ? err.message : err);
  process.exit(1);
});
