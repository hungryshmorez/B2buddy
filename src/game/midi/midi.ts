import { KeyValueStorage } from '../memory/store';

export type ActionId =
    | 'play' | 'cue' | 'volume' | 'eq.low' | 'eq.mid' | 'eq.high' | 'filter' | 'tempo' | 'matchTempo' | 'startOnBeat' | 'align' | 'master.volume' | 'ready';
export interface ActionDef { id: ActionId; label: string; kind: 'trigger' | 'continuous' }
export const ACTIONS: readonly ActionDef[] = [
    { id: 'play', label: 'Play / Pause', kind: 'trigger' }, { id: 'cue', label: 'Cue', kind: 'trigger' },
    { id: 'volume', label: 'Channel volume', kind: 'continuous' }, { id: 'eq.low', label: 'EQ low', kind: 'continuous' }, { id: 'eq.mid', label: 'EQ mid', kind: 'continuous' }, { id: 'eq.high', label: 'EQ high', kind: 'continuous' },
    { id: 'filter', label: 'Filter', kind: 'continuous' }, { id: 'tempo', label: 'Tempo fader', kind: 'continuous' },
    { id: 'matchTempo', label: 'Match tempo to master', kind: 'trigger' }, { id: 'startOnBeat', label: 'Start on beat', kind: 'trigger' }, { id: 'align', label: 'Align to beat', kind: 'trigger' },
    { id: 'master.volume', label: 'Master volume', kind: 'continuous' }, { id: 'ready', label: 'Ready / next round', kind: 'trigger' },
];

export interface Binding { type: 'cc' | 'note'; channel: number; number: number; action: ActionId; device?: string }
export interface MidiMessage { type: 'cc' | 'note-on' | 'note-off' | 'other'; channel: number; number: number; value: number; device: string }

export type MidiStatus = 'idle' | 'unsupported' | 'insecure' | 'requesting' | 'granted' | 'denied' | 'error';

/** Minimal shapes of the Web MIDI objects, so the service can be tested with a fake and does not depend on lib.dom details. */
export interface MidiPortLike { id: string; name?: string | null; state?: string; type?: string; onmidimessage: ((e: { data: Uint8Array | null }) => void) | null }
export interface MidiAccessLike { inputs: { forEach(cb: (p: MidiPortLike) => void): void }; onstatechange: ((e: { port?: MidiPortLike | null }) => void) | null }

export function parseMidi(data: Uint8Array | null, device: string): MidiMessage {
    if (!data || data.length < 2) return { type: 'other', channel: 0, number: 0, value: 0, device };
    const status = data[0] & 0xf0, channel = data[0] & 0x0f, n = data[1] & 0x7f, v = (data[2] ?? 0) & 0x7f;
    if (status === 0xb0) return { type: 'cc', channel, number: n, value: v / 127, device };
    if (status === 0x90) return v > 0 ? { type: 'note-on', channel, number: n, value: v / 127, device } : { type: 'note-off', channel, number: n, value: 0, device };
    if (status === 0x80) return { type: 'note-off', channel, number: n, value: 0, device };
    return { type: 'other', channel, number: n, value: v / 127, device };
}

const KEY = 'b2buddy.midi.v1';

export interface MidiDeps {
    request?: (() => Promise<MidiAccessLike>) | null;      // navigator.requestMIDIAccess bound; null/undefined = unsupported
    secure?: boolean;
    storage: KeyValueStorage;
}

/**
 * Web MIDI controller support. Needs a user gesture to ask for permission (connect()), a secure context (https or localhost) and a browser that implements
 * the API. Everything it does is observable (status, device list, last message) so the UI can show the truth; keyboard and mouse always work without it.
 */
export class MidiService {
    status: MidiStatus = 'idle';
    error: string | null = null;
    devices: Array<{ id: string; name: string; connected: boolean }> = [];
    last: MidiMessage | null = null;
    bindings: Binding[] = [];
    learning: ActionId | null = null;
    private access: MidiAccessLike | null = null;
    private handler: (a: ActionId, value: number) => void = () => { };
    private listeners: Array<() => void> = [];
    private triggerHigh = new Map<string, boolean>();
    messageCount = 0;

    constructor(private readonly deps: MidiDeps) {
        if (!deps.request) this.status = 'unsupported';
        else if (deps.secure === false) this.status = 'insecure';
        try { const raw = deps.storage.getItem(KEY); if (raw) { const j = JSON.parse(raw); if (Array.isArray(j.bindings)) this.bindings = j.bindings.filter(isBinding); } } catch { this.bindings = []; }
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
        const seen: Array<{ id: string; name: string; connected: boolean }> = [];
        this.access.inputs.forEach(p => {
            seen.push({ id: p.id, name: p.name || 'MIDI input', connected: (p.state ?? 'connected') === 'connected' });
            p.onmidimessage = e => this.receive(parseMidi(e.data, p.name || 'MIDI input'));
        });
        this.devices = seen; this.emit();
    }

    // ---------------------------------------------------------------- learn & mapping
    startLearn(action: ActionId) { this.learning = action; this.emit(); }
    cancelLearn() { this.learning = null; this.emit(); }
    bindingFor(action: ActionId) { return this.bindings.find(b => b.action === action); }
    removeBinding(action: ActionId) { this.bindings = this.bindings.filter(b => b.action !== action); this.save(); this.emit(); }
    clearBindings() { this.bindings = []; this.save(); this.emit(); }
    exportMapping() { return JSON.stringify({ version: 1, bindings: this.bindings }, null, 2); }
    importMapping(json: string): boolean {
        try { const j = JSON.parse(json); if (!Array.isArray(j.bindings) || !j.bindings.every(isBinding)) return false; this.bindings = j.bindings; this.save(); this.emit(); return true; } catch { return false; }
    }
    private save() { try { this.deps.storage.setItem(KEY, JSON.stringify({ version: 1, bindings: this.bindings })); } catch { /* storage blocked: mapping lasts for this session only */ } }

    /** Entry point for every incoming message (also used by tests and the on-screen monitor). */
    receive(m: MidiMessage) {
        if (m.type === 'other' || m.type === 'note-off') { if (m.type === 'note-off') this.triggerHigh.set(`note:${m.channel}:${m.number}`, false); return; }
        this.last = m; this.messageCount++;
        const type: Binding['type'] = m.type === 'cc' ? 'cc' : 'note';
        if (this.learning) {
            const action = this.learning; this.learning = null;
            this.bindings = this.bindings.filter(b => b.action !== action && !(b.type === type && b.channel === m.channel && b.number === m.number));
            this.bindings.push({ type, channel: m.channel, number: m.number, action, device: m.device }); this.save(); this.emit(); return;
        }
        const b = this.bindings.find(x => x.type === type && x.channel === m.channel && x.number === m.number); this.emit();
        if (!b) return;
        const def = ACTIONS.find(a => a.id === b.action)!;
        if (def.kind === 'continuous') { if (type === 'cc') this.handler(b.action, m.value); return; }
        const id = `${type}:${m.channel}:${m.number}`; const high = type === 'note' ? true : m.value >= 0.5;
        const was = this.triggerHigh.get(id) ?? false; this.triggerHigh.set(id, high);
        if (high && !was) this.handler(b.action, 1);
    }
}

function isBinding(b: unknown): b is Binding {
    const x = b as Binding; return !!x && (x.type === 'cc' || x.type === 'note') && Number.isInteger(x.channel) && x.channel >= 0 && x.channel < 16 && Number.isInteger(x.number) && x.number >= 0 && x.number < 128 && ACTIONS.some(a => a.id === x.action);
}

/** Real browser dependencies, resolved lazily so the module is safe to import anywhere. */
export function browserMidiDeps(storage: KeyValueStorage): MidiDeps {
    const nav = (typeof navigator !== 'undefined' ? navigator : undefined) as (Navigator & { requestMIDIAccess?: () => Promise<unknown> }) | undefined;
    return { request: nav?.requestMIDIAccess ? () => nav.requestMIDIAccess!() as Promise<MidiAccessLike> : null, secure: typeof window !== 'undefined' ? window.isSecureContext : true, storage };
}
