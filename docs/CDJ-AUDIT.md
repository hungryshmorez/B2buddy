# CDJ controller: baseline audit (before any CDJ change)

Taken on `develop` @ `0fbfebc`, branch `feature/cdj-controller`. Everything below was read from the code in this checkout; "verified" means a test or browser run in this session, not an assumption. The repository the brief names (`12Matt3r/b2buddy`) is not reachable from this session; the working repo is `hungryshmorez/B2buddy`.

## Runtime
Browser game: React 18 + TypeScript + Vite, Web Audio. No Unity code runs here (a Unity zip exists elsewhere; not part of this work). 72 unit tests passed at baseline (3 need the optional Python service). Live site is deployed from `main` and is **not touched** by this work.

## Audio architecture (kept as is)
`Station` (`core/station.ts`) is the single place that computes "what is playing, where" (offset + anchor + rate arithmetic), for real audio and for tests. `WebAudioBackend` makes it audible: `AudioBufferSourceNode` -> low shelf -> mid peak -> high shelf -> filter -> volume -> `MasterBus` (headroom, limiter, analyser, master). One station per side (`player` and `buddy`); each side has **one** deck. Buddy acts only through a validated `CommandPort`.

## Inventory: what exists on the player's deck
| Control | State in the baseline |
|---|---|
| Play/Pause, Cue (stop and return to the cue point), seek | exists (cue point defaults to the first beat; not user-settable) |
| Tempo fader | exists, fixed range about +-16%; changes `playbackRate`, so **musical pitch changes with tempo (no key lock)** |
| Match tempo (to the master clock), Start on beat, Align | exist (game assists, scored) |
| 3-band EQ, filter, channel volume, master volume, meters | exist |
| Waveform | **live oscilloscope of the output**, not a track waveform; no seeking |
| Beat grid | `bpm` + `firstBeatSec` per track, with an origin label (declared / measured / manual / estimated) |
| MIDI | Web MIDI, one binding per action, CC and note, learn / export / import (13 actions) |
| Keyboard | Space, C, M, B, A, Enter, arrows, 1/2/3 |

## Not in the baseline (the brief assumes some of these exist)
No jog wheel. **No hot cues** (the brief says "upgrade the four"; there are none in this build, so there is nothing to migrate). No beat jump. No user loops (only the bundled demo tracks wrap at their own phrase length). No cue preview. No quantize. No scrolling waveform, no cue/loop markers. No tempo-range choice. No pitch-bend. No relative-encoder, jog or hold-button MIDI, no controller profiles. No crossfader, headphone cue, or echo/reverb/flanger **in the game engine**: the two stations are opponents (player vs Buddy), not two decks of one mixer. Those belong to the legacy studio, which was not audited here.

## Constraints that shape the design
- `Station` stays the single source of truth; every new control is a `Station` method, so MIDI, mouse, keyboard and tests all run the same code.
- The AI's `CommandPort` gets **no** new commands: Buddy cannot touch the player's deck, and the player's CDJ features do not widen what the AI may do.
- Scoring reads `state().rate` and `positionSec`. Pitch bend is therefore a separate, temporary multiplier (`bend`), so a nudge never rewrites the tempo the scorer sees.
- The engine cannot do audible scratching (no grain/vinyl resampling of a held buffer). Jog gets honest pitch-bend (playing) and silent scrub/nudge (paused); scratch is documented as not implemented rather than faked.
- Track identity for saved cues is `GameTrack.id` (`user-<file name>-<seconds>` for files). Two different files with the same name and rounded duration would share cues: a known limitation.

## Plan (small, reversible commits)
1. Station: bend, nudge, hold, user loops, loop roll, beat jump, quantize, cue set/preview, 8 hot cues with a persisted store. Unit-tested.
2. Jog controller (pure logic: modes, sensitivity, curve, release) with tests.
3. MIDI: hold buttons, relative encoders, jog actions, per-device matching, profiles with v1 migration.
4. Real track waveform + scrolling view with beat grid, cues, loops, click-to-seek.
5. CDJ-style panel UI wired to all of the above; keyboard fallbacks.
6. Browser e2e for the whole workflow; manual listening/hardware checklist.
Out of scope for this pass, stated up front: pitch-preserving time stretch, audible scratch, headphone cue, extra mixer effects, Pro DJ Link / USB-HID, 4-channel mixing.
