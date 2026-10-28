/** Frame-time meter for real-device testing: measures, never estimates. */
export interface PerfSummary { frames: number; fps: number; avgMs: number; p95Ms: number; worstMs: number; longFrames: number }

export function summarize(deltasMs: readonly number[], longMs = 50): PerfSummary {
    const n = deltasMs.length;
    if (!n) return { frames: 0, fps: 0, avgMs: 0, p95Ms: 0, worstMs: 0, longFrames: 0 };
    const sorted = [...deltasMs].sort((a, b) => a - b);
    const avg = deltasMs.reduce((s, d) => s + d, 0) / n;
    return { frames: n, fps: avg > 0 ? 1000 / avg : 0, avgMs: avg, p95Ms: sorted[Math.min(n - 1, Math.floor(n * 0.95))], worstMs: sorted[n - 1], longFrames: deltasMs.filter(d => d > longMs).length };
}

export class PerfMeter {
    private last = 0; private ring: number[] = []; private readonly size: number;
    constructor(size = 300) { this.size = size; }
    /** Call once per animation frame with the rAF timestamp. */
    tick(t: number): void { if (this.last) { this.ring.push(t - this.last); if (this.ring.length > this.size) this.ring.shift(); } this.last = t; }
    reset(): void { this.ring = []; this.last = 0; }
    summary(): PerfSummary { return summarize(this.ring); }
}

/** Rate of a monotonically increasing counter (e.g. BENDR's frame number) between two samples. */
export function ratePerSec(prev: { n: number; at: number } | null, n: number, at: number): number {
    if (!prev || at <= prev.at || n < prev.n) return 0;
    return (n - prev.n) / ((at - prev.at) / 1000);
}

/** The WebGL renderer string, so a report says whether this was a real GPU or software rendering. */
export function glRenderer(): string {
    try {
        const c = document.createElement('canvas'); const gl = (c.getContext('webgl2') || c.getContext('webgl')) as WebGLRenderingContext | null;
        if (!gl) return 'no WebGL';
        const ext = gl.getExtension('WEBGL_debug_renderer_info');
        return ext ? String(gl.getParameter(ext.UNMASKED_RENDERER_WEBGL)) : 'renderer hidden by the browser';
    } catch { return 'unknown'; }
}

export interface PerfReportInput { gameFps: PerfSummary; bendrFps: number | null; engine: string; effect: string; audioBaseMs: number | null; audioOutMs: number | null; renderer: string; userAgent: string; build: string }

export function formatReport(r: PerfReportInput): string {
    const f = (x: number, d = 1) => x.toFixed(d);
    return [
        `B2Buddy performance report (${r.build})`,
        `video engine: ${r.engine}${r.effect ? ` · effect: ${r.effect}` : ''}`,
        `game canvas: ${f(r.gameFps.fps)} fps over ${r.gameFps.frames} frames · avg ${f(r.gameFps.avgMs)} ms · p95 ${f(r.gameFps.p95Ms)} ms · worst ${f(r.gameFps.worstMs)} ms · ${r.gameFps.longFrames} frames over 50 ms`,
        `BENDR output: ${r.bendrFps === null ? 'not running' : f(r.bendrFps) + ' fps'}`,
        `audio latency: base ${r.audioBaseMs === null ? 'n/a' : f(r.audioBaseMs, 0) + ' ms'} · output ${r.audioOutMs === null ? 'n/a' : f(r.audioOutMs, 0) + ' ms'}`,
        `graphics: ${r.renderer}`,
        `browser: ${r.userAgent}`,
    ].join('\n');
}
