from playwright.sync_api import sync_playwright

def verify_queue_and_effects():
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        # Large viewport to ensure desktop view
        page = browser.new_page(viewport={'width': 1280, 'height': 800})

        try:
            page.goto("http://localhost:5173")

            # 1. Verify Queue Button in Library
            print("Checking Queue functionality...")
            # Open Library is default on desktop
            # Click Queue Tab (icon button)
            # Find tab button for Queue (ListVideo icon)
            # The 3rd button in the tabs list

            # Since buttons only have icons, we can locate by index or icon class if needed, or by trial.
            # But we added a "Queue" tab. Let's find it.
            # It's the button with <ListVideo>

            # Let's verify the Queue Tab exists first
            # The tabs container has 4 buttons now (Music, List, ListVideo, Grid)
            tabs = page.locator(".flex.border-b.border-gray-700 button")
            count = tabs.count()
            print(f"Found {count} tabs in Library (Expected 4)")

            # Click Queue Tab (3rd one, index 2)
            tabs.nth(2).click()

            # Should see "VJ Queue" header
            page.wait_for_selector("text=VJ Queue")
            print("VJ Queue tab verified")

            # 2. Verify VJ Effect Controls overlay
            print("Checking VJ Effect Controls...")
            # Look for FX: NONE button
            page.wait_for_selector("text=FX: NONE")

            # Click to toggle effect
            page.click("text=FX: NONE")
            page.wait_for_selector("text=FX: DATAMOSH")
            print("VJ Effects toggled successfully")

            page.screenshot(path="/home/jules/verification/queue_and_fx.png")

        except Exception as e:
            print(f"Error: {e}")
        finally:
            browser.close()

if __name__ == "__main__":
    verify_queue_and_effects()
