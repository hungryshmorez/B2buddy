import { clamp } from './types';

export type JogMode = 'cdj' | 'vinyl';
export interface JogSettings {
    /** 'cdj': the platter bends pitch while playing and nudges while paused. 'vinyl': touching the platter holds the sound and moving it scrubs; letting go resumes. */
    mode: JogMode;
    /** Multiplier on every response, 0.25 .. 3. */
    sensitivity: number;
    /** 'linear' or 'accel' (small movements are finer, fast movements ramp up). */
    curve: 'linear' | 'accel';
    /** Largest pitch bend the jog can apply (0.2 = +-20%). */
    maxBend: number;
}
export const DEFAULT_JOG: JogSettings = { mode: 'cdj', sensitivity: 1, curve: 'linear', maxBend: 0.2 };

/** The slice of a deck the jog needs. Station implements it. */
export interface JogTarget {
    state(): { playing: boolean; positionSec: number };
    setBend(b: number): boolean;
    nudge(sec: number): boolean;
    scrubHold(): boolean;
    scrubRelease(): boolean;
}

/** A 33 1/3 rpm platter: turns per second of the reference rotation, and how much audio one full turn is worth when scrubbing. */
export const NOMINAL_TURNS_PER_SEC = 100 / 3 / 60;
export const SEC_PER_TURN = 1.8;
/** Pitch bend produced when the platter is moved at the reference speed (before sensitivity), as a fraction. */
export const BEND_AT_NOMINAL = 0.1;
export const SEARCH_SEC_PER_TURN = 20;
/** If no movement arrives for this long the bend returns to neutral. */
export const JOG_IDLE_SEC = 0.12;

/**
 * Turns platter movement (signed turns, + = clockwise) into deck actions. It is pure logic: the mouse/touch wheel and MIDI jog both call move(); a frame loop calls tick()
 * so a platter that stops moving, a lost pointer or a vanished device always ends in a neutral deck.
 *
 * Honest limits: the audio engine cannot play a held buffer backwards or resample it live, so there is no audible scratch. Playing = pitch bend; touched in vinyl mode = the
 * sound is held and the position scrubs silently; paused = fine position nudge.
 */
export class JogController {
    settings: JogSettings;
    private vel = 0;                 // smoothed turns per second
    private last = Number.NEGATIVE_INFINITY;
    private touching = false;
    private bendActive = false;
    searching = false;               // coarse search (shift-jog)

    constructor(private readonly target: JogTarget, settings: Partial<JogSettings> = {}) {
        this.settings = { ...DEFAULT_JOG, ...settings }; this.normalise();
    }
    configure(s: Partial<JogSettings>) { this.settings = { ...this.settings, ...s }; this.normalise(); }
    private normalise() { this.settings.sensitivity = clamp(this.settings.sensitivity, 0.25, 3); this.settings.maxBend = clamp(this.settings.maxBend, 0.02, 0.5); }

    get isTouching() { return this.touching; }

    /** The top of the platter was touched. Only vinyl mode reacts: it holds the sound. */
    touch(): void {
        if (this.touching) return;
        this.touching = true;
        if (this.settings.mode === 'vinyl') this.target.scrubHold();
    }

    /** Let go of the platter (or the pointer was cancelled, focus was lost, a device disconnected): everything back to neutral. */
    release(): void {
        const was = this.touching; this.touching = false;
        this.vel = 0; this.last = Number.NEGATIVE_INFINITY;
        if (this.bendActive) { this.target.setBend(0); this.bendActive = false; }
        if (was) this.target.scrubRelease();
    }

    private shape(x: number) { return this.settings.curve === 'accel' ? Math.sign(x) * Math.pow(Math.abs(x), 1.4) : x; }

    /** `turns` of platter movement since the last call, `nowSec` a monotonic clock (seconds). */
    move(turns: number, nowSec: number): void {
        if (!Number.isFinite(turns) || !Number.isFinite(nowSec) || turns === 0) return;
        const dt = Number.isFinite(this.last) ? clamp(nowSec - this.last, 0.001, 0.25) : 0.016;
        this.last = nowSec;
        this.vel = this.vel * 0.6 + (turns / dt) * 0.4;
        const k = this.settings.sensitivity;
        const st = this.target.state();
        if (this.searching) { this.target.nudge(turns * SEARCH_SEC_PER_TURN * k); return; }
        if (this.settings.mode === 'vinyl' && this.touching) { this.target.nudge(this.shape(turns) * SEC_PER_TURN * k); return; }
        if (st.playing) {
            const b = clamp(k * this.shape(this.vel / NOMINAL_TURNS_PER_SEC) * BEND_AT_NOMINAL, -this.settings.maxBend, this.settings.maxBend);
            this.target.setBend(b); this.bendActive = b !== 0;
        } else {
            this.target.nudge(this.shape(turns) * SEC_PER_TURN * k);
        }
    }

    /** Call every frame: a platter that stopped moving releases its bend. */
    tick(nowSec: number): void {
        if (this.bendActive && nowSec - this.last > JOG_IDLE_SEC) { this.target.setBend(0); this.bendActive = false; this.vel = 0; }
    }
}
