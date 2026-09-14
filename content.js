/*
 * 长按加速播放 - 浏览器扩展内容脚本
 *
 * 移动端/触摸屏：按住播放器临时加速，松开恢复。
 * 桌面端：鼠标左键按住播放器，或按住 Shift + → 临时加速。
 */

(function () {
  "use strict";

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

  let settings = Object.assign({}, DEFAULTS);
  let active = null;
  let badge = null;
  let suppressClickUntil = 0;
  let arrowHeld = false;

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
    try {
      chrome.storage.sync.get(DEFAULTS, function (value) {
        settings = normalizedSettings(value);
      });
    } catch (_) {
      settings = normalizedSettings();
    }
  }

  loadSettings();

  try {
    chrome.storage.onChanged.addListener(function (changes, area) {
      if (area !== "sync") return;
      const patch = {};
      for (const key in changes) patch[key] = changes[key].newValue;
      settings = normalizedSettings(Object.assign({}, settings, patch));
      if (!settings.enabled) {
        clearActive();
      } else if (active && active.speedMode) {
        applyTargetRate(active);
        updateBadge(settings.speed);
      }
    });
  } catch (_) {}

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
    if (player) return Array.from(player.querySelectorAll("video"));
    return [];
  }

  // YouTube 的可点击层是 video 的兄弟节点，并非 video 的父/子节点。
  // 因此同时使用事件路径、播放器容器和触点矩形来定位真正的视频。
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
      const rect = videoRect(video);
      if (pointInside(rect, x, y)) candidates.add(video);
    }

    let best = null;
    let bestScore = -Infinity;
    for (const video of candidates) {
      const rect = videoRect(video);
      if (!rect || rect.width < 2 || rect.height < 2) continue;
      const underPointer = pointInside(rect, x, y);
      const visible = isVisibleVideo(video);
      const score = (underPointer ? 1e12 : 0) + (!video.paused && !video.ended ? 1e9 : 0) +
        (visible ? 1e6 : 0) + Math.min(rect.width * rect.height, 999999);
      if (score > bestScore) {
        best = video;
        bestScore = score;
      }
    }

    // 普通网页常常只有一个视频，而事件目标是覆盖在它上方的自定义控制层。
    if (!best) {
      const all = Array.from(document.querySelectorAll("video")).filter(isVisibleVideo);
      if (all.length === 1 && pointInside(videoRect(all[0]), x, y)) best = all[0];
    }
    return best;
  }

  function findPlayingVideo() {
    let best = null;
    let bestArea = 0;
    for (const video of document.querySelectorAll("video")) {
      if (video.paused || video.ended || !isVisibleVideo(video)) continue;
      const rect = videoRect(video);
      const area = rect.width * rect.height;
      if (area > bestArea) {
        best = video;
        bestArea = area;
      }
    }
    return best;
  }

  function ensureBadge() {
    if (badge && badge.isConnected) return badge;
    badge = document.createElement("div");
    badge.className = "lpvs-badge";
    badge.style.display = "none";
    document.documentElement.appendChild(badge);
    return badge;
  }

  function showBadge(rate, x, y) {
    const element = ensureBadge();
    element.textContent = "▶▶ " + Number(rate).toFixed(1) + "x";
    const width = 92;
    const height = 34;
    let left = x - width / 2;
    let top = y - height - 16;
    left = Math.max(6, Math.min(left, innerWidth - width - 6));
    if (top < 6) top = y + 20;
    element.style.left = left + "px";
    element.style.top = top + "px";
    element.style.display = "block";
  }

  function updateBadge(rate) {
    if (badge) badge.textContent = "▶▶ " + Number(rate).toFixed(1) + "x";
  }

  function hideBadge() {
    if (badge) badge.style.display = "none";
  }

  function applyTargetRate(session) {
    if (!session || !session.speedMode || !session.video || !session.video.isConnected) return;
    if (Math.abs(session.video.playbackRate - settings.speed) > RATE_EPSILON) {
      try { session.video.playbackRate = settings.speed; } catch (_) {}
    }
  }

  function onRateChange(event) {
    if (!active || active.video !== event.currentTarget || !active.speedMode) return;
    applyTargetRate(active);
  }

  function activate(session) {
    if (!session || session !== active || !session.video || !session.video.isConnected) {
      clearActive();
      return;
    }
    session.timer = null;
    session.speedMode = true;
    session.originalRate = session.video.playbackRate;
    session.video.addEventListener("ratechange", onRateChange);
    applyTargetRate(session);
    // YouTube 会在自己的长按逻辑中反复写 playbackRate；定时校正可避免被覆盖。
    session.rateTimer = setInterval(function () { applyTargetRate(session); }, RATE_RECHECK_MS);
    showBadge(settings.speed, session.startX, session.startY);
    if (settings.vibrate && navigator.vibrate) {
      try { navigator.vibrate(15); } catch (_) {}
    }
  }

  function restore(session) {
    if (!session) return;
    session.speedMode = false;
    if (session.rateTimer) {
      clearInterval(session.rateTimer);
      session.rateTimer = null;
    }
    if (session.video) session.video.removeEventListener("ratechange", onRateChange);
    try {
      if (session.video && session.video.isConnected) session.video.playbackRate = session.originalRate;
    } catch (_) {}
    hideBadge();
  }

  function clearActive(options) {
    const session = active;
    if (!session) return;
    if (session.timer) clearTimeout(session.timer);
    if (session.speedMode) {
      if (options && options.suppressClick) suppressClickUntil = Date.now() + CLICK_SUPPRESS_MS;
      restore(session);
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
    const session = active;
    session.timer = setTimeout(function () { activate(session); }, settings.delay);
  }

  function onPointerDown(event) {
    if (!settings.enabled || active || !event.isPrimary || event.button !== 0) return;
    if (event.pointerType === "mouse" && isEditable(event.target)) return;
    const video = findVideoForEvent(event, event.clientX, event.clientY);
    if (!video) return;
    beginPress("pointer", event.pointerId, video, event.clientX, event.clientY);
  }

  function onPointerMove(event) {
    const session = active;
    if (!session || session.source !== "pointer" || session.id !== event.pointerId) return;
    if (event.pointerType === "mouse" && !(event.buttons & 1)) {
      clearActive();
      return;
    }
    if (!session.speedMode && Math.hypot(event.clientX - session.startX, event.clientY - session.startY) > settings.moveTolerance) {
      clearActive();
    }
  }

  function onPointerEnd(event) {
    const session = active;
    if (!session || session.source !== "pointer" || session.id !== event.pointerId) return;
    if (event.type === "pointerup" && event.pointerType === "mouse" && event.button !== 0) return;
    const wasActive = session.speedMode;
    clearActive({ suppressClick: wasActive });
    if (wasActive && event.cancelable) event.preventDefault();
  }

  // Pointer Events 不可用时给旧版移动浏览器保留 Touch Events 回退。
  function findTouch(list, id) {
    for (let i = 0; i < list.length; i++) if (list[i].identifier === id) return list[i];
    return null;
  }

  function onTouchStart(event) {
    if (window.PointerEvent || !settings.enabled || active) return;
    for (const touch of event.changedTouches) {
      const video = findVideoForEvent(event, touch.clientX, touch.clientY);
      if (!video) continue;
      beginPress("touch", touch.identifier, video, touch.clientX, touch.clientY);
      break;
    }
  }

  function onTouchMove(event) {
    const session = active;
    if (!session || session.source !== "touch") return;
    const touch = findTouch(event.touches, session.id) || findTouch(event.changedTouches, session.id);
    if (!touch) return;
    if (!session.speedMode && Math.hypot(touch.clientX - session.startX, touch.clientY - session.startY) > settings.moveTolerance) {
      clearActive();
    }
  }

  function onTouchEnd(event) {
    const session = active;
    if (!session || session.source !== "touch" || !findTouch(event.changedTouches, session.id)) return;
    const wasActive = session.speedMode;
    clearActive({ suppressClick: wasActive });
    if (wasActive && event.cancelable) event.preventDefault();
  }

  function onClick(event) {
    if (Date.now() >= suppressClickUntil) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    suppressClickUntil = 0;
  }

  function onContextMenu(event) {
    if (!active || !active.video) return;
    const rect = videoRect(active.video);
    if (active.speedMode || pointInside(rect, event.clientX, event.clientY)) {
      event.preventDefault();
      event.stopImmediatePropagation();
    }
  }

  function isArrowRightKey(event) {
    return event.key === "ArrowRight" || event.code === "ArrowRight" || event.keyCode === 39;
  }

  function isShiftKey(event) {
    return event.key === "Shift" || event.code === "ShiftLeft" ||
      event.code === "ShiftRight" || event.keyCode === 16;
  }

  function onKeyDown(event) {
    const arrow = isArrowRightKey(event);
    const shift = isShiftKey(event);
    if (!arrow && !shift) return;
    if (arrow) arrowHeld = true;
    if (!settings.enabled || (arrow ? !event.shiftKey : !arrowHeld)) return;
    if (isEditable(event.target)) return;

    if (active) {
      if (active.source === "keyboard") {
        event.preventDefault();
        event.stopImmediatePropagation();
      }
      return;
    }

    const video = findPlayingVideo();
    if (!video) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    const rect = videoRect(video);
    active = {
      source: "keyboard",
      id: "keyboard",
      video: video,
      originalRate: video.playbackRate,
      timer: null,
      rateTimer: null,
      startX: rect.left + rect.width / 2,
      startY: Math.max(rect.top + 60, 30),
      speedMode: false,
    };
    activate(active);
  }

  function onKeyUp(event) {
    if (isArrowRightKey(event)) arrowHeld = false;
    if (!active || active.source !== "keyboard") return;
    if (isArrowRightKey(event) || isShiftKey(event)) {
      event.preventDefault();
      event.stopImmediatePropagation();
      clearActive();
    }
  }

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

  window.addEventListener("blur", function () {
    arrowHeld = false;
    clearActive();
  });
  document.addEventListener("visibilitychange", function () {
    if (!document.hidden) return;
    arrowHeld = false;
    clearActive();
  });
})();
