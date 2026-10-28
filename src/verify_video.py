from playwright.sync_api import sync_playwright

def verify_video_mixer():
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        page = browser.new_page(viewport={'width': 1280, 'height': 800})

        try:
            page.goto("http://localhost:5173")

            # Verify Video Channel Elements in Mixer
            # Look for "VIDEO" label or "OPAC" label in the mixer
            print("Verifying Video Mixer Channels...")
            page.wait_for_selector("text=VIDEO")
            page.wait_for_selector("text=OPAC")

            # Verify Master Output element exists (background)
            # It has class "pointer-events-none z-0" and contains video elements potentially
            print("Verifying Master Output Container...")
            # We look for the container with the Master Output text placeholder if empty
            page.wait_for_selector("text=MASTER OUTPUT")

            # Verify Deck Video Icon (when video is loaded/mocked)
            # Since we haven't loaded a track, we just check the structure.

            page.screenshot(path="/home/jules/verification/video_mixer.png")
            print("Video Mixer Verification Successful!")

        except Exception as e:
            print(f"Error: {e}")
        finally:
            browser.close()

if __name__ == "__main__":
    verify_video_mixer()
