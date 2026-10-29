/** Track waveform data: min/max peaks at a fixed number of bins per second, computed from the decoded audio (never faked or randomised). */
export interface WaveData { binsPerSec: number; min: Float32Array; max: Float32Array; durationSec: number }

export const WAVE_BINS_PER_SEC = 100;

/** Reduce mono samples to min/max peaks. An empty or silent input gives a flat (all zero) wave of the right length, not an error. */
export function computeWave(data: ArrayLike<number>, sampleRate: number, binsPerSec = WAVE_BINS_PER_SEC): WaveData {
    const durationSec = sampleRate > 0 ? data.length / sampleRate : 0;
    const bins = Math.max(1, Math.ceil(durationSec * binsPerSec));
    const min = new Float32Array(bins), max = new Float32Array(bins);
    if (!(sampleRate > 0) || !data.length) return { binsPerSec, min, max, durationSec };
    const per = sampleRate / binsPerSec;
    for (let b = 0; b < bins; b++) {
        const a = Math.floor(b * per), z = Math.min(data.length, Math.floor((b + 1) * per));
        let lo = 0, hi = 0;
        for (let i = a; i < z; i++) { const v = data[i]; if (v < lo) lo = v; else if (v > hi) hi = v; }
        min[b] = lo; max[b] = hi;
    }
    return { binsPerSec, min, max, durationSec };
}

/** Peaks for `columns` equal slices of [startSec, endSec). Slices outside the track are null (drawn as empty), never clamped into fake data. */
export function windowPeaks(w: WaveData, startSec: number, endSec: number, columns: number): Array<{ lo: number; hi: number } | null> {
    const out: Array<{ lo: number; hi: number } | null> = [];
    const span = (endSec - startSec) / columns;
    for (let c = 0; c < columns; c++) {
        const t0 = startSec + c * span, t1 = t0 + span;
        if (t1 <= 0 || t0 >= w.durationSec) { out.push(null); continue; }
        const a = Math.max(0, Math.floor(t0 * w.binsPerSec)), z = Math.min(w.min.length, Math.max(a + 1, Math.ceil(t1 * w.binsPerSec)));
        let lo = 0, hi = 0;
        for (let i = a; i < z; i++) { if (w.min[i] < lo) lo = w.min[i]; if (w.max[i] > hi) hi = w.max[i]; }
        out.push({ lo, hi });
    }
    return out;
}

/** Beat times (seconds) inside [startSec, endSec] for a known grid, with the bar number of each beat start (beat 1 of a bar = downbeat). Empty when the BPM is unknown. */
export function beatsInWindow(bpm: number | null, firstBeatSec: number, startSec: number, endSec: number, beatsPerBar = 4): Array<{ t: number; downbeat: boolean }> {
    if (!bpm || !(bpm > 0) || !(endSec > startSec)) return [];
    const bl = 60 / bpm; const first = Math.ceil((startSec - firstBeatSec) / bl); const out: Array<{ t: number; downbeat: boolean }> = [];
    for (let n = first; firstBeatSec + n * bl <= endSec && out.length < 4000; n++) out.push({ t: firstBeatSec + n * bl, downbeat: ((n % beatsPerBar) + beatsPerBar) % beatsPerBar === 0 });
    return out;
}
