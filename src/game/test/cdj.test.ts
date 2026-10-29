import { describe, expect, it } from 'vitest';
import { Station, StationBackend } from '../core/station';
import { StorageCueStore } from '../core/cueStore';
import { MemoryStorage } from '../memory/store';
import { GameTrack, LoopSpan } from '../core/types';
import { DEMO_TRACKS } from '../audio/catalog';

const track = (over: Partial<GameTrack> = {}): GameTrack => ({ id: 't1', title: 'T', artist: 'A', durationSec: 600, bpm: 120, bpmOrigin: 'declared', firstBeatSec: 0.25, key: null, keyOrigin: 'unavailable', source: 'user', ...over });

/** A silent backend that records what the audio layer would be told, so tests can prove the audio follows the station. */
class Rec implements StationBackend {
    constructor(private readonly clock: () => number) {}
    now() { return this.clock(); } onLoad() {} onParam() {}
    calls: string[] = []; starts: Array<{ off: number; rate: number }> = []; loops: Array<LoopSpan | null> = []; rates: number[] = [];
    onStart(off: number, rate: number) { this.starts.push({ off, rate }); this.calls.push('start'); }
    onStop() { this.calls.push('stop'); }
    onRate(r: number) { this.rates.push(r); }
    onLoop(l: LoopSpan | null) { this.loops.push(l); }
}
function rig(t: GameTrack = track(), store?: StorageCueStore) {
    const o = { t: 0 }; const b = new Rec(() => o.t); const st = new Station('player', b, store); st.load(t);
    return { o, b, st, adv(s: number) { o.t += s; } };
}

describe('pitch bend and nudge', () => {
    it('bend is a temporary multiplier: position moves at rate x (1+bend), the tempo fader value never changes, release restores it', () => {
        const { st, adv } = rig(); st.play(); adv(10); expect(st.state().positionSec).toBeCloseTo(10, 6);
        st.setBend(0.1); expect(st.state().rate).toBe(1); expect(st.state().bend).toBeCloseTo(0.1, 9);
        adv(10); expect(st.state().positionSec).toBeCloseTo(21, 6);          // 10 s at 1.0 then 10 s at 1.1
        st.setBend(0); adv(10); expect(st.state().positionSec).toBeCloseTo(31, 6);
    });
    it('the audio layer is told the effective rate', () => {
        const { st, b } = rig(); st.play(); st.setRate(1.05); st.setBend(-0.1);
        expect(b.rates[b.rates.length - 1]).toBeCloseTo(1.05 * 0.9, 9);
    });
    it('bend is clamped and refuses bad input; a disabled deck refuses it', () => {
        const { st } = rig(); expect(st.setBend(NaN)).toBe(false); st.setBend(9); expect(st.state().bend).toBe(0.5);
        st.enabled = false; expect(st.setBend(0.1)).toBe(false);
    });
    it('nudge moves a paused deck and a playing one (the audio restarts at the new place)', () => {
        const { st, b, adv } = rig(); st.seek(100); st.nudge(0.5); expect(st.state().positionSec).toBeCloseTo(100.5, 9);
        st.play(); adv(1); st.nudge(-2); expect(st.state().positionSec).toBeCloseTo(99.5, 6); expect(b.starts[b.starts.length - 1].off).toBeCloseTo(99.5, 6);
    });
    it('nudge clamps at the start of a track and wraps inside a bundled loop', () => {
        const a = rig(); a.st.nudge(-5); expect(a.st.state().positionSec).toBe(0);
        const d = DEMO_TRACKS[0]; const r = rig({ ...d }); r.st.nudge(-0.1); expect(r.st.state().positionSec).toBeCloseTo(d.loopSec! - 0.1, 6);
    });
    it('scrubbing holds the sound and resumes from the new place', () => {
        const { st, adv } = rig(); st.play(); adv(5); expect(st.scrubHold()).toBe(true); expect(st.state().playing).toBe(false);
        adv(3); st.nudge(10); st.scrubRelease(); expect(st.state().playing).toBe(true); expect(st.state().positionSec).toBeCloseTo(15, 6);
    });
});

describe('cue behaviour', () => {
    it('the original cue() contract is unchanged: stop and go to the cue point', () => {
        const { st, adv } = rig(); st.play(); adv(20); st.cue(); expect(st.state().playing).toBe(false); expect(st.state().positionSec).toBeCloseTo(0.25, 9);
    });
    it('CUE while playing returns to the cue point and stops', () => {
        const { st, adv } = rig(); st.setCue(5); st.play(); adv(20); expect(st.cuePress()).toBe('return'); expect(st.state().playing).toBe(false); expect(st.state().positionSec).toBe(5);
    });
    it('CUE on a paused deck away from the cue point sets a new cue point there', () => {
        const { st } = rig(); st.seek(42); expect(st.cuePress()).toBe('set'); expect(st.state().cueSec).toBe(42); expect(st.state().playing).toBe(false);
    });
    it('CUE held on a paused deck at the cue point previews, and releasing returns and stops', () => {
        const { st, adv } = rig(); st.setCue(10); st.seek(10);
        expect(st.cuePress()).toBe('preview'); expect(st.state().playing).toBe(true); expect(st.state().previewing).toBe(true);
        adv(2); expect(st.state().positionSec).toBeCloseTo(12, 6);
        st.cueRelease(); expect(st.state().playing).toBe(false); expect(st.state().positionSec).toBe(10); expect(st.state().previewing).toBe(false);
    });
    it('pressing PLAY while previewing keeps it playing (CDJ cue-play) and release no longer stops it', () => {
        const { st, adv } = rig(); st.setCue(10); st.seek(10); st.cuePress(); adv(1); st.play(); st.cueRelease(); adv(1);
        expect(st.state().playing).toBe(true); expect(st.state().positionSec).toBeGreaterThan(11.9);
    });
});

describe('quantize', () => {
    it('snaps new cue points to the nearest beat of the grid when on, and leaves them alone when off', () => {
        const { st } = rig(); st.seek(10.6); st.setCue(); expect(st.state().cueSec).toBeCloseTo(10.6, 9);   // off
        st.setQuantize(true); st.setCue(10.6); expect(st.state().cueSec).toBeCloseTo(10.75, 9);            // grid: 0.25 + k*0.5
    });
    it('does nothing to positions when the track has no BPM (never invents a grid)', () => {
        const { st } = rig(track({ bpm: null, bpmOrigin: 'unavailable' })); st.setQuantize(true); st.setCue(10.6); expect(st.state().cueSec).toBeCloseTo(10.6, 9);
    });
});

describe('hot cues A-H', () => {
    it('an empty pad stores the position, a set pad jumps there (playing: the audio restarts there)', () => {
        const { st, b, adv } = rig(); st.play(); adv(7); expect(st.hotCuePress(2)).toBe('set'); expect(st.state().hotCues[2]).toBeCloseTo(7, 6);
        adv(30); expect(st.hotCuePress(2)).toBe('jump'); expect(st.state().positionSec).toBeCloseTo(7, 6); expect(b.starts[b.starts.length - 1].off).toBeCloseTo(7, 6);
    });
    it('all eight pads work independently', () => {
        const { st } = rig(); for (let i = 0; i < 8; i++) { st.seek(10 * (i + 1)); expect(st.hotCuePress(i)).toBe('set'); st.hotCueRelease(); }
        expect(st.state().hotCues).toEqual([10, 20, 30, 40, 50, 60, 70, 80]);
        st.play(); for (let i = 7; i >= 0; i--) { st.hotCuePress(i); expect(st.state().positionSec).toBeCloseTo(10 * (i + 1), 6); }
    });
    it('on a paused deck a set pad plays only while held and returns on release', () => {
        const { st, adv } = rig(); st.seek(30); st.hotCuePress(0); st.hotCueRelease(); st.seek(100);
        expect(st.hotCuePress(0)).toBe('preview'); adv(1.5); expect(st.state().positionSec).toBeCloseTo(31.5, 6); st.hotCueRelease(); expect(st.state().playing).toBe(false); expect(st.state().positionSec).toBe(30);
    });
    it('a pad can be cleared and bad indexes are refused', () => {
        const { st } = rig(); st.hotCuePress(1); expect(st.clearHotCue(1)).toBe(true); expect(st.state().hotCues[1]).toBeNull();
        expect(st.hotCuePress(8)).toBeNull(); expect(st.hotCuePress(-1)).toBeNull(); expect(st.clearHotCue(1)).toBe(false);
    });
    it('quantize snaps a newly stored pad to the beat grid', () => {
        const { st } = rig(); st.setQuantize(true); st.seek(20.4); st.hotCuePress(0); expect(st.state().hotCues[0]).toBeCloseTo(20.25, 9);
    });
    it('cues persist per track identity and are not attached to another track', () => {
        const storage = new MemoryStorage(); const s1 = new StorageCueStore(storage);
        const a = rig(track({ id: 'A' }), s1); a.st.seek(11); a.st.hotCuePress(3); a.st.hotCueRelease(); a.st.seek(22); a.st.setCue();
        a.st.load(track({ id: 'B' })); expect(a.st.state().hotCues.every(h => h === null)).toBe(true); a.st.seek(5); a.st.hotCuePress(0); a.st.hotCueRelease();
        const s2 = new StorageCueStore(storage); const b = rig(track({ id: 'A' }), s2);                // a fresh page load
        expect(b.st.state().hotCues[3]).toBeCloseTo(11, 9); expect(b.st.state().hotCues[0]).toBeNull(); expect(b.st.state().cueSec).toBe(22);
        b.st.load(track({ id: 'B' })); expect(b.st.state().hotCues[0]).toBeCloseTo(5, 9); expect(b.st.state().hotCues[3]).toBeNull();
    });
    it('a track with no saved cues keeps the default cue (first beat) and the store ignores corrupt data', () => {
        const storage = new MemoryStorage(); storage.setItem('b2buddy.cues.v1', '{"version":1,"tracks":{"A":{"cue":"x","hot":[1,"y",-4,null,2]}}}');
        const a = rig(track({ id: 'A' }), new StorageCueStore(storage)); expect(a.st.state().hotCues.slice(0, 5)).toEqual([1, null, null, null, 2]); expect(a.st.state().cueSec).toBe(0.25);
        expect(() => new StorageCueStore({ getItem: () => '{not json', setItem() {}, removeItem() {} })).not.toThrow();
    });
});

describe('beat jump', () => {
    it('moves by whole beats of the real grid in both directions and the audio restarts there', () => {
        const { st, b, adv } = rig(); st.seek(100); st.play(); adv(0); expect(st.beatJump(8)).toBe(true); expect(st.state().positionSec).toBeCloseTo(104, 6); expect(b.starts[b.starts.length - 1].off).toBeCloseTo(104, 6);
        st.beatJump(-16); expect(st.state().positionSec).toBeCloseTo(96, 6); st.beatJump(0.5); expect(st.state().positionSec).toBeCloseTo(96.25, 6);
    });
    it('scales with the BPM (the same 4 beats are shorter in a faster track)', () => {
        const a = rig(track({ bpm: 150 })); a.st.seek(50); a.st.beatJump(4); expect(a.st.state().positionSec).toBeCloseTo(51.6, 6);
    });
    it('is refused without a BPM and does not move the deck', () => {
        const { st } = rig(track({ bpm: null, bpmOrigin: 'unavailable' })); st.seek(10); expect(st.beatJump(4)).toBe(false); expect(st.state().positionSec).toBe(10);
    });
    it('is refused past the start or end of a track, and wraps inside a bundled loop', () => {
        const a = rig(); a.st.seek(1); expect(a.st.beatJump(-8)).toBe(false); expect(a.st.state().positionSec).toBe(1);
        const d = DEMO_TRACKS[0]; const bl = 60 / d.bpm!; const r = rig({ ...d }); r.st.seek(0); r.st.beatJump(-1); expect(r.st.state().positionSec).toBeCloseTo(d.loopSec! - bl, 6);
    });
    it('keeps the phase: a whole-beat jump does not change where the playhead sits relative to the grid', () => {
        const { st, adv } = rig(); st.play(); adv(10.13); const phase = (p: number) => ((p - 0.25) / 0.5) % 1; const before = phase(st.state().positionSec);
        st.beatJump(32); expect(phase(st.state().positionSec)).toBeCloseTo(before, 6);
    });
});

describe('loops', () => {
    it('a 4-beat loop starts at the playhead, wraps the position, and tells the audio layer', () => {
        const { st, b, adv } = rig(); st.seek(100); st.play(); expect(st.loopBeats(4)).toBe(true);
        expect(b.loops[b.loops.length - 1]).toEqual({ start: 100, end: 102 }); adv(1.5); expect(st.state().positionSec).toBeCloseTo(101.5, 6);
        adv(1); expect(st.state().positionSec).toBeCloseTo(100.5, 6); adv(10); expect(st.state().positionSec).toBeGreaterThanOrEqual(100); expect(st.state().positionSec).toBeLessThan(102);
    });
    it('exit continues from where the playhead is, past the old loop end', () => {
        const { st, b, adv } = rig(); st.seek(100); st.play(); st.loopBeats(4); adv(1.5); st.exitLoop(); expect(b.loops[b.loops.length - 1]).toBeNull();
        adv(1); expect(st.state().positionSec).toBeCloseTo(102.5, 6); expect(st.state().loop?.active).toBe(false);
    });
    it('loop in / loop out make a manual loop of the played length; out before in is refused', () => {
        const { st, adv } = rig(); st.play(); adv(10); expect(st.loopOut()).toBe(false); st.loopIn(); adv(3); expect(st.loopOut()).toBe(true);
        expect(st.state().loop).toEqual({ start: 10, end: 13, active: true }); adv(1); expect(st.state().positionSec).toBeCloseTo(10.0 + 1, 3);
    });
    it('quantize snaps the loop points to the beat grid', () => {
        const { st } = rig(); st.setQuantize(true); st.seek(10.4); st.loopBeats(2); expect(st.state().loop).toEqual({ start: 10.25, end: 11.25, active: true });
    });
    it('halve and double change the real loop length; double is refused past the track end', () => {
        const { st } = rig(); st.seek(100); st.play(); st.loopBeats(8); st.loopHalve(); expect(st.state().loop).toEqual({ start: 100, end: 102, active: true });
        st.loopDouble(); st.loopDouble(); expect(st.state().loop).toEqual({ start: 100, end: 108, active: true });
        const e = rig(track({ durationSec: 101 })); e.st.seek(100); e.st.loopBeats(1); expect(e.st.loopDouble()).toBe(true); expect(e.st.loopDouble()).toBe(false);
    });
    it('reloop re-enters the stored loop and jumps to its start when the playhead is outside it', () => {
        const { st, adv } = rig(); st.seek(100); st.play(); st.loopBeats(4); st.exitLoop(); adv(50); st.reloop();
        expect(st.state().loop?.active).toBe(true); expect(st.state().positionSec).toBeGreaterThanOrEqual(100); expect(st.state().positionSec).toBeLessThan(102);
    });
    it('beat jump moves a running loop with the playhead', () => {
        const { st } = rig(); st.seek(100); st.play(); st.loopBeats(4); st.beatJump(8); expect(st.state().loop).toEqual({ start: 104, end: 106, active: true }); expect(st.state().positionSec).toBeCloseTo(104, 6);
    });
    it('seeking past the end of a running loop leaves it', () => {
        const { st } = rig(); st.seek(100); st.play(); st.loopBeats(4); st.seek(200); expect(st.state().loop?.active).toBe(false); expect(st.state().positionSec).toBeCloseTo(200, 6);
    });
    it('loop roll holds the loop while pressed, then returns to where the music would have been and restores the previous state', () => {
        const { st, adv } = rig(); st.seek(100); st.play(); adv(0.1); expect(st.rollStart(1)).toBe(true); expect(st.state().loop?.active).toBe(true);
        adv(3.0); expect(st.state().positionSec).toBeLessThan(101); st.rollEnd();
        expect(st.state().positionSec).toBeCloseTo(103.1, 6); expect(st.state().loop?.active ?? false).toBe(false); expect(st.rolling).toBe(false);
    });
    it('loops work inside a bundled loop track and without a BPM only manual in/out is available', () => {
        const d = DEMO_TRACKS[0]; const a = rig({ ...d }); a.st.play(); a.adv(1); expect(a.st.loopBeats(1)).toBe(true);
        const n = rig(track({ bpm: null, bpmOrigin: 'unavailable' })); n.st.play(); expect(n.st.loopBeats(4)).toBe(false); n.adv(2); n.st.loopIn(); n.adv(1); expect(n.st.loopOut()).toBe(true);
    });
    it('the AI-facing contract is untouched: StationControl has none of the CDJ methods in its CommandPort', async () => {
        const src = (await import('../core/commands')).CommandPort.toString();
        for (const m of ['hotCue', 'loop', 'beatJump', 'setBend', 'nudge', 'setQuantize']) expect(src.includes(m)).toBe(false);
    });
});
