'use strict';
/**
 * MAGI 三框布局 + 7 个进度点 的几何自检（开发期脚本）
 *
 * 量：三个表决框、中央蜂巢核心（.vote-magi）、ALL APPROVED 印记的实际矩形，
 *     以及三者之间是否相交、印记文字是否溢出核心、.vote-foot 是否还存在。
 *
 * 用法：node scripts/probe-magi.js   （面板服务需已在 5000 端口运行）
 */
const { spawn } = require('child_process');
const path = require('path');
const http = require('http');
const WebSocket = require('ws');

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const PORT = 9337;
const URL = 'http://127.0.0.1:5000/';

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

/** 等开机动画结束后，再把 #boot 强行露出来做静态测量（冻结动画，量到的就是稳态） */
const SHOW_BOOT = `(function(){
  var b=document.getElementById('boot');
  if(!b) return 'no boot';
  b.style.display='flex';
  b.classList.add('boot-approved');
  document.body.classList.remove('boot-out');
  return 'shown';
})()`;

const MAGI_PROBE = `(function(){
  function r(el){ if(!el) return null; var x=el.getBoundingClientRect();
    return {x:Math.round(x.left*10)/10,y:Math.round(x.top*10)/10,w:Math.round(x.width*10)/10,h:Math.round(x.height*10)/10,
            left:Math.round(x.left*10)/10,right:Math.round(x.right*10)/10,top:Math.round(x.top*10)/10,bottom:Math.round(x.bottom*10)/10}; }
  function hit(a,b){ if(!a||!b) return null;
    return !(a.right<=b.left+0.5||b.right<=a.left+0.5||a.bottom<=b.top+0.5||b.bottom<=a.top+0.5); }
  var term=document.querySelector('.magi-term');
  var diag=document.querySelector('.vote-diagram');
  var top_=document.getElementById('voteBalthasar');
  var core=document.getElementById('voteCore');
  var cas=document.getElementById('voteCasper');
  var mel=document.getElementById('voteMelchior');
  var ok=document.querySelector('.core-approve');
  var foot=document.querySelector('.vote-foot');
  var cap=document.getElementById('magiCaption');
  var R={term:r(term),diag:r(diag),balthasar:r(top_),core:r(core),casper:r(cas),melchior:r(mel),
         approve:r(ok),caption:r(cap)};
  var out={
    rects:R,
    overlaps:{
      core_vs_casper: hit(R.core,R.casper),
      core_vs_melchior: hit(R.core,R.melchior),
      core_vs_balthasar: hit(R.core,R.balthasar),
      casper_vs_melchior: hit(R.casper,R.melchior),
      casper_vs_term: !(R.casper.left>=R.term.left-0.5),
      melchior_vs_term: !(R.melchior.right<=R.term.right+0.5),
      balthasar_vs_term: !(R.balthasar.left>=R.term.left-0.5 && R.balthasar.right<=R.term.right+0.5),
      diagram_overflows_term: !(R.diag.left>=R.term.left-0.5 && R.diag.right<=R.term.right+0.5 &&
                                R.diag.top>=R.term.top-0.5 && R.diag.bottom<=R.term.bottom+0.5)
    },
    gaps:{
      casper_to_term_left: Math.round((R.casper.left-R.term.left)*10)/10,
      melchior_to_term_right: Math.round((R.term.right-R.melchior.right)*10)/10,
      corewidth_pct_of_diag: Math.round(R.core.w/R.diag.w*1000)/10,
      center_gap_casper: Math.round((R.core.left-R.casper.right)*10)/10,
      center_gap_melchior: Math.round((R.melchior.left-R.core.right)*10)/10,
      row_gap_core_casper: Math.round((R.casper.top-R.core.bottom)*10)/10,
      row_gap_core_balthasar: Math.round((R.core.top-R.balthasar.bottom)*10)/10
    },
    voteFoot: foot ? 'PRESENT' : 'ABSENT',
    approveVisible: ok ? getComputedStyle(ok).display !== 'none' : false,
    approveText: ok ? ok.textContent.trim() : null,
    approveOverflowsCore: null,
    insideHexagon: null,
    slack: null,
    overflowX: 0, overflowY: 0
  };
  if(ok && R.approve && R.core){
    /* 用文字实际渲染宽度判断有没有被 core 的 clip-path 裁掉 */
    out.approveOverflowsCore = (R.approve.w > R.core.w + 1) || (R.approve.h > R.core.h + 1);
    out.overflowX = Math.round((R.approve.w - R.core.w)*10)/10;
    out.overflowY = Math.round((R.approve.h - R.core.h)*10)/10;
    /* 六边形的斜边：上下半高之内，可用宽度随纵向位置收窄。取文字四角逐点判定是否落在多边形内，
       比「内切矩形」更严格（内切矩形只是保守近似） */
    var cx=R.core.left+R.core.w/2, cxLeft=R.core.left+R.core.w*0.25, cxRight=R.core.right-R.core.w*0.25;
    function inHex(px,py){
      if(py<R.core.top-0.5||py>R.core.bottom+0.5) return false;
      var t=(py-R.core.top)/R.core.h;           /* 0 在顶边、0.5 在中线、1 在底边 */
      var k=Math.abs(t-0.5)*2;                  /* 0 中线、1 上下边 */
      var halfW=(R.core.w/2)*(1-k*0.5);         /* 中线半宽 = w/2，上下边半宽 = w/4 */
      return px>=cx-halfW+0.5 && px<=cx+halfW-0.5;
    }
    var corners=[[R.approve.left,R.approve.top],[R.approve.right,R.approve.top],
                 [R.approve.left,R.approve.bottom],[R.approve.right,R.approve.bottom]];
    out.insideHexagon = corners.every(function(p){ return inHex(p[0],p[1]); });
    out.slack = {
      left: Math.round((R.approve.left-cxLeft)*10)/10,
      right: Math.round((cxRight-R.approve.right)*10)/10,
      top: Math.round((R.approve.top-R.core.top)*10)/10,
      bottom: Math.round((R.core.bottom-R.approve.bottom)*10)/10
    };
  }
  return out;
})()`;

async function main() {
  const profile = path.join(require('os').tmpdir(), 'nerv-magi-profile-' + Date.now());
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
    await cdp.send('Emulation.setDeviceMetricsOverride', { width: v.width, height: v.height, deviceScaleFactor: 1, mobile: true });
    await cdp.send('Page.navigate', { url: URL });
    await sleep(7000);
    await cdp.evaluate(SHOW_BOOT);
    await sleep(900);
    const m = await cdp.evaluate(MAGI_PROBE);
    console.log('\n===== ' + v.slug + ' ' + v.width + 'x' + v.height + ' =====');
    console.log(JSON.stringify(m, null, 2));
  }

  ws.close();
  child.kill();
  await sleep(300);
}

main().catch((err) => { console.error('探测失败：', err && err.message ? err.message : err); process.exit(1); });
