import json
import os
import sys
from pathlib import Path

from playwright.sync_api import sync_playwright


ROOT = Path(__file__).resolve().parents[1]
TEST_PORT = int(os.environ.get("LPVS_TEST_PORT", "8765"))
BASE_URL = f"http://127.0.0.1:{TEST_PORT}/tests/fixture.html"


def install_script(page, script_name):
    if script_name == "content.js":
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
    else:
        page.evaluate(
            """
            () => {
              window.GM_getValue = (_key, fallback) => fallback;
              window.GM_setValue = () => {};
              window.GM_registerMenuCommand = () => 1;
              window.GM_unregisterMenuCommand = () => {};
              window.GM_addValueChangeListener = () => {};
            }
            """
        )
    page.add_script_tag(content=(ROOT / script_name).read_text(encoding="utf-8"))


def load(page, script_name):
    page.goto(BASE_URL)
    page.wait_for_load_state("networkidle")
    install_script(page, script_name)
    return page.locator(".ytp-cued-thumbnail-overlay")


def assert_rate(page, expected, label):
    actual = page.locator("video").evaluate("video => video.playbackRate")
    if abs(actual - expected) > 0.01:
        raise AssertionError(f"{label}: expected rate {expected}, got {actual}")


def run_suite(browser, script_name):
    page = browser.new_page(viewport={"width": 900, "height": 700})
    overlay = load(page, script_name)
    box = overlay.bounding_box()
    x, y = box["x"] + box["width"] / 2, box["y"] + box["height"] / 2

    # A short click remains a normal site click.
    page.mouse.click(x, y, delay=30)
    if page.evaluate("window.siteClickCount") != 1:
        raise AssertionError(f"{script_name}: short click was intercepted")

    # A real mouse hold targets the video through YouTube's sibling overlay.
    page.mouse.move(x, y)
    page.mouse.down()
    page.wait_for_timeout(430)
    assert_rate(page, 3, f"{script_name} mouse hold")
    if not page.locator(".lpvs-badge").is_visible():
        raise AssertionError(f"{script_name}: speed badge was not shown")
    page.mouse.up()
    page.wait_for_timeout(30)
    assert_rate(page, 1, f"{script_name} mouse release")
    if page.evaluate("window.siteClickCount") != 1:
        raise AssertionError(f"{script_name}: release click paused the player")

    # Site attempts to overwrite the rate while held; the script must reclaim it.
    page.mouse.down()
    page.wait_for_timeout(400)
    page.locator("video").evaluate("video => { video.playbackRate = 2; }")
    page.wait_for_timeout(180)
    assert_rate(page, 3, f"{script_name} rate enforcement")
    page.mouse.up()
    assert_rate(page, 1, f"{script_name} rate enforcement release")

    # Touch Pointer Events use the same path on current mobile Chromium.
    overlay.dispatch_event("pointerdown", {
        "pointerId": 41, "pointerType": "touch", "isPrimary": True,
        "button": 0, "buttons": 1, "clientX": x, "clientY": y,
    })
    page.wait_for_timeout(430)
    assert_rate(page, 3, f"{script_name} touch hold")
    overlay.dispatch_event("pointerup", {
        "pointerId": 41, "pointerType": "touch", "isPrimary": True,
        "button": 0, "buttons": 0, "clientX": x, "clientY": y,
    })
    assert_rate(page, 1, f"{script_name} touch release")

    # Moving before the delay cancels the gesture.
    overlay.dispatch_event("pointerdown", {
        "pointerId": 42, "pointerType": "touch", "isPrimary": True,
        "button": 0, "buttons": 1, "clientX": x, "clientY": y,
    })
    overlay.dispatch_event("pointermove", {
        "pointerId": 42, "pointerType": "touch", "isPrimary": True,
        "button": 0, "buttons": 1, "clientX": x + 30, "clientY": y,
    })
    page.wait_for_timeout(430)
    assert_rate(page, 1, f"{script_name} movement cancellation")

    # Keyboard activation selects the visible playing video and restores on release.
    page.keyboard.down("Shift")
    page.keyboard.down("ArrowRight")
    assert_rate(page, 3, f"{script_name} keyboard hold")
    page.keyboard.up("ArrowRight")
    page.keyboard.up("Shift")
    assert_rate(page, 1, f"{script_name} keyboard release")

    # Editable controls must retain the shortcut.
    page.locator("input").focus()
    previous = page.evaluate("window.siteKeyCount")
    page.keyboard.down("Shift")
    page.keyboard.press("ArrowRight")
    page.keyboard.up("Shift")
    assert_rate(page, 1, f"{script_name} editable shortcut")
    if page.evaluate("window.siteKeyCount") <= previous:
        raise AssertionError(f"{script_name}: editable key event was intercepted")

    page.close()


def main():
    with sync_playwright() as playwright:
        browser = playwright.chromium.launch(channel="msedge", headless=True)
        for script_name in ("content.js", "longpress-speed.user.js"):
            run_suite(browser, script_name)
            print(f"PASS {script_name}")
        browser.close()


if __name__ == "__main__":
    try:
        main()
    except Exception as error:
        print(json.dumps({"error": str(error)}, ensure_ascii=False), file=sys.stderr)
        raise
