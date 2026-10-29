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

import { decodeRelative } from '../midi/midi';

describe('MIDI for the CDJ controls (fake access; no hardware was used)', () => {
    const setup = async (storage = new MemoryStorage()) => {
        const f = fakeAccess(); const m = new MidiService({ request: async () => f.access, secure: true, storage }); await m.connect();
        const got: Array<[ActionId, number]> = []; m.onAction((a, v) => got.push([a, v])); return { f, m, got, storage };
    };
    it('decodes the three relative encoder formats', () => {
        expect([1, 2, 63, 127, 126, 65].map(v => decodeRelative(v, 'twos'))).toEqual([1, 2, 63, -1, -2, -63]);
        expect([64, 65, 63, 70, 58].map(v => decodeRelative(v, 'offset'))).toEqual([0, 1, -1, 6, -6]);
        expect([1, 5, 0x41, 0x45].map(v => decodeRelative(v, 'sign'))).toEqual([1, 5, -1, -5]);
    });
    it('a relative jog delivers signed ticks, honours format, invert and scale, and ignores zero', async () => {
        const { f, m, got } = await setup(); m.startLearn('jog'); f.send([0xb0, 33, 1]);
        f.send([0xb0, 33, 3]); f.send([0xb0, 33, 125]); expect(got).toEqual([['jog', 3], ['jog', -3]]);
        m.updateBinding('jog', { encoder: 'offset', invert: true, scale: 2 }); got.length = 0; f.send([0xb0, 33, 66]); f.send([0xb0, 33, 64]); expect(got).toEqual([['jog', -4]]);
        m.updateBinding('jog', { encoder: 'twos', invert: false, scale: undefined }); expect(m.bindingFor('jog')?.scale).toBeUndefined();
    });
    it('a note on a relative action is ignored (it is not an encoder)', async () => {
        const { f, m, got } = await setup(); m.startLearn('jog'); f.send([0x90, 20, 100]); got.length = 0; f.send([0x90, 20, 100]); expect(got).toEqual([]);
    });
    it('hold actions deliver press and release for notes and for CC buttons', async () => {
        const { f, m, got } = await setup(); m.startLearn('hotcue.3'); f.send([0x99, 40, 100]); m.startLearn('bend.plus'); f.send([0xb0, 50, 127]);
        f.send([0x99, 40, 100]); f.send([0x89, 40, 0]); f.send([0xb0, 50, 127]); f.send([0xb0, 50, 0]);
        expect(got).toEqual([['hotcue.3', 1], ['hotcue.3', 0], ['bend.plus', 1], ['bend.plus', 0]]);
    });
    it('a note-on with velocity 0 releases a hold', async () => {
        const { f, m, got } = await setup(); m.startLearn('cue.hold'); f.send([0x90, 7, 100]); f.send([0x90, 7, 100]); f.send([0x90, 7, 0]); expect(got).toEqual([['cue.hold', 1], ['cue.hold', 0]]);
    });
    it('unplugging a controller releases everything it held (no stuck buttons)', async () => {
        const { f, m, got } = await setup(); m.startLearn('jog.touch'); f.send([0x90, 9, 100]); m.startLearn('loop.roll'); f.send([0x90, 10, 100]); got.length = 0;
        f.send([0x90, 9, 100]); f.send([0x90, 10, 100]); expect(got.map(g => g[1])).toEqual([1, 1]);
        f.ports[0].state = 'disconnected'; f.access.onstatechange?.({ port: f.ports[0] }); expect(got.slice(2).map(g => g[1]).sort()).toEqual([0, 0]);
        f.ports[0].state = 'connected'; f.access.onstatechange?.({ port: f.ports[0] }); f.send([0x90, 9, 100]); expect(got[got.length - 1]).toEqual(['jog.touch', 1]);    // works again after replug
    });
    it('releaseAll (window blur) and changing a mapping also release held actions', async () => {
        const { f, m, got } = await setup(); m.startLearn('bend.minus'); f.send([0x90, 3, 100]); f.send([0x90, 3, 100]); got.length = 0;
        m.releaseAll(); expect(got).toEqual([['bend.minus', 0]]); f.send([0x90, 3, 100]); got.length = 0; m.removeBinding('bend.minus'); expect(got).toEqual([['bend.minus', 0]]);
    });
    it('a binding tied to a device ignores another device with the same note numbers', async () => {
        const { f, m, got } = await setup(); m.startLearn('quantize'); f.send([0x90, 5, 100]); got.length = 0;
        m.receive({ type: 'note-on', channel: 0, number: 5, value: 1, raw: 127, device: 'Other Controller' }); expect(got).toEqual([]);
        f.send([0x80, 5, 0]); f.send([0x90, 5, 100]); expect(got).toEqual([['quantize', 1]]);
    });
    it('continuous controls can be inverted', async () => {
        const { f, m, got } = await setup(); m.startLearn('tempo'); f.send([0xb0, 11, 0]); m.updateBinding('tempo', { invert: true }); f.send([0xb0, 11, 127]); expect(got[got.length - 1]).toEqual(['tempo', 0]);
    });
    it('keeps a log of recent messages for the setup screen', async () => {
        const { f, m } = await setup(); for (let i = 0; i < 20; i++) f.send([0xb0, 1, i]); expect(m.recent).toHaveLength(12); expect(m.recent[11].raw).toBe(19);
    });
    it('profiles: create, switch, persist, delete; a v1 mapping migrates into Default', async () => {
        const st = new MemoryStorage(); st.setItem('b2buddy.midi.v1', JSON.stringify({ version: 1, bindings: [{ type: 'cc', channel: 0, number: 7, action: 'volume' }] }));
        const { f, m } = await setup(st); expect(m.activeProfile).toBe('Default'); expect(m.bindingFor('volume')?.number).toBe(7);
        expect(m.createProfile('My controller')).toBe(true); expect(m.bindings).toHaveLength(0); expect(m.createProfile('My controller')).toBe(false);
        m.startLearn('play'); f.send([0x90, 1, 100]); expect(m.switchProfile('Default')).toBe(true); expect(m.bindingFor('play')).toBeUndefined(); expect(m.bindingFor('volume')).toBeDefined();
        const again = new MidiService({ request: null, storage: st }); expect(again.profileNames.sort()).toEqual(['Default', 'My controller']); expect(again.activeProfile).toBe('Default');
        expect(again.switchProfile('My controller')).toBe(true); expect(again.bindingFor('play')).toBeDefined();
        expect(again.deleteProfile('My controller')).toBe(true); expect(again.activeProfile).toBe('Default'); expect(again.deleteProfile('Default')).toBe(false);
    });
    it('import and export round-trip the new binding fields and reject invalid ones', async () => {
        const { f, m } = await setup(); m.startLearn('jog'); f.send([0xb0, 33, 1]); m.updateBinding('jog', { encoder: 'sign', scale: 3 });
        const json = m.exportMapping(); const other = new MidiService({ request: null, storage: new MemoryStorage() }); expect(other.importMapping(json)).toBe(true); expect(other.bindingFor('jog')).toMatchObject({ encoder: 'sign', scale: 3 });
        expect(other.importMapping('{"bindings":[{"type":"cc","channel":0,"number":1,"action":"jog","encoder":"bogus"}]}')).toBe(false);
    });
    it('every CDJ function can be mapped: hot cues A-H, beat jump, loops, bend, quantize, jog', () => {
        const have = new Set(ACTIONS.map(a => a.id as string));
        const need = ['hotcue.1', 'hotcue.2', 'hotcue.3', 'hotcue.4', 'hotcue.5', 'hotcue.6', 'hotcue.7', 'hotcue.8', 'beatjump.back', 'beatjump.fwd', 'loop.in', 'loop.out', 'loop.exit', 'loop.reloop', 'loop.half', 'loop.double', 'loop.roll', 'bend.minus', 'bend.plus', 'quantize', 'jog', 'jog.touch', 'cue.hold', 'tempo'];
        expect(need.filter(n => !have.has(n))).toEqual([]);
    });
});
import { ACTIONS } from '../midi/midi';
