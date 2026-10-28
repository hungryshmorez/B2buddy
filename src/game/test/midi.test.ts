import { describe, expect, it } from 'vitest';
import { MemoryStorage } from '../memory/store';
import { ActionId, MidiAccessLike, MidiPortLike, MidiService, parseMidi } from '../midi/midi';

function fakeAccess() {
    const ports: MidiPortLike[] = [{ id: '1', name: 'Fake Controller', state: 'connected', type: 'input', onmidimessage: null }];
    const access: MidiAccessLike = { inputs: { forEach: cb => ports.forEach(cb) }, onstatechange: null };
    const send = (bytes: number[]) => ports[0].onmidimessage?.({ data: new Uint8Array(bytes) });
    return { access, ports, send };
}

describe('Web MIDI service (fake access; no hardware was used)', () => {
    it('reports unsupported / insecure / denied states with a keyboard fallback message', async () => {
        expect(new MidiService({ request: null, storage: new MemoryStorage() }).status).toBe('unsupported');
        expect(new MidiService({ request: async () => fakeAccess().access, secure: false, storage: new MemoryStorage() }).status).toBe('insecure');
        const denied = new MidiService({ request: async () => { throw Object.assign(new Error('blocked'), { name: 'SecurityError' }); }, secure: true, storage: new MemoryStorage() });
        await denied.connect(); expect(denied.status).toBe('denied'); expect(denied.statusText).toMatch(/denied/);
        expect(new MidiService({ request: null, storage: new MemoryStorage() }).statusText).toMatch(/Keyboard and mouse/);
    });
    it('connects, lists devices, learns a CC and a note, and dispatches actions', async () => {
        const f = fakeAccess(); const m = new MidiService({ request: async () => f.access, secure: true, storage: new MemoryStorage() });
        const got: Array<[ActionId, number]> = []; m.onAction((a, v) => got.push([a, v]));
        await m.connect(); expect(m.status).toBe('granted'); expect(m.devices).toEqual([{ id: '1', name: 'Fake Controller', connected: true }]);
        m.startLearn('volume'); f.send([0xb0, 7, 64]); expect(m.bindingFor('volume')).toMatchObject({ type: 'cc', channel: 0, number: 7 });
        m.startLearn('play'); f.send([0x91, 36, 100]); expect(m.bindingFor('play')).toMatchObject({ type: 'note', channel: 1, number: 36 });
        f.send([0xb0, 7, 127]); expect(got[got.length - 1]).toEqual(['volume', 1]); f.send([0xb0, 7, 0]); expect(got[got.length - 1][1]).toBe(0);
        f.send([0x91, 36, 100]); f.send([0x81, 36, 0]); f.send([0x91, 36, 90]); expect(got.filter(g => g[0] === 'play')).toHaveLength(2);        // each press once
        f.send([0xb0, 99, 5]); expect(got.length).toBe(4);                                                                                           // unmapped control ignored
    });
    it('remapping a control replaces the old binding; mappings persist, export and import', async () => {
        const st = new MemoryStorage(); const f = fakeAccess(); const m = new MidiService({ request: async () => f.access, secure: true, storage: st }); await m.connect();
        m.startLearn('volume'); f.send([0xb0, 7, 1]); m.startLearn('filter'); f.send([0xb0, 7, 1]);
        expect(m.bindingFor('volume')).toBeUndefined(); expect(m.bindingFor('filter')?.number).toBe(7);
        const again = new MidiService({ request: null, storage: st }); expect(again.bindingFor('filter')?.number).toBe(7);
        const json = m.exportMapping(); const other = new MidiService({ request: null, storage: new MemoryStorage() }); expect(other.importMapping(json)).toBe(true); expect(other.bindings).toHaveLength(1);
        expect(other.importMapping('{"bindings":[{"type":"cc","channel":99,"number":1,"action":"play"}]}')).toBe(false); expect(other.importMapping('nope')).toBe(false);
    });
    it('handles unplug and replug through statechange', async () => {
        const f = fakeAccess(); const m = new MidiService({ request: async () => f.access, secure: true, storage: new MemoryStorage() }); await m.connect();
        f.ports[0].state = 'disconnected'; f.access.onstatechange?.({ port: f.ports[0] }); expect(m.devices[0].connected).toBe(false); expect(m.statusText).toMatch(/no controller/);
        f.ports[0].state = 'connected'; f.access.onstatechange?.({ port: f.ports[0] }); expect(m.devices[0].connected).toBe(true);
    });
    it('parses note-on velocity 0 as note-off and ignores malformed data', () => {
        expect(parseMidi(new Uint8Array([0x90, 60, 0]), 'x').type).toBe('note-off'); expect(parseMidi(null, 'x').type).toBe('other'); expect(parseMidi(new Uint8Array([0xf8]), 'x').type).toBe('other');
    });
});
