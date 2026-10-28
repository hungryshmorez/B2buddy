import { useEffect, useRef, useState } from 'react';
import { GameRuntime } from '../runtime';
import { DEFAULT_LOOK, flashAt, FX_LIST, Group, GROUPS, hitTime, Look, MOTIONS, PALETTES, Pov, shuffle } from './visuals';

export const POVS: Array<{ id: Pov; label: string }> = [{ id: 'dj1', label: 'DJ 1 (you)' }, { id: 'dj2', label: 'DJ 2 (Buddy)' }, { id: 'overhead', label: 'Overhead' }, { id: 'crowd', label: 'Crowd' }, { id: 'wide', label: 'Wide show' }];

type V3 = [number, number, number];
interface Cam { pos: V3; target: V3; fov: number }
const CAMS: Record<Pov, Cam> = {
    dj1: { pos: [-5.4, 2.2, 1.2], target: [-1.2, 0.9, 0], fov: 1.1 }, dj2: { pos: [5.4, 2.2, -1.2], target: [1.2, 0.9, 0], fov: 1.1 },
    overhead: { pos: [0, 11, 0.01], target: [0, 0, 0], fov: 1.0 }, crowd: { pos: [0, 1.3, 9], target: [0, 1.4, 0], fov: 1.0 }, wide: { pos: [0, 5, 12], target: [0, 1, 0], fov: 0.85 },
};

function project(p: V3, cam: Cam, w: number, h: number): [number, number, number] | null {
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

/**
 * The club, drawn on a canvas from five camera positions. Everything here is the "video pipeline": the CRT/VHS/RGB treatments are CSS filters on this canvas
 * only, never on the controls. The lights and crowd react to the real master level; the crowd is decoration and is labelled as such in the credits.
 */
export default function Venue({ rt }: { rt: GameRuntime }) {
    const ref = useRef<HTMLCanvasElement>(null);
    const [look, setLook] = useState<Look>(DEFAULT_LOOK); const [locked, setLocked] = useState<Set<Group>>(new Set()); const [quant, setQuant] = useState(true); const [note, setNote] = useState('');
    const lookRef = useRef(look); lookRef.current = look; const hitRef = useRef<number | null>(null);
    const pov = look.camera; const fx = look.fx; const setPov = (c: Pov) => setLook(l => ({ ...l, camera: c }));
    const doShuffle = () => { const r = shuffle(look, locked, Math.random); setLook(r.look); setNote(r.note ?? `${PALETTES[r.look.palette].name} · ${MOTIONS[r.look.motion].beams} · ${r.look.fx} · ${r.look.camera}`); };
    const doHit = () => { const clock = rt.session?.clock ?? rt.practiceClock; hitRef.current = hitTime(rt.now, clock, quant); };
    const toggleLock = (g: Group) => setLocked(s => { const n = new Set(s); if (n.has(g)) n.delete(g); else n.add(g); return n; });
    useEffect(() => {
        let raf = 0; const crowd: V3[] = []; for (let i = 0; i < 70; i++) crowd.push([((i * 37) % 17 - 8) * 0.75, 0, 3 + ((i * 53) % 7) * 0.8]);
        const draw = (t: number) => {
            const c = ref.current; if (c) {
                const g = c.getContext('2d')!; const w = c.width, h = c.height; const L = lookRef.current; const pal = PALETTES[L.palette]; const mo = MOTIONS[L.motion]; const cam = CAMS[L.camera];
                const lvl = rt.ready ? rt.masterLevel() : 0; const beat = rt.session?.clock ? rt.session.clock.beatAt(rt.now) : t / 480; const pulse = Math.pow(1 - (beat - Math.floor(beat)), 3) * (0.3 + lvl); const flash = flashAt(rt.now, hitRef.current);
                const grad = g.createLinearGradient(0, 0, 0, h); grad.addColorStop(0, '#0a0620'); grad.addColorStop(1, '#190a33'); g.fillStyle = grad; g.fillRect(0, 0, w, h);
                const line = (a: V3, b: V3, col: string, lw = 1) => { const pa = project(a, cam, w, h), pb = project(b, cam, w, h); if (!pa || !pb) return; g.strokeStyle = col; g.lineWidth = lw; g.beginPath(); g.moveTo(pa[0], pa[1]); g.lineTo(pb[0], pb[1]); g.stroke(); };
                for (let i = -12; i <= 12; i += 2) { line([i, 0, -6], [i, 0, 14], 'rgba(120,60,255,0.28)'); line([-12, 0, i + 2], [12, 0, i + 2], 'rgba(120,60,255,0.28)'); }
                const box = (cx: number, cz: number, sx: number, sz: number, hh: number, col: string) => { const c8: V3[] = []; for (const dx of [-1, 1]) for (const dz of [-1, 1]) for (const y of [0, hh]) c8.push([cx + dx * sx / 2, y, cz + dz * sz / 2]); const E = [[0, 1], [2, 3], [4, 5], [6, 7], [0, 2], [1, 3], [4, 6], [5, 7], [0, 4], [1, 5], [2, 6], [3, 7]]; for (const [a, b] of E) line(c8[a], c8[b], col, 2); };
                box(-1.4, 0, 1.6, 2.6, 1, `rgb(${pal.a})`); box(1.4, 0, 1.6, 2.6, 1, `rgb(${pal.b})`);
                // DJs (head + shoulders), mouths of the speakers, and beams that follow the beat
                const dj = (x: number, col: string) => { const hd = project([x, 1.75, 0], cam, w, h); const bd = project([x, 1.05, 0], cam, w, h); if (hd && bd) { g.fillStyle = col; g.beginPath(); g.arc(hd[0], hd[1], Math.max(3, 0.22 / hd[2] * (h / 1.2)), 0, 7); g.fill(); g.fillRect(bd[0] - 12 / hd[2] * 4, bd[1], 24 / hd[2] * 4, (hd[1] - bd[1]) * -0.9); } };
                dj(-2.4, `rgb(${pal.a})`); dj(2.4, `rgb(${pal.b})`);
                for (let k = 0; k < 6; k++) { const a = mo.beams === 'fan' ? (k - 2.5) * 1.1 : Math.sin(t / 1400 * mo.speed + k) * 3; const on = mo.beams === 'strobe' ? (Math.floor(beat * 2) % 2 ? 1 : 0.15) : 1; line([-5 + k * 2, 5.5, -4], [a + (k - 3) * 1.2, 0, 3], `rgba(${k % 2 ? pal.b : pal.a},${(0.12 + pulse * 0.5) * on})`, 3 + pulse * 8); }
                for (const p of crowd) { const q = project([p[0], 0.6 + pulse * mo.crowd * ((p[0] * 7 | 0) % 2 ? 1 : 0.5), p[2]], cam, w, h); if (q) { g.fillStyle = `rgba(${pal.crowd},0.55)`; g.beginPath(); g.arc(q[0], q[1], Math.max(2, 0.28 / q[2] * (h / 1.1)), 0, 7); g.fill(); } }
                if (flash > 0) { g.fillStyle = `rgba(255,255,255,${flash * 0.45})`; g.fillRect(0, 0, w, h); }
                g.fillStyle = 'rgba(255,255,255,0.8)'; g.font = '12px monospace'; g.fillText(`CAM ${L.camera.toUpperCase()}`, 10, 18);
            }
            raf = requestAnimationFrame(draw);
        };
        raf = requestAnimationFrame(draw); return () => cancelAnimationFrame(raf);
    }, [rt]);
    return (
        <div className="gvenue">
            <div className={`gvideo fx-${fx}`} data-look={JSON.stringify(look)}><canvas ref={ref} width={640} height={300} aria-label="club camera view" /></div>
            <div className="gcams" role="group" aria-label="camera views">
                {POVS.map(p => <button key={p.id} className={pov === p.id ? 'on' : ''} onClick={() => setPov(p.id)}>{p.label}</button>)}
                <button onClick={() => setLook(l => ({ ...l, fx: FX_LIST[(FX_LIST.indexOf(l.fx) + 1) % FX_LIST.length] }))} title="visual treatment of the video only" aria-label="visual effect">FX: {fx.toUpperCase()}</button>
            </div>
            <div className="gcams" role="group" aria-label="visual shuffle">
                <button className="primary" onClick={doShuffle} title="pick a different curated look, keeping what is locked">SHUFFLE VISUALS</button>
                <button onClick={doHit} title={quant ? 'flash on the next beat of the shared clock' : 'flash now'}>HIT IT</button>
                <label className="chk"><input type="checkbox" checked={quant} onChange={e => setQuant(e.target.checked)} /> on the beat</label>
                {GROUPS.map(g => <label key={g} className="chk" title={`keep the ${g} when shuffling`}><input type="checkbox" checked={locked.has(g)} onChange={() => toggleLock(g)} aria-label={`lock ${g}`} /> lock {g}</label>)}
                {note && <small className="gnote" role="status">{note}</small>}
            </div>
        </div>
    );
}
