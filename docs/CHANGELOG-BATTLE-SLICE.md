# Changelog: playable battle vertical slice

Baseline: `b2buddy-foundation` snapshot, committed unmodified as the first commit. All existing files are preserved; the original studio is still reachable ("STUDIO (legacy)").

## Added (all under `src/game/`, plus `e2e/`, `docs/`, `public/favicon.svg`, `vitest.config.ts`)
- `core/`: `station` (deck+channel arithmetic shared by real audio and tests), `clock` (one master clock), `scoring` (measured, explained), `battle` (count-in, live, round end, best-of, rematch), `commands` (validated port: the AI's only handle), `challenges` (framework + Standard + Thirty-Second Switch), `tempo`, `analysis` (BPM estimate), `types`.
- `ai/buddy.ts`: rule-based DJ with Beginner/Intermediate/Expert profiles, decision log with evidence.
- `memory/`: store (rules, preferences, proposals, experience, drift, snapshots, persistence), supervisor (lessons from measurements, corrections, drift checks).
- `midi/midi.ts`: Web MIDI service (capability/permission states, hot-plug, MIDI Learn, persistence, import/export).
- `audio/`: Web Audio backend (EQ, filter, volume, master limiter), procedural demo tracks, catalog.
- `runtime.ts` + `ui/`: game runtime, screens (gate, menu, setup, arena, library, training, settings, credits), station panels, camera/VJ canvas, CRT styling.
- Tests: `src/game/test/*.test.ts` (28), `e2e/run.mjs`, `e2e/smoke.mjs`.
## Modified
- `src/main.tsx` renders the game shell (the original `App` is lazy-loaded from it); `index.html` title + favicon; `package.json` scripts `test`, `e2e` and dev dependencies `vitest`, `@playwright/test`.
## Removed
- Nothing.
