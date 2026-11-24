/* ==========================================================================
 * NERV PANEL · 前端脚本
 * 阶段 2–5：全部数据来自服务端真实采集，前端不再包含任何演示数据
 *   - 硬件监控：WebSocket 优先，断线退避重连，失败降级 HTTP 轮询
 *   - 启动页：GET /api/apps（服务端扫描），POST /api/launch 启动
 *   - 天气：GET /api/weather，读不到一律显示「—」
 *   - 电源与系统操作：二次确认后 POST /api/power、/api/system（带 token）
 * ========================================================================== */
(function () {
  "use strict";

  var $ = function (id) {
    return document.getElementById(id);
  };
  function pad(n) {
    return (n < 10 ? "0" : "") + n;
  }
  function clamp(v, a, b) {
    return Math.max(a, Math.min(b, v));
  }
  function setText(el, text) {
    if (el && el.textContent !== text) el.textContent = text;
  }

  /* ---------------------------------------------------------------- toast */
  var toastTimer = null;
  function toast(html, isErr) {
    var t = $("toast");
    t.innerHTML = html;
    t.classList.toggle("err", !!isErr);
    t.classList.add("show");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () {
      t.classList.remove("show");
    }, 2800);
  }

  /* ---------------------------------------------------------------- modal */
  var modal = $("modal");
  var modalResolve = null;
  function confirmBox(title, text, okLabel) {
    $("modalTitle").textContent = title;
    $("modalText").textContent = text;
    $("modalOk").textContent = okLabel || "确认";
    modal.classList.add("open");
    return new Promise(function (resolve) {
      modalResolve = resolve;
    });
  }
  function closeModal(result) {
    modal.classList.remove("open");
    if (modalResolve) {
      var r = modalResolve;
      modalResolve = null;
      r(result);
    }
  }
  $("modalCancel").addEventListener("click", function () {
    closeModal(false);
  });
  $("modalOk").addEventListener("click", function () {
    closeModal(true);
  });
  modal.addEventListener("click", function (e) {
    if (e.target === modal) closeModal(false);
  });
  document.addEventListener("keydown", function (e) {
    if (e.key === "Escape" && modal.classList.contains("open")) closeModal(false);
  });

  /* ------------------------------------------------------------ 页面状态 */
  var pages = Array.prototype.slice.call(document.querySelectorAll(".page"));
  var track = $("pagerTrack");
  var viewport = $("pagerViewport");
  var dockBtns = Array.prototype.slice.call(document.querySelectorAll("nav.dock button"));
  var dotsBox = $("dots");
  var glider = $("dockGlider");
  var current = 1; /* 默认打开总览 */
  var total = pages.length;
  var visibleHooks = [];

  function onPageVisible(fn) {
    visibleHooks.push(fn);
  }
  function notifyVisible(prev) {
    /* 传给钩子的是「当前页面下标」与「上一次页面下标」，不是钩子在数组里的下标。
       两者语义完全不同：用 i 当页面下标会让所有页都判定成不可见。 */
    visibleHooks.forEach(function (fn) {
      fn(current, prev);
    });
  }

  pages.forEach(function (_, i) {
    var b = document.createElement("button");
    b.type = "button";
    b.setAttribute("aria-label", pages[i].getAttribute("data-title"));
    b.innerHTML = "<i></i>";
    b.addEventListener("click", function () {
      goTo(i);
    });
    dotsBox.appendChild(b);
  });
  var dotBtns = Array.prototype.slice.call(dotsBox.querySelectorAll("button"));

  function moveGlider(instant) {
    var btn = dockBtns[current];
    if (!btn || !glider) return;
    if (instant) glider.classList.add("no-anim");
    glider.style.width = btn.offsetWidth + "px";
    glider.style.transform = "translateX(" + btn.offsetLeft + "px)";
    if (instant) {
      void glider.offsetWidth;
      glider.classList.remove("no-anim");
    }
  }

  function goTo(n, opts) {
    var target = clamp(n, 0, total - 1);
    var prev = current;
    var dir = target - prev;
    if (dir === 0 && !(opts && opts.force)) return;
    current = target;
    track.style.transform = "translate3d(" + -current * 100 + "%,0,0)";
    dockBtns.forEach(function (b, i) {
      b.classList.toggle("on", i === current);
      b.setAttribute("aria-selected", i === current ? "true" : "false");
    });
    dotBtns.forEach(function (b, i) {
      b.classList.toggle("on", i === current);
    });
    moveGlider(opts && opts.instant);
    if (dir !== 0) {
      var pin = pages[current].querySelector(".page-in");
      if (pin) {
        pin.classList.remove("pg-in-r", "pg-in-l");
        void pin.offsetWidth;
        pin.classList.add(dir > 0 ? "pg-in-r" : "pg-in-l");
        setTimeout(function () {
          pin.classList.remove("pg-in-r", "pg-in-l");
        }, 560);
      }
    }
    setText($("pageTitle"), pages[current].getAttribute("data-title"));
    setText($("pageEn"), pages[current].getAttribute("data-en"));
    notifyVisible(prev);
  }

  dockBtns.forEach(function (b) {
    b.addEventListener("click", function () {
      goTo(parseInt(b.getAttribute("data-page"), 10));
    });
  });
  window.addEventListener(
    "resize",
    function () {
      moveGlider(true);
    },
    { passive: true }
  );
  document.addEventListener("keydown", function (e) {
    if (modal.classList.contains("open")) return;
    if (!$("boot").classList.contains("done")) return;
    if (e.key === "ArrowRight") goTo(current + 1);
    if (e.key === "ArrowLeft") goTo(current - 1);
  });

  /* 滑动翻页：只认横向主导的滑动，不抢竖向滚动 */
  var sx = 0,
    sy = 0,
    swiping = false;
  viewport.addEventListener(
    "touchstart",
    function (e) {
      var t = e.changedTouches[0];
      sx = t.clientX;
      sy = t.clientY;
      swiping = true;
    },
    { passive: true }
  );
  viewport.addEventListener(
    "touchend",
    function (e) {
      if (!swiping) return;
      swiping = false;
      var t = e.changedTouches[0];
      var dx = t.clientX - sx;
      var dy = t.clientY - sy;
      if (Math.abs(dx) > 56 && Math.abs(dx) > Math.abs(dy) * 1.6) goTo(current + (dx < 0 ? 1 : -1));
    },
    { passive: true }
  );
  var mDown = false,
    mx = 0,
    my = 0;
  viewport.addEventListener("pointerdown", function (e) {
    if (e.pointerType === "mouse") {
      mDown = true;
      mx = e.clientX;
      my = e.clientY;
    }
  });
  viewport.addEventListener("pointerup", function (e) {
    if (!mDown) return;
    mDown = false;
    var dx = e.clientX - mx;
    var dy = e.clientY - my;
    if (Math.abs(dx) > 70 && Math.abs(dx) > Math.abs(dy) * 1.6) goTo(current + (dx < 0 ? 1 : -1));
  });

  /* --------------------------------------------------------- 启动动画 MAGI */
  (function boot() {
    var SEG_N = 20;
    var segsBox = $("bootSegs");
    for (var s = 0; s < SEG_N; s++) {
      segsBox.appendChild(document.createElement("i"));
    }
    var segEls = segsBox.children;
    var bootLines = [
      "> <span class='sys'>MAGI SYSTEM</span> 表决 …… <span class='ok'>承認 2</span> · <span class='sys'>否定 1</span> · 多数决通过",
      "> 驾驶员识别：ASUKA LANGLEY …… <span class='ok'>OK</span>",
      "> <span class='sys'>EVA-02</span> 神经链接 · A10 回路 …… <span class='ok'>OK</span>",
      "> LCL 注入 · 插入栓锁定 …… <span class='ok'>OK</span>",
      "> 局域网链路初始化 …… <span class='warn'>等待电脑服务端</span>",
      "> 甲板载入：启动 / 总览 / 硬件监控 / 系统 …… <span class='ok'>OK</span>"
    ];
    var phases = ["MAGI 检查中", "驾驶员识别", "神经链接同步", "LCL 注入", "局域网扫描", "甲板载入完成"];
    var logEl = $("bootLog");
    var pctEl = $("bootPct");
    var phaseEl = $("bootPhase");
    var enterBtn = $("enterBtn");
    var skipBtn = $("skipBtn");
    var bootEl = $("boot");
    var li = 0;
    var progress = 0;
    var lineTimer = setInterval(function () {
      if (li >= bootLines.length) return;
      var d = document.createElement("div");
      d.innerHTML = bootLines[li];
      logEl.appendChild(d);
      while (logEl.children.length > 6) logEl.removeChild(logEl.firstChild);
      phaseEl.textContent = phases[Math.min(li, phases.length - 1)];
      li++;
    }, 380);
    /* 分段进度条：5% × 160ms × 20 段 = 3.2 秒，
       加上 760ms 淡出，整段开机动画落在需求要求的 3–5 秒区间内。 */
    var barTimer = setInterval(function () {
      progress = Math.min(100, progress + 5);
      pctEl.textContent = Math.floor(progress) + "%";
      var on = Math.round((progress / 100) * SEG_N);
      for (var k = 0; k < SEG_N; k++) segEls[k].classList.toggle("on", k < on);
      if (progress >= 100) {
        clearInterval(barTimer);
        clearInterval(lineTimer);
        while (li < bootLines.length) {
          var d2 = document.createElement("div");
          d2.innerHTML = bootLines[li];
          logEl.appendChild(d2);
          li++;
        }
        phaseEl.textContent = "待命 — READY";
        enterBtn.disabled = false;
        enterBtn.textContent = "EVA-02，启动！";
      }
    }, 160);

    function dismiss() {
      if (bootEl.classList.contains("done")) return;
      bootEl.classList.add("done");
      setTimeout(function () {
        bootEl.style.display = "none";
      }, 760);
      startVisibleTimers();
    }
    enterBtn.addEventListener("click", dismiss);
    skipBtn.addEventListener("click", dismiss);
    bootEl.addEventListener(
      "pointermove",
      function (e) {
        if (bootEl.classList.contains("done")) return;
        var x = e.clientX / Math.max(1, window.innerWidth) - 0.5;
        var y = e.clientY / Math.max(1, window.innerHeight) - 0.5;
        bootEl.style.setProperty("--px", (x * 22).toFixed(1) + "px");
        bootEl.style.setProperty("--py", (y * 14).toFixed(1) + "px");
      },
      { passive: true }
    );
    window.__bootDismiss = dismiss;
  })();

  /* ------------------------------------------------------------- 时钟日历 */
  var weekNames = ["星期日", "星期一", "星期二", "星期三", "星期四", "星期五", "星期六"];
  var clockLastSec = -1;
  var clockOn = false;

  function renderCalendar(now) {
    var y = now.getFullYear();
    var m = now.getMonth();
    var today = now.getDate();
    setText($("calTitle"), y + " 年 " + (m + 1) + " 月");
    setText($("calSub"), "TODAY · " + pad(m + 1) + "-" + pad(today));
    var firstDow = new Date(y, m, 1).getDay();
    var dim = new Date(y, m + 1, 0).getDate();
    var dp = new Date(y, m, 0).getDate();
    var dows = ["日", "一", "二", "三", "四", "五", "六"];
    var html = "";
    for (var i = 0; i < 7; i++) html += "<div class='dow'>" + dows[i] + "</div>";
    for (var p = firstDow - 1; p >= 0; p--) html += "<div class='day dim'>" + (dp - p) + "</div>";
    for (var d = 1; d <= dim; d++) {
      var dow = (firstDow + d - 1) % 7;
      var cls = "day";
      if (d === today) cls += " today";
      else if (dow === 0 || dow === 6) cls += " weekend";
      html += "<div class='" + cls + "'>" + d + "</div>";
    }
    var tail = (firstDow + dim) % 7;
    if (tail !== 0) for (var n = 1; n <= 7 - tail; n++) html += "<div class='day dim'>" + n + "</div>";
    $("calGrid").innerHTML = html;
  }

  function tickClock(now) {
    var s = now.getSeconds();
    if (s === clockLastSec) return;
    clockLastSec = s;
    setText($("clockHM"), pad(now.getHours()) + ":" + pad(now.getMinutes()));
    setText($("clockS"), ":" + pad(s));
    var dateText = now.getFullYear() + " 年 " + (now.getMonth() + 1) + " 月 " + now.getDate() + " 日";
    if ($("dateLine").textContent !== dateText) {
      setText($("dateLine"), dateText);
      setText($("weekLine"), weekNames[now.getDay()]);
      renderCalendar(now);
    }
  }

  /* 时钟按「整秒对齐」的定时器驱动，不用 requestAnimationFrame。
     120Hz 屏幕上 rAF 每秒唤醒 120 次，而秒针每秒只需更新 1 次，
     这里改成对齐到下一个整秒的 setTimeout，只在真正要变的那一刻唤醒。 */
  var clockTimer = 0;
  function scheduleClockTick() {
    if (!clockOn) return;
    var now = new Date();
    var wait = 1000 - now.getMilliseconds();
    clockTimer = setTimeout(function () {
      clockTimer = 0;
      if (!clockOn) return;
      tickClock(new Date());
      scheduleClockTick();
    }, wait);
  }
  function startClock() {
    if (clockOn) return;
    clockOn = true;
    clockLastSec = -1;
    tickClock(new Date());
    scheduleClockTick();
  }
  function stopClock() {
    clockOn = false;
    if (clockTimer) clearTimeout(clockTimer);
    clockTimer = 0;
  }

  /* --------------------------------------------------------------- 天气 */
  /* 数据来自服务端 GET /api/weather（城市读 config.json），前端不做任何估算 */
  var weatherTimer = 0;

  function wxEmpty() {
    setText($("wxTemp"), "—");
    setText($("wxDesc"), "—");
    setText($("wxMeta"), "—");
    $("wxDays").innerHTML = "";
  }

  function renderWeather(w) {
    if (!w) {
      wxEmpty();
      return;
    }
    setText($("wxTemp"), w.temp == null ? "—" : String(w.temp));
    var desc = w.desc == null ? "—" : w.desc;
    setText($("wxDesc"), w.city ? desc + " · " + w.city : desc);
    var parts = [];
    parts.push("体感 " + (w.feels == null ? "—" : w.feels + "°C"));
    parts.push("湿度 " + (w.humidity == null ? "—" : w.humidity + "%"));
    var line2 = [];
    line2.push(w.windDir == null ? "风向 —" : w.windDir);
    line2.push(w.windLevel == null ? "风力 —" : w.windLevel + " 级");
    line2.push("空气" + (w.air == null ? " —" : w.air));
    $("wxMeta").innerHTML = parts.join(" · ") + "<br/>" + line2.join(" · ");
    var html = "";
    (w.days || []).forEach(function (d) {
      html +=
        "<div><div class='d'>" +
        (d.label || "—") +
        "</div><div class='t'><b>" +
        (d.max == null ? "—" : d.max + "°") +
        "</b> <span>" +
        (d.min == null ? "—" : d.min + "°") +
        "</span></div></div>";
    });
    $("wxDays").innerHTML = html;
  }

  function loadWeather() {
    return fetch("/api/weather", { cache: "no-store" })
      .then(function (r) {
        return r.json().then(function (j) {
          if (!r.ok || !j.ok) throw new Error(j.message || "HTTP " + r.status);
          return j.weather;
        });
      })
      .then(function (w) {
        renderWeather(w);
      })
      .catch(function () {
        /* 拿不到就全部显示「—」，不编造 */
        wxEmpty();
      });
  }

  function startWeather() {
    if (weatherTimer) return;
    loadWeather();
    weatherTimer = setInterval(loadWeather, 10 * 60 * 1000);
  }
  function stopWeather() {
    if (weatherTimer) clearInterval(weatherTimer);
    weatherTimer = 0;
  }

  /* ------------------------------------------------------------- 主视觉 */
  function applyHero(path) {
    var img = $("heroImg");
    var fb = $("heroFallback");
    if (!path) {
      img.removeAttribute("src");
      fb.hidden = false;
      return;
    }
    img.onload = function () {
      fb.hidden = true;
    };
    img.onerror = function () {
      fb.hidden = false;
    };
    img.src = path;
  }

  /* ------------------------------------------------------------- 走势线 */
  var HIST_LEN = 60;
  var histories = { cpu: [], gpu: [], ram: [] };

  function fitCanvas(c) {
    var dpr = Math.min(window.devicePixelRatio || 1, 2);
    var w = c.clientWidth || 300;
    var h = c.clientHeight || 34;
    if (c.width !== Math.round(w * dpr) || c.height !== Math.round(h * dpr)) {
      c.width = Math.round(w * dpr);
      c.height = Math.round(h * dpr);
    }
    var ctx = c.getContext("2d");
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    return { ctx: ctx, w: w, h: h };
  }

  function drawSpark(id, hist, stroke, fill) {
    var c = $(id);
    if (!c) return;
    var o = fitCanvas(c);
    var ctx = o.ctx,
      W = o.w,
      H = o.h;
    ctx.clearRect(0, 0, W, H);
    ctx.strokeStyle = "rgba(255,255,255,.06)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(0, H - 2);
    ctx.lineTo(W, H - 2);
    ctx.stroke();
    if (hist.length < 2) return;
    var step = W / (HIST_LEN - 1);
    ctx.beginPath();
    for (var i = 0; i < hist.length; i++) {
      var x = i * step;
      var y = H - 3 - (clamp(hist[i], 0, 100) / 100) * (H - 8);
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.strokeStyle = stroke;
    ctx.lineWidth = 1.6;
    ctx.lineJoin = "round";
    ctx.stroke();
    ctx.lineTo((hist.length - 1) * step, H);
    ctx.lineTo(0, H);
    ctx.closePath();
    ctx.fillStyle = fill;
    ctx.fill();
  }

  function pushHist(k, v) {
    var h = histories[k];
    h.push(v);
    if (h.length > HIST_LEN) h.shift();
  }

  function drawAllSparks() {
    drawSpark("cpuSpark", histories.cpu, "rgb(255,140,26)", "rgba(255,140,26,.14)");
    drawSpark("gpuSpark", histories.gpu, "rgb(255,74,45)", "rgba(255,74,45,.14)");
    drawSpark("ramSpark", histories.ram, "rgb(57,194,215)", "rgba(57,194,215,.14)");
  }

  /* -------------------------------------------------------------- 监控 */
  function fmtGB(bytes) {
    return (bytes / 1024 / 1024 / 1024).toFixed(1);
  }
  function pct(v) {
    return v == null ? 0 : clamp(v, 0, 100);
  }

  /* 进度条用 transform: scaleX 驱动，不用 width，避免每秒重排 */
  function setBar(el, v) {
    if (!el) return;
    el.style.transform = "scaleX(" + pct(v) / 100 + ")";
  }

  function renderDisks(disks) {
    var box = $("diskList");
    setText($("diskCount"), (disks || []).length + " 块");
    if (!disks || !disks.length) {
      box.innerHTML = "<div class='disk-item'><div class='di-sub'>未读取到磁盘信息</div></div>";
      return;
    }
    var html = "";
    disks.forEach(function (d, i) {
      html +=
        "<div class='disk-item'>" +
        "<div class='di-top'><span class='di-name'>" +
        escapeHtml(d.name || "磁盘 " + (i + 1)) +
        "</span><span class='di-pct'>" +
        (d.usage == null ? "—" : Math.round(d.usage) + "%") +
        "</span></div>" +
        "<div class='di-sub'>" +
        (d.used == null ? "—" : fmtGB(d.used) + " GB") +
        " / " +
        (d.total == null ? "—" : fmtGB(d.total) + " GB") +
        "</div>" +
        "<div class='bar cool'><i style='transform:scaleX(" +
        pct(d.usage) / 100 +
        ")'></i></div>" +
        "</div>";
    });
    box.innerHTML = html;
  }

  function renderMetrics(m) {
    if (!m) return;
    /* CPU */
    setText($("cpuName"), m.cpu && m.cpu.name ? m.cpu.name : "—");
    setText($("cpuUse"), m.cpu && m.cpu.usage != null ? String(Math.round(m.cpu.usage)) : "—");
    setText($("cpuTemp"), m.cpu && m.cpu.temp != null ? Math.round(m.cpu.temp) + "°C" : "—");
    var cpuSub = [];
    if (m.cpu && m.cpu.freq != null) cpuSub.push("频率 " + m.cpu.freq.toFixed(2) + " GHz");
    setText($("cpuSub"), cpuSub.length ? cpuSub.join(" · ") : "频率 —");
    setBar($("cpuBar"), m.cpu && m.cpu.usage);
    $("stCpu").classList.toggle("hot", !!(m.cpu && m.cpu.temp != null && m.cpu.temp >= 80));

    /* GPU */
    setText($("gpuName"), m.gpu && m.gpu.name ? m.gpu.name : "—");
    setText($("gpuUse"), m.gpu && m.gpu.usage != null ? String(Math.round(m.gpu.usage)) : "—");
    setText($("gpuTemp"), m.gpu && m.gpu.temp != null ? Math.round(m.gpu.temp) + "°C" : "—");
    var gpuSub = [];
    if (m.gpu && m.gpu.vramTotal) {
      gpuSub.push(
        "显存 " + (m.gpu.vramUsed != null ? fmtGB(m.gpu.vramUsed) : "—") + " / " + fmtGB(m.gpu.vramTotal) + " GB"
      );
    } else {
      gpuSub.push("显存 —");
    }
    gpuSub.push("频率 " + (m.gpu && m.gpu.freq != null ? Math.round(m.gpu.freq) + " MHz" : "—"));
    gpuSub.push("功耗 " + (m.gpu && m.gpu.power != null ? Math.round(m.gpu.power) + " W" : "—"));
    setText($("gpuSub"), gpuSub.join(" · "));
    setBar($("gpuBar"), m.gpu && m.gpu.usage);
    $("stGpu").classList.toggle("hot", !!(m.gpu && m.gpu.temp != null && m.gpu.temp >= 82));

    /* 内存 */
    setText($("ramUse"), m.ram && m.ram.usage != null ? String(Math.round(m.ram.usage)) : "—");
    setText($("ramTotal"), m.ram && m.ram.total ? fmtGB(m.ram.total) + " GB" : "—");
    setText(
      $("ramSub"),
      m.ram && m.ram.total ? "已用 " + fmtGB(m.ram.used) + " GB / " + fmtGB(m.ram.total) + " GB" : "—"
    );
    setBar($("ramBar"), m.ram && m.ram.usage);

    /* 网络 */
    var down = m.net && m.net.down != null ? m.net.down : null;
    var up = m.net && m.net.up != null ? m.net.up : null;
    setText($("netDown"), down == null ? "—" : down.toFixed(1));
    setText($("netSub"), "上传 " + (up == null ? "—" : up.toFixed(1)) + " MB/s");
    setText($("netDownAlt"), down == null ? "—" : down.toFixed(2) + " MB/s");
    setText($("netUpAlt"), up == null ? "—" : up.toFixed(2) + " MB/s");

    /* 磁盘 */
    renderDisks(m.disks);

    /* 总览速览 */
    setText($("miniCpu"), m.cpu && m.cpu.usage != null ? String(Math.round(m.cpu.usage)) : "—");
    setText($("miniCpuSub"), m.cpu && m.cpu.temp != null ? Math.round(m.cpu.temp) + "°C · " + (m.cpu.name || "—") : m.cpu && m.cpu.name ? m.cpu.name : "—");
    setText($("miniGpu"), m.gpu && m.gpu.usage != null ? String(Math.round(m.gpu.usage)) : "—");
    setText(
      $("miniGpuSub"),
      m.gpu && m.gpu.vramTotal
        ? (m.gpu.temp != null ? Math.round(m.gpu.temp) + "°C · " : "") + "显存 " + fmtGB(m.gpu.vramUsed || 0) + " GB"
        : "—"
    );
    setText($("miniRam"), m.ram && m.ram.usage != null ? String(Math.round(m.ram.usage)) : "—");
    setText($("miniRamSub"), m.ram && m.ram.total ? fmtGB(m.ram.used) + " / " + fmtGB(m.ram.total) + " GB" : "—");
    setText($("miniNet"), down == null ? "—" : down.toFixed(1));
    setText($("miniNetSub"), up == null ? "—" : "↑ " + up.toFixed(1) + " MB/s");

    /* 走势线只在本页可见时绘制；取不到的采样点直接跳过，不补 0 以免图形失真 */
    if (m.cpu && m.cpu.usage != null) pushHist("cpu", m.cpu.usage);
    if (m.gpu && m.gpu.usage != null) pushHist("gpu", m.gpu.usage);
    if (m.ram && m.ram.usage != null) pushHist("ram", m.ram.usage);
    if (current === 2) drawAllSparks();
  }

  /* ------------------------------------------------------- 连接与重连 */
  var conn = {
    ws: null,
    wsAlive: false,
    online: false,
    retry: 0,
    retryTimer: 0,
    pollTimer: 0,
    pollFallback: false,
    everConnected: false,
    lastMsgAt: 0
  };
  var REFRESH_SEC = 1;
  var serverConfig = {};

  function setConnUI(state) {
    /* state: 'connecting' | 'online' | 'offline' | 'polling' */
    var pill = $("connPill");
    var text = $("connText");
    var banner = $("monOffline");
    var statusLine = $("statusLine");
    pill.classList.remove("online", "offline");
    if (state === "online") {
      pill.classList.add("online");
      text.textContent = "已连接";
      banner.hidden = true;
      if (statusLine) {
        statusLine.innerHTML = "EVA-02 · 同步中 · <b>A.T. FIELD ALL GREEN</b>";
        statusLine.classList.remove("off");
      }
    } else if (state === "polling") {
      pill.classList.add("online");
      text.textContent = "轮询模式";
      banner.hidden = true;
      if (statusLine) {
        statusLine.innerHTML = "EVA-02 · 轮询链路 · <b>A.T. FIELD STABLE</b>";
        statusLine.classList.remove("off");
      }
    } else if (state === "offline") {
      pill.classList.add("offline");
      text.textContent = "离线";
      banner.hidden = false;
      if (statusLine) {
        statusLine.innerHTML = "EVA-02 · <b>连接中断</b> · A.T. FIELD LOST";
        statusLine.classList.add("off");
      }
    } else {
      text.textContent = "连接中";
      banner.hidden = true;
    }
    /* 连接状态一变就同步刷新系统页的连接信息，
       否则该页在第一次连上之前渲染的「未连接 / —」会一直停在那里。 */
    if (typeof renderSystemStatus === "function") renderSystemStatus();
    if (conn.online) fetchStatus().then(renderSystemStatus).catch(function () {});
  }

  function stopPolling() {
    if (conn.pollTimer) clearInterval(conn.pollTimer);
    conn.pollTimer = 0;
    conn.pollFallback = false;
  }

  function startPolling() {
    if (conn.pollTimer) return;
    conn.pollFallback = true;
    setConnUI("polling");
    var tick = function () {
      fetch("/api/metrics", { cache: "no-store" })
        .then(function (r) {
          if (!r.ok) throw new Error("HTTP " + r.status);
          return r.json();
        })
        .then(function (j) {
          if (!j || !j.ok || !j.metrics) throw new Error("BAD_PAYLOAD");
          conn.online = true;
          conn.lastMsgAt = Date.now();
          renderMetrics(j.metrics);
        })
        .catch(function () {
          conn.online = false;
          setConnUI("offline");
        });
    };
    tick();
    conn.pollTimer = setInterval(tick, Math.max(1, REFRESH_SEC) * 1000);
  }

  function scheduleReconnect() {
    if (conn.retryTimer) return;
    conn.retry = conn.retry + 1;
    var delays = [1000, 2000, 3000, 5000, 8000, 13000, 21000, 30000];
    var wait = delays[Math.min(conn.retry - 1, delays.length - 1)];
    conn.retryTimer = setTimeout(function () {
      conn.retryTimer = 0;
      connectWs();
    }, wait);
  }

  function connectWs() {
    if (!("WebSocket" in window)) {
      startPolling();
      return;
    }
    var proto = location.protocol === "https:" ? "wss:" : "ws:";
    var url = proto + "//" + location.host + "/ws/metrics";
    var ws;
    try {
      ws = new WebSocket(url);
    } catch (err) {
      startPolling();
      return;
    }
    conn.ws = ws;

    ws.onopen = function () {
      conn.wsAlive = true;
      conn.online = true;
      conn.retry = 0;
      conn.everConnected = true;
      conn.lastMsgAt = Date.now();
      stopPolling();
      setConnUI("online");
    };
    ws.onmessage = function (ev) {
      var msg;
      try {
        msg = JSON.parse(ev.data);
      } catch (err) {
        return;
      }
      if (msg && msg.type === "metrics" && msg.data) {
        conn.online = true;
        conn.lastMsgAt = Date.now();
        if (!$("monOffline").hidden) setConnUI("online");
        renderMetrics(msg.data);
      }
    };
    ws.onclose = function () {
      conn.wsAlive = false;
      conn.online = false;
      conn.ws = null;
      if (conn.everConnected) {
        /* 曾连上过：先显示离线，再尝试重连；连续失败 3 次后开启 HTTP 轮询兜底 */
        setConnUI("offline");
        if (conn.retry >= 2) startPolling();
      } else {
        startPolling();
      }
      scheduleReconnect();
    };
    ws.onerror = function () {
      /* 交给 onclose 统一处理 */
    };
  }

  /* 连接看门狗：WebSocket 长时间无消息视为掉线 */
  setInterval(function () {
    if (conn.wsAlive && Date.now() - conn.lastMsgAt > 6000) {
      conn.online = false;
      setConnUI("offline");
      try {
        conn.ws.close();
      } catch (err) {
        /* 忽略 */
      }
    }
  }, 3000);

  /* -------------------------------------------------------------- 启动页 */
  /* 数据来自服务端 GET /api/apps（扫描开始菜单与 Steam 库），前端不写死任何名单 */
  var PLACEHOLDER_ICON =
    "<svg viewBox='0 0 24 24' fill='none' stroke='currentColor' stroke-width='1.6' stroke-linecap='round' stroke-linejoin='round'>" +
    "<rect x='3.5' y='3.5' width='17' height='17' rx='2.5'/><path d='M8 9h8M8 12.5h8M8 16h5'/></svg>";

  var appList = [];
  var appQuery = "";
  var launching = {};
  var appsLoaded = false;
  var appsError = "";

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }

  function filteredApps() {
    var q = appQuery.trim().toLowerCase();
    if (!q) return appList;
    return appList.filter(function (a) {
      return a.name.toLowerCase().indexOf(q) >= 0;
    });
  }

  function buildAppTile(a) {
    var b = document.createElement("button");
    b.type = "button";
    b.className = "app cut" + (a.type === "game" ? " game" : "");
    if (launching[a.id]) b.classList.add("busy");
    b.innerHTML =
      "<span class='ic'>" +
      "<span class='ph'>" +
      PLACEHOLDER_ICON +
      "</span>" +
      "</span><b>" +
      escapeHtml(a.name) +
      "</b><span>" +
      (launching[a.id] ? "启动中…" : a.type === "game" ? "GAME" : "APP") +
      "</span>";

    /* 图标是按需生成的，第一次打开启动页时服务端可能还在提取。
       先显示占位图，真的取到图标再淡入，避免出现一片空黑框。 */
    if (a.hasIcon !== false) {
      var img = new Image();
      var holder = b.querySelector(".ic");
      img.alt = "";
      img.className = "app-ic";
      img.onload = function () {
        if (!img.naturalWidth) return;
        holder.classList.add("has-ic");
        holder.appendChild(img);
      };
      img.onerror = function () {};
      img.src = "/api/apps/" + encodeURIComponent(a.id) + "/icon";
    }

    b.addEventListener("click", function () {
      launchApp(a);
    });
    return b;
  }

  function renderApps() {
    var box = $("appGroups");
    var empty = $("appEmpty");
    var list = filteredApps();
    box.innerHTML = "";
    if (!list.length) {
      empty.hidden = false;
      var hint = $("appEmptyHint");
      if (appsError) hint.textContent = appsError;
      else if (!appsLoaded) hint.textContent = "正在扫描可启动项目…";
      else hint.textContent = appList.length ? "没有匹配“" + appQuery + "”的项目" : "服务端未扫描到任何可启动项目";
      return;
    }
    empty.hidden = true;
    var games = list.filter(function (a) {
      return a.type === "game";
    });
    var softs = list.filter(function (a) {
      return a.type !== "game";
    });
    [
      { title: "游戏", en: "GAMES", data: games },
      { title: "软件", en: "SOFTWARE", data: softs }
    ].forEach(function (g) {
      if (!g.data.length) return;
      var wrap = document.createElement("div");
      wrap.className = "app-group";
      wrap.innerHTML =
        "<div class='ag-head'><b>" + g.title + "</b><span>" + g.en + "</span><em>" + g.data.length + " 项</em></div>";
      var grid = document.createElement("div");
      grid.className = "apps";
      g.data.forEach(function (a) {
        grid.appendChild(buildAppTile(a));
      });
      wrap.appendChild(grid);
      box.appendChild(wrap);
    });
  }

  function loadApps(refresh) {
    renderApps();
    return fetch("/api/apps" + (refresh ? "?refresh=1" : ""), { cache: "no-store" })
      .then(function (r) {
        return r.json().then(function (j) {
          if (!r.ok || !j.ok) throw new Error(j.message || "HTTP " + r.status);
          return j.apps || [];
        });
      })
      .then(function (list) {
        appList = list;
        appsLoaded = true;
        appsError = "";
        renderApps();
      })
      .catch(function (err) {
        appList = [];
        appsLoaded = false;
        appsError = "读取可启动项目失败：" + (err && err.message ? err.message : "服务端未连接");
        renderApps();
      });
  }

  function launchApp(a) {
    if (launching[a.id]) return;
    if (!getToken()) {
      toast("请先在系统页设置中填入访问令牌", true);
      goTo(3);
      return;
    }
    launching[a.id] = true;
    renderApps();
    apiPost("/api/launch", { id: a.id }).then(function (j) {
      if (j.ok) {
        toast("已启动：<b>" + escapeHtml(a.name) + "</b>");
      } else {
        toast("启动失败：" + escapeHtml(j.message || "未知原因"), true);
      }
    }).catch(function (err) {
      toast("启动失败：" + escapeHtml(err.message || "服务端无响应"), true);
    }).then(function () {
      setTimeout(function () {
        delete launching[a.id];
        renderApps();
      }, 1200);
    });
  }

  $("appSearch").addEventListener("input", function (e) {
    appQuery = e.target.value || "";
    renderApps();
  });

  /* -------------------------------------------------------------- 系统页 */
  var connectedAt = Date.now();
  var serverStatus = null;
  var latencyMs = null;

  function fmtDuration(ms) {
    var s = Math.floor(ms / 1000);
    var h = Math.floor(s / 3600);
    var m = Math.floor((s % 3600) / 60);
    var sec = s % 60;
    return (h > 0 ? h + " 时 " : "") + m + " 分 " + pad(sec) + " 秒";
  }

  function renderSystemStatus() {
    var src = serverStatus;
    setText($("sysHost"), src ? src.name : "—");
    setText($("sysIp"), src ? src.ip + ":" + (src.port || 5000) : "—");
    setText($("sysVer"), src ? "v" + src.version : "—");
    setText($("sysUptime"), connectedAt ? fmtDuration(Date.now() - connectedAt) : "—");
    setText($("sysLatency"), latencyMs == null ? "—" : latencyMs + " ms");
    var st = $("connState");
    if (conn.online) {
      st.textContent = conn.pollFallback ? "轮询模式" : "已连接";
      st.classList.remove("off");
    } else {
      st.textContent = "未连接";
      st.classList.add("off");
    }
  }

  function fetchStatus() {
    var t0 = performance.now();
    return fetch("/api/status", { cache: "no-store" })
      .then(function (r) {
        if (!r.ok) throw new Error("HTTP " + r.status);
        return r.json();
      })
      .then(function (j) {
        latencyMs = Math.round(performance.now() - t0);
        if (j && j.ok) {
          serverStatus = j;
          if (!connectedAt) connectedAt = Date.now();
        }
      })
      .catch(function () {
        latencyMs = null;
      });
  }

  /* --------------------------------------------------- 令牌与受控接口调用 */
  /* token 由服务端首次运行生成并写入 config.json，前端只保存在本机 localStorage，
     既不写死在代码里，也不通过 /api/config 下发。 */
  var TOKEN_KEY = "nerv.token";

  function getToken() {
    try {
      return localStorage.getItem(TOKEN_KEY) || "";
    } catch (err) {
      return "";
    }
  }
  function setToken(v) {
    try {
      if (v) localStorage.setItem(TOKEN_KEY, v);
      else localStorage.removeItem(TOKEN_KEY);
    } catch (err) {
      /* 隐私模式下不可写，忽略 */
    }
  }

  /** POST 受控接口，自动带 token，并把服务端错误原因转成可读消息 */
  function apiPost(url, payload) {
    var headers = { "Content-Type": "application/json" };
    var tk = getToken();
    if (tk) headers["X-NERV-Token"] = tk;
    return fetch(url, {
      method: "POST",
      headers: headers,
      body: JSON.stringify(payload || {})
    }).then(function (r) {
      return r.json().catch(function () {
        return { ok: false, message: "服务端返回了无法解析的内容" };
      }).then(function (j) {
        if (!j || typeof j !== "object") j = { ok: false, message: "服务端返回为空" };
        if (!r.ok && j.message == null) j.message = "HTTP " + r.status;
        return j;
      });
    });
  }

  /* 电源与系统操作：先二次确认，再调服务端白名单接口 */
  var POWER_TEXT = {
    lock: { title: "锁定电脑？", body: "电脑将立即锁屏，回到桌面需要重新输入密码。", label: "锁屏" },
    logout: { title: "注销当前用户？", body: "当前用户会被注销，所有未保存的工作可能丢失。", label: "注销" },
    sleep: { title: "让电脑睡眠？", body: "电脑进入睡眠后监控数据暂停刷新，唤醒后自动恢复。", label: "睡眠" },
    restart: { title: "重启电脑？", body: "未保存的工作会丢失。重启期间面板会断开，电脑起来后自动重连。", label: "重启" },
    shutdown: { title: "关闭电脑？", body: "未保存的工作会丢失。关机后平板面板将无法再唤醒电脑。", label: "关机" }
  };

  function requireTokenThen(run) {
    if (!getToken()) {
      toast("请先在下方设置中填入访问令牌", true);
      var f = $("setToken");
      if (f) f.focus();
      return;
    }
    run();
  }

  Array.prototype.forEach.call(document.querySelectorAll(".pwr"), function (btn) {
    btn.addEventListener("click", function () {
      var key = btn.getAttribute("data-power");
      var t = POWER_TEXT[key];
      if (!t) return;
      confirmBox(t.title, t.body, "确认" + t.label).then(function (ok) {
        if (!ok) return;
        requireTokenThen(function () {
          apiPost("/api/power", { action: key }).then(function (j) {
            if (j.ok) toast("已执行：" + (j.label || t.label));
            else toast("执行失败：" + escapeHtml(j.message || "未知原因"), true);
          }).catch(function (err) {
            toast("执行失败：" + escapeHtml(err.message || "服务端无响应"), true);
          });
        });
      });
    });
  });

  var OP_TEXT = {
    "display-off": { name: "熄灭显示器", body: "电脑显示器将进入省电状态，移动鼠标或按键盘即可恢复。" },
    taskmgr: { name: "打开任务管理器", body: "将在电脑上打开任务管理器窗口。" }
  };

  Array.prototype.forEach.call(document.querySelectorAll(".op"), function (btn) {
    btn.addEventListener("click", function () {
      var key = btn.getAttribute("data-op");
      var t = OP_TEXT[key];
      if (!t) return;
      confirmBox("确认" + t.name + "？", t.body, "确认").then(function (ok) {
        if (!ok) return;
        requireTokenThen(function () {
          apiPost("/api/system", { action: key }).then(function (j) {
            if (j.ok) toast("已执行：" + (j.label || t.name));
            else toast("执行失败：" + escapeHtml(j.message || "未知原因"), true);
          }).catch(function (err) {
            toast("执行失败：" + escapeHtml(err.message || "服务端无响应"), true);
          });
        });
      });
    });
  });

  /* ------------------------------------------------------------ 设置区 */
  function fillSettings() {
    var c = serverConfig || {};
    if ($("setToken")) $("setToken").value = getToken();
    if ($("setRefresh")) $("setRefresh").value = c.refreshIntervalSec == null ? 1 : c.refreshIntervalSec;
    if ($("setCity")) $("setCity").value = c.weatherCity || "";
    if ($("setHero")) $("setHero").value = c.heroImagePath || "";
    if ($("setWakeUrl")) $("setWakeUrl").value = c.tabletWakeUrl || "";
    if ($("setWakeOn")) $("setWakeOn").checked = !!c.tabletWakeEnabled;
    /* 唤醒密码属于敏感字段，服务端不下发；留空表示不修改 */
    if ($("setWakePwd")) $("setWakePwd").value = "";
  }

  function setSpMsg(text, isErr) {
    var el = $("spMsg");
    if (!el) return;
    el.textContent = text || "";
    el.classList.toggle("err", !!isErr);
  }

  if ($("saveSettings")) {
    $("saveSettings").addEventListener("click", function () {
      var tokenInput = $("setToken").value.trim();
      if (!tokenInput) {
        setSpMsg("请先填入 config.json 中的 token", true);
        return;
      }
      setToken(tokenInput);

      var patch = {
        weatherCity: $("setCity").value.trim(),
        heroImagePath: $("setHero").value.trim(),
        refreshIntervalSec: Number($("setRefresh").value),
        tabletWakeEnabled: $("setWakeOn").checked,
        tabletWakeUrl: $("setWakeUrl").value.trim()
      };
      var pwd = $("setWakePwd").value;
      if (pwd) patch.tabletWakePassword = pwd;

      setSpMsg("保存中…", false);
      apiPost("/api/settings", patch).then(function (j) {
        if (!j.ok) {
          setSpMsg("保存失败：" + (j.message || "未知原因"), true);
          return;
        }
        serverConfig = j.config;
        if (j.config && j.config.refreshIntervalSec) {
          REFRESH_SEC = j.config.refreshIntervalSec;
          /* 轮询中：按新间隔重建定时器，立即生效 */
          if (conn.pollTimer) {
            clearInterval(conn.pollTimer);
            conn.pollTimer = 0;
            startPolling();
          }
        }
        if (j.config && j.config.heroImagePath !== undefined) applyHero(j.config.heroImagePath ? "/" + j.config.heroImagePath : "");
        if (j.changed && j.changed.indexOf("weatherCity") >= 0) loadWeather();
        fillSettings();
        if (j.needsRestart) {
          setSpMsg("已保存，" + (j.changed || []).join("、") + " 需重启服务端后生效", false);
        } else if (!j.changed || !j.changed.length) {
          setSpMsg("没有需要改动的内容", false);
        } else {
          setSpMsg("已保存并生效：" + j.changed.join("、"), false);
        }
      }).catch(function (err) {
        setSpMsg("保存失败：" + (err && err.message ? err.message : "服务端无响应"), true);
      });
    });
  }


  /* -------------------------------------------------------- 可见性调度 */
  var monitorVisible = false;
  var clockTimerVisible = false;
  var systemTimer = 0;
  var statusPollTimer = 0;

  function startSystemTimer() {
    if (systemTimer) return;
    renderSystemStatus();
    fetchStatus().then(renderSystemStatus);
    systemTimer = setInterval(function () {
      renderSystemStatus();
    }, 1000);
    /* 延迟每 5 秒重新量一次，不必和「已连接时长」一样每秒发请求 */
    if (!statusPollTimer) {
      statusPollTimer = setInterval(function () {
        fetchStatus().then(renderSystemStatus);
      }, 5000);
    }
  }
  function stopSystemTimer() {
    if (systemTimer) clearInterval(systemTimer);
    systemTimer = 0;
    if (statusPollTimer) clearInterval(statusPollTimer);
    statusPollTimer = 0;
  }

  /* 参数是页面下标：now = 当前页，prev = 上一页 */
  onPageVisible(function (now, prev) {
    if (prev !== now) {
      if (prev === 1) {
        if (clockTimerVisible) {
          stopClock();
          clockTimerVisible = false;
        }
        stopWeather();
      }
      if (prev === 2) monitorVisible = false;
      if (prev === 3) stopSystemTimer();
    }
    if (now === 1 && !hiddenPaused) {
      startClock();
      clockTimerVisible = true;
      startWeather();
    }
    if (now === 2 && !hiddenPaused) {
      monitorVisible = true;
      drawAllSparks();
    }
    if (now === 3 && !hiddenPaused) startSystemTimer();
  });

  function startVisibleTimers() {
    if (current === 1) {
      startClock();
      clockTimerVisible = true;
      startWeather();
    }
    if (current === 2) {
      monitorVisible = true;
      drawAllSparks();
    }
    if (current === 3) startSystemTimer();
  }

  /* -------------------------------------------------------- 横竖屏过渡 */
  var reduceMotion = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  var orientTimer = null;
  var lastPortrait = window.innerHeight >= window.innerWidth;
  function playOrientTransition() {
    if (reduceMotion) return;
    document.body.classList.remove("orienting");
    void document.body.offsetWidth;
    document.body.classList.add("orienting");
    clearTimeout(orientTimer);
    orientTimer = setTimeout(function () {
      document.body.classList.remove("orienting");
    }, 640);
  }
  var resizeDebounce = null;
  window.addEventListener(
    "resize",
    function () {
      clearTimeout(resizeDebounce);
      resizeDebounce = setTimeout(function () {
        var p = window.innerHeight >= window.innerWidth;
        if (p !== lastPortrait) {
          lastPortrait = p;
          playOrientTransition();
        }
        if (current === 2 && monitorVisible) drawAllSparks();
      }, 80);
    },
    { passive: true }
  );
  window.addEventListener(
    "orientationchange",
    function () {
      setTimeout(function () {
        lastPortrait = window.innerHeight >= window.innerWidth;
        playOrientTransition();
      }, 60);
    },
    { passive: true }
  );

  /* ------------------------------------------------------------- 初始化 */
  function fetchConfig() {
    return fetch("/api/config", { cache: "no-store" })
      .then(function (r) {
        if (!r.ok) throw new Error("HTTP " + r.status);
        return r.json();
      })
      .then(function (j) {
        if (j && j.ok && j.config) {
          serverConfig = j.config;
          if (serverConfig.refreshIntervalSec) REFRESH_SEC = serverConfig.refreshIntervalSec;
          applyHero(serverConfig.heroImagePath ? "/" + serverConfig.heroImagePath : "");
          return serverConfig;
        }
        throw new Error("BAD_CONFIG");
      })
      .catch(function () {
        applyHero("/assets/hero.jpg");
      });
  }

  /* 同步率：主题装饰数值，不对应任何真实硬件数据（需求 5.2 允许的唯一装饰项） */
  var syncRate = 41.3;
  var syncTimer = setInterval(function () {
    if (current !== 1 || document.hidden) return;
    syncRate = clamp(syncRate + (Math.random() - 0.5) * 0.24, 39.8, 43.6);
    setText($("syncRate"), syncRate.toFixed(2) + "%");
  }, 1800);

  /* -------------------------------------------------- 页面隐藏时全部暂停 */
  /* 需求 6.4：不可见页面的动画/绘图/定时器一律暂停，贴合 120Hz 且省电。
     这里处理的是「整个平板切走/息屏」，与「切换到别的页」是两层。 */
  var hiddenPaused = false;
  function pauseForHidden() {
    if (hiddenPaused) return;
    hiddenPaused = true;
    stopClock();
    stopWeather();
    stopSystemTimer();
    monitorVisible = false;
  }
  function resumeFromHidden() {
    if (!hiddenPaused) return;
    hiddenPaused = false;
    startVisibleTimers();
  }
  document.addEventListener("visibilitychange", function () {
    if (document.hidden) pauseForHidden();
    else resumeFromHidden();
  });

  function boot0() {
    wxEmpty();
    renderCalendar(new Date());
    renderApps();
    loadApps();
    setText($("syncRate"), syncRate.toFixed(2) + "%");
    goTo(1, { instant: true, force: true });
    requestAnimationFrame(function () {
      moveGlider(true);
    });
    fetchConfig().then(function () {
      fillSettings();
      connectWs();
    });
    renderSystemStatus();
  }

  boot0();
})();
