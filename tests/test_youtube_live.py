"""Optional network smoke test against the current YouTube player."""

from pathlib import Path

from playwright.sync_api import sync_playwright


ROOT = Path(__file__).resolve().parents[1]
VIDEO_URL = "https://www.youtube.com/watch?v=jNQXAC9IVRw"


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
    # YouTube enforces Trusted Types for <script>; direct protocol evaluation mirrors
    # a content-script injection without violating the page's script-element policy.
    page.evaluate((ROOT / "content.js").read_text(encoding="utf-8"))


def prepare_video(page):
    page.goto(VIDEO_URL, wait_until="domcontentloaded", timeout=60000)
    video = page.locator("video").first
    video.wait_for(state="visible", timeout=60000)
    video.evaluate(
        """
        async video => {
          video.muted = true;
          try { await video.play(); } catch (_) {}
        }
        """
    )
    install(page)
    return video


def desktop(browser):
    page = browser.new_page(viewport={"width": 1280, "height": 800})
    video = prepare_video(page)
    box = video.bounding_box()
    x, y = box["x"] + box["width"] / 2, box["y"] + box["height"] / 2
    page.mouse.move(x, y)
    page.mouse.down()
    page.wait_for_timeout(450)
    assert abs(video.evaluate("v => v.playbackRate") - 3) < 0.01
    page.mouse.up()
    page.wait_for_timeout(100)
    assert abs(video.evaluate("v => v.playbackRate") - 1) < 0.01
    page.close()


def mobile(browser):
    context = browser.new_context(
        viewport={"width": 390, "height": 844},
        is_mobile=True,
        has_touch=True,
        device_scale_factor=2,
    )
    page = context.new_page()
    video = prepare_video(page)
    box = video.bounding_box()
    x, y = box["x"] + box["width"] / 2, box["y"] + box["height"] / 2
    cdp = context.new_cdp_session(page)
    cdp.send("Input.dispatchTouchEvent", {
        "type": "touchStart",
        "touchPoints": [{"x": x, "y": y}],
    })
    page.wait_for_timeout(450)
    assert abs(video.evaluate("v => v.playbackRate") - 3) < 0.01
    cdp.send("Input.dispatchTouchEvent", {"type": "touchEnd", "touchPoints": []})
    page.wait_for_timeout(100)
    assert abs(video.evaluate("v => v.playbackRate") - 1) < 0.01
    context.close()


with sync_playwright() as playwright:
    edge = playwright.chromium.launch(channel="msedge", headless=True)
    desktop(edge)
    print("PASS YouTube desktop")
    mobile(edge)
    print("PASS YouTube mobile viewport")
    edge.close()
