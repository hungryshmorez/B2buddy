# Roadmap: challenge formats

Framework (built): `src/game/core/challenges.ts`. A challenge is `{ id, name, description, weights, requires(library, roundSec), objective?(ctx), switchEverySec? }`. The battle engine, scorer, AI and menu read the registry; adding a challenge means adding one object to `CHALLENGES`. A challenge that cannot run returns a reason; it never silently becomes another challenge.

| Challenge | Status | What it needs |
|---|---|---|
| Standard Round | **built, tested** | - |
| Thirty-Second Switch | **built, tested** (unit; not clicked through in the browser run) | - |
| BPM Extremes | planned | Tracks with known BPM spread (library already carries BPM + origin); rule: one low-tempo and one high-tempo track; objective: both mixed in tempo-matched; `requires` checks BPM range. |
| Drop for Drop | planned | **Drop positions per track** (not in the data yet): add `drops: number[]` (seconds) with an origin label (declared/manual/estimated); objective: land your drop within N beats of the opponent's, measured from station events. Needs a drop-marking tool in Track Library. |
| Instrumental vs Vocal | planned | Per-track `vocal: 'vocal' \| 'instrumental'` metadata (manual or declared; no reliable in-browser detection yet). `requires` refuses to start without both kinds. |
| Call and Response | planned | A phrase-grid rule: players alternate 4-bar phrases (turn indicator from the master clock); objective scores activity only in your own phrase window. Needs an "activity" signal per station (EQ/filter/volume moves and track launches are already evented). |
| Comeback Round | planned | Round-N rule using results history: the trailing player gets a handicap (e.g. wider alignment tolerance) or a bonus objective; weights are data, so it is a `Challenge` with `weights` computed from `session.results`. |

Order of work: BPM Extremes (no new data) > Call and Response (clock only) > Comeback (history only) > Instrumental/Vocal and Drop for Drop (need metadata tooling).
