import { describe, expect, it } from 'vitest';
import { candidates, compatible, DEFAULT_LOOK, flashAt, Group, hitTime, Look, shuffle } from '../ui/visuals';
import { MasterClock } from '../core/clock';

const rng = (seed: number) => () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };

describe('visual shuffle / lock / hit it', () => {
    it('only ever produces curated, compatible looks, and always a different one', () => {
        let l: Look = DEFAULT_LOOK; const r = rng(7);
        for (let i = 0; i < 300; i++) { const n = shuffle(l, new Set(), r); expect(compatible(n.look)).toBe(true); expect(JSON.stringify(n.look)).not.toBe(JSON.stringify(l)); l = n.look; }
    });
    it('locked groups never change, however many times it shuffles', () => {
        const locked = new Set<Group>(['palette', 'camera']); let l: Look = { palette: 2, fx: 'crt', motion: 0, camera: 'crowd' }; const r = rng(3); const seen = new Set<string>();
        for (let i = 0; i < 200; i++) { l = shuffle(l, locked, r).look; expect(l.palette).toBe(2); expect(l.camera).toBe('crowd'); seen.add(l.fx + l.motion); }
        expect(seen.size).toBeGreaterThan(3);                          // the unlocked groups really vary
    });
    it('explains itself when the locks leave nothing to shuffle', () => {
        const cur: Look = { palette: 0, fx: 'crt', motion: 0, camera: 'wide' }; const all = new Set<Group>(['palette', 'fx', 'motion', 'camera']);
        expect(candidates(cur, all)).toHaveLength(1); const s = shuffle(cur, all, rng(1)); expect(s.look).toEqual(cur); expect(s.note).toMatch(/unlock/);
    });
    it('quantized hits land exactly on the next beat of the shared clock; unquantized are immediate', () => {
        const c = new MasterClock(120, 4, 10);                          // beats every 0.5 s starting at t=10
        expect(hitTime(10.1, c, true)).toBeCloseTo(10.5, 9); expect(hitTime(10.5, c, true)).toBeCloseTo(10.5, 9); expect(hitTime(3, c, true)).toBeCloseTo(3, 9);
        expect(hitTime(10.1, c, false)).toBe(10.1); expect(hitTime(10.1, null, true)).toBe(10.1);
    });
    it('flash starts at the hit, decays, and is zero before and after', () => {
        expect(flashAt(9, 10)).toBe(0); expect(flashAt(10, 10)).toBe(1); expect(flashAt(10.175, 10)).toBeCloseTo(0.5, 2); expect(flashAt(10.4, 10)).toBe(0); expect(flashAt(5, null)).toBe(0);
    });
});
