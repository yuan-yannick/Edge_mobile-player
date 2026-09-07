/* 长按加速播放 - 设置面板逻辑 */

const DEFAULTS = {
  enabled: true,
  speed: 3.0,
  delay: 350,
  moveTolerance: 10,
  vibrate: true,
};

const $ = (id) => document.getElementById(id);
const enabled = $("enabled");
const speed = $("speed");
const delay = $("delay");
const vibrate = $("vibrate");
const speedVal = $("speedVal");
const delayVal = $("delayVal");
const tip = $("tip");

function render(s) {
  enabled.checked = !!s.enabled;
  speed.value = s.speed;
  delay.value = s.delay;
  vibrate.checked = !!s.vibrate;
  speedVal.textContent = Number(s.speed).toFixed(2).replace(/\.?0+$/, "") + "x";
  delayVal.textContent = s.delay + "ms";
}

let tipTimer = null;
function flash(msg) {
  tip.textContent = msg;
  if (tipTimer) clearTimeout(tipTimer);
  tipTimer = setTimeout(() => (tip.textContent = ""), 1200);
}

function save(patch) {
  chrome.storage.sync.set(patch, () => flash("已保存"));
}

// 加载当前设置
chrome.storage.sync.get(DEFAULTS, (s) => render(Object.assign({}, DEFAULTS, s)));

// 实时保存
enabled.addEventListener("change", () => save({ enabled: enabled.checked }));
vibrate.addEventListener("change", () => save({ vibrate: vibrate.checked }));

speed.addEventListener("input", () => {
  speedVal.textContent = Number(speed.value).toFixed(2).replace(/\.?0+$/, "") + "x";
});
speed.addEventListener("change", () => save({ speed: Number(speed.value) }));

delay.addEventListener("input", () => {
  delayVal.textContent = delay.value + "ms";
});
delay.addEventListener("change", () => save({ delay: Number(delay.value) }));

// “使用说明”打开仓库内 README（如无则给出提示）
$("howto").addEventListener("click", (e) => {
  e.preventDefault();
  flash("请查看目录下 README.md");
});
