'use strict';
// Preview-only stylesheet injected into an isolated fixture browser. Production files stay unchanged.
const fs = require('fs');
const path = require('path');
let source = fs.readFileSync(path.join(__dirname, 'preview-current.js'), 'utf8');
source = source.replace("path.join(ROOT,'preview','current')", "path.join(ROOT,'preview','favorite-proposal')");
source = source.replace('示例数据 · 最新界面预览', '示例数据 · 常用应用改版预览（待确认）');
const css = `
.app{gap:4px;padding:12px 7px 7px;justify-content:flex-start;min-height:120px}
.app:has(.star){padding-top:12px}
.app .ic{width:34px;height:34px}
.app > b{font-size:12px;line-height:17px;max-width:calc(100% - 8px)}
.app .run-state{font-size:9px;line-height:12px;min-height:12px}
.app .app-ctrl{padding:0;margin-top:0;height:28px}
.app .app-ctrl button,.app .star{appearance:none;-webkit-appearance:none;background:transparent;border:0;box-shadow:none;color:var(--orange);padding:6px;min-width:0;min-height:0}
.app .app-ctrl button{width:40px;height:28px}
.app .app-ctrl button svg{width:17px;height:17px;stroke-width:1.6}
.app .app-ctrl button.close{color:var(--red-bright)}
.app .star{top:0;right:0;width:30px;height:30px;color:var(--ink-faint)}
.app .star svg{width:13px;height:13px;stroke-width:1.5}
.app .star:hover,.app .star:active{color:var(--red-bright);background:transparent}
.app .app-ctrl button:hover{color:var(--amber);background:transparent}
.app .app-ctrl button:active{background:transparent;color:var(--red-bright);border:0}
.add-fav-card{min-height:120px;font-size:12px}
@media(orientation:portrait){.app{min-height:116px}.add-fav-card{min-height:116px}}
`;
const start = source.indexOf("const shot=async name=>");
const end = source.indexOf('\n}\n}finally', start);
if (start < 0 || end < 0) throw Error('Preview template changed');
source = source.slice(0, start) + `
await c.ev("document.querySelectorAll('.page-switch button')[1].click()");
await pause(600);
const before = await c.ev("document.querySelector('#appGrid .app').getBoundingClientRect().height");
await c.ev(${JSON.stringify("var proposalStyle=document.createElement('style');proposalStyle.textContent=" + JSON.stringify(css) + ";document.head.appendChild(proposalStyle);")});
await pause(600);
const after = await c.ev("document.querySelector('#appGrid .app').getBoundingClientRect().height");
const image=await c.send('Page.captureScreenshot',{format:'png'});
fs.writeFileSync(path.join(OUT,'launch-'+v.name+'.png'),Buffer.from(image.data,'base64'));
console.log(JSON.stringify({viewport:v.name,beforeHeight:before,proposalHeight:after,file:path.join(OUT,'launch-'+v.name+'.png')}));
` + source.slice(end);
// Compile with the original script filename so its relative imports and ROOT stay identical.
const Module = require('module');
const preview = new Module(path.join(__dirname, 'preview-current.js'), module);
preview.filename = path.join(__dirname, 'preview-current.js');
preview.paths = module.paths;
preview._compile(source, preview.filename);
