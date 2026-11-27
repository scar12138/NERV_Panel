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
  var conn = { ws: null, online: false, retry: 0, retryTimer: 0, pollTimer: 0, everConnected: false, lastMsgAt: 0, latency: null, wsFails: 0 };
  /* 数据新鲜度阈值：超过这个时间没有任何一份指标到达，才算真的离线。
     「连接状态」必须由**数据有没有在到**决定，不能由 socket 有没有握手成功决定——
     WebSocket 握手被拒（例如没填 token）时 HTTP 轮询仍在正常出数，
     若按 socket 判定就会出现「数据在跳、横幅却说未连接、同步率归零」的矛盾画面。 */
  var STALE_MS = 6000;
  function staleMs() { return Math.max(STALE_MS, REFRESH_SEC * 3000); }
  function connFresh() {
    return conn.lastMsgAt > 0 && Date.now() - conn.lastMsgAt < staleMs();
  }
  var REFRESH_SEC = 1;
  function applyRefreshInterval(sec) {
    if (num(sec) === null || sec < 1 || sec > 60 || sec === REFRESH_SEC) return;
    REFRESH_SEC = sec;
    if (conn.pollTimer) { stopPolling(); startPolling(); }
  }
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
    if (audioUI && audioUI.isOpen()) { if (e.key === "Escape") audioUI.close(); return; }
    if (e.key === "Escape") {
      if (processAssociation && !$('processAssociation').hidden) { processAssociation.close(); return; }
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
  var suppressSwipeClickUntil = 0;
  viewport.addEventListener('click', function (e) {
    if (Date.now() < suppressSwipeClickUntil) { e.preventDefault(); e.stopImmediatePropagation(); }
  }, true);
  (function () {
    var sx = 0, sy = 0, dx = 0, dy = 0, tracking = false, fromScroll = false;
    function start(x, y, target) {
      sx = x; sy = y; dx = 0; dy = 0; tracking = true;
      fromScroll = !!(target && target.closest && target.closest("canvas,.search-box,.set-grid,.pwr,.mctrl,#processAssociation,[data-associate],#appGrid.favorite-sort-mode,#detailSheet,#pickSheet"));
    }
    function move(x, y, e) {
      if (!tracking || fromScroll) return;
      if (document.documentElement.classList.contains('favorite-sort-dragging')) { tracking = false; return; }
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
        suppressSwipeClickUntil = Date.now() + 500;
        goTo((current + (dx < 0 ? 1 : -1) + TOTAL) % TOTAL);
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
    viewport.addEventListener("touchcancel", function () { tracking = false; });
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
  /* 自检日志：先打印占位，拿到 /api/status 后换成真实主机名 / 局域网 IP；
     断网或接口失败时降级成 STANDALONE MODE，绝不阻塞开机流程。 */
  function bootLinesFor(s) {
    var host = s && s.name ? String(s.name) : "";
    var ip = s && s.ip ? String(s.ip) : "";
    return [
      { t: "INITIALIZING PHYSICAL CONNECTION... [OK]", c: "sys" },
      { t: host ? "HOST NODE DETECTED: [" + host + "]" : "HOST NODE DETECTED: [STANDALONE MODE]", c: host ? "" : "warn" },
      { t: ip ? "LAN IPv4 ACQUIRED: " + ip : "LAN IPv4 ACQUIRED: [STANDALONE MODE]", c: ip ? "" : "warn" },
      { t: "TELEMETRY BUS: CPU / GPU SENSORS SYNCHRONIZED", c: "" },
      { t: "MAGI SUPERUSER CONSENSUS: 2/3 REQUIRED", c: "" },
      { t: "ALL PROTOCOLS VERIFIED · INTERFACE READY", c: "ok" }
    ];
  }
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
  var bootAlert = false;
  var bootApproved = false;
  var unlockScheduled = false;
  var captionEl = $("magiCaption");
  function setCaption(t) { if (captionEl) captionEl.textContent = t; }

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
  /* 表决图改成网格布局后，三个框的位置由 CSS 决定，连线必须跟着实测坐标走，
     不能再写死百分比（否则线头会飘到框外）。百分比坐标系与 svg 的
     viewBox 0 0 100 100 + preserveAspectRatio:none 对应：x/y 都是图区内的百分比。 */
  function layoutVoteLines() {
    var diag = document.querySelector(".vote-diagram");
    if (!diag) return;
    var dr = diag.getBoundingClientRect();
    if (!dr.width || !dr.height) return;
    var core = $("voteCore");
    if (!core) return;
    var cr = core.getBoundingClientRect();
    function pct(r) {
      return {
        cx: (r.left + r.width / 2 - dr.left) / dr.width * 100,
        cy: (r.top + r.height / 2 - dr.top) / dr.height * 100
      };
    }
    var c = pct(cr);
    var pairs = [
      ["voteBalthasar", "lineTop"],
      ["voteCasper", "lineBl"],
      ["voteMelchior", "lineBr"]
    ];
    pairs.forEach(function (p) {
      var box = $(p[0]), line = $(p[1]);
      if (!box || !line) return;
      var b = pct(box.getBoundingClientRect());
      /* 线从核心中心连到框的内侧边缘中点，缩短一点避免扎进框里 */
      line.setAttribute("x1", b.cx.toFixed(2));
      line.setAttribute("y1", b.cy.toFixed(2));
      line.setAttribute("x2", c.cx.toFixed(2));
      line.setAttribute("y2", c.cy.toFixed(2));
    });
  }
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
    document.body.classList.add("boot-out");
    bootTimers.forEach(clearTimeout);
    bootTimers = [];
    setTimeout(function () {
      boot.style.display = "none";
      document.body.classList.remove("boot-out");
      startVisibleTimers();
    }, 1050);
  }

  /* 终局：先闪出 [EMERGENCY LOCK RELEASED] 印章与激光切屏，再让闸门上滑。
     380ms 里印章真正清晰可见的时间只有约 160ms（stampReveal 本身要 0.46s），
     所以放宽到 480ms，让印章先「盖实」再开闸。 */
  function requestDismiss() {
    if (bootDismissed || unlockScheduled) return;
    unlockScheduled = true;
    boot.classList.add("boot-unlocked");
    bootTimers.push(setTimeout(dismissBoot, 480));
  }

  function startBoot() {
    var lines = bootLinesFor(null);
    pushLog(lines[0].t, lines[0].c);
    setSegs();
    /* 表决图是网格布局，连线按实测坐标重算；字体加载完尺寸还会变一次，所以补两拍 */
    layoutVoteLines();
    bootTimers.push(setTimeout(layoutVoteLines, 120));
    bootTimers.push(setTimeout(layoutVoteLines, 600));

    /* 日志行：等真实状态到达再开闸，最多等 650ms，超时先走 STANDALONE MODE；
       之后真实数据若迟到，只补进尚未打印的行，不会让日志倒流 */
    var printed = 1, lineTimer = 0, streaming = false;
    function streamLines() {
      if (lineTimer) return;
      lineTimer = setInterval(function () {
        if (printed >= lines.length) { clearInterval(lineTimer); lineTimer = 0; return; }
        pushLog(lines[printed].t, lines[printed].c);
        printed++;
      }, 430);
      bootTimers.push(lineTimer);
    }
    function useStatus(s) {
      if (s) {
        var fresh = bootLinesFor(s);
        for (var i = 1; i < fresh.length; i++) if (i >= printed) lines[i] = fresh[i];
      }
      if (!streaming) { streaming = true; streamLines(); }
    }
    fetchStatus().then(useStatus).catch(function () { useStatus(null); });
    bootTimers.push(setTimeout(function () { useStatus(null); }, 650));

    /* 进度条固定步进，不用随机数；警戒期卡在 75% 悬停，改判后 3 倍速冲顶 */
    var barTimer = setInterval(function () {
      var step = 5;
      if (bootApproved) step = 15;
      else if (bootAlert && progress >= 75) step = 0;
      progress = Math.min(100, progress + step);
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
        bootAlert = true;
        boot.classList.add("boot-alert");
        setCaption("MAGI SYSTEM · DELIBERATION IN PROGRESS / 紧急再审议中");
        var c = $("voteCasper");
        if (c) { c.classList.add("lit", "deny", "thinking"); c.querySelector(".vb-stamp").textContent = "否定"; }
        pushLog("CASPER-3 · 否定", "warn");
      }],
      [3050, function () {
        bootAlert = false;
        bootApproved = true;
        boot.classList.remove("boot-alert");
        boot.classList.add("boot-approved");
        setCaption("MAGI SYSTEM · ALL APPROVED / 全票通过");
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
    bootTimers.push(setTimeout(function () { voteDone = true; progressDone = true; requestDismiss(); }, 6000));
  }
  function maybeDismiss() {
    if (progressDone && voteDone) requestDismiss();
  }

  /* =====================================================================
     需求三.1：平板每次从熄屏点亮，都重新弹出启动界面
     ---------------------------------------------------------------------
     平板熄屏时浏览器会进入 hidden 状态，点亮后重新 visible —— 这就是「熄屏点亮」的信号。
     这里把开机动画完整地重播一遍（等于回到启动页），而不是只切页：
       · 重置进度 / 表决 / 退场 的全部状态位与 DOM 标记；
       · 重新显示 #boot 并重跑 startBoot() 的日志流、进度条、三台 MAGI 表决序列；
       · 退场动画结束后仍照常进入监控页，和冷启动一致。
     为避免短时间内反复切后台（例如下拉通知栏、输入法弹出）就整屏闪一次动画，
     只有隐藏时间超过 SCREEN_OFF_MIN_MS 才重播。 */
  var SCREEN_OFF_MIN_MS = 3000;
  var hiddenAt = 0;

  function resetBootUi() {
    bootTimers.forEach(clearTimeout);
    bootTimers.forEach(clearInterval);
    bootTimers = [];
    progress = 0;
    progressDone = false;
    voteDone = false;
    bootDismissed = false;
    unlockScheduled = false;
    bootAlert = false;
    bootApproved = false;
    boot.classList.remove("done", "boot-unlocked", "boot-alert", "boot-approved");
    document.body.classList.remove("boot-out");
    boot.style.display = "";
    if (bootLog) bootLog.innerHTML = "";
    /* 三台主机 + 中央核心 + 连接线 全部熄灭，印章回到「待機」 */
    ["voteMelchior", "voteBalthasar", "voteCasper"].forEach(function (id) {
      var b = $(id);
      if (!b) return;
      b.classList.remove("lit", "deny", "thinking");
      var st = b.querySelector(".vb-stamp");
      if (st) { st.textContent = "待機"; st.classList.remove("flip"); }
    });
    ["lineTop", "lineBl", "lineBr"].forEach(function (id) {
      var l = $(id);
      if (l) l.classList.remove("lit");
    });
    var core = $("voteCore");
    if (core) core.classList.remove("lit");
    var cc = $("voteCasper");
    if (cc) { var cs = cc.querySelector(".vb-stamp"); if (cs) cs.classList.remove("flip"); }
    setCaption("MAGI SYSTEM · INITIALIZING / 系统启动中");
    setSegs();
    layoutVoteLines();
  }

  function replayBoot() {
    if (!boot) return;
    resetBootUi();
    /* 先把底下的分页复位到监控页（第 1 页，索引 0），再盖上启动界面重播动画，
       退场后就落在监控页，与冷启动的过程完全一致。 */
    goTo(0, { instant: true });
    startBoot();
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
     时钟 / 日历 / 同步率（同步率与真实综合负荷联动，见优化计划 1）
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

  /* --------------------------------------------------------------- 同步率 --
     与机器真实负荷联动（优化计划 1），不再是主题装饰数值：
       综合负荷 = CPU×0.45 + GPU×0.40 + RAM×0.15
       基准同步率 = 98 - 综合负荷×0.65，再叠加 ±1.2% 的生理呼吸抖动
     任一项传感器缺失时按剩余权重归一（仍是 0~100 的量纲），三项全缺则保持
     「--%」—— 绝不编造一个数字。
     分级：≥70 荧光绿（健康）/ 40~70 琥珀橙（警备）/ <40 警报红（过载）；
     断线时固定 0.00% 红字。
     ------------------------------------------------------------------------- */
  var syncValue = null; // 当前显示的同步率；null = 还没拿到任何真实负荷
  var syncTarget = null; // 由最新硬件负荷算出的目标值；null = 无法判断
  var syncOffline = false;

  function computeSyncTarget(m) {
    var w = { cpu: 0.45, gpu: 0.4, ram: 0.15 };
    var vals = {
      cpu: m && m.cpu ? num(m.cpu.usage) : null,
      gpu: m && m.gpu ? num(m.gpu.usage) : null,
      ram: m && m.ram ? num(m.ram.usage) : null
    };
    var load = 0, weight = 0;
    Object.keys(w).forEach(function (k) {
      if (vals[k] !== null) { load += vals[k] * w[k]; weight += w[k]; }
    });
    /* 三项全缺：不猜，保持 null（前端继续显示 --%） */
    if (weight === 0) return null;
    load = load / weight; // 缺项时按剩余权重归一
    return clamp(98 - load * 0.65, 0, 99.99);
  }

  function syncTone(v, offline) {
    if (offline) return "off";
    if (v === null) return "na";
    if (v >= 70) return "ok";
    if (v >= 40) return "warn";
    return "danger";
  }

  function paintSync() {
    var el = $("syncRate");
    if (!el) return;
    var txt = syncOffline ? "0.00%" : syncValue === null ? "--%" : syncValue.toFixed(2) + "%";
    setText(el, txt);
    var tone = syncTone(syncValue, syncOffline);
    el.classList.toggle("ok", tone === "ok");
    el.classList.toggle("warn", tone === "warn");
    el.classList.toggle("danger", tone === "danger");
    el.classList.toggle("off", tone === "off");
    el.classList.toggle("na", tone === "na");
  }

  /* 指标渲染 / 连接状态变化时调用：只刷新目标值，动画交给 syncTick 平滑推进 */
  function refreshSyncTarget() {
    syncOffline = !conn.online;
    syncTarget = syncOffline ? 0 : computeSyncTarget(latestMetrics);
    if (!syncTimer) paintSync(); // 页面不可见时定时器停了，至少让断线/重连即时反映
  }

  function syncTick() {
    if (syncOffline) { syncValue = 0; paintSync(); return; }
    if (syncTarget === null) { paintSync(); return; }
    /* ±1.2% 呼吸抖动：数值有真实的生理起伏，而不是一个死板常数 */
    var jitter = (Math.random() - 0.5) * 2.4;
    var want = clamp(syncTarget + jitter, 0, 99.99);
    syncValue = syncValue === null ? want : syncValue + (want - syncValue) * 0.35;
    paintSync();
  }

  function startSync() {
    if (syncTimer) return;
    refreshSyncTarget();
    syncTick();
    syncTimer = setInterval(syncTick, 1800);
  }
  function stopSync() { clearInterval(syncTimer); syncTimer = 0; }

  /* =====================================================================
     OLED 防烧屏：像素级微位移（优化计划 3）
     每 10 分钟按微环形轨迹把主视口平移 1 像素。位移量肉眼不可见，
     但能让长时间静止的发光子像素换位，避免静态高对比画面烙在屏上。
     ===================================================================== */
  var SHIFT_MS = 10 * 60 * 1000;
  var SHIFT_STEPS = [[0, 0], [1, 0], [1, 1], [0, 1], [-1, 0], [-1, -1], [0, -1]];
  var shiftTimer = 0, shiftIdx = 0;

  function applyPixelShift() {
    if (!viewport) return;
    var s = SHIFT_STEPS[shiftIdx % SHIFT_STEPS.length];
    shiftIdx += 1;
    viewport.style.transform = "translate3d(" + s[0] + "px," + s[1] + "px,0)";
  }
  function startPixelShift() {
    if (shiftTimer || REDUCED) return;
    applyPixelShift(); // 首帧落在 (0,0)，不产生初始位移
    shiftTimer = setInterval(applyPixelShift, SHIFT_MS);
  }
  function stopPixelShift() {
    if (shiftTimer) { clearInterval(shiftTimer); shiftTimer = 0; }
  }

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
  /* 离线告警条：只挂在监控页顶上。记录最近一次连接状态，翻页时据此同步显隐，
     避免「在启动页断线、回到监控页却不提示」或者反过来「监控页的告警挂在启动页上」。 */
  var connStateName = "connecting";
  function refreshOfflineBanner() {
    var off = $("monOffline");
    if (!off) return;
    off.hidden = !(connStateName === "offline" && current === 0);
  }
  function setConnUI(state) {
    conn.online = state === "online" || state === "polling";
    connStateName = state;
    var pill = $("connPill"), txt = $("connText");
    if (pill) {
      pill.classList.toggle("online", state === "online");
      pill.classList.toggle("offline", state === "offline");
    }
    setText(txt, state === "online" ? "已连接" : state === "polling" ? "轮询模式" : state === "connecting" ? "连接中" : "离线");
    refreshOfflineBanner();
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
    /* 连接状态直接影响同步率（断线归零 / 重连后按负荷重新爬升） */
    refreshSyncTarget();
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
    /* 只有当前完全没有数据时才显示「连接中」。
       已经有数据在刷（例如轮询在线、只是 socket 连不上）就不要把在线状态改写成连接中，
       否则界面会在「轮询模式」和「连接中/离线」之间来回跳。 */
    if (!connFresh()) setConnUI("connecting");
    ws.onopen = function () {
      conn.retry = 0;
      conn.everConnected = true;
      conn.wsFails = 0;
      conn.lastMsgAt = Date.now();
      stopPolling();
      setConnUI("online");
    };
    ws.onmessage = function (ev) {
      var msg;
      try { msg = JSON.parse(ev.data); } catch (e) { return; }
      applyRefreshInterval(msg && msg.intervalSec);
      conn.lastMsgAt = Date.now();
      if (!conn.online) setConnUI("online");
      if (msg && msg.type === "metrics" && msg.data) renderMetrics(msg.data);
    };
    ws.onerror = function () {};
    ws.onclose = function () {
      conn.ws = null;
      conn.wsFails++;
      /* 握手被拒（最常见原因是没填 token）会立刻 close 且永远连不上：
         这种时候先用轮询把数据顶上，WS 改走低频后台重试。
         注意不能彻底放弃——服务端重启、用户补填 token 之后必须能自动升回 WS。 */
      startPolling();
      if (!connFresh()) setConnUI("offline");
      scheduleReconnect();
    };
  }
  function scheduleReconnect() {
    if (conn.retryTimer) return;
    var delay;
    if (conn.wsFails >= 3) {
      /* 连续握手失败基本不是网络抖动，而是凭据/服务端的问题。
         这种情况继续按 1s→30s 的序列猛敲没有意义（每敲一次都会把状态刷一遍），
         但也不能停：固定 30s 低频重试，一旦条件恢复（重启服务、补填 token）就能自动回到 WS。 */
      delay = 30000;
    } else {
      delay = reconnectSeq[Math.min(conn.retry, reconnectSeq.length - 1)];
    }
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
      applyRefreshInterval(j.intervalSec);
      conn.latency = Date.now() - t0;
      conn.lastMsgAt = Date.now();
      /* 有数据到达就是通的：socket 真的处于 OPEN 才叫 online，否则是轮询在扛 */
      if (!conn.online) setConnUI(conn.ws && conn.ws.readyState === 1 ? "online" : "polling");
      renderMetrics(j.metrics || j.data || j);
    }).catch(function () {
      conn.latency = null;
      /* 取数失败本身不是判定的依据（一次抖动很常见），只有数据真的过期了才判离线 */
      if (!connFresh()) setConnUI("offline");
    });
  }
  /* 连接自检：数据新鲜度说了算。
     1) WS 长时间没有消息 → 主动断开走重连；
     2) 反过来，状态显示离线但数据其实一直在到 → 立刻纠正回来，
        避免任何一次异常把在线状态永久留在「未连接」。 */
  setInterval(function () {
    if (conn.ws && conn.lastMsgAt && Date.now() - conn.lastMsgAt > staleMs()) {
      try { conn.ws.close(); } catch (e) {}
      return;
    }
    if (!conn.online && connFresh()) setConnUI(conn.ws && conn.ws.readyState === 1 ? "online" : "polling");
  }, 3000);

  /* =====================================================================
     指标渲染
     ===================================================================== */
  function setBar(el, v) {
    if (!el) return;
    el.style.transform = "scaleX(" + pct(v) / 100 + ")";
  }
  /* 由真实转速推导的档位标签（派生的展示分类，不是伪造的硬件读数） */
  function fanClass(rpm) {
    if (rpm < 800) return "静音";
    if (rpm < 1500) return "常规";
    if (rpm < 2400) return "高速";
    return "全速";
  }
  function renderMetrics(m) {
    latestMetrics = m;
    refreshSyncTarget();
    var c = m.cpu || {}, g = m.gpu || {}, r = m.ram || {}, n = m.net || {};
    var disks = m.disks || [];
    /* —— 硬件卡：CPU / GPU / 内存 / 网络各只渲染一次（旧的四张小卡已合并进来） —— */
    setText($("cpuName"), c.name || EMPTY);
    setText($("cpuTemp"), c.temp == null ? "温度 " + EMPTY : Math.round(c.temp) + "°C");
    setText($("cpuUse"), c.usage == null ? EMPTY : Math.round(c.usage));
    var cpuFreq = num(c.freq);
    setText($("cpuSub"), (cpuFreq == null ? "频率 " + EMPTY : "频率 " + (cpuFreq / 1000).toFixed(2) + " GHz"));
    setBar($("cpuBar"), c.usage);
    /* 战术警报（UI 优化计划 §1）：温度 ≥80°C 或负载 ≥92% 即触发 .hot（红框脉冲 + [THERMAL ALERT] 印章） */
    var cpuCard = $("stCpu");
    if (cpuCard) cpuCard.classList.toggle("hot", (num(c.temp) !== null && c.temp >= 80) || (num(c.usage) !== null && c.usage >= 92));

    setText($("gpuName"), g.name || EMPTY);
    setText($("gpuTemp"), g.temp == null ? "温度 " + EMPTY : Math.round(g.temp) + "°C");
    setText($("gpuUse"), g.usage == null ? EMPTY : Math.round(g.usage));
    var vu = num(g.vramUsed), vt = num(g.vramTotal);
    setText($("gpuSub"), "显存 " + (vu == null || vt == null ? EMPTY : (vu / 1073741824).toFixed(1) + " / " + (vt / 1073741824).toFixed(1) + " GB"));
    setBar($("gpuBar"), g.usage);
    var gpuCard = $("stGpu");
    if (gpuCard) gpuCard.classList.toggle("hot", (num(g.temp) !== null && g.temp >= 80) || (num(g.usage) !== null && g.usage >= 92));

    setText($("ramTotal"), (gb(r.used) || EMPTY) + " / " + (gb(r.total) || EMPTY) + " GB");
    setText($("ramUse"), r.usage == null ? EMPTY : Math.round(r.usage));
    setText($("ramSub"), r.usage == null ? "占用 " + EMPTY : "已用 " + Math.round(r.usage) + "%");
    setBar($("ramBar"), r.usage);

    setText($("netDown"), n.down == null ? EMPTY : mbps(n.down));
    setText($("netSub"), "↑ " + (n.up == null ? EMPTY : mbps(n.up)) + " / ↓ " + (n.down == null ? EMPTY : mbps(n.down)));
    setBar($("netBar"), num(n.down) === null ? 0 : Math.min(100, n.down * 20));
    setText($("netMode"), "MB/s");

    /* 风扇（优化计划 2）：读得到真实转速就展示；读不到就整张卡收起，
       把宽度让给 CPU / GPU / 内存 / 网络 / 磁盘 五张核心卡，绝不编造转速。 */
    var fan = m.fan, fanRpm = fan ? num(fan.rpm) : null;
    var showFan = fanRpm !== null && fanRpm > 0;
    var fanCard = $("stFan"), hwRow = $("hwRow");
    if (fanCard) fanCard.hidden = !showFan;
    if (hwRow) hwRow.classList.toggle("no-fan", !showFan);
    if (showFan) {
      setText($("fanState"), fanClass(fanRpm));
      setText($("fanRpm"), Math.round(fanRpm));
      setText($("fanSub"), "转速 " + Math.round(fanRpm) + " RPM");
      setBar($("fanBar"), clamp((fanRpm / 2500) * 100, 0, 100));
    }

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
  /* 需求一.3：天气"有时候读不到"。
     以前 loadWeather() 只要有一次请求失败或后端 502，就直接 wxEmpty() 把整块清成「—」，
     而且下一次尝试要等 10 分钟 —— 一次网络抖动 = 面板空窗十分钟，看起来就是"天气丢了"。
     现在：① 拉取失败时保留上一次成功的数据，绝不主动清空；
           ② 失败后按 15s→30s→60s 退避重试，恢复后回到 10 分钟正常节奏；
           ③ 后端返回 stale（用了兜底旧数据）时照常显示，并标注数据时间。 */
  var weatherRetryTimer = 0, weatherFailCount = 0;
  var WEATHER_RETRY_STEPS = [15000, 30000, 60000];
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
      " · 空气" + (w.air || EMPTY) +
      /* 用了兜底旧数据时明确标出来，避免把几小时前的数字当成实时值 */
      (w.stale ? " · 数据 " + (num(w.staleAgeMin) === null ? "较早" : Math.round(w.staleAgeMin) + " 分钟前") : ""));
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
      if (j && j.ok && j.weather) {
        weatherFailCount = 0;
        renderWeather(j.weather);
      } else {
        /* 后端这次没给数据（502 / 城市未配置）：保留上一次成功的数据，不要清屏 */
        onWeatherFail();
      }
    }).catch(function () { onWeatherFail(); });
  }
  /* 需求一.3：失败不清屏 + 退避重试，恢复后回到正常节奏 */
  function onWeatherFail() {
    /* 有旧数据就继续挂着旧数据（后端 6 小时内也会兜底给 stale），这里什么都不画掉 */
    if (weatherRetryTimer) return;
    var delay = WEATHER_RETRY_STEPS[Math.min(weatherFailCount, WEATHER_RETRY_STEPS.length - 1)];
    weatherFailCount += 1;
    weatherRetryTimer = setTimeout(function () {
      weatherRetryTimer = 0;
      if (hiddenPaused) return;
      loadWeather();
    }, delay);
  }
  function startWeather() {
    if (weatherTimer) return;
    loadWeather();
    /* 需求一.3：10 分钟 太稀疏，一次抖动要空窗很久；改成 5 分钟刷新，
       Open-Meteo 对 5 分钟粒度完全可接受，缓存侧 CACHE_TTL 也会自动合并请求。 */
    weatherTimer = setInterval(loadWeather, 5 * 60 * 1000);
  }
  function stopWeather() {
    if (weatherTimer) { clearInterval(weatherTimer); weatherTimer = 0; }
    if (weatherRetryTimer) { clearTimeout(weatherRetryTimer); weatherRetryTimer = 0; }
  }
  /* 调试钩子：只用于开发期的自动化验收（scripts/verify-fixes.js），
     正常运行不依赖它，也不会把天气数据暴露到页面上。 */
  window.NERV_DEBUG = window.NERV_DEBUG || {};
  window.NERV_DEBUG.loadWeather = loadWeather;
  window.NERV_DEBUG.weatherData = function () { return weatherData; };
  /* 仅供开发期自动化验收：直接切换连接状态，验证离线悬浮条的显隐 */
  window.NERV_DEBUG.setConnUI = function (state) { setConnUI(state); return conn.online; };

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

  /* EVA 六边形蜂巢代号（UI 优化计划 §3）：中文取首字，英文取首个字母/数字并大写 */
  function hexGlyph(name) {
    var s = String(name == null ? "" : name).replace(/^[^\p{L}\p{N}]+/u, "");
    var ch = s ? Array.from(s)[0] : "";
    return ch ? ch.toUpperCase() : "N";
  }
  function hexBadge(name) {
    return '<svg class="ph-hex" viewBox="0 0 40 40" aria-hidden="true">' +
      '<polygon points="20,2 36,11 36,29 20,38 4,29 4,11"/>' +
      '<polygon class="in" points="20,7 31.5,13.5 31.5,26.5 20,33 8.5,26.5 8.5,13.5"/>' +
      '<text x="20" y="21">' + esc(hexGlyph(name)) + "</text></svg>";
  }
  function appIconHtml(a) {
    var ph = hexBadge(a.name);
    if (!a.hasIcon) return '<div class="ic no-ic">' + ph + "</div>";
    return '<div class="ic">' + ph + '<img class="app-ic" draggable="false" alt="" src="/api/apps/' + encodeURIComponent(a.id) +
      '/icon" onload="this.parentNode.classList.add(\'has-ic\')" onerror="this.style.display=\'none\';this.parentNode.classList.add(\'no-ic\')"></div>';
  }
  function appCard(a, opts) {
    opts = opts || {};
    var busy = busyIds[a.id];
    var running = a.running === true;
    var known = a.running === true || a.running === false;
    var cls = "app" + (running ? " running" : "") + (busy ? " busy" : "");
    var icon = function (path) { return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + path + '</svg>'; };
    var starLabel = opts.starOn ? "从常用移除" : "加入常用";
    var star = opts.star
      ? '<button type="button" class="star' + (opts.starOn ? " on" : "") + '" data-star="' + esc(a.id) + '" aria-label="' + starLabel + ' ' + esc(a.name) + '" title="' + starLabel + '"' + (busy ? ' disabled' : '') + '>' +
        icon(opts.starOn ? '<path d="m6 6 12 12M18 6 6 18"/>' : '<path d="M12 5v14M5 12h14"/>') + '</button>' : '';
    var dot = known ? '<i class="run-dot" aria-hidden="true"></i>' : "";
    var state = busy === "launch" ? "启动中" : busy === "close" ? "关闭中" : running ? "运行中" : known ? "未运行" : "未知";
    var cannotClose = running && a.canClose !== true;
    var reason = cannotClose ? (a.processAssociation ? "当前无法安全关闭" : String(a.closeReason || "当前无法安全关闭")) : "";
    var label = busy ? state : running ? "停止" : "开启";
    var ctrl = opts.ctrl ? '<div class="app-ctrl"><button type="button" class="' + (running ? 'close' : 'launch') + '" data-' + (running ? 'close' : 'launch') + '="' + esc(a.id) + '" aria-label="' + label + ' ' + esc(a.name) + '" title="' + esc(reason || label) + '"' + (busy || cannotClose ? ' disabled' : '') + '>' +
      icon(running ? '<rect x="6" y="6" width="12" height="12" rx="1"/>' : '<path d="m9 5 10 7-10 7z"/>') + '</button></div>' : '';
    var association = a.processAssociation;
    var link = opts.ctrl ? '<button type="button" class="app-associate' + (association ? ' associated' : '') + '" data-associate="' + esc(a.id) + '" aria-controls="processAssociation" aria-expanded="false" aria-label="关联进程 ' + esc(a.name) + '" title="' + esc(association ? '关联进程：' + association.name : '关联进程') + '">' + icon('<path d="M10 13a5 5 0 0 0 7 0l3-3a5 5 0 0 0-7-7l-2 2M14 11a5 5 0 0 0-7 0l-3 3a5 5 0 0 0 7 7l2-2"/>') + '</button>' : '';
    return '<div class="' + cls + '" data-id="' + esc(a.id) + '">' + star + link + dot + appIconHtml(a) +
      '<b>' + esc(a.name) + '</b><div class="run-state" role="status">' + state + '</div>' + ctrl + '</div>';
  }
  function bindAppGrid(box) {
    if (!box) return;
    box.querySelectorAll("[data-launch]").forEach(function (b) {
      b.addEventListener("click", function (e) { e.stopPropagation(); launchApp(b.getAttribute("data-launch")); });
    });
    box.querySelectorAll("[data-close]").forEach(function (b) {
      b.addEventListener("click", function (e) { e.stopPropagation(); closeApp(b.getAttribute("data-close")); });
    });
    box.querySelectorAll('[data-associate]').forEach(function (b) {
      // This tiny control must never arm the grid's long-press sort gesture.
      b.addEventListener('pointerdown', function (e) { e.stopPropagation(); });
      b.addEventListener('click', function (e) {
        e.stopPropagation();
        if (favoriteSort.isInteracting()) return;
        var id = b.getAttribute('data-associate');
        var app = favorites.concat(searchResults).find(function (a) { return a.id === id; });
        if (app) { processAssociation.open(app); b.setAttribute('aria-expanded', 'true'); }
      });
    });
    box.querySelectorAll("[data-star]").forEach(function (b) {
      b.addEventListener("click", function (e) { e.stopPropagation(); toggleFavorite(b.getAttribute("data-star")); });
    });
  }

  // Reconcile by app ID: polling must not recreate loaded images or replay fades.
  function updateAppCards(box, apps, optionsFor) {
    var existing = new Map();
    Array.prototype.forEach.call(box.querySelectorAll('.app[data-id]'), function(card) { existing.set(card.getAttribute('data-id'), card); });
    var cursor = box.firstChild;
    apps.forEach(function(a) {
      var html = appCard(a, optionsFor(a)), card = existing.get(a.id);
      existing.delete(a.id);
      if (!card || card._appMarkup !== html) {
        var holder = document.createElement('div'); holder.innerHTML = html;
        var next = holder.firstChild;
        if (card) {
          var oldIcon = card.querySelector('.ic'), newIcon = next.querySelector('.ic');
          if (oldIcon && newIcon && card._iconKey === JSON.stringify([a.name, !!a.hasIcon])) newIcon.replaceWith(oldIcon);
        }
        bindAppGrid(holder);
        next._appMarkup = html;
        next._iconKey = JSON.stringify([a.name, !!a.hasIcon]);
        if (card) { if (cursor === card) cursor = next; card.replaceWith(next); }
        card = next;
      }
      if (card !== cursor) box.insertBefore(card, cursor);
      cursor = card.nextSibling;
    });
    existing.forEach(function(card) { card.remove(); });
  }

  var processAssociation = window.NervProcessAssociation.init({
    getToken: getToken, post: apiPost, openSettings: focusSetup,
    isSorting: function () { return favoriteSort && favoriteSort.isInteracting(); },
    onSaved: function (id, association) {
      favoriteEpoch++;
      [favorites, searchResults, allApps || []].forEach(function (apps) {
        apps.forEach(function (app) { if (app.id === id) { app.processAssociation = association; app.processAssociationError = ''; } });
      });
      refreshAppViews(); recheckFavorites();
    }
  });

  var addFavoriteTile = document.createElement("button");
  addFavoriteTile.type = "button"; addFavoriteTile.id = "addFavBtn";
  addFavoriteTile.className = "add-fav add-fav-card"; addFavoriteTile.textContent = "＋ 添加常用";
  $("appGrid").appendChild(addFavoriteTile);
  var favoriteSort = window.NervFavoriteSort.init({
    grid: $("appGrid"), doneButton: $("sortDoneBtn"),
    saveOrder: function(ids) { return apiPost("/api/apps/order", {ids: ids}); },
    onModeChange: function(mode) {
      favoriteEpoch++;
      $("sortDoneBtn").hidden = !mode;
      if (!mode) favoriteSort.whenSaved().then(function () { renderFavorites(); refreshFavoriteState(); });
    },
    onOrder: function(ids, result) {
      if (result.ok && result.favorites) favorites = result.favorites;
      else { var byId = new Map(favorites.map(function(a){return [a.id,a];})); favorites = ids.map(function(id){return byId.get(id);}).filter(Boolean); }
      renderFavorites();
    },
    onError: function(e) { toast("保存排序失败：" + esc(e.message), true); favoriteSort.exit(); favoriteSort.whenSaved().then(loadFavorites); }
  });
  function finishFavoriteRender(box) { box.appendChild(addFavoriteTile); favoriteSort.refresh(); }
  var favoriteRequest = null, favoriteEpoch = 0;
  var favoriteRefreshTimer = 0, favoriteRecheckUntil = 0, favoriteRefreshGeneration = 0;
  function loadFavorites() {
    if (favoriteSort.isInteracting()) return Promise.resolve();
    if (favoriteRequest) return favoriteRequest;
    var epoch = favoriteEpoch;
    favoriteRequest = fetch("/api/favorites").then(function (r) {
      if (!r.ok) throw new Error("读取常用软件失败");
      return r.json();
    }).then(function (j) {
      // A hold/sort or a local mutation can begin while this request is in flight.
      if (favoriteSort.isInteracting() || epoch !== favoriteEpoch) return;
      if (!j || !j.ok) throw new Error("读取常用软件失败");
      favorites = j.favorites || []; favError = ""; favLoaded = true;
      var statuses = new Map(favorites.map(function (a) { return [a.id, a]; }));
      searchResults = searchResults.map(function (a) { return statuses.get(a.id) || a; });
      renderFavorites(); renderSearch();
    }).catch(function () {
      if (favoriteSort.isInteracting() || epoch !== favoriteEpoch) return;
      if (!favLoaded) { favorites = []; favLoaded = true; favError = "无法连接服务端"; }
      else favorites.forEach(function (a) { a.running = null; a.canClose = false; });
      renderFavorites();
    }).then(function () { favoriteRequest = null; });
    return favoriteRequest;
  }
  function stopFavoriteRefresh() { clearTimeout(favoriteRefreshTimer); favoriteRefreshTimer = 0; favoriteRefreshGeneration++; }
  function refreshFavoriteState() {
    stopFavoriteRefresh();
    var generation = favoriteRefreshGeneration;
    if (document.hidden || hiddenPaused || current !== 1) return;
    loadFavorites().then(function () {
      if (generation !== favoriteRefreshGeneration || document.hidden || hiddenPaused || current !== 1) return;
      favoriteRefreshTimer = setTimeout(refreshFavoriteState, Date.now() < favoriteRecheckUntil ? 2000 : 5000);
    });
  }
  function recheckFavorites() {
    // Short polling lasts at most one minute per operation; ordinary visible polling continues.
    favoriteRecheckUntil = Date.now() + 60000;
    refreshFavoriteState();
  }
  function renderFavorites() {
    var box = $("appGrid"), empty = $("favEmpty");
    if (!box) return;
    if (favoriteSort.isInteracting()) return;
    /* 常用为空时只显示一条紧凑提示（不再撑满整列，也不改变两栏比例）；
       「添加常用」入口始终是搜索行右侧那一个。 */
    var col = $("appsCol");
    var emptyNow = favLoaded && !favError && !favorites.length;
    if (col) col.classList.toggle("is-empty", emptyNow);

    if (!favLoaded) {
      if (col) col.classList.remove("is-empty");
      box.innerHTML = ""; finishFavoriteRender(box);
      if (empty) { empty.hidden = false; setText($("favEmptyTx"), "正在读取常用软件…"); }
      return;
    }
    if (favError) {
      box.innerHTML = ""; finishFavoriteRender(box);
      if (empty) { empty.hidden = false; setText($("favEmptyTx"), favError); }
      return;
    }
    if (!favorites.length) {
      box.innerHTML = ""; finishFavoriteRender(box);
      if (empty) {
        empty.hidden = false;
        /* 空态只留一行短提示 + 条带里的「添加常用」按钮，不再占大半屏 */
        setText($("favEmptyTx"), "还没有常用软件");
      }
      return;
    }
    if (empty) empty.hidden = true;
    updateAppCards(box, favorites, function () { return { ctrl: true, star: true, starOn: true }; });
    finishFavoriteRender(box);
  }

  function launchApp(id) {
    if (!id || busyIds[id] || favoriteSort.isInteracting()) return Promise.resolve(false);
    if (!getToken()) { toast("先在设置里填入访问令牌", true); focusSetup(); return Promise.resolve(false); }
    busyIds[id] = "launch";
    favoriteEpoch++;
    refreshAppViews();
    return apiPost("/api/launch", { id: id }).then(function (j) {
      toast("已启动：<b>" + esc(j.name || id) + "</b>");
      return true;
    }).catch(function (e) {
      toast("启动失败：" + e.message, true);
      return false;
    }).then(function (ok) {
      delete busyIds[id]; favoriteEpoch++;
      refreshAppViews(); recheckFavorites();
      if (searchWord) doSearch(searchWord);
      return ok;
    });
  }
  function closeApp(id) {
    if (!id || busyIds[id] || favoriteSort.isInteracting()) return;
    var app = favorites.concat(searchResults).find(function (a) { return a.id === id; });
    if (!app || app.running !== true || app.canClose !== true) { toast(esc(app && app.closeReason || "当前无法安全关闭"), true); return; }
    if (!getToken()) { toast("先在设置里填入访问令牌", true); focusSetup(); return; }
    busyIds[id] = "close";
    favoriteEpoch++;
    refreshAppViews();
    /* 关闭不需要二次确认（需求 5.2 明确）。
       需求二.1：后端现在是「先优雅关闭、没响应再强制结束」，最坏要 1.2s + 0.6s，
       所以这里不能用固定的 1.6 秒去刷新列表 —— 必须等接口真正返回后再刷新一次，
       否则界面会先显示「还在运行」，用户会以为没关掉。 */
    apiPost("/api/close-app", { id: id }).then(function (j) {
      toast("已关闭：<b>" + esc(j.name || id) + "</b>" + (j.forced ? "（已强制结束）" : ""));
      delete busyIds[id]; favoriteEpoch++;
      refreshAppViews(); recheckFavorites();
      if (searchWord) doSearch(searchWord);
    }).catch(function (e) {
      toast("关闭失败：" + e.message, true);
      delete busyIds[id]; favoriteEpoch++;
      refreshAppViews(); recheckFavorites();
      if (searchWord) doSearch(searchWord);
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
    if (favoriteSort.isInteracting()) return;
    favoriteEpoch++;
    if (!getToken()) { toast("先在设置里填入访问令牌", true); focusSetup(); return; }
    var isFav = favorites.some(function (a) { return a.id === id; });
    apiPost("/api/favorites", { action: isFav ? "remove" : "add", id: id }).then(function (j) {
      favoriteEpoch++;
      favorites = j.favorites || [];
      favLoaded = true;
      renderFavorites(); renderSearch();
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
    updateAppCards(grid, searchResults, function (a) { return { ctrl: true, star: true, starOn: !!favIds[a.id] }; });
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
          '<div class="ic' + (a.hasIcon ? "" : " no-ic") + '">' + hexBadge(a.name) +
          (a.hasIcon ? '<img alt="" src="/api/apps/' + encodeURIComponent(a.id) + '/icon" onload="this.parentNode.classList.add(\'has-ic\')" onerror="this.style.display=\'none\';this.parentNode.classList.add(\'no-ic\')">' : "") +
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

  /* 当前媒体来源与调音页共享同一份 SMTC 快照；启动页不再拉起固定播放器。 */
  var audioUI = window.NervAudioUI.init({ post: apiPost, toast: toast });
  function renderMedia(m) { audioUI.renderMedia(m); }
  function startMedia() { audioUI.start(); }
  function stopMedia() { audioUI.stop(); }

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
      applyRefreshInterval(serverConfig.refreshIntervalSec);
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

  /* 填了令牌就立刻再试一次 WebSocket：
     之前握手被拒时已经停止重连，现在有凭据了没必要等用户手动刷新页面。 */
  function retryWsNow() {
    conn.wsFails = 0;
    conn.retry = 0;
    if (conn.retryTimer) { clearTimeout(conn.retryTimer); conn.retryTimer = 0; }
    if (!conn.ws) connectWs();
  }
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
    retryWsNow();
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
      applyRefreshInterval(serverConfig.refreshIntervalSec);
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
  var detailRevision = 0, detailFrame = 0, detailMotionTimer = 0;
  var detailOpening = false, detailWork = [];
  function deferDetailWork(work) {
    if (detailOpening) detailWork.push(work);
    else work();
  }
  function finishDetailMotion() {
    clearTimeout(detailMotionTimer);
    detailMotionTimer = 0;
    var sheet = $("detailSheet");
    sheet.classList.remove("is-transitioning");
    if (!detailKey) {
      sheet.classList.remove("open", "is-closing", "is-visible", "is-preparing");
      if (current === 0) drawAllSparks();
      return;
    }
    detailOpening = false;
    var work = detailWork;
    detailWork = [];
    work.forEach(function (fn) { fn(); });
  }
  function openDetail(key) {
    if (!DETAIL_META[key]) return;
    var revision = ++detailRevision;
    cancelAnimationFrame(detailFrame);
    clearTimeout(detailMotionTimer);
    detailWork = [];
    detailOpening = !REDUCED;
    detailKey = key;
    var sheet = $("detailSheet");
    sheet.classList.remove("is-visible", "is-closing");
    sheet.classList.add("open", "is-preparing");
    if (!REDUCED) sheet.classList.add("is-transitioning");
    setText($("detailTitle"), DETAIL_META[key].t);
    setText($("detailEn"), DETAIL_META[key].en);
    /* 基本信息和固定高度画布先就位；网络返回和绘图不抢入场帧。 */
    renderDetail(key);
    sheet.querySelector(".sheet-box").scrollTop = 0;
    if (key === "cpu" || key === "gpu" || key === "ram" || key === "net") {
      loadHistory().then(function (history) {
        if (revision !== detailRevision || detailKey !== key) return;
        deferDetailWork(function () {
          if (revision === detailRevision && detailKey === key) renderDetail(key, history);
        });
      });
    }
    detailFrame = requestAnimationFrame(function () {
      if (revision !== detailRevision) return;
      /* 两帧分隔初始状态与目标状态，不强制同步 layout。 */
      detailFrame = requestAnimationFrame(function () {
        if (revision !== detailRevision) return;
        sheet.classList.remove("is-preparing");
        sheet.classList.add("is-visible");
        if (REDUCED) finishDetailMotion();
        else detailMotionTimer = setTimeout(finishDetailMotion, 290);
      });
    });
    if (detailTimer) clearInterval(detailTimer);
    detailTimer = setInterval(function () { refreshDetailLive(); }, 1000);
  }
  function closeDetail() {
    if (!detailKey) return;
    ++detailRevision;
    detailKey = null;
    detailOpening = false;
    detailWork = [];
    cancelAnimationFrame(detailFrame);
    clearTimeout(detailMotionTimer);
    var sheet = $("detailSheet");
    var wasVisible = sheet.classList.contains("is-visible");
    sheet.classList.remove("is-visible");
    sheet.classList.add("is-closing", "is-transitioning");
    if (detailTimer) { clearInterval(detailTimer); detailTimer = 0; }
    if (REDUCED || !wasVisible) finishDetailMotion();
    else detailMotionTimer = setTimeout(finishDetailMotion, 240);
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

  /* 需求一.4：7 日温度变化曲线（最高温 / 最低温两条折线 + 日期标签）。
     与 drawWeatherHour 同一套视觉语言（橙色高低温、虚线网格），
     区分用两条线：最高温实线带面积，最低温细虚线不带面积，避免两块面积叠在一起糊成一片。 */
  function drawWeatherWeek(id, days) {
    var cv = $(id);
    if (!cv || !days || days.length < 2) return;
    var dpr = Math.min(window.devicePixelRatio || 1, 2);
    var w = cv.clientWidth || 640, h = 150;
    cv.width = Math.round(w * dpr);
    cv.height = Math.round(h * dpr);
    var ctx = cv.getContext("2d");
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);

    var his = [], los = [];
    for (var k = 0; k < days.length; k++) {
      var mx = num(days[k].max), mn = num(days[k].min);
      his.push(mx === null ? null : mx);
      los.push(mn === null ? null : mn);
    }
    var all = his.concat(los).filter(function (v) { return v !== null; });
    if (!all.length) return;
    var max = Math.max.apply(null, all), min = Math.min.apply(null, all);
    if (max - min < 2) { max += 1.5; min -= 1.5; }
    var padX = 24, top = 16, bot = 34;
    var innerW = w - padX * 2, innerH = h - top - bot;
    var n = days.length;
    var stepX = n === 1 ? 0 : innerW / (n - 1);

    function yOf(v) { return top + innerH - ((v - min) / (max - min)) * innerH; }
    function xOf(i) { return padX + stepX * i; }

    /* 网格线 + 左右刻度（只标最高/最低值，避免文字堆叠） */
    ctx.strokeStyle = "rgba(58,35,42,.6)";
    ctx.lineWidth = 1;
    for (var gi = 0; gi <= 4; gi++) {
      var gy = top + (innerH / 4) * gi;
      ctx.beginPath(); ctx.moveTo(padX, gy); ctx.lineTo(w - padX, gy); ctx.stroke();
    }
    ctx.fillStyle = "rgba(201,179,184,.55)";
    ctx.font = "9px Rajdhani,monospace";
    ctx.textAlign = "left";
    ctx.fillText(Math.round(max) + "°", 2, top + 4);
    ctx.fillText(Math.round(min) + "°", 2, h - bot + 4);

    /* 最高温：面积 + 实线 */
    ctx.beginPath();
    var started = false;
    for (var i = 0; i < n; i++) {
      var v = his[i];
      if (v === null) { started = false; continue; }
      if (!started) { ctx.moveTo(xOf(i), yOf(v)); started = true; } else ctx.lineTo(xOf(i), yOf(v));
    }
    ctx.strokeStyle = "#ff8c1a";
    ctx.lineWidth = 2.4;
    ctx.lineJoin = "round";
    ctx.stroke();
    ctx.lineTo(xOf(n - 1), h - bot); ctx.lineTo(xOf(0), h - bot); ctx.closePath();
    var g = ctx.createLinearGradient(0, 0, 0, h);
    g.addColorStop(0, "rgba(255,140,26,.34)");
    g.addColorStop(1, "rgba(255,140,26,0)");
    ctx.fillStyle = g;
    ctx.fill();

    /* 最低温：虚线 + 圆点 */
    ctx.beginPath();
    started = false;
    for (var j = 0; j < n; j++) {
      var v2 = los[j];
      if (v2 === null) { started = false; continue; }
      if (!started) { ctx.moveTo(xOf(j), yOf(v2)); started = true; } else ctx.lineTo(xOf(j), yOf(v2));
    }
    ctx.setLineDash([4, 4]);
    ctx.strokeStyle = "rgba(120,200,255,.85)";
    ctx.lineWidth = 1.8;
    ctx.stroke();
    ctx.setLineDash([]);

    /* 日期标签与数值 */
    ctx.textAlign = "center";
    ctx.font = "9px Rajdhani,monospace";
    for (var li = 0; li < n; li++) {
      var lx = xOf(li);
      ctx.fillStyle = "rgba(201,179,184,.85)";
      ctx.fillText(String(days[li].label || days[li].date || "").replace(/^\d{1,2}-\d{1,2}$/, ""), lx, h - 12);
      if (his[li] !== null) {
        ctx.fillStyle = "#ff8c1a";
        ctx.fillText(Math.round(his[li]) + "°", lx, yOf(his[li]) - 6);
      }
      if (los[li] !== null) {
        ctx.fillStyle = "rgba(120,200,255,.9)";
        ctx.fillText(Math.round(los[li]) + "°", lx, yOf(los[li]) + 13);
      }
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

  function renderDetail(key, history) {
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
      /* 当日气温曲线（逐小时）：Open-Meteo 逐小时气温，0:00 → 23:00 */
      var hr = w.hourly || [];
      if (hr.length >= 4) {
        html += '<p class="d-note">当日气温曲线（逐小时）</p>';
        html += '<canvas class="dchart wx-chart" id="wxHourChart" width="640" height="130"></canvas>';
        html += '<div class="d-chart-cap"><span>' + (hr[0] ? hr[0].h : "") + "</span><span>" + (hr[hr.length - 1] ? hr[hr.length - 1].h : "") + "</span></div>";
      }
      /* 需求一.4：7 日温度变化曲线 */
      var ds = w.days || [];
      if (ds.length >= 2) {
        html += '<p class="d-note">7 日温度变化曲线（<b style="color:#ff8c1a">最高温</b> / <b style="color:#78c8ff">最低温</b>）</p>';
        html += '<canvas class="dchart wx-week" id="wxWeekChart" width="640" height="150"></canvas>';
      }
      if (w.stale) {
        html += '<p class="d-note">当前显示的是 ' + (num(w.staleAgeMin) === null ? "较早" : Math.round(w.staleAgeMin) + " 分钟前") +
          ' 成功获取的数据（实时接口暂时不可用，会自动重试）。</p>';
      }
      html += '<p class="d-note">未来 ' + ds.length + " 天</p>";
      html += '<div class="d-rows">' + ds.map(function (d) {
        return '<div class="d-row"><span class="dn">' + (d.label || d.date || EMPTY) + '</span><span style="color:var(--ink-dim);font-size:13.5px">' +
          (d.desc || EMPTY) + '</span><span class="dv">' +
          (num(d.max) === null ? EMPTY : Math.round(d.max)) + "° / " + (num(d.min) === null ? EMPTY : Math.round(d.min)) + "°</span></div>";
      }).join("") + "</div>";
      body.innerHTML = html;
      deferDetailWork(function () {
        if (hr.length >= 4) drawWeatherHour("wxHourChart", hr);
        if (ds.length >= 2) drawWeatherWeek("wxWeekChart", ds);
      });
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

    /* 首次同步呈现基本信息；历史统计随后填充，画布始终预留空间。 */
    var h = history || { points: [], spanSec: 0 };
    {
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
        if (history) drawDetail("dchart", pts.map(function (p) { return p.cpu; }), "#ff8c1a");
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
        if (history) drawDetail("dchart", pts.map(function (p) { return p.gpu; }), "#e8321e");
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
        if (history) drawDetail("dchart", pts.map(function (p) { return p.ram; }), "#ffb52e");
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
        if (history) drawDetail("dchart", pts.map(function (p) { return p.netDown; }), "#39c2d7");
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
    }
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
          /* 屏幕转向后表决图尺寸变了，连线要按新坐标重算 */
          if (boot && boot.style.display !== "none") layoutVoteLines();
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
    refreshOfflineBanner();
    if (prev === 0) stopClock(), stopSync(), stopWeather(), stopMedia();
    if (prev === 1) { stopStatusTimer(); stopFavoriteRefresh(); favoriteSort.exit(); }
    if (hiddenPaused) return;
    if (now === 0) { startClock(); startSync(); startWeather(); drawAllSparks(); }
    startMedia();
    if (now === 1) { startStatusTimer(); refreshFavoriteState(); }
  });
  document.addEventListener("visibilitychange", function () {
    hiddenPaused = document.hidden;
    if (hiddenPaused) {
      hiddenAt = Date.now();
      stopFavoriteRefresh(); favoriteSort.exit();
      stopClock(); stopSync(); stopWeather(); stopStatusTimer(); stopMedia(); stopPixelShift();
    } else {
      notifyVisible(current);
      startPixelShift();
      /* 需求三.1：平板熄屏点亮后重新弹出启动界面（短暂切后台不触发，避免闪屏） */
      var away = hiddenAt ? Date.now() - hiddenAt : 0;
      hiddenAt = 0;
      if (away >= SCREEN_OFF_MIN_MS && boot) replayBoot();
    }
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
    /* OLED 防烧屏：常驻的 1 像素微位移循环（优化计划 3） */
    startPixelShift();
    setTimeout(movePsInd, 60);
    setTimeout(movePsInd, 400);
    if (document.fonts && document.fonts.ready) document.fonts.ready.then(movePsInd);
    window.addEventListener("load", movePsInd);
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot0);
  else boot0();
})();
