# Integration architecture: AI DJ (DJ brain) + BENDR (video engine) + B2Buddy (game)

See `INTEGRATION-AUDIT.md` for what the two projects really are. This file is how they are wired, how to run it, and what is not done.

```
                      +---------------------------- B2Buddy (browser, authoritative game state) ----------------------------+
                      |  GameRuntime  BattleSession  RoundScorer  Stations (Web Audio)  MasterClock  CommandPort           |
                      |        ^ decisions (sync)            |                    events (EventBus, bounded)                  |
   AI DJ service  <---+   DjBrain ------------> BuddyAI (executor, validated commands)        v                                |
   (Python, optional) |   |  AiDjServiceBrain  (cache, warmed ahead)                  +--> BendrEngine adapter ---> BENDR       |
   fork's own code    |   |  AiDjTsBrain       (TypeScript port, golden-tested)       |    virtual camera + audio input         |
                      |   |  rules (null)      (explicit fallback)                    |    presets, bypass, spike, tempo        |
                      |                                                               +--> canvas effects (explicit fallback)   |
                      +----------------------------------------------------------------------------------------------------------+
```

## DJ brain
`src/game/dj/` and `services/aidj/`.
- **Buddy executes, the brain decides.** Every action still passes `CommandPort` validation (owner, enabled, ranges). The brain supplies (a) the next track for Intermediate/Expert and (b) the overlap length of a transition. Beginner stays random and unassisted (skill means something). A lesson the user taught Buddy (`fadeBeats`) outranks the brain. Opening-track choice stays B2Buddy's (tempo fit to the master clock).
- **Three layers, always labelled** (`Decision.source`, Settings "Now using", arena badge):
  1. `aidj-service`: the fork's own Python (`services/aidj`) answers `plan` and `rank`. Decisions are fetched ahead (`warm`) because Buddy's tick loop is synchronous.
  2. `aidj-ts-port`: `aidjCore.ts`, a TypeScript port of `generate_mixing_plan.py`'s decision functions, held to the Python by 1,285 golden cases (`npm test`; `make_golden.py` regenerates them from the real code). Runs with no server, so it is what a static/public build uses.
  3. `rules` (no source label): Buddy's original built-in rules, selectable in Settings or `?brain=rules`.
- Anything not cached, or any service failure, falls back one layer, counted (`fallbackCalls`) and labelled. A hung service times out (4 s).
- **Local analysis (the fork's older, non-OpenAI engine).** `AI DJ ANALYSE` in the Library sends a decoded track to the service, which runs the librosa beat tracker and the fork's `older_way` key / chorus helpers. The result is shown *beside* the track's own values. Only an **unknown key** is filled in automatically (origin `estimated`, with the caveat that it may be the relative major/minor); declared and manual values are never overwritten; BPM is adopted only when you press `USE AI DJ BPM` (origin `estimated`). Repetition-based chorus ends become real `chorus_end` transition candidates for the scorer.
- **Honest limits:** bundled demo tracks are loops without chorus/verse structure, so their candidates are `phrase_end` grid positions (no type bonus in the fork's tables) and the scoring that matters is key fit (Camelot to note conversion), BPM gap, vocals (declared instrumental) and overlap. Demo key and BPM are *declared*. Genre and real vocal structure are not measured (the fork gets those from OpenAI, which this build never calls); the local vocal guess is unreliable and never used. No LLM anywhere.

## BENDR video engine
`src/game/video/bendrEngine.ts`, vendored BENDR in `public/bendr/` (unmodified, hash-pinned).
- BENDR runs in a hidden same-origin iframe. B2Buddy overrides that iframe's `getUserMedia`: **video = the club scene canvas** (`captureStream`), **audio = the game's master mix** (post-limiter tap; BENDR's mic path feeds only its analyser, so nothing is heard twice). `openCam('A')`, `setAudioMode('mic')`, `setProcRes`, `setTempo`, `loadPreset`, `setBypass` and `__getOutputStream()` are BENDR's own functions; `eval` is used only with constant strings (documented in the file) to reach its non-window globals.
- **Effect registry = BENDR's real presets** (103) minus only the technically unusable ones: whole multi-channel patches, presets that replace channel A's source or touch the bus mix, and the near-clean one. **Strobe / flicker presets are INCLUDED in Random Effect by default** and flagged (`flashing`).
- **Photosensitivity:** BENDR's warning is carried into the game as a dialog on entering the arena (asked every session) with two answers, *keep flashing effects on* or *turn them off*, and a **FLASHING EFFECTS ON/OFF button** in the arena (also in Settings, persisted). Turning it off removes every flashing preset from Random Effect and clears an active flashing effect; turning it on brings them back. Flagging is a best-effort match on the `strobe` / `invFlick` parameters and their modulation routes, not a clinical guarantee.
- **ON/OFF is BENDR's bypass** (the source with the whole chain switched out); the preset stays loaded. A 4 Hz guard re-asserts the user's choice because BENDR's own blur handler releases bypass, and re-asserts the game feed if a preset takes channel A.
- **Camera and effect are independent state**; the engine renders whatever the camera canvas shows, so camera changes never touch the effect.
- **Failure:** a throwing preset marks the engine `degraded`, music/round untouched; 8 consecutive call errors, **6 s without new frames, or the iframe being removed** mark it `failed` (the last two cannot be masked by unrelated successful calls: a detached BENDR window still evaluates code, which the first e2e run caught). The Venue then switches to the labelled canvas-effects fallback and clears the now-meaningless selection. WebGL2 missing, load timeout or API mismatch fail the same way at start.
- Cost: BENDR renders about 3 fps under software GL in the test environment. Real-GPU speed was **not measured**.

## Event schema (`src/game/events.ts`)
Typed, past-tense facts, each stamped with audio time `t` and a sequence number. Listener errors are caught and counted (a listener can never affect the game); the log is a 256-entry ring; nothing polls (events come from engine callbacks, the 20 ms frame loop turns what happened into events, at most one beat and one score per tick).
`track.loaded` `mix.started` `beat{beat,bar,downbeat}` `phrase` (every 4 bars) `transition.started/completed` `dj.decision{kind,source}` `drop` (the incoming track launched on the master beat) `round.started/ended` `score` (1 Hz) `camera.changed` `effect.selected/toggled` `engine.status` `brain.status`.
**BENDR reacts to:** `beat` on a downbeat (its beat phase is reset to the game's bar line), and `transition.started`, `drop`, `round.started`, `mix.started` (kick its `spike` modulation source, which presets map to tear/dropout/mosh etc.). BENDR also hears the real master mix through its own bass/mid/high analysis. It never controls game state.

## Setup
```
npm ci && npm run build && npm run preview          # browser game, http://localhost:4173
# optional AI DJ service (Python 3.10+):
python -m venv venv && venv/bin/pip install -r services/aidj/requirements.txt
venv/bin/python services/aidj/server.py            # http://127.0.0.1:8765   (Settings -> CONNECT SERVICE)
```
Config (no secrets): `services/aidj/.env.example` (`AIDJ_PORT`, `AIDJ_ALLOW_ORIGIN`; `OPENAI_API_KEY` is optional, never required and never called by the adapter). Browser switches: `?engine=canvas|bendr`, `?brain=rules|aidj`; Settings persists the choices (`b2buddy.engine.v1`). A hosted HTTPS page calling a service on your own computer may trigger the browser's local-network permission; nothing probes the service unless you press CONNECT.

## Tests (what each proves)
| Command | Layer | Proves |
|---|---|---|
| `npm test` | unit | game core, AI, scoring, memory, MIDI (fake), cameras/effects logic, **AI DJ port = Python on 1,285 golden cases**, brain wiring, event bus |
| `AIDJ_PYTHON=venv/bin/python npm test` | integration | the browser brain against the **real** Python service: identical decisions, a whole battle with 0 refused commands, real librosa measurement of a WAV |
| `python -m unittest services/aidj/test_service.py` | service | vendored files unmodified (SHA-256), health, plan/rank = golden, Camelot handling, **measurement of real audio, refusal to report fabricated measurements**, bad input, CORS |
| `node e2e/integration.mjs` (+ `AIDJ_PYTHON`) | browser e2e | the whole chain in Chromium with real BENDR and the real service (see test report) |
| `node e2e/run.mjs`, `e2e/smoke.mjs`, `e2e/show.mjs` | browser e2e | earlier battle / spectator suites still pass |

## Not done / unverified
Unity target not touched. No public hosting, no Windows build, no CI workflow. Real MIDI hardware, any listening test, Firefox/Safari/Edge, real GPUs: not tested. VJ Mixer Pro / Saucelab VJ / Trippy Cam Clip Studio not integrated (BENDR covers their role; see audit). The service handles the decision layer and BPM/beat measurement only: no chorus/vocal detection (needs OpenAI), no key detection, no real-time audio mixing by the fork (its renderer is offline). Beat-level visual sync uses the game's own master clock, not detection of the audio. BENDR coupling is to a pinned version's globals: upgrading BENDR means re-running `e2e/integration.mjs`.
