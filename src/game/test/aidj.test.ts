import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { calculateDynamicOverlap, calculateKeyCompatibility, CAMELOT_TO_KEY, normTrack, planTransition, rankNext, AidjTrack } from '../dj/aidjCore';

interface Golden {
    fork: string; keyMap: Record<string, string>; keyCompat: Array<[string, string, number]>;
    overlap: Array<{ a: AidjTrack; b: AidjTrack; overlapSec: number }>; plan: Array<{ current: AidjTrack; next: AidjTrack; result: unknown }>;
    rank: Array<{ previous: AidjTrack; candidates: AidjTrack[]; avoid: string[]; result: unknown }>;
}
// produced by running the fork's REAL Python through services/aidj/core.py (make_golden.py)
const G = JSON.parse(readFileSync(resolve(__dirname, 'fixtures/aidj-golden.json'), 'utf8')) as Golden;

describe('AI DJ decision core (TypeScript port) equals the fork\'s Python on golden vectors', () => {
    it('was generated from the pinned fork commit', () => { expect(G.fork).toBe('d56bd28c772f713ae39fc9ac33d0b555b98e1ce4'); });
    it('Camelot code -> note key table is identical to the Python adapter', () => { expect(CAMELOT_TO_KEY).toEqual(G.keyMap); });
    it(`key compatibility, all ${625} key pairs`, () => { expect(G.keyCompat.length).toBe(625); for (const [a, b, v] of G.keyCompat) expect(calculateKeyCompatibility(a, b), `${a}->${b}`).toBe(v); });
    it('dynamic overlap, 300 track pairs (BPM gaps, keys, genres)', () => { for (const c of G.overlap) expect(calculateDynamicOverlap(normTrack(c.a), normTrack(c.b))).toBe(c.overlapSec); });
    it('transition plans, 300 cases: every candidate score, ordering, chosen time, overlap, key score', () => { expect(G.plan.length).toBe(300); G.plan.forEach((c, i) => expect(planTransition(c.current, c.next), `case ${i}`).toEqual(c.result)); });
    it('next-track ranking, 60 cases with avoid lists', () => { G.rank.forEach((c, i) => expect(rankNext(c.previous, c.candidates, new Set(c.avoid)), `case ${i}`).toEqual(c.result)); });
    it('the golden set really exercises the scorer (varied scores, with and without candidates)', () => {
        const scores = new Set<number>(); let empty = 0; for (const c of G.plan) { const r = c.result as { candidates: Array<{ score: number }> }; r.candidates.forEach(k => scores.add(k.score)); if (!r.candidates.length) empty++; }
        expect(scores.size).toBeGreaterThan(15); expect(empty).toBeGreaterThan(10);
    });
});
