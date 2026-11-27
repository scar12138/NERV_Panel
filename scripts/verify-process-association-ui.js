'use strict';
// Isolated fixture server: never launches, closes or enumerates user processes/config.
const assert = require('node:assert/strict');
const express = require('express');
const http = require('http');
const fs = require('fs');
const os = require('os');
const path = require('path');
const {spawn} = require('child_process');
const WebSocket = require('ws');
const root = path.resolve(__dirname, '..');
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
const items = [{id:'fixture:a',name:'示例数据 · 应用 A',hasIcon:true,running:false,canClose:false,processAssociation:null},{id:'fixture:b',name:'示例数据 · 应用 B',hasIcon:true,running:true,canClose:false,closeReason:'示例数据：手动关联的进程只用于运行状态识别，不允许安全关闭',processAssociation:{name:'saved.exe',mode:'path',pathReadable:true}}];
// Keep the grid tall enough to compete for space with the expanded association section.
items.push(...Array.from({length:22},(_,i)=>({id:'fixture:extra-'+i,name:'示例数据 · 常用 '+i,hasIcon:true,running:false,canClose:false,processAssociation:null})));
// A desktop typically has dozens of processes, including long executable paths.
const processes = [{selectionId:'sel-one',pid:123,name:'示例数据 process.exe',path:'C:\\Fixture\\process.exe',pathReadable:true},{selectionId:'sel-two',pid:456,name:'示例数据 hidden.exe',path:null,pathReadable:false},...Array.from({length:78},(_,i)=>({selectionId:'sel-extra-'+i,pid:2000+i,name:'示例数据 worker-'+i+'.exe',path:'C:\\Program Files\\Fixture Application Suite\\Background Services\\Worker '+i+'\\worker.exe',pathReadable:true}))];
const rowsLoaded = "document.querySelectorAll('#processList input').length==="+processes.length;
let listing = 'ok', listDelay = 0, mutation = 'ok', reads = 0;
const calls = [];
const app = express(); app.use(express.json());
app.get('/api/favorites',(q,r)=>{reads++;r.json({ok:true,favorites:items});});
app.get('/api/apps',(q,r)=>r.json({ok:true,apps:items}));
app.get('/api/apps/:id/icon',(q,r)=>r.type('svg').send('<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32"><path d="M4 4h24v24H4z"/></svg>'));
app.get('/api/processes',(q,r)=>{calls.push({type:'list',token:q.headers['x-nerv-token']});const mode=listing;setTimeout(()=>{
  if(mode==='unauthorized')return r.status(403).json({ok:false,message:'Invalid token'});
  if(mode==='failure')return r.status(503).json({ok:false,message:'进程列表暂不可用'});
  r.json({ok:true,snapshotId:'fixture-snapshot',expiresAt:Date.now()+(mode==='expired'?-1:60000),processes});
},listDelay);});
app.post('/api/apps/process-association',(q,r)=>{calls.push({type:'mutation',body:q.body,token:q.headers['x-nerv-token']});setTimeout(()=>{
  if(mutation==='stale')return r.status(409).json({ok:false,message:'进程快照已过期'});
  if(q.headers['x-nerv-token']!=='fixture-token')return r.status(403).json({ok:false,message:'访问令牌无效'});
  const association=q.body.action==='unbind'?null:{name:'示例数据 process.exe',mode:'path',pathReadable:true};
  items.find(a=>a.id===q.body.id).processAssociation=association;r.json({ok:true,id:q.body.id,processAssociation:association});
},200);});
app.get('/api/config',(q,r)=>r.json({ok:true,config:{weatherCity:'合肥',favoriteAppIds:items.map(a=>a.id),refreshIntervalSec:1}}));
app.get('/api/status',(q,r)=>r.json({ok:true,name:'示例数据 FIXTURE',online:true,uptimeSec:120}));
app.use('/api',(q,r)=>r.status(503).json({ok:false,message:'Isolated fixture only'}));
app.use(express.static(path.join(root,'public')));
function json(url){return new Promise((resolve,reject)=>http.get(url,r=>{let body='';r.on('data',d=>body+=d);r.on('end',()=>resolve(JSON.parse(body)));}).on('error',reject));}
class CDP{
 constructor(ws){this.ws=ws;this.seq=0;this.pending=new Map();ws.on('message',raw=>{const j=JSON.parse(raw),p=this.pending.get(j.id);if(p){this.pending.delete(j.id);j.error?p.reject(Error(JSON.stringify(j.error))):p.resolve(j.result);}});}
 send(method,params={}){return new Promise((resolve,reject)=>{const id=++this.seq;this.pending.set(id,{resolve,reject});this.ws.send(JSON.stringify({id,method,params}));});}
 async ev(expression){const r=await this.send('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true});if(r.exceptionDetails)throw Error(JSON.stringify(r.exceptionDetails));return r.result.value;}
}
(async()=>{
 const server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));
 const profile=fs.mkdtempSync(path.join(os.tmpdir(),'nerv-process-ui-'));
 const edge=spawn('C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',['--headless=new','--disable-gpu','--no-first-run','--no-default-browser-check','--user-data-dir='+profile,'--remote-debugging-port=0','about:blank'],{stdio:'ignore'});
 let ws;try{
  let port;for(let i=0;i<60&&!port;i++){await delay(100);try{port=Number(fs.readFileSync(path.join(profile,'DevToolsActivePort'),'utf8').split('\n')[0]);}catch(_){}}
  assert.ok(port,'Edge ready');const target=(await json('http://127.0.0.1:'+port+'/json/list')).find(t=>t.type==='page');
  ws=new WebSocket(target.webSocketDebuggerUrl);await new Promise((r,j)=>{ws.once('open',r);ws.once('error',j);});const c=new CDP(ws);await c.send('Page.enable');
  const errors=[];ws.on('message',raw=>{const j=JSON.parse(raw);if(j.method==='Runtime.exceptionThrown')errors.push(j.params.exceptionDetails);});await c.send('Runtime.enable');
  await c.send('Page.navigate',{url:'http://127.0.0.1:'+server.address().port});
  async function until(expr,message){const end=Date.now()+10000;while(Date.now()<end){if(await c.ev(expr))return;await delay(50);}throw Error(message);}
  const click=selector=>c.ev('document.querySelector('+JSON.stringify(selector)+').click()');
  const open=id=>click('[data-associate="fixture:'+id+'"]');
  await until("document.querySelectorAll('#appGrid .app').length==="+items.length,'Favorites loaded');await c.ev("document.getElementById('boot').hidden=true;document.querySelectorAll('.page-switch button')[1].click()");await delay(700);
  await open('a');assert.match(await c.ev("document.getElementById('processStatus').textContent"),/令牌/);assert.equal(calls.length,0,'No token => no process enumeration');
  await c.ev("localStorage.setItem('nerv.token','fixture-token')");listDelay=150;await click('#processRefresh');assert.equal(await c.ev("document.getElementById('processAssociation').getAttribute('aria-busy')"),'true');
  await until(rowsLoaded,'Real fixture rows');assert.equal(calls[0].token,'fixture-token');
  assert.match(await c.ev("document.getElementById('processList').textContent"),/路径不可读取/);
  await c.ev("document.getElementById('processSearch').value='hidden';document.getElementById('processSearch').dispatchEvent(new Event('input'))");assert.equal(await c.ev("document.querySelectorAll('#processList input').length"),1,'Search filters actual rows');
  await c.ev("document.getElementById('processSearch').value='';document.getElementById('processSearch').dispatchEvent(new Event('input'))");await click('#processList input[value="sel-one"]');await click('#processBind');
  assert.equal(await c.ev("document.getElementById('processUnbind').disabled"),true,'Save disables conflicting actions');
  await until("document.getElementById('processSaved').textContent.includes('process.exe')",'Saved identity');assert.deepEqual(calls.find(a=>a.type==='mutation').body,{action:'bind',id:'fixture:a',snapshotId:'fixture-snapshot',selectionId:'sel-one'});
  assert.equal(await c.ev("document.querySelector('[data-close=\"fixture:a\"]')===null&&document.querySelector('[data-close=\"fixture:b\"]').disabled"),true,'Association never grants close permission');
  assert.equal(await c.ev("document.querySelectorAll('.app-action-note').length"),0,'Manual association adds no explanatory card text');
  assert.equal(await c.ev("document.querySelector('[data-close=\"fixture:b\"]').title"),'当前无法安全关闭','Manual association has a concise disabled-control title');
  await click('#processUnbind');await until("document.getElementById('processSaved').textContent.includes('尚未')",'Unbind identity');
  mutation='stale';await click('#processList input[value="sel-one"]');await click('#processBind');await until("document.getElementById('processStatus').textContent.includes('快照已过期')",'Stale mutation surfaced');assert.equal(await c.ev("document.getElementById('processBind').disabled"),true);
  mutation='ok';listing='expired';await click('#processRefresh');await until(rowsLoaded,'Expired list arrived');await click('#processList input');const before=calls.length;await click('#processBind');assert.equal(calls.length,before,'Expired snapshot blocked locally');assert.match(await c.ev("document.getElementById('processStatus').textContent"),/过期/);
  listing='unauthorized';await click('#processRefresh');await until("document.getElementById('processStatus').textContent.includes('令牌无效')",'Invalid token surfaced');
  listing='failure';await click('#processRefresh');await until("document.getElementById('processStatus').textContent.includes('暂不可用')",'Listing failure surfaced');
  listing='ok';listDelay=600;await click('#processRefresh');await click('#processClose');await open('b');await until(rowsLoaded,'Second selection loaded');assert.match(await c.ev("document.getElementById('processSaved').textContent"),/saved.exe/,'Stale response does not change active app');
  // Holding the link itself must not arm favorite sorting.
  const point=await c.ev("(()=>{const r=document.querySelector('[data-associate]').getBoundingClientRect();return{x:r.x+r.width/2,y:r.y+r.height/2}})()");
  await c.send('Input.dispatchMouseEvent',{type:'mousePressed',...point,button:'left',clickCount:1});await delay(650);await c.send('Input.dispatchMouseEvent',{type:'mouseReleased',...point,button:'left',clickCount:1});assert.equal(await c.ev("document.getElementById('appGrid').classList.contains('favorite-sort-mode')"),false,'Link hold never sorts');
  await click('#processClose');await c.ev("window.originalIcon=document.querySelector('#appGrid img');window.originalCard=document.querySelector('#appGrid .app')");const pollStart=reads;await until('true','noop');for(let i=0;i<120&&reads===pollStart;i++)await delay(50);assert.ok(reads>pollStart,'Existing polling remains active');await delay(150);assert.equal(await c.ev("window.originalIcon===document.querySelector('#appGrid img')&&window.originalCard===document.querySelector('#appGrid .app')"),true,'Polling preserves loaded icons and unchanged cards');
  await c.ev("document.getElementById('appSearch').value='应用 B';document.getElementById('appSearch').dispatchEvent(new Event('input'))");
  await until("document.querySelector('#searchGrid [data-associate]')!==null",'Search result has association control');
  await click('#searchGrid [data-associate]');await until(rowsLoaded,'Search result opens actual process list');
  assert.equal(await c.ev("document.getElementById('processAppName').textContent"),'示例数据 · 应用 B');
  await click('#processClose');items[1].processAssociationError='示例数据：配置暂不可读';
  await c.ev("document.querySelectorAll('.page-switch button')[0].click();document.querySelectorAll('.page-switch button')[1].click()");
  await until("document.querySelector('#appGrid [data-associate=\"fixture:b\"]')!==null",'Favorites visible');await delay(300);await open('b');
  assert.match(await c.ev("document.getElementById('processSaved').textContent"),/无法读取已保存/,'Unreadable config never implies no saved binding');
  items[1].processAssociationError='';await click('#processClose');
  await c.ev("document.querySelectorAll('.page-switch button')[0].click();document.querySelectorAll('.page-switch button')[1].click()");await delay(300);
  await c.ev("document.getElementById('appSearch').value='';document.getElementById('appSearch').dispatchEvent(new Event('input'))");
  await open('b');await until(rowsLoaded,'Screenshot process rows');
  const out=path.join(root,'preview','process-association');fs.mkdirSync(out,{recursive:true});
  async function reachable(selector, name) {
   await c.ev('document.querySelector('+JSON.stringify(selector)+').scrollIntoView({block:"center",inline:"nearest",behavior:"instant"})');await delay(80);
   const hit=await c.ev('(()=>{const el=document.querySelector('+JSON.stringify(selector)+'),r=el.getBoundingClientRect(),scroll=document.querySelector(".app-scroll").getBoundingClientRect();return {visible:r.width>0&&r.height>0&&r.top>=Math.max(0,scroll.top)-1&&r.bottom<=Math.min(innerHeight,scroll.bottom)+1,hits:[.25,.5,.75].every(f=>{const top=document.elementFromPoint(r.left+r.width*f,r.top+r.height/2);return top===el||el.contains(top)})}})()');
   assert.deepEqual(hit,{visible:true,hits:true},name+' reachable '+selector);
  }
  for(const view of [{width:1280,height:800,name:'landscape'},{width:1280,height:480,name:'short-landscape'},{width:844,height:390,name:'phone-landscape'},{width:800,height:1280,name:'portrait'},{width:390,height:644,name:'phone'}]){
   await c.send('Emulation.setDeviceMetricsOverride',{width:view.width,height:view.height,deviceScaleFactor:1,mobile:true});await delay(900);
   const g=await c.ev("(()=>{const cards=Array.from(document.querySelectorAll('#appGrid .app'));return{compact:cards.every(a=>a.getBoundingClientRect().height<=130),transparent:cards.every(a=>getComputedStyle(a.querySelector('[data-associate]')).backgroundColor==='rgba(0, 0, 0, 0)'),inside:cards.every(a=>{const c=a.getBoundingClientRect(),b=a.querySelector('[data-associate]').getBoundingClientRect();return b.left>=c.left&&b.bottom<=c.bottom+1}),overflow:document.getElementById('processAssociation').scrollWidth>document.getElementById('processAssociation').clientWidth+1}})()");
   assert.deepEqual(g,{compact:true,transparent:true,inside:true,overflow:false},view.name+' geometry');
   const separation=await c.ev("(()=>{const section=document.getElementById('processAssociation').getBoundingClientRect(),actions=document.querySelector('.process-actions').getBoundingClientRect(),grid=document.getElementById('appGrid').getBoundingClientRect(),list=document.getElementById('processList');return{noShrink:getComputedStyle(document.getElementById('processAssociation')).flexShrink==='0',actionsContained:actions.bottom<=section.bottom,gridSeparated:grid.top>=section.bottom,listScrollable:list.scrollHeight>list.clientHeight}})()");
   assert.deepEqual(separation,{noShrink:true,actionsContained:true,gridSeparated:true,listScrollable:true},view.name+' many-row separation');
   for(const selector of ['#processClose','#processSearch','#processRefresh','#processList input:first-child','#processList .process-row:last-child input','#processBind','#processUnbind','#processSettings'])await reachable(selector,view.name);
   await c.ev("document.getElementById('processList').scrollTop=0;document.getElementById('processBind').scrollIntoView({block:'center',behavior:'instant'})");
   console.log('PASS '+view.name+' '+view.width+'x'+view.height+': '+processes.length+' rows, contained actions, separate grid, all controls hit-tested after scroll');
   const shot=await c.send('Page.captureScreenshot',{format:'png'});const file=path.join(out,view.name+'.png');fs.writeFileSync(file,Buffer.from(shot.data,'base64'));console.log('PREVIEW '+file);
  }
  assert.deepEqual(errors,[],'No uncaught browser exceptions');console.log('PASS association UI: token, loading/error, real fixture search/select, bind/unbind, saved identity, stale snapshots/requests, safe sort gestures, icon polling, responsive; fixture APIs only');
 }finally{if(ws)ws.close();edge.kill();server.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
