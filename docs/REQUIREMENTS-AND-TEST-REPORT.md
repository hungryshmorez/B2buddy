# Requirement matrix and test report

Environment of every run below: Linux container, Node 22.22.0, **Chromium 153.0.8010.12 headless** (Playwright), page served by `vite preview` at `http://localhost:4173` (a secure context), Vite 4 production build. No physical audio device, no MIDI hardware, no human listening. Source of the code: the uploaded `b2buddy-foundation` snapshot (the GitHub repository `12Matt3r/b2buddy` was **not reachable** from this session).

## Commands and results
| Command | Result |
|---|---|
| `npx tsc --noEmit` / `npm run build` | passes, 3648 modules |
| `npm test` (vitest) | **33 passed, 0 failed**: core 17 (station, command port, battle flow, difficulty, challenges, tempo estimate), memory 6, MIDI 5, visuals 5 |
| `node e2e/run.mjs` (real Chromium) | **22 / 22 checks passed** |
| `node e2e/smoke.mjs` (real Chromium) | **5 / 5 passed** (tablet + narrow layout, user-file decode + estimate, visual shuffle/lock/hit, legacy studio) |
Raw: `e2e/out/report.json`, `e2e/out/smoke.json`, screenshots `e2e/out/*.png`.

What the browser run proves: the gate/menu/setup/arena flow works by clicking; READY without a track is refused; MATCH TEMPO sets the rate; the master output carries signal in a live round (peak below full scale after the limiter); **the volume fader at 0 silences the channel and LOW EQ at minimum lowers its peak (0.49 to 0.19)**: controls act on the real signal; Buddy produces signal on his own station; the round ends itself and both players are scored from measurements with reasons and zero refused AI commands; rematch resets; practice play/pause; five cameras; MIDI API detection and a clear status; the Beginner battle produces an approval request that changes nothing until approved, then becomes an active preference that survives a reload; a user-supplied WAV decodes and the tempo estimate (120.1 BPM for a 120 BPM click track) is labelled "estimated".
What it does **not** prove: that anything *sounds* good, MIDI hardware, other browsers, public hosting.

## Requirement matrix (from the build brief)
Legend: DONE-B = done and exercised in the browser run; DONE-U = done, unit-tested only; PART = partly; NO = not built; UNVER = built but unverified.

| # | Requirement | Status | Evidence / note |
|---|---|---|---|
| A | Menu (Play, Practice, DJ Battle, Library, Buddy Training, Settings, Credits) | DONE-B | `02-menu.png` |
| A | Retro-futuristic arena, two facing stations, responsive desktop/tablet | DONE-B | `04-live.png`, `layout-tablet.png`; no horizontal overflow at 1024 and 700 px |
| A | Loading / error / empty-library / audio-permission / unsupported-browser states | PART | gate (permission), unsupported-browser, audio error, decode error, empty library, blocked/corrupt storage messages exist; the first three are exercised, the others by code path/unit test |
| B | Load/play/pause/cue two decks | PART | **one deck + mixer per side** (standard format, Deck B covered); play/pause/cue DONE-B |
| B | Position and truthful display | PART | position bar, phrase bar and time; live signal scope. **No track-overview waveform** |
| B | Tempo, beat alignment tools | DONE-B | tempo fader, MATCH TEMPO, START ON BEAT, ALIGN |
| B | Crossfader | NO | meaningless with one deck per side |
| B | Channel volume, 3-band EQ, filter | DONE-B | volume and EQ effect measured |
| B | Effects, loops, hot cues, beat jumps | NO | |
| B | Keyboard + mouse | DONE-B | mouse paths clicked; key map implemented, keys not driven in the browser run |
| B | Web MIDI: detect, permission, learn, persist, disconnect/reconnect, keyboard fallback | DONE-U + UNVER | service tested against fake MIDIAccess; real browser: API present, permission denied in headless; **no hardware test** |
| B | Lawful tracks | DONE-B | bundled audio is generated in-page; user files local only |
| B | Not visual-only | DONE-B | measured |
| C | Buddy: observe, choose, strategy, real actions, adjust, explain, respect prefs/constraints | DONE-B/U | rule-based, validated command port, decision log with evidence; no LLM |
| C | Metadata honesty (measured/manual/estimated/unavailable) | DONE-B | badges everywhere; estimate labelled |
| D | One complete local battle, configurable rounds, count-in, live score, breakdown, rematch, difficulty, practice | DONE-B | difficulty effect: unit tests (means 31 / 79 / 99), Beginner + Intermediate seen in browser |
| D | Scoring explainable, no fake crowd/random | DONE-B | `breakdown` reasons; no randomness; crowd decorative and labelled |
| E | Challenge framework + subset | PART | framework + Standard + Thirty-Second Switch (unit); other 5 planned, see roadmap |
| 4 | Memory & growth: rules, DJ profile, history, supervisor panel (mission, edit/delete, growth log, drift, approvals, rollback) | DONE-B/U | rules fixed read-only; prefs editable/disable/delete; proposals need approval; drift alerts; snapshots + rollback; JSON persistence |
| 4 | Real model training | NO | by design |
| 5 | Career, XP, venues, Ghost Producer, AI-vs-AI, spectators, online | NO | roadmap only |
| 2 | Visual switcher: DJ1, DJ2, overhead, crowd, wide; video shaders only on video | PART | five views + CSS FX on video only; SHUFFLE VISUALS / LOCK / HIT IT (curated looks, beat-quantized) DONE-B; **Trippy Cam / VJ Pro / BENDR shaders not wired** (see THIRD-PARTY-AUDIT) |
| 1 | Chroma Awards rules established | UNVER | rules not available; nothing assumed |
| 1 | Git: main + develop + feature branch, checkpoints | PART | local only, see below |
| - | Deployment instructions | DONE | `docs/DEPLOYMENT.md` |
| - | Audio engine preserved | PART | the foundation's audio was a bare Tone.Player; the legacy studio is untouched and reachable; the game uses a new Web Audio engine, with the ear-tested C#/Unity engine as a separate codebase |

## Git state
See the final report in chat (branches, commits, tags, push status are stated there because they change).
