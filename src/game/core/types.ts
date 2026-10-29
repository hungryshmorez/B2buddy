/** Where a piece of track metadata came from. Only 'declared' (shipped with a bundled track), 'measured' and 'manual' may be shown as reliable. */
export type MetaOrigin = 'declared' | 'measured' | 'manual' | 'estimated' | 'unavailable';

export interface GameTrack {
    id: string;
    title: string;
    artist: string;
    durationSec: number;
    /** Beats per minute of the track at rate 1, or null when unknown (such a deck cannot be scored for alignment). */
    bpm: number | null;
    bpmOrigin: MetaOrigin;
    /** Time of the first beat (seconds). Only meaningful when bpm is known. */
    firstBeatSec: number;
    key: string | null;
    keyOrigin: MetaOrigin;
    /** Bundled tracks are one short phrase that repeats; position wraps at this length. */
    loopSec?: number;
    /** Declared genre, only when someone actually knows it (never guessed). Absent = the AI DJ's own default. */
    /** Chorus sections found by the AI DJ's local analysis (chroma self-recurrence, repetition-based only). Absent = none found or not analysed. */
    choruses?: Array<{ start: number; end: number }>;
    genre?: string;
    /** True when the track is known to have no vocals (bundled tracks are generated instrumentals). Absent = unknown. */
    instrumental?: boolean;
    source: 'bundled' | 'user';
}

export type StationId = 'player' | 'buddy';
export type EqBand = 'low' | 'mid' | 'high';

export interface StationState {
    id: StationId;
    enabled: boolean;
    trackId: string | null;
    playing: boolean;
    /** True once the scheduled start time has been reached. */
    sounding: boolean;
    positionSec: number;
    rate: number;
    volume: number;
    eq: Record<EqBand, number>;
    filter: number;
    cueSec: number;
    /** Temporary pitch-bend multiplier (+0.04 = 4% faster) on top of `rate`. `rate` itself stays the tempo-fader value the scorer reads. */
    bend: number;
    quantize: boolean;
    /** The stored loop (null = none) and whether it is currently running. */
    loop: { start: number; end: number; active: boolean } | null;
    /** Loop-in point set but no loop-out yet. */
    loopIn: number | null;
    /** Hot cues A-H: position in seconds, or null when empty. */
    hotCues: Array<number | null>;
    /** True while CUE or a hot-cue pad is held on a paused deck (playing to audition, will return on release). */
    previewing: boolean;
}

export const HOT_CUES = 8;
export interface LoopSpan { start: number; end: number }
/** Saved per-track cue data. Keyed by GameTrack.id. */
export interface CueData { cue: number | null; hot: Array<number | null> }
export interface CueStore { load(trackId: string): CueData | null; save(trackId: string, data: CueData): void }

export type StationEvent =
    | { type: 'load'; trackId: string }
    | { type: 'play'; at: number }
    | { type: 'pause' }
    | { type: 'seek'; to: number }
    | { type: 'rate'; rate: number }
    | { type: 'volume'; value: number }
    | { type: 'eq'; band: EqBand; value: number }
    | { type: 'filter'; value: number }
    | { type: 'bend'; value: number }
    | { type: 'cue'; sec: number }
    | { type: 'hotcue'; index: number; sec: number | null }
    | { type: 'loop'; loop: { start: number; end: number; active: boolean } | null }
    | { type: 'quantize'; on: boolean };

/** Everything a person (UI, MIDI, keyboard) or the AI may do to one station. */
export interface StationControl {
    readonly id: StationId;
    state(): StationState;
    load(track: GameTrack): boolean;
    play(at?: number): boolean;
    pause(): boolean;
    cue(): boolean;
    seek(sec: number): boolean;
    setRate(rate: number): boolean;
    setVolume(v: number): boolean;
    setEq(band: EqBand, v: number): boolean;
    setFilter(v: number): boolean;
}

export interface TimeSource { now(): number }
export const clamp = (x: number, a: number, b: number) => Math.min(b, Math.max(a, x));
