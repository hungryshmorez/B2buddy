/**
 * The one shared master clock of a battle. A pure function of its anchor: nothing ticks, nothing drifts.
 * Time is in seconds of the audio context timeline (or a manual clock in tests).
 */
export class MasterClock {
    constructor(public readonly bpm: number, public readonly beatsPerBar: number, public readonly beat0Time: number) {
        if (!(bpm >= 40 && bpm <= 240)) throw new RangeError('master tempo out of range');
    }
    get beatSec() { return 60 / this.bpm; }
    beatAt(t: number) { return (t - this.beat0Time) / this.beatSec; }
    timeOfBeat(b: number) { return this.beat0Time + b * this.beatSec; }
    /** 1-based beat inside the bar for display; counts down through the count-in. */
    beatInBar(t: number) { const b = Math.floor(this.beatAt(t)); return ((b % this.beatsPerBar) + this.beatsPerBar) % this.beatsPerBar + 1; }
    barAt(t: number) { return Math.floor(this.beatAt(t) / this.beatsPerBar) + 1; }
}

/** Signed distance between two phases in beats, in [-0.5, 0.5). */
export function phaseDiff(a: number, b: number): number {
    const d = (a - Math.floor(a)) - (b - Math.floor(b));
    return d >= 0.5 ? d - 1 : d < -0.5 ? d + 1 : d;
}
