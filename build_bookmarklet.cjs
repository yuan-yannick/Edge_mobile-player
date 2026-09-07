/*
 * 构建脚本：把 bookmarklet.js 压缩成一行，编码为 javascript: URL，
 * 并生成 bookmarklet.url.txt / bookmarklet.min.js / bookmarklet.html
 *
 * 用法： node build_bookmarklet.cjs
 */
"use strict";

const fs = require("fs");
const path = require("path");

const src = fs.readFileSync(path.join(__dirname, "bookmarklet.js"), "utf8");

// 1) 去掉块注释 /* ... */
let code = src.replace(/\/\*[\s\S]*?\*\//g, "");
// 2) 去掉行注释 //...（本源码中无，但保留以保安全；源码中字符串不含 // 故安全）
code = code.replace(/\/\/[^\n]*/g, "");
// 3) 折叠所有空白为单个空格并去首尾
code = code.replace(/\s+/g, " ").trim();

const url = "javascript:" + encodeURIComponent(code);

fs.writeFileSync(path.join(__dirname, "bookmarklet.min.js"), code, "utf8");
fs.writeFileSync(path.join(__dirname, "bookmarklet.url.txt"), url, "utf8");

const html = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>长按加速播放 - Bookmarklet 安装</title>
<style>
  body { font: 16px/1.7 -apple-system, "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif; max-width: 680px; margin: 40px auto; padding: 0 18px; color: #222; }
  h1 { font-size: 20px; }
  .install { margin: 22px 0; padding: 26px; text-align: center; background: #f3f6fb; border: 1px dashed #9bb8e6; border-radius: 12px; }
  .install a { display: inline-block; padding: 14px 26px; background: #2563eb; color: #fff; text-decoration: none; border-radius: 8px; font-size: 17px; font-weight: 600; -webkit-touch-callout: none; user-select: none; }
  .install a:active { background: #1d4ed8; }
  code, pre { background: #f4f4f5; padding: 2px 6px; border-radius: 4px; font-size: 13px; }
  pre { padding: 12px; overflow:auto; }
  ol { padding-left: 22px; }
  li { margin: 8px 0; }
  .tip { color: #666; font-size: 14px; }
</style>
</head>
<body>
  <h1>长按加速播放 · Bookmarklet</h1>
  <p class="tip">手机 Edge / 手机 Chrome 等无法装扩展的浏览器可用此法：在视频页面点一下书签即激活“长按加速”。</p>

  <div class="install">
    <p style="margin-top:0">把下面这个按钮<b>长按拖到收藏夹/书签栏</b>，或在手机上“添加到收藏”：</p>
    <a href="${url}">▶▶ 长按加速播放</a>
    <p style="font-size:13px;color:#666;margin-bottom:0">点击它不会跳转，它是一段脚本书签。</p>
  </div>

  <h3>手机 Edge 安装步骤</h3>
  <ol>
    <li>在手机 Edge 里打开本页面（或任意可访问此 <code>bookmarklet.html</code> 的地址）。</li>
    <li>长按上面那个蓝色按钮 → 选择“添加到收藏”/“添加到收藏夹”。（不同版本菜单文字略有差异）</li>
    <li>打开任意视频网页（B 站、YouTube、网页内嵌视频等），开始正常播放。</li>
    <li>调出 Edge 菜单 → “收藏”，点一下刚刚保存的“长按加速播放”书签。</li>
    <li>页面弹出“已开启长按加速”提示后，长按视频约 0.35 秒即可 3 倍速播放，松手恢复原速。</li>
  </ol>

  <h3>桌面浏览器</h3>
  <p>直接把蓝色按钮拖到书签栏，然后在视频页面点击即可。</p>

  <h3>修改倍速</h3>
  <p>如需改倍速，编辑 <code>bookmarklet.js</code> 顶部的 <code>__lpvs_speed</code> 或在书签 URL 最前面加上 <code>javascript:void(window.__lpvs_speed=2.5);</code> 再接原代码——更简单的做法是直接改 <code>bookmarklet.js</code> 里的 <code>var speed = ...</code>，再运行 <code>node build_bookmarklet.cjs</code> 重新生成。</p>

  <h3>原始 URL（手动复制用）</h3>
  <pre>${url.replace(/</g, "&lt;")}</pre>
</body>
</html>
`;

fs.writeFileSync(path.join(__dirname, "bookmarklet.html"), html, "utf8");

console.log("bookmarklet 构建完成:");
console.log("  代码长度:", code.length, "字符");
console.log("  URL  长度:", url.length, "字符");
console.log("  已写出: bookmarklet.min.js / bookmarklet.url.txt / bookmarklet.html");
