"""Optional network smoke test against Douyin's current xgplayer page."""

from pathlib import Path
import tempfile

from playwright.sync_api import sync_playwright


ROOT = Path(__file__).resolve().parents[1]
VIDEO_URL = "https://www.douyin.com/video/7117200114686414094"


def install(page):
    page.evaluate(
        """
        () => {
          window.chrome = {
            storage: {
              sync: { get: (_defaults, callback) => callback({ delay: 120, vibrate: false }) },
              onChanged: { addListener: () => {} }
            }
          };
        }
        """
    )
    page.evaluate((ROOT / "content.js").read_text(encoding="utf-8"))


def largest_video(page):
    page.locator("video").first.wait_for(state="attached", timeout=60000)
    best, best_area = None, 0
    for video in page.locator("video").all():
        box = video.bounding_box()
        if box and box["width"] * box["height"] > best_area:
            best, best_area = video, box["width"] * box["height"]
    if best is None:
        raise AssertionError("Douyin did not expose a visible HTML video")
    return best


def prepare(page, inject=True):
    page.goto(VIDEO_URL, wait_until="domcontentloaded", timeout=60000)
    video = largest_video(page)
    video.evaluate("async v => { v.muted = true; try { await v.play(); } catch (_) {} }")
    if inject:
        install(page)
    return video


def desktop_extension(playwright):
    with tempfile.TemporaryDirectory(prefix="lpvs-douyin-") as profile:
        context = playwright.chromium.launch_persistent_context(
            profile,
            channel="msedge",
            headless=True,
            viewport={"width": 1280, "height": 800},
            args=[f"--disable-extensions-except={ROOT}", f"--load-extension={ROOT}"],
        )
        page = context.pages[0] if context.pages else context.new_page()
        video = prepare(page, inject=False)
        original = video.evaluate("v => v.playbackRate")
        box = video.bounding_box()
        x, y = box["x"] + box["width"] / 2, box["y"] + box["height"] / 2
        page.mouse.move(x, y)
        page.mouse.down()
        page.wait_for_timeout(500)
        assert abs(video.evaluate("v => v.playbackRate") - 3) < 0.01
        page.mouse.up()
        page.wait_for_timeout(150)
        assert abs(video.evaluate("v => v.playbackRate") - original) < 0.01
        context.close()


def mobile(browser):
    context = browser.new_context(
        viewport={"width": 390, "height": 844},
        is_mobile=True,
        has_touch=True,
        device_scale_factor=2,
    )
    page = context.new_page()
    video = prepare(page)
    original = video.evaluate("v => v.playbackRate")
    box = video.bounding_box()
    x = max(1, min(389, box["x"] + box["width"] / 2))
    y = max(1, min(843, box["y"] + box["height"] / 2))
    cdp = context.new_cdp_session(page)
    cdp.send("Input.dispatchTouchEvent", {
        "type": "touchStart", "touchPoints": [{"x": x, "y": y}],
    })
    page.wait_for_timeout(450)
    assert abs(video.evaluate("v => v.playbackRate") - 3) < 0.01
    cdp.send("Input.dispatchTouchEvent", {"type": "touchEnd", "touchPoints": []})
    page.wait_for_timeout(150)
    assert abs(video.evaluate("v => v.playbackRate") - original) < 0.01
    context.close()


with sync_playwright() as playwright:
    desktop_extension(playwright)
    print("PASS Douyin desktop extension")
    edge = playwright.chromium.launch(channel="msedge", headless=True)
    mobile(edge)
    print("PASS Douyin mobile viewport")
    edge.close()
