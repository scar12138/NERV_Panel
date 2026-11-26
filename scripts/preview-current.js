'use strict';
// Latest UI previews with isolated fixture APIs; never launches apps or changes user settings.
const express=require('express'),http=require('http'),fs=require('fs'),path=require('path'),os=require('os');
const {spawn}=require('child_process');const WebSocket=require('ws');
const ROOT=path.resolve(__dirname,'..'),OUT=path.join(ROOT,'preview','current');
const apps=['网易云音乐','Google Chrome','Steam','示例游戏','文件资源管理器'].map((name,i)=>({id:'preview:'+i,name,type:i===3?'steam':'software',hasIcon:false,running:i===0||i===3,canClose:true}));
const metrics={cpu:{name:'AMD Ryzen 7 7800X3D',usage:24,temp:56,freq:4250},gpu:{name:'NVIDIA GeForce RTX 4070',usage:38,temp:61,vramUsed:4*1073741824,vramTotal:12*1073741824},ram:{usage:42,used:13.4*1073741824,total:32*1073741824},net:{up:0.32,down:2.8},disks:[{name:'C:',usage:48,used:240*1073741824,total:500*1073741824},{name:'D:',usage:36,used:720*1073741824,total:2000*1073741824}]};
const media={available:true,app:'cloudmusic.exe',appName:'网易云音乐',title:'One Last Kiss',artist:'宇多田ヒカル',isPlaying:true,position:94,duration:252,thumbHash:null};
const app=express();app.use(express.static(path.join(ROOT,'public')));
app.get('/api/media',(q,r)=>r.json({ok:true,media}));
app.get('/api/audio/sessions',(q,r)=>r.json({ok:true,master:{id:'master:preview',volume:68,muted:false},sessions:[{id:'cloud',name:'网易云音乐',volume:82,muted:false},{id:'chrome',name:'Google Chrome',volume:45,muted:false},{id:'system',name:'系统声音',isSystemSounds:true,volume:50,muted:false}]}));
app.get('/api/favorites',(q,r)=>r.json({ok:true,favorites:apps}));app.get('/api/apps',(q,r)=>r.json({ok:true,apps}));
app.get('/api/config',(q,r)=>r.json({ok:true,config:{weatherCity:'合肥',favoriteAppIds:apps.map(x=>x.id),port:5000,refreshIntervalSec:1}}));
app.get('/api/status',(q,r)=>r.json({ok:true,name:'NERV-PC',ip:'192.168.1.10',port:5000,online:true,uptimeSec:7200,version:'1.0.0'}));
app.get('/api/weather',(q,r)=>r.json({ok:true,weather:{city:'合肥',temp:18,feels:17,humidity:56,windDir:'东北风',windLevel:2,air:'良',code:1,desc:'晴',days:[{label:'今天',min:12,max:20},{label:'明天',min:13,max:21},{label:'后天',min:11,max:19},{label:'第 4 天',min:10,max:18}]}}));
app.get('/api/metrics',(q,r)=>r.json({ok:true,metrics,intervalSec:1}));
app.get('/api/metrics/history',(q,r)=>r.json({ok:true,history:[]}));
app.use('/api',(q,r)=>r.status(503).json({ok:false,message:'示例数据：预览不连接真实设备'}));
const pause=ms=>new Promise(r=>setTimeout(r,ms));
function getJson(url){return new Promise((resolve,reject)=>http.get(url,r=>{let s='';r.on('data',d=>s+=d);r.on('end',()=>{try{resolve(JSON.parse(s));}catch(e){reject(e);}});}).on('error',reject));}
class CDP{constructor(ws){this.ws=ws;this.n=0;this.pending=new Map();ws.on('message',raw=>{const j=JSON.parse(raw);if(this.pending.has(j.id)){const p=this.pending.get(j.id);this.pending.delete(j.id);j.error?p.reject(Error(JSON.stringify(j.error))):p.resolve(j.result);}});}send(method,params={}){return new Promise((resolve,reject)=>{const id=++this.n;this.pending.set(id,{resolve,reject});this.ws.send(JSON.stringify({id,method,params}));});}async ev(expression){const r=await this.send('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true});if(r.exceptionDetails)throw Error(JSON.stringify(r.exceptionDetails));return r.result.value;}}
(async()=>{fs.mkdirSync(OUT,{recursive:true});const server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));const base='http://127.0.0.1:'+server.address().port;
const probe=http.createServer();await new Promise(r=>probe.listen(0,'127.0.0.1',r));const port=probe.address().port;await new Promise(r=>probe.close(r));
const wss=new WebSocket.Server({server});wss.on('connection',s=>{const send=()=>{if(s.readyState===1)s.send(JSON.stringify({type:'metrics',metrics,intervalSec:1}));};send();const timer=setInterval(send,1000);s.on('close',()=>clearInterval(timer));});
const edge=spawn('C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',['--headless=new','--disable-gpu','--hide-scrollbars','--no-first-run','--no-default-browser-check','--user-data-dir='+path.join(os.tmpdir(),'nerv-current-preview-'+Date.now()),'--remote-debugging-port='+port,'about:blank'],{stdio:'ignore'});
let ws;try{let target;for(let i=0;i<50&&!target;i++){await pause(200);try{target=(await getJson('http://127.0.0.1:'+port+'/json/list')).find(x=>x.type==='page');}catch(_){}}if(!target)throw Error('Edge debugging unavailable');ws=new WebSocket(target.webSocketDebuggerUrl);await new Promise((r,j)=>{ws.once('open',r);ws.once('error',j);});const c=new CDP(ws);await c.send('Page.enable');
for(const v of [{name:'landscape',width:1280,height:800},{name:'portrait',width:800,height:1280}]){await c.send('Emulation.setDeviceMetricsOverride',{width:v.width,height:v.height,deviceScaleFactor:1,mobile:true});await c.send('Page.navigate',{url:base});await pause(2000);await c.ev(`document.getElementById('boot').hidden=true;var note=document.createElement('div');note.textContent='示例数据 · 最新界面预览';note.style.cssText='position:fixed;right:24px;bottom:8px;z-index:10001;font:12px sans-serif;color:white;background:#301016;padding:4px 9px;pointer-events:none';document.body.appendChild(note);`);await pause(1000);
const shot=async name=>{await pause(800);const image=await c.send('Page.captureScreenshot',{format:'jpeg',quality:92});fs.writeFileSync(path.join(OUT,name+'-'+v.name+'.jpg'),Buffer.from(image.data,'base64'));console.log('Saved '+name+'-'+v.name);};
await shot('monitor');await c.ev(`document.getElementById('stCpu').click()`);await shot('cpu-detail');await c.ev(`document.getElementById('detailClose').click();document.querySelectorAll('.page-switch button')[1].click()`);await shot('launch');await c.ev(`document.getElementById('mediaCover').click()`);await shot('mixer');await c.ev(`document.querySelectorAll('.sheet-close').forEach(e=>e.click());document.querySelectorAll('.audio-close').forEach(e=>e.click())`);
// Close the audio sheet through Escape, then accept a real mouse long press.
await c.send('Input.dispatchKeyEvent',{type:'keyDown',key:'Escape',code:'Escape',windowsVirtualKeyCode:27});await c.send('Input.dispatchKeyEvent',{type:'keyUp',key:'Escape',code:'Escape',windowsVirtualKeyCode:27});
await c.ev(`document.querySelector('.audio-backdrop')?.click()`);await pause(500);
const point=await c.ev(`(()=>{const r=document.querySelector('#appGrid .app').getBoundingClientRect();return {x:r.left+r.width/2,y:r.top+25}})()`);await c.send('Input.dispatchMouseEvent',{type:'mousePressed',...point,button:'left',buttons:1,clickCount:1});await pause(600);const sorting=await c.ev(`!!document.querySelector('.favorite-sort-floating')`);if(!sorting)throw Error('Sort preview failed to enter drag mode');await shot('favorite-sort');await c.send('Input.dispatchMouseEvent',{type:'mouseReleased',...point,button:'left',buttons:0,clickCount:1});
}
}finally{if(ws)ws.close();edge.kill();for(const s of wss.clients)s.terminate();wss.close();server.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
