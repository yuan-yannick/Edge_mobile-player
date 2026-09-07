// ==UserScript==
// @name         长按加速播放
// @name:en      Long-Press Video Speed
// @namespace    lpvs.longpress.speed
// @version      1.1.0
// @description  移动端长按网页视频约0.35秒即临时加速播放(默认3倍速)，松手恢复原速；电脑端按住 Shift+方向右 加速，松开任一键恢复。配合篡改猴使用，手机 Edge / Firefox / 桌面浏览器均可用。
// @description:en  Long-press any web video to fast-forward temporarily (default 3x); release to restore. Mobile-first, works wherever Tampermonkey runs.
// @author       lpvs
// @match        *://*/*
// @run-at       document-idle
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_registerMenuCommand
// @grant        GM_unregisterMenuCommand
// @grant        GM_addValueChangeListener
// @license      MIT
// ==/UserScript==

(function () {
  "use strict";

  /*
   * 长按加速播放 - 篡改猴(Tampermonkey)脚本版
   * --------------------------------------------------------------
   * 逻辑与扩展版 content.js 完全一致：
   *  - 长按视频(默认 350ms)临时加速，松手恢复原速；
   *  - 电脑端按住 Shift+方向右 立即加速，松开任一键恢复；
   *  - 短按(暂停/播放)、滑动(进度/音量)等原生手势不受影响；
   *  - 监听 ratechange 抵抗部分网站(如 YouTube)对倍速的重置；
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
    if (window.__lpvs) return; // 已有实例(书签版等)在运行，避免重复注入
    window.__lpvs = true;
  } catch (e) {}

  // 默认设置（与 content.js / background.js / popup.js 保持一致）
  const DEFAULTS = {
    enabled: true,
    speed: 3.0,
    delay: 350,
    moveTolerance: 10,
    vibrate: true,
  };

  const KEY = "settings";

  const isTop = (function () {
    try { return window.top === window.self; } catch (e) { return false; }
  })();

  // 当前正在追踪的触摸 / 键盘组合键会话
  // { id, source: "touch"|"keyboard", video, originalRate, timer, startX, startY, speedMode }
  let active = null;

  // 用于在松手后吞掉一次 click 的时间窗
  let suppressClickUntil = 0;

  /* ---------- 设置读写（GM 存储） ---------- */
  let settings = Object.assign({}, DEFAULTS);

  function loadSettings() {
    let s = null;
    try { s = GM_getValue(KEY, null); } catch (e) { s = null; }
    if (s && typeof s === "object") settings = Object.assign({}, DEFAULTS, s);
  }

  function saveSettings(patch) {
    settings = Object.assign({}, settings, patch);
    try { GM_setValue(KEY, settings); } catch (e) {}
  }

  loadSettings();

  try {
    if (typeof GM_addValueChangeListener === "function") {
      GM_addValueChangeListener(KEY, function (name, oldVal, newVal, remote) {
        if (!newVal || typeof newVal !== "object") return;
        settings = Object.assign({}, DEFAULTS, newVal);
        // 若正在加速且倍速被改了，实时更新
        if (active && active.speedMode) {
          try { active.video.playbackRate = settings.speed; } catch (_) {}
          updateBadge(settings.speed);
          if (!settings.enabled) clearActive();
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
  function findTouch(list, id) {
    for (let i = 0; i < list.length; i++) if (list[i].identifier === id) return list[i];
    return null;
  }

  // 根据触摸点找到对应的 <video>。
  // 优先命中视频本身；其次向上找包含视频的播放器容器；最后页面只有一个视频时直接用。
  function findVideoFor(el, x, y) {
    if (!el || !el.closest) return null;
    const direct = el.closest("video");
    if (direct) return direct;

    let node = el;
    for (let i = 0; i < 6 && node; i++, node = node.parentElement) {
      const vids = node.querySelectorAll ? node.querySelectorAll("video") : null;
      if (vids && vids.length) {
        let best = null, bestArea = 0;
        for (const v of vids) {
          const r = v.getBoundingClientRect();
          if (x >= r.left && x <= r.right && y >= r.top && y <= r.bottom) return v;
          const area = r.width * r.height;
          if (area > bestArea) { bestArea = area; best = v; }
        }
        return best;
      }
    }
    const all = document.querySelectorAll("video");
    if (all.length === 1) return all[0];
    return null;
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
  function activate(at) {
    if (!at || !at.video) return;
    at.speedMode = true;
    at.originalRate = at.video.playbackRate;
    try { at.video.playbackRate = settings.speed; } catch (_) {}
    at.video.addEventListener("ratechange", onRateChange);
    showBadge(settings.speed, at.startX, at.startY);
    if (settings.vibrate && navigator.vibrate) {
      try { navigator.vibrate(15); } catch (_) {}
    }
  }

  function onRateChange(e) {
    const at = active;
    if (!at || !at.speedMode || at.video !== e.currentTarget) return;
    // 倍速被网站改回去了，重新设回目标倍速
    if (Math.abs(at.video.playbackRate - settings.speed) > 0.01) {
      try { at.video.playbackRate = settings.speed; } catch (_) {}
    }
  }

  function restore(at) {
    if (!at) return;
    at.speedMode = false;
    if (at.video) at.video.removeEventListener("ratechange", onRateChange);
    try { if (at.video) at.video.playbackRate = at.originalRate; } catch (_) {}
    hideBadge();
  }

  function clearActive() {
    const at = active;
    if (!at) return;
    if (at.timer) { clearTimeout(at.timer); at.timer = null; }
    if (at.speedMode) restore(at);
    active = null;
  }

  /* ---------- 吞掉松手后的 click ---------- */
  function swallowClickOnce() {
    suppressClickUntil = Date.now() + 500;
    const handler = function (e) {
      if (Date.now() < suppressClickUntil) {
        e.preventDefault();
        e.stopPropagation();
      }
      document.removeEventListener("click", handler, true);
    };
    document.addEventListener("click", handler, true);
  }

  /* ---------- 触摸事件 ---------- */
  function onTouchStart(e) {
    if (!settings.enabled) return;
    if (active) return; // 已有一个手指在追踪中

    for (let i = 0; i < e.changedTouches.length; i++) {
      const t = e.changedTouches[i];
      const el = document.elementFromPoint(t.clientX, t.clientY);
      const video = findVideoFor(el, t.clientX, t.clientY);
      if (!video) continue;

      active = {
        id: t.identifier,
        source: "touch",
        video: video,
        originalRate: video.playbackRate,
        timer: null,
        startX: t.clientX,
        startY: t.clientY,
        speedMode: false,
      };
      const at = active;
      at.timer = setTimeout(function () {
        if (active === at) activate(at);
      }, settings.delay);
      break;
    }
  }

  function onTouchMove(e) {
    const at = active;
    if (!at) return;
    const t = findTouch(e.changedTouches, at.id);
    if (!t) return;
    const dx = t.clientX - at.startX;
    const dy = t.clientY - at.startY;
    // 还没进入加速模式时，移动超过阈值视为滑动 -> 取消
    if (!at.speedMode && Math.hypot(dx, dy) > settings.moveTolerance) {
      clearActive();
    }
    // 已进入加速模式：允许手指小幅移动，保持加速
  }

  function onTouchEnd(e) {
    const at = active;
    if (!at) return;
    const t = findTouch(e.changedTouches, at.id);
    if (!t) return;
    if (at.timer) { clearTimeout(at.timer); at.timer = null; }
    if (at.speedMode) {
      e.preventDefault();          // 阻止默认行为
      swallowClickOnce();          // 吞掉随后产生的 click，避免误暂停
      restore(at);
    }
    active = null;
  }

  function onContextMenu(e) {
    // 长按视频时屏蔽原生“保存/复制”菜单
    if (active && active.video && (e.target === active.video || active.video.contains(e.target))) {
      e.preventDefault();
    }
  }

  /* ---------- 键盘加速：电脑端按住 Shift+方向右，松开任一键恢复 ---------- */

  // 找当前播放中的最大视频；没有播放中的视频时不劫持按键（原行为放行）
  function findPlayingVideo() {
    const all = document.querySelectorAll("video");
    let best = null, bestArea = 0;
    for (const v of all) {
      if (v.paused || v.ended) continue;
      const r = v.getBoundingClientRect();
      const area = r.width * r.height;
      if (area > bestArea) { bestArea = area; best = v; }
    }
    return best;
  }

  function isEditable(t) {
    if (!t) return false;
    return t.tagName === "INPUT" || t.tagName === "TEXTAREA" ||
           t.tagName === "SELECT" || t.isContentEditable === true;
  }

  function onKeyDown(e) {
    if (!settings.enabled) return;
    const at = active;
    if (at) {
      // 加速期间吞掉组合键的自动重复等事件，避免网站同时响应
      if (at.source === "keyboard" && (e.key === "ArrowRight" || e.key === "Shift")) {
        e.preventDefault();
        e.stopPropagation();
      }
      return;
    }
    if (e.key !== "ArrowRight" || !e.shiftKey) return;
    if (isEditable(e.target)) return; // 正在输入文本时不劫持

    const video = findPlayingVideo();
    if (!video) return; // 无播放中的视频，按键原样放行

    e.preventDefault();
    e.stopPropagation();

    const r = video.getBoundingClientRect();
    active = {
      id: "keyboard",
      source: "keyboard",
      video: video,
      originalRate: video.playbackRate,
      timer: null,
      startX: r.left + r.width / 2,
      startY: Math.max(r.top + 60, 30),
      speedMode: false,
    };
    activate(active); // 键盘组合键即按即加速，无需长按判定延时
  }

  function onKeyUp(e) {
    const at = active;
    if (!at || at.source !== "keyboard") return;
    // Shift 或 方向右 任一松开即恢复原速
    if (e.key === "Shift" || e.key === "ArrowRight") {
      e.preventDefault();
      e.stopPropagation();
      clearActive();
    }
  }

  /* ---------- 注册监听（capture 阶段，确保先于网站处理） ---------- */
  document.addEventListener("keydown", onKeyDown, true);
  document.addEventListener("keyup", onKeyUp, true);
  document.addEventListener("touchstart", onTouchStart, { passive: true, capture: true });
  document.addEventListener("touchmove", onTouchMove, { passive: true, capture: true });
  document.addEventListener("touchend", onTouchEnd, { passive: false, capture: true });
  document.addEventListener("touchcancel", onTouchEnd, { passive: false, capture: true });
  document.addEventListener("contextmenu", onContextMenu, true);

  // 页面失焦/切后台时保险性恢复
  window.addEventListener("blur", function () { if (active) clearActive(); });
  document.addEventListener("visibilitychange", function () {
    if (document.hidden && active) clearActive();
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
