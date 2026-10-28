import { MasterClock } from '../core/clock';
import type { Pov } from './cameras';
export type { Pov };

export type Fx = 'none' | 'crt' | 'vhs' | 'rgb';
export type Beams = 'sweep' | 'fan' | 'strobe';
export type Palette = { id: string; name: string; a: string; b: string; crowd: string };
export type Group = 'palette' | 'fx' | 'motion' | 'camera';
export const GROUPS: readonly Group[] = ['palette', 'fx', 'motion', 'camera'];

export const PALETTES: readonly Palette[] = [
    { id: 'neon', name: 'Neon', a: '51,235,255', b: '255,77,219', crowd: '190,170,255' },
    { id: 'acid', name: 'Acid', a: '170,255,60', b: '255,200,40', crowd: '210,255,160' },
    { id: 'ember', name: 'Ember', a: '255,120,40', b: '255,50,90', crowd: '255,190,170' },
    { id: 'ice', name: 'Ice', a: '140,200,255', b: '200,160,255', crowd: '220,230,255' },
];
/** A motion style = beam pattern + how hard the crowd answers the music. */
export interface Motion { beams: Beams; crowd: number; speed: number }
export const MOTIONS: readonly Motion[] = [{ beams: 'sweep', crowd: 0.35, speed: 1 }, { beams: 'fan', crowd: 0.5, speed: 0.6 }, { beams: 'strobe', crowd: 0.7, speed: 1.6 }];
export const FX_LIST: readonly Fx[] = ['none', 'crt', 'vhs', 'rgb'];
export const POV_LIST: readonly Pov[] = ['crowd', 'dj1', 'dj2', 'dj1top', 'dj2top'];

export interface Look { palette: number; fx: Fx; motion: number; camera: Pov }

/** Curated combinations only: each rule removes pairings that look bad (a strobe over RGB-split smears into noise; the overhead views hide the crowd response). */
export function compatible(l: Look): boolean {
    if (MOTIONS[l.motion].beams === 'strobe' && l.fx === 'rgb') return false;
    if ((l.camera === 'dj1top' || l.camera === 'dj2top') && MOTIONS[l.motion].beams === 'fan') return false;
    if (l.fx === 'vhs' && PALETTES[l.palette].id === 'acid') return false;
    return true;
}

export const DEFAULT_LOOK: Look = { palette: 0, fx: 'crt', motion: 0, camera: 'crowd' };

/** Every curated look that keeps the locked groups of `current`. */
export function candidates(current: Look, locked: ReadonlySet<Group>): Look[] {
    const out: Look[] = [];
    for (let p = 0; p < PALETTES.length; p++) for (const fx of FX_LIST) for (let m = 0; m < MOTIONS.length; m++) for (const camera of POV_LIST) {
        const l: Look = { palette: p, fx, motion: m, camera };
        if (locked.has('palette') && p !== current.palette) continue; if (locked.has('fx') && fx !== current.fx) continue;
        if (locked.has('motion') && m !== current.motion) continue; if (locked.has('camera') && camera !== current.camera) continue;
        if (compatible(l)) out.push(l);
    }
    return out;
}

/** SHUFFLE: a different curated look that keeps every locked group. If locks leave no other option the current look stays and the reason is returned. */
export function shuffle(current: Look, locked: ReadonlySet<Group>, rnd: () => number): { look: Look; note: string | null } {
    const c = candidates(current, locked).filter(l => l.palette !== current.palette || l.fx !== current.fx || l.motion !== current.motion || l.camera !== current.camera);
    if (!c.length) return { look: current, note: 'The locked choices leave no other curated look: unlock something to shuffle.' };
    return { look: c[Math.floor(rnd() * c.length) % c.length], note: null };
}

/** HIT IT: now, or at the next beat of the shared clock when quantized. Returns the audio-clock time of the hit. */
export function hitTime(now: number, clock: MasterClock | null, quantize: boolean): number {
    if (!quantize || !clock) return now;
    const b = clock.beatAt(now); const next = Math.ceil(b - 1e-9);
    return clock.timeOfBeat(next);
}
/** Flash intensity 0..1 for a hit at `at`, evaluated at `now`: instant attack, 350 ms decay. */
export function flashAt(now: number, at: number | null): number { if (at === null || now < at) return 0; const d = now - at; return d > 0.35 ? 0 : 1 - d / 0.35; }
