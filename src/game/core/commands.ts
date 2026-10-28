import { EqBand, GameTrack, StationControl, StationId } from './types';

export type Command =
    | { type: 'load'; trackId: string }
    | { type: 'play'; at?: number }
    | { type: 'pause' }
    | { type: 'seek'; sec: number }
    | { type: 'rate'; rate: number }
    | { type: 'volume'; value: number }
    | { type: 'eq'; band: EqBand; value: number }
    | { type: 'filter'; value: number };

export interface CommandRecord { time: number; owner: StationId; command: Command; ok: boolean; reason?: string }

/**
 * The only handle the AI gets. It is bound to ONE station and validates every command before it reaches the deck:
 * wrong owner, disabled station, unknown track, out-of-range or non-finite values are refused and logged. An LLM or rule engine can therefore
 * propose anything; only these validated commands ever execute.
 */
export class CommandPort {
    readonly log: CommandRecord[] = [];
    constructor(readonly owner: StationId, private readonly station: StationControl, private readonly library: ReadonlyMap<string, GameTrack>, private readonly now: () => number) {}

    /** Read-only view of the station this port is bound to (the AI may look at its own deck). */
    peek() { return this.station.state(); }
    get refused() { return this.log.filter(r => !r.ok).length; }

    exec(cmd: Command, as: StationId = this.owner): boolean {
        const rec = (ok: boolean, reason?: string) => { this.log.push({ time: this.now(), owner: as, command: cmd, ok, reason }); return ok; };
        if (as !== this.owner || this.station.id !== this.owner) return rec(false, 'station belongs to someone else');
        if (!this.station.state().enabled) return rec(false, 'station is disabled');
        const fin = (x: number) => Number.isFinite(x);
        switch (cmd.type) {
            case 'load': { const t = this.library.get(cmd.trackId); if (!t) return rec(false, 'unknown track'); return rec(this.station.load(t)); }
            case 'play': if (cmd.at !== undefined && !fin(cmd.at)) return rec(false, 'bad time'); return rec(this.station.play(cmd.at));
            case 'pause': return rec(this.station.pause());
            case 'seek': if (!fin(cmd.sec)) return rec(false, 'bad position'); return rec(this.station.seek(cmd.sec));
            case 'rate': if (!fin(cmd.rate) || cmd.rate < 0.8 || cmd.rate > 1.2) return rec(false, 'rate outside +-20%'); return rec(this.station.setRate(cmd.rate));
            case 'volume': if (!fin(cmd.value) || cmd.value < 0 || cmd.value > 1) return rec(false, 'volume outside 0..1'); return rec(this.station.setVolume(cmd.value));
            case 'eq': if (!fin(cmd.value) || cmd.value < 0 || cmd.value > 1) return rec(false, 'eq outside 0..1'); return rec(this.station.setEq(cmd.band, cmd.value));
            case 'filter': if (!fin(cmd.value) || cmd.value < 0 || cmd.value > 1) return rec(false, 'filter outside 0..1'); return rec(this.station.setFilter(cmd.value));
            default: return rec(false, 'unknown command');
        }
    }
}
