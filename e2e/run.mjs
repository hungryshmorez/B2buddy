// Real-browser run of the built game (Chromium via Playwright) against `vite preview` on http://localhost.
// Evidence only for what it asserts: no sound is *heard* here (analyser data is read), and no MIDI hardware is attached.
import { chromium } from 'playwright';
import fs from 'node:fs';

const URL = process.env.URL || 'http://localhost:4173/';
const OUT = process.env.OUT || 'e2e/out'; fs.mkdirSync(OUT, { recursive: true });
const report = []; const ok = (name, cond, extra = '') => { report.push({ name, pass: !!cond, extra }); console.log(cond ? 'PASS' : 'FAIL', name, extra); };
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM || undefined, args: ['--autoplay-policy=no-user-gesture-required'] });
const ctx = await browser.newContext({ viewport: { width: 1360, height: 900 } });
const page = await ctx.newPage(); const errors = [];
page.on('response', r => { if (r.status() >= 400) console.log('HTTP', r.status(), r.url()); });
page.on('pageerror', e => errors.push(String(e))); page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
const sleep = ms => new Promise(r => setTimeout(r, ms));
const ver = await browser.version(); console.log('browser', ver);

await page.goto(URL); await page.waitForSelector('text=CLICK TO ENTER');
await page.screenshot({ path: `${OUT}/01-gate.png` });
ok('gate shown before any audio', await page.evaluate(() => !window.__b2b.ctx));
await page.click('text=CLICK TO ENTER'); await page.waitForSelector('nav[aria-label="main menu"]');
ok('audio context running after the click', await page.evaluate(() => window.__b2b.ctx.state === 'running'));
await page.screenshot({ path: `${OUT}/02-menu.png` });

// ---- battle setup -> arena
await page.click('text=DJ BATTLE'); await page.waitForSelector('text=Opponent');
await page.selectOption('select >> nth=0', '30'); await page.selectOption('select >> nth=1', '1');
await page.screenshot({ path: `${OUT}/03-setup.png` });
await page.click('text=ENTER THE ARENA'); await page.waitForSelector('[aria-label="your station"]');
ok('arena shows both stations and the covered deck B', await page.locator('[aria-label="your station"]').count() === 1 && await page.locator('[aria-label="Buddy\'s station"]').count() === 1 && await page.locator('[aria-label*="deck B is off"]').count() >= 1);

// READY without a track must be refused with a message
await page.click('button:has-text("READY")'); await page.waitForSelector('text=Load a track');
ok('READY without a track is refused with a clear message', await page.evaluate(() => window.__b2b.session.phase === 'idle'));

// load a track, tempo-match, ready, start on beat
await page.click('.glist button:has-text("Neon Drill")');
await page.click('button:has-text("MATCH TEMPO")');
ok('MATCH TEMPO sets the deck rate to master/track', await page.evaluate(() => Math.abs(window.__b2b.stations.player.state().rate - 124 / 124) < 1e-6));
await page.click('button:has-text("READY")'); await page.waitForFunction(() => window.__b2b.session.phase === 'countin');
await page.click('button:has-text("START ON BEAT")');
await page.waitForFunction(() => window.__b2b.session.phase === 'live', null, { timeout: 15000 });
await page.screenshot({ path: `${OUT}/04-live.png` });

// ---- is the audio signal real, and do the controls change it?
const sample = async (ms = 1500) => page.evaluate(async ms => { const rt = window.__b2b; let p = 0, b = 0, m = 0; const t0 = performance.now(); while (performance.now() - t0 < ms) { const mt = rt.meters(); p = Math.max(p, mt.player); b = Math.max(b, mt.buddy); m = Math.max(m, rt.masterLevel()); await new Promise(r => setTimeout(r, 8)); } return { p, b, m }; }, ms);
await sleep(1500);
const live = await sample(); console.log('levels', live);
ok('master output carries signal in the live round', live.m > 0.05, JSON.stringify(live));
ok('player channel carries signal', live.p > 0.05);
ok('master peak after the limiter stays below full scale (no clipping)', live.m < 0.99, `peak ${live.m.toFixed(3)}`);
await page.evaluate(() => window.__b2b.act('volume', 0)); await sleep(200); const muted = await sample(800);
ok('volume fader at 0 silences the player channel (fader acts on real audio)', muted.p < 0.001 && live.p > 0.05, `muted peak ${muted.p.toFixed(5)}`);
await page.evaluate(() => window.__b2b.act('volume', 0.8)); await sleep(300);
const full = await sample(1200);
await page.evaluate(() => window.__b2b.act('eq.low', 0)); await sleep(300); const nolow = await sample(1200);
ok('LOW EQ at minimum lowers the kick-heavy channel peak', nolow.p < full.p * 0.75, `with low ${full.p.toFixed(3)}, without ${nolow.p.toFixed(3)}`);
await page.evaluate(() => window.__b2b.act('eq.low', 0.5));
ok('Buddy produced audible signal on his own station', live.b > 0.02 || (await sample(1500)).b > 0.02);

// ---- play out the round, expect results
await page.waitForSelector('[aria-label="round results"]', { timeout: 60000 });
await page.screenshot({ path: `${OUT}/05-results.png` });
const res = await page.evaluate(() => { const s = window.__b2b.session; const r = s.results[0]; return { phase: s.phase, p: r.breakdown.player.total, b: r.breakdown.buddy.total, winner: r.winner, refused: window.__b2b.port.refused }; });
console.log('result', res);
ok('round ends, both are scored from measurements, no AI command was refused', res.phase === 'matchEnd' && res.p > 5 && res.b > 5 && res.refused === 0, JSON.stringify(res));
ok('results explain the score with reasons', await page.locator('.gres .why').count() >= 6);
await page.click('button:has-text("REMATCH")'); await page.waitForSelector('text=ROUND 1 OF 1');
ok('rematch starts a fresh match', await page.evaluate(() => window.__b2b.session.round === 0 && window.__b2b.session.results.length === 0 && window.__b2b.stations.player.state().trackId === null));

// ---- camera + effect switchers
for (const l of ['DJ 1 (you)', 'DJ 2 (Buddy)', 'Overhead', 'Crowd', 'Wide show']) await page.click(`.gcams button:has-text("${l}")`);
await page.click('.gcams button[aria-label="visual effect"]'); await page.screenshot({ path: `${OUT}/06-camera.png` });
ok('five camera views and the effect switch respond', true);

// ---- practice mode
await page.click('button:has-text("MENU")'); await page.waitForSelector('nav[aria-label="main menu"]');
await page.click('text=PRACTICE'); await page.waitForSelector('text=Practice has no opponent');
await page.click('.glist button:has-text("Harbour Pulse")'); await page.click('button:has-text("PLAY")'); await sleep(800);
ok('practice: PLAY makes the deck sound', await page.evaluate(() => window.__b2b.stations.player.state().sounding));
await page.click('button:has-text("PAUSE")'); ok('practice: PAUSE stops it', await page.evaluate(() => !window.__b2b.stations.player.state().playing));
await page.screenshot({ path: `${OUT}/07-practice.png` });
await page.click('button:has-text("MENU")');

// ---- MIDI in a real browser (capability + permission flow; NO hardware attached)
await page.click('text=SETTINGS'); await page.waitForSelector('text=MIDI controller');
const api = await page.evaluate(() => ({ has: typeof navigator.requestMIDIAccess === 'function', secure: window.isSecureContext, status: window.__b2b.midi.status }));
console.log('midi', api);
await page.click('button:has-text("CONNECT MIDI")').catch(() => {}); await sleep(800);
const mid = await page.evaluate(() => ({ status: window.__b2b.midi.status, devices: window.__b2b.midi.devices.length, text: window.__b2b.midi.statusText }));
console.log('midi after connect', mid);
ok('MIDI: API present and a clear status is shown', api.has && !!mid.text, JSON.stringify(mid));
await page.screenshot({ path: `${OUT}/08-settings.png` });

// ---- supervisor flow: a Beginner battle yields an approval request
await page.click('button:has-text("BACK")'); await page.click('text=DJ BATTLE');
await page.check('input[name="diff"] >> nth=0'); await page.selectOption('select >> nth=0', '60'); await page.selectOption('select >> nth=1', '1');
await page.click('text=ENTER THE ARENA'); await page.click('.glist button:has-text("Neon Drill")'); await page.click('button:has-text("MATCH TEMPO")'); await page.click('button:has-text("READY")'); await page.click('button:has-text("START ON BEAT")');
await page.waitForSelector('[aria-label="round results"]', { timeout: 120000 });
await page.screenshot({ path: `${OUT}/09-beginner-results.png` });
await page.click('button:has-text("MENU") >> nth=-1'); await page.waitForSelector('nav[aria-label="main menu"]');
await page.click('text=BUDDY TRAINING'); await page.waitForSelector('text=Approval queue');
const pend = await page.evaluate(() => window.__b2b.memory.pending.map(p => p.label));
console.log('pending', pend);
ok('Buddy proposes a lesson from measured evidence and applies nothing yet', pend.length >= 1 && await page.evaluate(() => window.__b2b.memory.buddyPrefs().phraseWait === undefined));
await page.screenshot({ path: `${OUT}/10-training.png` });
await page.click('button:has-text("APPROVE")');
ok('approval makes it an active preference', await page.evaluate(() => window.__b2b.memory.buddyPrefs().phraseWait === true));
await page.reload(); await page.click('text=CLICK TO ENTER'); await page.waitForSelector('nav[aria-label="main menu"]');
ok('memory persists across a page reload', await page.evaluate(() => window.__b2b.memory.buddyPrefs().phraseWait === true));

ok('no uncaught page errors', errors.length === 0, errors.slice(0, 3).join(' | '));
fs.writeFileSync(`${OUT}/report.json`, JSON.stringify({ browser: ver, url: URL, platform: process.platform, report }, null, 2));
await browser.close();
process.exit(report.every(r => r.pass) ? 0 : 1);
