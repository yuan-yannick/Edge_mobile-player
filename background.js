/* 长按加速播放 - 后台 Service Worker */

const DEFAULTS = {
  enabled: true,
  speed: 3.0,
  delay: 350,
  moveTolerance: 10,
  vibrate: true,
};

// 安装/更新时补全缺失的默认设置（不覆盖用户已有值）
chrome.runtime.onInstalled.addListener(() => {
  chrome.storage.sync.get(Object.keys(DEFAULTS), (cur) => {
    const toSet = {};
    for (const k in DEFAULTS) {
      if (!(k in cur)) toSet[k] = DEFAULTS[k];
    }
    if (Object.keys(toSet).length) chrome.storage.sync.set(toSet);
  });
});
