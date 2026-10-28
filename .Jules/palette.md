## 2024-05-23 - Library Navigation Accessibility
**Learning:** Icon-only buttons are a common pattern for dense interfaces like DJ tools, but they create a significant barrier for screen reader users and new users if not properly labeled.
**Action:** When using icon-only buttons for navigation, always wrap them in a semantic `role="tablist"` container and apply `role="tab"`, `aria-selected`, `aria-label`, and `title` attributes. The `title` attribute provides a native tooltip for mouse users, while `aria-label` serves screen readers.

## 2026-02-06 - Invisible Controls Accessibility
**Learning:** Hiding controls with `opacity-0` or `display: none` until hover makes them inaccessible to keyboard users, as they cannot see what they are focusing on (or cannot focus at all).
**Action:** Use `opacity-0` combined with `group-focus-within:opacity-100` (alongside `group-hover:opacity-100`) to ensure controls become visible when they receive keyboard focus. Avoid `display: none` for interactive elements unless they are truly disabled/unavailable.
