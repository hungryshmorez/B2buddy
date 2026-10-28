import { FRACTAL_FRAGMENT, FRACTAL_VERTEX, LIQUID_FRAGMENT, LIQUID_VERTEX } from './trippyShaders';

/**
 * The Random Effect / ON-OFF system for the camera feed. Every entry maps to code or CSS in the supplied "trippy_effects_for_trippy_me" package.
 * Effects change the PICTURE only: they read the camera canvas and draw on an overlay, and never touch audio, the battle or the camera selection.
 */
export type TrippyId = 'liquid' | 'fractal' | 'datamosh' | 'crt' | 'vhs';
export type TrippyKind = 'webgl' | 'pixel' | 'css';
export interface TrippyEffect { id: TrippyId; name: string; kind: TrippyKind; source: string }

export const TRIPPY_EFFECTS: readonly TrippyEffect[] = [
    { id: 'liquid', name: 'Liquid Distortion', kind: 'webgl', source: 'webgl-shaders.js · shaders.liquidDistortion (GLSL verbatim)' },
    { id: 'fractal', name: 'Fractal Noise', kind: 'webgl', source: 'webgl-shaders.js · shaders.fractalNoise (GLSL verbatim)' },
    { id: 'datamosh', name: 'Datamosh', kind: 'pixel', source: 'datamosh-effects.js · applyHorizontalSlices / applyRGBSplit / applyBlockMovement / applyNoise (ported)' },
    { id: 'crt', name: 'CRT Screen', kind: 'css', source: 'effects.css · .crt-effect scanlines + flicker (ported)' },
    { id: 'vhs', name: 'VHS Tracking', kind: 'css', source: 'effects.css · .vhs-tracking band + tracking keyframes (ported)' },
];
export const effectById = (id: TrippyId | null) => TRIPPY_EFFECTS.find(e => e.id === id) ?? null;

/** The selection a person made: which effect, and whether it is showing. OFF keeps the selection. */
export interface FxState { id: TrippyId | null; on: boolean }
export const FX_IDLE: FxState = { id: null, on: false };

/** Effects that can run here. WebGL ones drop out when the browser cannot compile them; the rest need nothing special. */
export function eligibleEffects(webgl: boolean): readonly TrippyEffect[] { return TRIPPY_EFFECTS.filter(e => e.kind !== 'webgl' || webgl); }

/** RANDOM EFFECT: a random eligible effect, never the one already selected when another exists; always ON. Returns null when nothing is eligible. */
export function randomEffect(state: FxState, eligible: readonly TrippyEffect[], rnd: () => number): FxState | null {
    if (!eligible.length) return null;
    const pool = eligible.length > 1 ? eligible.filter(e => e.id !== state.id) : eligible;
    return { id: pool[Math.min(pool.length - 1, Math.floor(rnd() * pool.length))].id, on: true };
}
/** ON/OFF: flips visibility and keeps the selected effect. With nothing selected, turning ON picks a random one. */
export function toggleEffect(state: FxState, eligible: readonly TrippyEffect[], rnd: () => number): FxState | null {
    if (state.id === null) return state.on ? { id: null, on: false } : randomEffect(state, eligible, rnd);
    return { id: state.id, on: !state.on };
}

// ------------------------------------------------------------------------------------------------ datamosh (ported from datamosh-effects.js)
export interface PixelBuf { width: number; height: number; data: Uint8ClampedArray }
const DM = { sliceMin: 1, sliceMax: 20, offsetMax: 20, rgbSplitProb: 0.3, blockMoveProb: 0.4, noiseProb: 0.3, heavyGlitchProb: 0.1 };
const range = (a: number, b: number, rnd: () => number) => a + (b - a) * rnd();

export function dmSlices(img: PixelBuf, intensity: number, rnd: () => number) {
    const { width, height, data } = img; const n = Math.floor(range(DM.sliceMin, DM.sliceMax * intensity, rnd));
    for (let i = 0; i < n; i++) {
        const sy = Math.floor(rnd() * height), sh = Math.floor(rnd() * 10) + 1, xo = Math.floor(range(-DM.offsetMax * intensity, DM.offsetMax * intensity, rnd));
        for (let y = sy; y < Math.min(sy + sh, height); y++) for (let x = 0; x < width; x++) {
            const sx = (((x - xo) % width) + width) % width; const t = (y * width + x) * 4, s = (y * width + sx) * 4; data[t] = data[s]; data[t + 1] = data[s + 1]; data[t + 2] = data[s + 2];
        }
    }
}
export function dmRgbSplit(img: PixelBuf, intensity: number, rnd: () => number) {
    const { width, height, data } = img; const out = new Uint8ClampedArray(data); const off = () => Math.floor(intensity * DM.offsetMax * (rnd() - 0.5)); const ro = off(), go = off(), bo = off();
    const cl = (x: number) => Math.max(0, Math.min(width - 1, x));
    for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
        const o = (y * width + x) * 4; out[o] = data[(y * width + cl(x + ro)) * 4]; out[o + 1] = data[(y * width + cl(x + go)) * 4 + 1]; out[o + 2] = data[(y * width + cl(x + bo)) * 4 + 2];
    }
    data.set(out);
}
export function dmBlocks(img: PixelBuf, intensity: number, rnd: () => number) {
    const { width, height, data } = img; const out = new Uint8ClampedArray(data); const n = Math.floor(intensity * 5) + 1;
    for (let i = 0; i < n; i++) {
        const bw = Math.floor(rnd() * width * 0.3) + 10, bh = Math.floor(rnd() * height * 0.3) + 10; const sx = Math.floor(rnd() * Math.max(1, width - bw)), sy = Math.floor(rnd() * Math.max(1, height - bh));
        const dx = Math.floor(sx + (rnd() - 0.5) * width * 0.2), dy = Math.floor(sy + (rnd() - 0.5) * height * 0.2);
        for (let y = 0; y < bh; y++) for (let x = 0; x < bw; x++) {
            const tx = dx + x, ty = dy + y; if (tx < 0 || tx >= width || ty < 0 || ty >= height || sx + x >= width || sy + y >= height) continue;
            const s = ((sy + y) * width + (sx + x)) * 4, d = (ty * width + tx) * 4; out[d] = data[s]; out[d + 1] = data[s + 1]; out[d + 2] = data[s + 2]; out[d + 3] = data[s + 3];
        }
    }
    data.set(out);
}
export function dmNoise(img: PixelBuf, intensity: number, rnd: () => number) {
    const { data } = img; const amt = intensity * 50;
    for (let i = 0; i < data.length; i += 4) if (rnd() < intensity * 0.1) { data[i] += (rnd() - 0.5) * amt; data[i + 1] += (rnd() - 0.5) * amt; data[i + 2] += (rnd() - 0.5) * amt; }
}
/** One datamosh frame, same recipe and probabilities as DatamoshEffect.applyGlitchEffect (minus pixel sorting and compression artifacts, not ported). */
export function datamoshFrame(img: PixelBuf, base: number, rnd: () => number) {
    const intensity = rnd() < DM.heavyGlitchProb ? base * 2 : base;
    if (rnd() < 0.8) dmSlices(img, intensity, rnd); if (rnd() < DM.rgbSplitProb) dmRgbSplit(img, intensity, rnd);
    if (rnd() < DM.blockMoveProb) dmBlocks(img, intensity, rnd); if (rnd() < DM.noiseProb) dmNoise(img, intensity, rnd);
}

// ------------------------------------------------------------------------------------------------ WebGL pass (shader text from the package)
const QUAD = new Float32Array([-1, -1, 0, 0, 1, -1, 1, 0, -1, 1, 0, 1, 1, 1, 1, 1]);

/** Runs one of the package's fragment shaders over a source canvas. Throws if the shader does not compile or link: the caller then drops the effect from the eligible list. */
export class GlPass {
    private gl: WebGLRenderingContext; private prog: WebGLProgram; private tex: WebGLTexture; private buf: WebGLBuffer;
    private u: { tex: WebGLUniformLocation | null; time: WebGLUniformLocation | null; res: WebGLUniformLocation | null };
    constructor(readonly canvas: HTMLCanvasElement, vertex: string, fragment: string) {
        const gl = canvas.getContext('webgl', { preserveDrawingBuffer: true, premultipliedAlpha: false }); if (!gl) throw new Error('WebGL unavailable');
        this.gl = gl; const sh = (type: number, src: string) => { const s = gl.createShader(type)!; gl.shaderSource(s, src); gl.compileShader(s); if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error('shader: ' + gl.getShaderInfoLog(s)); return s; };
        this.prog = gl.createProgram()!; gl.attachShader(this.prog, sh(gl.VERTEX_SHADER, vertex)); gl.attachShader(this.prog, sh(gl.FRAGMENT_SHADER, fragment)); gl.linkProgram(this.prog);
        if (!gl.getProgramParameter(this.prog, gl.LINK_STATUS)) throw new Error('link: ' + gl.getProgramInfoLog(this.prog));
        this.buf = gl.createBuffer()!; gl.bindBuffer(gl.ARRAY_BUFFER, this.buf); gl.bufferData(gl.ARRAY_BUFFER, QUAD, gl.STATIC_DRAW);
        this.tex = gl.createTexture()!; gl.bindTexture(gl.TEXTURE_2D, this.tex);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
        this.u = { tex: gl.getUniformLocation(this.prog, 'uTexture'), time: gl.getUniformLocation(this.prog, 'uTime'), res: gl.getUniformLocation(this.prog, 'uResolution') };
    }
    draw(src: HTMLCanvasElement, timeSec: number) {
        const gl = this.gl; gl.viewport(0, 0, this.canvas.width, this.canvas.height); gl.useProgram(this.prog);
        gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, 1); gl.bindTexture(gl.TEXTURE_2D, this.tex); gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, src);
        gl.bindBuffer(gl.ARRAY_BUFFER, this.buf); const ap = gl.getAttribLocation(this.prog, 'aPosition'), at = gl.getAttribLocation(this.prog, 'aTexCoord');
        gl.enableVertexAttribArray(ap); gl.vertexAttribPointer(ap, 2, gl.FLOAT, false, 16, 0); gl.enableVertexAttribArray(at); gl.vertexAttribPointer(at, 2, gl.FLOAT, false, 16, 8);
        gl.uniform1i(this.u.tex, 0); gl.uniform1f(this.u.time, timeSec); gl.uniform2f(this.u.res, this.canvas.width, this.canvas.height); gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    }
    dispose() { this.gl.getExtension('WEBGL_lose_context')?.loseContext(); }
}
export const SHADERS: Record<'liquid' | 'fractal', { vertex: string; fragment: string }> = {
    liquid: { vertex: LIQUID_VERTEX, fragment: LIQUID_FRAGMENT }, fractal: { vertex: FRACTAL_VERTEX, fragment: FRACTAL_FRAGMENT },
};

/** Can this browser compile BOTH package shaders? Probed once on a throwaway canvas. */
export function probeWebGl(doc: Document = document): boolean {
    try { for (const k of ['liquid', 'fractal'] as const) { const p = new GlPass(doc.createElement('canvas'), SHADERS[k].vertex, SHADERS[k].fragment); p.dispose(); } return true; } catch { return false; }
}
