// INTEGRATION run: B2Buddy + the real AI DJ (decision logic, and the fork's Python service when AIDJ_PYTHON is set) + the real BENDR engine, in a real browser.
// Usage: CHROMIUM=/path/to/chromium [AIDJ_PYTHON=/path/to/python] URL=http://localhost:4173/ node e2e/integration.mjs   (needs `npm run build` + `vite preview`)
// Battle rounds are shortened to 30 s and the show to 150 s through the runtime options; BENDR renders at only a few fps on software GL, so waits are patient.
import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const URL = process.env.URL || 'http://localhost:4173/'; const OUT = process.env.OUT || 'e2e/out'; fs.mkdirSync(OUT, { recursive: true });
const PY = process.env.AIDJ_PYTHON; const PORT = 18500 + Math.floor(Math.random() * 400); const SVC = `http://127.0.0.1:${PORT}`;
const sleep = ms => new Promise(r => setTimeout(r, ms)); const report = [];
const ok = (name, cond, extra = '') => { report.push({ name, pass: !!cond, extra }); console.log(cond ? 'PASS' : 'FAIL', name, extra); };
const skip = (name, why) => { report.push({ name, pass: true, skipped: true, extra: why }); console.log('SKIP', name, '-', why); };

let svcProc = null;
if (PY) {
    svcProc = spawn(PY, [path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../services/aidj/server.py'), '--port', String(PORT)], { stdio: 'ignore' });
    for (let i = 0; i < 100; i++) { try { if ((await fetch(SVC + '/v1/health')).ok) break; } catch { /* starting */ } await sleep(200); }
}
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM || undefined, args: ['--autoplay-policy=no-user-gesture-required', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
console.log('browser', browser.version(), '| AI DJ python service:', PY ? SVC : 'NOT RUN (AIDJ_PYTHON unset)');
const ctx = await browser.newContext({ viewport: { width: 1360, height: 900 } }); const page = await ctx.newPage();
const errors = []; let expectErrors = false; const expected = [];
page.on('pageerror', e => errors.push('PAGEERROR ' + e)); page.on('console', m => { if (m.type() === 'error') (expectErrors ? expected : errors).push(m.text().slice(0, 200)); });
page.on('dialog', d => d.accept());

const rt = fn => page.evaluate(fn); const engine = () => page.evaluate(() => { const s = window.__b2bVideo.status(); return { ...s, bypass: window.__b2bVideo.isBypassed(), sel: window.__b2bVideo.selected && window.__b2bVideo.selected.name }; });
const bendr = code => page.evaluate(c => [...document.querySelectorAll('iframe')].find(x => x.title === 'BENDR video engine').contentWindow.eval(c), code);
const frames = () => bendr('frameNo');
const waitFrames = async (n = 2, ms = 30000) => { const f0 = await frames(); await page.waitForFunction(([f]) => [...document.querySelectorAll('iframe')].find(x => x.title === 'BENDR video engine').contentWindow.eval('frameNo') >= f, [f0 + n], { timeout: ms }); };
const level = (ms = 1000) => page.evaluate(async ms => { const r = window.__b2b; let m = 0; const t0 = performance.now(); while (performance.now() - t0 < ms) { m = Math.max(m, r.masterLevel()); await new Promise(x => setTimeout(x, 30)); } return m; }, ms);
const sigOf = sel => page.evaluate(sel => { const c = document.createElement('canvas'); c.width = 64; c.height = 30; const g = c.getContext('2d'); g.drawImage(document.querySelector(sel), 0, 0, 64, 30); const d = g.getImageData(0, 0, 64, 30).data; const o = []; for (let i = 0; i < d.length; i += 4) o.push((d[i] + d[i + 1] + d[i + 2]) / 3); return o; }, sel);
const vsig = () => sigOf('video.bendr-out'), fsig = () => sigOf('.gvideo > canvas:not(.tfx-layer)');
const dist = (a, b) => a.reduce((s, v, i) => s + Math.abs(v - b[i]), 0) / a.length;
const status = () => page.textContent('[data-testid="fx-status"]');
const enter = async (qs = '') => { await page.goto(URL + qs); await page.click('button:has-text("CLICK TO ENTER")'); await page.waitForSelector('nav[aria-label="main menu"]'); };
const live = () => page.waitForFunction(() => window.__b2b.session && window.__b2b.session.phase === 'live', null, { timeout: 30000 });
const bendrReady = () => page.waitForFunction(() => /BENDR v/.test(document.querySelector('[data-testid="engine-status"]')?.textContent ?? ''), null, { timeout: 60000 });
const short = () => page.evaluate(() => { window.__b2b.options.roundSeconds = 30; window.__b2b.options.showSeconds = 150; });   // BENDR renders a few fps on software GL, so the show needs room for the effect checks

// ================================================================ 1. AI DJ runtime status, service connection, failure handling
await enter(); await short();
await page.click('button.gmenuitem:has-text("SETTINGS")');
ok('default DJ brain is the AI DJ decision logic (in-browser port), nothing else is claimed', /AI DJ logic, in-browser port/.test(await page.textContent('[data-testid="brain-status"]')));
expectErrors = true; await page.fill('input[aria-label="AI DJ service URL"]', 'http://127.0.0.1:1'); await page.click('button:has-text("CONNECT SERVICE")');
await page.waitForFunction(() => /unreachable/.test(document.querySelector('[data-testid="service-status"]').textContent), null, { timeout: 15000 }); expectErrors = false;
ok('an unreachable AI DJ service is reported and the in-browser AI DJ stays in charge', /unreachable/.test(await page.textContent('[data-testid="service-status"]')) && /in-browser port/.test(await page.textContent('[data-testid="brain-status"]')));
if (PY) {
    await page.fill('input[aria-label="AI DJ service URL"]', SVC); await page.click('button:has-text("CONNECT SERVICE")');
    await page.waitForFunction(() => /Service: connected/.test(document.querySelector('[data-testid="service-status"]').textContent), null, { timeout: 30000 });
    const bt = await page.textContent('[data-testid="brain-status"]');
    ok('the real AI DJ service connects and becomes the DJ brain (fork commit and librosa reported)', /AI DJ service/.test(bt) && /d56bd28/.test(bt) && /librosa/.test(bt), bt.trim().slice(0, 140));
    await page.click('button:has-text("TRACK LIBRARY")').catch(async () => { await page.click('button:has-text("BACK")'); await page.click('button.gmenuitem:has-text("TRACK LIBRARY")'); });
    await page.click('button:has-text("AI DJ ANALYSE") >> nth=0'); await page.waitForSelector('[data-testid^="measured-"]', { timeout: 90000 });
    const mt = await page.textContent('[data-testid^="measured-"]'); const decl = await page.evaluate(() => window.__b2b.tracks[0].bpm); const meas = parseFloat(mt.match(/analysed ([\d.]+) BPM/)[1]);
    const rel = [1, 2, 0.5].some(m => Math.abs(meas * m - decl) / decl < 0.04);
    const loc = await page.evaluate(() => { const r = window.__b2b; const id = r.tracks[0].id; const a = r.analysis.get(id); return { declaredKey: r.tracks[0].key, keyOrigin: r.tracks[0].keyOrigin, bpmOrigin: r.tracks[0].bpmOrigin, local: a && a.local && { key: a.local.key, keyOrigin: a.local.keyOrigin, choruses: a.local.choruses.length, vocalsReliable: a.local.vocals.reliable } }; });
    ok('AI DJ analyses a bundled track (librosa beat tracker + the fork\'s older local key/chorus engine); shown beside, not over, the declared values', rel && /librosa/.test(mt) && loc.local && /^[A-G]#?m?$/.test(loc.local.key) && loc.local.keyOrigin === 'estimated' && loc.local.vocalsReliable === false && loc.declaredKey === '8A' && loc.keyOrigin === 'declared', `${mt.trim()} | declared ${decl} | ${JSON.stringify(loc)}`);
    await page.click('button:has-text("USE AI DJ BPM") >> nth=0'); ok('using the AI DJ BPM is explicit and is labelled an estimate, never "declared"', await page.evaluate(() => { const t = window.__b2b.tracks[0]; return t.bpmOrigin === 'estimated'; }));
    await page.click('button:has-text("BACK")');
} else skip('real AI DJ service connection and measurement', 'AIDJ_PYTHON not set');
await page.goto(URL.replace(/\/$/, '') + '/'); await page.click('button:has-text("CLICK TO ENTER")'); await page.waitForSelector('nav[aria-label="main menu"]'); await short();
if (PY) { await page.click('button.gmenuitem:has-text("SETTINGS")'); await page.fill('input[aria-label="AI DJ service URL"]', SVC); await page.click('button:has-text("CONNECT SERVICE")'); await page.waitForFunction(() => /Service: connected/.test(document.querySelector('[data-testid="service-status"]').textContent), null, { timeout: 30000 }); await page.click('button:has-text("BACK")'); }

// ================================================================ 2. AI vs AI show with the real brain and the real BENDR engine
await page.evaluate(() => { const k = {}; window.__evKinds = k; window.__b2b.events.onAny(e => { k[e.type] = (k[e.type] || 0) + 1; }); });
await page.click('button.gmenuitem:has-text("AI vs AI SHOW")'); await live(); await bendrReady();
const dlg = await page.textContent('[data-testid="flash-dialog"]'); ok('the photosensitivity warning is carried into the game and asks for a choice (BENDR\'s text; keep or turn flashing effects off)', /rapid full-frame flashing/.test(dlg) && /photosensitive epilepsy/.test(dlg) && /UNDERSTOOD/.test(dlg) && /TURN FLASHING EFFECTS OFF/.test(dlg));
await page.click('[data-testid="flash-dialog"] button:has-text("UNDERSTOOD")'); ok('answering the warning closes it and flashing effects stay ON', await page.locator('[data-testid="flash-dialog"]').count() === 0 && /FLASHING EFFECTS ON/.test(await page.textContent('[data-testid="flash-toggle"]')));
const e0 = await engine();
ok('BENDR (the real engine) initialised inside the game: version, registry, no failure', e0.state === 'ready' && /^v\d/.test(e0.version) && e0.registry >= 40, JSON.stringify({ v: e0.version, registry: e0.registry, excluded: e0.excluded }));
const flashN = await page.evaluate(() => window.__b2bVideo.registry().filter(r => r.flashing).length);
ok('strobe / flicker presets are INCLUDED in Random Effect by default and flagged; only technically unusable presets are excluded (multi-channel, source-replacing)', flashN >= 1 && e0.excluded.flashing === 0 && e0.excluded.multiChannel > 0, `flashing presets in registry: ${flashN}; excluded ${JSON.stringify(e0.excluded)}`);
ok('BENDR receives the game feed as channel A and the game audio as its live input', await bendr('SRC.A.mode') === 'cam' && await bendr('audioMode') === 'mic');
const src = await page.evaluate(() => { const b = window.__b2b.brainStatus(); return { mode: b.mode, tb: document.querySelector('[data-testid="arena-brain"]').textContent }; });
ok(`both AI DJs run on the ${PY ? 'real AI DJ service' : 'in-browser AI DJ port'}`, PY ? src.mode === 'service' : src.mode === 'ts-port', JSON.stringify(src));
const l0 = await level(); ok('real audio plays (master level)', l0 > 0.02, l0.toFixed(2));

// audio reactivity: BENDR's own analyser hears the game's master mix
let heard = 0; for (let i = 0; i < 8; i++) { heard = Math.max(heard, await bendr('Math.max(audioBands.bass, audioBands.mid, audioBands.high)')); await sleep(300); }
ok('BENDR\'s audio-reactive bands respond to the game\'s music', heard > 0.02, 'max band ' + heard.toFixed(3));

// five views
const CAMS = [['DJ 1 POV', 'dj1'], ['DJ 2 POV', 'dj2'], ['DJ 1 Overhead', 'dj1top'], ['DJ 2 Overhead', 'dj2top'], ['Crowd Camera', 'crowd']];
const camSig = {}; for (const [label, id] of CAMS) { await page.click(`.gcams[aria-label="camera views"] button:has-text("${label}")`); await waitFrames(3); camSig[id] = await vsig(); ok(`${label} selected`, (await page.getAttribute('.gvideo', 'data-camera')) === id); await page.locator('.gvideo').screenshot({ path: `${OUT}/int-cam-${id}.png` }); }
let minD = 1e9; const ids = Object.keys(camSig); for (let i = 0; i < ids.length; i++) for (let j = i + 1; j < ids.length; j++) minD = Math.min(minD, dist(camSig[ids[i]], camSig[ids[j]]));
ok('the five views are five different pictures IN BENDR\'s output', minD > 4, 'smallest pairwise difference ' + minD.toFixed(1));

// effects through BENDR
const names = await page.evaluate(() => window.__b2bVideo.registry().map(r => r.name)); const seen = []; const diffs = []; let repeat = false; let prev = null;
for (let i = 0; i < 6; i++) {
    await page.click('button:has-text("RANDOM EFFECT")'); await sleep(300); await waitFrames(4); const st = (await status()).trim(); const nm = st.replace(/ · ON| · OFF.*/, ''); const e = await engine();
    if (prev === nm) repeat = true; prev = nm; seen.push(nm);
    const d = dist(await vsig(), await fsig()); diffs.push(d);
    ok(`RANDOM EFFECT ${i + 1}: "${nm}" is a real BENDR preset, applied and ON`, names.includes(nm) && /ON/.test(st) && !e.bypass && e.sel === nm, `${st} | BENDR output differs from the unprocessed feed by ${d.toFixed(1)}`);
}
ok('random effect never repeated the previous one', !repeat);
ok('effects visibly change the picture BENDR outputs (most of them clearly)', diffs.filter(d => d > 6).length >= 4, diffs.map(d => d.toFixed(0)).join(' '));
await page.locator('.gvideo').screenshot({ path: `${OUT}/int-effect-on.png` });

// ON/OFF + persistence across cameras
const chosen = (await engine()).sel; const dOn = dist(await vsig(), await fsig());
await page.click('button[aria-pressed]:has-text("EFFECT ON")'); await waitFrames(4); const off = await engine(); const dOff = dist(await vsig(), await fsig());
ok('ON/OFF: OFF is BENDR\'s own bypass; the picture returns to the unprocessed feed; the preset stays selected', off.bypass && off.sel === chosen && dOff < dOn - 4, `ON ${dOn.toFixed(1)} -> OFF ${dOff.toFixed(1)}`);
await page.locator('.gvideo').screenshot({ path: `${OUT}/int-effect-off.png` });
await page.click('button[aria-pressed]:has-text("EFFECT OFF")'); await waitFrames(4); const on2 = await engine(); ok('turning it back ON re-enables the same preset', !on2.bypass && on2.sel === chosen);
let keep = true; for (const [label] of CAMS) { await page.click(`.gcams[aria-label="camera views"] button:has-text("${label}")`); await sleep(400); const e = await engine(); keep = keep && !e.bypass && e.sel === chosen && (await page.getAttribute('.gvideo', 'data-tfx')) !== ''; }
ok('camera changes keep the selected effect and its ON state', keep, chosen);
await page.click('button[aria-pressed]:has-text("EFFECT ON")'); let keepOff = true; for (const [label] of CAMS) { await page.click(`.gcams[aria-label="camera views"] button:has-text("${label}")`); await sleep(500); keepOff = keepOff && (await engine()).bypass === true; }
ok('an effect turned OFF stays OFF (BENDR\'s own blur handler cannot silently re-enable it)', keepOff);
await page.click('button[aria-pressed]:has-text("EFFECT OFF")'); await sleep(300);

// flashing presets: really applied when allowed, really removed when switched off
const fl = await page.evaluate(() => { const e = window.__b2bVideo; const f = e.registry().find(r => r.flashing); e.select(f.id); e.setOn(true); return { id: f.id, name: f.name, sel: e.selected.name, bypass: e.isBypassed() }; }); await waitFrames(3);
ok('a flashing (strobe) preset can be selected and shown while flashing effects are ON', fl.sel === fl.name && !(await engine()).bypass, fl.name);
await page.click('[data-testid="flash-toggle"]'); await sleep(300); const af = await page.evaluate(() => { const e = window.__b2bVideo; return { toggle: document.querySelector('[data-testid="flash-toggle"]').textContent, regFlash: e.registry().filter(r => r.flashing).length, sel: e.selected, allowed: e.flashingAllowed, tfx: document.querySelector('.gvideo').dataset.tfx }; });
ok('FLASHING EFFECTS OFF removes every flashing preset from the registry and clears an active flashing effect', /OFF/.test(af.toggle) && af.regFlash === 0 && af.sel === null && af.allowed === false && af.tfx === '', JSON.stringify(af));
let anyFlash = false; for (let i = 0; i < 25; i++) { await page.click('button:has-text("RANDOM EFFECT")'); await sleep(120); anyFlash = anyFlash || await page.evaluate(() => !!(window.__b2bVideo.selected && window.__b2bVideo.selected.flashing)); }
ok('with flashing OFF, Random Effect never picks a flashing preset (25 rolls)', !anyFlash);
await page.click('[data-testid="flash-toggle"]'); await sleep(300); ok('FLASHING EFFECTS ON brings them back', await page.evaluate(() => window.__b2bVideo.registry().some(r => r.flashing) && window.__b2bVideo.flashingAllowed));
await page.click('button:has-text("RANDOM EFFECT")'); await waitFrames(2);
// events reach BENDR
const ev0 = (await engine()).reactions; await page.evaluate(() => window.__b2b.events.emit({ type: 'drop', station: 'player', reason: 'test event' })); const spike = await bendr('spikeV'); const ev1 = (await engine()).reactions;
ok('a game event delivered to BENDR reaches its event modulation source (spike)', spike > 0.5 && ev1.spikes === ev0.spikes + 1, `spikeV=${spike.toFixed(2)}`);
const kinds = await page.evaluate(() => window.__evKinds);
ok('real events flow from the DJ brain and the game', ['track.loaded', 'mix.started', 'beat', 'dj.decision', 'round.started', 'camera.changed', 'effect.selected', 'effect.toggled'].every(t => kinds[t] > 0), JSON.stringify(kinds));
const rx = (await engine()).reactions; ok('beats phase-locked BENDR to the master bar line, event kicks delivered', rx.phaseLocks > 0 && rx.spikes > 0, JSON.stringify(rx));

// fault: BENDR fails on a preset
const lv = await level(1000); const ph0 = await page.evaluate(() => window.__b2b.session.phase);
await page.evaluate(() => { const w = [...document.querySelectorAll('iframe')].find(x => x.title === 'BENDR video engine').contentWindow; w.__origLoad = w.loadPreset; w.loadPreset = () => { throw new Error('injected shader failure'); }; });
await page.click('button:has-text("RANDOM EFFECT")'); await sleep(500);
const eF = await engine(); const lvF = await level(1000); const phF = await page.evaluate(() => window.__b2b.session.phase);
ok('a failing BENDR effect is reported (degraded) and does not stop the music or the show', eF.state === 'degraded' && /injected/.test(eF.detail) && lvF > 0.02 && phF === ph0 && ph0 === 'live', eF.detail);
await page.evaluate(() => { const w = [...document.querySelectorAll('iframe')].find(x => x.title === 'BENDR video engine').contentWindow; w.loadPreset = w.__origLoad; });
await page.click('button:has-text("RANDOM EFFECT")'); await waitFrames(3); await page.waitForFunction(() => window.__b2bVideo.status().state === 'ready', null, { timeout: 15000 }); const eR = await engine();
ok('BENDR recovers (after the error has been shown for its hold time) once the fault clears', eR.state === 'ready' && eR.errors >= 1);

// the DJ brain's decisions
const dec = await page.evaluate(() => { const r = window.__b2b; const all = [...r.ai.decisions, ...r.ai2.decisions]; return { total: all.length, withSource: all.filter(d => d.source).length, sources: [...new Set(all.filter(d => d.source).map(d => d.source))], refused: r.port.refused + r.port2.refused, text: all.filter(d => d.source).slice(0, 2).map(d => d.evidence) }; });
ok('AI DJ decisions were executed through the validated command ports (none refused) and are labelled with their source', dec.refused === 0 && dec.withSource > 0 && dec.sources.length === 1 && dec.sources[0] === (PY ? 'aidj-service' : 'aidj-ts-port'), JSON.stringify(dec));

// finish the show, results, rematch
await page.waitForFunction(() => window.__b2b.session.phase === 'matchEnd', null, { timeout: 120000 }); await page.waitForSelector('[role="dialog"][aria-label="round results"]');
const res = await page.evaluate(() => { const r = window.__b2b; const x = r.session.results[0]; return { p: x.breakdown.player.total, b: x.breakdown.buddy.total, refused: r.port.refused + r.port2.refused, bendrState: window.__b2bVideo.status().state }; });
ok('show finished by itself with results for both AI DJs; BENDR still running', res.p > 10 && res.b > 10 && res.refused === 0 && res.bendrState !== 'failed', JSON.stringify(res));
await page.click('button:has-text("REMATCH SHOW")'); await page.waitForFunction(() => window.__b2b.session && window.__b2b.session.results.length === 0 && ['countin', 'live'].includes(window.__b2b.session.phase)); await live();
ok('rematch works and BENDR survives it', (await engine()).state !== 'failed' && await level(1000) > 0.02);

// fault: BENDR dies -> game falls back to canvas effects, music unaffected
await page.evaluate(() => [...document.querySelectorAll('iframe')].find(x => x.title === 'BENDR video engine').remove());
await page.waitForFunction(() => document.querySelector('.gvideo').dataset.engine === 'canvas', null, { timeout: 30000 });
const fb = await page.textContent('[data-testid="engine-status"]'); const lvD = await level(1000);
ok('if BENDR dies the game says so, falls back to canvas effects, and the music and show carry on', /FALLBACK/.test(fb) && lvD > 0.02 && await page.evaluate(() => window.__b2b.session.phase === 'live'), fb.trim().slice(0, 110));
await page.click('button:has-text("RANDOM EFFECT")'); await sleep(500); ok('Random Effect still works on the fallback engine', /ON/.test(await status()) && (await page.getAttribute('.gvideo', 'data-tfx')) !== '', (await status()).trim());

// ================================================================ 3. human vs Buddy, driven by the AI DJ
await page.click('button:has-text("MENU")'); await page.waitForSelector('nav[aria-label="main menu"]'); await short();
await page.click('button.gmenuitem:has-text("PLAY")'); await page.waitForSelector('.gpicker .glist button'); await bendrReady();
await page.click('.gpicker .glist button >> nth=0'); await page.click('button:has-text("MATCH TEMPO")'); await page.click('button:has-text("READY")'); await live(); await page.click('button:has-text("START ON BEAT")');
const bm = await page.evaluate(() => window.__b2b.mode); ok('human vs Buddy battle starts with the AI DJ brain and BENDR', bm === 'battle' && (await engine()).state === 'ready');
for (let t = 0; t < 60; t++) { if (await page.evaluate(() => window.__b2b.ai.decisions.some(d => d.kind === 'transition'))) break; await sleep(1000); }
const bd = await page.evaluate(() => { const r = window.__b2b; const d = r.ai.decisions; return { transition: d.filter(x => x.kind === 'transition').length, src: [...new Set(d.filter(x => x.source).map(x => x.source))], refused: r.port.refused, evidence: d.find(x => x.source)?.evidence }; });
ok('Buddy performed an AI DJ-planned transition through the validated port', bd.transition >= 1 && bd.src[0] === (PY ? 'aidj-service' : 'aidj-ts-port') && bd.refused === 0, JSON.stringify(bd));
const rxb = (await engine()).reactions; ok('the transition was delivered to BENDR as a real event', rxb.spikes >= 1, JSON.stringify(rxb));
await page.click('button:has-text("RANDOM EFFECT")'); await waitFrames(3); ok('BENDR effects work during a human battle without touching the audio', (await engine()).sel !== null && await level(1000) > 0.02);
await page.waitForFunction(() => window.__b2b.session.phase === 'roundEnd' || window.__b2b.session.phase === 'matchEnd', null, { timeout: 120000 }); await page.waitForSelector('[role="dialog"][aria-label="round results"]');
ok('round scored and results shown with the player and Buddy breakdowns', await page.evaluate(() => { const x = window.__b2b.session.results[0]; return x.breakdown.player.items.length > 0 && x.breakdown.buddy.total > 0; }));
await page.click('[role="dialog"][aria-label="round results"] button:has-text("MENU")'); await page.waitForSelector('nav[aria-label="main menu"]');
await page.click('button.gmenuitem:has-text("PLAY")'); await page.waitForSelector('.gpicker .glist button'); ok('leaving to the menu and starting a new battle works', await page.evaluate(() => window.__b2b.session.round === 0));

// ================================================================ 4. explicit fallbacks: rules brain + canvas engine
await page.goto(URL + '?engine=canvas&brain=rules'); await page.click('button:has-text("CLICK TO ENTER")'); await page.waitForSelector('nav[aria-label="main menu"]'); await short();
await page.click('button.gmenuitem:has-text("AI vs AI SHOW")'); await live();
const fbk = await page.evaluate(() => ({ eng: document.querySelector('.gvideo').dataset.engine, brain: window.__b2b.brainStatus().mode, label: document.querySelector('[data-testid="arena-brain"]').textContent }));
ok('with ?engine=canvas&brain=rules the game uses the labelled fallbacks, not the integrated systems', fbk.eng === 'canvas' && fbk.brain === 'rules' && /built-in rules/.test(fbk.label), JSON.stringify(fbk));
await sleep(4000); ok('fallback decisions carry no AI DJ label', await page.evaluate(() => [...window.__b2b.ai.decisions, ...window.__b2b.ai2.decisions].every(d => !d.source)));
await page.click('button:has-text("RANDOM EFFECT")'); await sleep(400); ok('fallback Random Effect works', (await page.getAttribute('.gvideo', 'data-tfx')) !== '');

ok('no uncaught page errors or unexpected console errors', errors.length === 0, errors.slice(0, 3).join(' | '));
fs.writeFileSync(`${OUT}/integration-report.json`, JSON.stringify({ browser: browser.version(), aidjService: PY ? SVC : null, report, errors, expectedConsoleErrors: expected.length }, null, 1));
await browser.close(); svcProc?.kill(); const fail = report.filter(r => !r.pass); console.log(`\n${report.filter(r => !r.skipped).length - fail.length}/${report.filter(r => !r.skipped).length} checks passed, ${report.filter(r => r.skipped).length} skipped`); process.exit(fail.length ? 1 : 0);
