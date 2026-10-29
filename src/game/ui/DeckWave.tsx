import { useEffect, useRef } from 'react';
import { GameRuntime } from '../runtime';
import { StationId } from '../core/types';
import { beatsInWindow, windowPeaks } from '../core/waveform';
import { HOT_COLORS, HOT_LETTERS } from './cdjColors';

const W = 480, DH = 84, OH = 30, HALF = 4;     // detail shows +-4 s around the playhead

/**
 * CDJ-style track display: a scrolling waveform around the playhead with the beat grid, cue point, hot cues A-H and the loop, plus a whole-track overview you can
 * click or drag to seek. Everything is drawn from the decoded audio and the deck's real state; with no beat grid no grid is drawn.
 */
export default function DeckWave({ rt, id, seekable }: { rt: GameRuntime; id: StationId; seekable: boolean }) {
    const overviewCache = useRef<{ key: string; peaks: ReturnType<typeof windowPeaks> } | null>(null);
    const det = useRef<HTMLCanvasElement>(null); const ov = useRef<HTMLCanvasElement>(null); const dragging = useRef(false); const lastSeek = useRef(0);
    const color = id === 'player' ? '#33ebff' : '#ff4ddb';

    useEffect(() => {
        let raf = 0;
        const draw = () => {
            raf = requestAnimationFrame(draw);
            const d = det.current, o = ov.current; if (!d || !o || !rt.ready) return;
            const st = rt.stations[id].state(); const track = st.trackId ? rt.library.get(st.trackId) ?? null : null;
            const gd = d.getContext('2d')!, go = o.getContext('2d')!;
            gd.clearRect(0, 0, W, DH); go.clearRect(0, 0, W, OH);
            const wave = track ? rt.wave(track.id) : null;
            if (!track || !wave) { gd.fillStyle = '#8b7fb8'; gd.font = '12px monospace'; gd.fillText(track ? 'analysing…' : 'no track loaded', 10, DH / 2 + 4); return; }
            const total = track.loopSec ?? track.durationSec; const p = st.positionSec;
            const mid = DH / 2;
            // ---- detail
            const t0 = p - HALF, t1 = p + HALF; const x = (t: number) => ((t - t0) / (t1 - t0)) * W;
            if (st.loop) { gd.fillStyle = st.loop.active ? 'rgba(59,255,122,0.30)' : 'rgba(59,255,122,0.10)'; gd.fillRect(x(st.loop.start), 0, Math.max(2, x(st.loop.end) - x(st.loop.start)), DH); }
            const peaks = windowPeaks(wave, t0, t1, W); gd.fillStyle = color;
            for (let c = 0; c < W; c++) { const q = peaks[c]; if (!q) continue; const top = mid - q.hi * mid * 0.95, bot = mid - q.lo * mid * 0.95; gd.fillRect(c, top, 1, Math.max(1, bot - top)); }
            for (const b of beatsInWindow(track.bpm, track.firstBeatSec, t0, t1)) { gd.fillStyle = b.downbeat ? 'rgba(255,255,255,0.55)' : 'rgba(255,255,255,0.2)'; gd.fillRect(Math.round(x(b.t)), b.downbeat ? 0 : DH - 14, 1, b.downbeat ? DH : 14); }
            if (st.cueSec >= t0 && st.cueSec <= t1) { gd.fillStyle = '#ff9f1c'; const cx = x(st.cueSec); gd.fillRect(cx - 1, 0, 2, DH); gd.beginPath(); gd.moveTo(cx - 6, 0); gd.lineTo(cx + 6, 0); gd.lineTo(cx, 8); gd.fill(); }
            gd.font = 'bold 11px monospace';
            st.hotCues.forEach((h, i) => { if (h === null || h < t0 || h > t1) return; const cx = x(h); gd.fillStyle = HOT_COLORS[i]; gd.fillRect(cx - 1, 0, 2, DH); gd.fillRect(cx, 0, 12, 13); gd.fillStyle = '#0c0720'; gd.fillText(HOT_LETTERS[i], cx + 2, 11); });
            gd.fillStyle = '#fff'; gd.fillRect(W / 2 - 1, 0, 2, DH);
            // ---- overview
            const ox = (t: number) => (t / total) * W;
            // the whole-track peaks never change for a loaded track: compute once, not every frame
            if (overviewCache.current?.key !== `${track.id}:${total}`) overviewCache.current = { key: `${track.id}:${total}`, peaks: windowPeaks(wave, 0, total, W) };
            const op = overviewCache.current.peaks;
            go.fillStyle = color + '99'; const omid = OH / 2;
            for (let c = 0; c < W; c++) { const q = op[c]; if (!q) continue; go.fillRect(c, omid - q.hi * omid, 1, Math.max(1, (q.hi - q.lo) * omid)); }
            if (st.loop) { go.fillStyle = st.loop.active ? 'rgba(59,255,122,0.55)' : 'rgba(59,255,122,0.2)'; go.fillRect(ox(st.loop.start), 0, Math.max(2, ox(st.loop.end) - ox(st.loop.start)), OH); }
            go.fillStyle = '#ff9f1c'; go.fillRect(ox(st.cueSec), 0, 2, OH);
            st.hotCues.forEach((h, i) => { if (h === null) return; go.fillStyle = HOT_COLORS[i]; go.fillRect(ox(h), 0, 2, OH); });
            go.fillStyle = '#fff'; go.fillRect(ox(p) - 1, 0, 2, OH);
        };
        raf = requestAnimationFrame(draw); return () => cancelAnimationFrame(raf);
    }, [rt, id, color]);

    const seekTo = (e: React.PointerEvent<HTMLCanvasElement>) => {
        const st = rt.stations[id].state(); const track = st.trackId ? rt.library.get(st.trackId) : null; if (!track) return;
        const r = e.currentTarget.getBoundingClientRect(); const f = Math.min(1, Math.max(0, (e.clientX - r.left) / r.width));
        const now = performance.now(); if (now - lastSeek.current < 60 && e.type === 'pointermove') return; lastSeek.current = now;
        rt.seekPlayer(f * (track.loopSec ?? track.durationSec));
    };
    return (
        <div className="gdw" aria-label={id === 'player' ? 'your track display' : "Buddy's track display"}>
            <canvas ref={det} width={W} height={DH} className="gdetail" data-testid={`wave-detail-${id}`} aria-label="scrolling waveform around the playhead" />
            <canvas ref={ov} width={W} height={OH} className={`gover ${seekable ? 'seekable' : ''}`} data-testid={`wave-overview-${id}`} aria-label={seekable ? 'whole track overview: click or drag to seek' : 'whole track overview'}
                onPointerDown={e => { if (!seekable) return; try { e.currentTarget.setPointerCapture(e.pointerId); } catch { /* capture is a nicety */ } dragging.current = true; seekTo(e); }}
                onPointerMove={e => { if (seekable && dragging.current) seekTo(e); }} onPointerUp={() => { dragging.current = false; }} onPointerCancel={() => { dragging.current = false; }} />
        </div>
    );
}
