// 检查四个页面在两种视口下的可滚动性：内容是否真的能被滚到
const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const WebSocket = require('ws');

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const URL = 'http://127.0.0.1:5000/';

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function run(w, h, label) {
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'nerv-chk-'));
  const port = 9400 + Math.floor(Math.random() * 200);
  const proc = spawn(
    EDGE,
    [
      '--headless=new',
      '--disable-gpu',
      '--hide-scrollbars',
      '--no-first-run',
      '--no-default-browser-check',
      '--user-data-dir=' + profile,
      '--remote-debugging-port=' + port,
      'about:blank',
    ],
    { stdio: 'ignore', windowsHide: true }
  );

  let targets = null;
  for (let i = 0; i < 60; i++) {
    try {
      const r = await fetch('http://127.0.0.1:' + port + '/json/list');
      targets = await r.json();
      if (targets && targets.length) break;
    } catch (e) {}
    await sleep(250);
  }
  if (!targets || !targets.length) {
    proc.kill();
    return { label, error: 'no target' };
  }
  const page = targets.find((t) => t.type === 'page') || targets[0];
  const ws = new WebSocket(page.webSocketDebuggerUrl, { perMessageDeflate: false });
  await new Promise((res, rej) => {
    ws.once('open', res);
    ws.once('error', rej);
  });

  let id = 0;
  const pending = new Map();
  ws.on('message', (raw) => {
    let m;
    try {
      m = JSON.parse(raw.toString());
    } catch (e) {
      return;
    }
    if (m.id && pending.has(m.id)) {
      pending.get(m.id)(m);
      pending.delete(m.id);
    }
  });
  const send = (method, params) =>
    new Promise((res, rej) => {
      const myId = ++id;
      pending.set(myId, (m) => (m.error ? rej(new Error(JSON.stringify(m.error))) : res(m.result)));
      ws.send(JSON.stringify({ id: myId, method, params: params || {} }));
    });
  const evaluate = async (expr) => {
    const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
    return r && r.result ? r.result.value : undefined;
  };

  await send('Emulation.setDeviceMetricsOverride', {
    width: w,
    height: h,
    deviceScaleFactor: 1,
    mobile: false,
  });
  await send('Page.enable');
  await send('Page.navigate', { url: URL });
  await sleep(3000);
  await evaluate('window.__bootDismiss && window.__bootDismiss()');
  await sleep(900);

  const out = [];
  for (let i = 0; i < 4; i++) {
    await evaluate('document.querySelectorAll("nav.dock button")[' + i + '].click()');
    await sleep(900);
    const m = await evaluate(
      '(function(){var p=document.querySelectorAll(".page")[' +
        i +
        '];var pin=p.querySelector(".page-in");' +
        'return {title:p.getAttribute("data-title"),scrollH:p.scrollHeight,clientH:p.clientHeight,' +
        'canScroll:p.scrollHeight-p.clientHeight>2,innerH:pin?pin.getBoundingClientRect().height:0};})()'
    );
    out.push(m);
  }

  // 系统页额外检查：保存按钮是否在滚动到底后可见
  await evaluate('document.querySelectorAll("nav.dock button")[3].click()');
  await sleep(600);
  const saveInfo = await evaluate(
    '(function(){var p=document.querySelectorAll(".page")[3];var b=document.getElementById("saveSettings");' +
    'p.scrollTop=p.scrollHeight;var r=b.getBoundingClientRect();var pr=p.getBoundingClientRect();' +
    'return {btnBottom:Math.round(r.bottom),pageBottom:Math.round(pr.bottom),' +
    'fullyVisible:r.bottom<=pr.bottom+1&&r.top>=pr.top-1};})()'
  );

  ws.close();
  proc.kill();
  try {
    fs.rmSync(profile, { recursive: true, force: true });
  } catch (e) {}

  return { label, viewport: w + 'x' + h, pages: out, saveSettings: saveInfo };
}

(async () => {
  const a = await run(800, 1280, 'portrait');
  console.log(JSON.stringify(a, null, 2));
  const b = await run(1280, 800, 'landscape');
  console.log(JSON.stringify(b, null, 2));
})();
