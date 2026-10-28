import { useEffect } from 'react';
import { GameRuntime } from '../runtime';
import { Breakdown } from '../core/scoring';
import StationPanel from './StationPanel';
import Venue from './Venue';

const fmt = (s: number) => { s = Math.max(0, s); return `${Math.floor(s / 60)}:${Math.floor(s % 60).toString().padStart(2, '0')}`; };

function Results({ rt }: { rt: GameRuntime }) {
    const show = rt.mode === 'show'; const N1 = show ? 'AI DJ 1' : 'YOU', N2 = show ? 'AI DJ 2' : 'BUDDY';
    const s = rt.session!; const r = s.results[s.results.length - 1]; if (!r) return null; const over = s.phase === 'matchEnd';
    const win = r.winner === 'player' ? (show ? 'AI DJ 1 WINS' : 'YOU WIN THE ROUND') : r.winner === 'buddy' ? (show ? 'AI DJ 2 WINS' : 'BUDDY WINS THE ROUND') : (show ? 'THE SHOW IS A DRAW' : 'ROUND DRAWN');
    const matchLine = over && !show ? (s.matchWinner === 'player' ? 'YOU WIN THE MATCH' : s.matchWinner === 'buddy' ? 'BUDDY WINS THE MATCH' : 'MATCH DRAWN') : null;
    const table = (b: Breakdown, title: string) => (
        <div className="gres"><h4>{title}: {b.total.toFixed(1)} / 100</h4>
            {!b.alignmentMeasurable && b.audibleSec > 0 && <p className="warn">Alignment could not be measured: the track has no BPM. Set it in Tracks.</p>}
            <table><tbody>{b.items.map(i => <tr key={i.category}><td>{i.category}</td><td>{i.points.toFixed(1)}/{i.outOf}</td><td className="why">{i.reason}</td></tr>)}</tbody></table></div>);
    const decisions = [...(rt.ai2?.decisions ?? []), ...(rt.ai?.decisions ?? [])].filter(d => d.kind !== 'note').sort((x, y) => x.time - y.time).slice(-12);
    return (
        <div className="gmodal" role="dialog" aria-label="round results">
            <div className="gcard">
                <h2>{matchLine ?? win}</h2>{matchLine && <p>{win} · rounds won: you {s.wins.player}, Buddy {s.wins.buddy}</p>}
                <div className="gcols">{table(r.breakdown.player, N1)}{table(r.breakdown.buddy, N2)}</div>
                <details><summary>{show ? "The AI DJs' decisions and the evidence behind them" : "Buddy's decisions and the evidence behind them"}</summary>
                    <ul className="glog">{decisions.map((d, i) => <li key={i}><b>{d.decision}</b> — {d.evidence} <em>[{d.action}]</em>{d.prefsApplied.length ? ` · your preferences applied: ${d.prefsApplied.join(', ')}` : ''}</li>)}</ul></details>
                <p className="gnote">Scores measure timing, tempo, structure and technique from what was actually played. They do not judge taste. There is no crowd vote in this build.{show && ' Both DJs here are AI; nobody played.'}</p>
                <div className="gactions">
                    {!over && !show && <button className="primary" onClick={() => rt.act('ready')}>NEXT ROUND</button>}
                    {over && <button className="primary" onClick={() => rt.rematch()}>{show ? 'REMATCH SHOW' : 'REMATCH'}</button>}
                    <button onClick={() => rt.leave()}>MENU</button>
                </div>
            </div>
        </div>);
}

export default function Arena({ rt, onExit }: { rt: GameRuntime; onExit: () => void }) {
    const s = rt.session; const practice = rt.mode === 'practice'; const show = rt.mode === 'show';
    useEffect(() => {
        const h = (e: KeyboardEvent) => {
            if (rt.mode === 'show') return;                                  // no human controls in an AI show
            const t = e.target as HTMLElement; if (t.tagName === 'SELECT' || (t.tagName === 'INPUT' && (t as HTMLInputElement).type !== 'range')) return;
            const st = rt.stations.player.state(); const k = e.key; let handled = true;
            if (k === ' ') rt.act('play'); else if (k === 'c' || k === 'C') rt.act('cue'); else if (k === 'm' || k === 'M') rt.act('matchTempo'); else if (k === 'b' || k === 'B') rt.act('startOnBeat'); else if (k === 'a' || k === 'A') rt.act('align');
            else if (k === 'Enter') rt.act('ready'); else if (k === 'ArrowUp') rt.act('volume', Math.min(1, st.volume + 0.05)); else if (k === 'ArrowDown') rt.act('volume', Math.max(0, st.volume - 0.05));
            else if (k === 'ArrowRight') rt.act('tempo', Math.min(1, (st.rate - 1) / 0.32 + 0.5 + 0.0156)); else if (k === 'ArrowLeft') rt.act('tempo', Math.max(0, (st.rate - 1) / 0.32 + 0.5 - 0.0156));
            else if (k === '1' || k === '2' || k === '3') { const b = (['low', 'mid', 'high'] as const)[+k - 1]; rt.act(`eq.${b}` as 'eq.low', st.eq[b] < 0.1 ? 0.5 : 0); }
            else if (k === '[') rt.act('filter', Math.max(0, st.filter - 0.1)); else if (k === ']') rt.act('filter', Math.min(1, st.filter + 0.1)); else if (k === '\\') rt.act('filter', 0.5);
            else handled = false;
            if (handled) e.preventDefault();
        };
        window.addEventListener('keydown', h); return () => window.removeEventListener('keydown', h);
    }, [rt]);

    const phase = s?.phase; const clock = s?.clock; const now = rt.now;
    const beat = clock ? clock.beatAt(now) : NaN;
    const live = phase === 'live'; const cnt = phase === 'countin';
    const remaining = s && clock ? (live || cnt ? Math.max(0, clock.beat0Time + s.roundSec - now) : 0) : (s?.config.roundSeconds ?? 0);
    const lights = [1, 2, 3, 4].map(n => clock && (live || cnt) && Math.floor(((beat % 4) + 4) % 4) + 1 === n);
    const sc = s?.scorer && (live || cnt) ? { p: s.scorer.breakdown('player').total, b: s.scorer.breakdown('buddy').total } : null;
    const countNum = cnt && clock ? Math.max(1, Math.ceil(-beat)) : null;
    const msg = rt.message;
    const phaseText = practice ? 'PRACTICE · no score, no opponent' : !s ? '' : show ? (phase === 'countin' ? 'COUNT-IN' : phase === 'live' ? `LIVE · bar ${Math.max(1, clock!.barAt(now))} · two AI DJs, nobody is playing` : phase === 'matchEnd' ? 'SHOW OVER' : 'STARTING') : phase === 'idle' ? `ROUND ${s.round + 1} OF ${s.config.bestOf}: load a track, then READY` : phase === 'countin' ? 'COUNT-IN' : phase === 'live' ? `LIVE · bar ${Math.max(1, clock!.barAt(now))}` : phase === 'roundEnd' ? `ROUND ${s.round} OVER` : 'MATCH OVER';
    return (
        <div className="garena">
            <div className="ghud">
                <div><b>{practice ? 'PRACTICE' : show ? 'AI vs AI SHOW' : s?.challenge.name.toUpperCase()}</b><div className="sub">{phaseText}</div></div>
                <div className="gbeat" aria-label="shared beat">{lights.map((on, i) => <i key={i} className={on ? (i === 0 ? 'on acc' : 'on') : ''} />)}<span>{(s?.config.masterBpm ?? rt.options.masterBpm).toFixed(0)} BPM master</span></div>
                {!practice && <div className="gtimer">{countNum ? <span className="count">{countNum}</span> : <span>{fmt(remaining)}</span>}</div>}
                {!practice && <div className="gscore" aria-label="live score">{show ? 'AI DJ 1' : 'YOU'} {sc ? sc.p.toFixed(1) : '--'} · {show ? 'AI DJ 2' : 'BUDDY'} {sc ? sc.b.toFixed(1) : '--'}{!show && <div className="sub">rounds: you {s!.wins.player} · Buddy {s!.wins.buddy} · best of {s!.config.bestOf}</div>}</div>}
                <div className="gright">
                    {practice && <label className="chk"><input type="checkbox" checked={rt.clickInPractice} onChange={e => { rt.clickInPractice = e.target.checked; }} /> metronome</label>}
                    {s && !show && <label className="chk"><input type="checkbox" checked={rt.options.clickDuringRound} onChange={e => { rt.options.clickDuringRound = e.target.checked; }} /> click in round</label>}
                    {!practice && !show && (phase === 'idle' || phase === 'roundEnd') && <button className="primary" onClick={() => rt.act('ready')}>{phase === 'idle' ? 'READY' : 'NEXT ROUND'}</button>}
                    <button onClick={() => { if (rt.session && (phase === 'live' || phase === 'countin') && !window.confirm(show ? 'Stop the show?' : 'Leave the running round and lose this match?')) return; rt.leave(); onExit(); }}>MENU</button>
                </div>
            </div>
            {msg && <div className="gtoast" role="status">{msg}</div>}
            <div className="gboard">
                <StationPanel rt={rt} id="player" readOnly={show} label={show ? 'AI DJ 1' : undefined} />
                <div className="gcenter"><Venue rt={rt} show={show} />
                    {!show && <TrackPicker rt={rt} />}
                    {show && <div className="gcomm" aria-label="AI DJ commentary"><b>THE AI DJS SAY</b>{[...(rt.ai2?.decisions.map(d => ({ d, who: 'AI DJ 1' })) ?? []), ...(rt.ai?.decisions.map(d => ({ d, who: 'AI DJ 2' })) ?? [])].sort((x, y) => x.d.time - y.d.time).slice(-4).reverse().map((x, i) => <p key={i}><b>{x.who}</b> {x.d.decision} <em>{x.d.evidence}</em></p>)}{!rt.ai?.decisions.length && <p>Waiting for the count-in.</p>}<small className="gnote">The crowd is a simulation. It reacts to the music's level and does not vote.</small></div>}
                    {!practice && !show && <div className="gcomm" aria-label="Buddy's commentary"><b>BUDDY SAYS</b>{(rt.ai?.decisions.slice(-3).reverse() ?? []).map((d, i) => <p key={i}>{d.decision} <em>{d.evidence}</em></p>)}{!rt.ai?.decisions.length && <p>Waiting for the round to start.</p>}</div>}
                </div>
                {practice ? <section className="gstation theirs off"><header><b>BUDDY</b><span className="gtag">OFF</span></header><p className="gnote">Practice has no opponent.</p></section> : <StationPanel rt={rt} id="buddy" readOnly={show} label={show ? 'AI DJ 2' : undefined} />}
            </div>
            {s && (phase === 'roundEnd' || phase === 'matchEnd') && <Results rt={rt} />}
        </div>);
}

function TrackPicker({ rt }: { rt: GameRuntime }) {
    const cur = rt.stations.player.state().trackId;
    return (
        <div className="gpicker" aria-label="load a track on your deck"><b>YOUR DECK · TRACKS</b>
            <div className="glist">{rt.tracks.map(t => (
                <button key={t.id} className={t.id === cur ? 'on' : ''} onClick={() => rt.loadToPlayer(t.id)} title={t.bpm ? '' : 'no BPM: cannot be scored for alignment until you set it in Track Library'}>
                    {t.title} <small>{t.bpm ? `${t.bpm.toFixed(0)} BPM${t.bpmOrigin === 'estimated' ? '?' : ''}` : 'no BPM'}{t.key ? ` · ${t.key}` : ''}</small></button>))}</div></div>);
}
