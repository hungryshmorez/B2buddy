import { GameTrack } from '../core/types';
import { AidjTrack, planTransition, rankNext, RankRow, TransitionPlan } from './aidjCore';

/**
 * The DJ brain interface. Buddy (core/ai/buddy.ts) stays the EXECUTOR: every action still goes through its validated CommandPort.
 * A brain only DECIDES: which track next, and how the transition should be shaped. `source` says which implementation produced a decision.
 */
export type BrainSource = 'aidj-service' | 'aidj-ts-port';
export interface BrainPlan { overlapSec: number; keyScore: number; bpmDiff: number; bestType: string | null; bestScore: number | null; bestTimeSec: number; source: BrainSource }
export interface BrainRank { id: string; score: number; keyScore: number; bpmDiff: number; overlapSec: number; bestType: string | null; source: BrainSource }
export interface BrainStatus { mode: 'service' | 'ts-port' | 'rules'; detail: string; serviceUrl?: string; fallbackCalls: number; warmedPairs: number; error?: string }

export interface DjBrain {
    plan(from: GameTrack, to: GameTrack): BrainPlan;
    rank(previous: GameTrack, candidates: readonly GameTrack[], avoid: ReadonlySet<string>): BrainRank[];
    status(): BrainStatus;
}

/** A GameTrack as the AI DJ sees it. Only facts B2Buddy actually has are passed; absent facts stay absent so the fork's own defaults apply. */
export function toAidjTrack(t: GameTrack, grid = true): AidjTrack {
    const out: AidjTrack = { id: t.id, title: t.title, bpm: t.bpm ?? undefined, key: t.key ?? undefined, genre: t.genre ?? '' };
    if (t.bpm && grid) {
        // Phrase ends from the track's own beat grid. They are grid positions, not analysed song sections; the type is therefore 'phrase_end' (unknown to the fork's type tables, so it earns no type bonus).
        const phraseSec = 32 * 60 / t.bpm; const end = t.loopSec ?? Math.min(t.durationSec, phraseSec * 4);
        const cands = []; for (let k = 1; k * phraseSec <= end + 1e-6 && cands.length < 4; k++) cands.push({ time: +(t.firstBeatSec + k * phraseSec).toFixed(3), type: 'phrase_end', reasoning: 'phrase boundary of the beat grid', ...(t.instrumental ? { has_vocals_after: false } : {}) });
        // chorus ends found by the AI DJ's local analysis come first: they are real (repetition-based) structure, unlike grid positions
        const choruses = (t.choruses ?? []).slice(0, 3).map(c => ({ time: +c.end.toFixed(3), type: 'chorus_end', reasoning: 'chorus found by chroma self-recurrence' }));
        out.structure = { transition_candidates: [...choruses, ...cands], ...(t.instrumental ? { has_vocals_in_first_8s: false } : {}) };
    }
    return out;
}

const pairKey = (a: string, b: string) => a + '>' + b;
const planOf = (p: TransitionPlan, source: BrainSource): BrainPlan => ({ overlapSec: p.overlapSec, keyScore: p.keyScore, bpmDiff: p.bpmDiff, bestType: p.best?.type ?? null, bestScore: p.best?.score ?? null, bestTimeSec: p.transitionTimeSec, source });
const rowOf = (r: RankRow, source: BrainSource): BrainRank => ({ ...r, source });

/** The AI DJ decision layer, in-process (TypeScript port, golden-tested against the fork's Python). Works with no server. */
export class AiDjTsBrain implements DjBrain {
    calls = 0;
    plan(from: GameTrack, to: GameTrack): BrainPlan { this.calls++; return planOf(planTransition(toAidjTrack(from), toAidjTrack(to)), 'aidj-ts-port'); }
    rank(previous: GameTrack, candidates: readonly GameTrack[], avoid: ReadonlySet<string>): BrainRank[] { this.calls++; return rankNext(toAidjTrack(previous), candidates.map(c => toAidjTrack(c)), avoid).map(r => rowOf(r, 'aidj-ts-port')); }
    status(): BrainStatus { return { mode: 'ts-port', detail: 'AI DJ decision logic, TypeScript port (no server)', fallbackCalls: 0, warmedPairs: 0 }; }
}

export interface ServiceFetch { (url: string, init?: { method?: string; body?: string; headers?: Record<string, string>; signal?: AbortSignal }): Promise<{ ok: boolean; status: number; json(): Promise<unknown> }> }

/**
 * The AI DJ decision layer run by the fork's own Python through services/aidj. Buddy's tick loop is synchronous, so decisions are fetched ahead of time
 * (`warm`, one request per ordered track pair) and served from the cache. Anything not cached, or any service failure, falls back to the TS port and is
 * counted + labelled, never silently relabelled as the service.
 */
export class AiDjServiceBrain implements DjBrain {
    private plans = new Map<string, BrainPlan>(); private ranks = new Map<string, BrainRank[]>(); private fallback = new AiDjTsBrain();
    fallbackCalls = 0; error: string | undefined; health: { fork?: { commit?: string }; librosa?: string } = {};
    constructor(readonly url: string, private readonly doFetch: ServiceFetch = (u, i) => fetch(u, i) as never, readonly timeoutMs = 4000) {}

    private async call<T>(path: string, body?: unknown): Promise<T> {
        const ctl = new AbortController(); const timer = setTimeout(() => ctl.abort(), this.timeoutMs);
        try {
            const r = await this.doFetch(this.url + path, body === undefined ? { signal: ctl.signal } : { method: 'POST', body: JSON.stringify(body), headers: { 'Content-Type': 'application/json' }, signal: ctl.signal });
            if (!r.ok) throw new Error(`service answered ${r.status}`); return await r.json() as T;
        } finally { clearTimeout(timer); }
    }

    /** Throws when the service is unreachable or is not the AI DJ service. */
    async connect(): Promise<void> {
        const h = await this.call<{ ok?: boolean; service?: string; fork?: { commit?: string }; librosa?: string }>('/v1/health');
        if (!h.ok || h.service !== 'b2buddy-aidj') throw new Error('not the B2Buddy AI DJ service'); this.health = h; this.error = undefined;
    }

    /** Ask the service for every ordered pair among `tracks`. Resolves with how many answers were cached; failures are recorded and leave the TS port in charge. */
    async warm(tracks: readonly GameTrack[]): Promise<number> {
        let ok = 0;
        try {
            const jobs: Array<Promise<void>> = [];
            for (const a of tracks) {
                const others = tracks.filter(b => b.id !== a.id);
                jobs.push(this.call<{ ranking: RankRow[] }>('/v1/rank', { previous: toAidjTrack(a), candidates: others.map(b => toAidjTrack(b)), avoid: [] }).then(r => { this.ranks.set(a.id, r.ranking.map(x => rowOf(x, 'aidj-service'))); ok++; }));
                for (const b of others) jobs.push(this.call<TransitionPlan>('/v1/plan', { current: toAidjTrack(a), next: toAidjTrack(b) }).then(p => { this.plans.set(pairKey(a.id, b.id), planOf(p, 'aidj-service')); ok++; }));
            }
            await Promise.all(jobs);
        } catch (e) { this.error = (e as Error).message; }
        return ok;
    }

    plan(from: GameTrack, to: GameTrack): BrainPlan { const c = this.plans.get(pairKey(from.id, to.id)); if (c) return c; this.fallbackCalls++; return this.fallback.plan(from, to); }
    rank(previous: GameTrack, candidates: readonly GameTrack[], avoid: ReadonlySet<string>): BrainRank[] {
        const full = this.ranks.get(previous.id); const ids = new Set(candidates.map(c => c.id));
        if (full && candidates.every(c => c.id === previous.id || full.some(r => r.id === c.id))) return full.filter(r => ids.has(r.id) && !avoid.has(r.id));    // the service ranking, restricted to who is allowed
        this.fallbackCalls++; return this.fallback.rank(previous, candidates, avoid);
    }
    status(): BrainStatus { return { mode: 'service', detail: `AI DJ service (fork ${(this.health.fork?.commit ?? '').slice(0, 7)}, librosa ${this.health.librosa ?? '?'})`, serviceUrl: this.url, fallbackCalls: this.fallbackCalls, warmedPairs: this.plans.size, error: this.error }; }
}
