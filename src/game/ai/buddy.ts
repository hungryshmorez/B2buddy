import { BattleSession } from '../core/battle';
import { phaseDiff } from '../core/clock';
import { CommandPort } from '../core/commands';
import { camelotFit } from '../core/scoring';
import { bestRate } from '../core/tempo';
import { GameTrack } from '../core/types';
import type { BrainRank, DjBrain } from '../dj/brain';

export type Difficulty = 'beginner' | 'intermediate' | 'expert';

export interface AiProfile {
    name: string;
    /** Signed start error range in seconds when launching on a beat (a person pressing play by hand). */
    launchJitterSec: [number, number];
    tempoErrorPct: number;
    phaseCheckEveryBeats: number;      // 0 = never
    fadeBeats: number;                 // 0 = hard cut
    transitions: number;
    selection: 'random' | 'tempo' | 'tempoKey';
    bassCut: boolean;
    filterSweep: boolean;
    alignsToPhrase: boolean;
}

export const PROFILES: Record<Difficulty, AiProfile> = {
    beginner: { name: 'Beginner', launchJitterSec: [0.055, 0.14], tempoErrorPct: 2, phaseCheckEveryBeats: 0, fadeBeats: 0, transitions: 1, selection: 'random', bassCut: false, filterSweep: false, alignsToPhrase: false },
    intermediate: { name: 'Intermediate', launchJitterSec: [0, 0.03], tempoErrorPct: 0.4, phaseCheckEveryBeats: 0, fadeBeats: 8, transitions: 2, selection: 'tempo', bassCut: true, filterSweep: false, alignsToPhrase: true },
    expert: { name: 'Expert', launchJitterSec: [0, 0], tempoErrorPct: 0, phaseCheckEveryBeats: 32, fadeBeats: 16, transitions: 3, selection: 'tempoKey', bassCut: true, filterSweep: true, alignsToPhrase: true },
};

/** Durable preferences the user can teach Buddy (see memory/store.ts). Absent = use the difficulty's own behaviour. */
export interface BuddyPrefs { phraseWait?: boolean; fadeBeats?: number; avoidFilter?: boolean }

export interface Decision { time: number; beat: number; decision: string; evidence: string; action: string; kind: 'track' | 'tempo' | 'launch' | 'transition' | 'phase' | 'eq' | 'note'; offPhraseBeats?: number; prefsApplied: string[];
    /** Which decision layer produced it, when a DJ brain was involved ('aidj-service' | 'aidj-ts-port'). Absent = Buddy's built-in rules. */ source?: string }

interface Step { beat: number; name: string; run: () => void; done: boolean }
interface Ramp { from: number; to: number; start: number; end: number; apply: (v: number) => void; fin?: boolean }

function mulberry32(a: number) { return () => { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }

/**
 * Buddy: a deterministic rule-based DJ. It reads only public information (its own deck, the library, the master clock, the live score) and acts only through
 * its CommandPort, so every action is validated and logged. No external AI service is involved; an optional LLM could only propose Commands to the same port.
 */
export class BuddyAI {
    readonly profile: AiProfile;
    readonly decisions: Decision[] = [];
    private rng: () => number;
    private steps: Step[] = []; private ramps: Ramp[] = [];
    private plannedRound = -1; private preparedFor = -1;
    private chosen: GameTrack[] = [];
    private lastPhaseCheck = -1;
    private lastRank: BrainRank | null = null;

    constructor(private readonly port: CommandPort, private readonly session: BattleSession, private readonly tracks: readonly GameTrack[], difficulty: Difficulty,
        private readonly now: () => number, private readonly prefs: () => BuddyPrefs = () => ({}), seed = 1, private readonly playerTrackId: () => string | null = () => null,
        /** The decision layer. null = Buddy's built-in rules (the explicit fallback). Buddy still executes everything through its CommandPort. */ private readonly brain: DjBrain | null = null) {
        this.profile = PROFILES[difficulty]; this.rng = mulberry32(seed * 2654435761 >>> 0);
    }

    private log(kind: Decision['kind'], decision: string, evidence: string, action: string, extra: Partial<Decision> = {}) {
        const clock = this.session.clock;
        this.decisions.push({ time: this.now(), beat: clock ? clock.beatAt(this.now()) : NaN, kind, decision, evidence, action, prefsApplied: [], ...extra });
    }
    private rand(a: number, b: number) { return a + (b - a) * this.rng(); }

    // ---------------------------------------------------------------- track choice
    private tempoCost(t: GameTrack, master: number): number {
        if (!t.bpm) return Infinity;
        for (const m of [1, 2, 0.5]) { const r = master * m / t.bpm; if (r >= 0.84 && r <= 1.16) return Math.abs(r - 1) + (m === 1 ? 0 : 0.05); }
        return Infinity;
    }

    private choose(previous: GameTrack | null, why: { text: string }): GameTrack | null {
        const master = this.session.config.masterBpm;
        const pool = this.tracks.filter(t => t.bpm && !this.chosen.some(c => c.id === t.id));
        const usable = (pool.length ? pool : this.tracks.filter(t => t.bpm));
        if (!usable.length) return null;
        if (this.profile.selection === 'random') { const t = usable[Math.floor(this.rng() * usable.length)]; why.text = 'picked at random'; return t; }
        if (this.brain && previous) {
            const feasible = usable.filter(t => isFinite(this.tempoCost(t, master))); const opp = this.playerTrackId(); const avoid = new Set<string>(opp ? [opp] : []);
            const rows = feasible.length ? this.brain.rank(previous, feasible, avoid) : [];
            if (rows.length) { const top = rows[0]; this.lastRank = top; why.text = `AI DJ: transition score ${top.score}/100, key fit ${top.keyScore}, ${top.bpmDiff.toFixed(0)} BPM apart, overlap ${top.overlapSec}s`; return feasible.find(x => x.id === top.id)!; }
        }
        this.lastRank = null;
        const scored = usable.map(t => {
            const tc = this.tempoCost(t, master); if (!isFinite(tc)) return { t, s: -Infinity, note: 'tempo out of range' };
            let s = -tc * 100; let note = `needs ${(tc * 100).toFixed(1)}% tempo shift`;
            if (this.profile.selection === 'tempoKey') {
                const k = previous ? camelotFit(previous.key, t.key) : null; if (k !== null) { s += k * 8; note += `, key ${previous!.key}->${t.key} fit ${(k * 100).toFixed(0)}%`; }
            }
            if (t.id === this.playerTrackId()) { s -= 50; note += ', opponent is playing it'; }          // two DJs on one track is a bad show at any skill level
            return { t, s, note };
        }).sort((a, b) => b.s - a.s);
        why.text = scored[0].note; return scored[0].s === -Infinity ? usable[0] : scored[0].t;
    }

    // ---------------------------------------------------------------- preparation (idle / between rounds)
    prepare(): boolean {
        const s = this.session; const target = s.phase === 'countin' ? s.round : s.round + 1;
        if (s.phase !== 'idle' && s.phase !== 'roundEnd' && s.phase !== 'countin') return false;
        if (this.preparedFor === target) return true;
        this.chosen = []; this.steps = []; this.ramps = [];
        const why = { text: '' }; const first = this.choose(null, why); if (!first) { this.log('note', 'no playable track', 'library has no track with a known BPM', 'none'); return false; }
        this.chosen.push(first);
        const ok = this.port.exec({ type: 'load', trackId: first.id });
        for (const b of ['low', 'mid', 'high'] as const) this.port.exec({ type: 'eq', band: b, value: 0.5 });
        this.port.exec({ type: 'filter', value: 0.5 }); this.port.exec({ type: 'volume', value: 1 });
        this.log('track', `opening with "${first.title}"`, why.text, ok ? 'load' : 'load refused');
        this.preparedFor = target; return ok;
    }

    // ---------------------------------------------------------------- the round plan
    private rateFor(t: GameTrack, master: number): { rate: number; note: string } {
        const br = bestRate(t.bpm!, master); let best = br ? br.rate : 1; const bm = br ? br.multiple : 1;
        let note = br ? `${t.bpm} BPM -> ${master} BPM needs rate ${best.toFixed(4)}${bm === 1 ? '' : bm === 2 ? ' (double time)' : ' (half time)'}` : `${t.bpm} BPM cannot reach ${master} BPM within +-20%`;
        const e = this.profile.tempoErrorPct;
        if (e > 0) { let noise = this.rand(-e, e); if (Math.abs(noise) < e / 2) noise = (noise < 0 ? -1 : 1) * e / 2; best *= 1 + noise / 100; note += `; leaves ${noise.toFixed(2)}% error (${this.profile.name} tempo matching)`; }
        else note += '; exact';
        return { rate: best, note };
    }

    private plan() {
        const s = this.session, P = this.profile, pr = this.prefs();
        this.plannedRound = s.round; this.steps = []; this.ramps = []; this.lastPhaseCheck = -1;
        if (!this.port.exec({ type: 'volume', value: 1 })) return;
        const opening = this.chosen[0];
        const master = s.config.masterBpm, phrase = s.config.beatsPerBar * 4, roundBeats = s.roundBeats;
        const applied: string[] = [];
        const wait = pr.phraseWait === true || P.alignsToPhrase; if (pr.phraseWait === true) applied.push('wait for the phrase before transitioning');
        const fade = pr.fadeBeats ?? P.fadeBeats; if (pr.fadeBeats !== undefined) applied.push(`fade length ${pr.fadeBeats} beats`);
        const filterOn = P.filterSweep && pr.avoidFilter !== true; if (pr.avoidFilter) applied.push('avoid filter sweeps');

        this.add(-2, 'tempo', () => this.applyTempo(opening));
        this.add(0, 'launch', () => this.launch(opening, 0, 'opening launch'));
        const k = Math.max(0, Math.min(P.transitions, Math.floor((roundBeats - phrase) / phrase) - 1));
        const every = s.challenge.switchEverySec;
        const starts: number[] = [];
        if (every) { const beats = every * master / 60; for (let b = beats; b < roundBeats - 8; b += beats) starts.push(Math.round(b / phrase) * phrase); }
        else for (let i = 0; i < k; i++) starts.push(Math.round((i + 1) * roundBeats / (k + 1) / phrase) * phrase);
        let prev = opening;
        for (let i = 0; i < starts.length; i++) {
            let start = starts[i];
            if (!wait) start = Math.round(start + this.rand(3, 7));                      // not on a phrase: this is what the "wait for the phrase" lesson corrects
            if (start < phrase / 2 || start > roundBeats - 8) continue;
            const w = { text: '' }; const next = this.choose(prev, w); if (!next || next.id === prev.id) continue;
            this.chosen.push(next);
            const offPhrase = Math.min(start % phrase, phrase - (start % phrase));
            const nx = next, pv = prev, st = start; const rk = this.lastRank;
            const bp = this.brain && fade > 0 && pr.fadeBeats === undefined ? this.brain.plan(pv, nx) : null;     // a lesson the user taught always beats the brain
            const fadeThis = bp ? Math.max(4, Math.min(32, Math.round(bp.overlapSec * master / 60))) : fade;
            this.log('track', `next: "${nx.title}" at beat ${st}`, bp ? `${w.text}; AI DJ overlap ${bp.overlapSec}s = ${fadeThis} beats` : w.text, 'planned', { prefsApplied: applied, offPhraseBeats: offPhrase, ...(rk || bp ? { source: (bp ?? rk)!.source } : {}) });
            const f = Math.max(0, Math.min(fadeThis, st - 2));
            if (f > 0) {
                this.ramp(st - f, st - 0.5, 1, 0.15, v => this.port.exec({ type: 'volume', value: v }));
                if (P.bassCut) this.ramp(st - f, st - 0.5, 0.5, 0.05, v => this.port.exec({ type: 'eq', band: 'low', value: v }));
                if (filterOn) this.ramp(st - f / 2, st - 0.5, 0.5, 0.85, v => this.port.exec({ type: 'filter', value: v }));
            }
            this.add(st - 0.4, 'transition', () => {
                this.applyChange(pv, nx, offPhrase, applied);
            });
            this.add(st + 0.01, 'launch', () => this.launch(nx, st, 'launch after change'));
            if (f > 0) this.ramp(st, st + 2, 0.15, 1, v => this.port.exec({ type: 'volume', value: v }));
            prev = next;
        }
    }

    private add(beat: number, name: string, run: () => void) { this.steps.push({ beat, name, run, done: false }); }
    private ramp(start: number, end: number, from: number, to: number, apply: (v: number) => void) { this.ramps.push({ start, end, from, to, apply }); }

    private applyTempo(t: GameTrack) {
        const { rate, note } = this.rateFor(t, this.session.config.masterBpm);
        this.port.exec({ type: 'rate', rate });
        this.log('tempo', `match "${t.title}" to the master`, note, `rate ${rate.toFixed(4)}`);
    }

    private applyChange(from: GameTrack, to: GameTrack, off: number, applied: string[]) {
        const ok = this.port.exec({ type: 'load', trackId: to.id });
        this.port.exec({ type: 'eq', band: 'low', value: 0.5 }); this.port.exec({ type: 'filter', value: 0.5 });
        const { rate, note } = this.rateFor(to, this.session.config.masterBpm);
        this.port.exec({ type: 'rate', rate });
        this.log('transition', `${from.title} -> ${to.title}`, `${note}; ${off <= 1 ? 'on the phrase' : off.toFixed(1) + ' beats off the phrase'}`, ok ? 'load+tempo' : 'load refused', { offPhraseBeats: off, prefsApplied: applied });
    }

    private launch(t: GameTrack, beat: number, why: string) {
        const clock = this.session.clock!; const [a, b] = this.profile.launchJitterSec;
        const j = b === 0 ? 0 : this.rand(a, b) * (this.rng() < 0.5 ? -1 : 1);
        const at = clock.timeOfBeat(beat) + j;
        // the deck starts at its first beat, so the first beat lands on the master beat (+ this difficulty's human error)
        this.port.exec({ type: 'seek', sec: t.firstBeatSec });
        const ok = this.port.exec({ type: 'play', at });
        this.log('launch', `${why}: "${t.title}"`, j === 0 ? 'scheduled on the exact master beat' : `started ${(j * 1000).toFixed(0)} ms ${j < 0 ? 'early' : 'late'} (${this.profile.name} timing)`, ok ? `play @beat ${beat}` : 'play refused');
        if (this.profile.phaseCheckEveryBeats === 0 && this.profile.name === 'Intermediate') this.add(beat + 8, 'phase', () => this.checkPhase(t));
    }

    private checkPhase(t: GameTrack) {
        const clock = this.session.clock!; const state = this.port.peek();
        if (!state.sounding || state.trackId !== t.id || !t.bpm) return;
        const trackBeat = (state.positionSec - t.firstBeatSec) * t.bpm / 60; const err = phaseDiff(trackBeat, clock.beatAt(this.now()));
        const deltaSec = -err * 60 / t.bpm;
        if (Math.abs(deltaSec) < 0.004) return;
        this.port.exec({ type: 'seek', sec: state.positionSec + deltaSec });
        this.log('phase', 'phase correction', `${(err * clock.beatSec * 1000).toFixed(0)} ms off the master beat`, `seek ${(deltaSec * 1000).toFixed(0)} ms`);
    }

    // ---------------------------------------------------------------- per frame
    tick() {
        const s = this.session; const clock = s.clock;
        if (s.phase === 'idle' || s.phase === 'roundEnd') { this.prepare(); return; }
        if (!clock || (s.phase !== 'countin' && s.phase !== 'live')) return;
        if (this.plannedRound !== s.round) { if (this.preparedFor !== s.round) this.prepare(); this.plan(); }
        const beat = clock.beatAt(this.now());
        for (const st of this.steps.slice()) if (!st.done && beat >= st.beat) { st.done = true; st.run(); }
        for (const r of this.ramps) if (beat >= r.start && beat <= r.end) r.apply(r.from + (r.to - r.from) * ((beat - r.start) / Math.max(1e-6, r.end - r.start)));
        for (const r of this.ramps) if (beat > r.end && !r.fin) { r.fin = true; r.apply(r.to); }
        const every = this.profile.phaseCheckEveryBeats;
        if (s.phase === 'live' && every > 0) {
            const bucket = Math.floor(beat / every);
            if (bucket > this.lastPhaseCheck && bucket > 0) { this.lastPhaseCheck = bucket; const id = this.port.peek().trackId; const tr = id ? this.tracks.find(x => x.id === id) : undefined; if (tr) this.checkPhase(tr); }
        }
    }
}
