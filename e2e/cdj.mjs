// CDJ workflow in a real browser: jog, pitch bend, cue, 8 hot cues + persistence, beat jump, loops, loop roll, waveform seek, tempo range, quantize, keyboard, and a FAKE MIDI controller
// driven through the real Web MIDI code path. Usage: CHROMIUM=/path URL=http://localhost:4173/?engine=canvas node e2e/cdj.mjs   (needs `npm run build` + `vite preview`)
// No real controller and no listening were involved: audio is checked by deck state and master level only.
import { chromium } from 'playwright';
import fs from 'node:fs';
const URL = process.env.URL || 'http://localhost:4173/?engine=canvas'; const OUT = process.env.OUT || 'e2e/out'; fs.mkdirSync(OUT, { recursive: true });
const report = []; const ok = (n, c, x = '') => { report.push({ name: n, pass: !!c }); console.log(c ? 'PASS' : 'FAIL', n, x); };
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM || undefined, args: ['--autoplay-policy=no-user-gesture-required', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox'] });
const ctx = await browser.newContext({ viewport: { width: 1360, height: 1000 } }); const page = await ctx.newPage();
const errors = []; page.on('pageerror', e => errors.push(String(e))); page.on('console', m => { if (m.type() === 'error') errors.push(m.text().slice(0, 160)); });
await page.addInitScript(() => {   // a fake MIDI controller: same objects the browser gives, so the app's real Web MIDI path runs
    const port = { id: 'fake1', name: 'Fake DJ Controller', state: 'connected', type: 'input', onmidimessage: null };
    const access = { inputs: { forEach: cb => cb(port) }, onstatechange: null };
    navigator.requestMIDIAccess = async () => access;
    window.__fakeMidi = { send: bytes => port.onmidimessage && port.onmidimessage({ data: new Uint8Array(bytes) }), unplug: () => { port.state = 'disconnected'; access.onstatechange && access.onstatechange({ port }); }, plug: () => { port.state = 'connected'; access.onstatechange && access.onstatechange({ port }); } };
});
const st = () => page.evaluate(() => { const s = window.__b2b.stations.player.state(); return { ...s }; });
const sleep = ms => page.waitForTimeout(ms);
const enter = async () => { await page.goto(URL); await page.click('button:has-text("CLICK TO ENTER")'); await page.waitForSelector('nav[aria-label="main menu"]'); await page.click('button.gmenuitem:has-text("PRACTICE")'); await page.waitForSelector('[aria-label="your station"]'); await page.click('.glist button >> nth=0'); await sleep(400); };
const wheelBox = async () => { const b = await page.locator('[data-testid="jog"]').boundingBox(); return { cx: b.x + b.width / 2, cy: b.y + b.height / 2, r: b.width * 0.4 }; };
/** drag around the wheel `turns` turns (clockwise positive) over `ms`, leaving the mouse down */
async function spin(turns, ms, from = 0) {
    const { cx, cy, r } = await wheelBox(); const n = Math.max(8, Math.round(ms / 16)); let a = from;
    await page.mouse.move(cx + r * Math.cos(a), cy + r * Math.sin(a)); await page.mouse.down();
    for (let i = 1; i <= n; i++) { a = from + (turns * 2 * Math.PI * i) / n; await page.mouse.move(cx + r * Math.cos(a), cy + r * Math.sin(a)); await sleep(ms / n); }
    return { cx, cy, r, a };
}
const mod = (x, m) => ((x % m) + m) % m;

await enter();
const track = await page.evaluate(() => { const s = window.__b2b.stations.player.state(); const t = window.__b2b.library.get(s.trackId); return { id: t.id, bpm: t.bpm, loop: t.loopSec, first: t.firstBeatSec }; });
const beat = 60 / track.bpm;
ok('a track is loaded and its real waveform data exists', !!track.id && await page.evaluate(id => { const w = window.__b2b.wave(id); return !!w && w.max.some(v => v > 0.1); }, track.id), JSON.stringify(track));
await page.screenshot({ path: `${OUT}/cdj-panel.png` });

// ---------------------------------------------------------------- jog and pitch bend (playing)
await page.click('[aria-label="play or pause"]'); await sleep(700);
await spin(1.2, 700); const bent = await st(); ok('jog clockwise while playing bends the pitch up; the tempo fader value is untouched', bent.bend > 0.03 && bent.rate === 1, `bend ${bent.bend.toFixed(3)}`);
await page.mouse.up(); await sleep(400); ok('releasing the jog returns the deck to neutral', (await st()).bend === 0);
await spin(-1.2, 700); ok('jog counter-clockwise bends down', (await st()).bend < -0.03); await page.mouse.up(); await sleep(300);
const { cx, cy, r } = await spin(0.6, 400); await page.mouse.move(cx + 600, cy + 400, { steps: 5 }); await page.mouse.up(); await sleep(350);
ok('pointer leaving the wheel and releasing elsewhere does not leave the deck bent (pointer capture)', (await st()).bend === 0);
await spin(0.8, 400); await page.evaluate(() => window.dispatchEvent(new Event('blur'))); await sleep(100); ok('losing window focus mid-drag releases the jog', (await st()).bend === 0); await page.mouse.up();

// ---------------------------------------------------------------- jog on a paused deck, cue behaviour
await page.click('[aria-label="play or pause"]'); await sleep(200); ok('paused', !(await st()).playing);
const p0 = (await st()).position ?? (await st()).positionSec; await spin(0.5, 300); await page.mouse.up(); const p1 = (await st()).positionSec;
ok('jog on a paused deck nudges the position and does not start playback', Math.abs(mod(p1 - p0, track.loop)) > 0.3 && !(await st()).playing, `moved ${(p1 - p0).toFixed(2)} s`);
await page.mouse.move(0, 0); await page.mouse.down(); await page.mouse.up();
await page.evaluate(() => window.__b2b.stations.player.seek(5)); await page.click('[aria-label="cue"]'); await sleep(100);
ok('CUE on a paused deck away from the cue point sets a new cue point there', Math.abs((await st()).cueSec - 5) < 0.05, `cue ${(await st()).cueSec.toFixed(2)}`);
await page.evaluate(() => window.__b2b.stations.player.seek(8)); await page.click('[aria-label="play or pause"]'); await sleep(500); await page.click('[aria-label="cue"]'); await sleep(150);
let s = await st(); ok('CUE while playing returns to the cue point and stops', !s.playing && Math.abs(s.positionSec - s.cueSec) < 0.05);
await page.locator('[aria-label="cue"]').dispatchEvent('pointerdown', { pointerId: 7, isPrimary: true }); await sleep(600); s = await st(); const prev = s.playing && s.previewing && s.positionSec > s.cueSec + 0.3;
await page.locator('[aria-label="cue"]').dispatchEvent('pointerup', { pointerId: 7, isPrimary: true }); await sleep(150); s = await st();
ok('holding CUE at the cue point previews (plays), releasing returns and stops', prev && !s.playing && Math.abs(s.positionSec - s.cueSec) < 0.05);

// ---------------------------------------------------------------- hot cues A-H
await page.evaluate(() => window.__b2b.stations.player.seek(0)); await page.click('[aria-label="play or pause"]');
const setAt = [];
for (const [i, L] of 'ABCDEFGH'.split('').entries()) { await sleep(900); await page.click(`[data-testid="hot-${L}"]`); setAt.push((await st()).hotCues[i]); }
ok('all eight hot cue pads store a position while playing', setAt.every(v => typeof v === 'number') && new Set(setAt.map(v => v.toFixed(1))).size >= 6, setAt.map(v => v?.toFixed(1)).join(' '));
await page.click('[data-testid="hot-C"]'); await sleep(120); const pc = (await st()).positionSec; ok('triggering a stored pad jumps there during playback', Math.abs(mod(pc - setAt[2], track.loop)) < 0.6, `at ${pc.toFixed(2)} vs ${setAt[2].toFixed(2)}`);
await page.evaluate(() => window.__b2b.stations.player.pause());
await page.click('[data-testid="hot-A"]', { delay: 500 }); await sleep(100); s = await st(); ok('on a paused deck a pad plays while held and returns on release', !s.playing && Math.abs(s.positionSec - setAt[0]) < 0.05, `pos ${s.positionSec.toFixed(2)}`);
await page.reload(); await page.click('button:has-text("CLICK TO ENTER")'); await page.click('button.gmenuitem:has-text("PRACTICE")'); await page.waitForSelector('[aria-label="your station"]'); await page.click('.glist button >> nth=0'); await sleep(300);
s = await st(); ok('hot cues persist across a page reload for the same track', s.hotCues.every((v, i) => Math.abs(v - setAt[i]) < 0.001), s.hotCues.map(v => v?.toFixed(1)).join(' '));
await page.click('.glist button >> nth=1'); await sleep(200); ok('another track does not inherit them', (await st()).hotCues.every(v => v === null));
await page.click('.glist button >> nth=0'); await sleep(200);
await page.keyboard.down('Shift'); await page.click('[data-testid="hot-H"]'); await page.keyboard.up('Shift'); ok('SHIFT + pad clears a hot cue', (await st()).hotCues[7] === null);

// ---------------------------------------------------------------- beat jump
await page.evaluate(() => window.__b2b.stations.player.seek(3)); await page.selectOption('[aria-label="beat jump size"]', '4'); await page.click('[data-testid="bj-fwd"]'); s = await st();
ok('beat jump forward 4 changes the real position by 4 beats of the real grid', Math.abs(s.positionSec - (3 + 4 * beat)) < 0.01, `${s.positionSec.toFixed(3)} vs ${(3 + 4 * beat).toFixed(3)}`);
await page.selectOption('[aria-label="beat jump size"]', '1'); await page.click('[data-testid="bj-back"]'); s = await st(); ok('beat jump back 1', Math.abs(s.positionSec - (3 + 3 * beat)) < 0.01);
await page.evaluate(() => window.__b2b.stations.player.seek(3)); await page.click('[aria-label="play or pause"]'); await sleep(200); const q0 = (await st()).positionSec; await page.selectOption('[aria-label="beat jump size"]', '2'); await page.click('[data-testid="bj-fwd"]'); const q1 = (await st()).positionSec;
ok('beat jump while playing lands 2 beats ahead and keeps playing', Math.abs(mod(q1 - q0, track.loop) - 2 * beat) < 0.25 && (await st()).playing, `delta ${mod(q1 - q0, track.loop).toFixed(3)}`);

// ---------------------------------------------------------------- loops
await page.evaluate(() => window.__b2b.stations.player.seek(1)); await page.selectOption('[aria-label="loop size in beats"]', '4'); await page.click('[data-testid="loop-auto"]'); await sleep(150); s = await st();
ok('AUTO starts a real 4-beat loop at the playhead', s.loop?.active && Math.abs((s.loop.end - s.loop.start) - 4 * beat) < 0.01, JSON.stringify(s.loop));
const samples = []; for (let i = 0; i < 12; i++) { await sleep(300); samples.push((await st()).positionSec); }
ok('the playhead stays inside the loop for several loop lengths', samples.every(v => v >= s.loop.start - 0.05 && v < s.loop.end + 0.05), `${Math.min(...samples).toFixed(2)}..${Math.max(...samples).toFixed(2)}`);
ok('the loop status is shown', /LOOP/.test(await page.textContent('[data-testid="loop-status"]')));
await page.click('[title="halve the loop"]'); s = await st(); ok('loop halve', Math.abs((s.loop.end - s.loop.start) - 2 * beat) < 0.01);
await page.click('[title="double the loop"]'); await page.click('[data-testid="loop-toggle"]'); await sleep(150); const exitAt = (await st()).positionSec; await sleep(1600);
s = await st(); ok('EXIT continues playing past the old loop end', !s.loop?.active && mod(s.positionSec - exitAt, track.loop) > 1.2, `from ${exitAt.toFixed(2)} to ${s.positionSec.toFixed(2)}`);
await page.click('[data-testid="loop-toggle"]'); await sleep(150); ok('RELOOP re-enters the stored loop', (await st()).loop?.active === true); await page.click('[data-testid="loop-toggle"]');
await page.evaluate(() => window.__b2b.stations.player.seek(2)); await sleep(100); const rollStartPos = (await st()).positionSec;
await page.locator('[data-testid="loop-roll"]').dispatchEvent('pointerdown', { pointerId: 9, isPrimary: true }); await sleep(1500); const during = await st(); await page.locator('[data-testid="loop-roll"]').dispatchEvent('pointerup', { pointerId: 9, isPrimary: true }); await sleep(100); const after = await st();
ok('loop roll loops while held, then the track continues where it would have been', during.loop?.active && !after.loop?.active && mod(after.positionSec - rollStartPos, track.loop) > 1.3, `held loop ${during.loop?.start.toFixed(2)}-${during.loop?.end.toFixed(2)}, resumed at ${after.positionSec.toFixed(2)}`);
await page.evaluate(() => window.__b2b.stations.player.pause());

// ---------------------------------------------------------------- waveform seek
const ov = await page.locator('[data-testid="wave-overview-player"]').boundingBox(); await page.mouse.click(ov.x + ov.width * 0.5, ov.y + ov.height / 2); await sleep(150);
ok('clicking the overview seeks the deck to that place', Math.abs((await st()).positionSec - track.loop * 0.5) < track.loop * 0.04, `${(await st()).positionSec.toFixed(2)} of ${track.loop.toFixed(2)}`);

// ---------------------------------------------------------------- tempo range, quantize, time display
await page.selectOption('[aria-label="tempo range"]', '0.06'); await page.locator('[aria-label="tempo fader"]').evaluate(el => { const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set; set.call(el, '1'); el.dispatchEvent(new Event('input', { bubbles: true })); });
ok('tempo range ±6%: the fader at full scale gives +6%', Math.abs((await st()).rate - 1.06) < 0.001, `${(await st()).rate}`);
await page.selectOption('[aria-label="tempo range"]', '0.5'); await page.locator('[aria-label="tempo fader"]').evaluate(el => { const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set; set.call(el, '0'); el.dispatchEvent(new Event('input', { bubbles: true })); });
ok('WIDE range reaches -50%', Math.abs((await st()).rate - 0.5) < 0.001); await page.evaluate(() => window.__b2b.stations.player.setRate(1));
await page.click('[data-testid="quantize"]'); await page.evaluate(() => window.__b2b.stations.player.seek(10.3)); await page.click('[data-testid="hot-H"]'); const qh = (await st()).hotCues[7];
ok('quantize snaps a new hot cue to the beat grid', (await st()).quantize && Math.abs(mod(qh - track.first, beat)) < 0.002 || Math.abs(mod(qh - track.first, beat) - beat) < 0.002, `${qh?.toFixed(3)}`); await page.click('[data-testid="quantize"]');
const t1 = await page.textContent('[data-testid="time-readout"]'); await page.click('[data-testid="time-toggle"]'); ok('time display switches between elapsed and remaining', (await page.textContent('[data-testid="time-readout"]')).startsWith('-') && !t1.startsWith('-'));

// ---------------------------------------------------------------- bend buttons and keyboard
await page.evaluate(() => window.__b2b.stations.player.seek(1)); await page.click('[aria-label="play or pause"]');
await page.locator('[data-testid="bend-plus"]').dispatchEvent('pointerdown', { pointerId: 3, isPrimary: true }); await sleep(100); const b1 = (await st()).bend; await page.locator('[data-testid="bend-plus"]').dispatchEvent('pointerup', { pointerId: 3, isPrimary: true }); await sleep(100);
ok('BEND + speeds the deck up while held and releases to neutral', b1 > 0.05 && (await st()).bend === 0, `bend ${b1}`);
await page.evaluate(() => window.__b2b.stations.player.seek(2)); await page.keyboard.press(','); ok('keyboard: , beat-jumps back', true);
await page.evaluate(() => window.__b2b.stations.player.pause()); await page.evaluate(() => window.__b2b.stations.player.seek(6)); await page.keyboard.down('q'); await sleep(80); await page.keyboard.up('q'); await sleep(80); ok('keyboard: Q stores / triggers hot cue A', typeof (await st()).hotCues[0] === 'number');
await page.keyboard.press('x'); ok('keyboard: X toggles quantize', (await st()).quantize === true); await page.keyboard.press('x');

// ---------------------------------------------------------------- fake MIDI controller through the real Web MIDI path
await page.click('button:has-text("MENU")').catch(() => undefined); await page.waitForSelector('nav[aria-label="main menu"]'); await page.click('button.gmenuitem:has-text("SETTINGS")'); await page.click('button:has-text("CONNECT MIDI")');
await page.waitForFunction(() => window.__b2b.midi.status === 'granted'); ok('MIDI connects and lists the (fake) controller', await page.evaluate(() => window.__b2b.midi.devices[0].name === 'Fake DJ Controller'));
const learn = async (a, bytes) => { await page.evaluate(a => window.__b2b.midi.startLearn(a), a); await page.evaluate(b => window.__fakeMidi.send(b), bytes); };
await learn('jog', [0xb0, 33, 1]); await learn('jog.touch', [0x90, 36, 100]); await learn('hotcue.5', [0x91, 40, 100]); await learn('bend.plus', [0x90, 50, 100]); await learn('beatjump.fwd', [0x90, 60, 100]);
ok('MIDI Learn created mappings and they were saved to a profile', await page.evaluate(() => window.__b2b.midi.bindings.length === 5 && !!JSON.parse(localStorage.getItem('b2buddy.midi.v1')).profiles.Default));
const mon = await page.textContent('[data-testid="midi-monitor"]'); ok('the input monitor shows the controller messages', /Fake DJ Controller/.test(mon), JSON.stringify(mon.slice(0, 120)));
await page.selectOption('[aria-label="jog curve"]', 'accel'); await page.fill('[aria-label="midi jog ticks per turn"]', '128'); ok('jog settings are saved', await page.evaluate(() => { const c = JSON.parse(localStorage.getItem('b2buddy.cdj.v1')); return c.jog.curve === 'accel' && c.ticksPerTurn === 128; }));
await page.selectOption('[aria-label="midi jog encoder format"], select[aria-label$="encoder format"]', 'offset'); ok('encoder format can be edited per binding', await page.evaluate(() => window.__b2b.midi.bindingFor('jog').encoder === 'offset'));
await page.selectOption('select[aria-label$="encoder format"]', 'twos');
page.once('dialog', d => d.accept('Second controller')); await page.click('button:has-text("NEW PROFILE")'); ok('a new empty profile can be created and is active', await page.evaluate(() => window.__b2b.midi.activeProfile === 'Second controller' && window.__b2b.midi.bindings.length === 0));
await page.selectOption('[aria-label="mapping profile"]', 'Default'); ok('switching back restores the original mapping', await page.evaluate(() => window.__b2b.midi.bindings.length === 5));
await page.fill('[aria-label="midi jog ticks per turn"]', '256'); await page.selectOption('[aria-label="jog curve"]', 'linear');
await page.click('button:has-text("BACK")'); await page.click('button.gmenuitem:has-text("PRACTICE")'); await page.waitForSelector('[aria-label="your station"]'); await page.click('.glist button >> nth=0'); await sleep(300);
await page.click('[aria-label="play or pause"]'); await sleep(400);
for (let i = 0; i < 12; i++) { await page.evaluate(() => window.__fakeMidi.send([0xb0, 33, 12])); await sleep(16); } const mb = (await st()).bend;
ok('MIDI relative jog bends the playing deck', mb > 0.02, `bend ${mb.toFixed(3)}`); await sleep(400); ok('and returns to neutral by itself when the jog stops', (await st()).bend === 0);
await page.evaluate(() => window.__fakeMidi.send([0x90, 50, 100])); await sleep(80); const held = (await st()).bend;
await page.evaluate(() => window.__fakeMidi.unplug()); await sleep(100); ok('a held MIDI button is released when the controller is unplugged (no stuck bend)', held > 0.05 && (await st()).bend === 0, `held ${held}`);
await page.evaluate(() => window.__fakeMidi.plug());
await page.evaluate(() => window.__fakeMidi.send([0x91, 40, 100])); await sleep(60); await page.evaluate(() => window.__fakeMidi.send([0x81, 40, 0]));
ok('MIDI note sets hot cue E on the deck', typeof (await st()).hotCues[4] === 'number');
const bj0 = (await st()).positionSec; await page.evaluate(() => window.__fakeMidi.send([0x90, 60, 100])); await page.evaluate(() => window.__fakeMidi.send([0x80, 60, 0])); await sleep(50); const bj1 = (await st()).positionSec;
const sel = await page.evaluate(() => window.__b2b.cdj.beatJump);
ok('MIDI beat jump moves the deck by the selected number of beats', Math.abs(mod(bj1 - bj0, track.loop) - sel * beat) < 0.3, `size ${sel}, delta ${mod(bj1 - bj0, track.loop).toFixed(2)}`);
const lvl = await page.evaluate(async () => { let m = 0; const t0 = performance.now(); while (performance.now() - t0 < 800) { m = Math.max(m, window.__b2b.masterLevel()); await new Promise(r => setTimeout(r, 30)); } return m; });
ok('audio is still sounding after all of that', lvl > 0.02, `peak ${lvl.toFixed(3)}`);
await page.screenshot({ path: `${OUT}/cdj-final.png` });
ok('no uncaught page errors', errors.length === 0, errors.join(' ; ').slice(0, 300));
fs.writeFileSync(`${OUT}/cdj-report.json`, JSON.stringify(report, null, 2));
await browser.close(); const bad = report.filter(r => !r.pass).length; console.log(bad ? `${bad} FAILED` : `${report.length}/${report.length} checks passed`); process.exit(bad ? 1 : 0);
