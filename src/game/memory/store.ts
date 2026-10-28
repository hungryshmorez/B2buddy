import { BuddyPrefs } from '../ai/buddy';

/** Durable project rules. Shown read-only; nothing in the game can edit them. Checked where measurable (see supervisor.ts). */
export const PROJECT_RULES = Object.freeze(([
    { id: 'browser-first', text: 'B2Buddy runs in the browser; no native dependency is required to play.' },
    { id: 'real-audio', text: 'Controls must act on the real audio signal or be marked unavailable. Never a visual-only control.' },
    { id: 'real-midi', text: 'Controller support uses the Web MIDI API with MIDI Learn; keyboard and mouse always remain a fallback. A controller is never called tested without hardware.' },
    { id: 'ai-owns-own-station', text: 'Buddy acts only through validated commands on its own station.' },
    { id: 'honest-metadata', text: 'Guessed BPM or key is never labelled verified. Origins: declared, measured, manual, estimated, unavailable.' },
    { id: 'user-owns-memory', text: 'Buddy never changes its own durable preferences: it proposes, the user approves.' },
    { id: 'checkpoints', text: 'Preserve the working version, verify the checkpoint, then take the next risky step.' },
] as const).map(r => Object.freeze({ ...r })));

export type PrefKey = 'phraseWait' | 'fadeBeats' | 'avoidFilter';
export interface Pref { id: string; key: PrefKey; value: boolean | number; enabled: boolean; origin: 'user' | 'learned'; label: string; createdAt: number }
export interface Proposal { id: string; status: 'pending' | 'approved' | 'rejected'; key: PrefKey; value: boolean | number; label: string; reason: string; confidence: number; appliesWhen: string; evidence: string[]; createdAt: number }
export interface Experience {
    id: string; time: number; matchId: string; round: number; difficulty: string;
    decision: string; evidence: string; action: string;
    outcome: { player: number; buddy: number; winner: string };
    correction?: string; lesson?: string;
}
export interface DriftAlert { id: string; time: number; kind: 'preference-violated' | 'refused-commands' | 'contradiction' | 'rule-check'; message: string; acknowledged: boolean }
export interface Snapshot { id: string; time: number; label: string; prefs: Pref[] }
export interface MemoryState {
    version: 1; mission: string; prefs: Pref[]; proposals: Proposal[]; experiences: Experience[]; drift: DriftAlert[]; snapshots: Snapshot[];
    stats: { battles: number; wins: number; losses: number; draws: number };
}

export const DEFAULT_MISSION = 'Win fair battles through clean, beat-matched mixing. Explain choices. Learn only what the DJ approves.';
const KEY = 'b2buddy.memory.v1';
const MAX_EXPERIENCES = 400;

export interface KeyValueStorage { getItem(k: string): string | null; setItem(k: string, v: string): void; removeItem(k: string): void }
export class MemoryStorage implements KeyValueStorage {
    private m = new Map<string, string>();
    getItem(k: string) { return this.m.has(k) ? this.m.get(k)! : null; } setItem(k: string, v: string) { this.m.set(k, v); } removeItem(k: string) { this.m.delete(k); }
}

export function emptyState(): MemoryState { return { version: 1, mission: DEFAULT_MISSION, prefs: [], proposals: [], experiences: [], drift: [], snapshots: [], stats: { battles: 0, wins: 0, losses: 0, draws: 0 } }; }

let counter = 0;
const uid = (p: string) => `${p}${Date.now().toString(36)}${(counter++).toString(36)}`;

/** Inspectable, editable, persistent memory. Everything here is plain JSON the user can read, disable, delete or roll back. */
export class MemoryStore {
    state: MemoryState = emptyState();
    /** Set when stored data could not be read; the unreadable copy is kept under another key and the user is told. */
    loadProblem: string | null = null;
    private listeners: Array<() => void> = [];
    constructor(private readonly storage: KeyValueStorage, private readonly clock: () => number = () => Date.now()) { this.load(); }

    subscribe(fn: () => void) { this.listeners.push(fn); return () => { this.listeners = this.listeners.filter(l => l !== fn); }; }
    private changed() { this.save(); for (const l of this.listeners) l(); }

    private load() {
        let raw: string | null = null;
        try { raw = this.storage.getItem(KEY); } catch { this.loadProblem = 'Browser storage is unavailable: memory will not persist.'; return; }
        if (!raw) return;
        try {
            const j = JSON.parse(raw) as Partial<MemoryState>;
            if (j.version !== 1 || !Array.isArray(j.prefs) || !Array.isArray(j.experiences) || !Array.isArray(j.proposals)) throw new Error('unknown format');
            this.state = { ...emptyState(), ...j, stats: { ...emptyState().stats, ...(j.stats ?? {}) }, drift: j.drift ?? [], snapshots: j.snapshots ?? [], mission: typeof j.mission === 'string' ? j.mission : DEFAULT_MISSION } as MemoryState;
        } catch (e) {
            this.loadProblem = `Saved memory could not be read (${(e as Error).message}); it was kept as a backup and Buddy starts with empty memory.`;
            try { this.storage.setItem(KEY + '.corrupt', raw); } catch { /* ignore */ }
            this.state = emptyState();
        }
    }
    private save() { try { this.storage.setItem(KEY, JSON.stringify(this.state)); } catch { this.loadProblem = this.loadProblem ?? 'Memory could not be saved (storage full or blocked).'; } }

    // ---------------------------------------------------------------- what the AI is allowed to use
    /** Only enabled preferences (user-made, or learned AND approved) reach the AI. */
    buddyPrefs(): BuddyPrefs {
        const p: BuddyPrefs = {};
        for (const x of this.state.prefs) {
            if (!x.enabled) continue;
            if (x.key === 'phraseWait' && typeof x.value === 'boolean') p.phraseWait = x.value;
            if (x.key === 'fadeBeats' && typeof x.value === 'number') p.fadeBeats = x.value;
            if (x.key === 'avoidFilter' && typeof x.value === 'boolean') p.avoidFilter = x.value;
        }
        return p;
    }

    /** Persist after a caller edited an item in place (e.g. attaching a correction to an experience). */
    touch() { this.changed(); }

    setMission(text: string) { this.snapshot('before mission edit'); this.state.mission = text.trim() || DEFAULT_MISSION; this.changed(); }

    // ---------------------------------------------------------------- preferences
    addPref(key: PrefKey, value: boolean | number, label: string, origin: Pref['origin'] = 'user') {
        const p: Pref = { id: uid('p'), key, value, enabled: true, origin, label, createdAt: this.clock() };
        this.snapshot('before adding: ' + label); this.state.prefs.push(p); this.checkContradictions(); this.changed(); return p;
    }
    editPref(id: string, patch: Partial<Pick<Pref, 'value' | 'enabled' | 'label'>>) { const p = this.state.prefs.find(x => x.id === id); if (!p) return false; this.snapshot('before editing: ' + p.label); Object.assign(p, patch); this.checkContradictions(); this.changed(); return true; }
    deletePref(id: string) { const p = this.state.prefs.find(x => x.id === id); if (!p) return false; this.snapshot('before deleting: ' + p.label); this.state.prefs = this.state.prefs.filter(x => x.id !== id); this.changed(); return true; }
    deleteExperience(id: string) { this.state.experiences = this.state.experiences.filter(x => x.id !== id); this.changed(); }

    // ---------------------------------------------------------------- proposals (the approval queue)
    propose(key: PrefKey, value: boolean | number, label: string, reason: string, confidence: number, appliesWhen: string, evidence: string[]): Proposal | null {
        if (this.state.prefs.some(p => p.key === key && p.value === value && p.enabled)) return null;
        if (this.state.proposals.some(p => p.status === 'pending' && p.key === key && p.value === value)) return null;
        const pr: Proposal = { id: uid('q'), status: 'pending', key, value, label, reason, confidence, appliesWhen, evidence, createdAt: this.clock() };
        this.state.proposals.push(pr); this.changed(); return pr;
    }
    approve(id: string) {
        const pr = this.state.proposals.find(p => p.id === id && p.status === 'pending'); if (!pr) return false;
        pr.status = 'approved'; this.addPref(pr.key, pr.value, pr.label, 'learned'); this.changed(); return true;
    }
    reject(id: string) { const pr = this.state.proposals.find(p => p.id === id && p.status === 'pending'); if (!pr) return false; pr.status = 'rejected'; this.changed(); return true; }
    get pending() { return this.state.proposals.filter(p => p.status === 'pending'); }

    // ---------------------------------------------------------------- history
    addExperience(e: Omit<Experience, 'id' | 'time'>) {
        this.state.experiences.push({ ...e, id: uid('e'), time: this.clock() });
        if (this.state.experiences.length > MAX_EXPERIENCES) this.state.experiences.splice(0, this.state.experiences.length - MAX_EXPERIENCES);
        this.changed();
    }
    recordMatch(result: 'win' | 'loss' | 'draw') { const s = this.state.stats; s.battles++; if (result === 'win') s.wins++; else if (result === 'loss') s.losses++; else s.draws++; this.changed(); }
    addDrift(kind: DriftAlert['kind'], message: string) {
        if (this.state.drift.some(d => !d.acknowledged && d.kind === kind && d.message === message)) return;
        this.state.drift.push({ id: uid('d'), time: this.clock(), kind, message, acknowledged: false }); this.changed();
    }
    acknowledgeDrift(id: string) { const d = this.state.drift.find(x => x.id === id); if (d) { d.acknowledged = true; this.changed(); } }

    /** Contradictions are reported, never silently resolved. */
    private checkContradictions() {
        const by = new Map<string, Pref[]>();
        for (const p of this.state.prefs.filter(x => x.enabled)) by.set(p.key, [...(by.get(p.key) ?? []), p]);
        for (const [k, list] of by) if (new Set(list.map(l => String(l.value))).size > 1) this.addDrift('contradiction', `Two enabled preferences disagree about "${k}": ${list.map(l => `"${l.label}"`).join(' vs ')}. Disable one.`);
    }

    // ---------------------------------------------------------------- rollback
    snapshot(label: string) { this.state.snapshots.push({ id: uid('s'), time: this.clock(), label, prefs: JSON.parse(JSON.stringify(this.state.prefs)) }); if (this.state.snapshots.length > 30) this.state.snapshots.shift(); }
    rollback(id: string) { const s = this.state.snapshots.find(x => x.id === id); if (!s) return false; this.state.prefs = JSON.parse(JSON.stringify(s.prefs)); this.state.snapshots = this.state.snapshots.filter(x => x.time <= s.time && x.id !== id); this.changed(); return true; }
    resetAll() { this.state = emptyState(); this.changed(); }
    exportJson() { return JSON.stringify(this.state, null, 2); }
}
