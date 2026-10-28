import { EventBus, Stamped } from '../events';

/**
 * BENDR as B2Buddy's video-mixing engine.
 *
 * The real, unmodified BENDR (public/bendr/index.html, v38.7, MIT) runs in a same-origin iframe. B2Buddy is BENDR's virtual camera and virtual audio
 * input: the club scene canvas is handed to BENDR as channel A's camera, the game's master mix as its audio-reactive input. BENDR's own pipeline
 * (WebGL2 shaders, 103 presets, modulation, bypass) produces the picture, and `__getOutputStream()` brings it back. B2Buddy never reimplements any of it.
 *
 * Coupling is to BENDR's own globals (it exposes no API object), so this adapter is pinned to the vendored version, feature-detects everything
 * it touches, and reports failure instead of pretending: a failed engine is replaced by the canvas fallback and the UI says so.
 */

/** `flashing`: the preset drives strobe or inverse-flicker (rapid full-frame flashing). Included by default; the player can switch them out. */
export interface EffectEntry { id: string; name: string; index: number; flashing: boolean }
export type EngineState = 'idle' | 'starting' | 'ready' | 'degraded' | 'failed';
export interface EngineStatus { state: EngineState; detail: string; version?: string; frames: number; errors: number; registry: number; excluded: { flashing: number; sourceReplacing: number; multiChannel: number; clean: number };
    /** Game events actually delivered into BENDR: bar lines it was phase-locked to, and event kicks sent to its `spike` modulation source. */ reactions: { phaseLocks: number; spikes: number } }

type BW = Window & typeof globalThis & { eval(code: string): unknown };
export interface BendrOptions {
    src: string; feed: HTMLCanvasElement; audio?: MediaStream | null; bus: EventBus; masterBpm: number; allowFlashing?: boolean; startTimeoutMs?: number;
    /** iframe parent; defaults to document.body */ parent?: HTMLElement;
}

const NEEDED = ['openCam', 'loadPreset', 'setBypass', 'setTempo', 'setProcRes', 'setAudioMode', '__getOutputStream'] as const;
/** Runs INSIDE BENDR's realm: classifies each built-in preset by what it would do to B2Buddy's feed. */
const CLASSIFY = `(()=>{ const out=[]; const FL=/"(strobe|invFlick)"\\s*:\\s*(?!0(?:\\.0+)?[,}\\]])[0-9.]+|"dst":"(strobe|invFlick)"/;
  for(let i=0;i<PRESETS.length;i++){ const p=PRESETS[i]; const js=JSON.stringify(p);
    out.push({index:i,name:String(p[0]),whole:!!(p[1]&&p[1].chan),flashing:FL.test(js),replacesSource:!!(p[3]&&p[3].src),mixesChannels:/"abMix/.test(JSON.stringify(p[1]||{})),clean:/^CLEAN/i.test(String(p[0]))}); }
  return JSON.stringify(out); })()`;

export class BendrEngine {
    private frame: HTMLIFrameElement | null = null; private win: BW | null = null; private feedStream: MediaStream | null = null;
    private timer: ReturnType<typeof setInterval> | null = null; private offs: Array<() => void> = [];
    private all: EffectEntry[] = []; private allowFlashing = true; private entries: EffectEntry[] = []; private excluded = { flashing: 0, sourceReplacing: 0, multiChannel: 0, clean: 0 };
    private wantOff = false; private lastFrameNo = -1; private lastFrameAt = 0; private errs = 0; private consecutive = 0;
    private react_ = { phaseLocks: 0, spikes: 0 };
    private st: EngineStatus = { state: 'idle', detail: 'not started', frames: 0, errors: 0, registry: 0, excluded: this.excluded, reactions: this.react_ };
    private disposed = false; output: MediaStream | null = null; selected: EffectEntry | null = null;
    constructor(private readonly o: BendrOptions) { this.allowFlashing = o.allowFlashing !== false; }

    status(): EngineStatus { return { ...this.st, errors: this.errs, registry: this.entries.length, excluded: { ...this.excluded }, reactions: { ...this.react_ } }; }
    private set(state: EngineState, detail: string) { this.st = { ...this.st, state, detail }; this.o.bus.emit({ type: 'engine.status', engine: 'bendr', state: state === 'ready' ? 'ready' : state === 'failed' ? 'failed' : 'degraded', detail }); }
    // SECURITY NOTE on `eval`: BENDR keeps its state in top-level `const`/`let` globals that are not window properties, so the only way to read or set them is
    // evaluating in its realm. Every string passed to eval/ev() in this file is a CONSTANT written here (never built from game, network or user data), and it only
    // runs inside the vendored, hash-pinned, same-origin BENDR page (public/bendr/SHA256SUMS). Nothing from outside is ever evaluated.
    private ev<T>(code: string): T { return this.win!.eval(code) as T; }

    /** Boots BENDR and wires the virtual devices. Rejects with the exact reason when BENDR cannot be used; the iframe is removed on failure. */
    async start(): Promise<void> {
        this.set('starting', 'loading BENDR');
        try {
            if (!document.createElement('canvas').getContext('webgl2')) throw new Error('WebGL2 is not available in this browser');
            const f = document.createElement('iframe'); this.frame = f; f.src = this.o.src; f.title = 'BENDR video engine'; f.setAttribute('aria-hidden', 'true'); f.tabIndex = -1;
            f.style.cssText = 'position:fixed;left:-10000px;top:0;width:1280px;height:720px;border:0;opacity:0;pointer-events:none';
            const loaded = new Promise<void>((res, rej) => { f.onload = () => res(); f.onerror = () => rej(new Error('BENDR page failed to load')); });
            (this.o.parent ?? document.body).appendChild(f); await Promise.race([loaded, this.timeout(this.o.startTimeoutMs ?? 20000, 'BENDR did not finish loading')]);
            this.win = f.contentWindow as BW; if (!this.win) throw new Error('BENDR window unavailable');
            await this.until(() => { try { return typeof this.ev<string>('BENDR_VERSION') === 'string' && this.ev<number>('PRESETS.length') > 0; } catch { return false; } }, this.o.startTimeoutMs ?? 20000, 'BENDR engine did not initialise');
            const missing = NEEDED.filter(n => typeof (this.win as unknown as Record<string, unknown>)[n] !== 'function'); if (missing.length) throw new Error('incompatible BENDR build, missing: ' + missing.join(', '));
            this.st.version = this.ev<string>('BENDR_VERSION');

            // B2Buddy is BENDR's camera and audio interface
            this.feedStream = this.o.feed.captureStream(30); const audio = this.o.audio ?? null; const nav = this.win.navigator.mediaDevices;
            nav.getUserMedia = (async (c: MediaStreamConstraints) => (c && c.video ? this.feedStream! : audio ?? Promise.reject(new DOMException('no game audio', 'NotFoundError')))) as typeof nav.getUserMedia;
            (this.win as unknown as { setProcRes(r: number, ar: number): void }).setProcRes(360, this.o.feed.width / this.o.feed.height);
            await (this.win as unknown as { openCam(ch: string): Promise<void> }).openCam('A');
            if (this.ev<string>('SRC.A.mode') !== 'cam') throw new Error('BENDR did not accept the game feed as channel A');
            if (audio) { try { await (this.win as unknown as { setAudioMode(m: string): Promise<void> }).setAudioMode('mic'); } catch { this.st.detail = 'audio reactivity unavailable'; } }
            (this.win as unknown as { setTempo(v: number): boolean }).setTempo(this.o.masterBpm);
            this.buildRegistry(); this.output = (this.win as unknown as { __getOutputStream(): MediaStream }).__getOutputStream();
            if (!this.entries.length) throw new Error('no usable effects in the BENDR preset registry');
            this.offs.push(this.o.bus.onAny(e => this.react(e))); this.lastFrameAt = performance.now();
            this.timer = setInterval(() => this.guard(), 250);
            this.set('ready', `BENDR ${this.st.version}: ${this.entries.length} effects`);
        } catch (e) { this.dispose(); this.set('failed', (e as Error).message); throw e; }
    }

    private timeout(ms: number, msg: string) { return new Promise<void>((_r, rej) => setTimeout(() => rej(new Error(msg)), ms)); }
    private async until(cond: () => boolean, ms: number, msg: string) { const t0 = performance.now(); while (!cond()) { if (performance.now() - t0 > ms) throw new Error(msg); await new Promise(r => setTimeout(r, 50)); } }

    private buildRegistry() {
        const rows = JSON.parse(this.ev<string>(CLASSIFY)) as Array<{ index: number; name: string; whole: boolean; flashing: boolean; replacesSource: boolean; mixesChannels: boolean; clean: boolean }>;
        const out: EffectEntry[] = []; const x = this.excluded; x.flashing = x.sourceReplacing = x.multiChannel = x.clean = 0;
        for (const r of rows) {
            if (r.clean) { x.clean++; continue; }
            if (r.whole || r.mixesChannels) { x.multiChannel++; continue; }
            if (r.replacesSource) { x.sourceReplacing++; continue; }
            out.push({ id: 'bendr:' + r.index, name: r.name, index: r.index, flashing: r.flashing });
        }
        this.all = out; this.applyFlashingFilter();
    }

    private applyFlashingFilter() { this.entries = this.allowFlashing ? this.all : this.all.filter(e => !e.flashing); this.excluded.flashing = this.allowFlashing ? 0 : this.all.length - this.entries.length; }
    /** The real BENDR presets that work on this feed (flashing ones only while flashing effects are allowed). */
    registry(): readonly EffectEntry[] { return this.entries; }
    get flashingAllowed() { return this.allowFlashing; }
    /** Switches flashing presets in or out of the registry. Returns true when the active effect was a flashing one and had to be cleared (effect OFF, selection dropped). */
    setAllowFlashing(allow: boolean): boolean {
        this.allowFlashing = allow; this.applyFlashingFilter();
        if (!allow && this.selected?.flashing) { this.selected = null; this.setOn(false); return true; }
        return false;
    }
    entry(id: string | null): EffectEntry | null { return this.entries.find(e => e.id === id) ?? null; }

    /** Loads a BENDR preset onto the feed (the effect, not whether it shows: see setOn). */
    select(id: string): boolean {
        const e = this.entry(id); if (!e || !this.win || this.st.state === 'failed') return false;
        try {
            (this.win as unknown as { loadPreset(i: number): void }).loadPreset(e.index); this.selected = e; this.reassert(); this.consecutive = 0; return true;
        } catch (err) { this.fail('preset ' + e.name + ': ' + (err as Error).message); return false; }
    }
    /** ON shows the preset; OFF is BENDR's own bypass: the source with the whole chain switched out. The preset stays loaded. */
    setOn(on: boolean) {
        this.wantOff = !on; if (!this.win) return;
        try { (this.win as unknown as { setBypass(on: boolean): void }).setBypass(!on); } catch (err) { this.fail('bypass: ' + (err as Error).message); }
    }
    isBypassed(): boolean { try { return !!this.ev<number>('bypass'); } catch { return false; } }
    setTempo(bpm: number) { try { (this.win as unknown as { setTempo(v: number): boolean }).setTempo(bpm); } catch (err) { this.fail('tempo: ' + (err as Error).message); } }
    /** Latest rendered frame count from BENDR (proof it is drawing). */
    frameNo(): number { try { return this.ev<number>('frameNo'); } catch { return -1; } }

    /** Game event -> BENDR. Only real events; BENDR responds, it never controls the game. */
    private react(e: Stamped) {
        if (!this.win || this.st.state === 'failed') return;
        try {
            if (e.type === 'beat' && e.downbeat) { this.win.eval('beatPhase = 0; beatCount = 3'); this.react_.phaseLocks++; }             // phase-lock BENDR's beat to the game's master bar line
            else if (e.type === 'transition.started' || e.type === 'drop' || e.type === 'round.started' || e.type === 'mix.started') { this.win.eval('spikeV = 1'); this.react_.spikes++; }   // BENDR's event modulation source
            this.consecutive = 0;
        } catch (err) { this.fail('event ' + e.type + ': ' + (err as Error).message); }
    }

    private reassert() {
        // presets must never take the game feed away or leave the chain bypassed against the user's choice
        if (this.ev<string>('SRC.A.mode') !== 'cam') void (this.win as unknown as { openCam(ch: string): Promise<void> }).openCam('A').catch(() => this.fail('could not restore the game feed'));
        this.setTempo(this.o.masterBpm); (this.win as unknown as { setBypass(on: boolean): void }).setBypass(this.wantOff);
    }

    /** A reported problem stays visible this long before the engine may report `ready` again, so a one-off failure cannot be erased by the next successful call. */
    private holdUntil = 0; static readonly HOLD_MS = 5000;
    private fail(msg: string) {
        this.errs++; this.consecutive++; this.holdUntil = performance.now() + BendrEngine.HOLD_MS;
        if (this.consecutive >= 8) { this.set('failed', msg); this.stopTimer(); } else this.set('degraded', msg);
    }

    /** 4 Hz health check: BENDR's own blur handler releases bypass; frames must keep advancing; the feed must stay ours. */
    private guard() {
        if (this.disposed || !this.win) return;
        if (this.frame && !this.frame.isConnected) { this.hardFail('the BENDR frame was removed from the page'); return; }
        try {
            if (this.isBypassed() !== this.wantOff) (this.win as unknown as { setBypass(on: boolean): void }).setBypass(this.wantOff);
            if (this.ev<string>('SRC.A.mode') !== 'cam') this.reassert();
            const n = this.frameNo(); const now = performance.now();
            if (n !== this.lastFrameNo) { this.lastFrameNo = n; this.lastFrameAt = now; this.st.frames = n; if (this.st.state === 'degraded' && this.consecutive === 0 && now > this.holdUntil) this.set('ready', `BENDR ${this.st.version}: ${this.entries.length} effects`); }
            else if (now - this.lastFrameAt > 6000 && !document.hidden) this.hardFail('BENDR stopped producing frames');
        } catch (err) { this.fail('guard: ' + (err as Error).message); }
    }

    /** Failures that must not be masked by unrelated successful calls (a detached BENDR window still evaluates code, so event delivery keeps "succeeding"). */
    private hardFail(msg: string) { this.errs++; this.set('failed', msg); this.stopTimer(); }
    private stopTimer() { if (this.timer) clearInterval(this.timer); this.timer = null; }
    dispose() {
        this.disposed = true; this.stopTimer(); for (const o of this.offs) o(); this.offs = [];
        try { this.feedStream?.getTracks().forEach(t => t.stop()); } catch { /* already stopped */ }
        this.frame?.remove(); this.frame = null; this.win = null; this.output = null;
    }
}
