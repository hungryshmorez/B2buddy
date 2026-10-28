import { clamp, EqBand, GameTrack, StationControl, StationEvent, StationId, StationState } from './types';

/** What a real (Web Audio) or silent (test) output has to do for a station. The station itself owns all the playback arithmetic. */
export interface StationBackend {
    now(): number;
    onLoad(track: GameTrack): void;
    onStart(offsetSec: number, rate: number, atTime: number): void;
    onStop(): void;
    onRate(rate: number): void;
    onParam(name: 'volume' | 'low' | 'mid' | 'high' | 'filter', value: number): void;
}

export class SilentBackend implements StationBackend {
    constructor(private readonly clock: () => number) {}
    now() { return this.clock(); }
    onLoad() {} onStart() {} onStop() {} onRate() {} onParam() {}
}

/**
 * One DJ station: a deck plus its mixer channel. This class is the single place where "what is playing, where" is computed, for real audio and for tests alike.
 * A disabled station refuses every command (used for Deck B in the standard format, and by the AI-ownership tests).
 */
export class Station implements StationControl {
    private track: GameTrack | null = null;
    private playing = false;
    private offset = 0;       // position at the anchor
    private anchor = 0;       // time the anchor was taken (for a scheduled start: the start time)
    private rate = 1;
    private volume = 0.8;
    private eq: Record<EqBand, number> = { low: 0.5, mid: 0.5, high: 0.5 };
    private filter = 0.5;
    private cueSec = 0;
    private listeners: Array<(e: StationEvent) => void> = [];
    enabled = true;

    constructor(readonly id: StationId, private readonly backend: StationBackend) {}

    onEvent(fn: (e: StationEvent) => void) { this.listeners.push(fn); return () => { this.listeners = this.listeners.filter(l => l !== fn); }; }
    private emit(e: StationEvent) { for (const l of this.listeners) l(e); }
    get currentTrack() { return this.track; }

    private pos(now: number): number {
        if (!this.track) return 0;
        if (!this.playing || now < this.anchor) return this.offset;
        let p = this.offset + (now - this.anchor) * this.rate;
        const loop = this.track.loopSec;
        if (loop && loop > 0) p = p % loop;
        else if (p >= this.track.durationSec) { return this.track.durationSec; }
        return p;
    }

    state(): StationState {
        const now = this.backend.now();
        const p = this.pos(now);
        const ended = !!this.track && !this.track.loopSec && this.playing && p >= this.track.durationSec;
        return {
            id: this.id, enabled: this.enabled, trackId: this.track?.id ?? null,
            playing: this.playing && !ended, sounding: this.playing && !ended && now >= this.anchor, positionSec: p,
            rate: this.rate, volume: this.volume, eq: { ...this.eq }, filter: this.filter, cueSec: this.cueSec,
        };
    }

    /** Back to an empty, enabled, default-mixer station (a new match). */
    reset() {
        if (this.playing) { this.backend.onStop(); }
        this.track = null; this.playing = false; this.offset = 0; this.anchor = 0; this.rate = 1; this.volume = 0.8; this.eq = { low: 0.5, mid: 0.5, high: 0.5 }; this.filter = 0.5; this.cueSec = 0; this.enabled = true;
        this.backend.onRate(1); this.backend.onParam('volume', 0.8); this.backend.onParam('low', 0.5); this.backend.onParam('mid', 0.5); this.backend.onParam('high', 0.5); this.backend.onParam('filter', 0.5);
    }

    load(track: GameTrack): boolean {
        if (!this.enabled) return false;
        if (this.playing) this.stopInternal();
        this.track = track; this.offset = 0; this.cueSec = track.bpm ? track.firstBeatSec : 0;
        this.backend.onLoad(track); this.emit({ type: 'load', trackId: track.id });
        return true;
    }

    play(at?: number): boolean {
        if (!this.enabled || !this.track) return false;
        const now = this.backend.now();
        if (this.playing) { this.offset = this.pos(now); this.backend.onStop(); }
        const start = Math.max(now, at ?? now);
        this.playing = true; this.anchor = start;
        this.backend.onStart(this.offset, this.rate, start);
        this.emit({ type: 'play', at: start });
        return true;
    }

    private stopInternal() {
        const now = this.backend.now();
        this.offset = this.pos(now); this.playing = false; this.backend.onStop();
    }

    pause(): boolean {
        if (!this.enabled || !this.playing) return false;
        this.stopInternal(); this.emit({ type: 'pause' }); return true;
    }

    cue(): boolean {
        if (!this.enabled || !this.track) return false;
        if (this.playing) this.stopInternal();
        this.offset = this.cueSec; this.emit({ type: 'seek', to: this.offset }); return true;
    }

    seek(sec: number): boolean {
        if (!this.enabled || !this.track) return false;
        const max = this.track.loopSec ?? this.track.durationSec;
        const to = clamp(sec, 0, max);
        const was = this.playing; const t = this.backend.now();
        if (was) { this.backend.onStop(); }
        this.offset = to; this.anchor = t;
        if (was) this.backend.onStart(this.offset, this.rate, t);
        this.emit({ type: 'seek', to }); return true;
    }

    setRate(rate: number): boolean {
        if (!this.enabled || !(rate >= 0.5 && rate <= 1.5)) return false;
        const now = this.backend.now();
        if (this.playing && now >= this.anchor) { this.offset = this.pos(now); this.anchor = now; }
        this.rate = rate; this.backend.onRate(rate); this.emit({ type: 'rate', rate }); return true;
    }

    setVolume(v: number): boolean {
        if (!this.enabled || !Number.isFinite(v)) return false;
        this.volume = clamp(v, 0, 1); this.backend.onParam('volume', this.volume); this.emit({ type: 'volume', value: this.volume }); return true;
    }

    setEq(band: EqBand, v: number): boolean {
        if (!this.enabled || !Number.isFinite(v)) return false;
        this.eq[band] = clamp(v, 0, 1); this.backend.onParam(band, this.eq[band]); this.emit({ type: 'eq', band, value: this.eq[band] }); return true;
    }

    setFilter(v: number): boolean {
        if (!this.enabled || !Number.isFinite(v)) return false;
        this.filter = clamp(v, 0, 1); this.backend.onParam('filter', this.filter); this.emit({ type: 'filter', value: this.filter }); return true;
    }
}
