import { KeyValueStorage } from '../memory/store';

/** Action kinds. trigger: fires once per press. continuous: a fader or knob (CC 0..1). hold: press and release both matter (cue preview, hot cues, bend, loop roll). relative: an endless encoder or jog wheel (signed ticks). */
export type ActionKind = 'trigger' | 'continuous' | 'hold' | 'relative';
export type HotCueAction = 'hotcue.1' | 'hotcue.2' | 'hotcue.3' | 'hotcue.4' | 'hotcue.5' | 'hotcue.6' | 'hotcue.7' | 'hotcue.8';
export type ActionId =
    | 'play' | 'cue' | 'cue.hold' | 'volume' | 'eq.low' | 'eq.mid' | 'eq.high' | 'filter' | 'tempo' | 'matchTempo' | 'startOnBeat' | 'align' | 'master.volume' | 'ready'
    | 'tempo.range' | 'bend.minus' | 'bend.plus' | 'jog' | 'jog.touch' | 'jog.search' | 'shift' | HotCueAction
    | 'beatjump.back' | 'beatjump.fwd' | 'beatjump.size.up' | 'beatjump.size.down'
    | 'loop.in' | 'loop.out' | 'loop.exit' | 'loop.reloop' | 'loop.half' | 'loop.double' | 'loop.auto' | 'loop.roll' | 'loop.size.up' | 'loop.size.down' | 'quantize';
export interface ActionDef { id: ActionId; label: string; kind: ActionKind }
const HOT: ActionDef[] = Array.from({ length: 8 }, (_, i) => ({ id: `hotcue.${i + 1}` as HotCueAction, label: `Hot cue ${'ABCDEFGH'[i]} (hold SHIFT to clear)`, kind: 'hold' as const }));
export const ACTIONS: readonly ActionDef[] = [
    { id: 'play', label: 'Play / Pause', kind: 'trigger' }, { id: 'cue', label: 'Cue (return to cue point)', kind: 'trigger' }, { id: 'cue.hold', label: 'CUE (CDJ: set / preview while held)', kind: 'hold' },
    { id: 'jog', label: 'Jog wheel (relative encoder)', kind: 'relative' }, { id: 'jog.touch', label: 'Jog touch', kind: 'hold' }, { id: 'jog.search', label: 'Search / shift jog', kind: 'hold' }, { id: 'shift', label: 'SHIFT', kind: 'hold' },
    { id: 'tempo', label: 'Tempo fader', kind: 'continuous' }, { id: 'tempo.range', label: 'Tempo range (cycle)', kind: 'trigger' }, { id: 'bend.minus', label: 'Pitch bend -', kind: 'hold' }, { id: 'bend.plus', label: 'Pitch bend +', kind: 'hold' },
    { id: 'matchTempo', label: 'Sync tempo to master', kind: 'trigger' }, { id: 'startOnBeat', label: 'Start on beat', kind: 'trigger' }, { id: 'align', label: 'Align to beat', kind: 'trigger' }, { id: 'quantize', label: 'Quantize on / off', kind: 'trigger' },
    ...HOT,
    { id: 'beatjump.back', label: 'Beat jump back', kind: 'trigger' }, { id: 'beatjump.fwd', label: 'Beat jump forward', kind: 'trigger' }, { id: 'beatjump.size.down', label: 'Beat jump size smaller', kind: 'trigger' }, { id: 'beatjump.size.up', label: 'Beat jump size larger', kind: 'trigger' },
    { id: 'loop.in', label: 'Loop in', kind: 'trigger' }, { id: 'loop.out', label: 'Loop out', kind: 'trigger' }, { id: 'loop.exit', label: 'Loop exit', kind: 'trigger' }, { id: 'loop.reloop', label: 'Reloop', kind: 'trigger' },
    { id: 'loop.half', label: 'Loop halve', kind: 'trigger' }, { id: 'loop.double', label: 'Loop double', kind: 'trigger' }, { id: 'loop.auto', label: 'Auto loop (selected size)', kind: 'trigger' }, { id: 'loop.roll', label: 'Loop roll (while held)', kind: 'hold' },
    { id: 'loop.size.down', label: 'Loop size smaller', kind: 'trigger' }, { id: 'loop.size.up', label: 'Loop size larger', kind: 'trigger' },
    { id: 'volume', label: 'Channel volume', kind: 'continuous' }, { id: 'eq.low', label: 'EQ low', kind: 'continuous' }, { id: 'eq.mid', label: 'EQ mid', kind: 'continuous' }, { id: 'eq.high', label: 'EQ high', kind: 'continuous' },
    { id: 'filter', label: 'Filter', kind: 'continuous' }, { id: 'master.volume', label: 'Master volume', kind: 'continuous' }, { id: 'ready', label: 'Ready / next round', kind: 'trigger' },
];

/** How a relative encoder (jog wheel, endless knob) encodes direction in a CC value 0..127. */
export type EncoderFormat = 'twos' | 'offset' | 'sign';
/** Decode a raw 0..127 CC value into signed ticks. twos: 1..63 = +n, 127..65 = -n. offset: 64 is zero. sign: bit 6 is the sign, the low 6 bits are the size. */
export function decodeRelative(raw: number, format: EncoderFormat): number {
    const v = raw & 0x7f;
    if (format === 'offset') return v - 64;
    if (format === 'sign') return v & 0x40 ? -(v & 0x3f) : v & 0x3f;
    return v < 64 ? v : v - 128;
}

export interface Binding {
    type: 'cc' | 'note'; channel: number; number: number; action: ActionId; device?: string;
    /** Relative actions only: how the encoder encodes direction (default twos). */
    encoder?: EncoderFormat;
    /** Reverse the direction of a continuous or relative control. */
    invert?: boolean;
    /** Relative actions only: multiplier on the ticks (default 1). */
    scale?: number;
}
export interface MidiMessage { type: 'cc' | 'note-on' | 'note-off' | 'other'; channel: number; number: number; value: number; device: string; /** the raw data byte 0..127 */ raw: number }

export type MidiStatus = 'idle' | 'unsupported' | 'insecure' | 'requesting' | 'granted' | 'denied' | 'error';

/** Minimal shapes of the Web MIDI objects, so the service can be tested with a fake and does not depend on lib.dom details. */
export interface MidiPortLike { id: string; name?: string | null; state?: string; type?: string; onmidimessage: ((e: { data: Uint8Array | null }) => void) | null }
export interface MidiAccessLike { inputs: { forEach(cb: (p: MidiPortLike) => void): void }; onstatechange: ((e: { port?: MidiPortLike | null }) => void) | null }

export function parseMidi(data: Uint8Array | null, device: string): MidiMessage {
    if (!data || data.length < 2) return { type: 'other', channel: 0, number: 0, value: 0, raw: 0, device };
    const status = data[0] & 0xf0, channel = data[0] & 0x0f, n = data[1] & 0x7f, v = (data[2] ?? 0) & 0x7f;
    if (status === 0xb0) return { type: 'cc', channel, number: n, value: v / 127, raw: v, device };
    if (status === 0x90) return v > 0 ? { type: 'note-on', channel, number: n, value: v / 127, raw: v, device } : { type: 'note-off', channel, number: n, value: 0, raw: 0, device };
    if (status === 0x80) return { type: 'note-off', channel, number: n, value: 0, raw: 0, device };
    return { type: 'other', channel, number: n, value: v / 127, raw: v, device };
}

const KEY = 'b2buddy.midi.v1';
export const DEFAULT_PROFILE = 'Default';

export interface MidiDeps {
    request?: (() => Promise<MidiAccessLike>) | null;      // navigator.requestMIDIAccess bound; null/undefined = unsupported
    secure?: boolean;
    storage: KeyValueStorage;
}

/**
 * Web MIDI controller support. Needs a user gesture to ask for permission (connect()), a secure context (https or localhost) and a browser that implements
 * the API. Everything it does is observable (status, device list, last messages) so the UI can show the truth; keyboard and mouse always work without it.
 *
 * Mappings live in named profiles (one is active). A binding can be tied to a device name so two controllers with the same note numbers do not collide.
 * No controller-specific profile is built in: nothing here has been tested against hardware, so every mapping is one the user makes with MIDI Learn.
 */
export class MidiService {
    status: MidiStatus = 'idle';
    error: string | null = null;
    devices: Array<{ id: string; name: string; connected: boolean }> = [];
    last: MidiMessage | null = null;
    /** The most recent messages, newest last, for the setup screen's input monitor. */
    recent: MidiMessage[] = [];
    bindings: Binding[] = [];
    profiles: Record<string, Binding[]> = { [DEFAULT_PROFILE]: [] };
    activeProfile = DEFAULT_PROFILE;
    learning: ActionId | null = null;
    private access: MidiAccessLike | null = null;
    private handler: (a: ActionId, value: number) => void = () => { };
    private listeners: Array<() => void> = [];
    private triggerHigh = new Map<string, boolean>();
    private heldActions = new Set<ActionId>();
    messageCount = 0;

    constructor(private readonly deps: MidiDeps) {
        if (!deps.request) this.status = 'unsupported';
        else if (deps.secure === false) this.status = 'insecure';
        try {
            const raw = deps.storage.getItem(KEY);
            if (raw) {
                const j = JSON.parse(raw);
                if (j && j.version === 2 && j.profiles && typeof j.profiles === 'object') {
                    const out: Record<string, Binding[]> = {};
                    for (const [name, list] of Object.entries(j.profiles as Record<string, unknown>)) if (Array.isArray(list)) out[name] = list.filter(isBinding);
                    if (Object.keys(out).length) { this.profiles = out; this.activeProfile = typeof j.active === 'string' && out[j.active] ? j.active : Object.keys(out)[0]; }
                } else if (j && Array.isArray(j.bindings)) this.profiles = { [DEFAULT_PROFILE]: j.bindings.filter(isBinding) };   // v1 (one mapping) becomes the Default profile
            }
        } catch { this.profiles = { [DEFAULT_PROFILE]: [] }; }
        this.activeProfile = this.profiles[this.activeProfile] ? this.activeProfile : Object.keys(this.profiles)[0];
        this.bindings = this.profiles[this.activeProfile];
    }

    subscribe(fn: () => void) { this.listeners.push(fn); return () => { this.listeners = this.listeners.filter(l => l !== fn); }; }
    private emit() { for (const l of this.listeners) l(); }
    onAction(fn: (a: ActionId, value: number) => void) { this.handler = fn; }
    get usable() { return this.status === 'granted'; }
    get statusText(): string {
        switch (this.status) {
            case 'unsupported': return 'This browser does not support Web MIDI. Keyboard and mouse controls are active. (Chrome, Edge and Opera support it; Firefox needs a site permission add-on; Safari does not.)';
            case 'insecure': return 'Web MIDI needs a secure page (https or localhost). Keyboard and mouse controls are active.';
            case 'denied': return 'MIDI permission was denied. Allow it in the browser site settings, then press Connect again.';
            case 'error': return 'MIDI could not start: ' + (this.error ?? 'unknown error');
            case 'requesting': return 'Waiting for the browser permission prompt…';
            case 'granted': return this.devices.some(d => d.connected) ? `${this.devices.filter(d => d.connected).length} MIDI input(s) connected` : 'MIDI is allowed but no controller is connected. Plug one in: it is detected automatically.';
            default: return 'MIDI is off. Press Connect (the browser asks permission).';
        }
    }

    /** Must be called from a click or key press. */
    async connect(): Promise<void> {
        if (!this.deps.request) { this.status = 'unsupported'; this.emit(); return; }
        if (this.deps.secure === false) { this.status = 'insecure'; this.emit(); return; }
        this.status = 'requesting'; this.error = null; this.emit();
        try {
            this.access = await this.deps.request();
            this.status = 'granted'; this.refresh();
            this.access.onstatechange = () => { this.refresh(); };
        } catch (e) {
            const name = (e as { name?: string }).name; this.error = (e as Error).message || String(e);
            this.status = name === 'SecurityError' || name === 'NotAllowedError' ? 'denied' : 'error';
        }
        this.emit();
    }

    private refresh() {
        if (!this.access) return;
        const was = new Map(this.devices.map(d => [d.id, d.connected]));
        const seen: Array<{ id: string; name: string; connected: boolean }> = [];
        this.access.inputs.forEach(p => {
            seen.push({ id: p.id, name: p.name || 'MIDI input', connected: (p.state ?? 'connected') === 'connected' });
            p.onmidimessage = e => this.receive(parseMidi(e.data, p.name || 'MIDI input'));
        });
        // a controller that vanished may have been holding a button or a jog: release everything so nothing is stuck
        const lost = seen.some(d => !d.connected && was.get(d.id) === true) || [...was.keys()].some(id => !seen.some(d => d.id === id));
        this.devices = seen; if (lost) this.releaseAll(); this.emit();
    }

    /** Release every held (momentary) action as if the buttons were let go. Called on disconnect, window blur, learn, and any mapping change. */
    releaseAll() {
        const held = [...this.heldActions]; this.heldActions.clear(); this.triggerHigh.clear();
        for (const a of held) this.handler(a, 0);
    }

    // ---------------------------------------------------------------- learn & mapping
    startLearn(action: ActionId) { this.releaseAll(); this.learning = action; this.emit(); }
    cancelLearn() { this.learning = null; this.emit(); }
    bindingFor(action: ActionId) { return this.bindings.find(b => b.action === action); }
    removeBinding(action: ActionId) { this.releaseAll(); this.bindings = this.bindings.filter(b => b.action !== action); this.commit(); }
    clearBindings() { this.releaseAll(); this.bindings = []; this.commit(); }
    /** Edit how an existing binding is interpreted (encoder format, direction, scale). */
    updateBinding(action: ActionId, patch: Partial<Pick<Binding, 'encoder' | 'invert' | 'scale'>>) {
        const i = this.bindings.findIndex(b => b.action === action); if (i < 0) return false;
        const next = { ...this.bindings[i], ...patch }; if (!isBinding(next)) return false;
        this.releaseAll(); this.bindings[i] = next; this.commit(); return true;
    }
    private commit() { this.profiles[this.activeProfile] = this.bindings; this.save(); this.emit(); }

    get profileNames() { return Object.keys(this.profiles); }
    createProfile(name: string, copyActive = false): boolean {
        const n = name.trim().slice(0, 40); if (!n || this.profiles[n]) return false;
        this.releaseAll(); this.profiles[n] = copyActive ? this.bindings.map(b => ({ ...b })) : []; this.activeProfile = n; this.bindings = this.profiles[n]; this.save(); this.emit(); return true;
    }
    switchProfile(name: string): boolean {
        if (!this.profiles[name]) return false;
        this.releaseAll(); this.activeProfile = name; this.bindings = this.profiles[name]; this.save(); this.emit(); return true;
    }
    deleteProfile(name: string): boolean {
        if (!this.profiles[name] || Object.keys(this.profiles).length <= 1) return false;
        this.releaseAll(); delete this.profiles[name];
        if (this.activeProfile === name) { this.activeProfile = Object.keys(this.profiles)[0]; this.bindings = this.profiles[this.activeProfile]; }
        this.save(); this.emit(); return true;
    }
    /** The active profile as JSON. Stays readable by older exports: `version` 1 with `bindings`, plus the profile name. */
    exportMapping() { return JSON.stringify({ version: 1, profile: this.activeProfile, bindings: this.bindings }, null, 2); }
    /** Import replaces the active profile's bindings (a v1 or v2 export of one profile). */
    importMapping(json: string): boolean {
        try { const j = JSON.parse(json); if (!Array.isArray(j.bindings) || !j.bindings.every(isBinding)) return false; this.releaseAll(); this.bindings = j.bindings; this.commit(); return true; } catch { return false; }
    }
    private save() { try { this.deps.storage.setItem(KEY, JSON.stringify({ version: 2, active: this.activeProfile, profiles: this.profiles })); } catch { /* storage blocked: mapping lasts for this session only */ } }

    /** Entry point for every incoming message (also used by tests and the on-screen monitor). */
    receive(m: MidiMessage) {
        this.recent.push(m); if (this.recent.length > 12) this.recent.shift();
        if (m.type === 'other') return;
        const type: Binding['type'] = m.type === 'cc' ? 'cc' : 'note';
        if (m.type === 'note-off') {
            const id = `note:${m.channel}:${m.number}`; this.triggerHigh.set(id, false);
            const b = this.matching(type, m); if (b && ACTIONS.find(a => a.id === b.action)?.kind === 'hold') this.releaseHold(b.action);
            this.emit(); return;
        }
        this.last = m; this.messageCount++;
        if (this.learning) {
            const action = this.learning; this.learning = null;
            const prev = this.bindingFor(action);
            this.bindings = this.bindings.filter(b => b.action !== action && !(b.type === type && b.channel === m.channel && b.number === m.number && (!b.device || b.device === m.device)));
            this.bindings.push({ type, channel: m.channel, number: m.number, action, device: m.device, ...(prev?.encoder ? { encoder: prev.encoder } : {}), ...(prev?.invert ? { invert: true } : {}), ...(prev?.scale ? { scale: prev.scale } : {}) });
            this.commit(); return;
        }
        const b = this.matching(type, m); this.emit();
        if (!b) return;
        const def = ACTIONS.find(a => a.id === b.action)!;
        const sign = b.invert ? -1 : 1;
        if (def.kind === 'continuous') { if (type === 'cc') this.handler(b.action, b.invert ? 1 - m.value : m.value); return; }
        if (def.kind === 'relative') { if (type === 'cc') { const t = decodeRelative(m.raw, b.encoder ?? 'twos'); if (t !== 0) this.handler(b.action, t * sign * (b.scale ?? 1)); } return; }
        const id = `${type}:${m.channel}:${m.number}`; const high = type === 'note' ? true : m.value >= 0.5;
        const was = this.triggerHigh.get(id) ?? false; this.triggerHigh.set(id, high);
        if (def.kind === 'hold') {
            if (high && !was) { this.heldActions.add(b.action); this.handler(b.action, 1); }
            else if (!high && was) this.releaseHold(b.action);
            return;
        }
        if (high && !was) this.handler(b.action, 1);
    }

    private releaseHold(action: ActionId) { if (this.heldActions.delete(action)) this.handler(action, 0); }
    private matching(type: Binding['type'], m: MidiMessage) { return this.bindings.find(x => x.type === type && x.channel === m.channel && x.number === m.number && (!x.device || x.device === m.device)); }
}

function isBinding(b: unknown): b is Binding {
    const x = b as Binding;
    return !!x && (x.type === 'cc' || x.type === 'note') && Number.isInteger(x.channel) && x.channel >= 0 && x.channel < 16 && Number.isInteger(x.number) && x.number >= 0 && x.number < 128
        && ACTIONS.some(a => a.id === x.action) && (x.encoder === undefined || x.encoder === 'twos' || x.encoder === 'offset' || x.encoder === 'sign')
        && (x.scale === undefined || (typeof x.scale === 'number' && Number.isFinite(x.scale) && x.scale > 0 && x.scale <= 50)) && (x.invert === undefined || typeof x.invert === 'boolean') && (x.device === undefined || typeof x.device === 'string');
}

/** Real browser dependencies, resolved lazily so the module is safe to import anywhere. */
export function browserMidiDeps(storage: KeyValueStorage): MidiDeps {
    const nav = (typeof navigator !== 'undefined' ? navigator : undefined) as (Navigator & { requestMIDIAccess?: () => Promise<unknown> }) | undefined;
    return { request: nav?.requestMIDIAccess ? () => nav.requestMIDIAccess!() as Promise<MidiAccessLike> : null, secure: typeof window !== 'undefined' ? window.isSecureContext : true, storage };
}
