/** Playback rate that makes a track of `trackBpm` run at `masterBpm` (or at double/half time when that is closer to normal speed). Null when out of the +-20% range. */
export function bestRate(trackBpm: number, masterBpm: number): { rate: number; multiple: 1 | 2 | 0.5 } | null {
    let best: { rate: number; multiple: 1 | 2 | 0.5 } | null = null;
    for (const m of [1, 2, 0.5] as const) {
        const r = masterBpm * m / trackBpm;
        if (r >= 0.8 && r <= 1.2 && (!best || Math.abs(r - 1) < Math.abs(best.rate - 1))) best = { rate: r, multiple: m };
    }
    return best;
}
