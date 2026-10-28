import { describe, expect, it } from 'vitest';
import { PerfMeter, formatReport, ratePerSec, summarize } from '../perf';

describe('perf meter', () => {
    it('reports fps, p95 and long frames from real frame deltas', () => {
        const s = summarize([16, 16, 16, 16, 100]);
        expect(s.frames).toBe(5); expect(s.worstMs).toBe(100); expect(s.longFrames).toBe(1);
        expect(s.fps).toBeCloseTo(1000 / 32.8, 3); expect(s.p95Ms).toBe(100);
    });
    it('an empty meter reports zeros, not a made-up number', () => {
        expect(summarize([])).toEqual({ frames: 0, fps: 0, avgMs: 0, p95Ms: 0, worstMs: 0, longFrames: 0 });
    });
    it('PerfMeter ignores the first tick (no delta yet) and keeps a bounded window', () => {
        const m = new PerfMeter(3); m.tick(1000); expect(m.summary().frames).toBe(0);
        for (let i = 1; i <= 10; i++) m.tick(1000 + i * 20);
        const s = m.summary(); expect(s.frames).toBe(3); expect(s.avgMs).toBeCloseTo(20, 6); expect(s.fps).toBeCloseTo(50, 6);
    });
    it('ratePerSec needs two samples and a counter that did not go backwards', () => {
        expect(ratePerSec(null, 10, 1000)).toBe(0);
        expect(ratePerSec({ n: 10, at: 1000 }, 40, 2000)).toBe(30);
        expect(ratePerSec({ n: 40, at: 1000 }, 10, 2000)).toBe(0);
    });
    it('the report states measurements and what it could not measure', () => {
        const t = formatReport({ gameFps: summarize([16, 17]), bendrFps: null, engine: 'canvas effects', effect: '', audioBaseMs: null, audioOutMs: 12, renderer: 'test GPU', userAgent: 'ua', build: 'x' });
        expect(t).toContain('BENDR output: not running'); expect(t).toContain('base n/a'); expect(t).toContain('output 12 ms'); expect(t).toContain('test GPU');
    });
});
