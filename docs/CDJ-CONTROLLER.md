# CDJ-style controller: what it is, how to use it, what is and is not verified

Inspired by the workflow of a Pioneer CDJ-3000 (player) and DJM-900NXS2 (mixer). It is **not** a Pioneer product, uses no Pioneer artwork, and is not certified by Pioneer. See `CDJ-AUDIT.md` for the before-state.

## What is on the player's deck (all of it drives the real `Station`, the same code MIDI, keyboard and tests use)
| Control | Behaviour |
|---|---|
| **Jog wheel** | Drag around the wheel (mouse or touch, pointer capture). Playing: **pitch bend** proportional to platter speed (`CDJ` mode). Paused: fine **position nudge** (one turn = 1.8 s). `VINYL` mode: touching holds the sound, moving scrubs silently, letting go resumes. Search (hold the mapped control): 20 s per turn. Sensitivity 0.25-3, linear/accel curve, max bend. Idle for 0.12 s, pointer lost, window blur, device unplugged: bend returns to 0. |
| **CUE** | Playing: back to the cue point and stop. Paused away from it: **sets** the cue point there. Paused at it: plays while held, returns on release; PLAY while holding keeps playing. The old `cue()` (keyboard `C` is now press/release; the AI and MIDI "Cue" trigger keep the old return-and-stop). |
| **Hot cues A-H** | Empty pad stores the position; set pad jumps (paused: plays while held, returns on release). SHIFT + pad or right-click clears. Saved per track in `localStorage` (`b2buddy.cues.v1`). |
| **Beat jump** | 1/2 ... 64 beats, back/forward, from the track's BPM and beat grid; a running loop moves with the jump. Refused (with a message) when the BPM is unknown. |
| **Loops** | IN / OUT, AUTO (selected size 1/4 ... 32 beats, toggles), EXIT / RELOOP, ½, 2×, **ROLL** (loop while held, then resume where the music would have been). Applied live to the audio source (no restart, so no click) unless the playhead is on the loop end. |
| **Quantize** | Snaps new cue points, hot cues and loop points to the beat grid when a BPM is known. It does **not** delay a trigger to the next beat. |
| **Tempo** | Fader range ±6 / ±10 / ±16 (the original) / WIDE ±50 %. **BEND − / +** hold buttons (±8 %). Bend is a separate multiplier, so the scorer still reads the fader value. |
| **Track display** | A real waveform from the decoded audio: scrolling ±4 s view with beat grid (downbeats brighter), cue, hot cues, loop; whole-track overview you can click or drag to seek. Elapsed / remaining toggle. No beat grid is drawn when the BPM is unknown. |

Keyboard: Space play · C cue (hold) · Q W E R T Y U I hot cues A-H (hold) · Shift (with a pad: clear) · `,` `.` beat jump · L auto loop · X quantize · `-` `=` bend · M match tempo · B start on beat · A align · ←/→ tempo · 1/2/3 EQ kills · `[` `]` `\` filter.

## MIDI
Web MIDI (Chrome/Edge/Opera, HTTPS or localhost; Firefox needs an add-on, Safari has none). Settings → CONNECT MIDI → LEARN next to an action → move the control. Action kinds: trigger, continuous (faders/knobs, invertible), **hold** (press + release: cue, hot cues, bend, loop roll, shift, jog touch), **relative** (jog/encoder: two's-complement, offset-64 or sign-magnitude, invert, scale). Mappings are saved in named **profiles** (create / switch / delete, export / import); an old single mapping migrates into `Default`. A binding remembers its device name so two controllers with the same note numbers do not collide. Held buttons are released on unplug, window blur, learn and any mapping change.

Not built: controller-specific presets (none were available to test, so none are invented), pitch-bend-message jogs, LED/display feedback, 14-bit CCs, separate deck assignment (the player has one deck in this build; Deck B is off by design), headphone cue (browsers cannot route a separate output), USB-HID, Pro DJ Link. **Generic MIDI Learn is not native CDJ integration.**

## Evidence (this branch)
| Layer | Command | Result |
|---|---|---|
| Unit | `npm test` | all pass (deck 36 · jog 13 · MIDI 18 · waveform 4 · existing); deck tests checked with 6 deliberate bugs, each caught |
| Browser, whole CDJ workflow + fake MIDI | `node e2e/cdj.mjs` | 45/45 |
| Browser, earlier suites on the new panel | `e2e/run.mjs` 22/22, `smoke.mjs` 5/5, `show.mjs` 30/30 (one earlier show run failed once on an audio-level sample and did not reproduce in two reruns; cause not identified) | |
All browser runs: headless Chromium 153 on Linux, software GL. The fake MIDI controller goes through the app's real Web MIDI code, but it is not hardware.

## Known limits
- **No audible scratch.** The engine cannot play a held buffer backwards or resample it live. Jog = pitch bend (playing), silent scrub (touched, vinyl) or nudge (paused).
- **No key lock / time stretch.** Tempo and bend change `playbackRate`, so pitch moves with speed.
- Loop and cue positions are in track seconds; two different files with the same name and rounded length share saved cues.
- Loop restart (when the playhead sits on the loop end, halve/double past the playhead, roll end, beat jump, hot cue jump) restarts the audio source and can click; a live loop change inside the loop does not.
- Sync is the existing MATCH TEMPO (+ ALIGN): no automatic phase sync. Scoring is unchanged: it still measures what was played, including loops and jumps.

## Manual checklist (needs a person; none of this has been done)
Listening (headphones, real GPU not required): [ ] jog bend is smooth, no zipper noise · [ ] releasing returns to the original tempo by ear · [ ] hot-cue jumps and beat jumps land on the beat (compare against the metronome) · [ ] loops are seamless on a 4-beat loop · [ ] loop roll returns on the beat · [ ] no clicks on loop IN/OUT during playback · [ ] vinyl-mode hold/resume sounds acceptable.
Hardware (per controller; record make/model/OS/browser): [ ] device appears after CONNECT MIDI · [ ] jog direction correct, tune encoder format / scale · [ ] ticks-per-turn feels right (Settings, default 256) · [ ] pads set and trigger A-H · [ ] hold buttons release when let go · [ ] unplug while holding a button leaves nothing stuck · [ ] fader / crossfader scaling · [ ] reconnect works. Report any controller that sends pitch-bend or 14-bit jog data.
Touch: [ ] jog and pads on a tablet (multi-touch: one finger on the jog and one on a pad).
