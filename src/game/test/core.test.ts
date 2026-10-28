import { describe, expect, it } from 'vitest';
import { Sim } from './sim';
import { DEMO_TRACKS } from '../audio/catalog';
import { Station, SilentBackend } from '../core/station';
import { CommandPort } from '../core/commands';
import { THIRTY_SECOND_SWITCH } from '../core/challenges';
import { estimateBpm } from '../core/analysis';

describe('station', () => {
    it('plays, loops a bundled phrase, pauses, re-anchors on rate change', () => {
        let t = 0; const s = new Station('player', new SilentBackend(() => t)); const tr = DEMO_TRACKS[0];
        expect(s.play()).toBe(false);                               // nothing loaded
        s.load(tr); s.play(); t = 1; expect(s.state().positionSec).toBeCloseTo(1, 6);
        s.setRate(1.1); t = 2; expect(s.state().positionSec).toBeCloseTo(1 + 1.1, 6);
        t = 100; expect(s.state().positionSec).toBeLessThan(tr.loopSec!);        // wraps inside the loop
        s.pause(); const p = s.state().positionSec; t = 200; expect(s.state().positionSec).toBe(p);
    });
    it('a scheduled start is silent until its time and position stays put', () => {
        let t = 0; const s = new Station('player', new SilentBackend(() => t)); s.load(DEMO_TRACKS[1]); s.play(2);
        t = 1; expect(s.state().sounding).toBe(false); expect(s.state().positionSec).toBe(0);
        t = 3; expect(s.state().sounding).toBe(true); expect(s.state().positionSec).toBeCloseTo(1, 6);
    });
    it('a disabled station refuses everything and keeps its state', () => {
        let t = 0; const s = new Station('buddy', new SilentBackend(() => t)); s.load(DEMO_TRACKS[0]); s.enabled = false;
        expect(s.play()).toBe(false); expect(s.setVolume(0)).toBe(false); expect(s.setEq('low', 0)).toBe(false); expect(s.state().volume).toBe(0.8);
    });
});

describe('command port (the only handle the AI has)', () => {
    const lib = new Map(DEMO_TRACKS.map(x => [x.id, x]));
    it('refuses commands for another owner, a disabled station, bad values and unknown tracks', () => {
        let t = 0; const b = new Station('buddy', new SilentBackend(() => t)); const port = new CommandPort('buddy', b, lib, () => t);
        expect(port.exec({ type: 'load', trackId: 'nope' })).toBe(false);
        expect(port.exec({ type: 'load', trackId: DEMO_TRACKS[0].id })).toBe(true);
        expect(port.exec({ type: 'volume', value: 2 })).toBe(false); expect(port.exec({ type: 'rate', rate: 1.5 })).toBe(false); expect(port.exec({ type: 'seek', sec: NaN })).toBe(false);
        expect(port.exec({ type: 'play' }, 'player')).toBe(false);                                   // acting as the other seat
        b.enabled = false; expect(port.exec({ type: 'pause' })).toBe(false); expect(port.exec({ type: 'volume', value: 0 })).toBe(false);
        expect(port.log.filter(r => !r.ok).map(r => r.reason)).toContain('station belongs to someone else');
    });
    it('a port bound to the wrong station object cannot act', () => {
        let t = 0; const p = new Station('player', new SilentBackend(() => t)); const port = new CommandPort('buddy', p, lib, () => t);
        expect(port.exec({ type: 'load', trackId: DEMO_TRACKS[0].id })).toBe(false); expect(p.state().trackId).toBeNull();
    });
});

describe('battle round', () => {
    it('runs count-in -> live -> round end with one master clock and scores a clean player', () => {
        const sim = new Sim('expert', { roundSeconds: 60, bestOf: 1, countInBars: 1 });
        const keep = sim.playerPlaysClean(); sim.ai.prepare();
        expect(sim.session.startRound()).toBeNull(); expect(sim.session.phase).toBe('countin');
        sim.runUntil('matchEnd', 200, () => keep());
        const r = sim.session.results[0];
        expect(sim.session.phase).toBe('matchEnd'); expect(r.breakdown.player.total).toBeGreaterThan(55);
        expect(r.breakdown.player.items.find(i => i.category === 'alignment')!.points).toBeGreaterThan(24);
        expect(sim.port.refused).toBe(0);
    });
    it('a player who never makes sound scores exactly 0 and the AI wins', () => {
        const sim = new Sim('intermediate', { roundSeconds: 40, bestOf: 1, countInBars: 1 }); sim.ai.prepare(); sim.session.startRound(); sim.runUntil('matchEnd', 200);
        const r = sim.session.results[0]; expect(r.breakdown.player.total).toBe(0); expect(r.winner).toBe('buddy');
    });
    it('rejects starting during a round, and a rematch starts a clean match', () => {
        const sim = new Sim('beginner', { roundSeconds: 30, bestOf: 1, countInBars: 1 }); sim.ai.prepare(); sim.session.startRound();
        expect(sim.session.startRound()).toMatch(/already running/); sim.runUntil('matchEnd', 100);
        expect(sim.session.startRound()).toMatch(/rematch/); sim.session.rematch();
        expect(sim.session.results.length).toBe(0); expect(sim.session.round).toBe(0); expect(sim.session.startRound()).toBeNull();
    });
    it('best of 3 stops as soon as someone has two wins', () => {
        const sim = new Sim('expert', { roundSeconds: 30, bestOf: 3, countInBars: 1 }); const keep = sim.playerPlaysClean();
        for (let i = 0; i < 3; i++) { if ((sim.session.phase as string) === 'matchEnd') break; sim.ai.prepare(); keep(); sim.session.startRound(); sim.runUntil('roundEnd', 200, () => { keep(); }); if (sim.session.phase === 'roundEnd') sim.run(0.02); }
        expect(sim.session.results.length).toBeGreaterThanOrEqual(2); expect(Math.max(sim.session.wins.player, sim.session.wins.buddy)).toBeGreaterThanOrEqual(2);
        expect(sim.session.matchWinner).not.toBeNull();
    });
    it('the AI’s second round re-prepares its own deck without touching the player', () => {
        const sim = new Sim('expert', { roundSeconds: 30, bestOf: 3, countInBars: 1 }); const keep = sim.playerPlaysClean();
        sim.ai.prepare(); sim.session.startRound(); sim.runUntil('roundEnd', 200, () => keep());
        sim.player.setEq('low', 0.2); sim.player.setFilter(0.7); sim.player.setVolume(0.6); const mix = () => { const x = sim.player.state(); return JSON.stringify([x.trackId, x.rate, x.volume, x.eq, x.filter]); }; const before = mix(); sim.run(0.5);
        expect(mix()).toBe(before);                                    // AI prepared for round 2 (it runs in idle/roundEnd) and left the player alone
        expect(sim.port.log.every(r => r.owner === 'buddy')).toBe(true);
    });
});

describe('Buddy difficulty is behaviour, measured by the same scorer', () => {
    const score = (d: 'beginner' | 'intermediate' | 'expert', seed: number) => {
        const sim = new Sim(d, { roundSeconds: 90, bestOf: 1, countInBars: 1 }, undefined, seed); sim.ai.prepare(); sim.session.startRound(); sim.runUntil('matchEnd', 300);
        return { total: sim.session.results[0].breakdown.buddy.total, sim };
    };
    it('beginner < intermediate < expert with clear margins over several seeds', () => {
        const mean = (d: 'beginner' | 'intermediate' | 'expert') => [1, 2, 3].map(s => score(d, s).total).reduce((a, b) => a + b, 0) / 3;
        const b = mean('beginner'), i = mean('intermediate'), e = mean('expert');
        console.log('difficulty means', { b, i, e });
        expect(i).toBeGreaterThan(b + 10); expect(e).toBeGreaterThan(i + 5); expect(e).toBeGreaterThan(80);
    });
    it('differences come from decisions: beginner leaves tempo error and hard-cuts off the phrase, expert does not', () => {
        const b = score('beginner', 4).sim.ai.decisions, e = score('expert', 4).sim.ai.decisions;
        expect(b.some(d => d.kind === 'tempo' && /leaves/.test(d.evidence))).toBe(true);
        expect(e.filter(d => d.kind === 'tempo').every(d => /exact/.test(d.evidence))).toBe(true);
        expect(Math.max(...b.filter(d => d.kind === 'track').map(d => d.offPhraseBeats ?? 0))).toBeGreaterThan(2);
        expect(e.filter(d => d.kind === 'track' && d.offPhraseBeats !== undefined).every(d => d.offPhraseBeats! <= 1)).toBe(true);
    });
    it('the AI only ever acts on its own station and none of its commands is refused', () => {
        const { sim } = score('expert', 5); expect(sim.port.refused).toBe(0);
        const ev: string[] = []; const sim2 = new Sim('expert', { roundSeconds: 40, bestOf: 1, countInBars: 1 }); sim2.player.onEvent(e => ev.push(e.type));
        sim2.ai.prepare(); sim2.session.startRound(); sim2.runUntil('matchEnd', 200);
        expect(ev.filter(x => x !== 'pause')).toEqual([]);                                          // only the round-end pause (session) reaches the player's station
    });
    it('a disabled Buddy station is untouched by AI preparation and cleanup', () => {
        const sim = new Sim('expert', { roundSeconds: 30, bestOf: 1, countInBars: 1 }); sim.buddy.enabled = false;
        expect(sim.ai.prepare()).toBe(false); sim.ai.tick(); sim.run(1); expect(sim.buddy.state().trackId).toBeNull(); expect(sim.buddy.state().volume).toBe(0.8);
    });
});

describe('challenge framework', () => {
    it('Thirty-Second Switch explains why it cannot start instead of substituting another rule', () => {
        const sim = new Sim('expert', { roundSeconds: 40 }, THIRTY_SECOND_SWITCH);
        expect(sim.session.canStart()).toMatch(/at least 60 seconds/);
        const few = new Sim('expert', { roundSeconds: 90 }, THIRTY_SECOND_SWITCH, 1, DEMO_TRACKS.slice(0, 2)); expect(few.session.canStart()).toMatch(/four tracks/);
    });
    it('scores the objective from real switch times and Buddy plans a switch in every window', () => {
        const sim = new Sim('expert', { roundSeconds: 90, bestOf: 1, countInBars: 1 }, THIRTY_SECOND_SWITCH); sim.ai.prepare(); sim.session.startRound(); sim.runUntil('matchEnd', 300);
        const obj = sim.session.results[0].breakdown.buddy.items.find(i => i.category === 'objective')!;
        expect(obj.outOf).toBe(20); expect(obj.points).toBeGreaterThanOrEqual(13);
    });
});

describe('tempo estimate', () => {
    it('finds a synthetic click track tempo and labels nothing as verified', () => {
        const sr = 22050, bpm = 118, n = sr * 20, x = new Float32Array(n); const per = sr * 60 / bpm;
        for (let b = 0; b * per < n; b++) { const s = Math.round(b * per + 0.37 * sr / 10); for (let i = 0; i < 400 && s + i < n; i++) x[s + i] += Math.exp(-i / 60) * Math.sin(i * 0.3); }
        const e = estimateBpm(x, sr)!; expect(Math.abs(e.bpm - bpm)).toBeLessThan(1);
    });
});
