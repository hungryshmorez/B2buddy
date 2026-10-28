import { DEFAULT_WEIGHTS, ObjectiveContext, ObjectiveResult, ScoreWeights } from './scoring';
import { GameTrack } from './types';

/**
 * A challenge changes the rules of a round without touching the battle engine: it may re-weight the categories, add one objective category,
 * and refuse to start when the library cannot support it (it never silently falls back to another challenge).
 */
export interface Challenge {
    id: string;
    name: string;
    description: string;
    weights: ScoreWeights;
    /** Null when playable, else a plain explanation. */
    requires(library: readonly GameTrack[], roundSec: number): string | null;
    objective?(ctx: ObjectiveContext): ObjectiveResult;
    /** For the AI: the interval at which this challenge wants a track switch, if any. */
    switchEverySec?: number;
}

export const STANDARD: Challenge = {
    id: 'standard', name: 'Standard Round', description: 'Play a clean, locked set on the shared master tempo. Change a track on a phrase for extra credit.',
    weights: DEFAULT_WEIGHTS, requires: (lib) => (lib.filter(t => t.bpm).length >= 2 ? null : 'At least two tracks with a known BPM are needed.'),
};

export const THIRTY_SECOND_SWITCH: Challenge = {
    id: 'thirty-second-switch', name: 'Thirty-Second Switch',
    description: 'Switch to a different track at least once in every 30 seconds. Each window without a switch costs you.',
    weights: { alignment: 25, tempo: 15, consistency: 10, deadAir: 10, changes: 10, control: 10, objective: 20 },
    switchEverySec: 30,
    requires(lib, roundSec) {
        if (roundSec < 60) return 'This challenge needs a round of at least 60 seconds.';
        return lib.filter(t => t.bpm).length >= 4 ? null : 'At least four tracks with a known BPM are needed so there is something to switch to.';
    },
    objective(ctx) {
        const windows = Math.max(1, Math.floor(ctx.roundSec / 30)); let ok = 0;
        for (let w = 0; w < windows; w++) {
            const from = ctx.clock.beat0Time + w * 30, to = from + 30;
            if (ctx.changeTimes.some(t => t >= from && t < to)) ok++;
        }
        return { points: 20 * ok / windows, outOf: 20, reason: `${ok} of ${windows} thirty-second windows contained a track switch` };
    },
};

/** Registered challenges. Add a new one here; the battle engine and UI list this registry. */
export const CHALLENGES: readonly Challenge[] = [STANDARD, THIRTY_SECOND_SWITCH];
export const challengeById = (id: string) => CHALLENGES.find(c => c.id === id);
