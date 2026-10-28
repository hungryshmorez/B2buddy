/**
 * TypeScript port of the AI DJ decision layer, so the browser build can use the fork's logic with no server.
 * Source: hungryshmorez/AI-DJ-Mixing-System @ d56bd28 (MIT, (c) 2025 Kuchi Chaitanya Krishna Deepak), generate_mixing_plan.py:
 *   GENRE_TRANSITION_RULES, CAMELOT_WHEEL, calculate_key_compatibility, score_transition_candidate, select_best_transition_point, calculate_dynamic_overlap.
 * This is a PORT, not the original: it is held to the original by golden vectors produced by running the fork's own Python
 * (services/aidj/make_golden.py -> test/fixtures/aidj-golden.json -> test/aidj.test.ts). When the service is reachable, the same
 * decisions come from the Python itself (AiDjServiceBrain).
 */

export interface AidjCandidate { time: number; type: string; reasoning?: string; has_vocals_after?: boolean; energy?: string }
export interface AidjStructure {
    transition_candidates?: AidjCandidate[]; has_vocals_in_first_8s?: boolean; energy_analysis?: { buildups?: unknown[] };
    recommended_transition?: number; transition_point?: number;
}
export interface AidjTrack { id: string; title?: string; bpm?: number; key?: string; genre?: string; structure?: AidjStructure }
export interface ScoredCandidate { time: number; type: string; score: number; reasoning: string }
export interface TransitionPlan { transitionTimeSec: number; best: ScoredCandidate | null; candidates: ScoredCandidate[]; overlapSec: number; keyScore: number; bpmDiff: number }
export interface RankRow { id: string; score: number; keyScore: number; bpmDiff: number; overlapSec: number; bestType: string | null; bestTime: number }

const GENRE_RULES: Record<string, { preferred: string; avoid: string[] }> = {
    'afrobeats': { preferred: 'verse_end', avoid: ['mid_chorus'] }, 'r&b': { preferred: 'breakdown_start', avoid: ['mid_vocal_phrase'] },
    'pop': { preferred: 'chorus_end', avoid: [] }, 'edm': { preferred: 'pre_drop', avoid: ['mid_buildup'] },
    'hip hop': { preferred: 'verse_end', avoid: ['mid_hook'] }, 'dancehall': { preferred: 'chorus_end', avoid: [] },
};

const WHEEL: Record<string, string[]> = {
    'C': ['G', 'F', 'Am'], 'C#': ['G#', 'F#', 'A#m'], 'D': ['A', 'G', 'Bm'], 'D#': ['A#', 'G#', 'Cm'], 'E': ['B', 'A', 'C#m'], 'F': ['C', 'A#', 'Dm'],
    'F#': ['C#', 'B', 'D#m'], 'G': ['D', 'C', 'Em'], 'G#': ['D#', 'C#', 'Fm'], 'A': ['E', 'D', 'F#m'], 'A#': ['F', 'D#', 'Gm'], 'B': ['F#', 'E', 'G#m'],
    'Am': ['Em', 'Dm', 'C'], 'A#m': ['Fm', 'D#m', 'C#'], 'Bm': ['F#m', 'Em', 'D'], 'Cm': ['Gm', 'Fm', 'D#'], 'C#m': ['G#m', 'F#m', 'E'], 'Dm': ['Am', 'Gm', 'F'],
    'D#m': ['A#m', 'G#m', 'F#'], 'Em': ['Bm', 'Am', 'G'], 'Fm': ['Cm', 'A#m', 'G#'], 'F#m': ['C#m', 'Bm', 'A'], 'Gm': ['Dm', 'Cm', 'A#'], 'G#m': ['D#m', 'C#m', 'B'],
};

/** Camelot code -> the note name the fork's wheel uses (A = minor, B = major). Identical to CAMELOT_TO_KEY in services/aidj/core.py. */
export const CAMELOT_TO_KEY: Record<string, string> = {
    '1A': 'G#m', '2A': 'D#m', '3A': 'A#m', '4A': 'Fm', '5A': 'Cm', '6A': 'Gm', '7A': 'Dm', '8A': 'Am', '9A': 'Em', '10A': 'Bm', '11A': 'F#m', '12A': 'C#m',
    '1B': 'B', '2B': 'F#', '3B': 'C#', '4B': 'G#', '5B': 'D#', '6B': 'A#', '7B': 'F', '8B': 'C', '9B': 'G', '10B': 'D', '11B': 'A', '12B': 'E',
};

export function toAidjKey(k: unknown): string {
    if (typeof k !== 'string') return ''; const s = k.trim(); const up = s.toUpperCase();
    if (up in CAMELOT_TO_KEY) return CAMELOT_TO_KEY[up]; return s in WHEEL ? s : '';
}

export function calculateKeyCompatibility(key1: string, key2: string): number {
    if (!key1 || !key2 || !(key1 in WHEEL)) return 0.5;
    if (key1 === key2) return 1.0;
    if (WHEEL[key1].includes(key2)) return 1.0;
    if (key1.endsWith('m') && key2 === key1.slice(0, -1)) return 0.8;
    if (!key1.endsWith('m') && key2 === key1 + 'm') return 0.8;
    return -1.0;
}

interface Norm { id: string; title: string; bpm: number; key: string; genre: string; structure?: AidjStructure }
export function normTrack(t: AidjTrack | null | undefined): Norm {
    const x = t ?? ({} as AidjTrack);
    const out: Norm = { id: String(x.id ?? ''), title: String(x.title ?? ''), bpm: typeof x.bpm === 'number' ? x.bpm : 120, key: toAidjKey(x.key), genre: String(x.genre || '').toLowerCase() };
    if (x.structure && typeof x.structure === 'object') out.structure = x.structure; return out;
}
const structureOf = (t: Norm): AidjStructure => t.structure ?? (t as unknown as AidjStructure);

export function scoreTransitionCandidate(cand: AidjCandidate, cur: Norm, next: Norm): number {
    let score = 50.0;
    const nextStructure = structureOf(next); const nextIntroVocals = nextStructure.has_vocals_in_first_8s ?? true;
    const rules = GENRE_RULES[cur.genre];
    if (rules && rules.preferred && cand.type === rules.preferred) score += 15; else if (rules && rules.avoid.includes(cand.type)) score -= 15;
    const vocalsAfter = cand.has_vocals_after ?? true;
    if (vocalsAfter && nextIntroVocals) score -= 20; else if (!vocalsAfter && !nextIntroVocals) score += 15; else if (!vocalsAfter) score += 10;
    const energy = cand.energy ?? 'medium'; const buildups = nextStructure.energy_analysis?.buildups ?? [];
    if (energy === 'high' && buildups.length > 0) score += 10; else if (energy === 'building') score += 15; else if (energy === 'dropping') score -= 5;
    const ks = calculateKeyCompatibility(cur.key, next.key); if (ks >= 1.0) score += 10; else if (ks < 0) score -= 10;
    const d = Math.abs(cur.bpm - next.bpm); if (d < 5) score += 5; else if (d > 20) score -= 5;
    score += ({ breakdown_start: 10, pre_drop: 8, verse_end: 5, chorus_end: 3 } as Record<string, number>)[cand.type] ?? 0;
    return Math.max(0, Math.min(100, score));
}

export function selectBestTransitionPoint(cur: Norm, next: Norm): number {
    const s = structureOf(cur); const cands = s.transition_candidates ?? [];
    if (!cands.length) { if (s.recommended_transition) return s.recommended_transition; if (s.transition_point) return s.transition_point; return 70.0; }
    const scored = cands.map(c => ({ time: c.time, score: scoreTransitionCandidate(c, cur, next) }));
    scored.sort((a, b) => b.score - a.score); return scored[0].time;
}

export function calculateDynamicOverlap(from: Norm, to: Norm): number {
    let o = 8.0; const d = Math.abs(from.bpm - to.bpm);
    if (d > 20) o += 4.0; else if (d > 10) o += 2.0;
    const ks = calculateKeyCompatibility(from.key, to.key); if (ks < 0) o -= 2.0; else if (ks >= 1.0) o += 2.0;
    const a = from.genre, b = to.genre;
    if (a.includes('edm') || b.includes('edm') || a.includes('house') || b.includes('house')) o += 4.0;
    else if (a.includes('hip') || b.includes('hip') || a.includes('rap') || b.includes('rap')) o -= 2.0;
    return Math.max(4.0, Math.min(16.0, o));
}

export function planTransition(current: AidjTrack, next: AidjTrack): TransitionPlan {
    const c = normTrack(current), n = normTrack(next);
    const scored: ScoredCandidate[] = (structureOf(c).transition_candidates ?? []).map(k => ({ time: k.time, type: k.type, score: scoreTransitionCandidate(k, c, n), reasoning: k.reasoning ?? '' }));
    scored.sort((a, b) => b.score - a.score);
    return { transitionTimeSec: selectBestTransitionPoint(c, n), best: scored[0] ?? null, candidates: scored, overlapSec: calculateDynamicOverlap(c, n), keyScore: calculateKeyCompatibility(c.key, n.key), bpmDiff: Math.abs(c.bpm - n.bpm) };
}

export function rankNext(previous: AidjTrack, candidates: readonly AidjTrack[], avoid: ReadonlySet<string> = new Set()): RankRow[] {
    const rows: Array<RankRow & { i: number }> = [];
    candidates.forEach((cand, i) => {
        const id = String(cand?.id ?? ''); if (avoid.has(id) || id === String(previous?.id ?? '')) return;
        const p = planTransition(previous, cand);
        rows.push({ id, score: p.best ? p.best.score : 50.0, keyScore: p.keyScore, bpmDiff: p.bpmDiff, overlapSec: p.overlapSec, bestType: p.best ? p.best.type : null, bestTime: p.transitionTimeSec, i });
    });
    rows.sort((a, b) => (b.score - a.score) || (a.bpmDiff - b.bpmDiff) || (a.i - b.i));
    return rows.map(({ i: _i, ...r }) => r);
}
