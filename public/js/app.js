/* =========================================================================
   NERV PANEL — 前端主脚本
   只做 2 页：[监控] [启动]，监控是第一页。
   数据来源：WS /ws/metrics（优先）→ HTTP 轮询（降级）→ 如实显示离线。
   所有读不到的字段显示「—」，绝不编随机数。唯一例外是总览页「同步率」，
   它是主题装饰数值，不对应任何真实硬件指标（需求 5.1 明确允许）。
   ========================================================================= */
(function () {
  "use strict";

  var $ = function (id) { return document.getElementById(id); };
  var pad = function (n) { return n < 10 ? "0" + n : "" + n; };
  var clamp = function (v, a, b) { return v < a ? a : v > b ? b : v; };
  var EMPTY = "—";
  var REDUCED = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  /* ---------- 数值工具 ---------- */
  function num(v) { return typeof v === "number" && isFinite(v) ? v : null; }
  function pct(v) { return clamp(num(v) || 0, 0, 100); }
  function setText(el, t) { if (el) el.textContent = t; }
  function fixed(v, n) { var x = num(v); return x === null ? null : x.toFixed(n); }
  /* 读不到的字段一律输出「—」，不输出 0 假装有数据 */
  function show(v, digits, unit) {
    var x = num(v);
    if (x === null) return EMPTY;
    return (digits == null ? x : x.toFixed(digits)) + (unit || "");
  }
  function gb(bytes) {
    var x = num(bytes);
    if (x === null || x <= 0) return null;
    var g = x / (1024 * 1024 * 1024);
    return g >= 100 ? g.toFixed(0) : g.toFixed(1);
  }
  function mbps(v) {
    var x = num(v);
    if (x === null) return EMPTY;
    if (x >= 1) return x.toFixed(2);
    return x.toFixed(2);
  }
  function fmtDuration(sec) {
    var s = Math.max(0, Math.floor(num(sec) || 0));
    var h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), ss = s % 60;
    if (h > 0) return h + " 小时 " + pad(m) + " 分";
    return m + " 分 " + pad(ss) + " 秒";
  }

  /* ---------- 全局状态 ---------- */
  var current = 0;
  var TOTAL = 2;
  var conn = { ws: null, online: false, retry: 0, retryTimer: 0, pollTimer: 0, everConnected: false, lastMsgAt: 0, latency: null };
  var REFRESH_SEC = 1;
  var serverConfig = {};
  var serverStatus = null;
  var connectedAt = 0;
  var latestMetrics = null;
  var HIST_LEN = 60;
  var hist = { cpu: [], gpu: [], ram: [], netUp: [], netDown: [] };
  var sparks = {
    cpu: { id: "cpuSpark", color: "#ff8c1a" },
    gpu: { id: "gpuSpark", color: "#e8321e" },
    ram: { id: "ramSpark", color: "#ffb52e" },
    net: { id: "netSpark", color: "#39c2d7" }
  };

  /* ---------- toast / 二次确认 ---------- */
  var toastTimer = 0;
  /* 应用名来自快捷方式文件名，拼进 innerHTML 前必须转义，否则名字里的标签会被执行 */
  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }
  function toast(msg, isErr) {
    var el = $("toast");
    if (!el) return;
    el.innerHTML = msg;
    el.style.borderColor = isErr ? "var(--red-bright)" : "var(--red)";
    el.classList.add("show");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { el.classList.remove("show"); }, 3200);
  }
  var modalResolve = null;
  function confirmBox(title, text, okText) {
    return new Promise(function (resolve) {
      modalResolve = resolve;
      setText($("modalTitle"), title);
      setText($("modalText"), text);
      setText($("modalOk"), okText || "确认");
      $("modal").classList.add("open");
    });
  }
  function closeModal(ok) {
    $("modal").classList.remove("open");
    if (modalResolve) { var r = modalResolve; modalResolve = null; r(!!ok); }
  }
  $("modalCancel").addEventListener("click", function () { closeModal(false); });
  $("modalOk").addEventListener("click", function () { closeModal(true); });

  /* ---------- 令牌（存 localStorage，不从服务端下发） ---------- */
  var TOKEN_KEY = "nerv.token";
  function getToken() { try { return localStorage.getItem(TOKEN_KEY) || ""; } catch (e) { return ""; } }
  function setToken(v) { try { if (v) localStorage.setItem(TOKEN_KEY, v); else localStorage.removeItem(TOKEN_KEY); } catch (e) {} }

  function apiPost(url, body, opts) {
    opts = opts || {};
    var headers = { "X-NERV-Token": getToken() };
    if (!opts.raw) headers["Content-Type"] = "application/json";
    return fetch(url, {
      method: "POST",
      headers: headers,
      body: opts.raw ? body : JSON.stringify(body || {})
    }).then(function (r) {
      return r.json().catch(function () { return {}; }).then(function (j) {
        if (!r.ok || j.ok === false) {
          var m = j.message || ("HTTP " + r.status);
          throw new Error(m);
        }
        return j;
      });
    });
  }

  /* =====================================================================
     翻页：2 页轨道 + 右上角滑动胶囊 + 页码点 + 左右滑动 + 方向键 + 箭头
     ===================================================================== */
  var track = $("pagerTrack");
  var viewport = $("pagerViewport");
  var pages = Array.prototype.slice.call(document.querySelectorAll(".page"));
  var swBtns = Array.prototype.slice.call(document.querySelectorAll(".page-switch button"));
  var dotBtns = Array.prototype.slice.call(document.querySelectorAll("#dots button"));
  var psInd = null;
  var SW_MIN = 56;

  function initSwitchInd() {
    var box = document.querySelector(".page-switch");
    if (!box || psInd) return;
    psInd = document.createElement("i");
    psInd.className = "ps-ind";
    box.insertBefore(psInd, box.firstChild);
    box.classList.add("has-ind");
  }
  /* 高亮胶囊只移动同一个元素（transform + width），不做两套高亮显隐 */
  function movePsInd() {
    if (!psInd) return;
    var b = swBtns[current];
    if (!b || !b.offsetWidth) return;
    psInd.style.width = b.offsetWidth + "px";
    psInd.style.transform = "translate3d(" + b.offsetLeft + "px,0,0)";
  }

  function goTo(n, opts) {
    opts = opts || {};
    n = clamp(n, 0, TOTAL - 1);
    var prev = current;
    if (n === prev && !opts.force) return;
    current = n;
    if (opts.instant) track.classList.add("dragging");
    track.style.transform = "translate3d(" + (-current * 100) + "%,0,0)";
    if (opts.instant) requestAnimationFrame(function () { track.classList.remove("dragging"); });

    swBtns.forEach(function (b, i) { b.classList.toggle("on", i === current); });
    dotBtns.forEach(function (b, i) { b.classList.toggle("on", i === current); });
    movePsInd();

    var page = pages[current];
    if (page) {
      setText($("pageTitle"), page.getAttribute("data-title") || "");
      var inner = page.querySelector(".page-in");
      if (inner && !opts.instant && !REDUCED) {
        var cls = current > prev ? "pg-in-r" : "pg-in-l";
        inner.classList.remove("pg-in-r", "pg-in-l");
        void inner.offsetWidth;
        inner.classList.add(cls);
        setTimeout(function () { inner.classList.remove(cls); }, 560);
      }
    }
    notifyVisible(prev);
  }

  swBtns.forEach(function (b) {
    b.addEventListener("click", function () { goTo(parseInt(b.getAttribute("data-page"), 10) || 0); });
  });
  dotBtns.forEach(function (b, i) {
    b.addEventListener("click", function () { goTo(i); });
  });

  document.addEventListener("keydown", function (e) {
    if (e.key === "Escape") {
      if ($("modal").classList.contains("open")) { closeModal(false); return; }
      if ($("detailSheet").classList.contains("open")) { closeDetail(); return; }
      if ($("pickSheet").classList.contains("open")) { closePick(); return; }
      if ($("settingsSheet").classList.contains("open")) { closeSettings(); return; }
    }
    if ($("detailSheet").classList.contains("open") || $("pickSheet").classList.contains("open") || $("settingsSheet").classList.contains("open")) return;
    if ($("modal").classList.contains("open")) return;
    if (e.key === "ArrowLeft") goTo(current - 1);
    if (e.key === "ArrowRight") goTo(current + 1);
  });

  /* 设置面板入口：启动页底部第 5 个按钮（需求一.3：设置从顶栏移到启动页下面） */
  function openSettings() {
    $("settingsSheet").classList.add("open");
    fillSettings();
    renderSystemStatus();
    fetchStatus().then(renderSystemStatus).catch(function () {});
  }
  function closeSettings() { $("settingsSheet").classList.remove("open"); }
  if ($("openSettingsRowBtn")) $("openSettingsRowBtn").addEventListener("click", openSettings);
  if ($("settingsClose")) $("settingsClose").addEventListener("click", closeSettings);
  $("settingsSheet").addEventListener("click", function (e) { if (e.target === $("settingsSheet")) closeSettings(); });

  /* 左右滑动翻页（触屏 + 鼠标拖动） */
  (function () {
    var sx = 0, sy = 0, dx = 0, dy = 0, tracking = false, fromScroll = false;
    function start(x, y, target) {
      sx = x; sy = y; dx = 0; dy = 0; tracking = true;
      fromScroll = !!(target && target.closest && target.closest("canvas,.search-box,.set-grid,.pwr,.mctrl,#detailSheet,#pickSheet"));
    }
    function move(x, y, e) {
      if (!tracking) return;
      dx = x - sx; dy = y - sy;
      if (Math.abs(dx) > 12 && Math.abs(dx) > Math.abs(dy) * 1.6) {
        if (e && e.cancelable) e.preventDefault();
      }
    }
    function end() {
      if (!tracking) return;
      tracking = false;
      if (fromScroll) return;
      if (Math.abs(dx) > SW_MIN && Math.abs(dx) > Math.abs(dy) * 1.6) {
        goTo(dx < 0 ? current + 1 : current - 1);
      }
    }
    viewport.addEventListener("touchstart", function (e) {
      if (e.touches.length !== 1) return;
      start(e.touches[0].clientX, e.touches[0].clientY, e.target);
    }, { passive: true });
    viewport.addEventListener("touchmove", function (e) {
      if (e.touches.length !== 1) return;
      move(e.touches[0].clientX, e.touches[0].clientY, e);
    }, { passive: false });
    viewport.addEventListener("touchend", end);
    viewport.addEventListener("mousedown", function (e) {
      if (e.button !== 0) return;
      start(e.clientX, e.clientY, e.target);
    });
    window.addEventListener("mousemove", function (e) { move(e.clientX, e.clientY, null); });
    window.addEventListener("mouseup", end);
  })();

  /* =====================================================================
     可见性调度：不可见页面的定时器 / 绘图一律停掉
     ===================================================================== */
  var visibleHooks = [];
  function notifyVisible(prev) {
    /* 传给钩子的是「当前页面下标」与「上一次页面下标」，不是钩子在数组里的下标。
       两者语义完全不同：用 i 当页面下标会让所有页都判定成不可见。 */
    visibleHooks.forEach(function (fn) { fn(current, prev); });
  }
  var hiddenPaused = false;

  /* =====================================================================
     开机动画 —— MAGI 三贤人表决
     顺序（需求 6.2 硬性要求）：
       初始三台都不表决（不显示「承認」）
       → MELCHIOR-1 先亮「承認」
       → BALTHASAR-2 亮「承認」
       → CASPER-3 显示红色「否定」
       → CASPER-3 改判，红「否定」翻转成绿「承認」
       → 三台全承認 + 中央核心全亮 → 整页上滑退场
     ===================================================================== */
  var boot = $("boot");
  var SEG_N = 20;
  var bootLines = [
    { t: "MAGI SYSTEM 表决开始", c: "sys" },
    { t: "驾驶员识别 ASUKA LANGLEY · 同步正常", c: "" },
    { t: "EVA-02 神经链接 A10 回路 接入", c: "" },
    { t: "LCL 注入 / 主电源 接续", c: "" },
    { t: "局域网链路 · 状态采集 就绪", c: "ok" },
    { t: "分页甲板载入：监控 / 启动", c: "ok" }
  ];
  var phases = [
    "INITIALIZE",
    "BALTHASAR-2 VOTE",
    "CASPER-3 VOTE",
    "MELCHIOR-1 VOTE",
    "MAJORITY DECISION",
    "LINK ESTABLISHED"
  ];
  var bootLog = $("bootLog");
  var bootSegs = $("bootSegs");
  var bootPct = $("bootPct");
  var bootPhase = $("bootPhase");
  var segEls = [];
  var progress = 0;
  var progressDone = false;
  var voteDone = false;
  var bootDismissed = false;
  var bootTimers = [];

  for (var si = 0; si < SEG_N; si++) {
    var se = document.createElement("i");
    bootSegs.appendChild(se);
    segEls.push(se);
  }
  function pushLog(text, cls) {
    if (!bootLog) return;
    var d = document.createElement("div");
    d.className = cls || "";
    d.textContent = text;
    bootLog.appendChild(d);
    while (bootLog.children.length > 6) bootLog.removeChild(bootLog.firstChild);
  }
  function setSegs() {
    var on = Math.round((progress / 100) * SEG_N);
    for (var i = 0; i < SEG_N; i++) segEls[i].classList.toggle("on", i < on);
    setText(bootPct, Math.round(progress) + "%");
    var pi = Math.min(phases.length - 1, Math.floor((progress / 100) * phases.length));
    setText(bootPhase, phases[pi]);
  }
  /* 三台主机各自连到中央核心的那条线（连线在 HTML 里是固定元素，这里按名字对上） */
  var VOTE_LINE = { voteBalthasar: "lineTop", voteCasper: "lineBl", voteMelchior: "lineBr" };
  /* 印章：先点亮整台主机，再盖上文字（casper 的否定在改判时才带翻转动效） */
  function litHost(id, stampText, deny, flip) {
    var box = $(id);
    if (!box) return;
    box.classList.remove("thinking");
    box.classList.add("lit");
    box.classList.toggle("deny", !!deny);
    var st = box.querySelector(".vb-stamp");
    if (st) {
      st.textContent = stampText;
      if (flip) {
        st.classList.remove("flip");
        void st.offsetWidth;
        st.classList.add("flip");
      }
    }
    var line = $(VOTE_LINE[id]);
    if (line) line.classList.add("lit");
  }

  function dismissBoot() {
    if (bootDismissed) return;
    bootDismissed = true;
    boot.classList.add("done");
    bootTimers.forEach(clearTimeout);
    bootTimers = [];
    setTimeout(function () {
      boot.style.display = "none";
      startVisibleTimers();
    }, 900);
  }

  function startBoot() {
    pushLog(bootLines[0].t, bootLines[0].c);
    setSegs();
    var li = 1;
    var lineTimer = setInterval(function () {
      if (li >= bootLines.length) { clearInterval(lineTimer); return; }
      pushLog(bootLines[li].t, bootLines[li].c);
      li++;
    }, 430);
    bootTimers.push(lineTimer);
    /* 进度条固定步进，不用随机数 */
    var barTimer = setInterval(function () {
      progress = Math.min(100, progress + 5);
      setSegs();
      if (progress >= 100) {
        clearInterval(barTimer);
        progressDone = true;
        maybeDismiss();
      }
    }, 160);
    bootTimers.push(barTimer);

    /* 表决序列：总时长控制在 3–5 秒（不含退场上滑） */
    var steps = [
      [500, function () { litHost("voteMelchior", "承認", false, true); pushLog("MELCHIOR-1 · 承認", "ok"); }],
      [1250, function () { litHost("voteBalthasar", "承認", false, true); pushLog("BALTHASAR-2 · 承認", "ok"); }],
      [2000, function () {
        var c = $("voteCasper");
        if (c) { c.classList.add("lit", "deny", "thinking"); c.querySelector(".vb-stamp").textContent = "否定"; }
        pushLog("CASPER-3 · 否定", "warn");
      }],
      [3050, function () {
        var c = $("voteCasper");
        if (c) c.classList.remove("thinking");
        litHost("voteCasper", "承認", false, true);
        var core = $("voteCore");
        if (core) core.classList.add("lit");
        pushLog("表决结果 2:1 · 多数通过", "ok");
        voteDone = true;
        maybeDismiss();
      }]
    ];
    steps.forEach(function (s) { bootTimers.push(setTimeout(s[1], s[0])); });
    /* 兜底：任何异常都必须在 6 秒内退出开机动画 */
    bootTimers.push(setTimeout(function () { voteDone = true; progressDone = true; dismissBoot(); }, 6000));
  }
  function maybeDismiss() {
    if (progressDone && voteDone) bootTimers.push(setTimeout(dismissBoot, 420));
  }
  /* 背景视差 */
  if (!REDUCED) {
    document.addEventListener("pointermove", function (e) {
      var x = (e.clientX / window.innerWidth - 0.5) * -16;
      var y = (e.clientY / window.innerHeight - 0.5) * -10;
      boot.style.setProperty("--px", x.toFixed(1) + "px");
      boot.style.setProperty("--py", y.toFixed(1) + "px");
    }, { passive: true });
  }

  /* =====================================================================
     时钟 / 日历 / 同步率（同步率是主题装饰，不对应真实硬件）
     ===================================================================== */
  var clockTimer = 0, clockOn = false;
  var syncTimer = 0;
  function tickClock() {
    var d = new Date();
    setText($("clockHM"), pad(d.getHours()) + ":" + pad(d.getMinutes()));
    setText($("clockS"), ":" + pad(d.getSeconds()));
    var wk = ["星期日", "星期一", "星期二", "星期三", "星期四", "星期五", "星期六"][d.getDay()];
    setText($("dateLine"), d.getFullYear() + " 年 " + (d.getMonth() + 1) + " 月 " + d.getDate() + " 日");
    setText($("weekLine"), wk);
    var connEl = document.querySelector(".dateline .wk");
    if (connEl) connEl.textContent = wk;
    renderLineDate();
  }
  function renderLineDate() { /* dateline 已拆成 #dateLine / #weekLine 两个元素 */ }
  function scheduleClockTick() {
    if (!clockOn) return;
    var wait = 1000 - new Date().getMilliseconds();
    clockTimer = setTimeout(function () { clockTimer = 0; if (!clockOn) return; tickClock(); scheduleClockTick(); }, wait);
  }
  function startClock() { if (clockOn) return; clockOn = true; tickClock(); scheduleClockTick(); }
  function stopClock() { clockOn = false; clearTimeout(clockTimer); clockTimer = 0; }

  function renderCalendar(y, m) {
    var now = new Date();
    if (y == null) y = now.getFullYear();
    if (m == null) m = now.getMonth();
    setText($("calTitle"), y + " 年 " + (m + 1) + " 月");
    var first = new Date(y, m, 1);
    var days = new Date(y, m + 1, 0).getDate();
    var prevDays = new Date(y, m, 0).getDate();
    var lead = first.getDay();
    var html = "";
    ["日", "一", "二", "三", "四", "五", "六"].forEach(function (w) { html += '<div class="dow">' + w + "</div>"; });
    for (var i = lead - 1; i >= 0; i--) html += '<div class="day dim">' + (prevDays - i) + "</div>";
    for (var d = 1; d <= days; d++) {
      var cls = "day";
      var wd = (lead + d - 1) % 7;
      if (wd === 0 || wd === 6) cls += " weekend";
      if (y === now.getFullYear() && m === now.getMonth() && d === now.getDate()) cls += " today";
      /* 监控页主卡日历只显示日期（需求一.1）：
         节日 / 农历 / 节气一律不在卡面出现，全部留给点开后的大日历详情。 */
      html += '<div class="' + cls + '">' + d + "</div>";
    }
    var tail = (7 - ((lead + days) % 7)) % 7;
    for (var t = 1; t <= tail; t++) html += '<div class="day dim">' + t + "</div>";
    $("calGrid").innerHTML = html;
    setText($("calSub"), "TODAY " + pad(now.getDate()));
  }

  function startSync() {
    if (syncTimer) return;
    var el = $("syncRate");
    var v = 41.35;
    var set = function () { v = clamp(v + (Math.random() - 0.5) * 1.4, 39.8, 43.6); if (el) el.textContent = v.toFixed(2) + "%"; };
    set();
    syncTimer = setInterval(set, 1800);
  }
  function stopSync() { clearInterval(syncTimer); syncTimer = 0; }

  /* =====================================================================
     主视觉图片
     ===================================================================== */
  function applyHero(url) {
    var img = $("heroImg"), fb = $("heroFallback"), pv = $("heroPreview");
    if (!url) {
      if (img) { img.hidden = true; img.removeAttribute("src"); }
      if (fb) fb.hidden = false;
      if (pv) pv.removeAttribute("src");
      return;
    }
    if (img) {
      img.onload = function () { img.hidden = false; if (fb) fb.hidden = true; };
      img.onerror = function () { img.hidden = true; if (fb) fb.hidden = false; };
      img.src = url;
    }
    if (pv) pv.src = url;
  }
  /* 优先用户自定义图，其次默认图 */
  function heroUrl() {
    /* 上传的图存在 data/hero/ 下，但服务端只通过 /custom-hero/<文件名> 对外提供，
       不能直接拼成 /data/hero/...（那个路径会 404） */
    var custom = serverConfig.customHeroImagePath ? String(serverConfig.customHeroImagePath).replace(/^\/+/, "") : "";
    if (custom) {
      var m = custom.match(/^data[\\/]hero[\\/]([^\\/]+)$/);
      return m ? "/custom-hero/" + encodeURIComponent(m[1]) : "/" + custom;
    }
    if (serverConfig.heroImagePath) return "/" + String(serverConfig.heroImagePath).replace(/^\/+/, "");
    return "/assets/hero.jpg";
  }

  /* =====================================================================
     连接层：WS 优先 → HTTP 轮询降级 → 离线
     ===================================================================== */
  var reconnectSeq = [1000, 2000, 3000, 5000, 8000, 13000, 21000, 30000];
  function setConnUI(state) {
    conn.online = state === "online" || state === "polling";
    var pill = $("connPill"), txt = $("connText");
    if (pill) {
      pill.classList.toggle("online", state === "online");
      pill.classList.toggle("offline", state === "offline");
    }
    setText(txt, state === "online" ? "已连接" : state === "polling" ? "轮询模式" : state === "connecting" ? "连接中" : "离线");
    var off = $("monOffline");
    if (off) off.hidden = state === "online" || state === "polling";
    var sl = $("statusLine");
    if (sl) {
      sl.classList.toggle("off", state === "offline");
      if (state === "online") sl.innerHTML = 'EVA-02 · 同步中 · <b>A.T. FIELD ALL GREEN</b>';
      else if (state === "polling") sl.innerHTML = 'EVA-02 · 轮询链路 · <b>A.T. FIELD STABLE</b>';
      else if (state === "connecting") sl.innerHTML = 'EVA-02 · 链路建立中 · <b>A.T. FIELD SYNCING</b>';
      else sl.innerHTML = 'EVA-02 · <b>连接中断</b> · A.T. FIELD LOST';
    }
    var cs = $("connState");
    if (cs) {
      cs.textContent = state === "online" ? "已连接" : state === "polling" ? "轮询模式" : state === "connecting" ? "连接中" : "未连接";
      cs.classList.toggle("off", state === "offline");
    }
    /* 连接状态一变就同步刷新系统页的连接信息，否则该页会一直停在「未连接 / —」 */
    if (typeof renderSystemStatus === "function") renderSystemStatus();
    if (state === "online" && !connectedAt) connectedAt = Date.now();
    if (state === "offline") connectedAt = 0;
    if (conn.online) fetchStatus().then(renderSystemStatus).catch(function () {});
  }

  function connectWs() {
    if (!window.WebSocket) { startPolling(); return; }
    var proto = location.protocol === "https:" ? "wss:" : "ws:";
    var tk = getToken();
    var wsPath = "/ws/metrics" + (tk ? "?token=" + encodeURIComponent(tk) : "");
    var ws;
    try { ws = new WebSocket(proto + "//" + location.host + wsPath); }
    catch (e) { startPolling(); return; }
    conn.ws = ws;
    setConnUI("connecting");
    ws.onopen = function () {
      conn.retry = 0;
      conn.everConnected = true;
      conn.lastMsgAt = Date.now();
      stopPolling();
      setConnUI("online");
    };
    ws.onmessage = function (ev) {
      var msg;
      try { msg = JSON.parse(ev.data); } catch (e) { return; }
      conn.lastMsgAt = Date.now();
      if (!conn.online) setConnUI("online");
      if (msg && msg.type === "metrics" && msg.data) renderMetrics(msg.data);
    };
    ws.onerror = function () {};
    ws.onclose = function () {
      conn.ws = null;
      if (conn.everConnected && conn.retry >= 2) { setConnUI("offline"); startPolling(); }
      else { startPolling(); }
      scheduleReconnect();
    };
  }
  function scheduleReconnect() {
    if (conn.retryTimer) return;
    var delay = reconnectSeq[Math.min(conn.retry, reconnectSeq.length - 1)];
    conn.retry++;
    conn.retryTimer = setTimeout(function () { conn.retryTimer = 0; connectWs(); }, delay);
  }
  function startPolling() {
    if (conn.pollTimer) return;
    conn.pollTimer = setInterval(pollOnce, Math.max(1, REFRESH_SEC) * 1000);
    pollOnce();
  }
  function stopPolling() { if (conn.pollTimer) { clearInterval(conn.pollTimer); conn.pollTimer = 0; } }
  function pollOnce() {
    var t0 = Date.now();
    fetch("/api/metrics").then(function (r) { return r.json(); }).then(function (j) {
      if (!j || !j.ok) throw new Error("bad");
      conn.latency = Date.now() - t0;
      conn.lastMsgAt = Date.now();
      if (!conn.online) setConnUI(conn.ws ? "online" : "polling");
      renderMetrics(j.metrics || j.data || j);
    }).catch(function () {
      conn.latency = null;
      if (!conn.ws) setConnUI("offline");
    });
  }
  /* 看门狗：WS 长时间没有消息即视为掉线，主动断开走重连 */
  setInterval(function () {
    if (conn.ws && conn.lastMsgAt && Date.now() - conn.lastMsgAt > 6000) {
      try { conn.ws.close(); } catch (e) {}
    }
  }, 3000);

  /* =====================================================================
     指标渲染
     ===================================================================== */
  function setBar(el, v) {
    if (!el) return;
    el.style.transform = "scaleX(" + pct(v) / 100 + ")";
  }
  function renderMetrics(m) {
    latestMetrics = m;
    var c = m.cpu || {}, g = m.gpu || {}, r = m.ram || {}, n = m.net || {};
    var disks = m.disks || [];
    /* —— 硬件卡：CPU / GPU / 内存 / 网络各只渲染一次（旧的四张小卡已合并进来） —— */
    setText($("cpuName"), c.name || EMPTY);
    setText($("cpuTemp"), c.temp == null ? "温度 " + EMPTY : Math.round(c.temp) + "°C");
    setText($("cpuUse"), c.usage == null ? EMPTY : Math.round(c.usage));
    var cpuFreq = num(c.freq);
    setText($("cpuSub"), (cpuFreq == null ? "频率 " + EMPTY : "频率 " + (cpuFreq / 1000).toFixed(2) + " GHz"));
    setBar($("cpuBar"), c.usage);
    var cpuCard = $("stCpu");
    if (cpuCard) cpuCard.classList.toggle("hot", num(c.temp) !== null && c.temp >= 80);

    setText($("gpuName"), g.name || EMPTY);
    setText($("gpuTemp"), g.temp == null ? "温度 " + EMPTY : Math.round(g.temp) + "°C");
    setText($("gpuUse"), g.usage == null ? EMPTY : Math.round(g.usage));
    var vu = num(g.vramUsed), vt = num(g.vramTotal);
    setText($("gpuSub"), "显存 " + (vu == null || vt == null ? EMPTY : (vu / 1073741824).toFixed(1) + " / " + (vt / 1073741824).toFixed(1) + " GB"));
    setBar($("gpuBar"), g.usage);
    var gpuCard = $("stGpu");
    if (gpuCard) gpuCard.classList.toggle("hot", num(g.temp) !== null && g.temp >= 85);

    setText($("ramTotal"), (gb(r.used) || EMPTY) + " / " + (gb(r.total) || EMPTY) + " GB");
    setText($("ramUse"), r.usage == null ? EMPTY : Math.round(r.usage));
    setText($("ramSub"), r.usage == null ? "占用 " + EMPTY : "已用 " + Math.round(r.usage) + "%");
    setBar($("ramBar"), r.usage);

    setText($("netDown"), n.down == null ? EMPTY : mbps(n.down));
    setText($("netSub"), "↑ " + (n.up == null ? EMPTY : mbps(n.up)) + " / ↓ " + (n.down == null ? EMPTY : mbps(n.down)));
    setBar($("netBar"), num(n.down) === null ? 0 : Math.min(100, n.down * 20));
    setText($("netMode"), "MB/s");

    /* 风扇：systeminformation 没有风扇接口，WMI 也只给 Cooling Device 不给 RPM，
       读不到就如实显示「—」，绝不编造一个转速。 */
    setText($("fanState"), EMPTY);
    setText($("fanRpm"), EMPTY);
    setText($("fanSub"), "系统接口未提供转速");
    setBar($("fanBar"), 0);

    renderDisks(disks);
    /* 走势线只在本页可见时画 */
    renderSparkData(m);
    if (detailKey) refreshDetailLive();
  }

  function renderDisks(disks) {
    var box = $("diskList");
    if (!box) return;
    setText($("diskCount"), disks.length ? disks.length + " 个分区" : EMPTY);
    if (!disks.length) { box.innerHTML = '<div class="dim">' + EMPTY + "</div>"; return; }
    box.innerHTML = disks.map(function (d) {
      return '<div class="disk-row"><span class="dn">' + (d.name || EMPTY) + "</span>" +
        '<div class="bar cool"><i style="transform:scaleX(' + (pct(d.usage) / 100) + ')"></i></div>' +
        '<span class="dv">' + (gb(d.used) || EMPTY) + " / " + (gb(d.total) || EMPTY) + " GB · " +
        (num(d.usage) === null ? EMPTY : Math.round(d.usage) + "%") + "</span></div>";
    }).join("");
  }

  function pushHist(k, v) {
    var arr = hist[k];
    arr.push(num(v) === null ? null : v);
    while (arr.length > HIST_LEN) arr.shift();
  }
  function renderSparkData(m) {
    var c = m.cpu || {}, g = m.gpu || {}, r = m.ram || {}, n = m.net || {};
    if (c.usage != null) pushHist("cpu", c.usage);
    if (g.usage != null) pushHist("gpu", g.usage);
    if (r.usage != null) pushHist("ram", r.usage);
    if (n.up != null) pushHist("netUp", n.up);
    if (n.down != null) pushHist("netDown", n.down);
    if (current === 0) drawAllSparks();
  }
  /* 走势线只在监控页可见时绘制 */
  function drawAllSparks() {
    drawSpark("cpuSpark", hist.cpu, "#ff8c1a");
    drawSpark("gpuSpark", hist.gpu, "#e8321e");
    drawSpark("ramSpark", hist.ram, "#ffb52e");
    drawSpark("netSpark", hist.netDown, "#39c2d7");
  }
  function fitCanvas(cv) {
    var w = cv.clientWidth || 300, h = cv.clientHeight || 34;
    var dpr = Math.min(window.devicePixelRatio || 1, 2);
    if (cv.width !== Math.round(w * dpr) || cv.height !== Math.round(h * dpr)) {
      cv.width = Math.round(w * dpr);
      cv.height = Math.round(h * dpr);
    }
    var ctx = cv.getContext("2d");
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    return { ctx: ctx, w: w, h: h };
  }
  function drawSpark(id, arr, color) {
    var cv = $(id);
    if (!cv) return;
    var f = fitCanvas(cv), ctx = f.ctx, w = f.w, h = f.h;
    ctx.clearRect(0, 0, w, h);
    var n = arr.length;
    if (!n) return;
    var max = 1, i, v;
    for (i = 0; i < n; i++) { v = num(arr[i]); if (v !== null && v > max) max = v; }
    ctx.beginPath();
    var started = false;
    for (i = 0; i < n; i++) {
      v = num(arr[i]);
      if (v === null) { started = false; continue; }
      var x = n === 1 ? w : (i / (HIST_LEN - 1)) * w;
      var y = h - 3 - (v / max) * (h - 8);
      if (!started) { ctx.moveTo(x, y); started = true; } else ctx.lineTo(x, y);
    }
    ctx.strokeStyle = color;
    ctx.lineWidth = 1.6;
    ctx.lineJoin = "round";
    ctx.stroke();
    ctx.lineTo(w, h); ctx.lineTo(0, h); ctx.closePath();
    var grad = ctx.createLinearGradient(0, 0, 0, h);
    grad.addColorStop(0, color + "44");
    grad.addColorStop(1, color + "00");
    ctx.fillStyle = grad;
    ctx.fill();
  }

  /* =====================================================================
     天气
     ===================================================================== */
  var weatherTimer = 0, weatherData = null;
  var WX_ICON = {
    sun: '<svg viewBox="0 0 48 48" fill="none" stroke="currentColor" stroke-width="2"><circle cx="24" cy="24" r="8"/><path d="M24 6v5M24 37v5M6 24h5M37 24h5M11 11l3.5 3.5M33.5 33.5L37 37M37 11l-3.5 3.5M14.5 33.5L11 37"/></svg>',
    cloud: '<svg viewBox="0 0 48 48" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 32h20a7 7 0 0 0 0-14 11 11 0 0 0-21 2 6 6 0 0 0 1 12z"/></svg>',
    rain: '<svg viewBox="0 0 48 48" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 28h20a7 7 0 0 0 0-14 11 11 0 0 0-21 2 6 6 0 0 0 1 12z"/><path d="M18 34l-2 6M26 34l-2 6M34 34l-2 6"/></svg>',
    snow: '<svg viewBox="0 0 48 48" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 28h20a7 7 0 0 0 0-14 11 11 0 0 0-21 2 6 6 0 0 0 1 12z"/><path d="M18 35v6M15 38h6M28 35v6M25 38h6"/></svg>',
    storm: '<svg viewBox="0 0 48 48" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 26h20a7 7 0 0 0 0-14 11 11 0 0 0-21 2 6 6 0 0 0 1 12z"/><path d="M25 28l-4 8h6l-3 7"/></svg>',
    none: '<svg viewBox="0 0 48 48" fill="none" stroke="currentColor" stroke-width="2"><circle cx="24" cy="24" r="15" stroke-dasharray="4 4"/></svg>'
  };
  function wxIconKey(code) {
    var c = num(code);
    if (c === null) return "none";
    if (c === 0 || c === 1) return "sun";
    if (c === 2 || c === 3 || c === 45 || c === 48) return "cloud";
    if ((c >= 71 && c <= 77) || c === 85 || c === 86) return "snow";
    if (c >= 95) return "storm";
    if (c >= 51 && c <= 82) return "rain";
    return "cloud";
  }
  function wxEmpty() {
    weatherData = null;
    var ic = $("wxIcon");
    if (ic) ic.innerHTML = WX_ICON.none;
    setText($("wxTemp"), "—°");
    setText($("wxDesc"), "天气 " + EMPTY);
    setText($("wxMeta"), "体感 " + EMPTY + " · 湿度 " + EMPTY + " · 风力 " + EMPTY + " · 空气 " + EMPTY);
    var d = $("wxDays");
    if (d) d.innerHTML = ["今天", "明天", "后天", "第 4 天"].map(function (l) {
      return '<div><div class="d">' + l + '</div><div class="t">— <span>—</span></div></div>';
    }).join("");
  }
  function renderWeather(w) {
    if (!w) { wxEmpty(); return; }
    weatherData = w;
    var ic = $("wxIcon");
    if (ic) ic.innerHTML = WX_ICON[wxIconKey(w.code)];
    setText($("wxTemp"), (num(w.temp) === null ? EMPTY : Math.round(w.temp)) + "°");
    setText($("wxDesc"), (w.desc || EMPTY) + " · " + (w.city || EMPTY));
    setText($("wxMeta"),
      "体感 " + show(w.feels, 0, "°") + " · 湿度 " + show(w.humidity, 0, "%") +
      " · " + (w.windDir || EMPTY) + " " + show(w.windLevel, 0, " 级") +
      " · 空气" + (w.air || EMPTY));
    var days = w.days || [];
    var box = $("wxDays");
    if (box) {
      if (!days.length) {
        box.innerHTML = '<div style="grid-column:1/-1;color:var(--ink-faint);font-size:12.5px">未来几天 ' + EMPTY + "</div>";
      } else {
        box.innerHTML = days.slice(0, 4).map(function (d) {
          return '<div><div class="d">' + (d.label || d.date || EMPTY) + '</div><div class="t">' +
            (num(d.max) === null ? EMPTY : Math.round(d.max)) + " <span>" +
            (num(d.min) === null ? EMPTY : Math.round(d.min)) + "</span></div></div>";
        }).join("");
      }
    }
  }
  function loadWeather() {
    return fetch("/api/weather").then(function (r) { return r.json(); }).then(function (j) {
      if (j && j.ok && j.weather) renderWeather(j.weather);
      else wxEmpty();
    }).catch(function () { wxEmpty(); });
  }
  function startWeather() {
    if (weatherTimer) return;
    loadWeather();
    weatherTimer = setInterval(loadWeather, 10 * 60 * 1000);
  }
  function stopWeather() { if (weatherTimer) { clearInterval(weatherTimer); weatherTimer = 0; } }

  /* =====================================================================
     连接状态信息（启动页下区）
     ===================================================================== */
  var statusTimer = 0, statusPollTimer = 0;
  function fetchStatus() {
    var t0 = Date.now();
    return fetch("/api/status").then(function (r) { return r.json(); }).then(function (j) {
      /* 这里的耗时就是「平板到电脑这一趟 HTTP 往返」的真实延迟，
         不该用 conn.online 去卡它 —— WebSocket 连着的时候同样要显示延迟。
         请求失败会走下面的 catch，latency 保持 null，界面显示「—」。 */
      if (j && j.ok) { serverStatus = j; conn.latency = Date.now() - t0; }
      return serverStatus;
    }).catch(function () { return null; });
  }
  function renderSystemStatus() {
    var s = serverStatus;
    setText($("sysHost"), s && s.name ? s.name : EMPTY);
    setText($("sysIp"), s && s.ip ? s.ip + (s.port ? ":" + s.port : "") : EMPTY);
    setText($("sysVer"), s && s.version ? "v" + s.version : EMPTY);
    var upSec = s && num(s.uptimeSec) !== null ? s.uptimeSec : null;
    setText($("sysUptime"), upSec === null ? EMPTY : fmtDuration(connectedAt ? (Date.now() - connectedAt) / 1000 : 0));
    setText($("sysLatency"), conn.latency == null ? EMPTY : conn.latency + " ms");
    /* 顶栏地址牌：显示平板正在访问的这个地址，方便核对连的是哪台电脑 */
    var ap = $("addrPill");
    if (ap) ap.textContent = location.host || EMPTY;
  }
  function startStatusTimer() {
    if (statusTimer) return;
    renderSystemStatus();
    /* 先立刻量一次延迟，别让「当前延迟」空着等 5 秒 */
    fetchStatus().then(renderSystemStatus);
    statusPollTimer = setInterval(function () { fetchStatus().then(renderSystemStatus); }, 5000);
    statusTimer = setInterval(renderSystemStatus, 1000);
  }
  function stopStatusTimer() {
    clearInterval(statusTimer); statusTimer = 0;
    clearInterval(statusPollTimer); statusPollTimer = 0;
  }

  /* =====================================================================
     启动页：常用软件 / 搜索 / 挑选
     ===================================================================== */
  var favorites = [];
  var favLoaded = false, favError = "";
  var searchResults = [];
  var searchWord = "";
  var allApps = null;
  var busyIds = {};
  var PLACEHOLDER =
    '<svg class="ph" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><rect x="3" y="3" width="18" height="18" rx="2"/><path d="M3 9h18M9 21V9"/></svg>';

  function appIconHtml(a) {
    var ph = PLACEHOLDER;
    if (!a.hasIcon) return '<div class="ic no-ic">' + ph + "</div>";
    return '<div class="ic">' + ph + '<img class="app-ic" alt="" src="/api/apps/' + encodeURIComponent(a.id) +
      '/icon" onload="this.parentNode.classList.add(\'has-ic\')" onerror="this.style.display=\'none\';this.parentNode.classList.add(\'no-ic\')"></div>';
  }
  function appCard(a, opts) {
    opts = opts || {};
    var busy = !!busyIds[a.id];
    var running = a.running === true;
    var known = a.running === true || a.running === false;
    var cls = "app" + (running ? " running" : "") + (busy ? " busy" : "");
    var star = opts.star
      ? '<button class="star' + (opts.starOn ? " on" : "") + '" data-star="' + a.id + '" aria-label="' +
        (opts.starOn ? "从常用移除" : "加入常用") + '">' + (opts.starOn ? "★" : "☆") + "</button>"
      : "";
    var dot = known ? '<i class="run-dot"></i>' : "";
    var state = busy ? "处理中" : (running ? "运行中" : (known ? "未运行" : ""));
    var ctrl = "";
    if (opts.ctrl) {
      ctrl = '<div class="app-ctrl">' +
        '<button class="launch" data-launch="' + a.id + '"' + (busy ? " disabled" : "") + ">启动</button>" +
        (running ? '<button class="close" data-close="' + a.id + '"' + (busy ? " disabled" : "") + ">关闭</button>" : "") +
        "</div>";
    }
    return '<div class="' + cls + '">' + star + dot +
      '<button class="ico-hit"' + (busy ? " disabled" : "") + ' data-launch="' + a.id + '" aria-label="启动 ' + esc(a.name) + '"></button>' +
      appIconHtml(a) +
      "<b>" + esc(a.name) + "</b>" +
      '<div class="run-state">' + state + "</div>" +
      ctrl + "</div>";
  }
  function bindAppGrid(box) {
    if (!box) return;
    box.querySelectorAll("[data-launch]").forEach(function (b) {
      b.addEventListener("click", function (e) { e.stopPropagation(); launchApp(b.getAttribute("data-launch")); });
    });
    box.querySelectorAll("[data-close]").forEach(function (b) {
      b.addEventListener("click", function (e) { e.stopPropagation(); closeApp(b.getAttribute("data-close")); });
    });
    box.querySelectorAll("[data-star]").forEach(function (b) {
      b.addEventListener("click", function (e) { e.stopPropagation(); toggleFavorite(b.getAttribute("data-star")); });
    });
  }

  function loadFavorites() {
    return fetch("/api/favorites").then(function (r) { return r.json(); }).then(function (j) {
      if (j && j.ok) { favorites = j.favorites || []; favError = ""; }
      else { favorites = []; favError = "读取常用软件失败"; }
      favLoaded = true;
      renderFavorites();
    }).catch(function () {
      favorites = []; favLoaded = true; favError = "无法连接服务端"; renderFavorites();
    });
  }
  function renderFavorites() {
    var box = $("appGrid"), empty = $("favEmpty");
    if (!box) return;
    /* 常用为空时只显示一条紧凑提示（不再撑满整列，也不改变两栏比例）；
       「添加常用」入口始终是搜索行右侧那一个。 */
    var col = $("appsCol");
    var emptyNow = favLoaded && !favError && !favorites.length;
    if (col) col.classList.toggle("is-empty", emptyNow);

    if (!favLoaded) {
      if (col) col.classList.remove("is-empty");
      box.innerHTML = "";
      if (empty) { empty.hidden = false; setText($("favEmptyTx"), "正在读取常用软件…"); }
      return;
    }
    if (favError) {
      box.innerHTML = "";
      if (empty) { empty.hidden = false; setText($("favEmptyTx"), favError); }
      return;
    }
    if (!favorites.length) {
      box.innerHTML = "";
      if (empty) {
        empty.hidden = false;
        /* 空态只留一行短提示 + 条带里的「添加常用」按钮，不再占大半屏 */
        setText($("favEmptyTx"), "还没有常用软件");
      }
      return;
    }
    if (empty) empty.hidden = true;
    box.innerHTML = favorites.map(function (a) {
      return appCard(a, { ctrl: true, star: true, starOn: true });
    }).join("");
    bindAppGrid(box);
  }

  function launchApp(id) {
    if (!id || busyIds[id]) return;
    if (!getToken()) { toast("先在设置里填入访问令牌", true); focusSetup(); return; }
    busyIds[id] = true;
    refreshAppViews();
    apiPost("/api/launch", { id: id }).then(function (j) {
      toast("已启动：<b>" + esc(j.name || id) + "</b>");
    }).catch(function (e) {
      toast("启动失败：" + e.message, true);
    }).then(function () {
      setTimeout(function () { delete busyIds[id]; refreshAppViews(); loadFavorites(); if (searchWord) doSearch(searchWord); }, 1400);
    });
  }
  function closeApp(id) {
    if (!id || busyIds[id]) return;
    if (!getToken()) { toast("先在设置里填入访问令牌", true); focusSetup(); return; }
    busyIds[id] = true;
    refreshAppViews();
    /* 关闭不需要二次确认（需求 5.2 明确） */
    apiPost("/api/close-app", { id: id }).then(function (j) {
      toast("已关闭：<b>" + esc(j.name || id) + "</b>");
    }).catch(function (e) {
      toast("关闭失败：" + e.message, true);
    }).then(function () {
      setTimeout(function () { delete busyIds[id]; refreshAppViews(); loadFavorites(); if (searchWord) doSearch(searchWord); }, 1600);
    });
  }
  function refreshAppViews() {
    renderFavorites();
    renderSearch();
  }
  function focusSetup() {
    openSettings();
    setTimeout(function () {
      var el = $("setToken");
      if (el) { el.focus(); }
    }, 220);
  }

  function toggleFavorite(id) {
    if (!getToken()) { toast("先在设置里填入访问令牌", true); focusSetup(); return; }
    var isFav = favorites.some(function (a) { return a.id === id; });
    apiPost("/api/favorites", { action: isFav ? "remove" : "add", id: id }).then(function (j) {
      favorites = j.favorites || [];
      favLoaded = true;
      renderFavorites();
      if ($("pickSheet").classList.contains("open")) renderPick();
      toast(isFav ? "已从常用移除" : "已加入常用");
    }).catch(function (e) { toast("操作失败：" + e.message, true); });
  }

  function doSearch(word) {
    searchWord = (word || "").trim();
    if (!searchWord) {
      var sb = $("searchBlock"), se = $("searchEmpty");
      if (sb) sb.hidden = true;
      if (se) { se.hidden = true; se.textContent = ""; }
      searchResults = [];
      return;
    }
    if (!getToken()) { /* 搜索是只读接口，无需令牌 */ }
    setText($("searchCount"), "搜索中…");
    fetch("/api/apps").then(function (r) { return r.json(); }).then(function (j) {
      if (!j || !j.ok) throw new Error("读取失败");
      allApps = j.apps || [];
      var w = searchWord.toLowerCase();
      searchResults = allApps.filter(function (a) { return String(a.name || "").toLowerCase().indexOf(w) >= 0; });
      renderSearch();
    }).catch(function () {
      searchResults = [];
      setText($("searchCount"), EMPTY);
      var se = $("searchEmpty");
      if (se) { se.hidden = false; se.textContent = "搜索失败，服务端未响应"; }
      var sb = $("searchBlock");
      if (sb) sb.hidden = true;
    });
  }
  function renderSearch() {
    var sb = $("searchBlock"), se = $("searchEmpty"), grid = $("searchGrid");
    if (!sb || !grid) return;
    if (!searchWord) { sb.hidden = true; if (se) se.hidden = true; return; }
    if (!searchResults.length) {
      sb.hidden = true;
      if (se) { se.hidden = false; se.textContent = '没有匹配「' + searchWord + '」的项目'; }
      return;
    }
    if (se) se.hidden = true;
    sb.hidden = false;
    setText($("searchCount"), searchResults.length + " 项");
    var favIds = {};
    favorites.forEach(function (a) { favIds[a.id] = 1; });
    grid.innerHTML = searchResults.map(function (a) {
      return appCard(a, { ctrl: true, star: true, starOn: !!favIds[a.id] });
    }).join("");
    bindAppGrid(grid);
  }
  $("appSearch").addEventListener("input", (function () {
    var t = 0;
    return function (e) {
      clearTimeout(t);
      var v = e.target.value;
      t = setTimeout(function () { doSearch(v); }, 260);
    };
  })());

  /* 挑选界面（「添加常用」）——全量列表 + 搜索 + 游戏/软件分组 */
  var pickList = null, pickWord = "";
  function openPick() {
    pickList = null;
    pickWord = "";
    if ($("pickSearch")) $("pickSearch").value = "";
    $("pickSheet").classList.add("open");
    renderPick();
    fetch("/api/apps").then(function (r) { return r.json(); }).then(function (j) {
      allApps = (j && j.apps) || [];
      pickList = allApps;
      renderPick();
    }).catch(function () {
      pickList = [];
      renderPick();
    });
  }
  function closePick() { $("pickSheet").classList.remove("open"); }
  function renderPick() {
    var box = $("pickList");
    if (!box) return;
    if (pickList === null) { box.innerHTML = '<div class="pick-empty">正在读取可启动项目…</div>'; return; }
    var w = pickWord.toLowerCase();
    var list = w ? pickList.filter(function (a) { return String(a.name || "").toLowerCase().indexOf(w) >= 0; }) : pickList;
    if (!list.length) {
      box.innerHTML = '<div class="pick-empty">' + (pickList.length ? "没有匹配的项目" : "服务端未扫描到可启动项目") + "</div>";
      return;
    }
    var favIds = {};
    favorites.forEach(function (a) { favIds[a.id] = 1; });
    /* 分组依据服务端 type 字段，前端不猜 */
    var games = list.filter(function (a) { return a.type === "game"; });
    var apps = list.filter(function (a) { return a.type !== "game"; });
    function rows(arr) {
      return arr.map(function (a) {
        var added = !!favIds[a.id];
        return '<div class="pick-row">' +
          '<div class="ic">' + PLACEHOLDER +
          (a.hasIcon ? '<img alt="" src="/api/apps/' + encodeURIComponent(a.id) + '/icon" onerror="this.style.display=\'none\'">' : "") +
          "</div>" +
          "<div style=\"min-width:0\"><b>" + esc(a.name) + "</b><span>" + (a.type === "game" ? "GAME" : "SOFTWARE") + "</span></div>" +
          '<button class="' + (added ? "added" : "") + '" data-fav="' + a.id + '">' + (added ? "已添加" : "添加") + "</button></div>";
      }).join("");
    }
    var html = "";
    if (games.length) html += '<div class="pick-group">游戏 / GAMES · ' + games.length + "</div>" + rows(games);
    if (apps.length) html += '<div class="pick-group">软件 / SOFTWARE · ' + apps.length + "</div>" + rows(apps);
    box.innerHTML = html;
    box.querySelectorAll("[data-fav]").forEach(function (b) {
      b.addEventListener("click", function () { toggleFavorite(b.getAttribute("data-fav")); });
    });
  }
  $("addFavBtn").addEventListener("click", openPick);
  $("pickClose").addEventListener("click", closePick);
  $("pickSheet").addEventListener("click", function (e) { if (e.target === $("pickSheet")) closePick(); });
  $("pickSearch").addEventListener("input", function (e) {
    pickWord = e.target.value;
    renderPick();
  });

  /* =====================================================================
     音乐（SMTC 系统媒体会话，只 3 个按钮）
     ===================================================================== */
  var mediaTimer = 0, mediaData = null, mediaBusy = false, neId = null;
  /* 无会话时点播放 = 启动网易云（需求二.4：删掉红色启动按钮，点播放自动启动） */
  var lbPlaying = false;
  var ICON_PLAY = '<path d="M8 5v14l11-7z" fill="currentColor" stroke="none"/>';
  var ICON_PAUSE = '<path d="M7 5h4v14H7zM13 5h4v14h-4z" fill="currentColor" stroke="none"/>';
  function setPlayIcon(playing) {
    var svg = $("playIcon");
    if (!svg) return;
    var want = playing ? ICON_PAUSE : ICON_PLAY;
    if (svg.dataset.state === (playing ? "pause" : "play")) return;
    svg.dataset.state = playing ? "pause" : "play";
    svg.classList.add("swapping");
    setTimeout(function () {
      svg.innerHTML = want;
      svg.classList.remove("swapping");
    }, REDUCED ? 0 : 200);
  }
  function renderMedia(m) {
    mediaData = m;
    var ok = m && m.available;
    setText($("neState"), ok ? (m.isPlaying ? "PLAYING" : "PAUSED") : "NO SESSION");
    var name = ok && m.title ? m.title : "未在播放";
    setText($("trackName"), name);
    setText($("trackArtist"), ok ? (m.artist || EMPTY) : "点播放即自动启动网易云音乐");
    /* 上一首 / 下一首必须有媒体会话才可用；播放键在无会话时保持可点，用来启动网易云（需求二.4） */
    setBtnDisabled($("prevBtn"), !ok || mediaBusy);
    setBtnDisabled($("nextBtn"), !ok || mediaBusy);
    setBtnDisabled($("playBtn"), mediaBusy && !lbPlaying);
    var playBusy = $("playBtn");
    if (playBusy) playBusy.classList.toggle("busy", !!lbPlaying);
    setPlayIcon(!!(ok && m.isPlaying));
    /* 专辑封面：SMTC 通道里有缩略图（thumbHash）就显示，没有就留空，不编造 */
    var cov = $("mediaCover"), img = $("mediaCoverImg");
    if (cov) cov.classList.toggle("playing", !!(ok && m.isPlaying));
    if (img) {
      var hash = ok && m.thumbHash ? m.thumbHash : "";
      if (hash) {
        img.src = "/api/media/thumbnail?hash=" + encodeURIComponent(hash);
        img.hidden = false;
        img.onerror = function () { img.hidden = true; img.removeAttribute("src"); };
      } else {
        img.hidden = true;
        img.removeAttribute("src");
      }
    }
    /* 无会话时点播放按钮 = 启动网易云（需求：删掉红色启动按钮，点播放自动启动） */
    if (!ok) lbPlaying = false;
  }
  function setBtnDisabled(el, dis) { if (el) el.disabled = !!dis; }
  function loadMedia() {
    return fetch("/api/media").then(function (r) { return r.json(); }).then(function (j) {
      renderMedia(j && j.ok ? j.media : null);
    }).catch(function () { renderMedia(null); });
  }
  function startMedia() {
    if (mediaTimer) return;
    loadMedia();
    mediaTimer = setInterval(loadMedia, 3000);
  }
  function stopMedia() { if (mediaTimer) { clearInterval(mediaTimer); mediaTimer = 0; } }
  function mediaControl(action) {
    if (mediaBusy) return;
    if (!getToken()) { toast("先在设置里填入访问令牌", true); focusSetup(); return; }
    mediaBusy = true;
    var b = $("playBtn");
    if (b) b.classList.add("busy");
    apiPost("/api/media/control", { action: action }).then(function () {
      setTimeout(function () { mediaBusy = false; if (b) b.classList.remove("busy"); loadMedia(); }, 420);
    }).catch(function (e) {
      mediaBusy = false;
      if (b) b.classList.remove("busy");
      toast("操作失败：" + e.message, true);
    });
  }
  $("prevBtn").addEventListener("click", function () { mediaControl("prev"); });
  $("playBtn").addEventListener("click", function () {
    if (mediaData && mediaData.available) {
      /* 真正控制播放/暂停，按钮状态跟随会话（需求三.4：点播放就真的播放） */
      mediaControl(mediaData.isPlaying ? "pause" : "play");
      return;
    }
    /* 没有 SMTC 会话 → 启动网易云音乐（需求二.4：播放即启动；三.4：启动后继续尝试播放） */
    if (!getToken()) { toast("先在设置里填入访问令牌", true); focusSetup(); return; }
    if (lbPlaying) return;
    lbPlaying = true;
    var b = $("playBtn");
    if (b) b.classList.add("busy");
    b.dataset.state = "launching";
    function findAndLaunch(apps) {
      var hit = apps.filter(function (a) {
        var n = String(a.name || "");
        return n.indexOf("网易云") >= 0 || n.toLowerCase().indexOf("cloudmusic") >= 0 || n.toLowerCase().indexOf("netease") >= 0;
      })[0];
      if (b) b.classList.remove("busy");
      if (!hit) { lbPlaying = false; toast("没有在扫描列表里找到网易云音乐", true); return; }
      neId = hit.id;
      launchApp(neId);
      /* 启动应用后轮询等 SMTC 会话出现，一旦出现就发 play 真正播放（三.4） */
      pollSessionThenPlay(12);
    }
    function fail() { lbPlaying = false; if (b) b.classList.remove("busy"); toast("无法读取可启动项目列表", true); }
    if (allApps) { findAndLaunch(allApps); return; }
    fetch("/api/apps").then(function (r) { return r.json(); }).then(function (j) {
      allApps = (j && j.apps) || [];
      findAndLaunch(allApps);
    }).catch(fail);
  });
  /* 轮询等待网易云注册到 SMTC 会话，最多 polls 次；会话一出现就发 play 真正开始播放 */
  function pollSessionThenPlay(polls) {
    var tries = 0;
    var t = setInterval(function () {
      tries++;
      fetch("/api/media").then(function (r) { return r.json(); }).then(function (j) {
        var m = (j && j.media) || null;
        if (m && m.available) {
          clearInterval(t);
          /* 会话出现：先发一次 play（此时它可能已自动播放，play 无副作用；若暂停则开始播放） */
          mediaControl("play");
          window.setTimeout(function () { loadMedia(); }, 600);
          return;
        }
        if (tries >= polls) { clearInterval(t); lbPlaying = false; }
      }).catch(function () { if (tries >= polls) { clearInterval(t); lbPlaying = false; } });
    }, 1500);
  }
  $("nextBtn").addEventListener("click", function () { mediaControl("next"); });

  /* =====================================================================
     电源 / 系统操作（需求二.3/四.2：下面只留 锁屏 / 睡眠 / 重启 / 关机 4 个）
     ===================================================================== */
  var POWER_TEXT = {
    lock: { name: "锁屏", body: "立即锁定这台电脑，需要输入密码才能继续使用。" },
    sleep: { name: "睡眠", body: "让电脑进入睡眠状态，移动鼠标或按键盘可唤醒。" },
    restart: { name: "重启", body: "电脑将在 3 秒后重新启动，未保存的工作会丢失。" },
    shutdown: { name: "关机", body: "电脑将在 3 秒后关机，未保存的工作会丢失。之后需要手动按下电源键才能再开机。" }
  };
  document.querySelectorAll(".pwr").forEach(function (btn) {
    btn.addEventListener("click", function () {
      var key = btn.getAttribute("data-power");
      if (!key) return; /* 「设置」按钮（pwr 无 data-power）由 openSettingsRowBtn 监听处理 */
      var t = POWER_TEXT[key] || { name: key, body: "" };
      if (!getToken()) { toast("先在设置里填入访问令牌", true); focusSetup(); return; }
      confirmBox("确认" + t.name + "？", t.body, "确认" + t.name).then(function (ok) {
        if (!ok) return;
        btn.classList.add("busy");
        apiPost("/api/power", { action: key }).then(function () {
          toast("已执行：" + t.name);
        }).catch(function (e) {
          toast("执行失败：" + e.message, true);
        }).then(function () { setTimeout(function () { btn.classList.remove("busy"); }, 1500); });
      });
    });
  });

  /* =====================================================================
     设置区
     ===================================================================== */
  var wakeOn = false;
  function fillSettings() {
    /* setServer 是 <input>，必须写 .value；setText 走的是 textContent，对 input 不生效，
       会让这个框一直是空的。 */
    if ($("setServer")) $("setServer").value = location.origin.replace(/^https?:\/\//, "");
    if ($("setToken")) $("setToken").value = getToken();
    if ($("setRefresh")) $("setRefresh").value = serverConfig.refreshIntervalSec || 1;
    if ($("setCity")) $("setCity").value = serverConfig.weatherCity || "";
    if ($("setWake")) $("setWake").value = serverConfig.tabletWakeUrl || "";
    if ($("setWakeKey")) $("setWakeKey").value = "";
    setHeroPathLabel();
    wakeOn = !!serverConfig.tabletWakeEnabled;
    var sw = $("wakeSwitch");
    if (sw) sw.classList.toggle("on", wakeOn);
  }
  function setHeroPathLabel() {
    var p = $("heroPath");
    if (!p) return;
    p.value = serverConfig.customHeroImagePath
      ? "用户图片：" + serverConfig.customHeroImagePath
      : "默认图：" + (serverConfig.heroImagePath || "assets/hero.jpg");
    var st = $("heroState");
    if (st) st.textContent = serverConfig.customHeroImagePath ? "本机已更换过主图" : "当前使用默认主图";
  }
  function loadConfig() {
    return fetch("/api/config").then(function (r) { return r.json(); }).then(function (j) {
      serverConfig = (j && j.config) || {};
      if (num(serverConfig.refreshIntervalSec)) REFRESH_SEC = serverConfig.refreshIntervalSec;
      applyHero(heroUrl());
      fillSettings();
    }).catch(function () {});
  }
  $("wakeSwitch").addEventListener("click", function () {
    wakeOn = !wakeOn;
    $("wakeSwitch").classList.toggle("on", wakeOn);
  });

  /* 更换主图：必须是能直接选本地图片的入口，不是只有手填路径 */
  $("heroPickBtn").addEventListener("click", function () { $("heroFile").click(); });
  $("heroFile").addEventListener("change", function (e) {
    var f = e.target.files && e.target.files[0];
    if (!f) return;
    if (!getToken()) { toast("先在设置里填入访问令牌", true); focusSetup(); return; }
    var btn = $("heroPickBtn");
    btn.classList.add("busy");
    setText($("heroState"), "正在上传…");
    apiPost("/api/hero-image", f, { raw: true }).then(function (j) {
      serverConfig.customHeroImagePath = j.customHeroImagePath || "";
      applyHero(heroUrl());
      setHeroPathLabel();
      toast("主图已更换");
    }).catch(function (err) {
      setText($("heroState"), "上传失败");
      toast("上传失败：" + err.message, true);
    }).then(function () {
      btn.classList.remove("busy");
      e.target.value = "";
    });
  });
  $("heroResetBtn").addEventListener("click", function () {
    if (!getToken()) { toast("先在设置里填入访问令牌", true); focusSetup(); return; }
    apiPost("/api/hero-image/reset", {}).then(function () {
      serverConfig.customHeroImagePath = "";
      applyHero(heroUrl());
      setHeroPathLabel();
      toast("已恢复默认主图");
    }).catch(function (e) { toast("操作失败：" + e.message, true); });
  });

  function setSpMsg(text, isErr) {
    var el = $("spMsg");
    if (!el) return;
    el.textContent = text;
    el.classList.toggle("err", !!isErr);
  }
  $("saveSettingsBtn").addEventListener("click", function () {
    var tk = ($("setToken").value || "").trim();
    if (!tk) { setSpMsg("请先填写访问令牌（在 config.json 的 token 字段）", true); return; }
    setToken(tk);
    var patch = {
      refreshIntervalSec: parseInt($("setRefresh").value, 10) || 1,
      weatherCity: ($("setCity").value || "").trim(),
      tabletWakeEnabled: wakeOn,
      tabletWakeUrl: ($("setWake").value || "").trim()
    };
    var pwd = ($("setWakeKey").value || "").trim();
    if (pwd) patch.tabletWakePassword = pwd;
    var btn = $("saveSettingsBtn");
    btn.classList.add("busy");
    setSpMsg("正在保存…", false);
    apiPost("/api/settings", patch).then(function (j) {
      serverConfig = j.config || serverConfig;
      if (num(serverConfig.refreshIntervalSec)) REFRESH_SEC = serverConfig.refreshIntervalSec;
      fillSettings();
      if (j.needsRestart) {
        setSpMsg("已保存：" + (j.changed && j.changed.length ? j.changed.join("、") : "") + "；端口/令牌等改动需重启服务端后生效", false);
      } else if (!j.changed || !j.changed.length) {
        setSpMsg("没有需要改动的内容", false);
      } else {
        setSpMsg("已保存并生效：" + j.changed.join("、"), false);
      }
      loadWeather();
      if (conn.pollTimer) { stopPolling(); startPolling(); }
      /* 令牌可能已更新，重连 WebSocket 使新令牌生效 */
      if (conn.ws) {
        try { conn.ws.close(); } catch (_) {}
      } else if (!conn.online) {
        connectWs();
      }
    }).catch(function (e) {
      setSpMsg("保存失败：" + e.message, true);
    }).then(function () {
      setTimeout(function () { btn.classList.remove("busy"); }, 700);
    });
  });

  /* 密钥框留空 = 不修改，所以需要一个显式入口把它清成空字符串 */
  var clearWakeBtn = $("clearWakeKey");
  if (clearWakeBtn) clearWakeBtn.addEventListener("click", function () {
    if (!getToken()) { setSpMsg("请先填写访问令牌（在 config.json 的 token 字段）", true); return; }
    setSpMsg("正在清除…", false);
    apiPost("/api/settings", { tabletWakePassword: "" }).then(function (j) {
      serverConfig = j.config || serverConfig;
      fillSettings();
      setSpMsg("唤醒密钥已清除（重启服务端后生效）", false);
    }).catch(function (e) {
      setSpMsg("清除失败：" + e.message, true);
    });
  });

  /* =====================================================================
     详情层（8 类卡片）
     ===================================================================== */
  var detailKey = null;
  var detailCalY = null, detailCalM = null;
  var detailTimer = 0;
  /* 打开详情层时收集「需要跟着刷新」的格子，每秒只改文本，不重建 DOM */
  var detailLive = [];
  var DETAIL_META = {
    time: { t: "时间", en: "Time" },
    weather: { t: "天气", en: "Weather" },
    calendar: { t: "日历", en: "Calendar" },
    cpu: { t: "CPU", en: "Processor" },
    gpu: { t: "GPU", en: "Graphics" },
    ram: { t: "内存", en: "Memory" },
    net: { t: "网络", en: "Network" },
    disk: { t: "磁盘", en: "Storage" }
  };
  function openDetail(key) {
    if (!DETAIL_META[key]) return;
    detailKey = key;
    setText($("detailTitle"), DETAIL_META[key].t);
    setText($("detailEn"), DETAIL_META[key].en);
    $("detailSheet").classList.add("open");
    renderDetail(key);
    if (detailTimer) clearInterval(detailTimer);
    /* 打开期间数据继续刷新，不停在快照 */
    detailTimer = setInterval(function () { refreshDetailLive(); }, 1000);
  }
  function closeDetail() {
    detailKey = null;
    $("detailSheet").classList.remove("open");
    if (detailTimer) { clearInterval(detailTimer); detailTimer = 0; }
    if (current === 0) drawAllSparks();
  }
  $("detailClose").addEventListener("click", closeDetail);
  $("detailSheet").addEventListener("click", function (e) { if (e.target === $("detailSheet")) closeDetail(); });
  document.querySelectorAll("[data-detail]").forEach(function (el) {
    el.addEventListener("click", function () { openDetail(el.getAttribute("data-detail")); });
    el.setAttribute("tabindex", "0");
    el.addEventListener("keydown", function (e) {
      if (e.key === "Enter" || e.key === " ") { e.preventDefault(); openDetail(el.getAttribute("data-detail")); }
    });
  });
  function refreshDetailLive() {
    if (!detailKey) return;
    /* 详情层打开期间数据必须继续实时刷新，不能停在打开那一刻的快照。
       这里只改单元格文本与曲线，不重建 DOM，避免每秒闪一下。 */
    for (var i = 0; i < detailLive.length; i++) {
      var it = detailLive[i];
      if (!it.el || !it.el.isConnected) continue;
      var v = it.get();
      if (it.el.textContent !== v) it.el.textContent = v;
    }
    /* 曲线数据由每秒的 metrics 流统一 pushHist 更新，详情层不再重复推点 */
  }

  var detailHistCache = null, detailHistAt = 0;
  function loadHistory() {
    var now = Date.now();
    if (detailHistCache && now - detailHistAt < 5000) return Promise.resolve(detailHistCache);
    return fetch("/api/metrics/history?minutes=10").then(function (r) { return r.json(); }).then(function (j) {
      detailHistCache = (j && j.ok && j.history) ? j.history : { points: [], spanSec: 0 };
      if (!detailHistCache.points) detailHistCache.points = [];
      detailHistAt = now;
      return detailHistCache;
    }).catch(function () { return { points: [], spanSec: 0 }; });
  }
  function statsOf(vals) {
    var arr = vals.filter(function (v) { return num(v) !== null; });
    if (!arr.length) return null;
    var sum = 0, max = -Infinity, min = Infinity;
    arr.forEach(function (v) { sum += v; if (v > max) max = v; if (v < min) min = v; });
    return { avg: sum / arr.length, max: max, min: min, n: arr.length };
  }
  function cellsHtml(cells) {
    return '<div class="d-grid">' + cells.map(function (c) {
      return '<div class="d-cell"><span>' + c[0] + "</span><b>" + c[1] + "</b></div>";
    }).join("") + "</div>";
  }
  function chartHtml(id, capL, capR) {
    return '<canvas class="dchart" id="' + id + '" width="640" height="120"></canvas>' +
      '<div class="d-chart-cap"><span>' + capL + "</span><span>" + capR + "</span></div>";
  }
  function drawDetail(id, arr, color) {
    var cv = $(id);
    if (!cv) return;
    var dpr = Math.min(window.devicePixelRatio || 1, 2);
    var w = cv.clientWidth || 640, h = 120;
    cv.width = Math.round(w * dpr);
    cv.height = Math.round(h * dpr);
    var ctx = cv.getContext("2d");
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    var n = arr.length;
    if (!n) return;
    var max = 1;
    arr.forEach(function (v) { if (num(v) !== null && v > max) max = v; });
    ctx.beginPath();
    var started = false;
    for (var i = 0; i < n; i++) {
      var v = num(arr[i]);
      if (v === null) { started = false; continue; }
      var x = n === 1 ? w : (i / (n - 1)) * w;
      var y = h - 6 - (v / max) * (h - 16);
      if (!started) { ctx.moveTo(x, y); started = true; } else ctx.lineTo(x, y);
    }
    ctx.strokeStyle = color;
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.lineTo(w, h); ctx.lineTo(0, h); ctx.closePath();
    var g = ctx.createLinearGradient(0, 0, 0, h);
    g.addColorStop(0, color + "55");
    g.addColorStop(1, color + "00");
    ctx.fillStyle = g;
    ctx.fill();
  }
  /* 天气详情：当日逐小时气温曲线（需求一.4） */
  function drawWeatherHour(id, hr) {
    var cv = $(id);
    if (!cv || !hr || !hr.length) return;
    var dpr = Math.min(window.devicePixelRatio || 1, 2);
    var w = cv.clientWidth || 640, h = 130;
    cv.width = Math.round(w * dpr);
    cv.height = Math.round(h * dpr);
    var ctx = cv.getContext("2d");
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    var vals = hr.map(function (p) { return p.t; });
    var valid = vals.filter(function (v) { return num(v) !== null; });
    if (!valid.length) return;
    var max = Math.max.apply(null, valid), min = Math.min.apply(null, valid);
    if (max - min < 1) { max += 1; min -= 1; }
    var padX = 6, top = 10, bot = 8;
    var innerW = w - padX * 2, innerH = h - top - bot;
    /* 网格线 */
    ctx.strokeStyle = "rgba(58,35,42,.6)";
    ctx.lineWidth = 1;
    for (var gi = 0; gi <= 4; gi++) {
      var gy = top + (innerH / 4) * gi;
      ctx.beginPath(); ctx.moveTo(padX, gy); ctx.lineTo(w - padX, gy); ctx.stroke();
    }
    ctx.beginPath(); ctx.moveTo(padX, top); ctx.lineTo(padX, h - bot); ctx.lineTo(w - padX, h - bot); ctx.stroke();
    /* 曲线 + 面积 */
    ctx.beginPath();
    var started = false;
    for (var i = 0; i < hr.length; i++) {
      var v = num(vals[i]);
      var x = hr.length === 1 ? padX : padX + (i / (hr.length - 1)) * innerW;
      var y = v === null ? null : top + innerH - ((v - min) / (max - min)) * innerH;
      if (y === null) { started = false; continue; }
      if (!started) { ctx.moveTo(x, y); started = true; } else ctx.lineTo(x, y);
    }
    ctx.strokeStyle = "#ff8c1a";
    ctx.lineWidth = 2.2;
    ctx.lineJoin = "round";
    ctx.stroke();
    ctx.lineTo(w - padX, h - bot); ctx.lineTo(padX, h - bot); ctx.closePath();
    var g = ctx.createLinearGradient(0, 0, 0, h);
    g.addColorStop(0, "rgba(255,140,26,.4)");
    g.addColorStop(1, "rgba(255,140,26,0)");
    ctx.fillStyle = g;
    ctx.fill();
    /* 整点标注 */
    ctx.fillStyle = "rgba(201,179,184,.85)";
    ctx.font = "9px Rajdhani,monospace";
    ctx.textAlign = "center";
    for (var li = 0; li < hr.length; li += 6) {
      var px = hr.length === 1 ? padX : padX + (li / (hr.length - 1)) * innerW;
      ctx.fillText(hr[li].h || "", px, h - 1);
    }
    ctx.textAlign = "left";
  }
  function monthGridHtml(y, m, nav) {
    var now = new Date();
    var html = "";
    if (nav) {
      html += '<div class="d-cal-nav"><button data-cal="prev">上月</button><button data-cal="prevY">上一年</button><b>' + y + " 年 " + (m + 1) +
        ' 月</b><button data-cal="nextY">下一年</button><button data-cal="next">下月</button></div>';
    }
    html += '<div class="d-cal">';
    ["日", "一", "二", "三", "四", "五", "六"].forEach(function (w) { html += '<div class="dow">' + w + "</div>"; });
    var first = new Date(y, m, 1), days = new Date(y, m + 1, 0).getDate(), prevDays = new Date(y, m, 0).getDate();
    var lead = first.getDay();
    for (var i = lead - 1; i >= 0; i--) html += '<div class="day dim">' + (prevDays - i) + "</div>";
    for (var d = 1; d <= days; d++) {
      var wd = (lead + d - 1) % 7;
      var cls = "day" + ((wd === 0 || wd === 6) ? " weekend" : "");
      if (y === now.getFullYear() && m === now.getMonth() && d === now.getDate()) cls += " today";
      /* 详情层日历：给每一天加上农历/节日/节气小字 */
      var sub = "";
      var lun = (typeof window.NERV_LUNAR !== "undefined") ? window.NERV_LUNAR.dayInfo(y, m, d) : null;
      if (lun && (lun.lunarFest || lun.term || lun.prevEve || lun.solar || lun.mother || lun.father)) {
        var label = lun.lunarFest || (lun.prevEve ? "除夕" : "") || lun.solar || lun.mother || lun.father || lun.term;
        sub = '<span class="dl-sub">' + label + "</span>";
      } else if (lun) {
        var dl = window.NERV_LUNAR.solar2lunar(y, m, d);
        if (dl && dl.dayName) sub = '<span class="dl-sub">' + dl.dayName + "</span>";
      }
      html += '<div class="' + cls + '">' + d + sub + "</div>";
    }
    var tail = (7 - ((lead + days) % 7)) % 7;
    for (var t = 1; t <= tail; t++) html += '<div class="day dim">' + t + "</div>";
    html += "</div>";
    return html;
  }

  function renderDetail(key) {
    var body = $("detailBody");
    if (!body) return;
    var m = latestMetrics || {};
    var c = m.cpu || {}, g = m.gpu || {}, r = m.ram || {}, n = m.net || {}, disks = m.disks || [];
    var now = new Date();
    detailLive = [];

    if (key === "time") {
      var upSec = serverStatus && num(serverStatus.uptimeSec) !== null ? serverStatus.uptimeSec : null;
      body.innerHTML = cellsHtml([
        ["当前时间", pad(now.getHours()) + ":" + pad(now.getMinutes()) + ":" + pad(now.getSeconds())],
        ["日期", now.getFullYear() + "-" + pad(now.getMonth() + 1) + "-" + pad(now.getDate())],
        ["星期", ["日", "一", "二", "三", "四", "五", "六"][now.getDay()]],
        ["服务端运行时长", upSec === null ? EMPTY : fmtDuration(upSec)],
        ["本次连接时长", connectedAt ? fmtDuration((Date.now() - connectedAt) / 1000) : EMPTY],
        ["网络延迟", conn.latency == null ? EMPTY : conn.latency + " ms"]
      ]);
      /* 时间详情只更新这两个会走的格子，不重建整块（重建会闪） */
      var tCells = body.querySelectorAll(".d-cell b");
      if (tCells[0]) detailLive.push({ el: tCells[0], get: function () { var d = new Date(); return pad(d.getHours()) + ":" + pad(d.getMinutes()) + ":" + pad(d.getSeconds()); } });
      if (tCells[4]) detailLive.push({ el: tCells[4], get: function () { return connectedAt ? fmtDuration((Date.now() - connectedAt) / 1000) : EMPTY; } });
      if (tCells[5]) detailLive.push({ el: tCells[5], get: function () { return conn.latency == null ? EMPTY : conn.latency + " ms"; } });
      return;
    }

    if (key === "weather") {
      var w = weatherData;
      if (!w) {
        body.innerHTML = '<p class="d-note">天气暂时读不到，稍后会自动重试。所有字段均按 <b>' + EMPTY + "</b> 显示。</p>" +
          cellsHtml([["城市", EMPTY], ["状况", EMPTY], ["当前温度", EMPTY], ["体感", EMPTY], ["湿度", EMPTY], ["风", EMPTY], ["空气质量", EMPTY]]);
        return;
      }
      var html = cellsHtml([
        ["城市", w.city || EMPTY],
        ["状况", w.desc || EMPTY],
        ["当前温度", show(w.temp, 0, "°C")],
        ["体感温度", show(w.feels, 0, "°C")],
        ["湿度", show(w.humidity, 0, "%")],
        ["风向风力", (w.windDir || EMPTY) + " " + show(w.windLevel, 0, " 级")],
        ["空气质量", w.air || EMPTY],
        ["数据来源", w.source || EMPTY]
      ]);
      /* 当日气温曲线（需求一.4）：Open-Meteo 逐小时气温，0:00 → 23:00 */
      var hr = w.hourly || [];
      if (hr.length >= 4) {
        html += '<p class="d-note">当日气温曲线（逐小时）</p>';
        html += '<canvas class="dchart wx-chart" id="wxHourChart" width="640" height="130"></canvas>';
        html += '<div class="d-chart-cap"><span>' + (hr[0] ? hr[0].h : "") + "</span><span>" + (hr[hr.length - 1] ? hr[hr.length - 1].h : "") + "</span></div>";
      }
      var ds = w.days || [];
      html += '<p class="d-note">未来 ' + Math.min(3, ds.length) + " 天</p>";
      html += '<div class="d-rows">' + ds.slice(0, 3).map(function (d) {
        return '<div class="d-row"><span class="dn">' + (d.label || d.date || EMPTY) + '</span><span style="color:var(--ink-dim);font-size:13.5px">' +
          (d.desc || EMPTY) + '</span><span class="dv">' +
          (num(d.max) === null ? EMPTY : Math.round(d.max)) + "° / " + (num(d.min) === null ? EMPTY : Math.round(d.min)) + "°</span></div>";
      }).join("") + "</div>";
      body.innerHTML = html;
      if (hr.length >= 4) drawWeatherHour("wxHourChart", hr);
      return;
    }

    if (key === "calendar") {
      if (detailCalY == null) { detailCalY = now.getFullYear(); detailCalM = now.getMonth(); }
      body.innerHTML = monthGridHtml(detailCalY, detailCalM, true) +
        '<p class="d-note">可切换 <b>年/月</b> 查看不同年月的日历；每个日期下方显示 <b>农历 / 节日 / 节气</b>。只改变显示，不会修改电脑的系统日期。</p>';
      body.querySelectorAll("[data-cal]").forEach(function (b) {
        b.addEventListener("click", function () {
          var act = b.getAttribute("data-cal");
          if (act === "prevY") { detailCalY--; }
          else if (act === "nextY") { detailCalY++; }
          else if (act === "prev") {
            detailCalM--; if (detailCalM < 0) { detailCalM = 11; detailCalY--; }
          } else {
            detailCalM++; if (detailCalM > 11) { detailCalM = 0; detailCalY++; }
          }
          renderDetail("calendar");
        });
      });
      return;
    }

    loadHistory().then(function (h) {
      if (detailKey !== key) return;
      var pts = h.points || [];
      var spanSec = h.spanSec || 0;
      var spanTxt = spanSec >= 60 ? Math.round(spanSec / 60) + " 分钟" : spanSec + " 秒";
      var capL = "最近 " + spanTxt + "（历史已积累）";
      var capR = pts.length < 2 ? "历史不足，正在积累" : pts.length + " 个采样点";
      var out = "";

      if (key === "cpu") {
        var st = statsOf(pts.map(function (p) { return p.cpu; }));
        out += cellsHtml([
          ["当前占用", show(c.usage, 1, "%")],
          ["温度", c.temp == null ? EMPTY : Math.round(c.temp) + "°C"],
          ["频率", num(c.freq) === null ? EMPTY : (c.freq / 1000).toFixed(2) + " GHz"],
          ["平均", st ? st.avg.toFixed(1) + "%" : EMPTY],
          ["最高", st ? st.max.toFixed(1) + "%" : EMPTY],
          ["最低", st ? st.min.toFixed(1) + "%" : EMPTY]
        ]);
        out += '<p class="d-note">型号：<b>' + (c.name || EMPTY) + "</b></p>";
        if (c.cores && c.cores.length) {
          out += '<p class="d-note">每核心占用</p><div class="d-grid">';
          c.cores.forEach(function (v, i) {
            out += '<div class="d-cell"><span>核心 ' + (i + 1) + "</span><b>" + show(v, 0, "%") + "</b></div>";
          });
          out += "</div>";
        } else {
          out += '<p class="d-note">每核心占用：系统接口未提供，<b>已记录为降级项</b>。</p>';
        }
        out += chartHtml("dchart", capL, capR);
        body.innerHTML = out;
        drawDetail("dchart", pts.map(function (p) { return p.cpu; }), "#ff8c1a");
        bindLiveCells(body, [
          function () { return show(lastM().cpu && lastM().cpu.usage, 1, "%"); },
          function () { var t = lastM().cpu && lastM().cpu.temp; return t == null ? EMPTY : Math.round(t) + "°C"; },
          function () { var f = lastM().cpu && lastM().cpu.freq; return num(f) === null ? EMPTY : (f / 1000).toFixed(2) + " GHz"; }
        ]);
        return;
      }

      if (key === "gpu") {
        var sg = statsOf(pts.map(function (p) { return p.gpu; }));
        var vtot = num(g.vramTotal), vused = num(g.vramUsed);
        var vrate = (vtot && vused != null) ? (vused / vtot * 100) : null;
        out += cellsHtml([
          ["当前占用", show(g.usage, 1, "%")],
          ["温度", g.temp == null ? EMPTY : Math.round(g.temp) + "°C"],
          ["显存占用率", vrate === null ? EMPTY : vrate.toFixed(1) + "%"],
          ["显存已用", vused == null ? EMPTY : (vused / 1073741824).toFixed(2) + " GB"],
          ["显存总量", vtot == null ? EMPTY : (vtot / 1073741824).toFixed(2) + " GB"],
          ["频率", num(g.freq) === null ? EMPTY : Math.round(g.freq) + " MHz"],
          ["功耗", num(g.power) === null ? EMPTY : g.power.toFixed(1) + " W"],
          ["平均占用", sg ? sg.avg.toFixed(1) + "%" : EMPTY],
          ["最高 / 最低", sg ? sg.max.toFixed(1) + "% / " + sg.min.toFixed(1) + "%" : EMPTY]
        ]);
        out += '<p class="d-note">型号：<b>' + (g.name || EMPTY) + "</b></p>";
        out += chartHtml("dchart", capL, capR);
        body.innerHTML = out;
        drawDetail("dchart", pts.map(function (p) { return p.gpu; }), "#e8321e");
        bindLiveCells(body, [
          function () { return show(lastM().gpu && lastM().gpu.usage, 1, "%"); },
          function () { var t = lastM().gpu && lastM().gpu.temp; return t == null ? EMPTY : Math.round(t) + "°C"; },
          null,
          null, null,
          function () { var f = lastM().gpu && lastM().gpu.freq; return num(f) === null ? EMPTY : Math.round(f) + " MHz"; },
          function () { var p = lastM().gpu && lastM().gpu.power; return num(p) === null ? EMPTY : p.toFixed(1) + " W"; }
        ]);
        return;
      }

      if (key === "ram") {
        var sr = statsOf(pts.map(function (p) { return p.ram; }));
        var total = num(r.total), used = num(r.used);
        out += cellsHtml([
          ["当前占用", show(r.usage, 1, "%")],
          ["已用", gb(used) ? gb(used) + " GB" : EMPTY],
          ["总量", gb(total) ? gb(total) + " GB" : EMPTY],
          ["可用", (gb(total) && gb(used)) ? (num(gb(total)) - num(gb(used))).toFixed(1) + " GB" : EMPTY],
          ["平均占用", sr ? sr.avg.toFixed(1) + "%" : EMPTY],
          ["最高 / 最低", sr ? sr.max.toFixed(1) + "% / " + sr.min.toFixed(1) + "%" : EMPTY]
        ]);
        out += chartHtml("dchart", capL, capR);
        body.innerHTML = out;
        drawDetail("dchart", pts.map(function (p) { return p.ram; }), "#ffb52e");
        bindLiveCells(body, [
          function () { return show(lastM().ram && lastM().ram.usage, 1, "%"); },
          function () { var u = gb(lastM().ram && lastM().ram.used); return u ? u + " GB" : EMPTY; },
          function () { var t = gb(lastM().ram && lastM().ram.total); return t ? t + " GB" : EMPTY; },
          function () {
            var t = gb(lastM().ram && lastM().ram.total), u = gb(lastM().ram && lastM().ram.used);
            return (t && u) ? (num(t) - num(u)).toFixed(1) + " GB" : EMPTY;
          }
        ]);
        return;
      }

      if (key === "net") {
        var sd = statsOf(pts.map(function (p) { return p.netDown; }));
        var su = statsOf(pts.map(function (p) { return p.netUp; }));
        out += cellsHtml([
          ["当前下行", show(n.down, 2, " MB/s")],
          ["当前上行", show(n.up, 2, " MB/s")],
          ["下行平均", sd ? sd.avg.toFixed(2) + " MB/s" : EMPTY],
          ["下行最高 / 最低", sd ? sd.max.toFixed(2) + " / " + sd.min.toFixed(2) + " MB/s" : EMPTY],
          ["上行平均", su ? su.avg.toFixed(2) + " MB/s" : EMPTY],
          ["上行最高 / 最低", su ? su.max.toFixed(2) + " / " + su.min.toFixed(2) + " MB/s" : EMPTY]
        ]);
        out += '<p class="d-note">累计流量：系统接口未提供真实累计值，<b>按降级处理不显示</b>。</p>';
        out += chartHtml("dchart", capL, capR);
        body.innerHTML = out;
        drawDetail("dchart", pts.map(function (p) { return p.netDown; }), "#39c2d7");
        bindLiveCells(body, [
          function () { return show(lastM().net && lastM().net.down, 2, " MB/s"); },
          function () { return show(lastM().net && lastM().net.up, 2, " MB/s"); }
        ]);
        return;
      }

      if (key === "disk") {
        /* 磁盘详情按逐盘容量明细，不硬画曲线（需求 5.1 明确不算缺失） */
        if (!disks.length) {
          body.innerHTML = '<p class="d-note">没有读到磁盘信息。</p>';
          return;
        }
        out += '<div class="d-rows">' + disks.map(function (d) {
          return '<div class="d-row"><span class="dn">' + (d.name || EMPTY) + "</span>" +
            '<div class="bar cool"><i style="transform:scaleX(' + (pct(d.usage) / 100) + ')"></i></div>' +
            '<span class="dv">' + (gb(d.used) || EMPTY) + " / " + (gb(d.total) || EMPTY) + " GB · " +
            (num(d.usage) === null ? EMPTY : Math.round(d.usage) + "%") + "</span></div>";
        }).join("") + "</div>";
        out += '<p class="d-note">共 <b>' + disks.length + "</b> 个分区。磁盘占用变化慢，这里只列逐盘容量明细，不画曲线。</p>";
        body.innerHTML = out;
        return;
      }
    });
  }
  /* 只替换数值文本与进度条，不重建整块，避免每秒刷新闪烁 */
  function bindLiveCells(body, getters) {
    var cells = body.querySelectorAll(".d-cell b");
    getters.forEach(function (get, i) {
      if (!get || !cells[i]) return;
      detailLive.push({ el: cells[i], get: get });
    });
  }
  function lastM() { return latestMetrics || {}; }

  /* =====================================================================
     横竖屏过渡
     ===================================================================== */
  var orientTimer = 0;
  function playOrientTransition() {
    if (REDUCED) return;
    document.body.classList.add("orienting");
    clearTimeout(orientTimer);
    orientTimer = setTimeout(function () { document.body.classList.remove("orienting"); }, 620);
  }
  window.addEventListener("resize", (function () {
    var t = 0, lastW = window.innerWidth, lastH = window.innerHeight;
    return function () {
      clearTimeout(t);
      t = setTimeout(function () {
        if (Math.abs(window.innerWidth - lastW) < 2 && Math.abs(window.innerHeight - lastH) < 2) return;
        var rotated = (window.innerWidth > window.innerHeight) !== (lastW > lastH);
        lastW = window.innerWidth; lastH = window.innerHeight;
        movePsInd();
        if (rotated) playOrientTransition();
        if (current === 0) drawAllSparks();
      }, 80);
    };
  })());
  if (window.matchMedia) {
    var mq = window.matchMedia("(orientation: portrait)");
    var onMq = function () { movePsInd(); if (current === 0) drawAllSparks(); };
    if (mq.addEventListener) mq.addEventListener("change", onMq);
    else if (mq.addListener) mq.addListener(onMq);
  }

  /* =====================================================================
     可见性钩子 —— 不可见页面一律暂停
     ===================================================================== */
  visibleHooks.push(function (now, prev) {
    if (prev === 0) stopClock(), stopSync(), stopWeather(), stopMedia();
    if (prev === 1) stopStatusTimer();
    if (hiddenPaused) return;
    if (now === 0) { startClock(); startSync(); startWeather(); startMedia(); drawAllSparks(); }
    if (now === 1) { startStatusTimer(); }
  });
  document.addEventListener("visibilitychange", function () {
    hiddenPaused = document.hidden;
    if (hiddenPaused) { stopClock(); stopSync(); stopWeather(); stopStatusTimer(); stopMedia(); }
    else { notifyVisible(current); }
  });

  function startVisibleTimers() { notifyVisible(current); }

  /* =====================================================================
     启动
     ===================================================================== */
  function boot0() {
    initSwitchInd();
    tickClock();
    renderCalendar();
    wxEmpty();
    renderFavorites();
    renderMedia(null);
    loadConfig();
    fetchStatus().then(renderSystemStatus);
    loadFavorites();
    goTo(0, { instant: true, force: true });
    connectWs();
    startBoot();
    setTimeout(movePsInd, 60);
    setTimeout(movePsInd, 400);
    if (document.fonts && document.fonts.ready) document.fonts.ready.then(movePsInd);
    window.addEventListener("load", movePsInd);
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot0);
  else boot0();
})();
