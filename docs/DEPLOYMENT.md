# Deployment

B2Buddy's playable slice is a **static single-page app**: no backend is needed to play. (The foundation's `netlify/functions/*` are mock endpoints for the legacy studio and are not used by the game.)

```
npm install
npm test                 # 28 unit tests (vitest)
npm run build            # tsc + vite build -> dist/
npm run preview          # serve dist/ at http://localhost:4173
CHROMIUM=/path/to/chromium npm run e2e   # real-browser run against the preview (needs `npm run preview` running)
```
Host the contents of `dist/` on any static host (the repo already has `netlify.toml`: build `npm run build`, publish `dist`).

| Requirement | Detail |
|---|---|
| HTTPS | **Required for Web MIDI** (secure context). `http://localhost` also counts as secure. Web Audio itself works over http, but host on HTTPS anyway. |
| Headers / CORS | None needed: no cross-origin audio, no SharedArrayBuffer, no workers. Demo audio is generated in the page; user files are read locally and never uploaded. |
| Audio start | Browsers block sound until a click: the first screen is a "CLICK TO ENTER" gate that creates and resumes the AudioContext. |
| Storage | `localStorage` for Buddy's memory (`b2buddy.memory.v1`) and the MIDI mapping (`b2buddy.midi.v1`). If storage is blocked the game says so and keeps working for the session. |
| Embedding | If an awards platform embeds the game in an `<iframe>`, the embedding page must allow audio (`allow="autoplay"`) and, for MIDI, `allow="midi"` (Permissions-Policy). Not verified: **the Chroma Awards submission rules were not available to this work**, so hosting/embedding/size/browser requirements are unknown. |
| Size | `dist/` is 4.2 MB, but the game itself loads **4 files, 0.26 MB uncompressed** (measured against a local server, not a network). The legacy studio (react-player, hls, dash, TensorFlow, about 3.9 MB) is a lazy chunk fetched only if the player opens "STUDIO (legacy)". |
| Backends | None required. Future online play, shared leaderboards or LLM commentary would need services that do not exist yet. |

Verified here: build, and a real Chromium 153 (headless, Linux) run against `vite preview` on `http://localhost`. **Not verified:** any public hosting, Firefox, Safari, Edge, mobile browsers.
