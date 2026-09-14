"""Load the unpacked MV3 extension in Edge and verify its content script."""

import os
import tempfile
from pathlib import Path

from playwright.sync_api import sync_playwright


ROOT = Path(__file__).resolve().parents[1]
PORT = int(os.environ.get("LPVS_TEST_PORT", "8765"))
URL = f"http://127.0.0.1:{PORT}/tests/fixture.html"


with tempfile.TemporaryDirectory(prefix="lpvs-edge-") as profile:
    with sync_playwright() as playwright:
        context = playwright.chromium.launch_persistent_context(
            profile,
            channel="msedge",
            headless=True,
            args=[
                f"--disable-extensions-except={ROOT}",
                f"--load-extension={ROOT}",
            ],
        )
        page = context.pages[0] if context.pages else context.new_page()
        page.goto(URL)
        page.wait_for_load_state("networkidle")
        overlay = page.locator(".ytp-cued-thumbnail-overlay")
        box = overlay.bounding_box()
        x, y = box["x"] + box["width"] / 2, box["y"] + box["height"] / 2
        page.mouse.move(x, y)
        page.mouse.down()
        page.wait_for_timeout(500)
        rate = page.locator("video").evaluate("video => video.playbackRate")
        assert abs(rate - 3) < 0.01, f"extension did not activate, got {rate}"
        page.mouse.up()
        page.wait_for_timeout(50)
        rate = page.locator("video").evaluate("video => video.playbackRate")
        assert abs(rate - 1) < 0.01, f"extension did not restore, got {rate}"
        context.close()

print("PASS unpacked Edge extension")
