// ==UserScript==
// @name         长按加速播放
// @name:en      Long-Press Video Speed
// @namespace    lpvs.longpress.speed
// @version      1.3.0
// @description  移动端长按网页视频约0.35秒即临时加速播放(默认3倍速)，松手恢复原速；电脑端鼠标左键长按视频、或按住 Shift+方向右 加速，松开恢复。配合篡改猴使用，手机 Edge / Firefox / 桌面浏览器均可用。
// @description:en  Long-press any web video (finger or mouse, default 3x) to fast-forward temporarily; on desktop also hold Shift+Right. Release to restore. Works wherever Tampermonkey runs.
// @author       lpvs
// @match        *://*/*
// @run-at       document-idle
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_registerMenuCommand
// @grant        GM_unregisterMenuCommand
// @grant        GM_addValueChangeListener
// @downloadURL  https://raw.githubusercontent.com/yuan-yannick/Edge_mobile-player/main/longpress-speed.user.js
// @updateURL    https://raw.githubusercontent.com/yuan-yannick/Edge_mobile-player/main/longpress-speed.user.js
// @license      MIT
// ==/UserScript==

(function () {
  "use strict";

  /*
   * 长按加速播放 - 篡改猴(Tampermonkey)脚本版
   * --------------------------------------------------------------
   * 逻辑与扩展版 content.js 完全一致：
   *  - 长按视频(默认 350ms)临时加速，松手恢复原速（触摸或鼠标左键）；
   *  - 电脑端按住 Shift+方向右 立即加速，松开任一键恢复；
   *  - 输入法(IME)接管按键导致 key 为 "Process" 时按物理键 e.code 判定，
   *    开着中文输入法也能触发；组合键两键先后按下顺序不限；
   *  - 鼠标松开事件丢失(如在浏览器界面外松开)时自动自我修复；
   *  - 短按(暂停/播放)、滑动(进度/音量)等原生手势不受影响；
   *  - 通过 ratechange 与短周期校正抵抗 YouTube 对倍速的重置；
   *  - 屏蔽长按视频弹出的“保存图像/复制”系统菜单。
   * 与扩展版的差异：
   *  - 设置存储 chrome.storage.sync -> GM_setValue(单键 settings 对象)；
   *  - 设置入口 扩展弹窗 -> 篡改猴“脚本菜单”(仅在顶层页面注册，
   *    避免每个 iframe 重复一条命令)；
   *  - 样式由注入的 <style> 提供(替代 content.css)；
   *  - 设置变更经 GM_addValueChangeListener 同步到同标签页所有框架，
   *    篡改猴版本过旧不支持时，刷新页面后生效。
   */

  try {
    if (window.__lpvsUserscript) return;
    window.__lpvsUserscript = true;
  } catch (e) {}

  // 默认设置（与 content.js / background.js / popup.js 保持一致）
  const DEFAULTS = {
    enabled: true,
    speed: 3.0,
    delay: 350,
    moveTolerance: 10,
    vibrate: true,
  };

  const RATE_EPSILON = 0.01;
  const RATE_RECHECK_MS = 120;
  const CLICK_SUPPRESS_MS = 700;

  const KEY = "settings";

  const isTop = (function () {
    try { return window.top === window.self; } catch (e) { return false; }
  })();

  // 当前正在追踪的指针 / 旧式触摸 / 键盘组合键会话
  let active = null;

  // 用于在松手后吞掉一次 click 的时间窗
  let suppressClickUntil = 0;

  /* ---------- 设置读写（GM 存储） ---------- */
  let settings = Object.assign({}, DEFAULTS);

  function normalizedSettings(value) {
    const next = Object.assign({}, DEFAULTS, value || {});
    next.enabled = next.enabled !== false;
    next.speed = Math.min(16, Math.max(1.25, Number(next.speed) || DEFAULTS.speed));
    next.delay = Math.min(1000, Math.max(100, Number(next.delay) || DEFAULTS.delay));
    next.moveTolerance = Math.min(50, Math.max(3, Number(next.moveTolerance) || DEFAULTS.moveTolerance));
    next.vibrate = next.vibrate !== false;
    return next;
  }

  function loadSettings() {
    let s = null;
    try { s = GM_getValue(KEY, null); } catch (e) { s = null; }
    settings = normalizedSettings(s && typeof s === "object" ? s : null);
  }

  function saveSettings(patch) {
    settings = normalizedSettings(Object.assign({}, settings, patch));
    try { GM_setValue(KEY, settings); } catch (e) {}
  }

  loadSettings();

  try {
    if (typeof GM_addValueChangeListener === "function") {
      GM_addValueChangeListener(KEY, function (name, oldVal, newVal, remote) {
        if (!newVal || typeof newVal !== "object") return;
        settings = normalizedSettings(newVal);
        if (!settings.enabled) {
          clearActive();
        } else if (active && active.speedMode) {
          applyTargetRate(active);
          updateBadge(settings.speed);
        }
        registerMenu(); // 刷新菜单项上的“当前值”文案
      });
    }
  } catch (e) {}

  /* ---------- 注入样式（替代扩展的 content.css） ---------- */
  (function injectStyle() {
    const css = document.createElement("style");
    css.textContent =
      // 抑制移动端长按视频时弹出的系统菜单与文字选择
      "video{-webkit-touch-callout:none!important;-webkit-user-select:none!important;user-select:none!important}" +
      // 倍速提示角标
      ".lpvs-badge{position:fixed;z-index:2147483647;display:none;min-width:60px;padding:7px 12px;" +
      "font:600 14px/1 'Segoe UI',-apple-system,'PingFang SC','Microsoft YaHei',sans-serif;color:#fff;" +
      "text-align:center;background:rgba(17,17,17,0.82);border-radius:18px;" +
      "box-shadow:0 4px 14px rgba(0,0,0,0.35);-webkit-backdrop-filter:blur(4px);backdrop-filter:blur(4px);" +
      "pointer-events:none;letter-spacing:0.3px;white-space:nowrap}" +
      // 设置反馈轻提示
      ".lpvs-toast{position:fixed;z-index:2147483647;top:18px;left:50%;" +
      "transform:translate(-50%,-8px);opacity:0;transition:opacity .25s,transform .25s;" +
      "padding:8px 16px;font:600 14px/1 'Segoe UI',-apple-system,'PingFang SC',sans-serif;color:#fff;" +
      "background:rgba(17,17,17,0.82);border-radius:18px;box-shadow:0 4px 14px rgba(0,0,0,0.35);" +
      "pointer-events:none;white-space:nowrap}" +
      ".lpvs-toast.lpvs-show{opacity:1;transform:translate(-50%,0)}";
    (document.head || document.documentElement).appendChild(css);
  })();

  /* ---------- 轻提示（仅顶层页面显示） ---------- */
  let toastEl = null, toastTimer = null;
  function showToast(msg) {
    if (!isTop) return;
    if (!toastEl) {
      toastEl = document.createElement("div");
      toastEl.className = "lpvs-toast";
      document.documentElement.appendChild(toastEl);
    }
    toastEl.textContent = msg;
    toastEl.classList.add("lpvs-show");
    if (toastTimer) clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { toastEl.classList.remove("lpvs-show"); }, 1600);
  }

  /* ---------- 工具函数 ---------- */
  function isEditable(target) {
    if (!target || target.nodeType !== Node.ELEMENT_NODE) return false;
    return !!target.closest("input, textarea, select, [contenteditable='true']");
  }

  function videoRect(video) {
    try { return video.getBoundingClientRect(); } catch (_) { return null; }
  }

  function isVisibleVideo(video) {
    const rect = videoRect(video);
    if (!rect || rect.width < 2 || rect.height < 2) return false;
    return rect.bottom > 0 && rect.right > 0 && rect.top < innerHeight && rect.left < innerWidth;
  }

  function pointInside(rect, x, y) {
    return !!rect && x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom;
  }

  function videosFromNode(node) {
    if (!node || node.nodeType !== Node.ELEMENT_NODE) return [];
    if (node.tagName === "VIDEO") return [node];
    const player = node.closest && node.closest(
      ".html5-video-player, #player-container, #movie_player, ytm-player, .video-js, [data-video-player]"
    );
    return player ? Array.from(player.querySelectorAll("video")) : [];
  }

  // YouTube 的触摸/点击目标通常是覆盖在 video 上方的兄弟节点。
  function findVideoForEvent(event, x, y) {
    const candidates = new Set();
    const path = typeof event.composedPath === "function" ? event.composedPath() : [event.target];
    for (const node of path) {
      for (const video of videosFromNode(node)) candidates.add(video);
    }
    if (document.elementsFromPoint) {
      for (const node of document.elementsFromPoint(x, y)) {
        for (const video of videosFromNode(node)) candidates.add(video);
      }
    }
    for (const video of document.querySelectorAll("video")) {
      if (pointInside(videoRect(video), x, y)) candidates.add(video);
    }

    let best = null, bestScore = -Infinity;
    for (const video of candidates) {
      const rect = videoRect(video);
      if (!rect || rect.width < 2 || rect.height < 2) continue;
      const score = (pointInside(rect, x, y) ? 1e12 : 0) +
        (!video.paused && !video.ended ? 1e9 : 0) + (isVisibleVideo(video) ? 1e6 : 0) +
        Math.min(rect.width * rect.height, 999999);
      if (score > bestScore) { best = video; bestScore = score; }
    }
    if (!best) {
      const all = Array.from(document.querySelectorAll("video")).filter(isVisibleVideo);
      if (all.length === 1 && pointInside(videoRect(all[0]), x, y)) best = all[0];
    }
    return best;
  }

  /* ---------- 角标 ---------- */
  let badge = null;
  function ensureBadge() {
    if (badge) return badge;
    badge = document.createElement("div");
    badge.className = "lpvs-badge";
    badge.style.display = "none";
    document.documentElement.appendChild(badge);
    return badge;
  }
  function showBadge(rate, x, y) {
    ensureBadge();
    badge.textContent = "▶▶ " + Number(rate).toFixed(1) + "x";
    // 放在触摸点上方，越界则贴边
    const w = 92, h = 34;
    let left = x - w / 2;
    let top = y - h - 16;
    left = Math.max(6, Math.min(left, window.innerWidth - w - 6));
    if (top < 6) top = y + 20;
    badge.style.left = left + "px";
    badge.style.top = top + "px";
    badge.style.display = "block";
  }
  function updateBadge(rate) {
    if (badge) badge.textContent = "▶▶ " + Number(rate).toFixed(1) + "x";
  }
  function hideBadge() {
    if (badge) badge.style.display = "none";
  }

  /* ---------- 加速 / 恢复 ---------- */
  function applyTargetRate(session) {
    if (!session || !session.speedMode || !session.video || !session.video.isConnected) return;
    if (Math.abs(session.video.playbackRate - settings.speed) > RATE_EPSILON) {
      try { session.video.playbackRate = settings.speed; } catch (_) {}
    }
  }

  function activate(at) {
    if (!at || at !== active || !at.video || !at.video.isConnected) {
      clearActive();
      return;
    }
    at.timer = null;
    at.speedMode = true;
    at.originalRate = at.video.playbackRate;
    at.video.addEventListener("ratechange", onRateChange);
    applyTargetRate(at);
    at.rateTimer = setInterval(function () { applyTargetRate(at); }, RATE_RECHECK_MS);
    showBadge(settings.speed, at.startX, at.startY);
    if (settings.vibrate && navigator.vibrate) {
      try { navigator.vibrate(15); } catch (_) {}
    }
  }

  function onRateChange(e) {
    const at = active;
    if (!at || !at.speedMode || at.video !== e.currentTarget) return;
    applyTargetRate(at);
  }

  function restore(at) {
    if (!at) return;
    at.speedMode = false;
    if (at.rateTimer) {
      clearInterval(at.rateTimer);
      at.rateTimer = null;
    }
    if (at.video) at.video.removeEventListener("ratechange", onRateChange);
    try { if (at.video && at.video.isConnected) at.video.playbackRate = at.originalRate; } catch (_) {}
    hideBadge();
  }

  function clearActive(options) {
    const at = active;
    if (!at) return;
    if (at.timer) { clearTimeout(at.timer); at.timer = null; }
    if (at.speedMode) {
      if (options && options.suppressClick) suppressClickUntil = Date.now() + CLICK_SUPPRESS_MS;
      restore(at);
    }
    active = null;
  }

  function beginPress(source, id, video, x, y) {
    active = {
      source: source,
      id: id,
      video: video,
      originalRate: video.playbackRate,
      timer: null,
      rateTimer: null,
      startX: x,
      startY: y,
      speedMode: false,
    };
    const at = active;
    at.timer = setTimeout(function () { activate(at); }, settings.delay);
  }

  /* ---------- Pointer Events：鼠标、触摸和触控笔统一处理 ---------- */
  function onPointerDown(e) {
    if (!settings.enabled || active || !e.isPrimary || e.button !== 0) return;
    if (e.pointerType === "mouse" && isEditable(e.target)) return;
    const video = findVideoForEvent(e, e.clientX, e.clientY);
    if (!video) return;
    beginPress("pointer", e.pointerId, video, e.clientX, e.clientY);
  }

  function onPointerMove(e) {
    const at = active;
    if (!at || at.source !== "pointer" || at.id !== e.pointerId) return;
    if (e.pointerType === "mouse" && !(e.buttons & 1)) {
      clearActive();
      return;
    }
    if (!at.speedMode && Math.hypot(e.clientX - at.startX, e.clientY - at.startY) > settings.moveTolerance) clearActive();
  }

  function onPointerEnd(e) {
    const at = active;
    if (!at || at.source !== "pointer" || at.id !== e.pointerId) return;
    if (e.type === "pointerup" && e.pointerType === "mouse" && e.button !== 0) return;
    const wasActive = at.speedMode;
    clearActive({ suppressClick: wasActive });
    if (wasActive && e.cancelable) e.preventDefault();
  }

  /* ---------- 不支持 Pointer Events 的旧移动浏览器回退 ---------- */
  function findTouch(list, id) {
    for (let i = 0; i < list.length; i++) if (list[i].identifier === id) return list[i];
    return null;
  }

  function onTouchStart(e) {
    if (window.PointerEvent || !settings.enabled || active) return;
    for (const touch of e.changedTouches) {
      const video = findVideoForEvent(e, touch.clientX, touch.clientY);
      if (!video) continue;
      beginPress("touch", touch.identifier, video, touch.clientX, touch.clientY);
      break;
    }
  }

  function onTouchMove(e) {
    const at = active;
    if (!at || at.source !== "touch") return;
    const touch = findTouch(e.touches, at.id) || findTouch(e.changedTouches, at.id);
    if (!touch) return;
    if (!at.speedMode && Math.hypot(touch.clientX - at.startX, touch.clientY - at.startY) > settings.moveTolerance) clearActive();
  }

  function onTouchEnd(e) {
    const at = active;
    if (!at || at.source !== "touch" || !findTouch(e.changedTouches, at.id)) return;
    const wasActive = at.speedMode;
    clearActive({ suppressClick: wasActive });
    if (wasActive && e.cancelable) e.preventDefault();
  }

  function onClick(e) {
    if (Date.now() >= suppressClickUntil) return;
    e.preventDefault();
    e.stopImmediatePropagation();
    suppressClickUntil = 0;
  }

  function onContextMenu(e) {
    if (!active || !active.video) return;
    if (active.speedMode || pointInside(videoRect(active.video), e.clientX, e.clientY)) {
      e.preventDefault();
      e.stopImmediatePropagation();
    }
  }

  /* ---------- 键盘加速：电脑端按住 Shift+方向右，松开任一键恢复 ---------- */

  // 找当前播放中的最大视频；没有播放中的视频时不劫持按键（原行为放行）
  function findPlayingVideo() {
    const all = document.querySelectorAll("video");
    let best = null, bestArea = 0;
    for (const v of all) {
      if (v.paused || v.ended || !isVisibleVideo(v)) continue;
      const r = videoRect(v);
      const area = r.width * r.height;
      if (area > bestArea) { bestArea = area; best = v; }
    }
    return best;
  }

  // 中文输入法(IME)接管按键时，keydown/keyup 的 key 会变成 "Process"(keyCode 229)，
  // 但 e.code 仍是物理键名——据此判定，保证桌面端开着输入法也能触发。
  function isArrowRightKey(e) {
    return e.key === "ArrowRight" || e.code === "ArrowRight" || e.keyCode === 39;
  }
  function isShiftKey(e) {
    return e.key === "Shift" || e.code === "ShiftLeft" ||
           e.code === "ShiftRight" || e.keyCode === 16;
  }

  // 方向右是否处于按下状态（支持“先按 → 再按 Shift”的按下顺序）
  let arrowHeld = false;

  function onKeyDown(e) {
    if (!settings.enabled) return;
    const at = active;
    if (at) {
      // 加速期间吞掉组合键的自动重复等事件，避免网站同时响应
      if (at.source === "keyboard" && (isArrowRightKey(e) || isShiftKey(e))) {
        e.preventDefault();
        e.stopImmediatePropagation();
      }
      return;
    }
    const arrow = isArrowRightKey(e);
    const shift = isShiftKey(e);
    if (!arrow && !shift) return;
    if (arrow) arrowHeld = true;
    // 组合键成立的两种顺序：→ 按下时 Shift 已按住；Shift 按下时 → 仍按住
    if (arrow ? !e.shiftKey : !arrowHeld) return;
    if (isEditable(e.target)) return; // 正在输入文本时不劫持

    const video = findPlayingVideo();
    if (!video) return; // 无播放中的视频，按键原样放行

    e.preventDefault();
    e.stopImmediatePropagation();

    const r = videoRect(video);
    active = {
      id: "keyboard",
      source: "keyboard",
      video: video,
      originalRate: video.playbackRate,
      timer: null,
      rateTimer: null,
      startX: r.left + r.width / 2,
      startY: Math.max(r.top + 60, 30),
      speedMode: false,
    };
    activate(active); // 键盘组合键即按即加速，无需长按判定延时
  }

  function onKeyUp(e) {
    if (isArrowRightKey(e)) arrowHeld = false;
    const at = active;
    if (!at || at.source !== "keyboard") return;
    // Shift 或 方向右 任一松开即恢复原速
    if (isArrowRightKey(e) || isShiftKey(e)) {
      e.preventDefault();
      e.stopImmediatePropagation();
      clearActive();
    }
  }

  /* ---------- 注册监听（capture 阶段，确保先于网站处理） ---------- */
  document.addEventListener("keydown", onKeyDown, true);
  document.addEventListener("keyup", onKeyUp, true);
  document.addEventListener("pointerdown", onPointerDown, { passive: true, capture: true });
  document.addEventListener("pointermove", onPointerMove, { passive: true, capture: true });
  document.addEventListener("pointerup", onPointerEnd, { passive: false, capture: true });
  document.addEventListener("pointercancel", onPointerEnd, { passive: false, capture: true });
  document.addEventListener("touchstart", onTouchStart, { passive: true, capture: true });
  document.addEventListener("touchmove", onTouchMove, { passive: true, capture: true });
  document.addEventListener("touchend", onTouchEnd, { passive: false, capture: true });
  document.addEventListener("touchcancel", onTouchEnd, { passive: false, capture: true });
  document.addEventListener("click", onClick, true);
  document.addEventListener("contextmenu", onContextMenu, true);

  // 页面失焦/切后台时保险性恢复（同时清掉按键状态，避免残留误触发）
  window.addEventListener("blur", function () { arrowHeld = false; if (active) clearActive(); });
  document.addEventListener("visibilitychange", function () {
    if (document.hidden) { arrowHeld = false; if (active) clearActive(); }
  });

  /* ---------- 脚本菜单（篡改猴菜单中显示；仅顶层注册，避免每个 iframe 重复一条） ---------- */
  function fmtRate(v) { return Number(v).toFixed(2).replace(/\.?0+$/, "") + "x"; }

  let menuIds = [];
  function registerMenu() {
    if (!isTop) return;
    // 老版本篡改猴没有注销 API 时只注册一次，避免产生重复菜单项
    const canRefresh = typeof GM_unregisterMenuCommand === "function";
    if (menuIds.length && !canRefresh) return;
    try {
      while (menuIds.length && canRefresh) GM_unregisterMenuCommand(menuIds.pop());
    } catch (e) {}
    try {
      menuIds.push(GM_registerMenuCommand(
        "⏩ 长按倍速（当前 " + fmtRate(settings.speed) + "）",
        function () {
          const raw = prompt("长按倍速（1.25 ~ 16）：", settings.speed);
          if (raw === null || String(raw).trim() === "") return;
          const v = parseFloat(raw);
          if (!isFinite(v) || v < 1.25 || v > 16) { showToast("无效倍速，未修改"); return; }
          saveSettings({ speed: v });
          showToast("长按倍速已设为 " + fmtRate(v));
        }
      ));
      menuIds.push(GM_registerMenuCommand(
        "⏱ 触发延时（当前 " + settings.delay + "ms）",
        function () {
          const raw = prompt("长按触发延时（100 ~ 1000 毫秒）：", settings.delay);
          if (raw === null || String(raw).trim() === "") return;
          const v = parseInt(raw, 10);
          if (!isFinite(v) || v < 100 || v > 1000) { showToast("无效延时，未修改"); return; }
          saveSettings({ delay: v });
          showToast("触发延时已设为 " + v + "ms");
        }
      ));
      menuIds.push(GM_registerMenuCommand(
        settings.enabled ? "⏸ 停用（当前：已启用）" : "▶ 启用（当前：已停用）",
        function () {
          saveSettings({ enabled: !settings.enabled });
          showToast(settings.enabled ? "已启用长按加速" : "已停用长按加速");
        }
      ));
      menuIds.push(GM_registerMenuCommand(
        "📳 震动反馈：" + (settings.vibrate ? "开" : "关"),
        function () {
          saveSettings({ vibrate: !settings.vibrate });
          showToast(settings.vibrate ? "震动反馈已开启" : "震动反馈已关闭");
        }
      ));
      menuIds.push(GM_registerMenuCommand(
        "↩ 恢复默认设置",
        function () {
          saveSettings(Object.assign({}, DEFAULTS));
          showToast("已恢复默认设置");
        }
      ));
    } catch (e) {}
  }
  registerMenu();

  /* ---------- 首次运行：写入默认设置并提示一次 ---------- */
  try {
    if (GM_getValue(KEY, null) === null) {
      saveSettings({});
      showToast("长按加速已启用：长按视频或按住 Shift+→ 加速");
    }
  } catch (e) {}
})();
