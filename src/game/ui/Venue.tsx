import { useEffect, useRef, useState } from 'react';
import { GameRuntime } from '../runtime';
import { DEFAULT_LOOK, flashAt, Group, GROUPS, hitTime, Look, MOTIONS, PALETTES, shuffle } from './visuals';
import { CAMS, crowdPoints, DECK_X, DJ_HEAD_Y, DJ_X, Pov, POVS, project, V3 } from './cameras';
import { datamoshFrame, effectById, eligibleEffects, FX_IDLE, FxState, GlPass, probeWebGl, randomEffect, SHADERS, toggleEffect, TrippyId } from '../fx/trippy';
import { BendrEngine, EffectEntry } from '../video/bendrEngine';
import { formatReport, glRenderer, PerfMeter, ratePerSec } from '../perf';

const W = 640, H = 300;
const STATIONS = ['player', 'buddy'] as const;

/**
 * The club, drawn on a canvas from five camera positions. Everything here is the "video pipeline": the treatments are layers over this canvas
 * only, never on the controls. The lights and crowd react to the real master level; the crowd is decoration and is labelled as such in the credits.
 * The Trippy effect (RANDOM EFFECT / ON-OFF) lives in its own state, separate from the camera, so changing camera never resets it.
 */
export default function Venue({ rt, show = false }: { rt: GameRuntime; show?: boolean }) {
    const ref = useRef<HTMLCanvasElement>(null); const stack = useRef<HTMLDivElement>(null);
    const [look, setLook] = useState<Look>({ ...DEFAULT_LOOK, camera: show ? 'crowd' : DEFAULT_LOOK.camera }); const [locked, setLocked] = useState<Set<Group>>(new Set()); const [quant, setQuant] = useState(true); const [note, setNote] = useState('');
    const [glOk, setGlOk] = useState(false); const [fxs, setFxs] = useState<FxState>(FX_IDLE); const [fxNote, setFxNote] = useState('');
    // video engine: BENDR is primary; the canvas effects below are the explicit fallback and are labelled as such
    const [eng, setEng] = useState<'starting' | 'bendr' | 'canvas'>(rt.videoPref === 'bendr' ? 'starting' : 'canvas'); const [engNote, setEngNote] = useState(''); const [bReg, setBReg] = useState<readonly EffectEntry[]>([]); const [bVer, setBVer] = useState('');
    const engRef = useRef<BendrEngine | null>(null); const engModeRef = useRef(eng); engModeRef.current = eng; const vidRef = useRef<HTMLVideoElement>(null);
    const lookRef = useRef(look); lookRef.current = look; const hitRef = useRef<number | null>(null); const fxRef = useRef(fxs); fxRef.current = fxs;
    const pov = look.camera; const setPov = (c: Pov) => setLook(l => ({ ...l, camera: c }));
    const doShuffle = () => { const r = shuffle(look, locked, Math.random); setLook(r.look); setNote(r.note ?? `${PALETTES[r.look.palette].name} · ${MOTIONS[r.look.motion].beams} · ${r.look.fx} · ${r.look.camera}`); };
    const doHit = () => { const clock = rt.session?.clock ?? rt.practiceClock; hitRef.current = hitTime(rt.now, clock, quant); };
    const toggleLock = (g: Group) => setLocked(s => { const n = new Set(s); if (n.has(g)) n.delete(g); else n.add(g); return n; });
    useEffect(() => { setGlOk(probeWebGl()); }, []);
    // performance readout (off by default): frame times of this canvas and the frame rate BENDR actually outputs, measured, with a copyable report
    const meter = useRef(new PerfMeter()); const bendrSample = useRef<{ n: number; at: number } | null>(null); const bendrFps = useRef<number | null>(null); const rendererName = useRef('');
    const [perfOn, setPerfOn] = useState(() => { try { return new URLSearchParams(location.search).has('perf'); } catch { return false; } }); const [perfText, setPerfText] = useState(''); const [copied, setCopied] = useState('');
    const buildReport = () => {
        const c = rt.ctx; if (!rendererName.current) rendererName.current = glRenderer();
        return formatReport({ gameFps: meter.current.summary(), bendrFps: bendrFps.current, engine: engModeRef.current === 'bendr' ? 'BENDR' : 'canvas effects', effect: fxRef.current.on ? (fxRef.current.id ?? '') : '', audioBaseMs: c ? c.baseLatency * 1000 : null, audioOutMs: c && typeof c.outputLatency === 'number' ? c.outputLatency * 1000 : null, renderer: rendererName.current, userAgent: navigator.userAgent, build: String(import.meta.env.MODE) });
    };
    useEffect(() => {
        if (!perfOn) { setPerfText(''); return; }
        meter.current.reset(); bendrSample.current = null;
        const id = window.setInterval(() => {
            const e = engRef.current; const now = performance.now();
            if (e && engModeRef.current === 'bendr') { const n = e.frameNo(); bendrFps.current = ratePerSec(bendrSample.current, n, now); bendrSample.current = { n, at: now }; } else bendrFps.current = null;
            setPerfText(buildReport());
        }, 1000);
        return () => window.clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [perfOn]);
    const copyReport = () => { const t = buildReport(); const blocked = 'copy blocked: select the text instead'; try { void Promise.race([navigator.clipboard.writeText(t).then(() => 'copied'), new Promise<string>(r => window.setTimeout(() => r(blocked), 1500))]).then(setCopied, () => setCopied(blocked)); } catch { setCopied(blocked); } };
    const eligible: ReadonlyArray<{ id: string; name: string }> = eng === 'bendr' ? bReg : eligibleEffects(glOk);
    const [ack, setAck] = useState(rt.flashingAck); const [flashOn, setFlashOn] = useState(rt.allowFlashing);
    const setFlashing = (allow: boolean) => {
        rt.allowFlashing = allow; rt.savePrefs(); setFlashOn(allow); const e = engRef.current;
        if (e) { const cleared = e.setAllowFlashing(allow); setBReg(e.registry()); if (cleared) { setFxs(FX_IDLE); setFxNote('Flashing effects are off, so the flashing effect that was active has been cleared.'); } }
    };
    const answerWarning = (keepFlashing: boolean) => { rt.flashingAck = true; setAck(true); setFlashing(keepFlashing); };
    const rollEffect = () => { const n = randomEffect(fxs, eligible, Math.random); if (!n) { setFxNote('No effect can run in this browser.'); return; } setFxs(n); setFxNote(''); };
    const flipEffect = () => { const n = toggleEffect(fxs, eligible, Math.random); if (!n) { setFxNote('No effect can run in this browser.'); return; } setFxs(n); setFxNote(''); };
    const active = (eng === 'bendr' ? bReg.find(e => e.id === fxs.id) : effectById(fxs.id)) ?? null; const showing = fxs.on && active;
    useEffect(() => { rt.events.emit({ type: 'camera.changed', camera: pov }); }, [pov, rt]);
    const prevFx = useRef<FxState>(FX_IDLE);
    useEffect(() => {
        const p = prevFx.current; prevFx.current = fxs; const e = engRef.current; const engine = eng === 'bendr' ? 'bendr' : 'canvas';
        if (fxs.id && fxs.id !== p.id) rt.events.emit({ type: 'effect.selected', id: fxs.id, name: active?.name ?? fxs.id, engine });
        if (fxs.on !== p.on) rt.events.emit({ type: 'effect.toggled', on: fxs.on, id: fxs.id });
        if (eng === 'bendr' && e) { if (fxs.id && e.selected?.id !== fxs.id && !e.select(fxs.id)) setFxNote('That effect could not be applied: ' + e.status().detail); e.setOn(fxs.on && !!fxs.id); }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [fxs, eng]);
    useEffect(() => {
        if (rt.videoPref !== 'bendr') { rt.events.emit({ type: 'engine.status', engine: 'canvas', state: 'ready', detail: 'canvas effects selected' }); return; }
        let alive = true; const feed = ref.current!; const e = new BendrEngine({ src: import.meta.env.BASE_URL + 'bendr/index.html', feed, audio: rt.masterAudioStream(), bus: rt.events, masterBpm: rt.options.masterBpm, allowFlashing: rt.allowFlashing });
        const off = rt.events.on('engine.status', s => { if (alive && s.engine === 'bendr' && s.state === 'failed') { setEng('canvas'); setEngNote(s.detail); setFxs(FX_IDLE); setFxNote('BENDR stopped, so the effect was cleared and the canvas effects took over.'); engRef.current = null; e.dispose(); rt.events.emit({ type: 'engine.status', engine: 'canvas', state: 'degraded', detail: 'fallback after BENDR failure: ' + s.detail }); } });
        e.start().then(() => { if (!alive) { e.dispose(); return; } engRef.current = e; (window as unknown as { __b2bVideo?: BendrEngine }).__b2bVideo = e; e.setAllowFlashing(rt.allowFlashing); setBReg(e.registry()); setBVer(e.status().version ?? ''); setEng('bendr'); const v = vidRef.current; if (v && e.output) { v.srcObject = e.output; void v.play().catch(() => undefined); } })
            .catch((err: Error) => { if (!alive) return; setEng('canvas'); setEngNote(err.message); rt.events.emit({ type: 'engine.status', engine: 'canvas', state: 'degraded', detail: 'fallback: ' + err.message }); });
        return () => { alive = false; off(); e.dispose(); engRef.current = null; };
    }, [rt]);

    // effect layers: one overlay canvas per effect that needs pixels, created on first use and kept; only the active one is visible
    const layers = useRef(new Map<TrippyId, { canvas: HTMLCanvasElement; gl?: GlPass }>());
    useEffect(() => {
        let raf = 0; const crowd = crowdPoints(); let frame = 0;
        const layer = (id: TrippyId) => {
            let l = layers.current.get(id); if (l) return l;
            const canvas = document.createElement('canvas'); canvas.width = W; canvas.height = H; canvas.className = 'tfx-layer'; canvas.dataset.effect = id; canvas.setAttribute('aria-hidden', 'true'); stack.current?.appendChild(canvas);
            l = { canvas }; if (id === 'liquid' || id === 'fractal') l.gl = new GlPass(canvas, SHADERS[id].vertex, SHADERS[id].fragment);
            layers.current.set(id, l); return l;
        };
        const draw = (t: number) => {
            meter.current.tick(t);
            const c = ref.current; if (c) {
                const g = c.getContext('2d')!; const w = c.width, h = c.height; const L = lookRef.current; const pal = PALETTES[L.palette]; const mo = MOTIONS[L.motion]; const cam = CAMS[L.camera];
                const lvl = rt.ready ? rt.masterLevel() : 0; const beat = rt.session?.clock ? rt.session.clock.beatAt(rt.now) : t / 480; const pulse = Math.pow(1 - (beat - Math.floor(beat)), 3) * (0.3 + lvl); const flash = flashAt(rt.now, hitRef.current);
                const grad = g.createLinearGradient(0, 0, 0, h); grad.addColorStop(0, '#0a0620'); grad.addColorStop(1, '#190a33'); g.fillStyle = grad; g.fillRect(0, 0, w, h);
                const line = (a: V3, b: V3, col: string, lw = 1) => { const pa = project(a, cam, w, h), pb = project(b, cam, w, h); if (!pa || !pb) return; g.strokeStyle = col; g.lineWidth = lw; g.beginPath(); g.moveTo(pa[0], pa[1]); g.lineTo(pb[0], pb[1]); g.stroke(); };
                for (let i = -12; i <= 12; i += 2) { line([i, 0, -6], [i, 0, 14], 'rgba(120,60,255,0.28)'); line([-12, 0, i + 2], [12, 0, i + 2], 'rgba(120,60,255,0.28)'); }
                const box = (cx: number, cz: number, sx: number, sz: number, hh: number, col: string) => { const c8: V3[] = []; for (const dx of [-1, 1]) for (const dz of [-1, 1]) for (const y of [0, hh]) c8.push([cx + dx * sx / 2, y, cz + dz * sz / 2]); const E = [[0, 1], [2, 3], [4, 5], [6, 7], [0, 2], [1, 3], [4, 6], [5, 7], [0, 4], [1, 5], [2, 6], [3, 7]]; for (const [a, b] of E) line(c8[a], c8[b], col, 2); };
                const colA = `rgb(${pal.a})`, colB = `rgb(${pal.b})`; box(DECK_X[0], 0, 1.6, 2.6, 1, colA); box(DECK_X[1], 0, 1.6, 2.6, 1, colB);
                // each deck table shows its REAL station: platter turns while the track plays, the strip is the channel volume
                STATIONS.forEach((id, k) => {
                    const st = rt.stations[id].state(); const cx = DECK_X[k], col = k ? colB : colA; const spin = st.sounding ? st.positionSec * st.rate * 0.555 * Math.PI * 2 : 0; const R = 0.55;
                    let prev: [number, number] | null = null; for (let a = 0; a <= 24; a++) { const th = a / 24 * Math.PI * 2; const p = project([cx + Math.cos(th) * R, 1.01, -0.2 + Math.sin(th) * R], cam, w, h); if (p && prev) { g.strokeStyle = col; g.lineWidth = 1.5; g.beginPath(); g.moveTo(prev[0], prev[1]); g.lineTo(p[0], p[1]); g.stroke(); } prev = p ? [p[0], p[1]] : null; }
                    line([cx, 1.01, -0.2], [cx + Math.cos(spin) * R, 1.01, -0.2 + Math.sin(spin) * R], st.sounding ? '#ffffff' : 'rgba(255,255,255,0.35)', 2);
                    const x = cx + (k ? -0.65 : 0.65); line([x, 1.01, -1.1], [x, 1.01, 1.1], 'rgba(255,255,255,0.18)', 3); line([x, 1.01, 1.1], [x, 1.01, 1.1 - 2.2 * st.volume], col, 3);
                });
                // DJs (head + shoulders); the camera's own DJ is not drawn from inside their head
                const dj = (x: number, col: string, mine: boolean) => { if (mine) return; const hd = project([x, DJ_HEAD_Y, 0], cam, w, h); const bd = project([x, 1.05, 0], cam, w, h); if (hd && bd) { g.fillStyle = col; g.beginPath(); g.arc(hd[0], hd[1], Math.max(3, 0.22 / hd[2] * (h / 1.2)), 0, 7); g.fill(); g.fillRect(bd[0] - 12 / hd[2] * 4, bd[1], 24 / hd[2] * 4, (hd[1] - bd[1]) * -0.9); } };
                dj(DJ_X[0], colA, L.camera === 'dj1'); dj(DJ_X[1], colB, L.camera === 'dj2');
                for (let k = 0; k < 6; k++) { const a = mo.beams === 'fan' ? (k - 2.5) * 1.1 : Math.sin(t / 1400 * mo.speed + k) * 3; const on = mo.beams === 'strobe' ? (Math.floor(beat * 2) % 2 ? 1 : 0.15) : 1; line([-5 + k * 2, 5.5, -4], [a + (k - 3) * 1.2, 0, 3], `rgba(${k % 2 ? pal.b : pal.a},${(0.12 + pulse * 0.5) * on})`, 3 + pulse * 8); }
                for (const p of crowd) { const q = project([p[0], 0.6 + pulse * mo.crowd * ((p[0] * 7 | 0) % 2 ? 1 : 0.5), p[2]], cam, w, h); if (q) { g.fillStyle = `rgba(${pal.crowd},0.55)`; g.beginPath(); g.arc(q[0], q[1], Math.max(2, 0.28 / q[2] * (h / 1.1)), 0, 7); g.fill(); } }
                if (flash > 0) { g.fillStyle = `rgba(255,255,255,${flash * 0.45})`; g.fillRect(0, 0, w, h); }
                g.fillStyle = 'rgba(255,255,255,0.8)'; g.font = '12px monospace'; g.fillText(POVS.find(p => p.id === L.camera)!.label.toUpperCase(), 10, 18);

                // trippy effect pass over the finished picture
                const fx = fxRef.current; const eff = fx.on && engModeRef.current === 'canvas' ? effectById(fx.id) : null; frame++;
                for (const [id, l] of layers.current) l.canvas.style.display = eff && id === eff.id ? 'block' : 'none';
                if (eff && (eff.kind === 'webgl' || eff.kind === 'pixel')) {
                    try {
                        const l = layer(eff.id); l.canvas.style.display = 'block';
                        if (l.gl) l.gl.draw(c, t / 1000);
                        else if (frame % 3 === 0) { const o = l.canvas.getContext('2d')!; o.drawImage(c, 0, 0); const img = o.getImageData(0, 0, w, h); datamoshFrame(img, 0.5, Math.random); o.putImageData(img, 0, 0); }
                    } catch { setGlOk(false); setFxs(FX_IDLE); setFxNote('That effect could not run on this graphics setup, so it was switched off.'); }
                }
            }
            raf = requestAnimationFrame(draw);
        };
        raf = requestAnimationFrame(draw);
        const layerMap = layers.current;
        return () => { cancelAnimationFrame(raf); for (const l of layerMap.values()) { l.gl?.dispose(); l.canvas.remove(); } layerMap.clear(); };
    }, [rt]);
    return (
        <div className="gvenue">
            {!ack && rt.videoPref === 'bendr' && <div className="gmodal" role="dialog" aria-modal="true" aria-label="photosensitivity warning" data-testid="flash-dialog"><div className="gcard">
                <h2>⚠ BEFORE YOU START</h2>
                <p><b>This can produce rapid full-frame flashing.</b> STROBE and INV FLICKER presets, and the feedback presets, can run at rates that are unsafe for people with photosensitive epilepsy. There is no rate ceiling, because a ceiling would make some of the effects useless.</p>
                <p>If you are projecting to a room, treat that as your responsibility: check the material before you show it, and warn people at the door. You can switch flashing effects off at any time with the FLASHING EFFECTS button.</p>
                <p className="gnote">Warning text carried over from BENDR, the video engine.</p>
                <div className="gactions"><button className="primary" onClick={() => answerWarning(true)}>UNDERSTOOD: KEEP FLASHING EFFECTS ON</button><button onClick={() => answerWarning(false)}>TURN FLASHING EFFECTS OFF</button></div></div></div>}
            <div ref={stack} className={`gvideo fx-${look.fx}`} data-look={JSON.stringify(look)} data-camera={pov} data-engine={eng} data-tfx={showing ? fxs.id : ''}>
                <canvas ref={ref} width={W} height={H} aria-label={`club camera view: ${POVS.find(p => p.id === pov)!.label}`} />
                <video ref={vidRef} className="bendr-out" muted playsInline autoPlay aria-label="BENDR video output" style={{ display: eng === 'bendr' ? 'block' : 'none' }} />
                {eng === 'canvas' && showing && fxs.id === 'crt' && <div className="tfx-over tfx-crt" data-effect="crt" aria-hidden="true" />}
                {eng === 'canvas' && showing && fxs.id === 'vhs' && <div className="tfx-over tfx-vhs" data-effect="vhs" aria-hidden="true" />}
            </div>
            <div className="gcams" role="group" aria-label="performance">
                <button className={perfOn ? 'on' : ''} aria-pressed={perfOn} data-testid="perf-toggle" onClick={() => { setPerfOn(v => !v); setCopied(''); }} title="Measure this device's frame rate with BENDR on and off">PERFORMANCE {perfOn ? 'ON' : 'OFF'}</button>
                {perfOn && <button onClick={copyReport} data-testid="perf-copy">COPY REPORT</button>}
                {copied && <small className="gnote" role="status">{copied}</small>}
            </div>
            {perfOn && <pre className="gnote" data-testid="perf" style={{ whiteSpace: 'pre-wrap', userSelect: 'text' }}>{perfText || 'measuring…'}</pre>}
            <div className="gcams" role="group" aria-label="camera views">
                {POVS.map(p => <button key={p.id} className={pov === p.id ? 'on' : ''} aria-pressed={pov === p.id} onClick={() => setPov(p.id)}>{p.label}</button>)}
            </div>
            <div className="gcams" role="group" aria-label="video effect">
                <button className="primary" onClick={rollEffect} disabled={!eligible.length} title="pick a random effect from the Trippy collection and turn it on">RANDOM EFFECT</button>
                <button className={fxs.on ? 'on' : ''} aria-pressed={fxs.on} onClick={flipEffect} disabled={!eligible.length} title="turn the selected effect on or off">EFFECT {fxs.on ? 'ON' : 'OFF'}</button>
                <small className="gnote" role="status" data-testid="fx-status" title={active ? ('source' in active ? active.source : 'BENDR built-in preset') : ''}>{active ? `${active.name} · ${fxs.on ? 'ON' : 'OFF'}` : 'no effect selected'}{fxNote ? ` — ${fxNote}` : ''}</small>
                <small className="gnote" data-testid="engine-status" role="status">{eng === 'bendr' ? `video engine: BENDR ${bVer} · ${bReg.length} effects` : eng === 'starting' ? 'video engine: starting BENDR…' : `video engine: canvas effects (FALLBACK${engNote ? ': ' + engNote : ''})`}</small>
                {eng === 'canvas' && !glOk && <small className="gnote">WebGL effects unavailable here; the others still work.</small>}
                <button className={flashOn ? 'on' : ''} aria-pressed={flashOn} data-testid="flash-toggle" onClick={() => setFlashing(!flashOn)} title="Strobe and inverse-flicker presets can cause rapid full-frame flashing. Turn them off to remove them from Random Effect.">FLASHING EFFECTS {flashOn ? 'ON' : 'OFF'}</button>
                <small className="gnote" data-testid="flash-warning">⚠ Video effects can flash rapidly (risk for people with photosensitive epilepsy).{active && 'flashing' in active && active.flashing ? ' The active effect is a flashing one.' : ''}</small>
            </div>
            {!show && <div className="gcams" role="group" aria-label="visual shuffle">
                <button className="primary" onClick={doShuffle} title="pick a different curated look, keeping what is locked">SHUFFLE VISUALS</button>
                <button onClick={doHit} title={quant ? 'flash on the next beat of the shared clock' : 'flash now'}>HIT IT</button>
                <label className="chk"><input type="checkbox" checked={quant} onChange={e => setQuant(e.target.checked)} /> on the beat</label>
                {GROUPS.map(g => <label key={g} className="chk" title={`keep the ${g} when shuffling`}><input type="checkbox" checked={locked.has(g)} onChange={() => toggleLock(g)} aria-label={`lock ${g}`} /> lock {g}</label>)}
                {note && <small className="gnote" role="status">{note}</small>}
            </div>}
        </div>
    );
}
