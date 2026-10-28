from playwright.sync_api import sync_playwright

def verify_upload_analysis():
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        # Use desktop viewport
        page = browser.new_page(viewport={'width': 1280, 'height': 720})
        try:
            page.goto("http://localhost:5173")

            print("Checking Library...")

            # The sidebar is the first hidden md:block div
            sidebar = page.locator("div.hidden.md\\:block").first
            sidebar.wait_for()

            import_label = sidebar.locator("label:has-text('Import Track')")
            import_label.wait_for()

            # Check for class that implies purple styling
            class_attr = import_label.get_attribute("class")
            if "bg-purple-900/40" in class_attr:
                 print("Styling Verified: Purple background present.")
            else:
                 print(f"Styling Mismatch: {class_attr}")

            page.screenshot(path="/home/jules/verification/library_upload.png")

        except Exception as e:
            print(f"Error: {e}")
        finally:
            browser.close()

if __name__ == "__main__":
    verify_upload_analysis()
