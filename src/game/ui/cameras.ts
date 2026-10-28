export type Pov = 'dj1' | 'dj2' | 'dj1top' | 'dj2top' | 'crowd';
export type V3 = [number, number, number];
export interface Cam { pos: V3; target: V3; fov: number }

/** Stage layout shared by the renderer and the camera tests. DJ 1 stands left, DJ 2 right; each has a deck table beside them. */
export const DJ_X: readonly [number, number] = [-2.4, 2.4];
export const DECK_X: readonly [number, number] = [-1.4, 1.4];
export const DJ_HEAD_Y = 1.75;

export const POVS: ReadonlyArray<{ id: Pov; label: string }> = [
    { id: 'dj1', label: 'DJ 1 POV' }, { id: 'dj2', label: 'DJ 2 POV' }, { id: 'dj1top', label: 'DJ 1 Overhead' }, { id: 'dj2top', label: 'DJ 2 Overhead' }, { id: 'crowd', label: 'Crowd Camera' },
];

/** The audience: a fixed field of spectators in front of the stage (+z). Decoration only; see the credits. */
export function crowdPoints(): V3[] {
    const out: V3[] = [];
    for (let i = 0; i < 70; i++) out.push([((i * 37) % 17 - 8) * 0.75, 0, 3 + ((i * 53) % 7) * 0.8]);
    return out;
}
export const CROWD_Z_MIN = 3;
export const CROWD_Z_MAX = 3 + 6 * 0.8;

export const CAMS: Record<Pov, Cam> = {
    // from each DJ's own station, across the stage at the rival and out toward the room
    dj1: { pos: [DJ_X[0] - 0.6, 1.95, -0.3], target: [1.5, 1.3, 1.8], fov: 1.2 },
    dj2: { pos: [DJ_X[1] + 0.6, 1.95, -0.3], target: [-1.5, 1.3, 1.8], fov: 1.2 },
    // straight down onto each DJ's deck table and DJ
    dj1top: { pos: [-1.9, 4, 0.01], target: [-1.9, 0, 0], fov: 0.8 },
    dj2top: { pos: [1.9, 4, 0.01], target: [1.9, 0, 0], fov: 0.8 },
    // inside the audience (between the first and last rows), facing the stage so both DJs are in view
    crowd: { pos: [0, 1.7, 6], target: [0, 1.3, 0], fov: 1.0 },
};

export function project(p: V3, cam: Cam, w: number, h: number): [number, number, number] | null {
    const f: V3 = [cam.target[0] - cam.pos[0], cam.target[1] - cam.pos[1], cam.target[2] - cam.pos[2]]; const fl = Math.hypot(...f); const fw: V3 = [f[0] / fl, f[1] / fl, f[2] / fl];
    let up: V3 = [0, 1, 0]; if (Math.abs(fw[1]) > 0.98) up = [0, 0, -1];
    const r: V3 = [fw[1] * up[2] - fw[2] * up[1], fw[2] * up[0] - fw[0] * up[2], fw[0] * up[1] - fw[1] * up[0]]; const rl = Math.hypot(...r); const rr: V3 = [r[0] / rl, r[1] / rl, r[2] / rl];
    const u: V3 = [rr[1] * fw[2] - rr[2] * fw[1], rr[2] * fw[0] - rr[0] * fw[2], rr[0] * fw[1] - rr[1] * fw[0]];
    const d: V3 = [p[0] - cam.pos[0], p[1] - cam.pos[1], p[2] - cam.pos[2]];
    const z = d[0] * fw[0] + d[1] * fw[1] + d[2] * fw[2]; if (z < 0.2) return null;
    const x = d[0] * rr[0] + d[1] * rr[1] + d[2] * rr[2], y = d[0] * u[0] + d[1] * u[1] + d[2] * u[2];
    const s = (h / 2) / Math.tan(cam.fov / 2);
    return [w / 2 + x / z * s, h / 2 - y / z * s, z];
}

/** True when the point lands inside the w x h frame and in front of the camera. */
export function inFrame(p: V3, cam: Cam, w = 640, h = 300): boolean {
    const q = project(p, cam, w, h); return !!q && q[0] >= 0 && q[0] <= w && q[1] >= 0 && q[1] <= h;
}

/** Unit view direction of a camera. */
export function viewDir(cam: Cam): V3 { const f: V3 = [cam.target[0] - cam.pos[0], cam.target[1] - cam.pos[1], cam.target[2] - cam.pos[2]]; const l = Math.hypot(...f); return [f[0] / l, f[1] / l, f[2] / l]; }
