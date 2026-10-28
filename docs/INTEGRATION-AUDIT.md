# Integration audit: B2Buddy + AI DJ + BENDR (Milestone A)

Done before any integration code. Everything below was read or run in this session; where something was not inspected it says so.

## 1. Sources located
| Source | Where | Verified how |
|---|---|---|
| B2Buddy (browser game, React/TS/Vite/Web Audio) | https://github.com/hungryshmorez/B2buddy (`main` = unmodified handoff snapshot `ad2218a`; `develop` = spectator show `70115f2`) | cloned/pushed from this session, remote refs listed |
| AI DJ fork | https://github.com/hungryshmorez/AI-DJ-Mixing-System, `main`/`d56bd28c772f713ae39fc9ac33d0b555b98e1ce4`, MIT (c) 2025 Kuchi Chaitanya Krishna Deepak | cloned in the session; modules imported and run |
| BENDR fork | https://github.com/hungryshmorez/bendr, `main`/`3c966ab10a471f983466a6e76ff1711a2f5216a4`, v38.7, MIT (c) 2026 Steve Blythe | cloned; the built `index.html` was run in Chromium |
| Trippy effects package, Trippy Cam Clip Studio, VJ Mixer Pro, Saucelab VJ 2 | uploaded archives, unpacked read-only | file lists only, except the Trippy effects (see 5) |
| Unity project | only inside the handoff bundle zip from the earlier session | **not opened in this task, not touched** |
| `12Matt3r/b2buddy` | not reachable from this session | the repo the user created is `hungryshmorez/B2buddy` |
Fork-vs-upstream diff: neither fork has an upstream remote in this checkout, so "differs from upstream" was **not** determined. Both forks were used exactly as they stand; nothing in them was modified (work dir clean).

## 2. What runs the game, and who owns state
The browser project (`src/game`) runs the game. `GameRuntime` owns audio, stations, session, AI and prefs; `BattleSession` owns round state; `RoundScorer` measures. The Unity project is a separate target that this task did not build or modify.
Audio: one `Station` per DJ (all playback arithmetic), `WebAudioBackend` (EQ, filter, gain), `MasterBus` (limiter, analyser). Beat timing: `MasterClock` is a pure function of an anchor. Scoring samples both stations about every 50 ms. Buddy acts only through a validated `CommandPort`.

## 3. AI DJ: what it can actually do
`run_pipeline.py` is an **offline batch renderer**: select songs, look up BPM/key/genre, find chorus transition points, plan, render `mix.mp3` with pydub. Stage by stage:
| Stage | Real capability | Needs |
|---|---|---|
| 1 song selection (`track_analysis_openai_approach`) | OpenAI GPT picks and orders songs | OpenAI key. **Not used.** |
| 2 BPM (`bpm_lookup`) | `estimate_bpm_with_librosa`: local, measured (rounded to an int). Genre and key are OpenAI text guesses (not measured) | librosa; OpenAI for genre/key. Only the librosa part is used |
| 3 structure (`structure_detector`) | Whisper transcription + GPT-4o choose chorus/transition points (needs a key; without it the module returns a stub `transition_point: 70.0`). Local parts: `extract_beat_times_fast`, `analyze_energy_curve` (windows hard-coded to 45-115 s, so meaningless for short loops) | OpenAI for the part that matters. Local parts used |
| 4 plan (`generate_mixing_plan`) | **Pure decision logic**: `calculate_key_compatibility`, `score_transition_candidate` (6 factors), `select_best_transition_point`, `calculate_dynamic_overlap` | librosa import only. **This is the DJ brain used** |
| older local engine (`older_way/track_analysis_engine.py`, 740 lines) | **Fully local, no OpenAI/Gemini**: librosa beat tracking, key (Krumhansl-Kessler correlation), energy, chorus detection by chroma self-recurrence, a weak vocal heuristic. Its `analyze_track()` asks Gemini for BPM and returns an *invented* fallback dict on failure, so only its helper functions are called | librosa, scikit-learn; imports tensorflow at the top but only uses it if `downbeat_model.h5` exists (it does not), so the adapter stubs the import. **Used for key / chorus analysis** |
| 5 render (`mixing_engine`, 1,531 lines) | Offline pydub crossfades, beat-grid alignment, tempo sync, echo-out | pydub; renders a file, cannot play live. **Not used** |
Findings about the older local engine (all verified by running it, pinned in `services/aidj/test_service.py`):
- **Key estimator confuses relative keys.** It chooses major vs minor by correlating at root C only. On 24 ideal Krumhansl-Kessler inputs it returned the true key for 12 and the *relative* major/minor for the other 12 (A minor came back as C major); never an unrelated key. So the service labels the key an **estimate**, not a measurement, and the game stores it with origin `estimated`.
- **Chorus fallbacks invent a chorus** (mid-track 30-60%, "longest high-energy segment"). The adapter keeps only repetition-based `Chorus` results and reports `chorusFallbackDiscarded`.
- **Segmentation is per-beat High/Low runs**, not song sections: reported, never used for decisions. **Vocal detection** is a mean-energy threshold: reported as unreliable, never fed into scoring.
Findings that cost real time and are now handled (and tested):
- The fork pins `librosa==0.9.2`; current librosa returns tempo as a 1-element array, so the fork's own `round(tempo)` and beat code raise and **silently fall back to a constant 120 BPM**. The adapter shims `beat_track` at its boundary and **refuses to report a measurement** when the fork fell back (HTTP 422).
- `structure_detector.py` imports `openai` and `librosa` in one `try`, so without the `openai` *package* it silently sets `librosa = None`. The service requires the package (no key) and reports `analysis` capability honestly.
- The fork uses note names (`Am`, `C`); B2Buddy uses Camelot codes (`8A`, `8B`). A converter exists on both sides and is golden-tested.
- Importing the modules creates a `./notes` cache directory; the service runs in its own data directory.

## 4. BENDR: what it can actually render
One 912 KB self-contained HTML app (built from `src/p*.js` by `build.py`): WebGL2, four channels A-D, three mix buses with 20+ transitions, 24 mix types, tape/sync/glitch/flow/scan/codec stages, **103 built-in presets**, modulation sources (`bass mid high spike cut chaos drift lfo*`), an audio-reactive input, MP4 render, bypass. No dependencies, no network. **It exposes no API object**: control is through its UI or its page globals. Inputs: file, camera (`getUserMedia`), screen capture, pattern synth; output: canvas and `__getOutputStream()`.
Hazards found: (a) it opens with a photosensitivity warning because it can flash full-frame (`strobe`, `invFlick`): B2Buddy keeps those presets in Random Effect by default, carries the warning into the game as a choice, and lets the player switch flashing effects off (see INTEGRATION.md); (b) some presets replace channel A's source with a generator, or are whole multi-channel patches; (c) its window-blur handler silently releases bypass.

## 5. Other assets
- Trippy effects package: 2 GLSL shaders (verbatim), datamosh pixel ops, CRT/VHS CSS: integrated earlier as the **canvas fallback** engine (docs/SPECTATOR-SHOW.md).
- VJ Mixer Pro / Saucelab VJ 2 / Trippy Cam Clip Studio: preserved untouched, **not integrated**. Decision, not a blocker: BENDR already is a four-channel mixer with transitions, MIDI and shaders, and integrating a second mixing engine would duplicate its job (the brief asks to avoid that). They remain candidates for BENDR-compatible clip sources.

## 6. Existing functionality: real versus simulated
Real and tested earlier: both battle modes, scoring, results, rematch, five cameras, five canvas effects, MIDI service (fake MIDIAccess only), memory/supervisor. Simulated: the crowd (decoration), online anything (none exists). Unverified: real MIDI hardware, listening, other browsers, real GPUs, public hosting, Chroma Awards rules (never available).

## 7. Integration decisions
| Need | Choice | Why |
|---|---|---|
| Runtime of AI DJ logic | in-browser TypeScript **port** of the four decision functions, golden-tested against the fork's Python; plus an **optional local Python service** that runs the fork's own code and measures audio with librosa | the competition build is static; the decision layer has no heavy deps, so it ports; analysis needs librosa so it stays server-side |
| Who executes | Buddy keeps executing through `CommandPort`; the brain only decides | one validated path; skill levels keep their meaning |
| BENDR integration | host the vendored, hash-pinned BENDR in a same-origin iframe; B2Buddy is its virtual camera and audio input; drive it through its own globals; show its output stream | no rewrite, no copy of its shaders, no second engine |
| Failure | explicit fallbacks (`rules` brain, canvas effects), labelled in the UI and in decision `source` | nothing is silently substituted |
