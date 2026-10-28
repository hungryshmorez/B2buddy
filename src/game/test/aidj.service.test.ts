import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { spawn, ChildProcess } from 'node:child_process';
import { resolve } from 'node:path';
import { AiDjServiceBrain, AiDjTsBrain } from '../dj/brain';
import { DEMO_TRACKS } from '../audio/catalog';
import { Sim } from './sim';

/** INTEGRATION: the browser-side brain against the REAL Python service (the fork's own code). Needs Python deps (services/aidj/requirements.txt):
 *    AIDJ_PYTHON=/path/to/python npm test            (skipped, loudly, when AIDJ_PYTHON is not set) */
const PY = process.env.AIDJ_PYTHON; const PORT = 18000 + Math.floor(Math.random() * 1000);
const d = PY ? describe : describe.skip;
let proc: ChildProcess | null = null;
if (!PY) console.warn('[aidj.service.test] SKIPPED: set AIDJ_PYTHON to a Python with services/aidj/requirements.txt installed to run the real-service integration tests');

d('browser brain <-> real AI DJ Python service', () => {
    beforeAll(async () => {
        proc = spawn(PY!, [resolve(__dirname, '../../../services/aidj/server.py'), '--port', String(PORT)], { stdio: 'ignore' });
        for (let i = 0; i < 100; i++) { try { const r = await fetch(`http://127.0.0.1:${PORT}/v1/health`); if (r.ok) return; } catch { /* not up yet */ } await new Promise(r => setTimeout(r, 200)); }
        throw new Error('service did not start');
    }, 30000);
    afterAll(() => { proc?.kill(); });

    it('the real service answers every plan and ranking for the bundled tracks exactly as the TS port does', async () => {
        const svc = new AiDjServiceBrain(`http://127.0.0.1:${PORT}`); await svc.connect(); const n = await svc.warm(DEMO_TRACKS); const k = DEMO_TRACKS.length;
        expect(svc.error).toBeUndefined(); expect(n).toBe(k * (k - 1) + k);
        const ts = new AiDjTsBrain(); const strip = <T extends { source: string }>(x: T) => ({ ...x, source: '' });
        for (const a of DEMO_TRACKS) { for (const b of DEMO_TRACKS) if (a.id !== b.id) expect(strip(svc.plan(a, b))).toEqual(strip(ts.plan(a, b))); expect(svc.rank(a, DEMO_TRACKS, new Set()).map(strip)).toEqual(ts.rank(a, DEMO_TRACKS, new Set()).map(strip)); }
        expect(svc.status().fallbackCalls).toBe(0); expect(svc.status().mode).toBe('service');
    }, 60000);

    it('a whole Expert battle driven by the real service completes with no refused command and labels every decision "aidj-service"', async () => {
        const svc = new AiDjServiceBrain(`http://127.0.0.1:${PORT}`); await svc.connect(); await svc.warm(DEMO_TRACKS);
        const sim = new Sim('expert', { roundSeconds: 90, bestOf: 1, countInBars: 1 }, undefined, 2, DEMO_TRACKS, svc); sim.ai.prepare(); sim.session.startRound(); sim.runUntil('matchEnd', 300);
        const src = sim.ai.decisions.filter(x => x.source); expect(src.length).toBeGreaterThan(0); expect(src.every(x => x.source === 'aidj-service')).toBe(true);
        expect(sim.session.phase).toBe('matchEnd'); expect(sim.port.refused).toBe(0); expect(svc.status().fallbackCalls).toBe(0);
    }, 60000);

    it('measured analysis of a real WAV comes back from librosa and the service survives a refusal afterwards', async () => {
        const sr = 22050, n = sr * 20, pcm = new Int16Array(n); const beat = Math.round(sr * 60 / 128);
        for (let k = 0; k * beat < n - 3000; k++) for (let i = 0; i < 2500; i++) pcm[k * beat + i] = Math.round(Math.sin(2 * Math.PI * 70 * i / sr) * Math.exp(-i / 500) * 30000);
        const { encodeWav } = await import('../dj/wav'); const wav = encodeWav(Float32Array.from(pcm, v => v / 32768), sr);
        const r = await fetch(`http://127.0.0.1:${PORT}/v1/analyze`, { method: 'POST', body: wav, headers: { 'Content-Type': 'audio/wav', 'X-Track-Id': 'k128' } }); const j = await r.json() as { origin: string; bpmBeatTrack: number; trackId: string };
        expect(r.status).toBe(200); expect(j.origin).toBe('measured'); expect(j.trackId).toBe('k128'); expect(Math.abs(j.bpmBeatTrack - 128)).toBeLessThan(4);
        const bad = await fetch(`http://127.0.0.1:${PORT}/v1/analyze`, { method: 'POST', body: 'nope', headers: { 'Content-Type': 'audio/wav' } }); expect(bad.status).toBe(400);
        expect((await fetch(`http://127.0.0.1:${PORT}/v1/health`)).ok).toBe(true);
    }, 60000);
});
