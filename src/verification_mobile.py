from playwright.sync_api import sync_playwright

def verify_mobile_nav():
    with sync_playwright() as p:
        # Launch browser with mobile viewport simulation
        browser = p.chromium.launch(headless=True)
        context = browser.new_context(
            viewport={'width': 375, 'height': 667},
            user_agent='Mozilla/5.0 (iPhone; CPU iPhone OS 11_0 like Mac OS X) AppleWebKit/604.1.38 (KHTML, like Gecko) Version/11.0 Mobile/15A372 Safari/604.1'
        )
        page = context.new_page()

        try:
            # Wait for Vite to start
            page.goto("http://localhost:5173")

            # Helper to click mobile nav buttons specifically
            def click_mobile_tab(name):
                # Look for the button inside the fixed bottom nav
                page.locator(f".fixed.bottom-0 button:has-text('{name}')").click()

            # 1. Verify Mobile Nav exists
            print("Verifying Mobile Nav...")
            page.wait_for_selector(".fixed.bottom-0 button:has-text('Library')", state="visible")

            # 2. Test Switching Tabs
            print("Switching to Library...")
            click_mobile_tab('Library')
            page.locator("label:has-text('Import File')").locator("visible=true").wait_for()
            page.screenshot(path="/home/jules/verification/mobile_library.png")

            print("Switching to Battle...")
            click_mobile_tab('Battle')
            page.locator("text=AI Battle Arena").locator("visible=true").wait_for()
            page.screenshot(path="/home/jules/verification/mobile_battle.png")

            print("Switching back to Studio...")
            click_mobile_tab('Studio')
            page.locator("text=Deck 1").locator("visible=true").wait_for()
            page.screenshot(path="/home/jules/verification/mobile_studio.png")

            print("Mobile Verification successful!")

        except Exception as e:
            print(f"Error: {e}")
        finally:
            browser.close()

if __name__ == "__main__":
    verify_mobile_nav()
