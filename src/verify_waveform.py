from playwright.sync_api import sync_playwright

def verify_waveform():
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        page = browser.new_page()
        try:
            page.goto("http://localhost:5173")

            # Wait for Decks to load
            print("Loading Studio...")
            page.wait_for_selector("text=Deck 1")

            # Verify Canvas elements exist (Waveform)
            print("Verifying Waveform Canvas...")
            # We expect a canvas in the deck area.
            # <canvas class="absolute bottom-0 ..." />
            canvases = page.locator("canvas")
            count = canvases.count()
            print(f"Found {count} canvases")

            if count >= 2:
                print("Verification Successful: Waveform canvases present.")
            else:
                print("Verification Failed: Missing canvases.")

            page.screenshot(path="/home/jules/verification/waveform_check.png")

        except Exception as e:
            print(f"Error: {e}")
        finally:
            browser.close()

if __name__ == "__main__":
    verify_waveform()
