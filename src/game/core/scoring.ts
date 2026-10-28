import { MasterClock, phaseDiff } from './clock';
import { GameTrack, StationControl, StationEvent, StationId } from './types';

export interface ScoreWeights { alignment: number; tempo: number; consistency: number; deadAir: number; changes: number; control: number; objective: number }
export const DEFAULT_WEIGHTS: ScoreWeights = { alignment: 30, tempo: 20, consistency: 15, deadAir: 15, changes: 10, control: 10, objective: 0 };

export interface ScoreItem { category: keyof ScoreWeights; points: number; outOf: number; reason: string }
export interface Breakdown {
    station: StationId;
    items: ScoreItem[];
    total: number;
    audibleSec: number;
    /** False when the sounding track has no beat grid, so alignment could not be measured. */
    alignmentMeasurable: boolean;
    changes: number;
}

export interface ObjectiveResult { points: number; outOf: number; reason: string }
export interface ObjectiveContext { station: StationId; changeTimes: number[]; clock: MasterClock; roundSec: number }

interface Acc {
    id: StationId; control: StationControl; track: GameTrack | null;
    audible: number; sounded: boolean; everSounded: boolean; silentRun: number; deadAir: number; abruptSilences: number;
    alignFull: number; alignN: number; alignSum: number;
    tempoN: number; tempoSum: number;
    windows: Map<number, { n: number; sum: number }>;
    changes: Array<{ beat: number; time: number; phraseOffsetBeats: number; tempoPct: number | null; keyFit: number | null; prevTitle: string; nextTitle: string }>;
    prevTrackForChange: GameTrack | null;
    lastWasAudible: boolean;
    techEvents: Array<{ tech: string; beat: number }>;
    changeBeats: number[]; ctlValue: Map<string, number>;
}

/** Camelot wheel compatibility, 0..1; null when either key is unknown. */
export function camelotFit(a: string | null, b: string | null): number | null {
    if (!a || !b) return null;
    const ma = /^(\d{1,2})([AB])$/.exec(a), mb = /^(\d{1,2})([AB])$/.exec(b); if (!ma || !mb) return null;
    const na = +ma[1], nb = +mb[1]; const d = Math.min(Math.abs(na - nb), 12 - Math.abs(na - nb)); const same = ma[2] === mb[2];
    return same ? (d === 0 ? 1 : d === 1 ? 0.9 : d === 2 ? 0.6 : 0.25) : (d === 0 ? 0.9 : 0.25);
}

/**
 * Scores a live round from what the stations actually did. Sampled from station state, never from random numbers and never from the number of clicks.
 * A player who never makes sound scores exactly 0. Every award carries its reason and the measured numbers.
 */
export class RoundScorer {
    private acc = new Map<StationId, Acc>();
    private elapsed = 0; private lastSample = NaN;
    private readonly unsub: Array<() => void> = [];

    constructor(private clock: MasterClock, private roundSec: number, private lookup: (id: string) => GameTrack | undefined,
        private weights: ScoreWeights = DEFAULT_WEIGHTS, private objective?: (c: ObjectiveContext) => ObjectiveResult,
        private onEventSource?: (id: StationId, fn: (e: StationEvent) => void) => () => void) {}

    attach(id: StationId, control: StationControl) {
        const a: Acc = { id, control, track: null, audible: 0, sounded: false, everSounded: false, silentRun: 0, deadAir: 0, abruptSilences: 0, alignFull: 0, alignN: 0, alignSum: 0, tempoN: 0, tempoSum: 0,
            windows: new Map(), changes: [], prevTrackForChange: null, lastWasAudible: false, techEvents: [], changeBeats: [], ctlValue: new Map() };
        const cur = control.state().trackId; a.prevTrackForChange = cur ? (this.lookup(cur) ?? null) : null;       // a load during the round is a change from whatever was on the deck
        this.acc.set(id, a);
        if (this.onEventSource) this.unsub.push(this.onEventSource(id, e => this.onEvent(a, e)));
    }
    detach() { this.unsub.forEach(u => u()); this.unsub.length = 0; }

    private onEvent(a: Acc, e: StationEvent) {
        const now = this.lastNow; if (!Number.isFinite(now)) return;
        const beat = this.clock.beatAt(now);
        if (beat < 0 || beat > this.roundSec / this.clock.beatSec) return;
        if (e.type === 'load') {
            const next = this.lookup(e.trackId); const prev = a.prevTrackForChange;
            if (prev && next && prev.id !== next.id && a.everSounded) {
                const phrase = this.clock.beatsPerBar * 4;      // 16 beats = one 4-bar phrase
                const m = beat % phrase; const off = Math.min(m, phrase - m);
                const tempoPct = prev.bpm && next.bpm ? Math.abs(next.bpm / prev.bpm - 1) * 100 : null;
                a.changes.push({ beat, time: now, phraseOffsetBeats: off, tempoPct, keyFit: camelotFit(prev.key, next.key), prevTitle: prev.title, nextTitle: next.title });
                a.changeBeats.push(beat);
            }
            if (next) a.prevTrackForChange = next;
        } else if (e.type === 'eq' || e.type === 'filter') {
            const key = e.type === 'eq' ? 'eq.' + e.band : 'filter';
            a.ctlValue.set(key, e.value);
            if (Math.abs(e.value - 0.5) > 0.15) a.techEvents.push({ tech: e.type === 'eq' ? 'EQ' : 'Filter', beat });
        }
    }
    private lastNow = NaN;

    sample(now: number) {
        this.lastNow = now;
        if (Number.isNaN(this.lastSample)) { this.lastSample = now; return; }
        const dt = now - this.lastSample; this.lastSample = now;
        if (dt <= 0 || dt > 1) return;
        this.elapsed += dt;
        const beat = this.clock.beatAt(now);
        for (const a of this.acc.values()) {
            const st = a.control.state(); a.track = st.trackId ? (this.lookup(st.trackId) ?? null) : null;
            const audible = st.sounding && st.volume >= 0.12 && st.eq.low + st.eq.mid + st.eq.high > 0.05;
            if (audible) { a.audible += dt; a.everSounded = true; a.silentRun = 0; a.lastWasAudible = true; }
            else if (a.everSounded) {
                a.silentRun += dt; a.deadAir += dt;
                if (a.lastWasAudible) { a.lastWasAudible = false; }
                if (a.silentRun > 1.5 && Math.abs(a.silentRun - dt - 1.5) < dt) a.abruptSilences++;
            }
            if (!audible || !a.track || !a.track.bpm) continue;
            const trackBeat = (st.positionSec - a.track.firstBeatSec) * a.track.bpm / 60;
            const errBeats = Math.abs(phaseDiff(trackBeat, beat));
            const errMs = errBeats * this.clock.beatSec * 1000;
            a.alignN++; a.alignSum += errMs; a.alignFull += errMs <= 25 ? 1 : errMs <= 50 ? 0.5 : errMs <= 80 ? 0.25 : 0;
            const eff = a.track.bpm * st.rate; const m = this.clock.bpm;
            const pct = Math.min(Math.abs(eff / m - 1), Math.abs(eff / (m * 2) - 1), Math.abs(eff / (m / 2) - 1)) * 100;
            a.tempoN++; a.tempoSum += pct >= 3 ? 0 : pct <= 0.3 ? 1 : pct <= 1 ? 0.6 : 0.25;
            const w = Math.floor(beat / 8); const win = a.windows.get(w) ?? { n: 0, sum: 0 }; win.n++; win.sum += errMs; a.windows.set(w, win);
        }
    }

    breakdown(id: StationId): Breakdown {
        const a = this.acc.get(id)!; const W = this.weights; const items: ScoreItem[] = [];
        const add = (category: keyof ScoreWeights, points: number, outOf: number, reason: string) => { if (outOf > 0) items.push({ category, points: Math.round(points * 10) / 10, outOf, reason }); };
        const roundSec = Math.max(1, this.roundSec);
        const cover = Math.min(1, a.audible / (roundSec * 0.6));
        const measurable = a.alignN > 0;
        if (!a.everSounded) {
            add('alignment', 0, W.alignment, 'no sound was made this round'); add('tempo', 0, W.tempo, 'no sound was made this round'); add('consistency', 0, W.consistency, 'no sound was made this round');
            add('deadAir', 0, W.deadAir, 'no sound was made this round'); add('changes', 0, W.changes, 'no sound was made this round'); add('control', 0, W.control, 'no sound was made this round');
            if (W.objective > 0) { const o = this.objective?.({ station: id, changeTimes: [], clock: this.clock, roundSec }); if (o) add('objective', 0, o.outOf, 'no sound was made this round'); }
            return { station: id, items, total: 0, audibleSec: 0, alignmentMeasurable: false, changes: 0 };
        }
        if (measurable) {
            const frac = a.alignFull / a.alignN; add('alignment', W.alignment * frac * cover, W.alignment, `mean beat error ${(a.alignSum / a.alignN).toFixed(0)} ms over ${a.alignN} samples; ${(frac * 100).toFixed(0)}% within tolerance; sounding ${(cover * 100).toFixed(0)}% of the target time`);
            const tf = a.tempoSum / a.tempoN; add('tempo', W.tempo * tf * cover, W.tempo, `tempo credit ${(tf * 100).toFixed(0)}% against the ${this.clock.bpm.toFixed(0)} BPM master`);
            const wins = [...a.windows.values()].filter(w => w.n >= 10); const good = wins.filter(w => w.sum / w.n <= 30).length;
            add('consistency', wins.length ? W.consistency * (good / wins.length) * cover : 0, W.consistency, wins.length ? `${good}/${wins.length} eight-beat windows averaged within 30 ms` : 'too little steady playing to judge consistency');
        } else {
            add('alignment', 0, W.alignment, 'the sounding track has no beat grid, so alignment cannot be measured (set its BPM in Track Library)');
            add('tempo', 0, W.tempo, 'unmeasurable without a known BPM'); add('consistency', 0, W.consistency, 'unmeasurable without a known BPM');
        }
        const deadFrac = Math.min(1, a.deadAir / roundSec); const deadPts = Math.max(0, 1 - deadFrac * 4 - a.abruptSilences * 0.2);
        add('deadAir', W.deadAir * deadPts, W.deadAir, `${a.deadAir.toFixed(1)} s of silence after first sound, ${a.abruptSilences} abrupt gap(s) over 1.5 s`);
        if (a.changes.length) {
            let sum = 0; const notes: string[] = [];
            for (const c of a.changes) {
                const phrase = c.phraseOffsetBeats <= 1 ? 1 : c.phraseOffsetBeats <= 2 ? 0.6 : c.phraseOffsetBeats <= 4 ? 0.3 : 0;
                const tempo = c.tempoPct === null ? 0.5 : c.tempoPct <= 3 ? 1 : c.tempoPct <= 6 ? 0.6 : 0.2;
                const key = c.keyFit === null ? 0.5 : c.keyFit;
                sum += 0.5 * phrase + 0.25 * tempo + 0.25 * key;
                notes.push(`${c.prevTitle} -> ${c.nextTitle}: ${c.phraseOffsetBeats.toFixed(1)} beats off the phrase, tempo change ${c.tempoPct === null ? 'unknown' : c.tempoPct.toFixed(1) + '%'}, key fit ${c.keyFit === null ? 'unknown' : (c.keyFit * 100).toFixed(0) + '%'}`);
            }
            add('changes', W.changes * Math.min(1, sum / a.changes.length), W.changes, notes.join('; '));
        } else add('changes', 0, W.changes, 'no track change was made this round');
        // a technique counts only when it is part of a hand-over: an EQ/filter move within 8 beats of a track change (wiggling controls earns nothing)
        const used = new Set(a.techEvents.filter(t => a.changeBeats.some(b => Math.abs(b - t.beat) <= 8)).map(t => t.tech));
        add('control', W.control * Math.min(1, used.size / 2), W.control, used.size ? `techniques used during a hand-over: ${[...used].join(', ')}` : 'no EQ or filter move during a hand-over (wiggling controls earns nothing)');
        if (W.objective > 0 && this.objective) { const o = this.objective({ station: id, changeTimes: a.changes.map(c => c.time), clock: this.clock, roundSec }); add('objective', o.points, o.outOf, o.reason); }
        const total = items.reduce((s, i) => s + i.points, 0);
        return { station: id, items, total: Math.round(total * 10) / 10, audibleSec: a.audible, alignmentMeasurable: measurable, changes: a.changes.length };
    }
}
