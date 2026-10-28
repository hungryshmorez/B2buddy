import { describe, expect, it } from 'vitest';
import { MemoryStore, MemoryStorage, PROJECT_RULES } from '../memory/store';
import { Supervisor } from '../memory/supervisor';
import { Sim } from './sim';

function battle(mem: MemoryStore, difficulty: 'beginner' | 'expert', seed = 3) {
    const sim = new Sim(difficulty, { roundSeconds: 90, bestOf: 1, countInBars: 1 }, undefined, seed); sim.prefs = mem.buddyPrefs();
    const keep = sim.playerPlaysClean(); sim.ai.prepare(); sim.session.startRound(); sim.runUntil('matchEnd', 300, () => keep());
    new Supervisor(mem).analyze({ matchId: 'm', difficulty, decisions: sim.ai.decisions, result: sim.session.results[0], refusedCommands: sim.port.refused, activePrefsApplied: [] });
    return sim;
}

describe('memory & growth', () => {
    it('proposes a lesson from measured evidence, applies nothing until approved, then Buddy obeys and no drift is raised', () => {
        const mem = new MemoryStore(new MemoryStorage());
        const first = battle(mem, 'beginner');
        const offBefore = Math.max(...first.ai.decisions.filter(d => d.kind === 'track' && d.offPhraseBeats !== undefined).map(d => d.offPhraseBeats!));
        expect(offBefore).toBeGreaterThan(2);
        expect(mem.pending.length).toBe(1); expect(mem.pending[0].key).toBe('phraseWait'); expect(mem.pending[0].evidence.length).toBeGreaterThan(0);
        expect(mem.buddyPrefs().phraseWait).toBeUndefined();                       // pending is NOT applied
        const second = battle(mem, 'beginner'); expect(Math.max(...second.ai.decisions.filter(d => d.kind === 'track' && d.offPhraseBeats !== undefined).map(d => d.offPhraseBeats!))).toBeGreaterThan(2);
        expect(mem.approve(mem.pending[0].id)).toBe(true);
        expect(mem.buddyPrefs().phraseWait).toBe(true);
        const third = battle(mem, 'beginner', 5);
        expect(third.ai.decisions.filter(d => d.kind === 'track' && d.offPhraseBeats !== undefined).every(d => d.offPhraseBeats! <= 1)).toBe(true);
        expect(third.ai.decisions.some(d => d.prefsApplied.includes('wait for the phrase before transitioning'))).toBe(true);
        expect(mem.state.drift.filter(d => d.kind === 'preference-violated')).toHaveLength(0);
    });
    it('a rejected proposal changes nothing and is not re-proposed forever', () => {
        const mem = new MemoryStore(new MemoryStorage()); battle(mem, 'beginner'); const id = mem.pending[0].id; mem.reject(id);
        expect(mem.buddyPrefs()).toEqual({}); expect(mem.state.proposals.find(p => p.id === id)!.status).toBe('rejected');
    });
    it('the user can edit, disable, delete and roll back preferences; disabled ones never reach the AI', () => {
        const mem = new MemoryStore(new MemoryStorage()); const p = mem.addPref('fadeBeats', 16, 'Fade 16 beats');
        expect(mem.buddyPrefs().fadeBeats).toBe(16); mem.editPref(p.id, { enabled: false }); expect(mem.buddyPrefs().fadeBeats).toBeUndefined();
        mem.editPref(p.id, { enabled: true, value: 8 }); expect(mem.buddyPrefs().fadeBeats).toBe(8);
        mem.deletePref(p.id); expect(mem.state.prefs).toHaveLength(0);
        const snap = mem.state.snapshots.find(s => /before deleting/.test(s.label))!; expect(mem.rollback(snap.id)).toBe(true); expect(mem.state.prefs).toHaveLength(1); expect(mem.buddyPrefs().fadeBeats).toBe(8);
    });
    it('contradictory preferences are reported, not silently resolved', () => {
        const mem = new MemoryStore(new MemoryStorage()); mem.addPref('fadeBeats', 4, 'short'); mem.addPref('fadeBeats', 16, 'long');
        expect(mem.state.drift.some(d => d.kind === 'contradiction')).toBe(true);
    });
    it('a correction becomes a pending approval, not an applied change; project rules cannot be edited', () => {
        const mem = new MemoryStore(new MemoryStorage()); battle(mem, 'expert'); const sup = new Supervisor(mem);
        const e = mem.state.experiences.find(x => x.decision.includes('->'))!; const p = sup.correct(e.id, 'longer-fade');
        expect(p?.status).toBe('pending'); expect(mem.buddyPrefs().fadeBeats).toBeUndefined(); expect(e.correction).toMatch(/longer fade/i);
        expect(() => { (PROJECT_RULES as unknown as Array<{ text: string }>)[0].text = 'x'; }).toThrow();
    });
    it('persists across sessions and survives corrupt or unavailable storage', () => {
        const st = new MemoryStorage(); const a = new MemoryStore(st); a.addPref('avoidFilter', true, 'No filter'); a.setMission('Win clean.');
        const b = new MemoryStore(st); expect(b.buddyPrefs().avoidFilter).toBe(true); expect(b.state.mission).toBe('Win clean.');
        st.setItem('b2buddy.memory.v1', '{broken'); const c = new MemoryStore(st); expect(c.loadProblem).toMatch(/could not be read/); expect(c.state.prefs).toHaveLength(0); expect(st.getItem('b2buddy.memory.v1.corrupt')).toBe('{broken');
        const bad = { getItem() { throw new Error('blocked'); }, setItem() { throw new Error('blocked'); }, removeItem() { } };
        const d = new MemoryStore(bad); expect(d.loadProblem).toMatch(/unavailable/); d.addPref('avoidFilter', true, 'x'); expect(d.buddyPrefs().avoidFilter).toBe(true);
    });
});
