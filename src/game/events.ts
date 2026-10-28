/**
 * The event interface between the DJ brain, the game and the video engine.
 * Rules: events are facts that already happened (past tense); listeners can NEVER affect the emitter (a throwing listener is caught and counted,
 * the game carries on); the log is a bounded ring, so nothing grows without limit; nothing here polls.
 * Every event carries `t` (the audio-context time it refers to, seconds) and, when a battle clock exists, `beat`.
 */
export type GameEvent =
    | { type: 'track.loaded'; station: 'player' | 'buddy'; trackId: string }
    | { type: 'mix.started'; station: 'player' | 'buddy'; trackId: string }
    | { type: 'beat'; beat: number; bar: number; downbeat: boolean }
    | { type: 'phrase'; phrase: number }
    | { type: 'transition.started'; station: 'player' | 'buddy'; from: string; to: string }
    | { type: 'transition.completed'; station: 'player' | 'buddy'; to: string }
    | { type: 'dj.decision'; station: 'player' | 'buddy'; kind: string; decision: string; source: string }
    | { type: 'drop'; station: 'player' | 'buddy'; reason: string }
    | { type: 'round.started'; round: number }
    | { type: 'round.ended'; round: number; winner: string }
    | { type: 'score'; player: number; buddy: number }
    | { type: 'camera.changed'; camera: string }
    | { type: 'effect.selected'; id: string; name: string; engine: string }
    | { type: 'effect.toggled'; on: boolean; id: string | null }
    | { type: 'engine.status'; engine: 'bendr' | 'canvas'; state: 'ready' | 'degraded' | 'failed'; detail: string }
    | { type: 'brain.status'; mode: string; detail: string };

export type Stamped = GameEvent & { t: number; seq: number };
export type Listener = (e: Stamped) => void;

export class EventBus {
    private listeners = new Map<string, Set<Listener>>(); private anyL = new Set<Listener>();
    private ring: Stamped[] = []; private seq = 0; listenerErrors = 0;
    constructor(private readonly now: () => number = () => 0, readonly capacity = 256) {}

    emit(e: GameEvent): Stamped {
        const s = { ...e, t: this.now(), seq: ++this.seq } as Stamped;
        this.ring.push(s); if (this.ring.length > this.capacity) this.ring.splice(0, this.ring.length - this.capacity);
        for (const l of [...(this.listeners.get(s.type) ?? []), ...this.anyL]) { try { l(s); } catch { this.listenerErrors++; } }
        return s;
    }
    on<T extends GameEvent['type']>(type: T, fn: (e: Stamped & { type: T }) => void): () => void {
        let set = this.listeners.get(type); if (!set) this.listeners.set(type, set = new Set()); const l = fn as Listener; set.add(l); return () => { set!.delete(l); };
    }
    onAny(fn: Listener): () => void { this.anyL.add(fn); return () => { this.anyL.delete(fn); }; }
    /** Most recent events (oldest first), optionally of one type. */
    recent(type?: GameEvent['type'], n = 50): Stamped[] { const r = type ? this.ring.filter(e => e.type === type) : this.ring; return r.slice(-n); }
    get size() { return this.ring.length; }
    clear() { this.ring = []; }
}
