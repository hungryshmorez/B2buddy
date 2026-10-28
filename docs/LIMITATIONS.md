# Known limitations (implemented vs not built vs unverified)

**Implemented and exercised in a real browser (Chromium 153 headless, Linux, http://localhost):** gate, menu, setup, standard battle vs Buddy (3 difficulties in unit tests; Intermediate and Beginner in the browser run), count-in, live round, measured scoring, results with reasons, rematch, practice mode, track library, user-file decode, BPM estimate (labelled estimated), supervisor approval flow, memory persistence across reload, five camera views and an effect switch, tablet and narrow layouts, legacy studio still opens.

**Implemented, tested only in unit tests (not in the browser run):** Expert difficulty and Thirty-Second Switch; preference effects on Buddy's plan; memory rollback, contradiction detection, corrupt-storage recovery; MIDI service against a **fake** MIDIAccess.

**Not verified at all:**
- **MIDI hardware.** No controller was attached. In headless Chromium `requestMIDIAccess` exists but the permission was *denied* (as expected without a user prompt), so the real grant path and real messages are untested. Do not call MIDI verified until the checklist is done with a device.
- Hearing the audio. Signal was read from analysers (levels, fader/EQ effect), not listened to. Output latency was not measured.
- Firefox, Safari, Edge, mobile browsers; any public hosting; the Chroma Awards rules (not available).

**Not built (shown honestly in the UI where relevant):**
- Dual Deck Showdown (four decks, two mixers) and shared-crossfader format in this React build (they exist in the Unity/C# core, a different codebase). The booth is standard format: one deck + mixer per side, Deck B covered.
- Effects (echo/reverb), loops, hot cues, beat jumps, sync button, crossfader (meaningless with one deck per side), waveform *overview* (the deck shows the live signal, not a track overview), key detection (keys of demo tracks are declared; user tracks have none), recording, PFL/headphone cue (browsers have one output).
- Jog/platter MIDI, MIDI output, key remapping UI.
- Crowd reaction and voting: none; the crowd is decoration (credits say so). No online play, spectators, chat, tournaments, career/XP, venues, Ghost Producer, AI-vs-AI exhibition.
- AI-DJ-Mixing-System could not be fetched or inspected here and nothing was ported; VJ Mixer Pro and Saucelab VJ have no licence so were not copied (see THIRD-PARTY-AUDIT).
- Trippy Cam / VJ Pro / Datamosh shader assets were inspected but **not wired in**: the camera switcher draws its own canvas scene with CSS CRT/VHS/RGB treatments on the video only. The foundation's `VJRenderer`/`MasterVideoOutput` live in the preserved legacy studio.
- Buddy's difficulty levels are tuned for a bot with sample-exact control: Expert scores about 99/100 and will beat most humans unless they use MATCH TEMPO and START ON BEAT.
- The BPM estimator is simple (onset autocorrelation); half/double-time errors are possible.
- Learning is preference weights + approval, not model training (by design). Only three preferences exist (wait for phrase, fade length, avoid filter).
- Scores measure timing, tempo, structure and technique, not taste.
