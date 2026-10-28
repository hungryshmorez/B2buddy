# Integration test report (branch `integration/aidj-bendr`)

Run 2026-10-28 in this session's container. Every number below is from a command that was run; nothing is estimated.

## Environment
Chromium 153.0.8010.12 (headless, Linux), **software GL (SwiftShader)**, Node 22, Python 3.13.17 with librosa 1.0.0 / scipy 1.18.1 / numpy 2.5.4 / scikit-learn / openai (package only). Served by `vite preview` on localhost. No GPU, no audio hardware, no MIDI hardware, no human listener.

## Results
| Layer | Command | Result |
|---|---|---|
| Unit (no Python) | `npm test` | **67 passed, 3 skipped** (the 3 are the real-service tests: skipped loudly because `AIDJ_PYTHON` is unset) |
| Unit + integration with the real Python service | `AIDJ_PYTHON=venv/bin/python npm test` | **70 / 70**, 8 files |
| AI DJ service (real librosa, real vendored fork code) | `python -m unittest services/aidj/test_service.py` | **13 / 13** |
| Browser: integration (real BENDR + real service) | `AIDJ_PYTHON=... node e2e/integration.mjs` | **55 / 55**, 0 skipped (run 4 of 4: runs 1-3 each found a real defect or a test error, listed below) |
| Browser: battle loop (canvas engine) | `node e2e/run.mjs` | 22 / 22 |
| Browser: smoke / layout / user file | `node e2e/smoke.mjs` | 5 / 5 |
| Browser: spectator show (canvas engine) | `node e2e/show.mjs` | 30 / 30 |
| Type-check + production build | `npm run build` | passes (large-chunk warning only) |
Automated: all of the above. **Manual: nothing.** No listening test, no MIDI hardware, no other browser.

## What each integration check proves (e2e/integration.mjs)
AI DJ: default brain is the in-browser port; an unreachable service is reported and the port stays in charge; the real service connects (fork commit and librosa reported) and becomes the brain; `AI DJ ANALYSE` returns librosa BPM plus the older engine's key/chorus fields beside (not over) the declared values; `USE AI DJ BPM` labels the result `estimated`; AI DJ decisions were executed through the validated ports with 0 refused commands and every decision is labelled `aidj-service`; Buddy performed an AI DJ-planned transition in a human battle; both battle modes finish with results; rematch / leave works.
BENDR: the real engine initialises inside the game (v38.7, 83 effects); it receives the game feed as channel A and the game audio as its live input; its audio-reactive bands respond to the music (max band 0.96-1.0); five camera views are five different pictures *in BENDR's output* (smallest pairwise difference 14.3); six consecutive Random Effects were each a real BENDR preset, never repeated, differing from the unprocessed feed by 17-50 (mean abs, 0-255); ON/OFF is BENDR's bypass (picture returns toward the feed, preset stays selected); camera changes keep the effect and its ON/OFF state; an OFF effect stays OFF; game events reach BENDR (`spike` = 1.00 after a `drop` event; 54 bar-line phase locks and 13 event kicks in one show).
Flashing: the warning dialog (BENDR's text) appears on entering the arena with both answers; strobe/flicker presets are in the registry by default and one was selected and shown; FLASHING EFFECTS OFF empties the registry of flashing presets and clears an active one; 25 Random Effect rolls with it off never picked one; ON brings them back.
Faults: an injected preset failure is reported (`degraded`, message visible in the UI) without stopping music, the round or the show, and BENDR recovers; **removing BENDR's frame mid-show** makes the game say so, fall back to canvas effects, keep the music and the show running, and Random Effect still works.
Fallbacks: `?engine=canvas&brain=rules` uses the labelled fallbacks and Buddy decisions carry no AI DJ label.

## Defects found by these tests (and fixed)
1. AI DJ service reported the fork's silent fallback (a constant 120 BPM) as a measurement. Now refused (422). Cause: fork pinned to librosa 0.9.2; current librosa returns tempo as an array.
2. `structure_detector.py` silently disables librosa when the `openai` *package* is missing. The service now requires the package and reports the capability.
3. The fork's older key estimator returns the *relative* major/minor for half of ideal inputs. Key is labelled `estimated`; the failure mode is pinned by a test.
4. The fork's chorus fallbacks invent a chorus. Discarded and reported.
5. Only Expert Buddy avoided the opponent's track; now every non-random level does.
6. **BENDR stall was masked:** a detached BENDR window still evaluates code, so successful event calls reset the error counter and a dead engine never failed over. Now frame stall (6 s) or a removed frame fails hard.
7. **Failure message erased in under a second** by the next successful call. Now held 5 s before `ready` may return.
(Test-only errors fixed along the way: a bounded event ring losing early events, selectors matching a covered button, wording after a rename.)

## Limits you should know
- **BENDR rendered about 3 fps here** (software GL; process resolution 360p). Real-GPU frame rate was not measured. Effect timing checks are therefore state/pixel checks, not smoothness checks.
- The warning/flashing flags come from a pattern match on the `strobe` / `invFlick` parameters and their modulation routes (1 flagged preset in the registry). Other presets (heavy feedback) can still flash; the warning text says so. This is not a clinical guarantee.
- Camera views are software-projected canvas scenes fed to BENDR, not Unity cameras.
- BENDR is driven through its page globals with `eval` of constant strings; the dependency is pinned to the vendored v38.7.
- AI DJ: no chorus/vocal structure from OpenAI (never called); the local vocal guess is unreliable and unused; demo tracks have no real sections; the fork's renderer is offline and not used.
- Not verified: other browsers, mobile, real GPUs, real MIDI hardware, any listening, public hosting, Windows/Unity builds, Chroma Awards rules.
