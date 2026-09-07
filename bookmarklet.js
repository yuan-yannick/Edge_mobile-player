/*
 * 长按加速播放 - Bookmarklet 源码（可读版）
 * --------------------------------------------------------------
 * 用途：在手机 Edge 等不支持装扩展的浏览器里，把本代码压缩成一行后
 * 存为书签(收藏)，在视频页面点一下该书签即可激活“长按加速”。
 *
 * 构建方式：由 build_bookmarklet.cjs 读取本文件，去掉注释、压缩空白，
 * 再 encodeURIComponent 后拼成 javascript: URL。
 *
 * 注意：为便于安全压缩，本文件内不含正则字面量，也不在字符串里使用
 * "//"、"/*" 序列。
 */
(function () {
  if (window.__lpvs) return;
  window.__lpvs = true;

  var speed = window.__lpvs_speed || 3.0;
  var delay = window.__lpvs_delay || 350;
  var moveTol = 10;

  var active = null;
  var suppressClickUntil = 0;

  function findTouch(list, id) {
    for (var i = 0; i < list.length; i++) if (list[i].identifier === id) return list[i];
    return null;
  }

  function findVideoFor(el, x, y) {
    if (!el || !el.closest) return null;
    var direct = el.closest("video");
    if (direct) return direct;
    var node = el;
    for (var i = 0; i < 6 && node; i++, node = node.parentElement) {
      var vids = node.querySelectorAll ? node.querySelectorAll("video") : null;
      if (vids && vids.length) {
        var best = null, bestArea = 0;
        for (var j = 0; j < vids.length; j++) {
          var v = vids[j];
          var r = v.getBoundingClientRect();
          if (x >= r.left && x <= r.right && y >= r.top && y <= r.bottom) return v;
          var area = r.width * r.height;
          if (area > bestArea) { bestArea = area; best = v; }
        }
        return best;
      }
    }
    var all = document.querySelectorAll("video");
    if (all.length === 1) return all[0];
    return null;
  }

  var badge = null;
  function showBadge(rate, x, y) {
    if (!badge) {
      badge = document.createElement("div");
      badge.style.cssText =
        "position:fixed;z-index:2147483647;display:none;min-width:60px;padding:7px 12px;" +
        "font:600 14px/1 -apple-system,Segoe UI,sans-serif;color:#fff;" +
        "background:rgba(17,17,17,0.82);border-radius:18px;box-shadow:0 4px 14px rgba(0,0,0,.35);" +
        "pointer-events:none;white-space:nowrap;letter-spacing:.3px";
      document.documentElement.appendChild(badge);
    }
    badge.textContent = "fast " + Number(rate).toFixed(1) + "x";
    var w = 80, h = 34;
    var left = x - w / 2;
    var top = y - h - 16;
    if (left < 6) left = 6;
    if (left > window.innerWidth - w - 6) left = window.innerWidth - w - 6;
    if (top < 6) top = y + 20;
    badge.style.left = left + "px";
    badge.style.top = top + "px";
    badge.style.display = "block";
  }
  function hideBadge() { if (badge) badge.style.display = "none"; }

  function activate(at) {
    if (!at || !at.video) return;
    at.speedMode = true;
    at.originalRate = at.video.playbackRate;
    try { at.video.playbackRate = speed; } catch (e) {}
    at.video.addEventListener("ratechange", onRateChange);
    showBadge(speed, at.startX, at.startY);
    if (navigator.vibrate) { try { navigator.vibrate(15); } catch (e) {} }
  }

  function onRateChange(e) {
    var at = active;
    if (!at || !at.speedMode || at.video !== e.currentTarget) return;
    if (Math.abs(at.video.playbackRate - speed) > 0.01) {
      try { at.video.playbackRate = speed; } catch (er) {}
    }
  }

  function restore(at) {
    if (!at) return;
    at.speedMode = false;
    if (at.video) at.video.removeEventListener("ratechange", onRateChange);
    try { if (at.video) at.video.playbackRate = at.originalRate; } catch (e) {}
    hideBadge();
  }

  function clearActive() {
    var at = active;
    if (!at) return;
    if (at.timer) { clearTimeout(at.timer); at.timer = null; }
    if (at.speedMode) restore(at);
    active = null;
  }

  function swallowClickOnce() {
    suppressClickUntil = Date.now() + 500;
    var handler = function (e) {
      if (Date.now() < suppressClickUntil) { e.preventDefault(); e.stopPropagation(); }
      document.removeEventListener("click", handler, true);
    };
    document.addEventListener("click", handler, true);
  }

  function onTouchStart(e) {
    if (active) return;
    for (var i = 0; i < e.changedTouches.length; i++) {
      var t = e.changedTouches[i];
      var el = document.elementFromPoint(t.clientX, t.clientY);
      var video = findVideoFor(el, t.clientX, t.clientY);
      if (!video) continue;
      active = {
        id: t.identifier, video: video, originalRate: video.playbackRate,
        timer: null, startX: t.clientX, startY: t.clientY, speedMode: false
      };
      var at = active;
      at.timer = setTimeout(function () { if (active === at) activate(at); }, delay);
      break;
    }
  }

  function onTouchMove(e) {
    var at = active;
    if (!at) return;
    var t = findTouch(e.changedTouches, at.id);
    if (!t) return;
    var dx = t.clientX - at.startX, dy = t.clientY - at.startY;
    if (!at.speedMode && Math.sqrt(dx * dx + dy * dy) > moveTol) clearActive();
  }

  function onTouchEnd(e) {
    var at = active;
    if (!at) return;
    var t = findTouch(e.changedTouches, at.id);
    if (!t) return;
    if (at.timer) { clearTimeout(at.timer); at.timer = null; }
    if (at.speedMode) {
      e.preventDefault();
      swallowClickOnce();
      restore(at);
    }
    active = null;
  }

  function onContextMenu(e) {
    if (active && active.video && (e.target === active.video || active.video.contains(e.target))) {
      e.preventDefault();
    }
  }

  document.addEventListener("touchstart", onTouchStart, { passive: true, capture: true });
  document.addEventListener("touchmove", onTouchMove, { passive: true, capture: true });
  document.addEventListener("touchend", onTouchEnd, { passive: false, capture: true });
  document.addEventListener("touchcancel", onTouchEnd, { passive: false, capture: true });
  document.addEventListener("contextmenu", onContextMenu, true);
  window.addEventListener("blur", function () { if (active) clearActive(); });
  document.addEventListener("visibilitychange", function () { if (document.hidden && active) clearActive(); });

  alert("已开启长按加速:长按视频约0.35秒即以" + speed + "倍速播放,松手恢复");
})();
