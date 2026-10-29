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
import { StorageCueStore } from './core/cueStore';
import { DEFAULT_JOG, JogController, JogSettings } from './core/jog';
import { bestRate } from './core/tempo';
import { EqBand, GameTrack, MetaOrigin, StationId } from './core/types';
import { MemoryStore } from './memory/store';
import { Supervisor } from './memory/supervisor';
import { ActionId, browserMidiDeps, MidiService } from './midi/midi';
import { EventBus } from './events';
import { AiDjServiceBrain, AiDjTsBrain, BrainStatus, DjBrain } from './dj/brain';
import { encodeWav } from './dj/wav';

export type Mode = 'menu' | 'battle' | 'practice' | 'show';
export type ServiceState = 'off' | 'connecting' | 'connected' | 'unreachable';
/** What the AI DJ service MEASURED for one track (librosa). Shown beside the declared grid; it never silently replaces it. */
export interface LocalAnalysis { origin: 'measured'; engine: string; bpm: number; beatCount: number; firstBeatSec: number; key: string; keyOrigin: 'estimated'; keyNote: string; energy: number; choruses: Array<{ start: number; end: number }>; chorusFallbackDiscarded: boolean; vocals: { heuristic: boolean; reliable: false } }
export interface ServiceAnalysis { origin: 'measured'; engine: string; bpmBeatTrack: number; bpmRounded: number | null; beatCount: number; firstBeatSec: number | null; phraseBoundariesSec: number[]; local: LocalAnalysis | null; localError: string | null }
export const DEFAULT_AIDJ_URL = 'http://127.0.0.1:8765';
const ENGINE_KEY = 'b2buddy.engine.v1';
export interface GameOptions { showDj1: Difficulty; showDj2: Difficulty; showSeconds: number; difficulty: Difficulty; challengeId: string; roundSeconds: number; bestOf: number; masterBpm: number; clickDuringRound: boolean }
export const DEFAULT_OPTIONS: GameOptions = { showDj1: 'intermediate', showDj2: 'intermediate', showSeconds: 60, difficulty: 'intermediate', challengeId: 'standard', roundSeconds: 90, bestOf: 3, masterBpm: 124, clickDuringRound: false };

/** rate <-> tempo fader (0..1, centre = normal speed). The range is the full-scale swing each way: 0.06 / 0.10 / 0.16 (the original) / 0.5 (WIDE). */
export const TEMPO_RANGES = [0.06, 0.1, 0.16, 0.5] as const;
export const rateToFader = (r: number, range = 0.16) => Math.min(1, Math.max(0, (r - 1) / (2 * range) + 0.5));
export const faderToRate = (f: number, range = 0.16) => 1 + (f - 0.5) * 2 * range;
export const BEAT_JUMP_SIZES = [0.5, 1, 2, 4, 8, 16, 32, 64] as const;
export const LOOP_SIZES = [0.25, 0.5, 1, 2, 4, 8, 16, 32] as const;
/** Pitch bend of the - / + buttons while held. */
export const PITCH_BEND_BUTTON = 0.08;
const CDJ_KEY = 'b2buddy.cdj.v1';
/** CDJ panel choices that outlive the page: jog feel, tempo range, selected beat-jump and loop sizes, MIDI jog resolution. */
export interface CdjPrefs { jog: JogSettings; ticksPerTurn: number; tempoRange: number; beatJump: number; loopSize: number }

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
    /** Typed event interface between the DJ brain, the game and the video engine (see events.ts). */
    readonly events = new EventBus(() => this.now);
    brainPref: 'aidj' | 'rules' = 'aidj'; videoPref: 'bendr' | 'canvas' = 'bendr';
    /** Strobe / flicker presets take part in Random Effect by default; the player can switch them out (Venue button, Settings). Persisted. */
    allowFlashing = true;
    /** The photosensitivity warning has been shown and answered this page load. Asked again every session on purpose. */
    flashingAck = false;
    serviceUrl = DEFAULT_AIDJ_URL; serviceState: ServiceState = 'off'; serviceError = '';
    readonly analysis = new Map<string, ServiceAnalysis>();
    private tsBrain = new AiDjTsBrain(); private svc: AiDjServiceBrain | null = null; private masterStream: MediaStream | null = null; private storage: Pick<Storage, 'getItem' | 'setItem'>;
    readonly cueStore: StorageCueStore;
    jog!: JogController;
    cdj: CdjPrefs = { jog: { ...DEFAULT_JOG }, ticksPerTurn: 256, tempoRange: 0.16, beatJump: 4, loopSize: 4 };
    /** SHIFT held (hot-cue pads clear instead of jump) and the bend buttons currently held. */
    shift = false; private bendHeld = new Set<string>();
    private lastBeat = Number.NaN; private lastScoreAt = 0; private marks = { buddy: 0, player: 0 };

    constructor(storage: Storage | { getItem(k: string): string | null; setItem(k: string, v: string): void; removeItem(k: string): void }) {
        this.storage = storage; this.loadEnginePrefs();
        this.memory = new MemoryStore(storage); this.supervisor = new Supervisor(this.memory);
        this.cueStore = new StorageCueStore(storage); this.loadCdjPrefs();
        this.midi = new MidiService(browserMidiDeps(storage));
        this.midi.onAction((a, v) => this.act(a, v));
        // losing focus must never leave a button held or the jog bent
        if (typeof window !== 'undefined') window.addEventListener('blur', () => this.releaseAllInput());
        for (const t of DEMO_TRACKS) this.library.set(t.id, t);
    }

    private loadCdjPrefs() {
        try {
            const o = JSON.parse(this.storage.getItem(CDJ_KEY) ?? '{}') as Partial<CdjPrefs> & { jog?: Partial<JogSettings> };
            const j: Partial<JogSettings> = o.jog ?? {};
            this.cdj.jog = { mode: j.mode === 'vinyl' ? 'vinyl' : 'cdj', sensitivity: typeof j.sensitivity === 'number' ? j.sensitivity : 1, curve: j.curve === 'accel' ? 'accel' : 'linear', maxBend: typeof j.maxBend === 'number' ? j.maxBend : DEFAULT_JOG.maxBend };
            if (typeof o.ticksPerTurn === 'number' && o.ticksPerTurn >= 16 && o.ticksPerTurn <= 4096) this.cdj.ticksPerTurn = o.ticksPerTurn;
            if ((TEMPO_RANGES as readonly number[]).includes(o.tempoRange as number)) this.cdj.tempoRange = o.tempoRange as number;
            if ((BEAT_JUMP_SIZES as readonly number[]).includes(o.beatJump as number)) this.cdj.beatJump = o.beatJump as number;
            if ((LOOP_SIZES as readonly number[]).includes(o.loopSize as number)) this.cdj.loopSize = o.loopSize as number;
        } catch { /* corrupt or blocked storage: defaults */ }
    }
    saveCdjPrefs() { this.jog?.configure(this.cdj.jog); this.cdj.jog = { ...(this.jog?.settings ?? this.cdj.jog) }; try { this.storage.setItem(CDJ_KEY, JSON.stringify(this.cdj)); } catch { /* storage blocked */ } this.emit(); }
    /** Everything momentary back to neutral: held buttons (MIDI and keyboard), shift, bend, the jog, a loop roll or cue preview in progress. */
    releaseAllInput() {
        this.midi.releaseAll(); this.shift = false; this.bendHeld.clear(); this.jog?.release();
        const st = this.stations?.player; if (st) { st.setBend(0); st.cueRelease(); st.hotCueRelease(); st.rollEnd(); }
        this.emit();
    }

    private loadEnginePrefs() {
        try {
            const o = JSON.parse(this.storage.getItem(ENGINE_KEY) ?? '{}') as Record<string, unknown>;
            if (o.brain === 'rules' || o.brain === 'aidj') this.brainPref = o.brain; if (o.video === 'canvas' || o.video === 'bendr') this.videoPref = o.video;
            if (typeof o.serviceUrl === 'string' && /^https?:\/\//.test(o.serviceUrl)) this.serviceUrl = o.serviceUrl; if (o.allowFlashing === false) this.allowFlashing = false;
        } catch { /* corrupt or blocked storage: defaults */ }
        try {   // test and demo switches: ?engine=canvas  ?brain=rules
            const q = new URLSearchParams(typeof location !== 'undefined' ? location.search : '');
            if (q.get('engine') === 'canvas' || q.get('engine') === 'bendr') this.videoPref = q.get('engine') as 'canvas' | 'bendr'; if (q.get('brain') === 'rules' || q.get('brain') === 'aidj') this.brainPref = q.get('brain') as 'rules' | 'aidj';
        } catch { /* no location (tests) */ }
    }
    savePrefs() { try { this.storage.setItem(ENGINE_KEY, JSON.stringify({ brain: this.brainPref, video: this.videoPref, serviceUrl: this.serviceUrl, allowFlashing: this.allowFlashing })); } catch { /* storage blocked */ } this.emit(); }

    // ---------------------------------------------------------------- DJ brain (AI DJ) selection and service connection
    /** The decision layer Buddy uses now: the AI DJ (service if connected, else the in-process port) or null = Buddy's built-in rules (explicit fallback). */
    currentBrain(): DjBrain | null { return this.brainPref === 'rules' ? null : this.svc ?? this.tsBrain; }
    brainStatus(): BrainStatus { return this.brainPref === 'rules' ? { mode: 'rules', detail: "Buddy's built-in rules (AI DJ switched off)", fallbackCalls: 0, warmedPairs: 0 } : (this.svc ?? this.tsBrain).status(); }
    setBrainPref(p: 'aidj' | 'rules') { this.brainPref = p; this.savePrefs(); const s = this.brainStatus(); this.events.emit({ type: 'brain.status', mode: s.mode, detail: s.detail }); }
    /** Connects the browser to the local AI DJ service. Never throws: on failure the in-process AI DJ port stays in charge and the reason is kept. */
    async connectService(url = this.serviceUrl): Promise<boolean> {
        this.serviceUrl = url; this.serviceState = 'connecting'; this.serviceError = ''; this.emit();
        try {
            const b = new AiDjServiceBrain(url.replace(/\/$/, '')); await b.connect(); const n = await b.warm(this.tracks.filter(t => t.bpm));
            if (n === 0 && b.error) throw new Error(b.error); this.svc = b; this.serviceState = 'connected';
        } catch (e) { this.svc = null; this.serviceState = 'unreachable'; this.serviceError = (e as Error).message || 'unreachable'; }
        this.savePrefs(); const s = this.brainStatus(); this.events.emit({ type: 'brain.status', mode: s.mode, detail: s.detail + (this.serviceError ? ` (${this.serviceError})` : '') }); return this.serviceState === 'connected';
    }
    disconnectService() { this.svc = null; this.serviceState = 'off'; this.serviceError = ''; this.savePrefs(); const s = this.brainStatus(); this.events.emit({ type: 'brain.status', mode: s.mode, detail: s.detail }); }
    /** Sends one decoded track to the service and stores what librosa measured. Returns a message for the UI; never changes the track's declared grid. */
    async analyzeWithService(id: string): Promise<string> {
        const pcm = this.pcm.get(id); const t = this.library.get(id); if (!this.svc || !this.ctx || !pcm || !t) return 'Connect the AI DJ service first (Settings).';
        try {
            const r = await fetch(this.svc.url + '/v1/analyze', { method: 'POST', body: encodeWav(pcm, this.ctx.sampleRate), headers: { 'Content-Type': 'audio/wav', 'X-Track-Id': id } });
            const j = await r.json() as ServiceAnalysis & { error?: string }; if (!r.ok) return `AI DJ could not analyse this track: ${j.error ?? r.status}`;
            this.analysis.set(id, j); const L = j.local; const bits = [`${j.bpmBeatTrack.toFixed(1)} BPM (beat tracker, ${j.beatCount} beats)`];
            if (L) {
                // fill only what is UNKNOWN, always labelled an estimate; never overwrite declared / manual values
                const cur = this.library.get(id)!; const patch: Partial<GameTrack> = {};
                if (!cur.key && L.key) { patch.key = L.key; patch.keyOrigin = 'estimated'; bits.push(`key ${L.key} (estimate: may be the relative major/minor)`); }
                if (L.choruses.length) { patch.choruses = L.choruses; bits.push(`${L.choruses.length} repeated section(s) found`); }
                if (Object.keys(patch).length) { this.library.set(id, { ...cur, ...patch }); if (this.svc) void this.svc.warm(this.tracks.filter(t => t.bpm)); }
            } else bits.push(`local key/chorus analysis unavailable (${j.localError ?? 'unknown'})`);
            this.emit(); return `AI DJ analysed: ${bits.join(', ')}. Your BPM field is unchanged: press USE AI DJ BPM to adopt it.`;
        } catch (e) { return 'AI DJ service did not answer: ' + (e as Error).message; }
    }
    /** Adopts the AI DJ's beat-tracker BPM and first beat for a track. Explicit user action; labelled an estimate (a beat tracker can be off by a few percent or an octave). */
    useServiceBpm(id: string): string {
        const a = this.analysis.get(id); if (!a) return 'Analyse the track first.'; const bpm = a.local?.bpm ?? a.bpmBeatTrack; const first = a.local?.firstBeatSec ?? a.firstBeatSec ?? 0;
        return this.setBpm(id, bpm, 'estimated', first) ? `BPM set to ${bpm.toFixed(2)} (estimated by the AI DJ). Check it by ear: correct it by hand if it sounds off.` : 'That BPM is outside 40-240.';
    }
    /** The game's master mix as a MediaStream (post-limiter): the audio input BENDR reacts to. Taking it does not change what you hear. */
    masterAudioStream(): MediaStream | null {
        if (!this.ctx || !this.bus) return null; if (!this.masterStream) { const d = this.ctx.createMediaStreamDestination(); this.bus.master.connect(d); this.masterStream = d.stream; } return this.masterStream;
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
            this.stations = { player: new Station('player', this.backends.player, this.cueStore), buddy: new Station('buddy', this.backends.buddy) };
            this.jog = new JogController(this.stations.player, this.cdj.jog);
            for (const id of ['player', 'buddy'] as const) this.stations[id].onEvent(e => {
                if (e.type === 'load') this.events.emit({ type: 'track.loaded', station: id, trackId: e.trackId });
                else if (e.type === 'play') this.events.emit({ type: 'mix.started', station: id, trackId: this.stations[id].state().trackId ?? '' });
            });
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
        this.ai = new BuddyAI(this.port, session, bundled, this.options.difficulty, () => this.now, () => this.memory.buddyPrefs(), (Date.now() % 100000) + 1, () => this.stations.player.state().trackId, this.currentBrain());
        this.decisionMark = 0; this.nextClick = Number.NaN; this.marks = { buddy: 0, player: 0 };
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
        this.ai = new BuddyAI(this.port, session, DEMO_TRACKS, this.options.showDj2, () => this.now, () => ({}), seed, () => this.stations.player.state().trackId, this.currentBrain());
        this.ai2 = new BuddyAI(this.port2, session, DEMO_TRACKS, this.options.showDj1, () => this.now, () => ({}), seed + 7919, () => this.stations.buddy.state().trackId, this.currentBrain());
        this.decisionMark = 0; this.nextClick = Number.NaN; this.marks = { buddy: 0, player: 0 };
        session.onPhase(p => this.onPhase(p));
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
        this.lastBeat = Number.NaN;
        if (p === 'countin') this.events.emit({ type: 'round.started', round: s.round });
        if (p === 'roundEnd' || p === 'matchEnd') this.events.emit({ type: 'round.ended', round: s.round, winner: s.results[s.results.length - 1]?.winner ?? 'draw' });
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
        this.jog?.tick(this.now);
        this.pumpEvents();
        this.scheduleClicks();
        if (this.message && performance.now() > this.messageUntil) { this.message = ''; }
    }

    /** Turns what already happened this frame into events. Bounded: at most one beat, one score and the new decisions per call. */
    private pumpEvents() {
        const s = this.session; const clock = s?.clock;
        if (s && clock && s.phase === 'live') {
            const b = Math.floor(clock.beatAt(this.now));
            if (b >= 0 && b !== this.lastBeat) {
                this.lastBeat = b; const bpb = s.config.beatsPerBar; this.events.emit({ type: 'beat', beat: b, bar: Math.floor(b / bpb), downbeat: b % bpb === 0 });
                if (b > 0 && b % (bpb * 4) === 0) this.events.emit({ type: 'phrase', phrase: b / (bpb * 4) });
            }
            if (this.now - this.lastScoreAt >= 1 && s.scorer) { this.lastScoreAt = this.now; this.events.emit({ type: 'score', player: s.scorer.breakdown('player').total, buddy: s.scorer.breakdown('buddy').total }); }
        }
        for (const [ai, station] of [[this.ai, 'buddy'], [this.ai2, 'player']] as const) {
            if (!ai) continue; const list = ai.decisions; const from = Math.min(this.marks[station], list.length); this.marks[station] = list.length;
            for (let i = from; i < list.length; i++) {
                const d = list[i]; this.events.emit({ type: 'dj.decision', station, kind: d.kind, decision: d.decision, source: d.source ?? 'rules' });
                if (d.kind === 'transition') { const [a, b] = d.decision.split(' -> '); this.events.emit({ type: 'transition.started', station, from: a ?? '', to: b ?? '' }); }
                else if (d.kind === 'launch' && d.decision.startsWith('launch after change')) { this.events.emit({ type: 'transition.completed', station, to: d.decision }); this.events.emit({ type: 'drop', station, reason: 'incoming track launched on the master beat' }); }
            }
        }
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
            case 'tempo': st.setRate(faderToRate(value, this.cdj.tempoRange)); break;
            case 'master.volume': if (this.bus) this.bus.master.gain.value = value * 1.0; break;
            case 'matchTempo': return this.reportAction(this.matchTempo());
            case 'startOnBeat': return this.reportAction(this.startOnBeat());
            case 'align': return this.reportAction(this.align());
            case 'ready': if (this.mode === 'battle') return this.reportAction(this.readyUp()); break;
            // ---- CDJ controls. value 1 = pressed, 0 = released for hold actions.
            case 'cue.hold': if (!need(!!s.trackId, 'Load a track first.')) return null; if (value >= 0.5) st.cuePress(); else st.cueRelease(); break;
            case 'bend.minus': case 'bend.plus': { if (value >= 0.5) this.bendHeld.add(action); else this.bendHeld.delete(action); st.setBend((this.bendHeld.has('bend.plus') ? PITCH_BEND_BUTTON : 0) - (this.bendHeld.has('bend.minus') ? PITCH_BEND_BUTTON : 0)); break; }
            case 'jog': if (!need(!!s.trackId, 'Load a track first.')) return null; this.jog.move(value / this.cdj.ticksPerTurn, this.now); break;
            case 'jog.touch': if (value >= 0.5) this.jog.touch(); else this.jog.release(); break;
            case 'jog.search': this.jog.searching = value >= 0.5; break;
            case 'shift': this.shift = value >= 0.5; break;
            case 'tempo.range': { const i = TEMPO_RANGES.indexOf(this.cdj.tempoRange as (typeof TEMPO_RANGES)[number]); this.cdj.tempoRange = TEMPO_RANGES[(i + 1) % TEMPO_RANGES.length]; this.saveCdjPrefs(); break; }
            case 'quantize': st.setQuantize(!s.quantize); break;
            case 'beatjump.back': case 'beatjump.fwd': {
                if (!need(!!s.trackId, 'Load a track first.')) return null;
                if (!st.beatJump((action === 'beatjump.fwd' ? 1 : -1) * this.cdj.beatJump)) this.say('Beat jump needs a track with a known BPM (set it in the Tracks panel) and room to move.'); break;
            }
            case 'beatjump.size.up': case 'beatjump.size.down': { const i = BEAT_JUMP_SIZES.indexOf(this.cdj.beatJump as (typeof BEAT_JUMP_SIZES)[number]); this.cdj.beatJump = BEAT_JUMP_SIZES[Math.max(0, Math.min(BEAT_JUMP_SIZES.length - 1, i + (action.endsWith('up') ? 1 : -1)))]; this.saveCdjPrefs(); break; }
            case 'loop.size.up': case 'loop.size.down': { const i = LOOP_SIZES.indexOf(this.cdj.loopSize as (typeof LOOP_SIZES)[number]); this.cdj.loopSize = LOOP_SIZES[Math.max(0, Math.min(LOOP_SIZES.length - 1, i + (action.endsWith('up') ? 1 : -1)))]; this.saveCdjPrefs(); break; }
            case 'loop.in': if (!need(!!s.trackId, 'Load a track first.')) return null; st.loopIn(); break;
            case 'loop.out': if (!need(!!s.trackId, 'Load a track first.')) return null; if (!st.loopOut()) this.say('Press LOOP IN first, then LOOP OUT later in the track.'); break;
            case 'loop.exit': st.exitLoop(); break;
            case 'loop.reloop': st.reloop(); break;
            case 'loop.half': st.loopHalve(); break;
            case 'loop.double': st.loopDouble(); break;
            case 'loop.auto': if (!need(!!s.trackId, 'Load a track first.')) return null; if (s.loop?.active) st.exitLoop(); else if (!st.loopBeats(this.cdj.loopSize)) this.say('Loops by beat need a track with a known BPM. Use LOOP IN and LOOP OUT instead.'); break;
            case 'loop.roll': if (value >= 0.5) { if (!st.rollStart(this.cdj.loopSize)) this.say('Loop roll needs a playing track with a known BPM.'); } else st.rollEnd(); break;
            default:
                if (action.startsWith('hotcue.')) {
                    const i = Number(action.slice(7)) - 1;
                    if (!need(!!s.trackId, 'Load a track first.')) return null;
                    if (value >= 0.5) { if (this.shift) st.clearHotCue(i); else st.hotCuePress(i); } else st.hotCueRelease();
                }
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
