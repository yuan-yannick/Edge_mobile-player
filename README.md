# 长按加速播放 (Long-Press Video Speed)

在 YouTube 等网页视频上按住约 0.35 秒，临时切换到 3 倍速；松开后恢复原速。

当前保留两种实现：

- `longpress-speed.user.js`：移动端优先，安装到 Tampermonkey 等用户脚本管理器。
- Edge / Chrome 扩展：桌面端加载本仓库目录，带可视化设置面板。

书签脚本实现已经移除。它无法在刷新和 YouTube 站内跳转后持续运行，也是之前最容易造成“看似安装成功、实际失效”的入口。

## 功能

- YouTube 优先适配：可以从播放器遮罩层准确定位底层视频，并持续抵抗网站对临时倍速的覆盖。
- 手机、平板和触摸屏：手指或触控笔长按播放器加速，松开恢复。
- 桌面端：鼠标左键长按播放器，或按住 `Shift + →` 加速。
- 短按仍由网站处理；完成一次长按后会拦截紧随其后的点击，避免意外暂停。
- 手指在触发前移动超过 10px 会取消长按，不抢占原有滑动手势。
- 页面失焦、切到后台或指针被取消时自动恢复原速。
- 可设置倍速、触发延时、开关和震动反馈。

## 移动端安装（推荐）

1. 在浏览器中安装 Tampermonkey 或其他兼容的用户脚本管理器。
2. 打开[脚本直链](https://raw.githubusercontent.com/yuan-yannick/Edge_mobile-player/main/longpress-speed.user.js)，确认安装。
3. 打开 YouTube 视频并开始播放，在画面中间按住约 0.35 秒。
4. 看到 `▶▶ 3.0x` 后即已加速，松手恢复。

设置入口位于用户脚本管理器的脚本菜单中，可修改倍速（1.25–16x）、触发延时（100–1000ms）、启用状态和震动反馈。

> 移动浏览器必须支持用户脚本扩展。若浏览器本身不支持扩展，单独下载 `.user.js` 文件不会生效。

## 桌面端扩展安装

1. 下载或克隆本仓库。
2. Edge 打开 `edge://extensions`，Chrome 打开 `chrome://extensions`。
3. 开启“开发人员模式”，选择“加载解压缩的扩展”，然后选择本仓库目录。
4. 如果此前已加载旧版本，请在扩展页面点一次“重新加载”，再刷新已打开的 YouTube 页面。
5. 工具栏图标可调整启用状态、倍速、触发延时和震动反馈。

桌面端支持两种操作：

- 鼠标左键在视频画面中按住约 0.35 秒，松开恢复。
- 视频正在播放时按住 `Shift + →`，松开任一键恢复。

## YouTube 使用说明

- 长按画面区域，不要按进度条、音量或评论输入框。
- YouTube 自带的长按倍速提示可能短暂出现；本脚本会以设置中的倍速为准。
- YouTube 是单页应用，切换视频无需重新运行脚本。
- Shorts 页面存在多个视频时，会优先选择触点下方且正在播放的视频。

## 验证清单

| 操作 | 预期结果 |
|---|---|
| 鼠标/手指按住视频超过触发延时 | 显示倍速角标，`playbackRate` 变为设置值 |
| 松开 | 角标消失，恢复进入长按前的倍速，不触发暂停 |
| 触发前移动超过 10px | 取消本次长按，网页原有滑动行为不受影响 |
| 按住 `Shift + →` | 正在播放的最大可见视频立即加速 |
| 单独按 `→` | 不拦截网站原有快捷键 |
| 在评论框按组合键 | 不拦截文本输入 |
| 切换窗口或标签页 | 自动恢复原速 |
| YouTube 尝试改回 1x/2x | 长按期间重新校正到设置值 |

## 项目结构

| 文件 | 作用 |
|---|---|
| `longpress-speed.user.js` | Tampermonkey/用户脚本版，移动端推荐入口 |
| `manifest.json` | Chromium Manifest V3 扩展清单 |
| `content.js` / `content.css` | 扩展交互逻辑与样式 |
| `background.js` | 初始化扩展默认设置 |
| `popup.html` / `popup.css` / `popup.js` | 扩展设置面板 |
| `icons/` | 扩展图标 |

## 开发验证

需要 Python 3、Playwright 和本机 Microsoft Edge：

```powershell
python -m pip install playwright
$env:LPVS_TEST_PORT = "8877"
python -m http.server $env:LPVS_TEST_PORT --bind 127.0.0.1
```

保持上面的本地服务器运行，在另一个终端执行：

```powershell
$env:LPVS_TEST_PORT = "8877"
python tests/test_interactions.py
python tests/test_extension_load.py
python tests/test_youtube_live.py
```

前两项是稳定的本地交互与扩展加载测试；最后一项访问真实 YouTube，适合在发布前做网络烟雾测试。

## 常见问题

**安装后完全没反应**

确认脚本/扩展已启用，然后刷新 YouTube 页面。扩展刚加载或刚重新加载时，已经打开的网页不会自动获得新的内容脚本。

**移动端没反应**

确认浏览器支持并启用了用户脚本管理器，且 `longpress-speed.user.js` 在当前网址上处于启用状态。移动端不能直接加载桌面 Chromium 的解压扩展目录。

**倍速出现后立即消失**

先更新到 1.3.0，再确认没有同时安装旧版脚本和扩展。两个实例同时运行会互相恢复倍速。

**键盘组合键没反应**

组合键只选择正在播放且可见的视频；先开始播放，并让焦点离开搜索框或评论框。

## 许可

MIT
