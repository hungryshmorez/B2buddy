# AI vs AI Spectator Show, five cameras, Random Effect (branch `feature/spectator-show`)

Verified 2026-10-28 in **headless Chromium 153 on Linux** (WebGL via SwiftShader) against `vite preview` on http://localhost:4173. Nothing here was tested by a person listening, on real GPUs, in other browsers, or on a public URL.

## What it is
Menu → **AI vs AI SHOW**. Two rule-based AI DJs (`BuddyAI`, one per station, intermediate vs intermediate by default, `GameOptions.showDj1/showDj2`) play one 60 s round on the same stations, master clock, scorer and validated `CommandPort` as a battle. Each port is bound to its own station; a human cannot touch either deck (`GameRuntime.act`, `loadToPlayer` and keyboard are disabled in `mode === 'show'`). Results explain both scores; REMATCH SHOW restarts; MENU leaves. The show teaches Buddy's memory nothing (no human played).
Code: `runtime.ts` (`startShow`), `ui/Arena.tsx`, `ui/StationPanel.tsx` (`readOnly`, `label`), `ai/buddy.ts`.

## Five cameras (`ui/cameras.ts`, `ui/Venue.tsx`)
DJ 1 POV · DJ 2 POV · DJ 1 Overhead · DJ 2 Overhead · Crowd Camera. Software-projected wireframe club on a 2D canvas (NOT Unity cameras). The Crowd Camera stands between the audience's first and last rows facing the stage with both DJs in frame (unit-tested geometry). Deck platters turn and the volume strips move from the real station state, which is what makes the overheads meaningful. Camera is separate state from the effect and from the battle.

## Random Effect / ON-OFF (`fx/trippy.ts`)
| Effect | Kind | Origin in `trippy_effects_for_trippy_me` |
|---|---|---|
| Liquid Distortion | WebGL | `webgl-shaders.js` `shaders.liquidDistortion`, GLSL verbatim (test-checked) |
| Fractal Noise | WebGL | `webgl-shaders.js` `shaders.fractalNoise`, GLSL verbatim |
| Datamosh | 2D pixel pass | `datamosh-effects.js`: slices, RGB split, block movement, noise (ported; pixel sorting and compression artifacts NOT ported) |
| CRT Screen | CSS overlay | `effects.css` `.crt-effect` |
| VHS Tracking | CSS overlay | `effects.css` `.vhs-tracking` |
RANDOM EFFECT picks a different eligible effect and turns it ON; EFFECT ON/OFF keeps the selection. If the browser cannot compile the shaders, the two WebGL effects drop out of the pool and the UI says so. Original files are kept unmodified in `third_party/trippy_effects_for_trippy_me/`.

## Fix found by the new tests
Only Expert Buddy avoided the opponent's current track, so two Intermediate AIs could play the same track at once. All non-random profiles now penalise it (`ai/buddy.ts`). Difficulty means unchanged: 31.1 / 79.1 / 99.4. Beginner (random) can still duplicate.

## Results
- Unit: **47/47** (`npm test`; 33 earlier + 14 in `spectator.test.ts`: cameras, effect selection logic, shader fidelity, datamosh, AI-vs-AI core round).
- Browser `e2e/show.mjs`: **30/30**: launch from menu; two AIs, no human controls; real audio (master/both stations); five buttons select five views with pairwise picture difference ≥ 27.7; each effect measurably changes the displayed picture (pixel difference 10–22 vs camera, or overlay geometry for CSS); ON/OFF; selection and ON/OFF state persist across camera switches; audio, round and AI decision counts keep advancing; results (both AIs, 0 refused commands); rematch; menu; no page/console errors.
- Earlier suites still pass: `e2e/run.mjs` 22/22 (updated for the new camera labels), `e2e/smoke.mjs` 5/5.
- Screenshots: `e2e/out/show-*.png` (not committed).

## Not done / unverified
Unity WebGL (no Unity here), public hosting and URL, Windows pipeline, real MIDI hardware, listening tests, Firefox/Safari/Edge, mobile. AI DJ Mixing System (Python/librosa/OpenAI; offline mix renderer) and BENDR (2,170 lines of GLSL plus its own engine) are NOT integrated yet. VJ Mixer Pro / Saucelab VJ / Trippy Cam Clip Studio are NOT integrated. Both AIs are rule-based, not an LLM.
