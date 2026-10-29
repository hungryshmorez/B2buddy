import { describe, expect, it } from 'vitest';
import { beatsInWindow, computeWave, windowPeaks } from '../core/waveform';

describe('waveform data', () => {
    it('is computed from the real samples: a burst shows up exactly where it is', () => {
        const sr = 1000; const d = new Float32Array(3000); for (let i = 1000; i < 1100; i++) d[i] = i % 2 ? 0.8 : -0.6;
        const w = computeWave(d, sr, 100); expect(w.durationSec).toBeCloseTo(3, 9); expect(w.max.length).toBe(300);
        expect(w.max[100]).toBeCloseTo(0.8, 6); expect(w.min[100]).toBeCloseTo(-0.6, 6); expect(w.max[109]).toBeCloseTo(0.8, 6); expect(w.max[99]).toBe(0); expect(w.max[110]).toBe(0);
    });
    it('silence and empty input are flat, not errors', () => {
        expect(Math.max(...computeWave(new Float32Array(500), 1000).max)).toBe(0);
        const e = computeWave(new Float32Array(0), 44100); expect(e.durationSec).toBe(0); expect(e.max.length).toBe(1); expect(() => computeWave([], 0)).not.toThrow();
    });
    it('window peaks follow the requested range and leave outside-of-track columns empty', () => {
        const sr = 1000; const d = new Float32Array(2000); d[500] = 0.9; const w = computeWave(d, sr, 100);
        const p = windowPeaks(w, -1, 3, 8); expect(p.slice(0, 2)).toEqual([null, null]); expect(p[3]?.hi).toBeCloseTo(0.9, 6);
        expect(p[2]?.hi).toBe(0); expect(p[7]).toBeNull();
    });
    it('the beat grid comes from the BPM and first beat, marks downbeats, and is empty without a BPM', () => {
        const b = beatsInWindow(120, 0.25, 0, 3); expect(b.map(x => x.t)).toEqual([0.25, 0.75, 1.25, 1.75, 2.25, 2.75]); expect(b.map(x => x.downbeat)).toEqual([true, false, false, false, true, false]);
        expect(beatsInWindow(null, 0, 0, 10)).toEqual([]); expect(beatsInWindow(0, 0, 0, 10)).toEqual([]);
        expect(beatsInWindow(120, 0.25, 100, 101).map(x => x.t)).toEqual([100.25, 100.75]);
    });
});
