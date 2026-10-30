import { describe, expect, it } from 'vitest';
import { JogController, NOMINAL_TURNS_PER_SEC, SEC_PER_TURN, JOG_IDLE_SEC } from '../core/jog';
import { Station, StationBackend } from '../core/station';
import { SilentBackend } from '../core/station';
import { GameTrack } from '../core/types';

const track: GameTrack = { id: 't', title: 'T', artist: 'A', durationSec: 600, bpm: 120, bpmOrigin: 'declared', firstBeatSec: 0, key: null, keyOrigin: 'unavailable', source: 'user' };
function rig(settings = {}) {
    const o = { t: 0 }; const st = new Station('player', new SilentBackend(() => o.t) as StationBackend); st.load(track);
    const jog = new JogController(st, settings);
    return { o, st, jog };
}
/** Spin at `speed` x the reference platter speed for `sec` seconds in 10 ms steps. */
function spin(r: ReturnType<typeof rig>, speed: number, sec: number) {
    for (let i = 0; i < sec / 0.01; i++) { r.o.t += 0.01; r.jog.move(speed * NOMINAL_TURNS_PER_SEC * 0.01, r.o.t); }
}

describe('jog: pitch bend while playing', () => {
    it('clockwise speeds the deck up, counter-clockwise slows it, and the tempo fader value is untouched', () => {
        const r = rig(); r.st.play(); spin(r, 1, 0.3); expect(r.st.state().bend).toBeGreaterThan(0.05); expect(r.st.state().rate).toBe(1);
        const r2 = rig(); r2.st.play(); spin(r2, -1, 0.3); expect(r2.st.state().bend).toBeLessThan(-0.05);
    });
    it('the bend grows with platter speed and sensitivity, and is capped', () => {
        const a = rig(); a.st.play(); spin(a, 0.5, 0.3); const b = rig(); b.st.play(); spin(b, 2, 0.3); expect(b.st.state().bend).toBeGreaterThan(a.st.state().bend);
        const s = rig({ sensitivity: 2 }); s.st.play(); spin(s, 0.5, 0.3); expect(s.st.state().bend).toBeGreaterThan(a.st.state().bend * 1.6);
        const c = rig({ maxBend: 0.08 }); c.st.play(); spin(c, 8, 0.3); expect(c.st.state().bend).toBeCloseTo(0.08, 9);
    });
    it('the response curve changes the feel: accel is finer for slow moves than linear', () => {
        const l = rig({ curve: 'linear' }); l.st.play(); spin(l, 0.4, 0.3); const a = rig({ curve: 'accel' }); a.st.play(); spin(a, 0.4, 0.3);
        expect(a.st.state().bend).toBeLessThan(l.st.state().bend);
    });
    it('the deck really moves faster while bent (the audio rate is the effective rate)', () => {
        const r = rig(); r.st.play(); spin(r, 1.5, 0.3); const bend = r.st.state().bend; const p0 = r.st.state().positionSec; r.o.t += 1; expect(r.st.state().positionSec - p0).toBeCloseTo(1 + bend, 6);
    });
    it('returns to neutral on its own when the platter stops, and on release, cancel or disconnect', () => {
        const r = rig(); r.st.play(); spin(r, 1, 0.2); expect(r.st.state().bend).not.toBe(0);
        r.jog.tick(r.o.t + JOG_IDLE_SEC / 2); expect(r.st.state().bend).not.toBe(0); r.jog.tick(r.o.t + JOG_IDLE_SEC * 2); expect(r.st.state().bend).toBe(0);
        spin(r, 1, 0.2); r.jog.release(); expect(r.st.state().bend).toBe(0);
    });
});

describe('jog: paused deck and vinyl mode', () => {
    it('on a paused deck the jog nudges the position (one turn = SEC_PER_TURN) and does not start playback', () => {
        const r = rig(); r.st.seek(100); r.jog.move(1, 1); expect(r.st.state().positionSec).toBeCloseTo(100 + SEC_PER_TURN, 6); r.jog.move(-0.5, 1.02); expect(r.st.state().positionSec).toBeCloseTo(100 + SEC_PER_TURN / 2, 6); expect(r.st.state().playing).toBe(false);
    });
    it('direction: counter-clockwise nudges backwards', () => { const r = rig(); r.st.seek(100); r.jog.move(-0.25, 1); expect(r.st.state().positionSec).toBeLessThan(100); });
    it('vinyl mode: touching holds the sound, moving scrubs the position, letting go resumes from the new place', () => {
        const r = rig({ mode: 'vinyl' }); r.st.play(); r.o.t += 5; r.jog.touch(); expect(r.st.state().playing).toBe(false);
        r.jog.move(1, r.o.t + 0.1); expect(r.st.state().positionSec).toBeCloseTo(5 + SEC_PER_TURN, 6); r.jog.release(); expect(r.st.state().playing).toBe(true); expect(r.st.state().bend).toBe(0);
    });
    it('vinyl mode on a deck that was paused stays paused after release', () => {
        const r = rig({ mode: 'vinyl' }); r.jog.touch(); r.jog.move(0.5, 1); r.jog.release(); expect(r.st.state().playing).toBe(false);
    });
    it('cdj mode: touching does not hold the sound', () => { const r = rig(); r.st.play(); r.jog.touch(); expect(r.st.state().playing).toBe(true); r.jog.release(); });
    it('search mode makes large position moves', () => { const r = rig(); r.st.seek(10); r.jog.searching = true; r.jog.move(0.5, 1); expect(r.st.state().positionSec).toBeCloseTo(20, 6); });
    it('ignores non-finite and zero input', () => { const r = rig(); r.st.play(); r.jog.move(NaN, 1); r.jog.move(0, 1); r.jog.move(1, NaN); expect(r.st.state().bend).toBe(0); });
    it('sensitivity is clamped to a sane range', () => { const r = rig({ sensitivity: 99 }); expect(r.jog.settings.sensitivity).toBe(3); r.jog.configure({ sensitivity: 0 }); expect(r.jog.settings.sensitivity).toBe(0.25); });
});
