/** Rough tempo estimate from audio. Always labelled 'estimated': it can be wrong (half/double time, free-time music) and is never shown as verified. */
export interface BpmEstimate { bpm: number; confidence: number; firstBeatSec: number }

export function estimateBpm(mono: Float32Array, sampleRate: number, min = 70, max = 180): BpmEstimate | null {
    const hop = Math.round(sampleRate / 200);                  // 200 envelope frames per second
    const n = Math.floor(mono.length / hop); if (n < 200 * 8) return null;
    const env = new Float32Array(n);
    for (let i = 0; i < n; i++) { let s = 0; for (let j = 0; j < hop; j++) { const v = mono[i * hop + j]; s += v * v; } env[i] = Math.sqrt(s / hop); }
    const flux = new Float32Array(n); let mean = 0;
    for (let i = 1; i < n; i++) { flux[i] = Math.max(0, env[i] - env[i - 1]); mean += flux[i]; }
    mean /= n; for (let i = 0; i < n; i++) flux[i] = Math.max(0, flux[i] - mean);
    const fps = 200; let best = 0, bestLag = 0; const scores: number[] = [];
    const lo = Math.floor(fps * 60 / max), hi = Math.ceil(fps * 60 / min);
    for (let lag = lo; lag <= hi; lag++) { let s = 0; for (let i = lag; i < n; i++) s += flux[i] * flux[i - lag]; scores[lag] = s; if (s > best) { best = s; bestLag = lag; } }
    if (best <= 0) return null;
    // parabolic refinement
    const a = scores[bestLag - 1] ?? best, c = scores[bestLag + 1] ?? best; const den = a - 2 * best + c; const shift = den !== 0 ? 0.5 * (a - c) / den : 0;
    const lagF = bestLag + shift; const bpm = 60 * fps / lagF;
    let tot = 0, cnt = 0; for (let l = lo; l <= hi; l++) { tot += scores[l] ?? 0; cnt++; }
    const confidence = Math.min(1, (best / (tot / cnt)) / 8);
    // first beat: the onset phase that carries the most flux at the estimated period
    const period = lagF; let bestPhase = 0, bestSum = -1;
    for (let p = 0; p < period; p += 1) { let s = 0; for (let t = p; t < n; t += period) s += flux[Math.round(t)] ?? 0; if (s > bestSum) { bestSum = s; bestPhase = p; } }
    return { bpm: Math.round(bpm * 100) / 100, confidence, firstBeatSec: bestPhase / fps };
}
