/*
 * 长按加速播放 - 内容脚本
 * --------------------------------------------------------------
 * 在任意网页的 <video> 上长按屏幕（默认 350ms）即临时加速播放，
 * 松手自动恢复原速。普通点击、滑动、视频自带控制条均不受影响。
 * 电脑端可按住 Shift+方向右 实现同样的临时加速，松开任一键恢复。
 *
 * 设计要点：
 *  - 只在 touchstart 时启动一个长按计时器，未触发前不拦截任何事件，
 *    因此短按(暂停/播放)、滑动(进度/音量)仍由网站自己处理。
 *  - 电脑端键盘：按住 Shift+方向右 立即加速，松开任一键恢复；
 *    仅当页面存在“播放中”的视频时才拦截该组合键，其余场景原样放行。
 *  - 计时器触发后进入“加速模式”，设置 playbackRate 并显示角标。
 *  - 进入加速模式后吞掉松手时产生的 click，避免误触暂停。
 *  - 监听 ratechange 以抵抗部分网站(如 YouTube)对倍速的重置。
 *  - 阻止视频上的长按上下文菜单，避免弹出“保存图片/复制”等菜单。
 */

(function () {
  "use strict";

  // 默认设置（与 background.js / popup.js 保持一致）
  const DEFAULTS = {
    enabled: true,
    speed: 3.0,
    delay: 350,
    moveTolerance: 10,
    vibrate: true,
  };

  let settings = Object.assign({}, DEFAULTS);

  // 当前正在追踪的触摸 / 键盘组合键会话
  // { id, source: "touch"|"keyboard", video, originalRate, timer, startX, startY, speedMode }
  let active = null;

  // 用于在松手后吞掉一次 click 的时间窗
  let suppressClickUntil = 0;

  /* ---------- 设置加载 ---------- */
  function loadSettings() {
    try {
      chrome.storage.sync.get(DEFAULTS, function (s) {
        settings = Object.assign({}, DEFAULTS, s);
      });
    } catch (e) {
      // 非扩展环境(如 bookmarklet 复用)下退化为默认值
      settings = Object.assign({}, DEFAULTS);
    }
  }
  loadSettings();

  try {
    chrome.storage.onChanged.addListener(function (changes, area) {
      if (area !== "sync") return;
      for (const k in changes) settings[k] = changes[k].newValue;
      // 若正在加速且倍速被改了，实时更新
      if (active && active.speedMode) {
        try { active.video.playbackRate = settings.speed; } catch (_) {}
        updateBadge(settings.speed);
      }
    });
  } catch (e) { /* 非扩展环境忽略 */ }

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
})();
