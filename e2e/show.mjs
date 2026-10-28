// Real-browser acceptance run for the AI vs AI show: five cameras, Random Effect, ON/OFF, continuity, results, rematch, menu.
// Usage: CHROMIUM=/path/to/chromium URL=http://localhost:4173/ node e2e/show.mjs   (needs `npm run build` + `vite preview`)
import { chromium } from 'playwright';
import fs from 'node:fs';

// these suites test the canvas-effects engine and the battle loop; BENDR is covered by e2e/integration.mjs
const URL = process.env.URL || 'http://localhost:4173/?engine=canvas'; const OUT = process.env.OUT || 'e2e/out'; fs.mkdirSync(OUT, { recursive: true });
const sleep = ms => new Promise(r => setTimeout(r, ms)); const report = [];
const ok = (name, cond, extra = '') => { report.push({ name, pass: !!cond, extra }); console.log(cond ? 'PASS' : 'FAIL', name, extra); };
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM || undefined, args: ['--autoplay-policy=no-user-gesture-required', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await (await browser.newContext({ viewport: { width: 1360, height: 900 } })).newPage();
const errors = []; page.on('pageerror', e => errors.push(String(e))); page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
console.log('browser', browser.version());
await page.goto(URL); await page.click('button:has-text("CLICK TO ENTER")'); await page.waitForSelector('nav[aria-label="main menu"]');
ok('the show launches from the main menu', await page.locator('button.gmenuitem:has-text("AI vs AI SHOW")').count() === 1);
await page.click('button.gmenuitem:has-text("AI vs AI SHOW")');
await page.waitForFunction(() => window.__b2b.session && window.__b2b.session.phase === 'live', null, { timeout: 20000 });
ok('mode is show, two AIs exist, one round is live', await page.evaluate(() => { const r = window.__b2b; return r.mode === 'show' && !!r.ai && !!r.ai2 && r.session.phase === 'live'; }));
ok('both stations are labelled as AI DJs and no human deck controls or READY exist', await page.evaluate(() => {
    const t = document.body.innerText; return t.includes('AI DJ 1') && t.includes('AI DJ 2') && !document.querySelector('[aria-label="play or pause"]') && ![...document.querySelectorAll('button')].some(b => /^READY$|NEXT ROUND/.test(b.textContent.trim())) && !document.querySelector('.gpicker');
}));
ok('a human cannot drive either deck during the show', await page.evaluate(async () => { const r = window.__b2b; const before = JSON.stringify([r.stations.player.state().volume, r.stations.buddy.state().volume]); r.act('volume', 0); r.loadToPlayer(r.tracks[0].id); window.dispatchEvent(new KeyboardEvent('keydown', { key: ' ' })); await new Promise(r => setTimeout(r, 200)); return before === JSON.stringify([r.stations.player.state().volume, r.stations.buddy.state().volume]); }));

// ---- audio is real and keeps flowing; used before and after every camera/effect change
const level = (ms = 1200) => page.evaluate(async ms => { const rt = window.__b2b; let m = 0, p = 0, b = 0; const t0 = performance.now(); while (performance.now() - t0 < ms) { const mt = rt.meters(); p = Math.max(p, mt.player); b = Math.max(b, mt.buddy); m = Math.max(m, rt.masterLevel()); await new Promise(r => setTimeout(r, 30)); } return { m, p, b }; }, ms);
const state = () => page.evaluate(() => { const r = window.__b2b; return { phase: r.session.phase, round: r.session.round, mode: r.mode, d1: r.ai2.decisions.length, d2: r.ai.decisions.length, now: r.now }; });
const l0 = await level(); ok('master output carries real signal and both AI DJs make sound', l0.m > 0.02 && l0.p > 0.01 && l0.b > 0.01, JSON.stringify(l0));
const s0 = await state();

// ---- five cameras: each button selects its own view, and the views really are different pictures
const sig = () => page.evaluate(() => { const c = document.querySelector('.gvideo > canvas:not(.tfx-layer)'); const t = document.createElement('canvas'); t.width = 64; t.height = 30; const g = t.getContext('2d'); g.drawImage(c, 0, 0, 64, 30); const d = g.getImageData(0, 0, 64, 30).data; const o = []; for (let i = 0; i < d.length; i += 4) o.push((d[i] + d[i + 1] + d[i + 2]) / 3); return o; });
const dist = (a, b) => a.reduce((s, v, i) => s + Math.abs(v - b[i]), 0) / a.length;
const CAMS = [['DJ 1 POV', 'dj1'], ['DJ 2 POV', 'dj2'], ['DJ 1 Overhead', 'dj1top'], ['DJ 2 Overhead', 'dj2top'], ['Crowd Camera', 'crowd']];
const sigs = {};
for (const [label, id] of CAMS) {
    await page.click(`.gcams[aria-label="camera views"] button:has-text("${label}")`); await sleep(500);
    const cam = await page.getAttribute('.gvideo', 'data-camera'); const pressed = await page.getAttribute(`.gcams[aria-label="camera views"] button:has-text("${label}")`, 'aria-pressed');
    ok(`${label} button selects ${id}`, cam === id && pressed === 'true'); sigs[id] = await sig(); await page.locator('.gvideo').screenshot({ path: `${OUT}/show-cam-${id}.png` });
}
ok('exactly five camera buttons', await page.locator('.gcams[aria-label="camera views"] button').count() === 5);
let minD = 1e9; const ids = Object.keys(sigs); for (let i = 0; i < ids.length; i++) for (let j = i + 1; j < ids.length; j++) minD = Math.min(minD, dist(sigs[ids[i]], sigs[ids[j]]));
ok('the five views render five different pictures (not relabelled stills)', minD > 4, 'smallest pairwise mean difference ' + minD.toFixed(1));
const s1 = await state(); const l1 = await level();
ok('camera switching did not stop the music, the battle or the AI DJs', s1.phase === 'live' && s1.round === s0.round && s1.mode === 'show' && s1.d1 >= s0.d1 && s1.d2 >= s0.d2 && l1.m > 0.02, JSON.stringify({ s0, s1, l1 }));

// ---- Random Effect: every effect in the collection, with evidence that the displayed picture changes
const EXPECT = { liquid: 'Liquid Distortion', fractal: 'Fractal Noise', datamosh: 'Datamosh', crt: 'CRT Screen', vhs: 'VHS Tracking' };
const webglOk = await page.evaluate(() => { const c = document.createElement('canvas'); return !!c.getContext('webgl'); });
console.log('webgl available in this browser:', webglOk);
const evidence = id => page.evaluate(async id => {
    const wrap = document.querySelector('.gvideo'); const base = wrap.querySelector(':scope > canvas:not(.tfx-layer)');
    if (id === 'crt' || id === 'vhs') { const el = wrap.querySelector(`.tfx-over[data-effect="${id}"]`); if (!el) return { ok: false, why: 'overlay missing' }; const r = el.getBoundingClientRect(), b = base.getBoundingClientRect(); const bg = getComputedStyle(el, '::before').backgroundImage;
        return { ok: bg !== 'none' && Math.abs(r.width - b.width) < 2 && Math.abs(r.height - b.height) < 2, why: `overlay ${Math.round(r.width)}x${Math.round(r.height)} over canvas ${Math.round(b.width)}x${Math.round(b.height)}, ::before ${bg.slice(0, 40)}` }; }
    const layer = wrap.querySelector(`canvas.tfx-layer[data-effect="${id}"]`); if (!layer || getComputedStyle(layer).display === 'none') return { ok: false, why: 'layer missing or hidden' };
    let best = 0; for (let k = 0; k < 12; k++) { const t = document.createElement('canvas'); t.width = 160; t.height = 75; const g = t.getContext('2d'); g.drawImage(base, 0, 0, 160, 75); const a = g.getImageData(0, 0, 160, 75).data; g.clearRect(0, 0, 160, 75); g.drawImage(layer, 0, 0, 160, 75); const b = g.getImageData(0, 0, 160, 75).data; let s = 0; for (let i = 0; i < a.length; i += 4) s += Math.abs(a[i] - b[i]) + Math.abs(a[i + 1] - b[i + 1]) + Math.abs(a[i + 2] - b[i + 2]); best = Math.max(best, s / (a.length / 4) / 3); await new Promise(r => setTimeout(r, 40)); }
    return { ok: best > 1.5, why: 'mean per-pixel difference vs the camera picture ' + best.toFixed(1) };
}, id);
const seen = new Map(); let prev = null; let repeated = false;
for (let i = 0; i < 80 && seen.size < (webglOk ? 5 : 3); i++) {
    await page.click('button:has-text("RANDOM EFFECT")'); await sleep(250);
    const id = await page.getAttribute('.gvideo', 'data-tfx'); const status = (await page.textContent('[data-testid="fx-status"]')) ?? '';
    if (id === prev) repeated = true; prev = id; if (!id || seen.has(id)) continue;
    // a shader effect builds its layer on first use (compile time on software GL), so wait for it and report how long the picture took to change
    const t0 = Date.now(); const sel = id === 'crt' || id === 'vhs' ? `.tfx-over[data-effect="${id}"]` : `canvas.tfx-layer[data-effect="${id}"]`;
    await page.waitForFunction(sel => { const el = document.querySelector(sel); return !!el && getComputedStyle(el).display !== 'none'; }, sel, { timeout: 5000 }).catch(() => {}); const latency = Date.now() - t0;
    const ev = await evidence(id); seen.set(id, ev);
    ok(`RANDOM EFFECT applies "${EXPECT[id]}" to the displayed camera feed`, ev.ok && status.includes(EXPECT[id]) && status.includes('ON'), `${status.trim()} | ${ev.why} | visible after ${latency} ms more`);
    await page.locator('.gvideo').screenshot({ path: `${OUT}/show-fx-${id}.png` });
}
ok(`every eligible effect was reachable (${[...seen.keys()].join(', ')})`, seen.size === (webglOk ? 5 : 3));
ok('RANDOM EFFECT never repeated the previous effect', !repeated);

// ---- ON/OFF and persistence across camera switches
await page.click('button:has-text("RANDOM EFFECT")'); await sleep(200); const chosen = await page.getAttribute('.gvideo', 'data-tfx');
await page.click('button[aria-pressed]:has-text("EFFECT ON")'); await sleep(250);
ok('ON/OFF turns the effect off (picture layer gone, selection kept)', (await page.getAttribute('.gvideo', 'data-tfx')) === '' && /OFF/.test(await page.textContent('[data-testid="fx-status"]')) && await page.evaluate(() => ![...document.querySelectorAll('.tfx-layer')].some(c => getComputedStyle(c).display !== 'none') && !document.querySelector('.tfx-over')));
await page.click('button[aria-pressed]:has-text("EFFECT OFF")'); await sleep(250);
ok('turning it back ON re-enables the same effect', (await page.getAttribute('.gvideo', 'data-tfx')) === chosen, chosen);
const statusBefore = await page.textContent('[data-testid="fx-status"]'); let keep = true;
for (const [label] of CAMS) { await page.click(`.gcams[aria-label="camera views"] button:has-text("${label}")`); await sleep(250); keep = keep && (await page.getAttribute('.gvideo', 'data-tfx')) === chosen && (await page.textContent('[data-testid="fx-status"]')) === statusBefore; }
ok('the selected effect and its ON state survive all five camera switches', keep, statusBefore);
await page.click('button[aria-pressed]:has-text("EFFECT ON")'); await sleep(200);
let keepOff = true; for (const [label] of CAMS) { await page.click(`.gcams[aria-label="camera views"] button:has-text("${label}")`); await sleep(200); keepOff = keepOff && (await page.getAttribute('.gvideo', 'data-tfx')) === ''; }
ok('an effect turned OFF stays OFF across camera switches', keepOff);
await page.click('button[aria-pressed]:has-text("EFFECT OFF")'); await sleep(200);
const s2 = await state(); const l2 = await level();
ok('effects and cameras never interrupted audio, AI DJs or the round', s2.phase === 'live' && s2.round === s0.round && s2.d1 >= s1.d1 && s2.d2 >= s1.d2 && l2.m > 0.02, JSON.stringify({ s2, l2 }));

// ---- the round finishes by itself; results, rematch, menu
await page.waitForFunction(() => window.__b2b.session.phase === 'matchEnd', null, { timeout: 150000 });
await page.waitForSelector('[role="dialog"][aria-label="round results"]');
const res = await page.evaluate(() => { const r = window.__b2b; const x = r.session.results[0]; return { p: x.breakdown.player.total, b: x.breakdown.buddy.total, winner: x.winner, refused: r.port.refused + r.port2.refused, text: document.querySelector('[role="dialog"]').innerText }; });
ok('results show both AI DJs, scored from measurements, nothing refused', res.p > 15 && res.b > 15 && res.refused === 0 && /AI DJ 1/.test(res.text) && /AI DJ 2/.test(res.text) && /Both DJs here are AI/.test(res.text), JSON.stringify({ p: res.p, b: res.b, winner: res.winner, refused: res.refused }));
await page.screenshot({ path: `${OUT}/show-results.png` });
await page.click('button:has-text("REMATCH SHOW")'); await page.waitForFunction(() => window.__b2b.session && window.__b2b.session.results.length === 0 && ['countin', 'live'].includes(window.__b2b.session.phase) && window.__b2b.mode === 'show', null, { timeout: 15000 });
ok('rematch starts a fresh show', true);
const fxAfter = await page.getAttribute('.gvideo', 'data-camera'); ok('rematch gives a working arena again', !!fxAfter);
page.once('dialog', d => d.accept()); await page.click('button:has-text("MENU")'); await sleep(300);
if (await page.locator('nav[aria-label="main menu"]').count() === 0) { await page.waitForSelector('nav[aria-label="main menu"]', { timeout: 5000 }).catch(() => {}); }
ok('return to menu works and stops the show', await page.locator('nav[aria-label="main menu"]').count() === 1 && await page.evaluate(() => window.__b2b.mode === 'menu' && !window.__b2b.ai2));
ok('no uncaught page errors or console errors', errors.length === 0, errors.slice(0, 3).join(' | '));
fs.writeFileSync(`${OUT}/show-report.json`, JSON.stringify({ browser: browser.version(), webglOk, report, errors }, null, 1));
await browser.close(); const fail = report.filter(r => !r.pass); console.log(`\n${report.length - fail.length}/${report.length} checks passed`); process.exit(fail.length ? 1 : 0);
