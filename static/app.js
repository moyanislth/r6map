// 语言切换 + 楼层 tab + 行内滚轮缩放 + 标注(纯原生,零依赖)
(function () {
  "use strict";

  // ---- 语言 ----
  var html = document.documentElement;
  var btn = document.getElementById("langBtn");
  function setLang(lang, save) {
    html.lang = lang;
    if (btn) btn.textContent = lang === "zh" ? "EN" : "中";
    if (save) { try { localStorage.setItem("r6lang", lang); } catch (e) {} }
    renderPins(); // 标签随语言刷新
  }
  try {
    var saved = localStorage.getItem("r6lang");
    if (saved === "en" || saved === "zh") html.lang = saved;
  } catch (e) {}
  setLang(html.lang, false);
  if (btn) btn.addEventListener("click", function () {
    setLang(html.lang === "zh" ? "en" : "zh", true);
  });

  // ---- UI 文案(来自 floors.json ui 节,经模板注入) ----
  var UI = {};
  try { UI = JSON.parse(document.getElementById("uiTerms").textContent); } catch (e) {}
  function uiText(key) {
    var t = UI[key] || {};
    return html.lang === "en" ? t.en : t.zh;
  }

  // ---- 楼层 tab ----
  var tabs = document.getElementById("floortabs");
  if (tabs) {
    var panes = document.querySelectorAll(".floorpane");
    tabs.addEventListener("click", function (e) {
      var b = e.target.closest("button");
      if (!b) return;
      tabs.querySelectorAll("button").forEach(function (x) { x.classList.remove("active"); });
      b.classList.add("active");
      var key = b.dataset.floor;
      panes.forEach(function (p) { p.classList.toggle("active", p.dataset.floor === key); });
      layoutPinLayers();
      refreshExport();
    });
  }

  // ---- 存储(localStorage 不可用时降级内存) ----
  var MAP_ID = (document.body.dataset.map || (location.pathname.match(/maps\/([a-z0-9-]+)\.html/) || [])[1]) || "unknown";
  var storeKey = "r6pins:" + MAP_ID;
  var memStore = {};
  function storeGet(k) { try { return localStorage.getItem(k); } catch (e) { return memStore[k] || null; } }
  function storeSet(k, v) { try { localStorage.setItem(k, v); } catch (e) { memStore[k] = v; } }
  var pinsData = null;
  function loadPins() {
    if (!pinsData) {
      try { pinsData = JSON.parse(storeGet(storeKey)) || {}; } catch (e) { pinsData = {}; }
    }
    return pinsData;
  }
  function savePins() { storeSet(storeKey, JSON.stringify(pinsData)); refreshExport(); }
  function floorPins(floor) {
    var d = loadPins();
    if (!d[floor]) d[floor] = [];
    return d[floor];
  }
  function pinLabel(pin) {
    return html.lang === "en" ? (pin.en || pin.zh || uiText("pin_default")) : (pin.zh || pin.en || uiText("pin_default"));
  }

  // ---- 行内缩放/平移 ----
  var MAX_SCALE = 12;
  function applyStage(wrap) {
    wrap._stage.style.transform = "translate(" + wrap._tx + "px," + wrap._ty + "px) scale(" + wrap._s + ")";
    wrap._stage.style.setProperty("--inv", 1 / wrap._s);
    wrap.querySelector(".zoom-reset").hidden = wrap._s <= 1.001;
    wrap.classList.toggle("zoomed", wrap._s > 1.001);
  }
  function resetStage(wrap) { wrap._s = 1; wrap._tx = 0; wrap._ty = 0; applyStage(wrap); }

  document.querySelectorAll(".imgwrap").forEach(function (wrap) {
    wrap._stage = wrap.querySelector(".imgstage");
    wrap._s = 1; wrap._tx = 0; wrap._ty = 0;

    wrap.addEventListener("wheel", function (e) {
      e.preventDefault();
      var rect = wrap.getBoundingClientRect();
      var mx = e.clientX - rect.left, my = e.clientY - rect.top;
      var factor = e.deltaY < 0 ? 1.15 : 1 / 1.15;
      var ns = Math.min(MAX_SCALE, Math.max(1, wrap._s * factor));
      if (ns === wrap._s) return;
      wrap._tx = mx - (mx - wrap._tx) * (ns / wrap._s);
      wrap._ty = my - (my - wrap._ty) * (ns / wrap._s);
      wrap._s = ns;
      if (wrap._s === 1) { wrap._tx = 0; wrap._ty = 0; }
      applyStage(wrap);
    }, { passive: false });

    wrap.querySelector(".zoom-reset").addEventListener("click", function () { resetStage(wrap); });

    // 拖拽平移(Pointer Events,触屏同样可拖)
    var panning = false, sx = 0, sy = 0, moved = false;
    // 阻断浏览器原生拖放/选择:否则原生 dragstart 会触发 pointercancel 抢走指针
    wrap.addEventListener("dragstart", function (e) { e.preventDefault(); });
    wrap.addEventListener("pointerdown", function (e) {
      if (e.target.closest(".pin") || e.target.closest(".pin-dialog")) return;
      // 仅鼠标需要阻止原生拖拽/选择;触屏 preventDefault 会抑制 click 合成(破坏单击/双击)
      if (e.pointerType === "mouse") e.preventDefault();
      panning = true; moved = false;
      sx = e.clientX - wrap._tx; sy = e.clientY - wrap._ty;
      try { wrap.setPointerCapture(e.pointerId); } catch (err) {}
    });
    wrap.addEventListener("pointermove", function (e) {
      if (!panning) return;
      var nx = e.clientX - sx, ny = e.clientY - sy;
      if (Math.abs(nx - wrap._tx) + Math.abs(ny - wrap._ty) > 3) moved = true;
      wrap._tx = nx; wrap._ty = ny;
      applyStage(wrap);
    });
    wrap.addEventListener("pointerup", function () { panning = false; });
    wrap.addEventListener("pointercancel", function () { panning = false; });
    wrap._movedRecently = function () { return moved; };
  });

  // ---- 坐标换算(以 imgframe 内图片实际显示矩形为基准,兼容留边) ----
  function imgRect(wrap) {
    var img = wrap.querySelector("img");
    return { left: img.offsetLeft, top: img.offsetTop, width: img.clientWidth, height: img.clientHeight };
  }
  function stagePoint(wrap, clientX, clientY) {
    var rect = wrap.getBoundingClientRect();
    var r = imgRect(wrap);
    return {
      x: ((clientX - rect.left - wrap._tx) / wrap._s - r.left) / r.width,
      y: ((clientY - rect.top - wrap._ty) / wrap._s - r.top) / r.height
    };
  }
  function clamp01(v) { return Math.min(1, Math.max(0, +v.toFixed(4))); }

  // 布局 pinlayer:覆盖图片实际显示区域(留边外不接收落点)
  function layoutPinLayers() {
    document.querySelectorAll(".floorpane.active .imgwrap").forEach(function (wrap) {
      var r = imgRect(wrap);
      var layer = wrap.querySelector(".pinlayer");
      layer.style.left = r.left + "px";
      layer.style.top = r.top + "px";
      layer.style.width = r.width + "px";
      layer.style.height = r.height + "px";
    });
  }
  window.addEventListener("resize", layoutPinLayers);

  // ---- 单击显坐标 / 双击添加标注 ----
  // 双击前会先触发 click:260ms 延时器区分,双击时取消
  var clickTimer = null;
  document.querySelectorAll(".imgwrap").forEach(function (wrap) {
    wrap.addEventListener("click", function (e) {
      if (e.target.closest(".pin") || e.target.closest(".pin-dialog") || e.target.closest("button")) return;
      if (wrap._movedRecently()) return;
      var ev = e;
      if (clickTimer) { clearTimeout(clickTimer); clickTimer = null; return; } // 双击的第二次 click
      clickTimer = setTimeout(function () {
        clickTimer = null;
        showCoord(ev.clientX, ev.clientY, wrap);
      }, 260);
    });
    wrap.addEventListener("dblclick", function (e) {
      if (clickTimer) { clearTimeout(clickTimer); clickTimer = null; }
      if (e.target.closest(".pin") || e.target.closest(".pin-dialog")) return;
      if (wrap._movedRecently()) return;
      var layer = wrap.querySelector(".pinlayer");
      var floor = layer.dataset.floor;
      var pt = stagePoint(wrap, e.clientX, e.clientY);
      addPin(floor, clamp01(pt.x), clamp01(pt.y), true);
    });
  });

  // 坐标读数(单击展示,1.5s 淡出)
  var readoutTimer = null;
  function showCoord(clientX, clientY, wrap) {
    var ro = wrap.querySelector(".coordreadout");
    var pt = stagePoint(wrap, clientX, clientY);
    var x = Math.min(1, Math.max(0, pt.x)), y = Math.min(1, Math.max(0, pt.y));
    ro.textContent = "x " + (x * 100).toFixed(1) + "% · y " + (y * 100).toFixed(1) + "%";
    ro.hidden = false;
    ro.style.opacity = "1";
    if (readoutTimer) clearTimeout(readoutTimer);
    readoutTimer = setTimeout(function () {
      ro.style.opacity = "0";
      setTimeout(function () { ro.hidden = true; }, 400);
    }, 1500);
  }

  // ---- 标注渲染(标签与点位同一节点;缩放反向补偿) ----
  function makePinEl(pin, floor) {
    var el = document.createElement("div");
    el.className = "pin";
    el._pin = pin;
    positionPin(el, pin);
    var dot = document.createElement("span");
    dot.className = "pin-dot";
    var label = document.createElement("span");
    label.className = "pin-label";
    el.appendChild(dot);
    el.appendChild(label);
    setPinText(el, pin);

    // 双击标注:改名
    el.addEventListener("dblclick", function (e) {
      e.stopPropagation();
      openPinDialog(el, pin, floor);
    });
    // 删除
    var del = document.createElement("button");
    del.type = "button"; del.className = "pin-del"; del.textContent = "×";
    del.title = uiText("pin_delete");
    del.addEventListener("click", function (e) {
      e.stopPropagation();
      var arr = floorPins(floor);
      var i = arr.indexOf(pin);
      if (i > -1) arr.splice(i, 1);
      savePins();
      el.remove();
    });
    el.appendChild(del);

    // 拖拽微调
    el.addEventListener("pointerdown", function (e) {
      if (e.target === del) return;
      e.stopPropagation(); e.preventDefault();
      var wrap = el.closest(".imgwrap");
      function move(ev) {
        var pt = stagePoint(wrap, ev.clientX, ev.clientY);
        pin.x = clamp01(pt.x);
        pin.y = clamp01(pt.y);
        positionPin(el, pin);
      }
      function up() {
        window.removeEventListener("pointermove", move);
        window.removeEventListener("pointerup", up);
        savePins();
      }
      window.addEventListener("pointermove", move);
      window.addEventListener("pointerup", up);
    });
    return el;
  }
  function positionPin(el, pin) {
    el.style.left = (pin.x * 100) + "%";
    el.style.top = (pin.y * 100) + "%";
  }
  function setPinText(el, pin) {
    el.querySelector(".pin-label").textContent = pinLabel(pin);
  }

  function renderPins() {
    document.querySelectorAll(".pinlayer").forEach(function (layer) {
      var floor = layer.dataset.floor;
      layer.innerHTML = "";
      floorPins(floor).forEach(function (pin) {
        layer.appendChild(makePinEl(pin, floor));
      });
    });
  }

  function addPin(floor, x, y, nameNow) {
    var pins = floorPins(floor);
    var maxN = 0;
    pins.forEach(function (p) {
      var m = (p.en || "").match(/^Pin (\d+)$/) || (p.zh || "").match(/^点 (\d+)$/);
      if (m) maxN = Math.max(maxN, +m[1]);
    });
    var pin = { x: x, y: y, en: "Pin " + (maxN + 1), zh: "点 " + (maxN + 1) };
    pins.push(pin);
    savePins();
    var layer = document.querySelector('.floorpane.active .pinlayer[data-floor="' + floor + '"]') ||
                document.querySelector('.pinlayer[data-floor="' + floor + '"]');
    var el = makePinEl(pin, floor);
    layer.appendChild(el);
    if (nameNow) openPinDialog(el, pin, floor);
    return el;
  }

  // ---- 命名对话框(文案来自 ui;完整转义 <>&") ----
  var dialog = null;
  function esc(s) { return (s || "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;"); }
  function closePinDialog(save) {
    if (!dialog) return;
    if (save) {
      var pin = dialog._pin;
      pin.en = dialog.querySelector(".pd-en").value.trim();
      pin.zh = dialog.querySelector(".pd-zh").value.trim();
      setPinText(dialog._el, pin);
      savePins();
      // 空名则回退默认名
      if (!pin.en && !pin.zh) setPinText(dialog._el, pin);
    }
    dialog.remove(); dialog = null;
  }
  function openPinDialog(el, pin, floor) {
    closePinDialog(false);
    dialog = document.createElement("div");
    dialog.className = "pin-dialog";
    dialog._pin = pin; dialog._el = el; dialog._floor = floor;
    dialog.innerHTML =
      '<label>' + uiText("pin_name_en") + '<input class="pd-en" value="' + esc(pin.en) + '"></label>' +
      '<label>' + uiText("pin_name_zh") + '<input class="pd-zh" value="' + esc(pin.zh) + '"></label>' +
      '<div class="pd-row"><button type="button" class="pd-save">' + uiText("pin_done") + '</button>' +
      '<button type="button" class="pd-del">' + uiText("pin_delete") + '</button></div>';
    var rect = el.getBoundingClientRect();
    dialog.style.left = Math.min(window.innerWidth - 240, Math.max(8, rect.left)) + "px";
    dialog.style.top = Math.min(window.innerHeight - 170, rect.bottom + 8) + "px";
    document.body.appendChild(dialog);
    dialog.querySelector(".pd-en").focus();
    dialog.querySelector(".pd-save").addEventListener("click", function () { closePinDialog(true); });
    dialog.querySelector(".pd-del").addEventListener("click", function () {
      var arr = floorPins(floor);
      var i = arr.indexOf(pin);
      if (i > -1) arr.splice(i, 1);
      savePins();
      el.remove();
      closePinDialog(false);
    });
    dialog.addEventListener("keydown", function (e) {
      if (e.key === "Enter") closePinDialog(true);
    });
  }
  document.addEventListener("pointerdown", function (e) {
    if (dialog && !e.target.closest(".pin-dialog") && !e.target.closest(".pin")) closePinDialog(true);
  });

  // ---- 导出面板 ----
  var exportBox = document.getElementById("pinExport");
  var exportBtn = document.getElementById("exportBtn");
  var exportTa = document.getElementById("pinJson");
  function refreshExport() {
    if (!exportBox || exportBox.hidden) return;
    var p = document.querySelector(".floorpane.active");
    var floor = p ? p.dataset.floor : null;
    exportTa.value = JSON.stringify(floor ? floorPins(floor) : [], null, 1);
  }
  if (exportBox) {
    exportBtn.addEventListener("click", function () {
      exportBox.hidden = !exportBox.hidden;
      refreshExport();
    });
    document.getElementById("pinClose").addEventListener("click", function () { exportBox.hidden = true; });
    var copyBtn = document.getElementById("pinCopy");
    var copyHtml = copyBtn.innerHTML;
    copyBtn.addEventListener("click", function () {
      exportTa.removeAttribute("readonly");
      exportTa.select();
      try { navigator.clipboard.writeText(exportTa.value); } catch (e) { document.execCommand("copy"); }
      exportTa.setAttribute("readonly", "");
      copyBtn.textContent = "✓";
      setTimeout(function () { copyBtn.innerHTML = copyHtml; }, 1200);
    });
  }

  // ---- Esc 分层关闭:对话框 → 导出面板 ----
  document.addEventListener("keydown", function (e) {
    if (e.key !== "Escape") return;
    if (dialog) { closePinDialog(true); return; }
    if (exportBox && !exportBox.hidden) exportBox.hidden = true;
  });

  // ---- 初始化 ----
  renderPins();
  layoutPinLayers();
  if (document.readyState === "complete") layoutPinLayers();
  else window.addEventListener("load", layoutPinLayers); // 图片加载后才知道精确显示矩形
})();
