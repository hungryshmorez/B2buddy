# Third-party sources reviewed for this release

Nothing below was copied into B2Buddy. Each item says what was inspected and what was decided.

| Source | What it is | Licence found | Decision |
|---|---|---|---|
| VJ Mixer Pro (`vj_mixer_pro…zip`, 25 files, ~4,100 lines JS) | Layer/sequencer/shader VJ app with its own `midi-controller.js` | **None in the archive** (only a stray word match in `index.html`) | Reference only. Not redistributable without the author's permission. B2Buddy's shuffle/lock/hit control was written from scratch. |
| Saucelab VJ 2 (29 files, adds `audio-engine.js`, `server.js`) | Variant of the above | **None found** | Same: reference only. Its Express `server.js` is a dev static server, not needed. |
| awesome-vjing | A link list | CC0 1.0 | Usable as a list of references; no code. |
| BENDR (earlier upload) | Circuit-bent video processor | MIT, "Copyright (c) 2026 Steve Blythe" | Not integrated yet. If its shaders (`src/p20_shaders.js`) are adapted, keep the MIT notice. |
| Trippy Cam / Trippy effects, Driftwave, VORTEX-OS, MPC creator (earlier uploads) | Visual/audio tools and docs | Not audited in this pass (Driftwave README says MIT) | Not integrated. |
| `kckDeepak/AI-DJ-Mixing-System` | Python pipeline (librosa etc.) for BPM/key/energy analysis and mix planning | MIT per the context notes | **Could not be inspected: GitHub is not reachable from this environment and no archive of it was uploaded.** Nothing was ported. Buddy's track choice uses its own tempo and Camelot-key rules (`ai/buddy.ts`). Being Python, it would need a backend or a careful port; audit privacy, secrets, dependencies and bundled sample audio rights first. |

## What was built instead (video pipeline only)
SHUFFLE VISUALS picks a different *curated* look (palette, effect, motion, camera) and never an arbitrary slider value; LOCK keeps chosen groups fixed; HIT IT flashes now or exactly on the next beat of the shared master clock (`src/game/ui/visuals.ts`, 5 unit tests, plus a browser check). It affects only the club canvas, never the audio or the controls.
