// R6 地图报点前端逻辑(纯原生,零依赖)
// 结构:语言切换 / UI文案 / 楼层tab / 存储(覆盖层) / 缩放平移 / 单击双击标注 / 设置面板
window.addEventListener("error", function (e) {
  (window.__r6errs = window.__r6errs || []).push(e.message + " @" + e.lineno);
});
(function () {
  "use strict";

  // ---- 语言 ----
  var html = document.documentElement;
  var btn = document.getElementById("langBtn");
  function setLang(lang, save) {
    html.lang = lang;
    if (btn) btn.textContent = lang === "zh" ? "EN" : "中";
    if (save) { try { localStorage.setItem("r6lang", lang); } catch (e) {} }
    renderPins();
  }
  var saved = null;
  try {
    saved = localStorage.getItem("r6lang");
  } catch (e) {}
  if (btn) btn.addEventListener("click", function () {
    setLang(html.lang === "zh" ? "en" : "zh", true);
  });

  // ---- UI 文案(floors.json ui 节,经模板注入) ----
  var UI = {};
  try { UI = JSON.parse(document.getElementById("uiTerms").textContent); } catch (e) {}
  function uiText(key) {
    var t = UI[key] || {};
    return html.lang === "en" ? t.en : t.zh;
  }
  function fmt(key, n) {
    return (uiText(key) || "").replace("{n}", n);
  }

  // ---- 基础数据(构建期注入:每层报点 id/x/y/en/zh) ----
  var BASE = {};
  try { BASE = JSON.parse(document.getElementById("calloutData").textContent); } catch (e) {}

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
      refreshSettings();
    });
  }

  // ---- 存储:文件报点的用户覆盖层 + 自建标注(localStorage 禁用时降级内存) ----
  var MAP_ID = (document.body.dataset.map || (location.pathname.match(/maps\/([a-z0-9-]+)\.html/) || [])[1]) || "unknown";
  var storeKey = "r6pins:" + MAP_ID;
  var memStore = {};
  function storeGet(k) { try { return localStorage.getItem(k); } catch (e) { return memStore[k] || null; } }
  function storeSet(k, v) { try { localStorage.setItem(k, v); } catch (e) { memStore[k] = v; } }
  var store = null;
  function loadStore() {
    if (!store) {
      try { store = JSON.parse(storeGet(storeKey)) || {}; } catch (e) { store = {}; }
      if (!store.overrides || typeof store.overrides !== "object") store.overrides = {};
      if (!Array.isArray(store.custom)) store.custom = [];
    }
    return store;
  }
  function saveStore() { storeSet(storeKey, JSON.stringify(store)); }
  function emptyStore() { return { overrides: {}, custom: [] }; }

  // 生效标注列表:文件报点应用覆盖层 + 自建
  function effectivePins(floor) {
    var s = loadStore();
    var out = [];
    (BASE[floor] || []).forEach(function (p) {
      if (s.overrides[p.id] && s.overrides[p.id].deleted) return;
      var o = s.overrides[p.id];
      out.push(o ? Object.assign({}, p, o) : p);
    });
    s.custom.forEach(function (p) {
      if (p.floor === floor) out.push(p);
    });
    return out;
  }
  function pinLabel(pin) {
    return html.lang === "en" ? (pin.en || pin.zh || uiText("pin_default")) : (pin.zh || pin.en || uiText("pin_default"));
  }

  // ---- 行内缩放/平移(仅放大后可拖地图) ----
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
    wrap.addEventListener("dragstart", function (e) { e.preventDefault(); });

    var panning = false, sx = 0, sy = 0, moved = false;
    wrap.addEventListener("pointerdown", function (e) {
      if (e.target.closest(".pin") || e.target.closest(".pin-dialog")) return;
      if (e.pointerType === "mouse") e.preventDefault();
      if (wrap._s <= 1.001) return; // 仅放大后拖拽平移
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

  // ---- 坐标换算(图片实际显示矩形,兼容 contain 留边) ----
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

  // ---- 单击:坐标读数;双击:添加/编辑标注 ----
  var clickTimer = null;
  document.querySelectorAll(".imgwrap").forEach(function (wrap) {
    wrap.addEventListener("click", function (e) {
      if (e.target.closest(".pin") || e.target.closest(".pin-dialog") || e.target.closest("button")) return;
      if (wrap._movedRecently()) return;
      var ev = e;
      if (clickTimer) { clearTimeout(clickTimer); clickTimer = null; return; }
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
      addCustomPin(floor, clamp01(pt.x), clamp01(pt.y));
    });
  });

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

  // ---- 标注渲染 ----
  function makePinEl(pin, floor, kind) {
    var el = document.createElement("div");
    el.className = "pin";
    el.dataset.kind = kind;
    el._pin = pin;
    el.style.left = (pin.x * 100) + "%";
    el.style.top = (pin.y * 100) + "%";
    var dot = document.createElement("span");
    dot.className = "pin-dot";
    var label = document.createElement("span");
    label.className = "pin-label";
    label.textContent = pinLabel(pin);
    el.appendChild(dot);
    el.appendChild(label);

    var del = document.createElement("button");
    del.type = "button"; del.className = "pin-del"; del.textContent = "×";
    del.title = uiText("pin_delete");
    del.addEventListener("click", function (e) {
      e.stopPropagation();
      deletePin(floor, pin);
      el.remove();
    });
    el.appendChild(del);

    el.addEventListener("dblclick", function (e) {
      e.stopPropagation();
      openPinDialog(el, pin, floor, kind);
    });
    el.addEventListener("pointerdown", function (e) {
      if (e.target === del) return;
      e.stopPropagation();
      e.preventDefault();
      var wrap = el.closest(".imgwrap");
      function move(ev) {
        var pt = stagePoint(wrap, ev.clientX, ev.clientY);
        pin.x = clamp01(pt.x);
        pin.y = clamp01(pt.y);
        el.style.left = (pin.x * 100) + "%";
        el.style.top = (pin.y * 100) + "%";
      }
      function up() {
        window.removeEventListener("pointermove", move);
        window.removeEventListener("pointerup", up);
        persistPin(floor, pin, kind);
      }
      window.addEventListener("pointermove", move);
      window.addEventListener("pointerup", up);
    });
    return el;
  }

  // 持久化:kind=data 写覆盖层(保留未涉及字段),kind=custom 直接改对象
  function persistPin(floor, pin, kind) {
    var s = loadStore();
    if (kind === "data") {
      var o = s.overrides[pin.id] || {};
      o.x = pin.x; o.y = pin.y;
      if (pin.en !== undefined) o.en = pin.en;
      if (pin.zh !== undefined) o.zh = pin.zh;
      s.overrides[pin.id] = o;
    }
    saveStore();
  }
  function deletePin(floor, pin) {
    var s = loadStore();
    if (pin.id && s.overrides[pin.id] !== undefined || BASE[floor] && (BASE[floor] || []).some(function (p) { return p.id === pin.id; })) {
      s.overrides[pin.id] = Object.assign({}, s.overrides[pin.id], { deleted: true });
    } else {
      s.custom = s.custom.filter(function (p) { return p !== pin; });
    }
    saveStore();
    refreshSettings();
  }
  function addCustomPin(floor, x, y) {
    var s = loadStore();
    var maxN = 0;
    s.custom.forEach(function (p) {
      var m2 = (p.en || "").match(/^Pin (\d+)$/);
      if (m2) maxN = Math.max(maxN, +m2[1]);
    });
    Object.keys(s.overrides).forEach(function (id) {
      var en = s.overrides[id].en || ((BASE[floor] || []).filter(function (p) { return p.id === id; })[0] || {}).en;
      var m2 = (en || "").match(/^Pin (\d+)$/);
      if (m2) maxN = Math.max(maxN, +m2[1]);
    });
    var pin = { id: "custom." + Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
                x: x, y: y, en: "Pin " + (maxN + 1), zh: "点 " + (maxN + 1), floor: floor };
    s.custom.push(pin);
    saveStore();
    var layer = document.querySelector('.floorpane.active .pinlayer[data-floor="' + floor + '"]') ||
                document.querySelector('.pinlayer[data-floor="' + floor + '"]');
    var el = makePinEl(pin, floor, "custom");
    layer.appendChild(el);
    openPinDialog(el, pin, floor, "custom");
  }

  function renderPins() {
    document.querySelectorAll(".pinlayer").forEach(function (layer) {
      var floor = layer.dataset.floor;
      layer.innerHTML = "";
      effectivePins(floor).forEach(function (pin) {
        var kind = (String(pin.id || "").indexOf("custom.") === 0) ? "custom" : "data";
        layer.appendChild(makePinEl(pin, floor, kind));
      });
    });
    layoutPinLayers();
  }

  // ---- 命名对话框(数据点写覆盖层,自建点直改;完整转义) ----
  var dialog = null;
  function esc(s) { return (s || "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;"); }
  function closePinDialog(save) {
    if (!dialog) return;
    if (save) {
      var pin = dialog._pin, kind = dialog._kind, floor = dialog._floor;
      var en = dialog.querySelector(".pd-en").value.trim();
      var zh = dialog.querySelector(".pd-zh").value.trim();
      pin.en = en; pin.zh = zh;
      if (kind === "data") {
        var s = loadStore();
        var o = s.overrides[pin.id] || {};
        o.en = en; o.zh = zh;
        s.overrides[pin.id] = o;
        saveStore();
      }
      dialog._el.querySelector(".pin-label").textContent = pinLabel(pin);
      refreshSettings();
    }
    dialog.remove(); dialog = null;
  }
  function openPinDialog(el, pin, floor, kind) {
    closePinDialog(false);
    dialog = document.createElement("div");
    dialog.className = "pin-dialog";
    dialog._pin = pin; dialog._el = el; dialog._floor = floor; dialog._kind = kind;
    dialog.innerHTML =
      '<label>' + uiText("pin_name_en") + '<input class="pd-en" value="' + esc(pin.en) + '"></label>' +
      '<label>' + uiText("pin_name_zh") + '<input class="pd-zh" value="' + esc(pin.zh) + '"></label>' +
      '<div class="pd-row"><button type="button" class="pd-save">' + uiText("pin_done") + '</button>' +
      '<button type="button" class="pd-del">' + uiText("pin_delete") + '</button></div>';
    var rect = el.getBoundingClientRect();
    dialog.style.left = Math.min(window.innerWidth - 246, Math.max(8, rect.left)) + "px";
    dialog.style.top = Math.min(window.innerHeight - 170, rect.bottom + 8) + "px";
    document.body.appendChild(dialog);
    dialog.querySelector(".pd-en").focus();
    dialog.querySelector(".pd-save").addEventListener("click", function () { closePinDialog(true); });
    dialog.querySelector(".pd-del").addEventListener("click", function () {
      deletePin(floor, pin);
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

  // ---- 齿轮设置面板:导出 / 导入 / 清空 ----
  var gearBtn = document.getElementById("gearBtn");
  var panel = document.getElementById("settingsPanel");
  var jsonTa = document.getElementById("settingsJson");
  var msg = document.getElementById("settingsMsg");
  function showMsg(text, cls) {
    msg.textContent = text;
    msg.className = "settings-msg" + (cls ? " " + cls : "");
    setTimeout(function () { msg.textContent = ""; }, 2500);
  }
  function refreshSettings() {
    if (!panel || panel.hidden) return;
    jsonTa.value = JSON.stringify(loadStore(), null, 1);
  }
  if (gearBtn) {
    gearBtn.addEventListener("click", function () {
      panel.hidden = !panel.hidden;
      refreshSettings();
    });
    document.getElementById("settingsClose").addEventListener("click", function () { panel.hidden = true; });
    document.getElementById("settingsExport").addEventListener("click", function () {
      refreshSettings();
      jsonTa.removeAttribute("readonly");
      jsonTa.select();
      var ok = false;
      try { ok = document.execCommand("copy"); } catch (e) {}
      try { navigator.clipboard.writeText(jsonTa.value); ok = true; } catch (e) {}
      jsonTa.setAttribute("readonly", "");
      showMsg(ok ? fmt("settings_copied") : "", ok ? "ok" : "");
    });
    document.getElementById("settingsApply").addEventListener("click", function () {
      try {
        var data = JSON.parse(jsonTa.value);
        if (Array.isArray(data)) data = { overrides: {}, custom: data };
        if (!data || typeof data !== "object" || typeof data.overrides !== "object" || !Array.isArray(data.custom)) {
          throw new Error("shape");
        }
        store = { overrides: data.overrides || {}, custom: data.custom || [] };
        saveStore();
        renderPins();
        showMsg(fmt("settings_import_ok").replace("{n}",
          Object.keys(store.overrides).length + store.custom.length), "ok");
      } catch (e) {
        showMsg(uiText("settings_import_bad"), "err");
      }
    });
    document.getElementById("settingsClear").addEventListener("click", function () {
      store = emptyStore();
      saveStore();
      renderPins();
      refreshSettings();
      showMsg("✓", "ok");
    });
  }

  // ---- Esc 分层:对话框 → 设置面板 ----
  document.addEventListener("keydown", function (e) {
    if (e.key !== "Escape") return;
    if (dialog) { closePinDialog(true); return; }
    if (panel && !panel.hidden) panel.hidden = true;
  });

  // ---- 初始化 ----
  if (saved === "en" || saved === "zh") html.lang = saved; // 应用存储语言
  setLang(html.lang, false);
  layoutPinLayers();
  window.addEventListener("load", layoutPinLayers);
})();
