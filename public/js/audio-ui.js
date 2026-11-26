/* SMTC 音频入口与详情式 Windows 调音层。动画表示播放状态，不冒充频谱采样。 */
(function () {
  'use strict';
  window.NervAudioUI = { init: function (opts) {
    var $ = function (id) { return document.getElementById(id); };
    var media = null, timer = 0, refreshTimer = 0, visible = false, busy = false, pendingRead = false;
    var rows = new Map(), master = null, controls = new Map(), generation = 0;
    var page = document.createElement('section');
    page.id = 'audioPage'; page.className = 'sheet audio-sheet'; page.hidden = true;
    page.setAttribute('role', 'dialog'); page.setAttribute('aria-modal', 'true'); page.setAttribute('aria-labelledby', 'audioTitle');
    page.innerHTML = '<div class="sheet-box audio-box"><div class="sheet-head"><div><h3 id="audioTitle">调音</h3><div class="sh-en">SOUND CONTROL</div></div><button type="button" class="sheet-close" id="audioBack">关闭 ✕</button></div><p id="audioStatus" role="status">正在连接…</p>' +
      '<div class="audio-content"><section class="audio-playing panel cut"><div class="audio-section-title">正在播放 <small>NOW PLAYING</small></div><div class="audio-now"><div class="audio-art"><img id="audioArtwork" alt="当前媒体封面" hidden><span id="audioArtworkFallback">NERV</span></div><div class="audio-track"><h2 id="audioTrack">暂无播放</h2><p id="audioArtist"></p><span id="audioSource"></span></div><div class="mctrl"><button type="button" id="audioPrev" aria-label="上一首">◀◀</button><button type="button" class="main" id="audioPlay" aria-label="播放">▶</button><button type="button" id="audioNext" aria-label="下一首">▶▶</button></div></div><div class="audio-timeline"><span id="audioPosition">--:--</span><progress id="audioProgress" max="1" value="0" aria-label="播放进度"></progress><span id="audioDuration">--:--</span></div></section>' +
      '<section class="audio-master panel cut"><label for="audioMaster">主音量 <small>MASTER OUTPUT</small></label><input id="audioMaster" type="range" min="0" max="100" step="1" disabled><output id="audioMasterPct">—</output></section>' +
      '<section class="audio-sessions panel cut"><div class="audio-section-title">应用音量 <small>APPLICATION MIXER</small></div><p class="audio-hint">滑动调节各应用音量 · 点击静音独立控制</p><div id="audioRows"></div><p id="audioEmpty">正在读取音频会话…</p></section></div></div>';
    document.body.appendChild(page);
    function text(id, value) { $(id).textContent = value || ''; }
    function format(sec) { if (typeof sec !== 'number' || !isFinite(sec)) return '--:--'; sec = Math.max(0, Math.floor(sec)); return Math.floor(sec / 60) + ':' + String(sec % 60).padStart(2, '0'); }
    function report(err) { opts.toast('调音失败：' + err.message, true); }
    function readMedia() { return fetch('/api/media', {cache:'no-store'}).then(function(r){if(!r.ok)throw new Error('媒体读取失败');return r.json();}).then(function(j){ renderMedia(j.ok ? j.media : null); }).catch(function(){renderMedia(null);}); }
    function thumbnail(img, hash) {
      var src = hash ? '/api/media/thumbnail?hash=' + encodeURIComponent(hash) : '';
      if (!src) { img.hidden = true; img.removeAttribute('src'); return; }
      if (img.getAttribute('src') !== src) { img.hidden = true; img.onload = function(){img.hidden=false;}; img.onerror=function(){img.hidden=true;}; img.src=src; }
    }
    function renderMedia(m) {
      media = m; var ok = !!(m && m.available), playing = ok && !!m.isPlaying;
      var appName = ok ? (m.appName || m.app || '未知应用') : '暂无播放';
      text('mediaAppName', appName); text('neState', ok ? (playing ? 'PLAYING' : 'PAUSED') : 'NO SESSION');
      text('trackName', ok ? (m.title || '未提供标题') : '暂无播放');
      text('trackArtist', ok ? (m.artist || '') : ''); $('trackArtist').hidden = !(ok && m.artist);
      $('mediaCover').classList.toggle('playing', playing); $('eqBars').classList.toggle('on', playing);
      $('mediaCover').style.setProperty('--cover-h', Math.max(0,$('mediaCover').clientHeight-2)+'px');
      text('mcBadge', playing ? '[ AUDIO STREAM ACTIVE ]' : '[ AUDIO STREAM STANDBY ]');
      text('audioTrack', ok ? (m.title || '未提供标题') : '暂无播放'); text('audioArtist', ok ? m.artist : ''); text('audioSource', ok ? appName : '打开播放器后将在这里显示');
      thumbnail($('audioArtwork'), ok && m.thumbHash); $('audioArtworkFallback').hidden = !!(ok && m.thumbHash);
      $('audioArtwork').onerror = function(){this.hidden=true;$('audioArtworkFallback').hidden=false;};
      ['audioPrev','audioPlay','audioNext'].forEach(function(id){$(id).disabled=!ok||busy;});
      text('audioPlay', playing ? 'Ⅱ' : '▶'); $('audioPlay').setAttribute('aria-label',playing?'暂停':'播放');
      var duration = ok && typeof m.duration === 'number' && m.duration > 0 ? m.duration : null;
      text('audioPosition', duration !== null ? format(m.position) : '--:--'); text('audioDuration',format(duration));
      $('audioProgress').max = duration || 1; $('audioProgress').value = duration ? Math.min(duration,Math.max(0,m.position||0)) : 0;
      $('audioProgress').setAttribute('aria-valuetext', duration ? format(m.position)+' / '+format(duration) : '当前来源未提供播放进度');
    }
    function control(action) {
      if (!media || !media.available || busy) return;
      busy = true; var app=media.app; renderMedia(media);
      opts.post('/api/media/control',{action:action,expectedApp:app}).then(readMedia).catch(report).then(function(){busy=false;renderMedia(media);});
    }
    $('audioPrev').onclick=function(){control('prev');}; $('audioNext').onclick=function(){control('next');}; $('audioPlay').onclick=function(){control(media && media.isPlaying?'pause':'play');};
    // 各会话独立排队：最多约 7 次/秒；在途时保留最新意图，松手一定提交最终值。
    function stateFor(id) { if(!controls.has(id))controls.set(id,{timer:0,busy:false,next:null,last:0,editing:false,until:0});return controls.get(id); }
    function volume(id,value,final) {
      var st=stateFor(id);st.next=Number(value);st.until=Date.now()+1800;
      function send(){st.timer=0;if(st.busy||st.next===null)return;var v=st.next;st.next=null;st.busy=true;st.last=Date.now();opts.post('/api/audio/volume',{id:id,volume:v}).catch(function(e){st.until=0;report(e);}).then(function(){st.busy=false;if(st.next!==null)st.timer=setTimeout(send,Math.max(0,140-(Date.now()-st.last)));else if(visible)readSessions();});}
      if(final)clearTimeout(st.timer);
      if(st.busy)return;
      if(!st.timer||final) {clearTimeout(st.timer);st.timer=setTimeout(send,final?0:Math.max(0,140-(Date.now()-st.last)));}
    }
    function bindSlider(slider,out,getId) {
      slider.addEventListener('pointerdown',function(){var id=getId();if(id)stateFor(id).editing=true;});
      slider.addEventListener('input',function(){var id=getId();if(!id)return;out.textContent=slider.value+'%';volume(id,slider.value,false);});
      function finish(){var id=getId();if(!id)return;stateFor(id).editing=false;volume(id,slider.value,true);}
      slider.addEventListener('change',finish);slider.addEventListener('pointerup',finish);slider.addEventListener('pointercancel',finish);slider.addEventListener('blur',function(){var id=getId();if(id)stateFor(id).editing=false;});
    }
    bindSlider($('audioMaster'),$('audioMasterPct'),function(){return master&&master.id;});
    function createRow(s) {
      var el=document.createElement('div');el.className='audio-session';el.dataset.id=s.id;
      var icon=document.createElement('div');icon.className='audio-app-icon';
      var name=document.createElement('b');name.className='audio-app-name';
      var range=document.createElement('input');range.type='range';range.min=0;range.max=100;range.step=1;
      var out=document.createElement('output');
      var mute=document.createElement('button');mute.type='button';mute.className='audio-mute';
      el.append(icon,name,range,out,mute);var row={el:el,icon:icon,name:name,range:range,out:out,mute:mute,session:s};
      bindSlider(range,out,function(){return row.session.id;});
      mute.onclick=function(){mute.disabled=true;opts.post('/api/audio/mute',{id:row.session.id,muted:!row.session.muted}).then(function(){row.session.muted=!row.session.muted;updateRow(row,row.session);}).catch(report).then(function(){mute.disabled=false;if(visible)readSessions();});};
      return row;
    }
    function updateRow(row,s) {
      row.session=s; row.range.disabled=!!s.unavailable; row.mute.disabled=!!s.unavailable; row.name.textContent=s.name || (s.isSystem?'系统声音':'未知应用');row.range.setAttribute('aria-label',row.name.textContent+'音量');
      var st=stateFor(s.id), locked=st.editing||st.busy||st.next!==null||Date.now()<st.until;
      if(!locked){row.range.value=Number(s.volume)||0;row.out.textContent=Math.round(Number(s.volume)||0)+'%';}
      if(s.unavailable)row.out.textContent='—';
      row.mute.textContent=s.unavailable?'不可用':s.muted?'取消静音':'静音';row.mute.setAttribute('aria-pressed',String(!!s.muted));row.mute.setAttribute('aria-label',row.name.textContent+(s.muted?'取消静音':'静音'));
      var key=s.iconHash||'';
      if(row.icon.dataset.hash!==key || !row.icon.hasChildNodes()){
        row.icon.dataset.hash=key;row.icon.textContent=s.isSystem?'◈':(row.name.textContent.charAt(0)||'□');
        if(key){var img=document.createElement('img');img.alt='';img.src='/api/audio/icons/'+encodeURIComponent(key);img.onerror=function(){this.remove();};row.icon.appendChild(img);}
      }
    }
    function renderSessions(j) {
      if(!j||!j.ok)throw new Error(j&&j.message||'无法读取音频会话');
      master=j.master||null;var slider=$('audioMaster'), st=master&&stateFor(master.id);
      slider.disabled=!master;
      if(master&&!(st.editing||st.busy||st.next!==null||Date.now()<st.until)){slider.value=master.volume; text('audioMasterPct',Math.round(master.volume)+'%');}
      if(!master)text('audioMasterPct','—');
      var sessions=(j.sessions||[]).filter(function(s){return s.isSystemSounds || s.active !== false;}), seen=new Set(), activeCount=0;
      sessions.forEach(function(s){s.isSystem=!!s.isSystemSounds;});
      if(!sessions.some(function(s){return s.isSystem;})) sessions.push({id:'system-unavailable',name:'系统声音（暂无会话）',isSystem:true,unavailable:true,volume:0,muted:false});
      sessions.forEach(function(s){seen.add(s.id);if(!s.isSystem)activeCount++;var row=rows.get(s.id);if(!row){row=createRow(s);rows.set(s.id,row);$('audioRows').appendChild(row.el);}updateRow(row,s);});
      rows.forEach(function(row,id){if(!seen.has(id)&&!stateFor(id).editing&&!stateFor(id).busy){row.el.remove();rows.delete(id);controls.delete(id);}});
      text('audioEmpty',activeCount?'':'当前没有应用在发声');$('audioEmpty').hidden=!!activeCount;
      text('audioStatus',master ? '已连接 · '+activeCount+' 个应用' : '当前没有可用音频输出设备');
    }
    function readSessions() {
      if(pendingRead||!visible||document.hidden)return Promise.resolve();pendingRead=true;var gen=generation;
      return fetch('/api/audio/sessions',{cache:'no-store'}).then(function(r){return r.json();}).then(function(j){if(gen===generation&&visible)renderSessions(j);}).catch(function(e){if(gen===generation){text('audioStatus','音频连接不可用');text('audioEmpty',e.message||'无法读取音频会话');$('audioEmpty').hidden=false;$('audioMaster').disabled=true;rows.forEach(function(row){row.range.disabled=true;row.mute.disabled=true;});}}).then(function(){pendingRead=false;});
    }
    function open(){if(visible)return;visible=true;generation++;page.hidden=false;page.classList.add('open');document.getElementById('pagerViewport')?.setAttribute('inert','');readMedia();readSessions();refreshTimer=setInterval(readSessions,1000);$('audioBack').focus();}
    function close(){visible=false;generation++;page.hidden=true;page.classList.remove('open');document.getElementById('pagerViewport')?.removeAttribute('inert');clearInterval(refreshTimer);$('mediaCover').focus();}
    $('mediaCover').onclick=open;$('audioBack').onclick=close;
    page.addEventListener('click',function(e){if(e.target===page)close();});
    function start(){if(timer)return;readMedia();timer=setInterval(readMedia,1500);if(visible)readSessions();}
    function stop(){clearInterval(timer);timer=0;}
    document.addEventListener('visibilitychange',function(){if(!document.hidden&&visible)readSessions();});
    return {renderMedia:renderMedia,start:start,stop:stop,open:open,close:close,isOpen:function(){return visible;}};
  }};
})();
