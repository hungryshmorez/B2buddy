import { useEffect, useRef, useState } from 'react';
import { Difficulty, PROFILES } from '../ai/buddy';
import { CHALLENGES } from '../core/challenges';
import { GameRuntime } from '../runtime';
import { ACTIONS } from '../midi/midi';
import { CORRECTIONS, CorrectionKind } from '../memory/supervisor';
import { PROJECT_RULES } from '../memory/store';

export type Screen = 'gate' | 'menu' | 'setup' | 'arena' | 'library' | 'training' | 'settings' | 'credits' | 'studio';

export function Gate({ rt, onStart }: { rt: GameRuntime; onStart: () => void }) {
    const [busy, setBusy] = useState(false);
    const unsupported = typeof window !== 'undefined' && !(window.AudioContext || (window as unknown as { webkitAudioContext?: unknown }).webkitAudioContext);
    return (
        <div className="gscreen center"><h1 className="glogo">B2BUDDY</h1><p className="tag">DJ BATTLE ARENA · long live the underground</p>
            {unsupported ? <p className="err" role="alert">This browser has no Web Audio, so the decks cannot play. Use a current Chrome, Edge, Firefox or Safari.</p> : <>
                <button className="primary big" disabled={busy} onClick={async () => { setBusy(true); const ok = await rt.initAudio(); setBusy(false); if (ok) onStart(); }}>{busy ? 'STARTING AUDIO…' : 'CLICK TO ENTER'}</button>
                <p className="gnote">Browsers only allow sound after a click, so this is the start button. Wear headphones or use speakers you trust: start with the volume low.</p></>}
            {rt.audioError && <p className="err" role="alert">{rt.audioError}</p>}
            {rt.memory.loadProblem && <p className="warn">{rt.memory.loadProblem}</p>}
        </div>);
}

export function Menu({ go, rt }: { go: (s: Screen) => void; rt: GameRuntime }) {
    const item = (label: string, sub: string, f: () => void) => <button className="gmenuitem" onClick={f}><b>{label}</b><small>{sub}</small></button>;
    return (
        <div className="gscreen center"><h1 className="glogo">B2BUDDY</h1>
            <nav className="gmenu" aria-label="main menu">
                {item('PLAY', 'quick battle vs Buddy (Intermediate)', () => { rt.options = { ...rt.options, difficulty: 'intermediate', challengeId: 'standard' }; const w = rt.startBattle(); if (w) rt.say(w); else go('arena'); })}
                {item('AI vs AI SHOW', 'watch two AI DJs battle live: five cameras, random video effects', () => { const w = rt.startShow(); if (w) rt.say(w); else go('arena'); })}
                {item('PRACTICE', 'free play with the master metronome, no score', () => { rt.startPractice(); go('arena'); })}
                {item('DJ BATTLE', 'choose difficulty, challenge and rules', () => go('setup'))}
                {item('TRACK LIBRARY', 'demo tracks and your own files', () => go('library'))}
                {item('BUDDY TRAINING', 'memory, lessons, approvals and drift', () => go('training'))}
                {item('SETTINGS', 'MIDI controller, keys, audio', () => go('settings'))}
                {item('CREDITS', 'what is real and what is not', () => go('credits'))}
                {item('STUDIO (legacy)', 'the original two-deck studio and VJ tools', () => go('studio'))}
            </nav>
            {rt.message && <div className="gtoast" role="status">{rt.message}</div>}
        </div>);
}

export function Setup({ rt, go }: { rt: GameRuntime; go: (s: Screen) => void }) {
    const o = rt.options; const set = (p: Partial<typeof o>) => { rt.options = { ...rt.options, ...p }; rt.say('', 0); };
    const ch = CHALLENGES.find(c => c.id === o.challengeId)!;
    const blocked = ch.requires(rt.tracks, o.roundSeconds);
    return (
        <div className="gscreen"><h2>DJ BATTLE</h2><div className="gform">
            <fieldset><legend>Opponent</legend>{(Object.keys(PROFILES) as Difficulty[]).map(d => <label key={d} className="chk"><input type="radio" name="diff" checked={o.difficulty === d} onChange={() => set({ difficulty: d })} /> {PROFILES[d].name}</label>)}
                <p className="gnote">{o.difficulty === 'beginner' ? 'Presses play by hand (55-140 ms off), leaves a small tempo error, never corrects phase, hard-cuts to a random track off the phrase.' : o.difficulty === 'intermediate' ? 'Starts within 30 ms, tempo within 0.4%, corrects phase once, changes track on the phrase with an 8-beat fade and bass cut.' : 'Beat-exact starts, exact tempo, phase checks every 8 bars, 16-beat fades with bass cut and filter sweep, picks tempo- and key-compatible tracks.'}</p></fieldset>
            <fieldset><legend>Challenge</legend>{CHALLENGES.map(c => <label key={c.id} className="chk"><input type="radio" name="ch" checked={o.challengeId === c.id} onChange={() => set({ challengeId: c.id })} /> {c.name}</label>)}<p className="gnote">{ch.description}</p>
                <p className="gnote">Planned, not built yet: Drop for Drop, Instrumental vs Vocal, BPM Extremes, Call and Response, Comeback Round (see the roadmap).</p>
                {blocked && <p className="err" role="alert">{blocked}</p>}</fieldset>
            <fieldset><legend>Rules</legend>
                <label>Round length <select value={o.roundSeconds} onChange={e => set({ roundSeconds: +e.target.value })}>{[30, 60, 90, 120].map(v => <option key={v} value={v}>{v} s</option>)}</select></label>
                <label>Best of <select value={o.bestOf} onChange={e => set({ bestOf: +e.target.value })}>{[1, 3, 5].map(v => <option key={v} value={v}>{v}</option>)}</select></label>
                <label>Master tempo <input type="number" min={100} max={140} value={o.masterBpm} onChange={e => set({ masterBpm: Math.max(100, Math.min(140, +e.target.value || 124)) })} /> BPM</label>
                <label className="chk"><input type="checkbox" checked={o.clickDuringRound} onChange={e => set({ clickDuringRound: e.target.checked })} /> metronome click during the round (count-in always clicks)</label></fieldset>
        </div>
            <div className="gactions"><button onClick={() => go('menu')}>BACK</button><button className="primary" disabled={!!blocked} onClick={() => { const w = rt.startBattle(); if (w) rt.say(w); else go('arena'); }}>ENTER THE ARENA</button></div>
            {rt.message && <div className="gtoast" role="status">{rt.message}</div>}
        </div>);
}

export function Library({ rt, go }: { rt: GameRuntime; go: (s: Screen) => void }) {
    const file = useRef<HTMLInputElement>(null); const [note, setNote] = useState('');
    return (
        <div className="gscreen"><h2>TRACK LIBRARY</h2>
            <p className="gnote">Bundled demo tracks are original, generated in your browser (no copyrighted audio is shipped). Add your own files: they stay on your device and are never uploaded.</p>
            <div className="gactions"><button onClick={() => file.current?.click()}>ADD AUDIO FILES</button><input ref={file} type="file" accept="audio/*" multiple hidden onChange={async e => { for (const f of Array.from(e.target.files ?? [])) { const r = await rt.addFile(f); setNote(typeof r === 'string' ? r : `Added "${r.title}". Set its BPM so it can be scored.`); } e.target.value = ''; }} /></div>
            {note && <p className="gnote" role="status">{note}</p>}
            {rt.tracks.length === 0 && <p>The library is empty.</p>}
            <table className="gtable"><thead><tr><th>Title</th><th>BPM</th><th>Origin</th><th>Key</th><th>Length</th><th /></tr></thead><tbody>
                {rt.tracks.map(t => <tr key={t.id}><td>{t.title}<small> {t.source === 'bundled' ? '(demo)' : ''}</small></td>
                    <td>{t.source === 'user' ? <input type="number" step="0.01" min={40} max={240} defaultValue={t.bpm ?? ''} placeholder="BPM" aria-label={`BPM of ${t.title}`} onBlur={e => { const v = parseFloat(e.target.value); if (v) rt.setBpm(t.id, v, 'manual', t.firstBeatSec); }} /> : t.bpm}</td>
                    <td><span className={`gbadge o-${t.bpmOrigin}`}>{t.bpmOrigin}</span></td><td>{t.key ?? '?'} <small>{t.keyOrigin}</small></td><td>{t.loopSec ? `${t.loopSec.toFixed(1)} s loop` : `${Math.round(t.durationSec)} s`}</td>
                    <td>{t.source === 'user' && <button onClick={() => setNote(rt.estimate(t.id))}>ESTIMATE BPM</button>}{rt.serviceState === 'connected' && <button onClick={async () => setNote(await rt.analyzeWithService(t.id))}>AI DJ ANALYSE</button>}{rt.analysis.get(t.id) && <><small data-testid={`measured-${t.id}`}> AI DJ analysed {rt.analysis.get(t.id)!.bpmBeatTrack.toFixed(1)} BPM ({rt.analysis.get(t.id)!.engine}){rt.analysis.get(t.id)!.local ? ` · key ${rt.analysis.get(t.id)!.local!.key} (estimate) · ${rt.analysis.get(t.id)!.local!.choruses.length} repeated section(s)` : ''}</small> <button onClick={() => setNote(rt.useServiceBpm(t.id))}>USE AI DJ BPM</button></>}</td></tr>)}</tbody></table>
            <div className="gactions"><button onClick={() => go('menu')}>BACK</button></div></div>);
}

export function Training({ rt, go }: { rt: GameRuntime; go: (s: Screen) => void }) {
    const m = rt.memory; const s = m.state; const [mission, setMission] = useState(s.mission); const [, bump] = useState(0); const refresh = () => bump(n => n + 1);
    return (
        <div className="gscreen"><h2>BUDDY TRAINING · SUPERVISOR</h2>
            {m.loadProblem && <p className="warn">{m.loadProblem}</p>}
            <section><h3>Mission</h3><textarea value={mission} onChange={e => setMission(e.target.value)} aria-label="mission" /><button onClick={() => { m.setMission(mission); refresh(); }}>SAVE MISSION</button></section>
            <section><h3>Project rules <small>(fixed, read-only)</small></h3><ul>{PROJECT_RULES.map(r => <li key={r.id}>{r.text}</li>)}</ul></section>
            <section><h3>Approval queue</h3>{m.pending.length === 0 && <p className="gnote">Nothing waiting. After a battle Buddy may propose a lesson here; nothing is applied until you approve it.</p>}
                {m.pending.map(p => <div key={p.id} className="gitem"><b>{p.label}</b> <small>confidence {(p.confidence * 100).toFixed(0)}% · applies: {p.appliesWhen}</small><p>{p.reason}</p><ul>{p.evidence.map((e, i) => <li key={i}>{e}</li>)}</ul>
                    <button className="primary" onClick={() => { m.approve(p.id); refresh(); }}>APPROVE</button><button onClick={() => { m.reject(p.id); refresh(); }}>REJECT</button></div>)}</section>
            <section><h3>Preferences Buddy uses</h3>{s.prefs.length === 0 && <p className="gnote">None yet.</p>}
                {s.prefs.map(p => <div key={p.id} className="gitem"><label className="chk"><input type="checkbox" checked={p.enabled} onChange={e => { m.editPref(p.id, { enabled: e.target.checked }); refresh(); }} /> {p.label}</label> <small>{p.origin === 'learned' ? 'learned & approved' : 'set by you'}</small><button onClick={() => { m.deletePref(p.id); refresh(); }}>DELETE</button></div>)}
                <div className="gactions">{(Object.keys(CORRECTIONS) as CorrectionKind[]).map(k => <button key={k} onClick={() => { m.addPref(CORRECTIONS[k].key, CORRECTIONS[k].value, CORRECTIONS[k].label); refresh(); }}>+ {CORRECTIONS[k].label}</button>)}</div></section>
            <section><h3>Drift alerts</h3>{s.drift.filter(d => !d.acknowledged).length === 0 && <p className="gnote">No open alerts.</p>}
                {s.drift.filter(d => !d.acknowledged).map(d => <div key={d.id} className="gitem warn"><b>{d.kind}</b> {d.message}<button onClick={() => { m.acknowledgeDrift(d.id); refresh(); }}>ACKNOWLEDGE</button></div>)}</section>
            <section><h3>Growth log <small>({s.stats.battles} matches: {s.stats.wins} won, {s.stats.losses} lost, {s.stats.draws} drawn)</small></h3>
                <p className="gnote">Correct a decision: Buddy will propose a lesson for you to approve, never apply it silently.</p>
                <ul className="glog">{s.experiences.slice(-25).reverse().map(e => <li key={e.id}><b>{e.decision}</b> — {e.evidence} <em>[{e.action}]</em> <small>round {e.round}, {e.difficulty}, result {e.outcome.player.toFixed(0)}–{e.outcome.buddy.toFixed(0)} ({e.outcome.winner})</small>
                    {e.correction && <span className="gbadge"> corrected: {e.correction}</span>}
                    <select aria-label="correct this decision" value="" onChange={ev => { if (ev.target.value) { rt.supervisor.correct(e.id, ev.target.value as CorrectionKind); refresh(); } }}><option value="">correct…</option>{(Object.keys(CORRECTIONS) as CorrectionKind[]).map(k => <option key={k} value={k}>{CORRECTIONS[k].label}</option>)}</select>
                    <button onClick={() => { m.deleteExperience(e.id); refresh(); }}>forget</button></li>)}</ul></section>
            <section><h3>Rollback</h3>{s.snapshots.length === 0 && <p className="gnote">No snapshots yet (one is taken before every change to preferences).</p>}
                <ul>{s.snapshots.slice(-6).reverse().map(x => <li key={x.id}>{new Date(x.time).toLocaleTimeString()} · {x.label} <button onClick={() => { m.rollback(x.id); refresh(); }}>RESTORE</button></li>)}</ul>
                <button onClick={() => { if (window.confirm('Erase all of Buddy\'s memory?')) { m.resetAll(); refresh(); } }}>RESET ALL MEMORY</button> <button onClick={() => navigator.clipboard?.writeText(m.exportJson())}>COPY MEMORY AS JSON</button></section>
            <div className="gactions"><button onClick={() => go('menu')}>BACK</button></div></div>);
}

export function Settings({ rt, go }: { rt: GameRuntime; go: (s: Screen) => void }) {
    const m = rt.midi; const [mapJson, setMapJson] = useState(''); const [, bump] = useState(0); const [url, setUrl] = useState(rt.serviceUrl); const bs = rt.brainStatus();
    // live input monitor: repaint when the MIDI service reports a message or a device change
    useEffect(() => m.subscribe(() => bump(n => n + 1)), [m]);
    return (
        <div className="gscreen"><h2>SETTINGS</h2>
            <section><h3>MIDI controller</h3>
                <p role="status">{m.statusText}</p>
                {m.status !== 'unsupported' && m.status !== 'insecure' && <button className="primary" onClick={() => m.connect()} disabled={m.status === 'requesting'}>{m.status === 'granted' ? 'RESCAN' : 'CONNECT MIDI'}</button>}
                <ul>{m.devices.map(d => <li key={d.id}>{d.name} — {d.connected ? 'connected' : 'disconnected'}</li>)}</ul>
                <p className="gnote" data-testid="midi-last">Last message: {m.last ? `${m.last.type} ch${m.last.channel + 1} #${m.last.number} = ${m.last.raw} (${m.last.device})` : 'none yet'} · {m.messageCount} received. Hardware testing status: none in this build; every mapping is made with LEARN. Generic MIDI mapping is not native CDJ support (no HID, no Pro DJ Link).</p>
                <pre className="gnote" aria-label="midi input monitor" data-testid="midi-monitor" style={{ maxHeight: 110, overflow: 'auto' }}>{m.recent.length ? m.recent.map(x => `${x.device} · ${x.type} ch${x.channel + 1} #${x.number} = ${x.raw}`).join('\n') : 'input monitor: move or press a control on your controller'}</pre>
                <div className="gactions" role="group" aria-label="mapping profile controls">
                    <label className="gsel">PROFILE <select aria-label="mapping profile" value={m.activeProfile} onChange={e => { m.switchProfile(e.target.value); bump(n => n + 1); }}>{m.profileNames.map(n => <option key={n}>{n}</option>)}</select></label>
                    <button onClick={() => { const n = window.prompt('Name for the new profile (it starts empty)'); if (n && !m.createProfile(n)) rt.say('That name is empty or already used.'); bump(n2 => n2 + 1); }}>NEW PROFILE</button>
                    <button onClick={() => { if (window.confirm(`Delete the profile "${m.activeProfile}"?`) && !m.deleteProfile(m.activeProfile)) rt.say('The last profile cannot be deleted.'); bump(n => n + 1); }}>DELETE PROFILE</button>
                </div>
                <table className="gtable"><thead><tr><th>Action</th><th>Control</th><th>Options</th><th /></tr></thead><tbody>{ACTIONS.map(a => { const b = m.bindingFor(a.id); return (
                    <tr key={a.id}><td>{a.label} <small>({a.kind})</small></td><td>{m.learning === a.id ? <b>move or press a control…</b> : b ? `${b.type === 'cc' ? 'CC' : 'Note'} ${b.number} · ch ${b.channel + 1}${b.device ? ' · ' + b.device : ''}` : 'not mapped'}</td>
                        <td>{b && (a.kind === 'relative' || a.kind === 'continuous') && <>
                            {a.kind === 'relative' && <select aria-label={`${a.label} encoder format`} value={b.encoder ?? 'twos'} onChange={e => { m.updateBinding(a.id, { encoder: e.target.value as 'twos' | 'offset' | 'sign' }); bump(n => n + 1); }}><option value="twos">two's complement (1 = +, 127 = −)</option><option value="offset">offset 64</option><option value="sign">sign + magnitude</option></select>}
                            <label className="chk"><input type="checkbox" checked={!!b.invert} onChange={e => { m.updateBinding(a.id, { invert: e.target.checked }); bump(n => n + 1); }} /> invert</label>
                            {a.kind === 'relative' && <label className="gsel">scale <input type="number" min={0.1} max={50} step={0.1} style={{ width: 56 }} value={b.scale ?? 1} onChange={e => { const v = +e.target.value; if (v > 0) { m.updateBinding(a.id, { scale: v }); bump(n => n + 1); } }} aria-label={`${a.label} scale`} /></label>}</>}</td>
                        <td>{m.learning === a.id ? <button onClick={() => m.cancelLearn()}>CANCEL</button> : <><button onClick={() => m.startLearn(a.id)} disabled={!m.usable}>LEARN</button>{b && <button onClick={() => m.removeBinding(a.id)}>CLEAR</button>}</>}</td></tr>); })}</tbody></table>
                <div className="gactions"><button onClick={() => setMapJson(m.exportMapping())}>EXPORT MAPPING</button><button onClick={() => { if (!m.importMapping(mapJson)) rt.say('That mapping is not valid.'); bump(n => n + 1); }}>IMPORT FROM BOX</button><button onClick={() => { if (window.confirm('Clear every mapping in this profile?')) { m.clearBindings(); bump(n => n + 1); } }}>CLEAR PROFILE</button></div>
                <textarea value={mapJson} onChange={e => setMapJson(e.target.value)} aria-label="mapping json" placeholder="paste a mapping here to import" /></section>
            <section aria-label="jog wheel settings"><h3>Jog wheel</h3>
                <label className="chk"><input type="radio" name="jogmode" checked={rt.cdj.jog.mode === 'cdj'} onChange={() => { rt.cdj.jog.mode = 'cdj'; rt.saveCdjPrefs(); bump(n => n + 1); }} /> CDJ: pitch bend while playing, nudge while paused</label>
                <label className="chk"><input type="radio" name="jogmode" checked={rt.cdj.jog.mode === 'vinyl'} onChange={() => { rt.cdj.jog.mode = 'vinyl'; rt.saveCdjPrefs(); bump(n => n + 1); }} /> Vinyl: touching holds the sound, moving scrubs it silently (no audible scratch: the audio engine cannot do that)</label>
                <label className="gsel">Sensitivity <input type="range" min={0.25} max={3} step={0.05} value={rt.cdj.jog.sensitivity} onChange={e => { rt.cdj.jog.sensitivity = +e.target.value; rt.saveCdjPrefs(); bump(n => n + 1); }} aria-label="jog sensitivity" /> {rt.cdj.jog.sensitivity.toFixed(2)}×</label>
                <label className="gsel">Curve <select aria-label="jog curve" value={rt.cdj.jog.curve} onChange={e => { rt.cdj.jog.curve = e.target.value as 'linear' | 'accel'; rt.saveCdjPrefs(); bump(n => n + 1); }}><option value="linear">linear</option><option value="accel">accelerating (finer when slow)</option></select></label>
                <label className="gsel">Max bend <select aria-label="jog max bend" value={rt.cdj.jog.maxBend} onChange={e => { rt.cdj.jog.maxBend = +e.target.value; rt.saveCdjPrefs(); bump(n => n + 1); }}>{[0.06, 0.1, 0.2, 0.35].map(v => <option key={v} value={v}>±{Math.round(v * 100)}%</option>)}</select></label>
                <label className="gsel">MIDI jog resolution (ticks per full turn) <input type="number" min={16} max={4096} step={16} style={{ width: 70 }} value={rt.cdj.ticksPerTurn} onChange={e => { const v = +e.target.value; if (v >= 16 && v <= 4096) { rt.cdj.ticksPerTurn = v; rt.saveCdjPrefs(); bump(n => n + 1); } }} aria-label="midi jog ticks per turn" /></label>
                <p className="gnote">Calibrate with your own controller: if the jog feels too weak or too strong, change the ticks per turn or the per-binding scale above. Not tested on hardware.</p></section>
            <section><h3>Keyboard & mouse (always available)</h3><p className="gnote">Space play/pause · C cue (hold) · Q-I hot cues A-H (Shift+pad clears) · , . beat jump · L loop · X quantize · - = bend · M match tempo · B start on beat · A align · Enter ready/next round · ↑/↓ volume · ←/→ tempo · 1/2/3 kill or restore low/mid/high · [ ] filter, \ reset filter.</p></section>
            <section aria-label="DJ brain and video engine"><h3>DJ brain (AI DJ)</h3>
                <label className="chk"><input type="radio" name="brain" checked={rt.brainPref === 'aidj'} onChange={() => { rt.setBrainPref('aidj'); bump(n => n + 1); }} /> AI DJ decides track choice and transition length (Intermediate / Expert)</label>
                <label className="chk"><input type="radio" name="brain" checked={rt.brainPref === 'rules'} onChange={() => { rt.setBrainPref('rules'); bump(n => n + 1); }} /> Buddy's built-in rules only</label>
                <p role="status" data-testid="brain-status">Now using: <b>{bs.mode === 'service' ? 'AI DJ service (the fork\'s own Python)' : bs.mode === 'ts-port' ? 'AI DJ logic, in-browser port' : "Buddy's built-in rules"}</b> · {bs.detail}{bs.mode !== 'rules' ? ` · ${bs.fallbackCalls} fallback calls` : ''}</p>
                <p className="gnote">Optional AI DJ service: run <code>python services/aidj/server.py</code> on this computer, then connect. It measures real BPM/beats with librosa and answers the same decisions from the fork's Python. No OpenAI key is used or sent anywhere. A web-hosted page may ask your browser for permission to reach your own computer.</p>
                <div className="gactions"><input value={url} onChange={e => setUrl(e.target.value)} aria-label="AI DJ service URL" /><button className="primary" disabled={rt.serviceState === 'connecting'} onClick={async () => { await rt.connectService(url); bump(n => n + 1); }}>{rt.serviceState === 'connecting' ? 'CONNECTING…' : 'CONNECT SERVICE'}</button><button onClick={() => { rt.disconnectService(); bump(n => n + 1); }} disabled={rt.serviceState !== 'connected'}>DISCONNECT</button></div>
                <p role="status" data-testid="service-status">Service: {rt.serviceState}{rt.serviceError ? ` — ${rt.serviceError}` : ''}</p>
                <h3>Video engine (BENDR)</h3>
                <label className="chk"><input type="radio" name="video" checked={rt.videoPref === 'bendr'} onChange={() => { rt.videoPref = 'bendr'; rt.savePrefs(); bump(n => n + 1); }} /> BENDR (the real video-mixing engine)</label>
                <label className="chk"><input type="radio" name="video" checked={rt.videoPref === 'canvas'} onChange={() => { rt.videoPref = 'canvas'; rt.savePrefs(); bump(n => n + 1); }} /> Canvas effects (lightweight fallback)</label>
                <label className="chk"><input type="checkbox" checked={rt.allowFlashing} onChange={e => { rt.allowFlashing = e.target.checked; rt.savePrefs(); bump(n => n + 1); }} /> Include strobe / flicker presets in Random Effect (rapid full-frame flashing: not safe for people with photosensitive epilepsy; also switchable in the arena)</label>
                <p className="gnote">Video engine and flashing changes apply the next time you enter the arena.</p></section>
            <section><h3>Audio</h3><p className="gnote">Sample rate {rt.ctx?.sampleRate ?? '-'} Hz · reported output latency {rt.ctx ? ((rt.ctx.outputLatency ?? rt.ctx.baseLatency) * 1000).toFixed(0) : '-'} ms. Browsers cannot play a separate headphone cue, so there is no PFL: Buddy's metronome and count-in clicks play through the same output.</p>
                <label>Master volume <input type="range" min={0} max={1} step={0.01} defaultValue={0.9} onChange={e => rt.act('master.volume', +e.target.value)} aria-label="master volume" /></label></section>
            <div className="gactions"><button onClick={() => go('menu')}>BACK</button></div></div>);
}

export function Credits({ go }: { go: (s: Screen) => void }) {
    return (
        <div className="gscreen"><h2>CREDITS & HONEST STATUS</h2>
            <p>B2Buddy by 12matt3r. Underground DJ battle arena. Long live the underground.</p>
            <ul><li>Demo music: generated in your browser from code, original, no samples.</li><li>Opponent: Buddy executes every action through a validated command port. Its track and transition choices come from the AI DJ decision logic (an in-browser port, or the fork's own Python if you connect the local service) or, if you switch that off, Buddy's built-in rules. No language model, no OpenAI calls.</li><li>Video: the real BENDR engine (MIT, Steve Blythe), with canvas effects from the supplied Trippy package as the fallback. AI DJ logic: AI DJ Mixing System (MIT, Kuchi Chaitanya Krishna Deepak).</li>
                <li>Crowd and lights in the venue are decoration that react to the audio; there is no crowd vote or simulated spectator score.</li><li>Scores are measured from what was played (see the results screen).</li>
                <li>Not in this build: online play, Dual Deck Showdown, stem separation, key detection, recording, career/XP.</li></ul>
            <div className="gactions"><button onClick={() => go('menu')}>BACK</button></div></div>);
}
