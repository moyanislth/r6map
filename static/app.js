// R6地图前端逻辑(纯原生,零依赖)
// 结构:语言切换 / UI文案 / 楼层tab / 存储(覆盖层) / 缩放平移 / 单击双击标注 / 设置面板
(function () {
  "use strict";

  // ---- 语言 ----
  var html = document.documentElement;
  var btn = document.getElementById("langBtn");
  var titleEl = document.querySelector("title");
  function applyTitle(lang) { // 浏览器标签标题由模板给中英两版(data-zh/data-en),随语言切换
    if (!titleEl || !titleEl.dataset.zh) return;
    document.title = lang === "en" ? titleEl.dataset.en : titleEl.dataset.zh;
  }
  function setLang(lang, save) {
    html.lang = lang;
    if (btn) btn.textContent = lang === "zh" ? "EN" : "中";
    if (save) { try { localStorage.setItem("r6lang", lang); } catch (e) {} }
    applyTitle(lang);
    if (jsonTa) jsonTa.placeholder = uiText("settings_ph"); // 面板说明随语言切换
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
  function fmt2(key, n, k) { // 双占位符:{n} 生效条数,{k} 跳过条数
    return (uiText(key) || "").replace("{n}", n).replace("{k}", k);
  }

  // ---- 基础数据(构建期注入:每层报点 id/x/y/en/zh) ----
  var BASE = {};
  try { BASE = JSON.parse(document.getElementById("calloutData").textContent); } catch (e) {}
  // 官方报点 id 集合:区分 data/custom 以"是否官方报点"为准,而不是 id 前缀
  // (导入的标注 id 写法不规范时,也应该按内容渲染成自建点)
  var BASE_IDS = {};
  Object.keys(BASE).forEach(function (f) {
    (BASE[f] || []).forEach(function (p) { BASE_IDS[p.id] = true; });
  });

  // ---- 触屏设备只读模式:允许查看/缩放/平移,禁用标注编辑与设置面板 ----
  var COARSE = false;
  try { COARSE = window.matchMedia("(pointer: coarse)").matches; } catch (e) {}

  // ---- 楼层图按需加载:display:none 的 pane 里的 <img> 浏览器照样会下载,
  //      所以非当前楼层先放在 data-src 上,切到该楼层再赋 src ----
  function loadFloorImg(pane) {
    if (!pane) return;
    var img = pane.querySelector("img[data-src]");
    if (!img) return;
    img.src = img.getAttribute("data-src");
    img.removeAttribute("data-src");
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
      panes.forEach(function (p) {
        var on = p.dataset.floor === key;
        p.classList.toggle("active", on);
        if (on) loadFloorImg(p);
      });
      layoutPinLayers();
      refreshSettings();
    });
  }
  loadFloorImg(document.querySelector(".floorpane.active"));

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
  function hasXY(p) { return Number.isFinite(p.x) && Number.isFinite(p.y); } // 无坐标点不上图(否则 left 会写成 NaN% 并堆在图层原点)
  function effectivePins(floor) {
    var s = loadStore();
    var out = [];
    (BASE[floor] || []).forEach(function (p) {
      if (!hasXY(p)) return;
      if (s.overrides[p.id] && s.overrides[p.id].deleted) return;
      var o = s.overrides[p.id];
      // 必须给副本:拖拽/改名直接对 pin.x、pin.en 赋值,推引用会把内存里的 BASE 默认值改掉,
      // 恢复默认后重渲染仍是改过的位置,刷新页面才复位
      out.push(Object.assign({}, p, o || {}));
    });
    s.custom.forEach(function (p) {
      if (p.floor === floor && hasXY(p)) out.push(p);
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

    // 交互期间提升合成层保证流畅;静止后关闭,促使浏览器按当前倍率重新光栅化(消除放大后的模糊)
    var settleTimer = null;
    function interacting() {
      wrap._stage.style.willChange = "transform";
      if (settleTimer) clearTimeout(settleTimer);
      settleTimer = setTimeout(function () { wrap._stage.style.willChange = "auto"; }, 180);
    }

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
      interacting();
      applyStage(wrap);
    }, { passive: false });

    wrap.querySelector(".zoom-reset").addEventListener("click", function () { resetStage(wrap); });
    wrap.addEventListener("dragstart", function (e) { e.preventDefault(); });

    var panning = false, sx = 0, sy = 0, moved = false;
    var pts = new Map(); // 活动触点,支持双指捏合
    var pinch = null;
    function pdist(a, b) { return Math.hypot(a.x - b.x, a.y - b.y) || 1; }

    wrap.addEventListener("pointerdown", function (e) {
      if (!COARSE && e.target.closest(".pin")) return; // 桌面:标注上的按下交给标注自身(拖拽/删除)
      if (e.target.closest(".pin-dialog")) return;
      // 容器内按钮(目前只有缩放复位)自己处理点击:一旦 setPointerCapture,
      // 浏览器会把 click 派发到 mousedown/mouseup 的最近公共祖先(即容器),按钮就永远收不到
      if (e.target.closest("button")) return;
      if (e.pointerType === "mouse") e.preventDefault();
      pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (pts.size === 1) moved = false; // 新手势开始即清上一轮的拖拽标记:1x 下 pointerdown 原本不重置它,上一轮放大拖拽留下的 true 会把之后的单击/双击全部吞掉
      if (pts.size === 2) { // 进入捏合:记录初始距离/中点/偏移
        var arr = Array.from(pts.values());
        pinch = { d0: pdist(arr[0], arr[1]), s0: wrap._s,
                  mx0: (arr[0].x + arr[1].x) / 2, my0: (arr[0].y + arr[1].y) / 2,
                  tx0: wrap._tx, ty0: wrap._ty };
        panning = false;
        interacting();
      } else if (wrap._s > 1.001) { // 单指/鼠标:放大后拖拽平移
        panning = true; moved = false;
        sx = e.clientX - wrap._tx; sy = e.clientY - wrap._ty;
        interacting();
      }
      try { wrap.setPointerCapture(e.pointerId); } catch (err) {}
    });
    wrap.addEventListener("pointermove", function (e) {
      var p = pts.get(e.pointerId);
      if (p) { p.x = e.clientX; p.y = e.clientY; }
      if (pinch && pts.size >= 2) { // 以捏合中点为锚缩放,中点下的地图内容保持不动
        var arr = Array.from(pts.values());
        var ns = Math.min(MAX_SCALE, Math.max(1, pinch.s0 * pdist(arr[0], arr[1]) / pinch.d0));
        var mx = (arr[0].x + arr[1].x) / 2, my = (arr[0].y + arr[1].y) / 2;
        wrap._tx = mx - (pinch.mx0 - pinch.tx0) * (ns / pinch.s0);
        wrap._ty = my - (pinch.my0 - pinch.ty0) * (ns / pinch.s0);
        wrap._s = ns;
        if (wrap._s === 1) { wrap._tx = 0; wrap._ty = 0; }
        moved = true;
        interacting();
        applyStage(wrap);
        return;
      }
      if (!panning) return;
      var nx = e.clientX - sx, ny = e.clientY - sy;
      if (Math.abs(nx - wrap._tx) + Math.abs(ny - wrap._ty) > 3) moved = true;
      wrap._tx = nx; wrap._ty = ny;
      interacting();
      applyStage(wrap);
    });
    function endPointer(e) {
      pts.delete(e.pointerId);
      if (pts.size < 2) pinch = null;
      if (pts.size === 0) {
        panning = false;
      } else if (pts.size === 1 && wrap._s > 1.001) { // 捏合结束剩单指:无缝转为平移
        var rest = Array.from(pts.values())[0];
        panning = true; moved = false;
        sx = rest.x - wrap._tx; sy = rest.y - wrap._ty;
      }
    }
    wrap.addEventListener("pointerup", endPointer);
    wrap.addEventListener("pointercancel", endPointer);
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
      if (COARSE) return; // 触屏只读:不添加标注
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
  var pinZ = 2; // 置顶计数:与 .pin 的初始 z-index(2)对齐
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
      if (COARSE) return; // 触屏只读:不编辑标注
      openPinDialog(el, pin, floor, kind);
    });
    el.addEventListener("pointerdown", function (e) {
      if (COARSE) return; // 触屏只读:不拦截,让地图平移/捏合接管
      if (e.target === del) return;
      e.stopPropagation();
      e.preventDefault();
      el.style.zIndex = String(++pinZ); // 置顶:重叠标注里被压住的那个,操作一次就浮到最前
      var wrap = el.closest(".imgwrap");
      var grab = stagePoint(wrap, e.clientX, e.clientY);
      var offX = pin.x - grab.x, offY = pin.y - grab.y; // 抓取点与标点的原始偏移:拖动时保持,避免松手瞬间"跳位"
      var downX = e.clientX, downY = e.clientY, dragging = false;
      function move(ev) {
        if (!dragging) {
          if (Math.abs(ev.clientX - downX) + Math.abs(ev.clientY - downY) < 4) return; // 死区:手抖不算拖拽
          dragging = true;
        }
        var pt = stagePoint(wrap, ev.clientX, ev.clientY);
        pin.x = clamp01(pt.x + offX);
        pin.y = clamp01(pt.y + offY);
        el.style.left = (pin.x * 100) + "%";
        el.style.top = (pin.y * 100) + "%";
      }
      function unbind() {
        window.removeEventListener("pointermove", move);
        window.removeEventListener("pointerup", up);
        window.removeEventListener("pointercancel", cancel);
      }
      function up() {
        unbind();
        if (dragging) persistPin(floor, pin, kind); // 没真拖动过就不写覆盖层
      }
      function cancel() { unbind(); } // 拖拽被系统中断:仅解绑,不落盘中间位置
      window.addEventListener("pointermove", move);
      window.addEventListener("pointerup", up);
      window.addEventListener("pointercancel", cancel);
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
    refreshSettings(); // 拖完标注,面板里的 JSON 当场同步(否则再点「应用」会把改动覆盖回去)
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
    refreshSettings(); // 面板开着时,新标注立刻出现在 JSON 里
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
        var kind = BASE_IDS[pin.id] ? "data" : "custom";
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
      if (!en && !zh) { en = pin.en || ""; zh = pin.zh || ""; } // 两个名字都清空时保持原名,避免导出空名条目
      pin.en = en; pin.zh = zh;
      var s = loadStore(); // 先确保 store 已从 localStorage 载入(自建点本身就存在 store.custom 里)
      if (kind === "data") {
        var o = s.overrides[pin.id] || {};
        o.en = en; o.zh = zh;
        s.overrides[pin.id] = o;
      }
      saveStore(); // 两类标注都要落盘:此前 custom 只改内存,刷新后名字丢失
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
  if (jsonTa) jsonTa.placeholder = uiText("settings_ph"); // 初始占位:setLang 首跑时本元素还不存在,只能在这里补
  var msg = document.getElementById("settingsMsg");
  var msgTimer = null;
  function showMsg(text, cls) {
    msg.textContent = text;
    msg.className = "settings-msg" + (cls ? " " + cls : "");
    // 旧提示的定时器不清掉的话,会把刚弹出的新提示提前抹掉
    if (msgTimer) clearTimeout(msgTimer);
    msgTimer = setTimeout(function () { msg.textContent = ""; }, 2500);
  }
  // 本图全部楼层(模板按楼层生成 pinlayer,以此为准)
  var validFloors = Array.prototype.map.call(document.querySelectorAll(".pinlayer"), function (l) { return l.dataset.floor; });
  function refreshSettings(force) {
    if (!panel || panel.hidden) return;
    // 与地图实时同步:但用户正在手动编辑文本框时不覆盖他输入的内容(force=true 用于应用/恢复默认/导出)
    if (boxDirty && !force) return;
    var s = loadStore();
    var has = Object.keys(s.overrides || {}).length > 0 || (s.custom || []).length > 0;
    jsonTa.value = has ? JSON.stringify(s, null, 1) : ""; // 默认状态 = 空文本框(空 = 官方默认)
    boxDirty = false;
  }
  var boxDirty = false;
  if (jsonTa) jsonTa.addEventListener("input", function () { boxDirty = true; });
  if (gearBtn && COARSE) gearBtn.style.display = "none"; // 触屏只读:隐藏设置入口
  if (gearBtn && !COARSE) { // 触屏只读:不提供设置面板
    gearBtn.addEventListener("click", function () {
      panel.hidden = !panel.hidden;
      refreshSettings();
    });
    document.getElementById("settingsClose").addEventListener("click", function () { panel.hidden = true; });
    document.getElementById("settingsExport").addEventListener("click", function () {
      refreshSettings(true); // 导出的是"已保存的标注"
      if (!jsonTa.value.trim()) { showMsg(uiText("settings_export_empty")); return; }
      jsonTa.removeAttribute("readonly");
      jsonTa.select();
      function done(ok) {
        jsonTa.setAttribute("readonly", "");
        if (ok) showMsg(fmt("settings_copied"), "ok");
        else showMsg("✗", "err");
      }
      function fallback() {
        var ok = false;
        try { ok = document.execCommand("copy"); } catch (e) {}
        done(ok);
      }
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(jsonTa.value).then(function () { done(true); }, fallback);
      } else {
        fallback();
      }
    });
    document.getElementById("settingsApply").addEventListener("click", function () {
      // 语义:文本框 = 本图个人标注。空 → 展示默认(官方报点);有内容 → 立刻按内容覆盖重绘
      if (!jsonTa.value.trim()) { resetToDefault(); return; }
      try {
        var data = JSON.parse(jsonTa.value);
        if (Array.isArray(data)) data = { overrides: {}, custom: data };
        if (!data || typeof data !== "object" || typeof data.overrides !== "object" || !Array.isArray(data.custom)) {
          throw new Error("shape");
        }
        var dropped = 0;
        var overrides = {};
        Object.keys(data.overrides || {}).forEach(function (id) {
          var o = data.overrides[id];
          if (!BASE_IDS[id] || !o || typeof o !== "object") { dropped++; return; } // 不是本图报点/形状无效
          overrides[id] = o;
        });
        var custom = data.custom.filter(function (p) { // 只收能在本图上落点的:楼层合法 + 坐标有效
          var ok = p && typeof p === "object" && validFloors.indexOf(p.floor) >= 0 &&
                   Number.isFinite(p.x) && Number.isFinite(p.y);
          if (!ok) dropped++;
          return ok;
        });
        store = { overrides: overrides, custom: custom };
        saveStore();
        renderPins(); // 立即按标注内容重绘地图
        boxDirty = false; // 文本框内容已生效,恢复"地图→面板"实时同步
        var n = Object.keys(overrides).length + custom.length;
        if (dropped) showMsg(fmt2("settings_import_skip", n, dropped), "err");
        else showMsg(fmt("settings_import_ok", n), "ok");
      } catch (e) {
        showMsg(uiText("settings_import_bad"), "err");
      }
    });
    // 恢复默认:清掉本图个人标注、已删除的官方报点也一并回来;不需要刷新页面
    function resetToDefault() {
      store = emptyStore();
      saveStore();
      renderPins();
      refreshSettings(true);
      showMsg(uiText("settings_cleared"), "ok");
    }
    document.getElementById("settingsClear").addEventListener("click", resetToDefault);
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
