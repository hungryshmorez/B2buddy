import { DemoSpec, loopSeconds } from './catalog';

function rng(seed: number) { let a = seed >>> 0; return () => { a = (a + 0x6D2B79F5) >>> 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = (t + Math.imul(t ^ t >>> 7, 61 | t)) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }

/**
 * Original, copyright-free demo audio generated from a spec: kick on every beat, off-beat hats, backbeat clap, a bass line and a pad. One seamless phrase
 * (bars x 4 beats); beat 1 is at t = 0, so the beat grid is exact by construction (metadata origin 'declared').
 */
export function synthPhrase(spec: DemoSpec, sampleRate: number): Float32Array {
    const beat = 60 / spec.bpm; const n = Math.ceil(loopSeconds(spec) * sampleRate); const out = new Float32Array(n); const r = rng(spec.seed);
    const add = (i: number, v: number) => { out[((i % n) + n) % n] += v; };           // wrap so tails cross the loop seam cleanly
    const beats = spec.bars * 4;
    for (let b = 0; b < beats; b++) {
        const t0 = Math.round(b * beat * sampleRate);
        // kick
        const kl = Math.floor(0.3 * sampleRate); let ph = 0;
        for (let i = 0; i < kl; i++) { const t = i / sampleRate; const f = 45 + 95 * Math.exp(-t * 28); ph += 2 * Math.PI * f / sampleRate; add(t0 + i, Math.sin(ph) * Math.exp(-t * 11) * 0.9); }
        // hat on the off-beat (and a ghost hat in 'break')
        const hats = spec.style === 'break' ? [0.5, 0.75] : [0.5];
        for (const h of hats) { const hs = Math.round((b + h) * beat * sampleRate); let prev = 0; for (let i = 0; i < Math.floor(0.05 * sampleRate); i++) { const x = r() * 2 - 1; const hp = x - prev; prev = x; add(hs + i, hp * Math.exp(-i / (0.012 * sampleRate)) * (h === 0.5 ? 0.22 : 0.1)); } }
        // clap on beats 2 and 4
        if (b % 2 === 1) for (let i = 0; i < Math.floor(0.14 * sampleRate); i++) { const x = r() * 2 - 1; add(t0 + i, x * Math.exp(-i / (0.03 * sampleRate)) * 0.3); }
        // bass: root on the off-beat 8th (drive), long notes (deep), syncopated (break)
        const pat = spec.style === 'drive' ? [0.5, 0.75] : spec.style === 'deep' ? [0] : [0.25, 0.75];
        const fifth = (Math.floor(b / 4) % 4 === 2) ? 1.4983 : 1;
        for (const p of pat) { const bs = Math.round((b + p) * beat * sampleRate); const len = Math.floor((spec.style === 'deep' ? 0.9 : 0.2) * beat * sampleRate); const f = spec.rootHz * fifth; let ph2 = 0;
            for (let i = 0; i < len; i++) { ph2 += 2 * Math.PI * f / sampleRate; const env = Math.min(1, i / 200) * Math.exp(-i / (len * 0.6)); add(bs + i, (Math.sin(ph2) + 0.25 * Math.sin(2 * ph2)) * env * 0.38); } }
    }
    // pad: a minor triad per two bars
    for (let c = 0; c < spec.bars / 2; c++) {
        const root = spec.rootHz * 4 * [1, 1.189, 0.891, 1.335][c % 4]; const s0 = Math.round(c * 8 * beat * sampleRate); const len = Math.floor(8 * beat * sampleRate);
        for (const m of [1, 1.189, 1.498]) { let p = 0; for (let i = 0; i < len; i += 1) { p += 2 * Math.PI * root * m / sampleRate; const env = Math.min(1, i / (0.4 * sampleRate)) * Math.min(1, (len - i) / (0.4 * sampleRate)); add(s0 + i, Math.sin(p) * env * 0.035); } }
    }
    let peak = 0; for (let i = 0; i < n; i++) peak = Math.max(peak, Math.abs(out[i]));
    const g = peak > 0 ? 0.8 / peak : 1; for (let i = 0; i < n; i++) out[i] *= g;
    return out;
}
