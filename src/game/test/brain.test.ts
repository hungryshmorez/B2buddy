import { describe, expect, it } from 'vitest';
import { Sim } from './sim';
import { DEMO_TRACKS } from '../audio/catalog';
import { AiDjServiceBrain, AiDjTsBrain, ServiceFetch, toAidjTrack } from '../dj/brain';
import { planTransition, rankNext, AidjTrack } from '../dj/aidjCore';
import { EventBus } from '../events';

/** A stand-in HTTP service that answers with the TS port. It tests the client plumbing (cache, fallback, errors); the REAL Python is exercised in aidj.service.test.ts. */
const fakeService = (opts: { failAfter?: number; wrongService?: boolean } = {}): { fetch: ServiceFetch; calls: string[] } => {
    const calls: string[] = []; let n = 0;
    const fetch: ServiceFetch = async (url, init) => {
        const path = url.replace(/^https?:\/\/[^/]+/, ''); calls.push(path); n++;
        if (opts.failAfter !== undefined && n > opts.failAfter) throw new Error('connection refused');
        const body = init?.body ? JSON.parse(init.body) : {};
        const json = path === '/v1/health' ? { ok: true, service: opts.wrongService ? 'something-else' : 'b2buddy-aidj', fork: { commit: 'd56bd28c772f713ae39fc9ac33d0b555b98e1ce4' }, librosa: 'fake' }
            : path === '/v1/plan' ? planTransition(body.current as AidjTrack, body.next as AidjTrack) : path === '/v1/rank' ? { ranking: rankNext(body.previous as AidjTrack, body.candidates as AidjTrack[], new Set(body.avoid as string[])) } : null;
        return { ok: json !== null, status: json ? 200 : 404, json: async () => json };
    };
    return { fetch, calls };
};

const run = (d: 'beginner' | 'intermediate' | 'expert', seed: number, brain: AiDjTsBrain | AiDjServiceBrain | null, prefs: Sim['prefs'] = {}) => {
    const sim = new Sim(d, { roundSeconds: 90, bestOf: 1, countInBars: 1 }, undefined, seed, DEMO_TRACKS, brain); sim.prefs = prefs; sim.ai.prepare(); sim.session.startRound(); sim.runUntil('matchEnd', 300); return sim;
};

describe('the AI DJ brain drives Buddy\'s choices through the validated command port', () => {
    it('Intermediate and Expert take their track choice and overlap from the brain, and say so', () => {
        for (const d of ['intermediate', 'expert'] as const) {
            const sim = run(d, 3, new AiDjTsBrain()); const tr = sim.ai.decisions.filter(x => x.kind === 'track' && x.source);
            expect(tr.length, d).toBeGreaterThan(0); expect(tr.every(x => x.source === 'aidj-ts-port')).toBe(true);
            expect(tr.some(x => /AI DJ: transition score \d+\/100/.test(x.evidence) && /AI DJ overlap [\d.]+s = \d+ beats/.test(x.evidence))).toBe(true);
            expect(sim.port.refused).toBe(0);                                         // every brain-driven action still passed validation
        }
    });
    it('Beginner stays random and unassisted: skill level still means something', () => {
        const sim = run('beginner', 3, new AiDjTsBrain()); expect(sim.ai.decisions.some(x => x.source)).toBe(false); expect(sim.ai.decisions.some(x => /picked at random/.test(x.evidence))).toBe(true);
    });
    it('a lesson the user taught beats the brain\'s overlap', () => {
        const sim = run('expert', 3, new AiDjTsBrain(), { fadeBeats: 8 });
        expect(sim.ai.decisions.some(x => /AI DJ overlap/.test(x.evidence))).toBe(false); expect(sim.ai.decisions.some(x => x.prefsApplied.some(p => /fade length 8 beats/.test(p)))).toBe(true);
    });
    it('skill tiers still separate with the brain attached (same scorer, three seeds)', () => {
        const mean = (d: 'beginner' | 'intermediate' | 'expert') => [1, 2, 3].map(s => run(d, s, new AiDjTsBrain()).session.results[0].breakdown.buddy.total).reduce((a, b) => a + b, 0) / 3;
        const b = mean('beginner'), i = mean('intermediate'), e = mean('expert'); console.log('with brain, means', { b, i, e });
        expect(b).toBeLessThan(i - 10); expect(i).toBeLessThan(e - 5);
    });
    it('never loads the track the opponent is playing, while the opponent is playing it', () => {
        for (const seed of [1, 2, 3, 4, 5]) {
            const sim = new Sim('intermediate', { roundSeconds: 90, bestOf: 1, countInBars: 1 }, undefined, seed, DEMO_TRACKS, new AiDjTsBrain()); const keep = sim.playerPlaysClean(DEMO_TRACKS[0].id);
            sim.ai.prepare(); sim.session.startRound(); sim.runUntil('matchEnd', 300, () => keep());
            const loads = sim.port.log.filter(r => r.ok && r.command.type === 'load').map(r => (r.command as { trackId: string }).trackId);
            expect(loads.length, `seed ${seed}`).toBeGreaterThan(1); expect(loads.every(id => id !== DEMO_TRACKS[0].id), `seed ${seed}`).toBe(true);
        }
    });
});

describe('the service-backed brain (client plumbing, with a stand-in service)', () => {
    it('connects only to the real service identity', async () => {
        const wrong = fakeService({ wrongService: true }); await expect(new AiDjServiceBrain('http://x', wrong.fetch).connect()).rejects.toThrow(/not the B2Buddy AI DJ service/);
        const ok = new AiDjServiceBrain('http://x', fakeService().fetch); await ok.connect(); expect(ok.health.fork?.commit).toMatch(/^d56bd28/);
    });
    it('warms every ordered pair, then serves decisions from the cache labelled "aidj-service" with no further requests', async () => {
        const svc = fakeService(); const b = new AiDjServiceBrain('http://x', svc.fetch); await b.connect(); const n = await b.warm(DEMO_TRACKS);
        const k = DEMO_TRACKS.length; expect(n).toBe(k * (k - 1) + k); const before = svc.calls.length;
        const p = b.plan(DEMO_TRACKS[0], DEMO_TRACKS[1]); expect(p.source).toBe('aidj-service'); const r = b.rank(DEMO_TRACKS[0], DEMO_TRACKS.slice(1), new Set([DEMO_TRACKS[2].id]));
        expect(r.every(x => x.source === 'aidj-service') && r.every(x => x.id !== DEMO_TRACKS[2].id)).toBe(true); expect(svc.calls.length).toBe(before); expect(b.status().fallbackCalls).toBe(0);
    });
    it('gives exactly the decisions the TS port gives (so a battle is identical either way, apart from the label)', async () => {
        const b = new AiDjServiceBrain('http://x', fakeService().fetch); await b.connect(); await b.warm(DEMO_TRACKS);
        const strip = (sim: Sim) => sim.ai.decisions.map(d => ({ ...d, source: undefined }));
        expect(strip(run('expert', 4, b))).toEqual(strip(run('expert', 4, new AiDjTsBrain())));
    });
    it('a dead service degrades to the TS port: counted, labelled, and Buddy still plays a clean round', async () => {
        const b = new AiDjServiceBrain('http://x', fakeService({ failAfter: 1 }).fetch); await b.connect(); const n = await b.warm(DEMO_TRACKS);
        expect(n).toBe(0); expect(b.error).toMatch(/connection refused/);
        const sim = run('expert', 2, b); expect(b.status().fallbackCalls).toBeGreaterThan(0); expect(sim.ai.decisions.filter(x => x.source).every(x => x.source === 'aidj-ts-port')).toBe(true); expect(sim.session.phase).toBe('matchEnd'); expect(sim.port.refused).toBe(0);
    });
    it('times out a hung service instead of hanging the game', async () => {
        const hang: ServiceFetch = (_u, i) => new Promise((_res, rej) => { i?.signal?.addEventListener('abort', () => rej(new Error('aborted'))); });
        await expect(new AiDjServiceBrain('http://x', hang, 50).connect()).rejects.toThrow(/abort/);
    });
});

describe('brain input mapping', () => {
    it('passes only known facts: bundled tracks are declared instrumental, key codes survive, unknown genre stays empty', () => {
        const t = toAidjTrack(DEMO_TRACKS[0]); expect(t.key).toBe('8A'); expect(t.genre).toBe(''); expect(t.structure?.has_vocals_in_first_8s).toBe(false);
        expect(t.structure!.transition_candidates!.every(c => c.type === 'phrase_end' && c.has_vocals_after === false)).toBe(true);
        const user = toAidjTrack({ ...DEMO_TRACKS[0], source: 'user', instrumental: undefined, loopSec: undefined, durationSec: 200 }); expect(user.structure?.has_vocals_in_first_8s).toBeUndefined();
    });
});

describe('chorus sections found by the AI DJ local analysis', () => {
    it('become the first transition candidates and reach the fork\'s scorer as chorus_end', () => {
        const t = { ...DEMO_TRACKS[0], source: 'user' as const, instrumental: undefined, loopSec: undefined, durationSec: 200, choruses: [{ start: 60, end: 92.4 }, { start: 120, end: 150 }] };
        const a = toAidjTrack(t); expect(a.structure!.transition_candidates!.slice(0, 2)).toEqual([{ time: 92.4, type: 'chorus_end', reasoning: 'chorus found by chroma self-recurrence' }, { time: 150, type: 'chorus_end', reasoning: 'chorus found by chroma self-recurrence' }]);
        const p = planTransition(a, toAidjTrack(DEMO_TRACKS[1])); expect(p.candidates.some(c => c.type === 'chorus_end')).toBe(true); expect([92.4, 150]).toContain(p.candidates.find(c => c.type === 'chorus_end')!.time);
        const none = toAidjTrack({ ...t, choruses: undefined }); expect(none.structure!.transition_candidates!.every(c => c.type === 'phrase_end')).toBe(true);
    });
});

describe('event bus', () => {
    it('delivers events, isolates throwing listeners, bounds its log and unsubscribes', () => {
        let t = 0; const bus = new EventBus(() => t, 5); const got: string[] = []; const off = bus.on('beat', e => got.push('b' + e.beat)); bus.on('beat', () => { throw new Error('bad listener'); });
        for (let i = 0; i < 12; i++) { t = i; bus.emit({ type: 'beat', beat: i, bar: 0, downbeat: i % 4 === 0 }); }
        expect(got.length).toBe(12); expect(bus.listenerErrors).toBe(12); expect(bus.size).toBe(5); expect(bus.recent('beat', 2).map(e => e.t)).toEqual([10, 11]);
        off(); bus.emit({ type: 'beat', beat: 99, bar: 0, downbeat: false }); expect(got.length).toBe(12);
    });
});
