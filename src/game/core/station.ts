import { clamp, CueData, CueStore, EqBand, GameTrack, HOT_CUES, LoopSpan, StationControl, StationEvent, StationId, StationState } from './types';

/** What a real (Web Audio) or silent (test) output has to do for a station. The station itself owns all the playback arithmetic. */
export interface StationBackend {
    now(): number;
    onLoad(track: GameTrack): void;
    onStart(offsetSec: number, rate: number, atTime: number): void;
    onStop(): void;
    onRate(rate: number): void;
    onParam(name: 'volume' | 'low' | 'mid' | 'high' | 'filter', value: number): void;
    /** A user loop (track seconds) applied to the running source without restarting it; null restores the track's own behaviour. */
    onLoop(loop: LoopSpan | null): void;
}

export class SilentBackend implements StationBackend {
    constructor(private readonly clock: () => number) {}
    now() { return this.clock(); }
    onLoad() {} onStart() {} onStop() {} onRate() {} onParam() {} onLoop() {}
}

/** Shortest loop the deck accepts (seconds): anything smaller is a click, not a loop. */
export const MIN_LOOP_SEC = 0.02;
/** A paused deck counts as "at the cue point" when it is within this many seconds of it. */
const AT_CUE_SEC = 0.04;
export const MAX_BEND = 0.5;

/**
 * One DJ station: a deck plus its mixer channel. This class is the single place where "what is playing, where" is computed, for real audio and for tests alike.
 * A disabled station refuses every command (used for Deck B in the standard format, and by the AI-ownership tests).
 *
 * The CDJ-style features (hot cues, loops, beat jump, quantize, cue preview, pitch bend, nudge) are methods on this class on purpose: the mouse, the keyboard,
 * MIDI and the tests all run the same arithmetic, and the AI's CommandPort is not given any of them.
 */
export class Station implements StationControl {
    private track: GameTrack | null = null;
    private playing = false;
    private offset = 0;       // position at the anchor
    private anchor = 0;       // time the anchor was taken (for a scheduled start: the start time)
    private rate = 1;
    private bend = 0;
    private volume = 0.8;
    private eq: Record<EqBand, number> = { low: 0.5, mid: 0.5, high: 0.5 };
    private filter = 0.5;
    private cueSec = 0;
    private userCue = false;
    private hot: Array<number | null> = new Array(HOT_CUES).fill(null);
    private quantizeOn = false;
    private loopSpan: LoopSpan | null = null;
    private loopActive = false;
    private loopInPoint: number | null = null;
    private previewReturn: number | null = null;
    private roll: { origin: number; since: number; prev: { span: LoopSpan | null; active: boolean; inPoint: number | null } } | null = null;
    private held: { resume: boolean } | null = null;
    private listeners: Array<(e: StationEvent) => void> = [];
    enabled = true;

    constructor(readonly id: StationId, private readonly backend: StationBackend, private readonly cues?: CueStore) {}

    onEvent(fn: (e: StationEvent) => void) { this.listeners.push(fn); return () => { this.listeners = this.listeners.filter(l => l !== fn); }; }
    private emit(e: StationEvent) { for (const l of this.listeners) l(e); }
    get currentTrack() { return this.track; }

    private eff() { return this.rate * (1 + this.bend); }
    private activeLoop(): LoopSpan | null { return this.loopActive ? this.loopSpan : null; }

    private pos(now: number): number {
        if (!this.track) return 0;
        if (!this.playing || now < this.anchor) return this.offset;
        const raw = this.offset + (now - this.anchor) * this.eff();
        const L = this.activeLoop();
        if (L && raw >= L.end) return L.start + ((raw - L.start) % (L.end - L.start));
        const loop = this.track.loopSec;
        if (loop && loop > 0) return raw % loop;
        return raw >= this.track.durationSec ? this.track.durationSec : raw;
    }

    /** Fold the elapsed playing time into the anchor so a rate or loop change cannot rewrite the past. */
    private reanchor(now: number) {
        if (this.playing && now >= this.anchor) { this.offset = this.pos(now); this.anchor = now; }
    }

    /** The furthest position a seek or loop may reach (a bundled loop track ends at its phrase length). */
    private limit() { return this.track ? (this.track.loopSec ?? this.track.durationSec) : 0; }
    private beatLen(): number | null { const b = this.track?.bpm; return b && b > 0 ? 60 / b : null; }

    /** With quantize on and a known beat grid, snap a position to the nearest beat; otherwise leave it alone. */
    private snap(sec: number): number {
        const bl = this.beatLen();
        if (!this.quantizeOn || !bl || !this.track) return sec;
        const f = this.track.firstBeatSec;
        return clamp(f + Math.round((sec - f) / bl) * bl, 0, this.limit());
    }

    state(): StationState {
        const now = this.backend.now();
        const p = this.pos(now);
        const ended = !!this.track && !this.track.loopSec && !this.activeLoop() && this.playing && p >= this.track.durationSec;
        return {
            id: this.id, enabled: this.enabled, trackId: this.track?.id ?? null,
            playing: this.playing && !ended, sounding: this.playing && !ended && now >= this.anchor, positionSec: p,
            rate: this.rate, volume: this.volume, eq: { ...this.eq }, filter: this.filter, cueSec: this.cueSec,
            bend: this.bend, quantize: this.quantizeOn, loop: this.loopSpan ? { ...this.loopSpan, active: this.loopActive } : null, loopIn: this.loopInPoint,
            hotCues: [...this.hot], previewing: this.previewReturn !== null,
        };
    }

    /** Back to an empty, enabled, default-mixer station (a new match). */
    reset() {
        if (this.playing) { this.backend.onStop(); }
        this.track = null; this.playing = false; this.offset = 0; this.anchor = 0; this.rate = 1; this.bend = 0; this.volume = 0.8; this.eq = { low: 0.5, mid: 0.5, high: 0.5 }; this.filter = 0.5; this.cueSec = 0; this.enabled = true;
        this.userCue = false; this.hot = new Array(HOT_CUES).fill(null); this.loopSpan = null; this.loopActive = false; this.loopInPoint = null; this.previewReturn = null; this.roll = null; this.held = null;
        this.backend.onLoop(null);
        this.backend.onRate(1); this.backend.onParam('volume', 0.8); this.backend.onParam('low', 0.5); this.backend.onParam('mid', 0.5); this.backend.onParam('high', 0.5); this.backend.onParam('filter', 0.5);
    }

    load(track: GameTrack): boolean {
        if (!this.enabled) return false;
        if (this.playing) this.stopInternal();
        this.track = track; this.offset = 0; this.bend = 0;
        this.loopSpan = null; this.loopActive = false; this.loopInPoint = null; this.previewReturn = null; this.roll = null; this.held = null; this.backend.onLoop(null);
        const saved = this.cues?.load(track.id) ?? null;
        this.hot = new Array(HOT_CUES).fill(null);
        if (saved) saved.hot.slice(0, HOT_CUES).forEach((v, i) => { this.hot[i] = typeof v === 'number' && Number.isFinite(v) ? clamp(v, 0, this.limit()) : null; });
        this.userCue = !!saved && typeof saved.cue === 'number' && Number.isFinite(saved.cue);
        this.cueSec = this.userCue ? clamp(saved!.cue as number, 0, this.limit()) : track.bpm ? track.firstBeatSec : 0;
        this.backend.onLoad(track); this.backend.onRate(this.eff()); this.emit({ type: 'load', trackId: track.id });
        return true;
    }

    private persist() {
        if (!this.track || !this.cues) return;
        const data: CueData = { cue: this.userCue ? this.cueSec : null, hot: [...this.hot] };
        this.cues.save(this.track.id, data);
    }

    play(at?: number): boolean {
        if (!this.enabled || !this.track) return false;
        const now = this.backend.now();
        this.previewReturn = null; this.held = null;
        if (this.playing) { this.offset = this.pos(now); this.backend.onStop(); }
        const start = Math.max(now, at ?? now);
        this.playing = true; this.anchor = start;
        this.backend.onStart(this.offset, this.eff(), start);
        this.emit({ type: 'play', at: start });
        return true;
    }

    private stopInternal() {
        const now = this.backend.now();
        this.offset = this.pos(now); this.playing = false; this.backend.onStop();
    }

    pause(): boolean {
        if (!this.enabled || !this.playing) return false;
        this.previewReturn = null;
        this.stopInternal(); this.emit({ type: 'pause' }); return true;
    }

    /** The original cue contract, unchanged: stop and go back to the cue point. */
    cue(): boolean {
        if (!this.enabled || !this.track) return false;
        this.previewReturn = null;
        if (this.playing) this.stopInternal();
        this.offset = this.cueSec; this.emit({ type: 'seek', to: this.offset }); return true;
    }

    seek(sec: number): boolean {
        if (!this.enabled || !this.track) return false;
        const max = this.limit();
        return this.moveTo(clamp(sec, 0, max));
    }

    /** Jump to a position with the audio actually following (restarts the source when playing). A jump past the end of a running loop leaves the loop. */
    private moveTo(to: number): boolean {
        const L = this.activeLoop();
        if (L && to >= L.end) { this.loopActive = false; this.backend.onLoop(null); this.emit({ type: 'loop', loop: this.loopSpan ? { ...this.loopSpan, active: false } : null }); }
        const was = this.playing; const t = this.backend.now();
        if (was) { this.backend.onStop(); }
        this.offset = to; this.anchor = t;
        if (was) this.backend.onStart(this.offset, this.eff(), t);
        this.emit({ type: 'seek', to }); return true;
    }

    setRate(rate: number): boolean {
        if (!this.enabled || !(rate >= 0.5 && rate <= 1.5)) return false;
        const now = this.backend.now();
        this.reanchor(now);
        this.rate = rate; this.backend.onRate(this.eff()); this.emit({ type: 'rate', rate }); return true;
    }

    /** Temporary pitch bend: a multiplier on the tempo fader that the jog wheel or a bend button applies and releases. 0 = no bend. */
    setBend(b: number): boolean {
        if (!this.enabled || !Number.isFinite(b)) return false;
        const v = clamp(b, -MAX_BEND, MAX_BEND);
        if (v === this.bend) return true;
        this.reanchor(this.backend.now());
        this.bend = v; this.backend.onRate(this.eff()); this.emit({ type: 'bend', value: v }); return true;
    }

    /** Move the position by a small amount in track seconds (jog on a paused deck, search). The audio follows when playing. */
    nudge(sec: number): boolean {
        if (!this.enabled || !this.track || !Number.isFinite(sec)) return false;
        const p = this.pos(this.backend.now());
        const max = this.limit();
        const target = this.track.loopSec ? ((p + sec) % max + max) % max : clamp(p + sec, 0, max);
        return this.moveTo(target);
    }

    /** Vinyl-style touch: the sound stops while the platter is held. Pair with scrubRelease(). */
    scrubHold(): boolean {
        if (!this.enabled || !this.track || this.held) return false;
        const resume = this.playing;
        if (resume) this.stopInternal();
        this.held = { resume }; return true;
    }
    scrubRelease(): boolean {
        if (!this.held) return false;
        const resume = this.held.resume; this.held = null;
        if (resume) return this.play();
        return true;
    }
    get scrubbing() { return this.held !== null; }

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

    // ------------------------------------------------------------------ CDJ: quantize, cue, hot cues
    setQuantize(on: boolean): boolean {
        if (!this.enabled) return false;
        this.quantizeOn = on; this.emit({ type: 'quantize', on }); return true;
    }

    /** Set the cue point (default: the current position), snapped to the beat grid when quantize is on. */
    setCue(at?: number): boolean {
        if (!this.enabled || !this.track) return false;
        const p = at ?? this.pos(this.backend.now());
        if (!Number.isFinite(p)) return false;
        this.cueSec = this.snap(clamp(p, 0, this.limit())); this.userCue = true; this.persist(); this.emit({ type: 'cue', sec: this.cueSec }); return true;
    }

    /**
     * CDJ CUE button, pressed. Playing: return to the cue point and stop. Paused away from the cue point: set a new cue point here.
     * Paused at the cue point: play from it for as long as the button is held (cueRelease() returns and stops).
     */
    cuePress(): 'return' | 'set' | 'preview' | null {
        if (!this.enabled || !this.track) return null;
        if (this.playing) { this.cue(); return 'return'; }
        const p = this.pos(this.backend.now());
        if (Math.abs(p - this.cueSec) > AT_CUE_SEC) { this.setCue(); return 'set'; }
        this.play(); this.previewReturn = this.cueSec; return 'preview';
    }
    cueRelease(): boolean { return this.endPreview(); }

    private endPreview(): boolean {
        if (this.previewReturn === null) return false;
        const back = this.previewReturn; this.previewReturn = null;
        if (this.playing) this.stopInternal();
        this.offset = back; this.emit({ type: 'seek', to: back }); return true;
    }

    /** Hot cue pad A-H pressed. Empty pad: store the current position (snapped when quantize is on). Set pad: jump there; on a paused deck it plays only while held. */
    hotCuePress(i: number): 'set' | 'jump' | 'preview' | null {
        if (!this.enabled || !this.track || !Number.isInteger(i) || i < 0 || i >= HOT_CUES) return null;
        const at = this.hot[i];
        if (at === null) {
            this.hot[i] = this.snap(clamp(this.pos(this.backend.now()), 0, this.limit())); this.persist(); this.emit({ type: 'hotcue', index: i, sec: this.hot[i] }); return 'set';
        }
        if (this.playing) { this.moveTo(at); return 'jump'; }
        this.moveTo(at); this.play(); this.previewReturn = at; return 'preview';
    }
    hotCueRelease(): boolean { return this.endPreview(); }
    clearHotCue(i: number): boolean {
        if (!this.enabled || !this.track || !Number.isInteger(i) || i < 0 || i >= HOT_CUES || this.hot[i] === null) return false;
        this.hot[i] = null; this.persist(); this.emit({ type: 'hotcue', index: i, sec: null }); return true;
    }

    // ------------------------------------------------------------------ CDJ: beat jump and loops
    /** Move by a number of beats (negative = back) using the track's beat grid. Refused without a BPM. An active loop moves with the jump. */
    beatJump(beats: number): boolean {
        const bl = this.beatLen();
        if (!this.enabled || !this.track || !bl || !Number.isFinite(beats) || beats === 0) return false;
        const delta = beats * bl; const p = this.pos(this.backend.now()); const max = this.limit();
        const wrap = !!this.track.loopSec;
        const target = wrap ? (((p + delta) % max) + max) % max : p + delta;
        if (!wrap && (target < 0 || target > max)) return false;
        const L = this.activeLoop();
        if (L) {
            const s = L.start + delta, e = L.end + delta;
            if (s < 0 || e > max) return false;
            this.loopSpan = { start: s, end: e }; this.backend.onLoop(this.loopSpan); this.emit({ type: 'loop', loop: { ...this.loopSpan, active: true } });
        }
        return this.moveTo(target);
    }

    private applyLoopChange(prevPos: number) {
        const L = this.activeLoop(); const now = this.backend.now();
        this.backend.onLoop(L);
        if (!this.playing || now < this.anchor) { if (!this.playing && L && this.offset >= L.end) this.offset = L.start; return; }
        if (L && prevPos >= L.end - 0.03) {
            const len = L.end - L.start; const p = L.start + ((prevPos - L.start) % len);
            this.backend.onStop(); this.offset = p; this.anchor = now; this.backend.onStart(this.offset, this.eff(), now);
        } else { this.offset = prevPos; this.anchor = now; }
        this.emit({ type: 'loop', loop: this.loopSpan ? { ...this.loopSpan, active: this.loopActive } : null });
    }

    private canLoop() { return this.enabled && !!this.track; }

    /** LOOP IN at the current position (snapped when quantize is on). With a running loop it moves the loop's start. */
    loopIn(): boolean {
        if (!this.canLoop()) return false;
        const now = this.backend.now(); const prev = this.pos(now); const at = this.snap(prev);
        this.loopInPoint = at;
        if (this.loopSpan && this.loopSpan.end - at >= MIN_LOOP_SEC) { this.loopSpan = { start: at, end: this.loopSpan.end }; this.applyLoopChange(prev); }
        else this.emit({ type: 'loop', loop: this.loopSpan ? { ...this.loopSpan, active: this.loopActive } : null });
        return true;
    }

    /** LOOP OUT at the current position: closes the loop from the loop-in point and starts it. */
    loopOut(): boolean {
        if (!this.canLoop() || this.loopInPoint === null) return false;
        const now = this.backend.now(); const prev = this.pos(now); const end = this.snap(prev);
        if (end - this.loopInPoint < MIN_LOOP_SEC) return false;
        this.loopSpan = { start: this.loopInPoint, end: Math.min(end, this.limit()) }; this.loopActive = true; this.applyLoopChange(prev); return true;
    }

    /** An automatic loop of `beats` beats starting at the current position (snapped when quantize is on). Needs a BPM. */
    loopBeats(beats: number): boolean {
        const bl = this.beatLen();
        if (!this.canLoop() || !bl || !(beats > 0)) return false;
        const now = this.backend.now(); const prev = this.pos(now); const start = this.snap(prev); const end = Math.min(start + beats * bl, this.limit());
        if (end - start < MIN_LOOP_SEC) return false;
        this.loopInPoint = start; this.loopSpan = { start, end }; this.loopActive = true; this.applyLoopChange(prev); return true;
    }

    exitLoop(): boolean {
        if (!this.canLoop() || !this.loopActive) return false;
        const prev = this.pos(this.backend.now()); this.loopActive = false; this.applyLoopChange(prev); return true;
    }

    /** Return to the stored loop and run it again (jumps to its start when the playhead is outside it). */
    reloop(): boolean {
        if (!this.canLoop() || !this.loopSpan) return false;
        const prev = this.pos(this.backend.now());
        this.loopActive = true;
        if (prev < this.loopSpan.start || prev >= this.loopSpan.end) { this.applyLoopChange(this.loopSpan.start); this.moveTo(this.loopSpan.start); return true; }
        this.applyLoopChange(prev); return true;
    }

    loopHalve(): boolean {
        if (!this.canLoop() || !this.loopSpan) return false;
        const len = (this.loopSpan.end - this.loopSpan.start) / 2;
        if (len < MIN_LOOP_SEC) return false;
        const prev = this.pos(this.backend.now()); this.loopSpan = { start: this.loopSpan.start, end: this.loopSpan.start + len }; this.applyLoopChange(prev); return true;
    }

    loopDouble(): boolean {
        if (!this.canLoop() || !this.loopSpan) return false;
        const len = (this.loopSpan.end - this.loopSpan.start) * 2; const end = this.loopSpan.start + len;
        if (end > this.limit()) return false;
        const prev = this.pos(this.backend.now()); this.loopSpan = { start: this.loopSpan.start, end }; this.applyLoopChange(prev); return true;
    }

    /**
     * Loop roll: a loop that only lasts while the control is held. The track keeps "playing" underneath, so rollEnd() returns to where the
     * music would have been (and restores whatever loop state existed before). Needs a BPM and a playing deck.
     */
    rollStart(beats: number): boolean {
        const bl = this.beatLen();
        if (!this.canLoop() || !bl || !this.playing || this.roll || !(beats > 0)) return false;
        const now = this.backend.now(); const prev = this.pos(now);
        this.roll = { origin: prev, since: now, prev: { span: this.loopSpan ? { ...this.loopSpan } : null, active: this.loopActive, inPoint: this.loopInPoint } };
        const start = this.snap(prev); const end = Math.min(start + beats * bl, this.limit());
        if (end - start < MIN_LOOP_SEC) { this.roll = null; return false; }
        this.loopSpan = { start, end }; this.loopActive = true; this.loopInPoint = start; this.applyLoopChange(prev); return true;
    }
    rollEnd(): boolean {
        const r = this.roll; if (!r) return false;
        this.roll = null;
        const now = this.backend.now(); const virtual = clamp(r.origin + (now - r.since) * this.eff(), 0, this.limit());
        this.loopSpan = r.prev.span; this.loopActive = r.prev.active; this.loopInPoint = r.prev.inPoint;
        this.backend.onLoop(this.activeLoop());
        const L = this.activeLoop();
        const to = this.track?.loopSec ? virtual % this.limit() : virtual;
        const t = L && to >= L.end ? L.start : to;
        this.emit({ type: 'loop', loop: this.loopSpan ? { ...this.loopSpan, active: this.loopActive } : null });
        return this.moveTo(t);
    }
    get rolling() { return this.roll !== null; }
}
