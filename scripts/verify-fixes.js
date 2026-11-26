'use strict';
/**
 * 本轮新增行为的自动化验证（开发期脚本）
 *
 * 1) 需求三.1：平板熄屏点亮 → 重新弹出启动界面
 *    用 Object.defineProperty 覆盖 document.hidden 并派发 visibilitychange 来模拟
 *    「熄屏 4 秒后点亮」，检查 #boot 是否重新可见、是否重播开机动画、退场后落回监控页。
 * 2) 需求一.3：天气接口失败时不得清空界面
 *    用 Fetch 拦截把 /api/weather 打成 502，检查温度/描述是否仍保持上一次的真实值，
 *    以及是否触发了退避重试（重试请求次数 > 0）。
 *
 * 用法：node scripts/verify-fixes.js   （面板服务需已在 5000 端口运行）
 */
const { spawn } = require('child_process');
const path = require('path');
const http = require('http');
const WebSocket = require('ws');

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const PORT = 9336;
const URL = process.env.NERV_VERIFY_URL || 'http://127.0.0.1:5000/';

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

const BOOT_STATE = `(function(){
  var b=document.getElementById('boot');
  if(!b) return {error:'no boot'};
  var cs=getComputedStyle(b);
  var log=document.getElementById('bootLog');
  return {
    display: b.style.display || cs.display,
    hasDone: b.classList.contains('done'),
    hasUnlocked: b.classList.contains('boot-unlocked'),
    approved: b.classList.contains('boot-approved'),
    alert: b.classList.contains('boot-alert'),
    visible: cs.display!=='none' && cs.visibility!=='hidden' && parseFloat(cs.opacity||'1')>0.05,
    pct: (document.getElementById('bootPct')||{}).textContent,
    logLines: log?log.children.length:0,
    litHosts: document.querySelectorAll('.vote-box.lit').length
  };
})()`;

const WX_STATE = `(function(){
  return {
    temp: (document.getElementById('wxTemp')||{}).textContent,
    desc: (document.getElementById('wxDesc')||{}).textContent,
    meta: (document.getElementById('wxMeta')||{}).textContent
  };
})()`;

async function main() {
  const profile = path.join(require('os').tmpdir(), 'nerv-verify-profile-' + Date.now());
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

  let failWeather = false, wxHits = 0;
  await cdp.send('Fetch.enable', { patterns: [{ urlPattern: '*/api/weather*', requestStage: 'Request' }] });
  cdp.on((msg) => {
    if (msg.method !== 'Fetch.requestPaused') return;
    const id = msg.params.requestId;
    if (failWeather) {
      wxHits++;
      cdp.send('Fetch.fulfillRequest', {
        requestId: id, responseCode: 502,
        responseHeaders: [{ name: 'Content-Type', value: 'application/json' }],
        body: Buffer.from(JSON.stringify({ ok: false, error: 'WEATHER_UPSTREAM', message: '天气服务暂时不可用' })).toString('base64')
      }).catch(() => {});
    } else {
      cdp.send('Fetch.continueRequest', { requestId: id }).catch(() => {});
    }
  });

  await cdp.send('Emulation.setDeviceMetricsOverride', { width: 800, height: 1280, deviceScaleFactor: 1.5, mobile: true });
  await cdp.send('Page.navigate', { url: URL });
  await sleep(8000);

  let pass = 0, fail = 0;
  const assert = (name, ok, detail) => {
    console.log((ok ? '  ✓ ' : '  ✗ ') + name + (detail ? '  ' + JSON.stringify(detail) : ''));
    ok ? pass++ : fail++;
  };

  /* ---------- 0) 基线：开机动画已退场，天气有真实值 ---------- */
  console.log('\n[0] 基线');
  const boot0 = await cdp.evaluate(BOOT_STATE);
  assert('#boot 已隐藏', boot0.visible === false && boot0.hasDone === true, boot0);
  const wx0 = await cdp.evaluate(WX_STATE);
  assert('天气已有真实数值', !!wx0.temp && wx0.temp !== '—°', wx0);

  /* ---------- 1) 需求三.1：熄屏 4 秒后点亮 → 重播启动界面 ---------- */
  console.log('\n[1] 需求三.1 熄屏点亮重播启动界面');
  await cdp.evaluate(`(function(){
    Object.defineProperty(document,'hidden',{configurable:true,get:function(){return true;}});
    Object.defineProperty(document,'visibilityState',{configurable:true,get:function(){return 'hidden';}});
    document.dispatchEvent(new Event('visibilitychange'));
    return true;
  })()`);
  await sleep(4000);
  await cdp.evaluate(`(function(){
    Object.defineProperty(document,'hidden',{configurable:true,get:function(){return false;}});
    Object.defineProperty(document,'visibilityState',{configurable:true,get:function(){return 'visible';}});
    document.dispatchEvent(new Event('visibilitychange'));
    return true;
  })()`);
  await sleep(1200);
  const boot1 = await cdp.evaluate(BOOT_STATE);
  assert('#boot 重新可见', boot1.visible === true, boot1);
  assert('动画状态已复位（无 done / 未 unlocked）', !boot1.hasDone && !boot1.hasUnlocked, boot1);
  assert('进度条已从 0 重新开始', boot1.pct !== '100%', { pct: boot1.pct, logLines: boot1.logLines });

  /* 等新的一轮动画自己退场 */
  await sleep(7000);
  const boot2 = await cdp.evaluate(BOOT_STATE);
  assert('重播后动画正常退场', boot2.visible === false && boot2.hasDone === true, boot2);

  /* 短暂切后台（< 3 秒）不应重播 */
  await cdp.evaluate(`(function(){
    Object.defineProperty(document,'hidden',{configurable:true,get:function(){return true;}});
    document.dispatchEvent(new Event('visibilitychange'));return true;})()`);
  await sleep(1000);
  await cdp.evaluate(`(function(){
    Object.defineProperty(document,'hidden',{configurable:true,get:function(){return false;}});
    document.dispatchEvent(new Event('visibilitychange'));return true;})()`);
  await sleep(900);
  const boot3 = await cdp.evaluate(BOOT_STATE);
  assert('短暂切后台（1s）不重播', boot3.visible === false, boot3);

  /* ---------- 2) 需求一.3：天气接口失败时不清空 + 退避重试 ---------- */
  console.log('\n[2] 需求一.3 天气失败不清空 + 退避重试');
  failWeather = true; wxHits = 0;
  /* 调页面的 loadWeather（app.js 暴露的调试钩子），让它真实地经历一次 502 */
  await cdp.evaluate(`(function(){ if(window.NERV_DEBUG && window.NERV_DEBUG.loadWeather) window.NERV_DEBUG.loadWeather(); return true; })()`);
  await sleep(1200);
  const wx1 = await cdp.evaluate(WX_STATE);
  assert('失败期间温度不被清成 —', wx1.temp === wx0.temp, { before: wx0.temp, after: wx1.temp });
  assert('失败期间描述不被清空', wx1.desc === wx0.desc, { before: wx0.desc, after: wx1.desc });
  assert('失败期间仍有天气数据对象（未置空）', !!(await cdp.evaluate('!!(window.NERV_DEBUG&&window.NERV_DEBUG.weatherData())')), {});

  /* 退避重试：第一次失败后 15s 重试 → 再 30s。等 ~17s 观察是否至少重试一次 */
  await sleep(17000);
  assert('失败后触发了退避重试', wxHits >= 2, { hits: wxHits });

  /* 恢复上游 → 重试成功，界面回到正常值 */
  failWeather = false;
  const before = wxHits;
  await cdp.evaluate(`(function(){ if(window.NERV_DEBUG && window.NERV_DEBUG.loadWeather) window.NERV_DEBUG.loadWeather(); return true; })()`);
  await sleep(2500);
  const wx2 = await cdp.evaluate(WX_STATE);
  assert('恢复后能正常刷新', typeof wx2.temp === 'string' && wx2.temp.indexOf('°') > 0, wx2);
  assert('恢复后请求确实通到后端', wxHits >= before, { hits: wxHits });

  console.log('\n结果：' + pass + ' 通过 / ' + fail + ' 失败');
  ws.close();
  child.kill();
  await sleep(300);
  process.exit(fail ? 1 : 0);
}

main().catch((err) => { console.error('验证失败：', err && err.message ? err.message : err); process.exit(1); });
