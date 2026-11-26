'use strict';
/**
 * 启动页（MAGI 表决界面）验收截图（开发期脚本，不属于面板运行时）
 *
 * 输出 preview/boot-fix/：
 *   boot-<view>.jpg        动画进行中（三贤人依次点亮）
 *   boot-<view>-ok.jpg     全票通过态（ALL APPROVED / 全票通过 必须完整可见）
 *
 * 用法：node scripts/shoot-boot.js [输出目录]   （面板服务需已在 5000 端口运行）
 */
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const http = require('http');
const WebSocket = require('ws');

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const PORT = 9338;
const URL = 'http://127.0.0.1:5000/';
const OUT = path.resolve(process.argv[2] || path.join(__dirname, '..', 'preview', 'boot-fix'));
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

/** 量「ALL APPROVED / 全票通过」是否完整落在中央六边形内（六边形的内切矩形更窄，按其算） */
const APPROVE_PROBE = `(function(){
  function rect(el){var r=el.getBoundingClientRect();return {left:r.left,right:r.right,top:r.top,bottom:r.bottom,w:r.width,h:r.height};}
  var core=document.getElementById('voteCore'), ok=document.querySelector('.core-approve');
  if(!core||!ok) return {error:'missing'};
  var c=rect(core), a=rect(ok);
  /* clip-path 六边形：左右各内缩 25% 宽度，上下是完整高度。文字必须落在两条斜边以内 */
  var innerLeft=c.left+c.w*0.25, innerRight=c.right-c.w*0.25;
  return {
    core:{w:Math.round(c.w),h:Math.round(c.h)},
    text:{w:Math.round(a.w),h:Math.round(a.h)},
    insideHexagon: a.left>=innerLeft-0.5 && a.right<=innerRight+0.5 && a.top>=c.top-0.5 && a.bottom<=c.bottom+0.5,
    slackLeft:Math.round((a.left-innerLeft)*10)/10,
    slackRight:Math.round((innerRight-a.right)*10)/10,
    slackTop:Math.round((a.top-c.top)*10)/10,
    slackBottom:Math.round((c.bottom-a.bottom)*10)/10
  };
})()`;

async function main() {
  fs.mkdirSync(OUT, { recursive: true });
  const profile = path.join(require('os').tmpdir(), 'nerv-boot-profile-' + Date.now());
  const child = spawn(EDGE, [
    '--headless=new', '--disable-gpu', '--hide-scrollbars', '--no-first-run', '--no-default-browser-check',
    '--user-data-dir=' + profile, '--remote-debugging-port=' + PORT, 'about:blank'
  ], { stdio: 'ignore' });

  let target = null;
  for (let i = 0; i < 40 && !target; i++) {
    await sleep(250);
    try { target = (await httpJson('/json/list')).find((t) => t.type === 'page'); } catch (e) { /* not up */ }
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

  for (const v of views) {
    await cdp.send('Emulation.setDeviceMetricsOverride', { width: v.width, height: v.height, deviceScaleFactor: SCALE, mobile: true });
    await cdp.send('Page.navigate', { url: URL });
    await sleep(2400); /* 表决序列进行中（第三台尚未点亮） */
    await shot(cdp, 'boot-' + v.slug);

    /* 直接把状态推到「全票通过」，并钉住 #boot 不让它退场（开机动画的定时器
       会在 1 秒后把 #boot 滑走，用 interval 每 100ms 复写一次样式即可稳住），
       再检查印记是否完整落在六边形里 */
    await cdp.evaluate(`(function(){
      window.__forceBoot=function(){
        var b=document.getElementById('boot');
        if(!b) return;
        b.style.display='flex'; b.style.transform='none'; b.style.visibility='visible';
        b.classList.remove('done','boot-unlocked'); b.classList.add('boot-approved');
        document.body.classList.remove('boot-out');
      };
      if(window.__forceTimer) clearInterval(window.__forceTimer);
      window.__forceBoot();
      window.__forceTimer=setInterval(window.__forceBoot,100);
      return true;
    })()`);
    await sleep(1500);
    const info = await cdp.evaluate(APPROVE_PROBE);
    console.log('[' + v.slug + '] 全票通过印记：' + JSON.stringify(info));
    await cdp.evaluate(`(function(){window.__forceBoot();return true;})()`);
    await sleep(120);
    await shot(cdp, 'boot-' + v.slug + '-ok');
    await cdp.evaluate(`(function(){if(window.__forceTimer){clearInterval(window.__forceTimer);window.__forceTimer=0;}return true;})()`);
  }

  ws.close();
  child.kill();
  await sleep(300);
  console.log('\n输出目录：' + OUT);
}

main().catch((err) => { console.error('截图失败：', err && err.message ? err.message : err); process.exit(1); });
