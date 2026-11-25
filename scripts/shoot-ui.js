'use strict';
/**
 * UI 优化计划预览截图（开发期辅助脚本，不属于面板运行时）
 *
 * 用 Edge 无头模式 + CDP，按《UI改动优化计划.md》的 5 个改动点各抓对应画面：
 *   monitor-portrait / monitor-landscape  监控页横竖屏比例（2×2 大卡 / 扁平横幅）
 *   alert-portrait   / alert-landscape    THERMAL ALERT（给 CPU、GPU 卡挂 .hot 复现，真实数据没超温）
 *   launch-portrait  / launch-landscape   启动页（38:62 两栏、4~5 列、EQ 跳动柱、战术封面占位）
 *   hex-landscape                         应用图标缺失 → 六边形蜂巢代号（用 Fetch 拦截图标请求制造真实加载失败）
 *   touch-hotzones                        触控热区可视化（把 ≥44×44 的外延区域描出来）
 *
 * 用法：node scripts/shoot-ui.js [输出目录]   （面板服务需已在 5000 端口运行）
 */
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const http = require('http');
const WebSocket = require('ws');

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const PORT = 9334;
const URL = 'http://127.0.0.1:5000/';
const OUT = path.resolve(process.argv[2] || path.join(__dirname, '..', 'preview', 'ui-optimized'));
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
  const r = await cdp.send('Page.captureScreenshot', { format: 'jpeg', quality: 90 });
  const file = path.join(OUT, name + '.jpg');
  fs.writeFileSync(file, Buffer.from(r.data, 'base64'));
  console.log('✓ ' + path.basename(file));
  return file;
}

const clickPage = (cdp, i) =>
  cdp.evaluate(`(function(){var b=document.querySelectorAll('.page-switch button')[${i}];if(b)b.click();return true;})()`);

async function main() {
  fs.mkdirSync(OUT, { recursive: true });
  const profile = path.join(require('os').tmpdir(), 'nerv-ui-profile-' + Date.now());
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

  /* 图标拦截：failIcons=true 时，奇数序号的应用图标请求直接 404，走真实的 onerror → 六边形降级路径 */
  let failIcons = false, iconSeq = 0;
  await cdp.send('Fetch.enable', { patterns: [{ urlPattern: '*/api/apps/*/icon*', requestStage: 'Request' }] });
  cdp.on((msg) => {
    if (msg.method !== 'Fetch.requestPaused') return;
    const id = msg.params.requestId;
    if (failIcons && iconSeq++ % 2 === 0) {
      cdp.send('Fetch.fulfillRequest', { requestId: id, responseCode: 404, body: '' }).catch(() => {});
    } else {
      cdp.send('Fetch.continueRequest', { requestId: id }).catch(() => {});
    }
  });

  const views = [
    { slug: 'portrait', width: 800, height: 1280 },
    { slug: 'landscape', width: 1280, height: 800 }
  ];
  const files = [];

  for (const v of views) {
    await cdp.send('Emulation.setDeviceMetricsOverride', { width: v.width, height: v.height, deviceScaleFactor: SCALE, mobile: true });
    await cdp.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'no-preference' }] });
    failIcons = false;
    await cdp.send('Page.navigate', { url: URL });
    await sleep(6500); // 等开机动画自己退场

    /* 1) 监控页（真实数据） */
    await clickPage(cdp, 0);
    await sleep(2200);
    files.push(await shot(cdp, 'monitor-' + v.slug));

    /* 2) THERMAL ALERT：给 CPU / GPU 卡挂 .hot（真实触发条件见 app.js renderMetrics：温度≥80°C 或负载≥92%） */
    await cdp.evaluate(`document.getElementById('stCpu').classList.add('hot');document.getElementById('stGpu').classList.add('hot');true`);
    await sleep(700);
    files.push(await shot(cdp, 'alert-' + v.slug));
    await cdp.evaluate(`document.getElementById('stCpu').classList.remove('hot');document.getElementById('stGpu').classList.remove('hot');true`);

    /* 3) 启动页：音乐卡（真实状态 + 模拟播放态各一张）、常用软件区 */
    await clickPage(cdp, 1);
    await sleep(1600);
    files.push(await shot(cdp, 'launch-idle-' + v.slug));
    await cdp.evaluate(`document.getElementById('eqBars').classList.add('on');var c=document.getElementById('mediaCover');c.classList.add('playing');document.getElementById('mcBadge').textContent='[ AUDIO STREAM ACTIVE ]';true`);
    await sleep(900);
    files.push(await shot(cdp, 'launch-playing-' + v.slug));
    await cdp.evaluate(`document.getElementById('eqBars').classList.remove('on');document.getElementById('mediaCover').classList.remove('playing');document.getElementById('mcBadge').textContent='[ AUDIO STREAM STANDBY ]';true`);
  }

  /* 4) 六边形蜂巢代号：拦截一半图标请求使其真实加载失败，再用搜索把应用网格撑出来 */
  for (const v of views) {
    await cdp.send('Emulation.setDeviceMetricsOverride', { width: v.width, height: v.height, deviceScaleFactor: SCALE, mobile: true });
    failIcons = true; iconSeq = 0;
    await cdp.send('Page.navigate', { url: URL });
    await sleep(6500);
    await clickPage(cdp, 1);
    await sleep(1200);
    await cdp.evaluate(`(function(){var i=document.getElementById('appSearch');i.value='e';i.dispatchEvent(new Event('input',{bubbles:true}));return true;})()`);
    await sleep(2500);
    files.push(await shot(cdp, 'hex-' + v.slug));
  }
  failIcons = false;

  /* 5) 触控热区：把 .more / .star 的伪元素外延区域用虚线描出来，证明 ≥44×44 */
  await cdp.send('Emulation.setDeviceMetricsOverride', { width: 800, height: 1280, deviceScaleFactor: SCALE, mobile: true });
  await cdp.send('Page.navigate', { url: URL });
  await sleep(6500);
  await clickPage(cdp, 0);
  await sleep(1500);
  const hot = await cdp.evaluate(`(function(){
    var out=[];document.querySelectorAll('.clickable .more').forEach(function(m){
      var r=m.getBoundingClientRect();
      var w=r.width+20,h=r.height+32; /* 与 CSS：inset:-16px -10px 一致 */
      out.push({w:Math.round(w),h:Math.round(h)});
      var d=document.createElement('div');
      d.style.cssText='position:fixed;z-index:9999;pointer-events:none;border:1.5px dashed #39c2d7;background:rgba(57,194,215,.12);left:'+(r.left-10)+'px;top:'+(r.top-16)+'px;width:'+w+'px;height:'+h+'px';
      document.body.appendChild(d);
    });return out;})()`);
  console.log('「详情 ›」外延热区尺寸(px)：', JSON.stringify(hot));
  await sleep(300);
  files.push(await shot(cdp, 'touch-hotzones'));

  ws.close();
  child.kill();
  await sleep(300);
  console.log('\n共 ' + files.length + ' 张，输出目录：' + OUT);
}

main().catch((err) => { console.error('截图失败：', err && err.message ? err.message : err); process.exit(1); });
