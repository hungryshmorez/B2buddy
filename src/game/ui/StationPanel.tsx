import { useEffect, useRef } from 'react';
import { GameRuntime, faderToRate, rateToFader } from '../runtime';
import { StationId } from '../core/types';

const fmt = (s: number) => { s = Math.max(0, s); const m = Math.floor(s / 60); return `${m}:${Math.floor(s % 60).toString().padStart(2, '0')}`; };

function Wave({ rt, id }: { rt: GameRuntime; id: StationId }) {
    const ref = useRef<HTMLCanvasElement>(null);
    useEffect(() => {
        let raf = 0; const buf = new Float32Array(512);
        const draw = () => {
            const c = ref.current; if (c && rt.ready) {
                const g = c.getContext('2d')!; rt.waveform(id, buf); g.clearRect(0, 0, c.width, c.height);
                g.strokeStyle = id === 'player' ? '#33ebff' : '#ff4ddb'; g.lineWidth = 2; g.beginPath();
                for (let i = 0; i < buf.length; i++) { const x = i / buf.length * c.width, y = c.height / 2 - buf[i] * c.height * 0.45; i ? g.lineTo(x, y) : g.moveTo(x, y); }
                g.stroke();
            }
            raf = requestAnimationFrame(draw);
        };
        raf = requestAnimationFrame(draw); return () => cancelAnimationFrame(raf);
    }, [rt, id]);
    return <canvas ref={ref} width={400} height={56} className="gwave" aria-label="live signal of this deck" />;
}

function Meter({ value }: { value: number }) {
    const db = value <= 1e-4 ? -60 : 20 * Math.log10(value); const pct = Math.max(0, Math.min(1, (db + 48) / 48)) * 100;
    return <div className="gmeter" title="channel level"><div style={{ height: pct + '%' }} className={db > -1 ? 'hot' : db > -8 ? 'warm' : ''} /></div>;
}

/** One station: deck + mixer channel. The player's panel drives the real station; Buddy's panel shows the same state read-only. */
export default function StationPanel({ rt, id }: { rt: GameRuntime; id: StationId }) {
    const mine = id === 'player';
    const st = rt.stations[id].state(); const track = st.trackId ? rt.library.get(st.trackId) ?? null : null;
    const peaks = rt.meters()[id];
    const eff = track?.bpm ? track.bpm * st.rate : null;
    const origin = track ? track.bpmOrigin : 'unavailable';
    const loop = track?.loopSec;
    const posInLoop = loop ? st.positionSec % loop : st.positionSec; const total = loop ?? track?.durationSec ?? 0;
    const bar = track?.bpm ? Math.floor(((st.positionSec - track.firstBeatSec) * track.bpm / 60) / 4) + 1 : null;
    const dis = !mine || !st.enabled;
    const act = (a: Parameters<GameRuntime['act']>[0], v?: number) => rt.act(a, v);
    const slider = (label: string, value: number, onChange: (v: number) => void, aria: string) => (
        <label className="gslider"><span>{label}</span>
            <input type="range" min={0} max={1} step={0.005} value={value} disabled={dis} aria-label={aria} onChange={e => onChange(parseFloat(e.target.value))} />
        </label>);
    return (
        <section className={`gstation ${mine ? 'mine' : 'theirs'}`} aria-label={mine ? 'your station' : "Buddy's station"}>
            <header><b>{mine ? 'YOU' : 'BUDDY'}</b><span className="gtag">{st.enabled ? (st.sounding ? 'ON AIR' : st.playing ? 'ARMED' : 'READY') : 'OFF'}</span></header>
            <div className="gdeck">
                <div className="gtitle">{track ? track.title : (mine ? 'No track loaded: pick one below' : 'empty')}</div>
                <div className="ginfo">
                    <span>{eff ? `${eff.toFixed(1)} BPM` : 'BPM unknown'}</span>
                    <span className={`gbadge o-${origin}`} title="where this BPM came from">{origin}</span>
                    <span>{track?.key ? `${track.key} (${track.keyOrigin})` : 'key unknown'}</span>
                    {track && <span>rate {(st.rate * 100).toFixed(1)}%</span>}
                </div>
                <div className="gpos"><div className="gposfill" style={{ width: total ? (posInLoop / total * 100) + '%' : '0%' }} />
                    <span>{track ? (loop ? `bar ${bar ?? '-'} of ${Math.round(loop * (track.bpm ?? 120) / 240)} · phrase ${fmt(posInLoop)}` : `${fmt(posInLoop)} / -${fmt(total - posInLoop)}`) : '--'}</span></div>
                <div className="gwrap"><Wave rt={rt} id={id} /><Meter value={peaks} /></div>
                {mine && <div className="gbtns">
                    <button onClick={() => act('play')} className={st.playing ? 'on' : ''} aria-label="play or pause">{st.playing ? 'PAUSE' : 'PLAY'}</button>
                    <button onClick={() => act('cue')} aria-label="cue">CUE</button>
                    <button onClick={() => act('matchTempo')} title="set this deck's tempo to the master tempo">MATCH TEMPO</button>
                    <button onClick={() => act('startOnBeat')} title="start on the next bar line of the master clock">START ON BEAT</button>
                    <button onClick={() => act('align')} title="nudge the playing deck onto the master beat">ALIGN</button>
                </div>}
                <div className="gmix">
                    {slider('TEMPO', rateToFader(st.rate), v => act('tempo', v), 'tempo fader')}
                    {slider('LOW', st.eq.low, v => act('eq.low', v), 'low EQ')}{slider('MID', st.eq.mid, v => act('eq.mid', v), 'mid EQ')}{slider('HIGH', st.eq.high, v => act('eq.high', v), 'high EQ')}
                    {slider('FILTER', st.filter, v => act('filter', v), 'filter, left low-pass, right high-pass')}
                    {slider('VOLUME', st.volume, v => act('volume', v), 'channel volume')}
                </div>
                <div className="gdeckb" aria-label="deck B is off in the standard format">DECK B · OFF<br /><small>standard format: one deck each</small></div>
            </div>
        </section>
    );
}
export { faderToRate };
