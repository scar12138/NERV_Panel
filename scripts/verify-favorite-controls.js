'use strict';
// Isolated full-page acceptance: fixture APIs only, no real applications or config.
const assert = require('node:assert/strict');
const express = require('express');
const http = require('http');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');
const WebSocket = require('ws');
const root = path.resolve(__dirname, '..');
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
const items = [
  {id:'steam:123',name:'示例游戏',type:'game',running:false,canClose:true},
  {id:'app:running',name:'示例运行软件',type:'software',running:true,canClose:true},
  {id:'app:unknown',name:'示例未知软件',type:'software',running:null,canClose:false}
];
let favorites = items.slice(), reads = 0;
const calls = [];
const app = express(); app.use(express.json());
app.get('/api/favorites', (q,r) => { reads++; r.json({ok:true,favorites}); });
app.get('/api/apps', (q,r) => r.json({ok:true,apps:items}));
app.post('/api/launch', (q,r) => {calls.push(['launch',q.body.id]);setTimeout(()=>{const a=items.find(a=>a.id===q.body.id);a.running=true;r.json({ok:true,name:a.name});},250);});
app.post('/api/close-app', (q,r) => {calls.push(['close',q.body.id]);setTimeout(()=>{const a=items.find(a=>a.id===q.body.id);a.running=false;r.json({ok:true,name:a.name});},250);});
app.post('/api/favorites', (q,r) => {calls.push(['favorite',q.body.id]);favorites=favorites.filter(a=>a.id!==q.body.id);r.json({ok:true,favorites});});
app.get('/api/config',(q,r)=>r.json({ok:true,config:{weatherCity:'合肥',favoriteAppIds:favorites.map(a=>a.id),refreshIntervalSec:1}}));
app.get('/api/status',(q,r)=>r.json({ok:true,name:'FIXTURE',online:true,uptimeSec:120}));
app.use('/api',(q,r)=>r.status(503).json({ok:false,message:'Isolated test fixture'}));
app.use(express.static(path.join(root,'public')));
function getJson(url){return new Promise((resolve,reject)=>http.get(url,r=>{let s='';r.on('data',d=>s+=d);r.on('end',()=>{try{resolve(JSON.parse(s));}catch(e){reject(e);}});}).on('error',reject));}
class CDP {
  constructor(ws){this.ws=ws;this.n=0;this.pending=new Map();ws.on('message',raw=>{const j=JSON.parse(raw),p=this.pending.get(j.id);if(p){this.pending.delete(j.id);j.error?p.reject(Error(JSON.stringify(j.error))):p.resolve(j.result);}});}
  send(method,params={}){return new Promise((resolve,reject)=>{const id=++this.n;this.pending.set(id,{resolve,reject});this.ws.send(JSON.stringify({id,method,params}));});}
  async ev(expression){const r=await this.send('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true});if(r.exceptionDetails)throw Error(JSON.stringify(r.exceptionDetails));return r.result.value;}
}
(async()=>{
  const server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));
  // Let Edge choose its debug port to avoid colliding with a developer browser.
  const profile=fs.mkdtempSync(path.join(os.tmpdir(),'nerv-controls-'));
  const edge=spawn('C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',['--headless=new','--disable-gpu','--no-first-run','--no-default-browser-check','--user-data-dir='+profile,'--remote-debugging-port=0','about:blank'],{stdio:'ignore'});
  let ws;
  try {
    let port;for(let i=0;i<60&&!port;i++){await delay(100);try{port=Number(fs.readFileSync(path.join(profile,'DevToolsActivePort'),'utf8').split('\n')[0]);}catch(_){}}
    assert.ok(port,'Edge debugging port ready');
    const target=(await getJson('http://127.0.0.1:'+port+'/json/list')).find(x=>x.type==='page');
    ws=new WebSocket(target.webSocketDebuggerUrl);await new Promise((r,j)=>{ws.once('open',r);ws.once('error',j);});
    const c=new CDP(ws);await c.send('Page.enable');
    await c.send('Page.addScriptToEvaluateOnNewDocument',{source:"localStorage.setItem('nerv.token','fixture-token')"});
    await c.send('Page.navigate',{url:'http://127.0.0.1:'+server.address().port});
    async function until(expr,message,timeout=10000){const end=Date.now()+timeout;while(Date.now()<end){if(await c.ev(expr))return;await delay(100);}throw Error(message);}
    await until("document.querySelectorAll('#appGrid .app').length===3",'Initial favorites render');
    await c.ev("document.getElementById('boot').hidden=true;document.querySelectorAll('.page-switch button')[1].click()");
    const card=id=>"document.querySelector('#appGrid .app[data-id=\""+id+"\"]')";
    assert.equal(await c.ev("document.querySelectorAll('#appGrid .app .app-ctrl button').length"),3,'Exactly one action per app');
    assert.equal(await c.ev("document.querySelectorAll('#appGrid .ico-hit').length"),0,'No full-card launch overlay');
    assert.equal(await c.ev(card('steam:123')+".querySelector('.run-state').textContent"),'未运行');
    assert.equal(await c.ev(card('app:running')+".querySelector('.run-state').textContent"),'运行中');
    assert.match(await c.ev(card('app:unknown')+".querySelector('.run-state').textContent"),/未知/);
    assert.equal(await c.ev("Array.from(document.querySelectorAll('#appGrid .star')).every(b=>b.querySelector('svg')&&!/[★☆]/.test(b.textContent))"),true,'Unified vector removal icons');
    await c.ev(card('steam:123')+".querySelector('b').click()");assert.equal(calls.length,0,'Card text does not launch');
    await c.ev(card('steam:123')+".querySelector('[data-launch]').click()");
    await until(card('steam:123')+".querySelector('.run-state').textContent.includes('启动')",'Launching state');
    await until(card('steam:123')+".querySelector('[data-close]')!==null",'Game becomes closeable',15000);
    assert.deepEqual(calls,[['launch','steam:123']]);
    await c.ev(card('steam:123')+".querySelector('[data-close]').click()");
    await until(card('steam:123')+".querySelector('.run-state').textContent.includes('关闭')",'Closing state');
    await until(card('steam:123')+".querySelector('[data-launch]')!==null",'Stopped game has launch action',15000);
    assert.deepEqual(calls,[['launch','steam:123'],['close','steam:123']]);
    await c.ev(card('app:running')+".querySelector('[data-star]').click()");
    await until(card('app:running')+"===null",'Favorite removed');
    assert.equal(items[1].running,true,'Removing favorite does not stop process');
    assert.equal(calls.filter(a=>a[0]==='close').length,1);
    const before=reads;items[0].running=true;
    await until(card('steam:123')+".querySelector('[data-close]')!==null",'External start refreshes',15000);
    assert.ok(reads>before,'Visible-page status polling');
    items[0].running=false;
    await until(card('steam:123')+".querySelector('[data-launch]')!==null",'External exit refreshes',15000);
    // Switching to the dashboard stops favorites polling; entering again refreshes immediately.
    await c.ev("document.querySelectorAll('.page-switch button')[0].click()");await delay(400);const paused=reads;await delay(5500);assert.equal(reads,paused,'Other page does not poll favorites');
    items[0].running=true;await c.ev("document.querySelectorAll('.page-switch button')[1].click()");
    await until(card('steam:123')+".querySelector('[data-close]')!==null",'Re-enter refreshes immediately');
    await c.ev("Object.defineProperty(document,'hidden',{configurable:true,get:function(){return true}});document.dispatchEvent(new Event('visibilitychange'))");
    await delay(400);const hiddenReads=reads;await delay(5500);assert.equal(reads,hiddenReads,'Visibility handler pauses polling');
    items[0].running=false;
    await c.ev("delete document.hidden;document.dispatchEvent(new Event('visibilitychange'))");
    await until(card('steam:123')+".querySelector('[data-launch]')!==null",'Visibility handler resumes immediately');
    for(const view of [{width:1280,height:800},{width:800,height:1280}]) {
      await c.send('Emulation.setDeviceMetricsOverride',{...view,deviceScaleFactor:1,mobile:true});await delay(800);
      const geometry=await c.ev("Array.from(document.querySelectorAll('#appGrid .app')).map(a=>{const b=a.querySelector('.app-ctrl button');return {button:b.getBoundingClientRect().toJSON(),card:a.getBoundingClientRect().toJSON()}})");
      assert.ok(geometry.every(g=>g.button.width>=44&&g.button.height>=44&&g.button.bottom<=g.card.bottom+1),'Controls fit card at '+view.width+'x'+view.height+': '+JSON.stringify(geometry));
      assert.equal(await c.ev("document.getElementById('appGrid').scrollWidth<=document.getElementById('appGrid').clientWidth+1"),true,'No horizontal overflow');
    }
    console.log('PASS favorite controls: single action, busy states, real-state polling, icons, removal, no card launch, visibility pause/resume, responsive controls; fixture APIs only');
  } finally {if(ws)ws.close();edge.kill();server.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
