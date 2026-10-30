# Controlled public beta: plan, evidence and what is still unknown

Status: **deployed** to https://hungryshmorez.github.io/B2buddy/ (the path is case-sensitive: capital B). Deployed from `main` at fe6c55a by the Pages workflow; verified by running the full browser integration suite against that live URL (52/52, no Python service).

## 1. What works without the Python service (measured)
`e2e/integration.mjs` was run in Chromium against a production build served under the Pages-style subpath `/b2buddy/` with **no Python service**: **52 of 52 checks passed, 1 skipped** (the one skipped check is the real-service connection and measurement). Software GL, so this proves function, not speed.

| Feature | Needs the Python service? | Evidence |
|---|---|---|
| Battle modes, scoring, results, rematch | No | e2e |
| AI vs AI show, five cameras | No | e2e |
| AI DJ decisions (next track, transition length) | **No**: runs on the TypeScript port, held to the fork's Python by 1,285 golden cases | unit tests + e2e |
| BENDR video engine (83 usable effects), Random Effect, ON/OFF | No (static files in the build) | e2e |
| Flashing-effects warning, FLASHING EFFECTS ON/OFF | No | e2e |
| Canvas-effects fallback if BENDR fails | No | e2e (fault injection) |
| Web MIDI | No (needs HTTPS, which Pages provides) | **fake MIDIAccess only; no hardware tested** |
| **`AI DJ ANALYSE` (librosa measurement of a library track), `USE AI DJ BPM`** | **Yes** | tested against the real service locally and in CI, not on a public page |

An unreachable service is reported and the in-browser AI DJ stays in charge (e2e). Nothing contacts the service until the player presses CONNECT.

## 2. Python service: deployment plan
GitHub Pages serves static files only, so the service is **not** part of the Pages deployment.

- **Beta recommendation: do not host it publicly.** Players who want `AI DJ ANALYSE` run it on their own machine (`services/aidj/server.py`, `127.0.0.1:8765`) and press CONNECT SERVICE. Everything else works without it.
- Local-from-HTTPS caveat: an `https://` page calling `http://127.0.0.1` is allowed by browsers for loopback, but Chrome may show a local-network permission prompt, and Firefox/Safari behaviour was **not tested**.
- If a hosted service is wanted later it needs, at minimum: HTTPS, `AIDJ_ALLOW_ORIGIN` set to the Pages origin, an upload size cap, rate limiting and a request timeout. **None of the cap/rate-limit hardening has been written or reviewed**, and the service accepts arbitrary audio uploads today, so exposing it as-is is not recommended.
- No secret is needed: the service never calls OpenAI or Gemini; `OPENAI_API_KEY` is optional and unused.

## 3. GitHub Pages: what is ready and what you must do
Ready: `.github/workflows/pages.yml` (manual `workflow_dispatch` only; checks the BENDR hash, runs `npm test`, builds with `VITE_BASE=/<repo name>/`, uploads and deploys). `vite.config.ts` reads `VITE_BASE`; local dev and preview still use `/`. The subpath build was verified: `/b2buddy/`, `/b2buddy/bendr/index.html` and `/b2buddy/favicon.svg` all served, and the full e2e passed under it.

Steps only you can do (they change the public repository and need your permission):
1. Review PR #2 and merge it (into `develop`). Keep PR #1 and the `main` baseline as they are until you decide.
2. Repository **Settings → Pages → Source: GitHub Actions**.
3. The `github-pages` environment normally only allows deployments from the default branch. Either get the workflow onto the default branch, or add the branch you want under Settings → Environments → github-pages → Deployment branches. A `workflow_dispatch` workflow also has to exist on the default branch to be started from the Actions tab.
4. Run **Actions → Deploy browser build to GitHub Pages**. The expected address is `https://hungryshmorez.github.io/B2buddy/` (confirmed live).

## 4. Measuring performance on real hardware
Software GL in CI gave about 20 fps for the game canvas and 4-6 fps from BENDR. **That says nothing about a real GPU.** The arena now has a **PERFORMANCE** button (or add `?perf` to the URL) that shows measured numbers and a **COPY REPORT** button: game-canvas fps, p95 and worst frame time, frames over 50 ms, the frame rate BENDR actually outputs, audio base/output latency, the WebGL renderer string (tells you real GPU vs software) and the browser.

Checklist, on each device (desktop, laptop, phone if wanted):
1. Open the page, CLICK TO ENTER, start the AI vs AI show, press PERFORMANCE.
2. Let it run 30 s with `?engine=canvas`; COPY REPORT.
3. Reload with `?engine=bendr`, pick an effect, let it run 30 s; COPY REPORT. Repeat with a heavy effect.
4. Note whether audio stays clean while BENDR is on (listening is yours; nothing here claims it was done).
5. If the BENDR output is far below the game canvas rate, use Settings → video engine → canvas effects.

## 5. Photosensitivity
The warning dialog appears each session when BENDR is the engine, the arena has a **FLASHING EFFECTS ON/OFF** button next to Random Effect, and a permanent warning line is shown. Flashing detection is a pattern match on the `strobe` and `invFlick` parameters (1 preset flagged out of 83). **It does not catch every effect that can flash** (feedback and some modulated presets can), so the warning is shown regardless of the setting.

## 6. Still unknown or not done
Real-GPU frame rate; real MIDI hardware; any listening test; browsers other than Chromium; mobile; the Windows build and the Unity project (untouched); Chroma Awards submission rules (never available); a hosted Python service; any deployment.
