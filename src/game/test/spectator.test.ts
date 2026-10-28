import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { CAMS, CROWD_Z_MAX, CROWD_Z_MIN, DJ_HEAD_Y, DJ_X, inFrame, POVS, project, viewDir } from '../ui/cameras';
import { datamoshFrame, eligibleEffects, FX_IDLE, FxState, randomEffect, toggleEffect, TRIPPY_EFFECTS } from '../fx/trippy';
import { FRACTAL_FRAGMENT, FRACTAL_VERTEX, LIQUID_FRAGMENT, LIQUID_VERTEX } from '../fx/trippyShaders';
import { Sim } from './sim';
import { BuddyAI } from '../ai/buddy';
import { CommandPort } from '../core/commands';
import { DEMO_TRACKS } from '../audio/catalog';

const rng = (seed: number) => () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
const head = (i: 0 | 1): [number, number, number] => [DJ_X[i], DJ_HEAD_Y, 0];

describe('the five cameras', () => {
    it('are exactly DJ 1 POV, DJ 2 POV, DJ 1 Overhead, DJ 2 Overhead and Crowd Camera', () => {
        expect(POVS.map(p => p.label)).toEqual(['DJ 1 POV', 'DJ 2 POV', 'DJ 1 Overhead', 'DJ 2 Overhead', 'Crowd Camera']);
    });
    it('the Crowd Camera stands inside the audience and looks at the stage, with both DJs in frame on opposite sides', () => {
        const c = CAMS.crowd; expect(c.pos[2]).toBeGreaterThan(CROWD_Z_MIN); expect(c.pos[2]).toBeLessThan(CROWD_Z_MAX);   // between the first and last rows
        expect(viewDir(c)[2]).toBeLessThan(-0.9);                                                                          // looking toward the stage, not at the crowd
        expect(inFrame(head(0), c)).toBe(true); expect(inFrame(head(1), c)).toBe(true);
        expect(project(head(0), c, 640, 300)![0]).toBeLessThan(320); expect(project(head(1), c, 640, 300)![0]).toBeGreaterThan(320);
        // spectators behind the camera are not drawn
        expect(project([0, 0.6, c.pos[2] + 1], c, 640, 300)).toBeNull();
    });
    it('each DJ POV looks from that DJ\'s station across the stage and sees the rival', () => {
        expect(CAMS.dj1.pos[0]).toBeLessThan(DJ_X[0]); expect(CAMS.dj2.pos[0]).toBeGreaterThan(DJ_X[1]);
        expect(viewDir(CAMS.dj1)[0]).toBeGreaterThan(0.5); expect(viewDir(CAMS.dj2)[0]).toBeLessThan(-0.5);
        expect(inFrame(head(1), CAMS.dj1)).toBe(true); expect(inFrame(head(0), CAMS.dj2)).toBe(true);
    });
    it('each overhead looks straight down at its own DJ\'s deck table, centred', () => {
        for (const [id, x] of [['dj1top', -1.4], ['dj2top', 1.4]] as const) {
            const c = CAMS[id]; expect(viewDir(c)[1]).toBeLessThan(-0.99); const p = project([x, 1, 0], c, 640, 300)!;
            expect(Math.abs(p[0] - 320)).toBeLessThan(140); expect(Math.abs(p[1] - 150)).toBeLessThan(100); expect(inFrame([x, 1, 0], c)).toBe(true);
        }
        expect(inFrame([DJ_X[0], 1.4, 0], CAMS.dj1top)).toBe(true); expect(inFrame([DJ_X[1], 1.4, 0], CAMS.dj1top)).toBe(false);     // DJ 1's overhead holds DJ 1, not the rival
        expect(inFrame([DJ_X[1], 1.4, 0], CAMS.dj2top)).toBe(true); expect(inFrame([DJ_X[0], 1.4, 0], CAMS.dj2top)).toBe(false);
    });
});

describe('RANDOM EFFECT and ON/OFF', () => {
    const all = eligibleEffects(true); const rnd = rng(5);
    it('random effect turns an effect on and never repeats the previous one while others exist', () => {
        let s: FxState = FX_IDLE; for (let i = 0; i < 300; i++) { const n = randomEffect(s, all, rnd)!; expect(n.on).toBe(true); if (s.id) expect(n.id).not.toBe(s.id); s = n; }
        const seen = new Set<string>(); for (let i = 0; i < 200; i++) { s = randomEffect(s, all, rnd)!; seen.add(s.id!); } expect(seen.size).toBe(TRIPPY_EFFECTS.length);
    });
    it('ON/OFF keeps the selected effect and brings the same one back', () => {
        const s = randomEffect(FX_IDLE, all, rnd)!; const off = toggleEffect(s, all, rnd)!; expect(off).toEqual({ id: s.id, on: false });
        expect(toggleEffect(off, all, rnd)).toEqual({ id: s.id, on: true });
    });
    it('turning ON with nothing selected selects a random effect; a lone eligible effect may repeat', () => {
        const n = toggleEffect(FX_IDLE, all, rnd)!; expect(n.on).toBe(true); expect(n.id).not.toBeNull();
        const one = [TRIPPY_EFFECTS[3]]; expect(randomEffect({ id: one[0].id, on: true }, one, rnd)).toEqual({ id: one[0].id, on: true });
        expect(randomEffect(FX_IDLE, [], rnd)).toBeNull(); expect(toggleEffect(FX_IDLE, [], rnd)).toBeNull();
    });
    it('without WebGL the shader effects drop out and the rest stay', () => {
        const e = eligibleEffects(false); expect(e.some(x => x.kind === 'webgl')).toBe(false); expect(e.length).toBe(TRIPPY_EFFECTS.length - 2);
    });
    it('every effect names the supplied file it came from', () => { for (const e of TRIPPY_EFFECTS) expect(e.source).toMatch(/\.(js|css)/); });
});

describe('supplied-asset fidelity', () => {
    it('the shader text is a verbatim copy of webgl-shaders.js', () => {
        const orig = readFileSync(resolve(__dirname, '../../../third_party/trippy_effects_for_trippy_me/webgl-shaders.js'), 'utf8');
        for (const t of [LIQUID_VERTEX, LIQUID_FRAGMENT, FRACTAL_VERTEX, FRACTAL_FRAGMENT]) expect(orig.includes(t)).toBe(true);
    });
    it('datamosh changes the picture, is deterministic for a seed, and keeps alpha', () => {
        const mk = () => { const d = new Uint8ClampedArray(160 * 90 * 4); for (let i = 0; i < d.length; i += 4) { d[i] = (i / 4) % 160; d[i + 1] = ((i / 4) / 160) | 0; d[i + 2] = 90; d[i + 3] = 255; } return { width: 160, height: 90, data: d }; };
        const a = mk(), b = mk(), c = mk(); const orig = mk();
        for (let i = 0; i < 20; i++) { datamoshFrame(a, 0.5, rng(100 + i)); datamoshFrame(b, 0.5, rng(100 + i)); } datamoshFrame(c, 0.5, rng(999));
        let diff = 0; for (let i = 0; i < a.data.length; i++) if (a.data[i] !== orig.data[i]) diff++;
        expect(diff).toBeGreaterThan(500); expect(Array.from(a.data)).toEqual(Array.from(b.data));
        for (let i = 3; i < a.data.length; i += 4) expect(a.data[i]).toBe(255);
    });
});

describe('AI vs AI show (core, silent backends, real stations / session / scorer / validated ports)', () => {
    const run = (seed: number) => {
        const sim = new Sim('intermediate', { roundSeconds: 60, bestOf: 1, countInBars: 1 }, undefined, seed);        // sim.ai drives 'buddy' (AI DJ 2)
        const port2 = new CommandPort('player', sim.player, sim.library, () => sim.t);
        const ai2 = new BuddyAI(port2, sim.session, DEMO_TRACKS, 'intermediate', () => sim.t, () => ({}), seed + 7919, () => sim.buddy.state().trackId);
        ai2.prepare(); sim.ai.prepare(); expect(sim.session.startRound()).toBeNull();
        sim.runUntil('matchEnd', 400, () => ai2.tick());
        return { sim, port2, ai2 };
    };
    it('two AIs play a full round on their own stations and both are scored from what they did', () => {
        const { sim, port2 } = run(3); const r = sim.session.results[0];
        expect(sim.session.phase).toBe('matchEnd'); expect(r.breakdown.player.total).toBeGreaterThan(20); expect(r.breakdown.buddy.total).toBeGreaterThan(20);
        expect(['player', 'buddy', 'draw']).toContain(r.winner); expect(sim.port.refused).toBe(0); expect(port2.refused).toBe(0);
        expect(port2.log.length).toBeGreaterThan(5); expect(sim.port.log.length).toBeGreaterThan(5);
    });
    it('each AI only ever acts on its own station', () => {
        const { sim, port2 } = run(4); expect(sim.port.log.every(l => l.owner === 'buddy')).toBe(true); expect(port2.log.every(l => l.owner === 'player')).toBe(true);
        expect(port2.exec({ type: 'pause' }, 'buddy')).toBe(false);
    });
    it('the two AIs never open on the same track, and DJ 2 avoids DJ 1\'s track whenever it chooses', () => {
        for (const seed of [1, 2, 3, 4, 5, 6]) { const sim = new Sim('intermediate', { roundSeconds: 60, bestOf: 1, countInBars: 1 }, undefined, seed); const p2 = new CommandPort('player', sim.player, sim.library, () => sim.t);
            const a2 = new BuddyAI(p2, sim.session, DEMO_TRACKS, 'intermediate', () => sim.t, () => ({}), seed + 7919, () => sim.buddy.state().trackId); a2.prepare(); sim.ai.prepare(); expect(sim.player.state().trackId).not.toBe(sim.buddy.state().trackId); }
    });
});
