'use strict';
/**
 * 预览截图脚本（仅开发期辅助工具，不属于面板运行时）
 *
 * 用 Edge 无头模式 + CDP 抓取 2 个页面在横屏 / 竖屏下的截图，
 * 并额外抓详情层、挑选层、开机动画各一张，方便逐项核对视觉。
 *
 * 翻页靠点击右上角切换按钮（原型与成品都是 .page-switch button），
 * 详情层靠点击 [data-detail]，挑选层靠点击「添加常用」。
 *
 * 用法：node scripts/shoot.js [输出目录]
 */

const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const http = require('http');
const WebSocket = require('ws');

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const PORT = 9333;
const URL = 'http://127.0.0.1:5000/';
const OUT = path.resolve(process.argv[2] || path.join(__dirname, '..', 'preview'));
const SCALE = 2; // deviceScaleFactor：模拟平板的高 DPI

/* 2 页：[监控] [启动]，监控是第一页（默认打开） */
const PAGES = [
  { index: 0, slug: 'monitor', name: '监控' },
  { index: 1, slug: 'launch', name: '启动' }
];

const VIEWS = [
  { slug: 'portrait', name: '竖屏', width: 800, height: 1280 }, // 1600×2560 @2x
  { slug: 'landscape', name: '横屏', width: 1280, height: 800 } // 2560×1600 @2x
];

/* 详情层样本：8 类里挑 4 个有代表性的（时间/天气/CPU/磁盘） */
const DETAILS = ['time', 'weather', 'cpu', 'disk'];

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

async function shot(cdp, name) {
  const r = await cdp.send('Page.captureScreenshot', { format: 'jpeg', quality: 88 });
  const file = path.join(OUT, name + '.jpg');
  fs.writeFileSync(file, Buffer.from(r.data, 'base64'));
  console.log('✓ ' + path.basename(file));
  return file;
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
    await cdp.send('Emulation.setEmulatedMedia', {
      features: [{ name: 'prefers-reduced-motion', value: 'no-preference' }]
    });

    await cdp.send('Page.navigate', { url: URL });
    /* 开机动画 3–5 秒，2.6 秒时正好处在表决中段（三台印章还没全承認） */
    await sleep(2600);
    files.push(await shot(cdp, 'boot-' + view.slug));

    /* 等动画自己上滑退场，再进面板 */
    await sleep(3200);

    for (const page of PAGES) {
      await cdp.evaluate(
        `(function(){var b=document.querySelectorAll('.page-switch button')[${page.index}];if(b)b.click();return true;})()`
      );
      await sleep(1500); // 翻页 0.58s + 数据渲染
      files.push(await shot(cdp, page.slug + '-' + view.slug));
    }

    /* 详情层：回监控页逐个打开 */
    if (view.slug === 'portrait') {
      await cdp.evaluate(`(function(){var b=document.querySelectorAll('.page-switch button')[0];if(b)b.click();return true;})()`);
      await sleep(900);
      for (const key of DETAILS) {
        await cdp.evaluate(
          `(function(){var el=document.querySelector('[data-detail="${key}"]');if(el)el.click();return true;})()`
        );
        await sleep(1300);
        files.push(await shot(cdp, 'detail-' + key));
        await cdp.evaluate(`(function(){var b=document.getElementById('detailClose');if(b)b.click();return true;})()`);
        await sleep(500);
      }
      /* 挑选层 */
      await cdp.evaluate(`(function(){var b=document.querySelectorAll('.page-switch button')[1];if(b)b.click();return true;})()`);
      await sleep(900);
      await cdp.evaluate(`(function(){var b=document.getElementById('addFavBtn');if(b)b.click();return true;})()`);
      await sleep(2200);
      files.push(await shot(cdp, 'pick-' + view.slug));
      await cdp.evaluate(`(function(){var b=document.getElementById('pickClose');if(b)b.click();return true;})()`);
      await sleep(400);
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
