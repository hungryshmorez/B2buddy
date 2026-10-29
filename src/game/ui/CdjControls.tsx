import type { KeyboardEvent as RKeyboardEvent, PointerEvent as RPointerEvent, ReactNode } from 'react';
import { BEAT_JUMP_SIZES, GameRuntime, LOOP_SIZES, TEMPO_RANGES } from '../runtime';
import { ActionId } from '../midi/midi';
import { StationState } from '../core/types';
import { fmtTime, HOT_COLORS, HOT_LETTERS } from './cdjColors';

const sizeLabel = (b: number) => (b < 1 ? `1/${Math.round(1 / b)}` : String(b));

/** Props for a button that must see both press and release (cue preview, hot cues, bend, loop roll). Pointer capture, and Space/Enter for keyboard users. */
function holdProps(rt: GameRuntime, action: ActionId, disabled: boolean) {
    const up = () => { rt.act(action, 0); };
    return {
        onPointerDown: (e: RPointerEvent<HTMLButtonElement>) => { if (disabled) return; try { e.currentTarget.setPointerCapture(e.pointerId); } catch { /* capture is a nicety: the press still counts */ } rt.act(action, 1); },
        onPointerUp: up, onPointerCancel: up, onLostPointerCapture: up,
        onKeyDown: (e: RKeyboardEvent<HTMLButtonElement>) => { if (!disabled && !e.repeat && (e.key === ' ' || e.key === 'Enter')) { e.preventDefault(); e.stopPropagation(); rt.act(action, 1); } },
        onKeyUp: (e: RKeyboardEvent<HTMLButtonElement>) => { if (e.key === ' ' || e.key === 'Enter') { e.stopPropagation(); up(); } },
        onBlur: up,
    };
}

/** The CDJ control groups: transport, hot cues A-H, beat jump, loops, tempo range, quantize, bend. Every control calls rt.act, the same path MIDI and the keyboard use. */
export default function CdjControls({ rt, st, hasBpm, jog }: { rt: GameRuntime; st: StationState; hasBpm: boolean; jog: ReactNode }) {
    const dis = !st.enabled; const noTrack = !st.trackId;
    const act = (a: ActionId, v = 1) => rt.act(a, v);
    const loop = st.loop; const loopLen = loop ? loop.end - loop.start : 0;
    return (
        <div className="gcdj" aria-label="CDJ controls">
            <div className="gtop">{jog}
            <div className="gbtns" role="group" aria-label="transport">
                <button className={`gcue ${st.previewing ? 'on' : ''}`} aria-label="cue" disabled={dis} {...holdProps(rt, 'cue.hold', dis)} title="CUE: playing = back to the cue point · paused elsewhere = set the cue point here · paused at the cue point = hold to listen, release to return">CUE</button>
                <button onClick={() => act('play')} className={st.playing && !st.previewing ? 'on' : ''} aria-label="play or pause" disabled={dis}>{st.playing && !st.previewing ? 'PAUSE' : 'PLAY'}</button>
                <button onClick={() => act('matchTempo')} disabled={dis} title="set this deck's tempo to the master tempo">MATCH TEMPO</button>
                <button onClick={() => act('startOnBeat')} disabled={dis} title="start on the next bar line of the master clock">START ON BEAT</button>
                <button onClick={() => act('align')} disabled={dis} title="nudge the playing deck onto the master beat">ALIGN</button>
                <button className={st.quantize ? 'on' : ''} aria-pressed={st.quantize} onClick={() => act('quantize')} disabled={dis} title={hasBpm ? 'snap new cue points, hot cues and loops to the beat grid' : 'needs a known BPM to snap to a beat grid'} data-testid="quantize">QUANTIZE {st.quantize ? 'ON' : 'OFF'}</button>
            </div></div>
            <div className="ghot" role="group" aria-label="hot cues A to H">
                {HOT_LETTERS.split('').map((L, i) => { const at = st.hotCues[i]; return (
                    <button key={L} className={`gpad ${at !== null ? 'set' : ''}`} style={at !== null ? { borderColor: HOT_COLORS[i], color: HOT_COLORS[i] } : undefined} disabled={dis || noTrack} data-testid={`hot-${L}`}
                        aria-label={`hot cue ${L}, ${at === null ? 'empty: press to store the current position' : 'set at ' + fmtTime(at)}`}
                        onContextMenu={e => { e.preventDefault(); rt.stations.player.clearHotCue(i); }} {...holdProps(rt, `hotcue.${i + 1}` as ActionId, dis || noTrack)}
                        title={at === null ? `${L}: press to store the current position` : `${L}: ${fmtTime(at)} · press to jump (paused: plays while held) · hold SHIFT or right-click to clear`}>
                        <b>{L}</b><small>{at === null ? '·' : fmtTime(at)}</small></button>); })}
                <button className={`gshift ${rt.shift ? 'on' : ''}`} disabled={dis} {...holdProps(rt, 'shift', dis)} title="hold, then press a hot cue pad to clear it">SHIFT</button>
            </div>
            <div className="gbtns" role="group" aria-label="beat jump">
                <label className="gsel">BEAT JUMP <select aria-label="beat jump size" value={rt.cdj.beatJump} onChange={e => { rt.cdj.beatJump = +e.target.value; rt.saveCdjPrefs(); }}>{BEAT_JUMP_SIZES.map(b => <option key={b} value={b}>{sizeLabel(b)}</option>)}</select></label>
                <button onClick={() => act('beatjump.back')} disabled={dis || noTrack} aria-label="beat jump back" data-testid="bj-back" title={hasBpm ? 'jump back by the selected number of beats' : 'needs a known BPM'}>◀ {sizeLabel(rt.cdj.beatJump)}</button>
                <button onClick={() => act('beatjump.fwd')} disabled={dis || noTrack} aria-label="beat jump forward" data-testid="bj-fwd" title={hasBpm ? 'jump forward by the selected number of beats' : 'needs a known BPM'}>{sizeLabel(rt.cdj.beatJump)} ▶</button>
            </div>
            <div className="gbtns" role="group" aria-label="loops">
                <button onClick={() => act('loop.in')} disabled={dis || noTrack} data-testid="loop-in" title="loop in at the playhead">IN</button>
                <button onClick={() => act('loop.out')} disabled={dis || noTrack} data-testid="loop-out" title="loop out at the playhead: starts the loop">OUT</button>
                <button className={loop?.active ? 'on' : ''} onClick={() => act(loop?.active ? 'loop.exit' : 'loop.reloop')} disabled={dis || noTrack || !loop} data-testid="loop-toggle" title="exit the running loop, or re-enter the last one">{loop?.active ? 'EXIT' : 'RELOOP'}</button>
                <button onClick={() => act('loop.half')} disabled={dis || !loop} title="halve the loop">½</button>
                <button onClick={() => act('loop.double')} disabled={dis || !loop} title="double the loop">2×</button>
                <label className="gsel">LOOP <select aria-label="loop size in beats" value={rt.cdj.loopSize} onChange={e => { rt.cdj.loopSize = +e.target.value; rt.saveCdjPrefs(); }}>{LOOP_SIZES.map(b => <option key={b} value={b}>{sizeLabel(b)}</option>)}</select></label>
                <button onClick={() => act('loop.auto')} disabled={dis || noTrack || !hasBpm} data-testid="loop-auto" title={hasBpm ? 'start (or exit) a loop of the selected number of beats' : 'needs a known BPM: use IN and OUT'}>AUTO</button>
                <button disabled={dis || noTrack || !hasBpm} {...holdProps(rt, 'loop.roll', dis || noTrack || !hasBpm)} data-testid="loop-roll" title="loop roll: the loop lasts only while held, then the track continues where it would have been">ROLL</button>
                <small className="gnote" data-testid="loop-status">{loop ? `${loop.active ? 'LOOP' : 'loop (off)'} ${loopLen.toFixed(2)} s${hasBpm ? ' · ' + (loopLen * (rt.library.get(st.trackId ?? '')?.bpm ?? 0) / 60).toFixed(2) + ' beats' : ''}` : st.loopIn !== null ? 'loop in set' : 'no loop'}</small>
            </div>
            <div className="gbtns" role="group" aria-label="tempo and pitch bend">
                <label className="gsel">TEMPO RANGE <select aria-label="tempo range" value={rt.cdj.tempoRange} onChange={e => { rt.cdj.tempoRange = +e.target.value; rt.saveCdjPrefs(); }}>{TEMPO_RANGES.map(r => <option key={r} value={r}>{r >= 0.5 ? 'WIDE ±50%' : `±${Math.round(r * 100)}%`}</option>)}</select></label>
                <button disabled={dis} {...holdProps(rt, 'bend.minus', dis)} data-testid="bend-minus" title="pitch bend: slows the deck while held">BEND −</button>
                <button disabled={dis} {...holdProps(rt, 'bend.plus', dis)} data-testid="bend-plus" title="pitch bend: speeds the deck up while held">BEND +</button>
                <small className="gnote" data-testid="tempo-readout">{`tempo ${((st.rate - 1) * 100 >= 0 ? '+' : '') + ((st.rate - 1) * 100).toFixed(1)}%`}{st.bend !== 0 ? ` · bend ${st.bend > 0 ? '+' : ''}${(st.bend * 100).toFixed(1)}%` : ''}</small>
            </div>
        </div>
    );
}
