import { BuddyAI, Difficulty } from './ai/buddy';
import { DEMO_SPECS, DEMO_TRACKS } from './audio/catalog';
import { synthPhrase } from './audio/synth';
import { MasterBus, WebAudioBackend } from './audio/webBackend';
import { BattleSession, Phase } from './core/battle';
import { challengeById } from './core/challenges';
import { MasterClock, phaseDiff } from './core/clock';
import { CommandPort } from './core/commands';
import { estimateBpm } from './core/analysis';
import { Station } from './core/station';
import { bestRate } from './core/tempo';
import { EqBand, GameTrack, MetaOrigin, StationId } from './core/types';
import { MemoryStore } from './memory/store';
import { Supervisor } from './memory/supervisor';
import { ActionId, browserMidiDeps, MidiService } from './midi/midi';

export type Mode = 'menu' | 'battle' | 'practice' | 'show';
export interface GameOptions { showDj1: Difficulty; showDj2: Difficulty; showSeconds: number; difficulty: Difficulty; challengeId: string; roundSeconds: number; bestOf: number; masterBpm: number; clickDuringRound: boolean }
export const DEFAULT_OPTIONS: GameOptions = { showDj1: 'intermediate', showDj2: 'intermediate', showSeconds: 60, difficulty: 'intermediate', challengeId: 'standard', roundSeconds: 90, bestOf: 3, masterBpm: 124, clickDuringRound: false };

/** rate <-> tempo fader (0..1, centre = normal speed, +-16%) */
export const rateToFader = (r: number) => (r - 1) / 0.32 + 0.5;
export const faderToRate = (f: number) => 1 + (f - 0.5) * 0.32;

/**
 * Everything the screens talk to. Owns the audio context, both stations, the battle session, Buddy, memory and MIDI. One instance per page.
 * All player input (mouse, keyboard, MIDI) ends in act(), which calls the same Station methods the AI's validated port calls.
 */
export class GameRuntime {
    ctx: AudioContext | null = null;
    bus: MasterBus | null = null;
    readonly buffers = new Map<string, AudioBuffer>();
    readonly library = new Map<string, GameTrack>();
    readonly pcm = new Map<string, Float32Array>();
    stations!: Record<StationId, Station>;
    backends!: Record<StationId, WebAudioBackend>;
    session: BattleSession | null = null;
    ai: BuddyAI | null = null;
    /** AI vs AI show only: the second AI DJ, driving the station that a human drives in a battle. */
    ai2: BuddyAI | null = null;
    port2: CommandPort | null = null;
    port: CommandPort | null = null;
    practiceClock: MasterClock | null = null;
    mode: Mode = 'menu';
    options: GameOptions = { ...DEFAULT_OPTIONS };
    message = ''; messageUntil = 0;
    audioError: string | null = null;
    matchId = '';
    readonly memory: MemoryStore; readonly midi: MidiService; readonly supervisor: Supervisor;
    private timer: ReturnType<typeof setInterval> | null = null;
    private nextClick = Number.NaN; private clickGain: GainNode | null = null;
    private decisionMark = 0;
    private listeners: Array<() => void> = [];
    private scratch = new Float32Array(512);
    clickInPractice = false;

    constructor(storage: Storage | { getItem(k: string): string | null; setItem(k: string, v: string): void; removeItem(k: string): void }) {
        this.memory = new MemoryStore(storage); this.supervisor = new Supervisor(this.memory);
        this.midi = new MidiService(browserMidiDeps(storage));
        this.midi.onAction((a, v) => this.act(a, v));
        for (const t of DEMO_TRACKS) this.library.set(t.id, t);
    }

    subscribe(fn: () => void) { this.listeners.push(fn); return () => { this.listeners = this.listeners.filter(l => l !== fn); }; }
    private emit() { for (const l of this.listeners) l(); }
    say(text: string, seconds = 5) { this.message = text; this.messageUntil = performance.now() + seconds * 1000; this.emit(); }
    get ready() { return !!this.ctx && !this.audioError; }
    get now() { return this.ctx ? this.ctx.currentTime : 0; }

    // ---------------------------------------------------------------- audio start (needs a user gesture)
    async initAudio(): Promise<boolean> {
        if (this.ctx) { await this.ctx.resume(); return !this.audioError; }
        try {
            const AC = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
            if (!AC) { this.audioError = 'This browser has no Web Audio support, so the decks cannot play. Use a current Chrome, Edge, Firefox or Safari.'; this.emit(); return false; }
            this.ctx = new AC({ latencyHint: 'interactive' });
            await this.ctx.resume();
            this.bus = new MasterBus(this.ctx);
            this.clickGain = this.ctx.createGain(); this.clickGain.gain.value = 0.5; this.clickGain.connect(this.ctx.destination);
            for (const spec of DEMO_SPECS) {
                const data = synthPhrase(spec, this.ctx.sampleRate); this.pcm.set(spec.id, data);
                const b = this.ctx.createBuffer(1, data.length, this.ctx.sampleRate); b.getChannelData(0).set(data); this.buffers.set(spec.id, b);
            }
            this.backends = { player: new WebAudioBackend(this.ctx, this.bus, this.buffers), buddy: new WebAudioBackend(this.ctx, this.bus, this.buffers) };
            this.stations = { player: new Station('player', this.backends.player), buddy: new Station('buddy', this.backends.buddy) };
            this.timer = setInterval(() => this.update(), 20);
            this.emit(); return true;
        } catch (e) {
            this.audioError = 'Audio could not start: ' + (e as Error).message; this.emit(); return false;
        }
    }

    // ---------------------------------------------------------------- library
    get tracks() { return [...this.library.values()]; }
    private origin(t: GameTrack, bpm: number | null, origin: MetaOrigin, first: number): GameTrack { return { ...t, bpm, bpmOrigin: origin, firstBeatSec: first }; }

    async addFile(file: File): Promise<GameTrack | string> {
        if (!this.ctx) return 'Start the audio first.';
        if (file.size > 80 * 1024 * 1024) return 'That file is larger than 80 MB.';
        try {
            const buf = await this.ctx.decodeAudioData(await file.arrayBuffer());
            if (buf.duration > 20 * 60) return 'That track is longer than 20 minutes.';
            const id = 'user-' + file.name.replace(/[^a-z0-9]+/gi, '-').toLowerCase() + '-' + Math.round(buf.duration);
            const mono = new Float32Array(buf.length); for (let c = 0; c < buf.numberOfChannels; c++) { const d = buf.getChannelData(c); for (let i = 0; i < buf.length; i++) mono[i] += d[i] / buf.numberOfChannels; }
            this.buffers.set(id, buf); this.pcm.set(id, mono);
            const t: GameTrack = { id, title: file.name.replace(/\.[^.]+$/, ''), artist: 'your file', durationSec: buf.duration, bpm: null, bpmOrigin: 'unavailable', firstBeatSec: 0, key: null, keyOrigin: 'unavailable', source: 'user' };
            this.library.set(id, t); this.emit(); return t;
        } catch (e) { return `"${file.name}" could not be decoded by this browser (${(e as Error).message || 'unsupported format'}). MP3, WAV, OGG, AAC/M4A usually work.`; }
    }
    setBpm(id: string, bpm: number, origin: MetaOrigin, firstBeatSec = 0) {
        const t = this.library.get(id); if (!t || !(bpm >= 40 && bpm <= 240)) return false;
        this.library.set(id, this.origin(t, bpm, origin, Math.max(0, firstBeatSec))); this.emit(); return true;
    }
    estimate(id: string): string {
        const pcm = this.pcm.get(id); const t = this.library.get(id); if (!pcm || !t || !this.ctx) return 'Track not found.';
        const e = estimateBpm(pcm, this.ctx.sampleRate); if (!e) return 'No steady tempo found: enter the BPM by hand.';
        this.setBpm(id, e.bpm, 'estimated', e.firstBeatSec); return `Estimated ${e.bpm.toFixed(1)} BPM (confidence ${(e.confidence * 100).toFixed(0)}%). This is a guess: correct it by hand if it sounds off.`;
    }

    // ---------------------------------------------------------------- modes
    private freshStations() { this.stations.player.reset(); this.stations.buddy.reset(); }

    startPractice(): boolean {
        if (!this.ready) return false;
        this.leave(); this.mode = 'practice'; this.freshStations(); this.stations.buddy.enabled = false;
        this.practiceClock = new MasterClock(this.options.masterBpm, 4, this.now + 0.2); this.emit(); return true;
    }

    startBattle(): string | null {
        if (!this.ready) return 'Start the audio first.';
        this.leave(); this.freshStations();
        const ch = challengeById(this.options.challengeId); if (!ch) return 'Unknown challenge.';
        const bundled = DEMO_TRACKS;
        const session = new BattleSession({ time: { now: () => this.now }, stations: this.stations, library: this.library, events: (id, fn) => this.stations[id].onEvent(fn),
            config: { masterBpm: this.options.masterBpm, roundSeconds: this.options.roundSeconds, bestOf: this.options.bestOf }, challenge: ch });
        const why = session.canStart(); if (why) return why;
        this.session = session; this.mode = 'battle'; this.matchId = 'm' + Date.now().toString(36);
        this.port = new CommandPort('buddy', this.stations.buddy, this.library, () => this.now);
        this.ai = new BuddyAI(this.port, session, bundled, this.options.difficulty, () => this.now, () => this.memory.buddyPrefs(), (Date.now() % 100000) + 1, () => this.stations.player.state().trackId);
        this.decisionMark = 0; this.nextClick = Number.NaN;
        session.onPhase(p => this.onPhase(p));
        this.ai.prepare(); this.emit(); return null;
    }

    /**
     * AI vs AI exhibition. Same stations, session, scorer and validated command ports as a battle; each AI acts only on its own station and no human can touch either deck.
     * Seat names stay 'player' (AI DJ 1, left) and 'buddy' (AI DJ 2, right) inside the engine; the UI relabels them.
     */
    startShow(): string | null {
        if (!this.ready) return 'Start the audio first.';
        this.leave(); this.freshStations();
        const ch = challengeById('standard'); if (!ch) return 'Unknown challenge.';
        const session = new BattleSession({ time: { now: () => this.now }, stations: this.stations, library: this.library, events: (id, fn) => this.stations[id].onEvent(fn),
            config: { masterBpm: this.options.masterBpm, roundSeconds: this.options.showSeconds, bestOf: 1 }, challenge: ch });
        const why = session.canStart(); if (why) return why;
        this.session = session; this.mode = 'show'; this.matchId = 's' + Date.now().toString(36);
        this.port = new CommandPort('buddy', this.stations.buddy, this.library, () => this.now);
        this.port2 = new CommandPort('player', this.stations.player, this.library, () => this.now);
        const seed = (Date.now() % 100000) + 1;
        this.ai = new BuddyAI(this.port, session, DEMO_TRACKS, this.options.showDj2, () => this.now, () => ({}), seed, () => this.stations.player.state().trackId);
        this.ai2 = new BuddyAI(this.port2, session, DEMO_TRACKS, this.options.showDj1, () => this.now, () => ({}), seed + 7919, () => this.stations.buddy.state().trackId);
        this.decisionMark = 0; this.nextClick = Number.NaN;
        session.onPhase(() => this.emit());
        this.ai2.prepare(); this.ai.prepare();
        const bad = session.startRound(); if (bad) return bad;
        this.emit(); return null;
    }

    /** The player says READY (first round) or NEXT ROUND. */
    readyUp(): string | null {
        const s = this.session; if (!s || !this.ai) return 'No battle is running.';
        if (s.phase === 'matchEnd') return 'The match is over: press Rematch.';
        if (s.phase !== 'idle' && s.phase !== 'roundEnd') return 'A round is already running.';
        if (!this.stations.player.state().trackId) return 'Load a track on your deck first (Tracks panel).';
        this.ai.prepare(); const why = s.startRound(); if (why) return why;
        this.decisionMark = this.ai.decisions.length; this.nextClick = Number.NaN; this.emit(); return null;
    }

    rematch() {
        if (!this.session) return; const keep = this.options; const wasShow = this.mode === 'show'; this.leave(); this.options = keep;
        const why = wasShow ? this.startShow() : this.startBattle(); if (why) this.say(why);
    }

    /** Stops the frame loop (tests / page teardown). */
    dispose() { if (this.timer) clearInterval(this.timer); this.timer = null; void this.ctx?.close(); }

    leave() {
        this.session = null; this.ai = null; this.ai2 = null; this.port2 = null; this.port = null; this.practiceClock = null; this.mode = 'menu';
        if (this.stations) { this.stations.player.pause(); this.stations.buddy.pause(); }
        this.emit();
    }

    private onPhase(p: Phase) {
        const s = this.session; const ai = this.ai; if (!s || !ai) return;
        if (this.mode === 'show') { this.emit(); return; }                       // an exhibition teaches Buddy nothing: no human played
        if (p === 'roundEnd' || p === 'matchEnd') {
            const result = s.results[s.results.length - 1];
            this.supervisor.analyze({ matchId: this.matchId, difficulty: this.options.difficulty, decisions: ai.decisions.slice(this.decisionMark), result, refusedCommands: this.port?.refused ?? 0, activePrefsApplied: [] });
            if (p === 'matchEnd') this.memory.recordMatch(s.matchWinner === 'player' ? 'win' : s.matchWinner === 'buddy' ? 'loss' : 'draw');
        }
        this.emit();
    }

    // ---------------------------------------------------------------- the frame loop
    private update() {
        if (!this.ctx) return;
        this.session?.tick(); this.ai?.tick(); this.ai2?.tick();
        this.scheduleClicks();
        if (this.message && performance.now() > this.messageUntil) { this.message = ''; }
    }

    private scheduleClicks() {
        const clock = this.session?.clock ?? this.practiceClock; if (!clock || !this.ctx || !this.clickGain) return;
        const s = this.session; const live = s ? s.phase === 'live' : this.clickInPractice;
        const wantCount = s ? s.phase === 'countin' : false;
        if (!wantCount && !(live && (s ? this.options.clickDuringRound : this.clickInPractice))) { this.nextClick = Number.NaN; return; }
        const now = this.ctx.currentTime;
        if (Number.isNaN(this.nextClick)) this.nextClick = Math.max(Math.ceil(clock.beatAt(now)), s ? -(s.countInBeats) : 0);
        while (clock.timeOfBeat(this.nextClick) < now + 0.12) {
            const t = clock.timeOfBeat(this.nextClick);
            if (t >= now - 0.005) this.click(Math.max(t, now), ((this.nextClick % 4) + 4) % 4 === 0);
            this.nextClick++;
        }
    }
    private click(at: number, accent: boolean) {
        const o = this.ctx!.createOscillator(), g = this.ctx!.createGain(); o.frequency.value = accent ? 1500 : 1000; o.type = 'square';
        g.gain.setValueAtTime(0.0001, at); g.gain.exponentialRampToValueAtTime(accent ? 0.35 : 0.22, at + 0.002); g.gain.exponentialRampToValueAtTime(0.0001, at + 0.05);
        o.connect(g); g.connect(this.clickGain!); o.start(at); o.stop(at + 0.06);
    }

    // ---------------------------------------------------------------- player input (mouse, keyboard and MIDI all end here)
    private get clock() { return this.session?.clock ?? this.practiceClock; }

    act(action: ActionId, value = 1): string | null {
        if (!this.ready || this.mode === 'menu' || this.mode === 'show') return null;     // nobody controls a deck in an AI show
        const st = this.stations.player; const s = st.state();
        const need = (cond: boolean, msg: string) => { if (!cond) { this.say(msg); return false; } return true; };
        switch (action) {
            case 'play': if (!need(!!s.trackId, 'Load a track first.')) return null; if (s.playing) st.pause(); else st.play(); break;
            case 'cue': if (!need(!!s.trackId, 'Load a track first.')) return null; st.cue(); break;
            case 'volume': st.setVolume(value); break;
            case 'eq.low': case 'eq.mid': case 'eq.high': st.setEq(action.slice(3) as EqBand, value); break;
            case 'filter': st.setFilter(value); break;
            case 'tempo': st.setRate(faderToRate(value)); break;
            case 'master.volume': if (this.bus) this.bus.master.gain.value = value * 1.0; break;
            case 'matchTempo': return this.reportAction(this.matchTempo());
            case 'startOnBeat': return this.reportAction(this.startOnBeat());
            case 'align': return this.reportAction(this.align());
            case 'ready': if (this.mode === 'battle') return this.reportAction(this.readyUp()); break;
        }
        this.emit(); return null;
    }
    private reportAction(msg: string | null) { if (msg) this.say(msg); return msg; }

    matchTempo(): string | null {
        const t = this.currentTrack(); if (!t) return 'Load a track first.'; if (!t.bpm) return 'This track has no BPM yet: set it in the Tracks panel.';
        const r = bestRate(t.bpm, (this.session?.config.masterBpm ?? this.options.masterBpm));
        if (!r) return `${t.bpm} BPM is too far from ${this.options.masterBpm} BPM to match within +-20%.`;
        this.stations.player.setRate(r.rate); return null;
    }
    startOnBeat(): string | null {
        const t = this.currentTrack(); if (!t) return 'Load a track first.'; if (!t.bpm) return 'This track has no BPM, so it cannot be started on a beat.';
        const clock = this.clock; if (!clock) return 'The master clock starts with the count-in.';
        const st = this.stations.player; st.seek(t.firstBeatSec);
        const next = Math.ceil((clock.beatAt(this.now) + 1) / 4) * 4;             // next bar line at least one beat away
        st.play(clock.timeOfBeat(next)); return null;
    }
    align(): string | null {
        const t = this.currentTrack(); const clock = this.clock; const st = this.stations.player; const s = st.state();
        if (!t || !t.bpm) return 'No track with a known BPM.'; if (!clock) return 'No master clock yet.'; if (!s.sounding) return 'Start the deck first.';
        const err = phaseDiff((s.positionSec - t.firstBeatSec) * t.bpm / 60, clock.beatAt(this.now));
        st.seek(s.positionSec - err * 60 / t.bpm); return null;
    }
    loadToPlayer(id: string): string | null {
        const t = this.library.get(id); if (!t) return 'Unknown track.'; if (!this.ready || this.mode === 'menu' || this.mode === 'show') return 'Start a battle or practice first.';
        const st = this.stations.player; if (st.state().sounding && this.session?.phase !== 'live' && this.session?.phase !== 'countin') st.pause();
        st.load(t); this.say(`Loaded "${t.title}"` + (t.bpm ? '' : ' (no BPM yet: it cannot be scored for alignment)')); return null;
    }
    private currentTrack(): GameTrack | null { const id = this.stations.player.state().trackId; return id ? this.library.get(id) ?? null : null; }

    // ---------------------------------------------------------------- readouts
    meters() { return { player: this.backends.player.peak(this.scratch), buddy: this.backends.buddy.peak(this.scratch) }; }
    masterLevel() { if (!this.bus) return 0; const a = this.bus.analyser; const buf = this.scratch; a.getFloatTimeDomainData(buf as Float32Array<ArrayBuffer>); let p = 0; for (let i = 0; i < buf.length; i++) p = Math.max(p, Math.abs(buf[i])); return p; }
    waveform(station: StationId, out: Float32Array) { this.backends[station].analyser.getFloatTimeDomainData(out as Float32Array<ArrayBuffer>); }
}
