/* ==========================================================================
 * NERV PANEL · 前端脚本
 * 阶段 1：界面静态版（演示数据 + 演示模式标识）
 * ========================================================================== */
(function () {
  "use strict";

  /* 阶段 1 演示模式：接入真实数据后置为 false 并删除演示数据源 */
  var DEMO = true;

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
    visibleHooks.forEach(function (fn, i) {
      fn(i === current, i === prev);
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
    var barTimer = setInterval(function () {
      progress = Math.min(100, progress + 6.5);
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

  var clockRAF = 0;
  function clockLoop() {
    clockRAF = requestAnimationFrame(function () {
      tickClock(new Date());
      clockLoop();
    });
  }
  function startClock() {
    if (clockOn) return;
    clockOn = true;
    clockLastSec = -1;
    tickClock(new Date());
    clockLoop();
  }
  function stopClock() {
    clockOn = false;
    if (clockRAF) cancelAnimationFrame(clockRAF);
    clockRAF = 0;
  }

  /* --------------------------------------------------------------- 天气 */
  /* 阶段 1 演示数据；阶段 3 改为服务端 /api/weather */
  var DEMO_WEATHER = {
    city: "合肥",
    desc: "晴",
    temp: 11,
    feels: 9,
    humidity: 46,
    windDir: "东北风",
    windLevel: 3,
    air: "良",
    days: [
      { label: "今天", max: 11, min: 2 },
      { label: "周三", max: 13, min: 4 },
      { label: "周四", max: 10, min: 1 },
      { label: "周五", max: 12, min: 3 }
    ]
  };

  function renderWeather(w) {
    if (!w) {
      setText($("wxTemp"), "--");
      setText($("wxDesc"), "—");
      setText($("wxMeta"), "—");
      $("wxDays").innerHTML = "";
      return;
    }
    setText($("wxTemp"), String(w.temp));
    setText($("wxDesc"), w.desc + " · " + w.city);
    $("wxMeta").innerHTML =
      "体感 " + w.feels + "°C · 湿度 " + w.humidity + "%<br/>" + w.windDir + " " + w.windLevel + " 级 · 空气" + w.air;
    var html = "";
    (w.days || []).forEach(function (d) {
      html +=
        "<div><div class='d'>" +
        d.label +
        "</div><div class='t'><b>" +
        d.max +
        "°</b> <span>" +
        d.min +
        "°</span></div></div>";
    });
    $("wxDays").innerHTML = html;
  }

  /* ------------------------------------------------------------- 主视觉 */
  /* 阶段 1：读取服务端配置中的 heroImagePath；拿不到就用占位图 */
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
    img.src = path.indexOf("assets/") === 0 ? path : path;
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
  /* 阶段 1 演示数据；阶段 2 改为真实硬件数据 */
  function fmtGB(bytes) {
    return (bytes / 1024 / 1024 / 1024).toFixed(1);
  }

  function demoMetrics() {
    var cpuUse = clamp(28 + Math.sin(Date.now() / 4000) * 12 + Math.random() * 8, 3, 98);
    var gpuUse = clamp(38 + Math.cos(Date.now() / 5200) * 16 + Math.random() * 8, 2, 99);
    var ramUse = clamp(52 + Math.sin(Date.now() / 9000) * 5 + Math.random() * 2, 10, 95);
    var ramTotal = 32 * 1024 * 1024 * 1024;
    return {
      cpu: { usage: Math.round(cpuUse), temp: Math.round(48 + cpuUse * 0.28), freq: 4.2, name: "i5-12600KF" },
      gpu: {
        usage: Math.round(gpuUse),
        temp: Math.round(44 + gpuUse * 0.3),
        vramUsed: Math.round(gpuUse * 0.06 * 1024 * 1024 * 1024),
        vramTotal: 6 * 1024 * 1024 * 1024,
        freq: 1305,
        power: Math.round(30 + gpuUse * 0.9),
        name: "GeForce GTX 1660 SUPER"
      },
      ram: { usage: Math.round(ramUse), used: (ramUse / 100) * ramTotal, total: ramTotal },
      disks: [
        { name: "C:", usage: 63, used: 300 * 1024 * 1024 * 1024, total: 480 * 1024 * 1024 * 1024 },
        { name: "D:", usage: 41, used: 820 * 1024 * 1024 * 1024, total: 2000 * 1024 * 1024 * 1024 }
      ],
      net: { up: Math.random() * 1.2, down: 3 + Math.random() * 9 },
      ts: Date.now()
    };
  }

  var diskItems = {};

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
        (d.name || "磁盘 " + (i + 1)) +
        "</span><span class='di-pct'>" +
        (d.usage == null ? "—" : Math.round(d.usage) + "%") +
        "</span></div>" +
        "<div class='di-sub'>" +
        (d.used == null ? "—" : fmtGB(d.used) + " GB") +
        " / " +
        (d.total == null ? "—" : fmtGB(d.total) + " GB") +
        "</div>" +
        "<div class='bar cool'><i style='width:" +
        (d.usage == null ? 0 : clamp(d.usage, 0, 100)) +
        "%'></i></div>" +
        "</div>";
    });
    box.innerHTML = html;
  }

  function renderMetrics(m) {
    if (!m) return;
    /* CPU */
    setText($("cpuName"), m.cpu && m.cpu.name ? m.cpu.name : "—");
    setText($("cpuUse"), m.cpu && m.cpu.usage != null ? String(Math.round(m.cpu.usage)) : "--");
    setText($("cpuTemp"), m.cpu && m.cpu.temp != null ? Math.round(m.cpu.temp) + "°C" : "—");
    var cpuSub = [];
    if (m.cpu && m.cpu.freq != null) cpuSub.push("频率 " + m.cpu.freq.toFixed(2) + " GHz");
    setText($("cpuSub"), cpuSub.length ? cpuSub.join(" · ") : "—");
    if ($("cpuBar")) $("cpuBar").style.width = (m.cpu && m.cpu.usage != null ? clamp(m.cpu.usage, 0, 100) : 0) + "%";
    $("stCpu").classList.toggle("hot", !!(m.cpu && m.cpu.temp != null && m.cpu.temp >= 80));

    /* GPU */
    setText($("gpuName"), m.gpu && m.gpu.name ? m.gpu.name : "—");
    setText($("gpuUse"), m.gpu && m.gpu.usage != null ? String(Math.round(m.gpu.usage)) : "--");
    setText($("gpuTemp"), m.gpu && m.gpu.temp != null ? Math.round(m.gpu.temp) + "°C" : "—");
    var gpuSub = [];
    if (m.gpu && m.gpu.vramTotal) {
      gpuSub.push("显存 " + (m.gpu.vramUsed != null ? fmtGB(m.gpu.vramUsed) : "—") + " / " + fmtGB(m.gpu.vramTotal) + " GB");
    }
    if (m.gpu && m.gpu.freq != null) gpuSub.push("频率 " + Math.round(m.gpu.freq) + " MHz");
    if (m.gpu && m.gpu.power != null) gpuSub.push("功耗 " + Math.round(m.gpu.power) + " W");
    setText($("gpuSub"), gpuSub.length ? gpuSub.join(" · ") : "—");
    if ($("gpuBar")) $("gpuBar").style.width = (m.gpu && m.gpu.usage != null ? clamp(m.gpu.usage, 0, 100) : 0) + "%";
    $("stGpu").classList.toggle("hot", !!(m.gpu && m.gpu.temp != null && m.gpu.temp >= 82));

    /* 内存 */
    setText($("ramUse"), m.ram && m.ram.usage != null ? String(Math.round(m.ram.usage)) : "--");
    setText($("ramTotal"), m.ram && m.ram.total ? fmtGB(m.ram.total) + " GB" : "—");
    setText(
      $("ramSub"),
      m.ram && m.ram.total ? "已用 " + fmtGB(m.ram.used) + " GB / " + fmtGB(m.ram.total) + " GB" : "—"
    );
    if ($("ramBar")) $("ramBar").style.width = (m.ram && m.ram.usage != null ? clamp(m.ram.usage, 0, 100) : 0) + "%";

    /* 网络 */
    var down = m.net && m.net.down != null ? m.net.down : null;
    var up = m.net && m.net.up != null ? m.net.up : null;
    setText($("netDown"), down == null ? "--" : down.toFixed(1));
    setText($("netSub"), "上传 " + (up == null ? "—" : up.toFixed(1)) + " MB/s");
    setText($("netDownAlt"), down == null ? "—" : down.toFixed(2) + " MB/s");
    setText($("netUpAlt"), up == null ? "—" : up.toFixed(2) + " MB/s");

    /* 磁盘 */
    renderDisks(m.disks);

    /* 总览速览 */
    setText($("miniCpu"), m.cpu && m.cpu.usage != null ? String(Math.round(m.cpu.usage)) : "--");
    setText($("miniCpuSub"), m.cpu && m.cpu.temp != null ? Math.round(m.cpu.temp) + "°C · " + (m.cpu.name || "—") : "—");
    setText($("miniGpu"), m.gpu && m.gpu.usage != null ? String(Math.round(m.gpu.usage)) : "--");
    setText(
      $("miniGpuSub"),
      m.gpu && m.gpu.temp != null ? Math.round(m.gpu.temp) + "°C · 显存 " + fmtGB(m.gpu.vramUsed || 0) + " GB" : "—"
    );
    setText($("miniRam"), m.ram && m.ram.usage != null ? String(Math.round(m.ram.usage)) : "--");
    setText($("miniRamSub"), m.ram && m.ram.total ? fmtGB(m.ram.used) + " / " + fmtGB(m.ram.total) + " GB" : "—");
    setText($("miniNet"), down == null ? "--" : down.toFixed(1));
    setText($("miniNetSub"), up == null ? "—" : "↑ " + up.toFixed(1) + " MB/s");

    /* 走势线只在本页可见时绘制 */
    pushHist("cpu", m.cpu && m.cpu.usage != null ? m.cpu.usage : 0);
    pushHist("gpu", m.gpu && m.gpu.usage != null ? m.gpu.usage : 0);
    pushHist("ram", m.ram && m.ram.usage != null ? m.ram.usage : 0);
    if (current === 2) drawAllSparks();
  }

  /* -------------------------------------------------------------- 启动页 */
  /* 阶段 1 演示应用列表；阶段 4 改为服务端 /api/apps */
  var DEMO_APPS = [
    { id: "demo-steam", name: "Steam", type: "software" },
    { id: "demo-apex", name: "Apex Legends", type: "game" },
    { id: "demo-cod", name: "Call of Duty", type: "game" },
    { id: "demo-hzd", name: "地平线 零之曙光", type: "game" },
    { id: "demo-ff7", name: "FF7 重制版", type: "game" },
    { id: "demo-chrome", name: "Google Chrome", type: "software" },
    { id: "demo-vscode", name: "Visual Studio Code", type: "software" }
  ];
  var PLACEHOLDER_ICON =
    "<svg viewBox='0 0 24 24' fill='none' stroke='currentColor' stroke-width='1.6' stroke-linecap='round' stroke-linejoin='round'>" +
    "<rect x='3.5' y='3.5' width='17' height='17' rx='2.5'/><path d='M8 9h8M8 12.5h8M8 16h5'/></svg>";

  var appList = [];
  var appQuery = "";
  var launching = {};

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
    var ic = a.icon ? "<img src='" + a.icon + "' alt='' />" : PLACEHOLDER_ICON;
    b.innerHTML =
      "<span class='ic'>" +
      ic +
      "</span><b>" +
      escapeHtml(a.name) +
      "</b><span>" +
      (a.type === "game" ? "GAME · 启动中" : "APP") +
      "</span>";
    if (launching[a.id]) b.querySelector("span:last-child").textContent = "启动中…";
    b.addEventListener("click", function () {
      launchApp(a);
    });
    return b;
  }

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }

  function renderApps() {
    var box = $("appGroups");
    var empty = $("appEmpty");
    var list = filteredApps();
    box.innerHTML = "";
    if (!list.length) {
      empty.hidden = false;
      var hint = $("appEmptyHint");
      hint.textContent = appList.length ? "没有匹配“" + appQuery + "”的项目" : "服务端未扫描到任何可启动项目";
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
      wrap.innerHTML = "<div class='ag-head'><b>" + g.title + "</b><span>" + g.en + "</span><em>" + g.data.length + " 项</em></div>";
      var grid = document.createElement("div");
      grid.className = "apps";
      g.data.forEach(function (a) {
        grid.appendChild(buildAppTile(a));
      });
      wrap.appendChild(grid);
      box.appendChild(wrap);
    });
  }

  function launchApp(a) {
    /* 阶段 1：仅演示反馈；阶段 4 改成 POST /api/launch */
    launching[a.id] = true;
    renderApps();
    toast("启动指令已发出（演示）：<b>" + escapeHtml(a.name) + "</b>");
    setTimeout(function () {
      delete launching[a.id];
      renderApps();
    }, 1400);
  }

  $("appSearch").addEventListener("input", function (e) {
    appQuery = e.target.value || "";
    renderApps();
  });

  /* -------------------------------------------------------------- 系统页 */
  /* 阶段 1 演示连接信息；阶段 5 改为真实状态与操作 */
  var DEMO_STATUS = { name: "DESKTOP-9STHOGB", ip: "192.168.10.11", version: "1.0.0" };
  var connectedAt = Date.now();

  function fmtDuration(ms) {
    var s = Math.floor(ms / 1000);
    var h = Math.floor(s / 3600);
    var m = Math.floor((s % 3600) / 60);
    var sec = s % 60;
    return (h > 0 ? h + " 时 " : "") + m + " 分 " + pad(sec) + " 秒";
  }

  function renderSystemStatus() {
    setText($("sysHost"), DEMO_STATUS.name);
    setText($("sysIp"), DEMO_STATUS.ip + ":5000");
    setText($("sysVer"), "v" + DEMO_STATUS.version);
    setText($("sysUptime"), fmtDuration(Date.now() - connectedAt));
    setText($("sysLatency"), "—");
    var st = $("connState");
    st.textContent = DEMO ? "演示模式" : "已连接";
    st.classList.toggle("off", !!DEMO);
  }

  /* 电源与系统操作：阶段 1 只弹二次确认，不执行 */
  var POWER_TEXT = {
    lock: { title: "锁定电脑？", body: "电脑将立即锁屏，回到桌面需要重新输入密码。", label: "锁屏" },
    logout: { title: "注销当前用户？", body: "当前用户会被注销，所有未保存的工作可能丢失。", label: "注销" },
    sleep: { title: "让电脑睡眠？", body: "电脑进入睡眠后监控数据暂停刷新，唤醒后自动恢复。", label: "睡眠" },
    restart: { title: "重启电脑？", body: "未保存的工作会丢失。重启期间面板会断开，电脑起来后自动重连。", label: "重启" },
    shutdown: { title: "关闭电脑？", body: "未保存的工作会丢失。关机后平板面板将无法再唤醒电脑。", label: "关机" }
  };

  Array.prototype.forEach.call(document.querySelectorAll(".pwr"), function (btn) {
    btn.addEventListener("click", function () {
      var key = btn.getAttribute("data-power");
      var t = POWER_TEXT[key];
      if (!t) return;
      confirmBox(t.title, t.body, "确认" + t.label).then(function (ok) {
        if (!ok) return;
        /* 阶段 1：不执行，仅提示 */
        toast("（演示）已请求：<b>" + t.label + "</b>，接入服务端后执行", true);
      });
    });
  });

  Array.prototype.forEach.call(document.querySelectorAll(".op"), function (btn) {
    btn.addEventListener("click", function () {
      var key = btn.getAttribute("data-op");
      var name = key === "display-off" ? "熄灭显示器" : "打开任务管理器";
      confirmBox("确认" + name + "？", "电脑端将执行：" + name + "。", "确认").then(function (ok) {
        if (!ok) return;
        toast("（演示）已请求：<b>" + name + "</b>，接入服务端后执行", true);
      });
    });
  });

  /* -------------------------------------------------------- 可见性调度 */
  var monitorTimer = 0;
  var clockTimerVisible = false;
  var systemTimer = 0;

  function startMonitorTimer() {
    if (monitorTimer) return;
    renderMetrics(demoMetrics());
    monitorTimer = setInterval(function () {
      renderMetrics(demoMetrics());
    }, 1000);
  }
  function stopMonitorTimer() {
    if (monitorTimer) clearInterval(monitorTimer);
    monitorTimer = 0;
  }
  function startSystemTimer() {
    if (systemTimer) return;
    renderSystemStatus();
    systemTimer = setInterval(renderSystemStatus, 1000);
  }
  function stopSystemTimer() {
    if (systemTimer) clearInterval(systemTimer);
    systemTimer = 0;
  }

  onPageVisible(function (visible, wasVisible) {
    if (visible) {
      if (current === 1) {
        startClock();
        clockTimerVisible = true;
      }
      if (current === 2) startMonitorTimer();
      if (current === 3) startSystemTimer();
    }
    /* 离开的页面暂停一切定时器与绘制 */
    if (wasVisible) {
      if (current !== 1 && clockTimerVisible) {
        stopClock();
        clockTimerVisible = false;
      }
      if (current !== 2) stopMonitorTimer();
      if (current !== 3) stopSystemTimer();
    }
  });

  function startVisibleTimers() {
    if (current === 1) {
      startClock();
      clockTimerVisible = true;
    }
    if (current === 2) startMonitorTimer();
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
        if (current === 2) drawAllSparks();
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
  function initHeader() {
    var pill = document.querySelector(".pill");
    var text = $("connText");
    if (DEMO) {
      text.textContent = "演示模式";
      pill.classList.add("offline");
    }
  }

  function fetchConfig() {
    return fetch("/api/config", { cache: "no-store" })
      .then(function (r) {
        if (!r.ok) throw new Error("HTTP " + r.status);
        return r.json();
      })
      .then(function (cfg) {
        applyHero(cfg.heroImagePath ? "/" + cfg.heroImagePath : "");
        if (cfg.refreshIntervalSec) window.__refreshSec = cfg.refreshIntervalSec;
      })
      .catch(function () {
        applyHero("/assets/hero.jpg");
      });
  }

  /* 同步率：主题装饰数值，不对应任何真实硬件数据 */
  var syncRate = 41.3;
  setInterval(function () {
    if (current !== 1) return;
    syncRate = clamp(syncRate + (Math.random() - 0.5) * 0.24, 39.8, 43.6);
    setText($("syncRate"), syncRate.toFixed(2) + "%");
  }, 1800);

  function setStatusLine() {
    var el = $("statusLine");
    if (DEMO) {
      el.innerHTML = "EVA-02 · 待机中 · <b>A.T. FIELD ALL GREEN</b>";
      el.classList.remove("off");
    }
  }

  function boot0() {
    initHeader();
    renderWeather(DEMO_WEATHER);
    renderCalendar(new Date());
    appList = DEMO_APPS.slice();
    renderApps();
    setStatusLine();
    setText($("syncRate"), syncRate.toFixed(2) + "%");
    goTo(1, { instant: true, force: true });
    requestAnimationFrame(function () {
      moveGlider(true);
    });
    fetchConfig();
    renderSystemStatus();
  }

  boot0();
})();
