// Layout + legacy-studio smoke test (real Chromium). Checks for page errors and horizontal overflow; screenshots for a human to look at.
import { chromium } from 'playwright'; import fs from 'node:fs';
// these suites test the canvas-effects engine and the battle loop; BENDR is covered by e2e/integration.mjs
const URL = process.env.URL || 'http://localhost:4173/?engine=canvas'; const OUT = 'e2e/out'; fs.mkdirSync(OUT, { recursive: true });
const b = await chromium.launch({ executablePath: process.env.CHROMIUM || undefined, args: ['--autoplay-policy=no-user-gesture-required'] }); const res = [];
for (const [name, w, h] of [['tablet', 1024, 768], ['narrow', 700, 900]]) {
  const p = await (await b.newContext({ viewport: { width: w, height: h } })).newPage(); const errs = []; p.on('pageerror', e => errs.push(String(e)));
  await p.goto(URL); await p.click('text=CLICK TO ENTER'); await p.click('text=PRACTICE'); await p.waitForSelector('[aria-label="your station"]');
  await p.click('.glist button >> nth=0'); await p.screenshot({ path: `${OUT}/layout-${name}.png`, fullPage: true });
  const overflow = await p.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  res.push({ name: `${name} ${w}x${h}: no horizontal overflow, no page errors`, pass: overflow <= 1 && errs.length === 0, extra: `overflow ${overflow}px ${errs[0] ?? ''}` });
}
// user file: decode in the browser, appears with no BPM, estimate is labelled 'estimated'
{ const sr = 22050, n = sr * 24, buf = Buffer.alloc(44 + n * 2); buf.write('RIFF', 0); buf.writeUInt32LE(36 + n * 2, 4); buf.write('WAVEfmt ', 8); buf.writeUInt32LE(16, 16); buf.writeUInt16LE(1, 20); buf.writeUInt16LE(1, 22); buf.writeUInt32LE(sr, 24); buf.writeUInt32LE(sr * 2, 28); buf.writeUInt16LE(2, 32); buf.writeUInt16LE(16, 34); buf.write('data', 36); buf.writeUInt32LE(n * 2, 40);
  const per = sr * 60 / 120; for (let b = 0; b * per < n; b++) { const s0 = Math.round(b * per + 0.1 * sr); for (let i = 0; i < 600 && s0 + i < n; i++) buf.writeInt16LE(Math.round(Math.exp(-i / 90) * Math.sin(i * 0.25) * 20000), 44 + (s0 + i) * 2); }
  const q = await (await b.newContext({ viewport: { width: 1280, height: 800 } })).newPage(); const qe = []; q.on('pageerror', e => qe.push(String(e)));
  await q.goto(URL); await q.click('text=CLICK TO ENTER'); await q.click('text=TRACK LIBRARY'); await q.waitForSelector('text=TRACK LIBRARY');
  await q.setInputFiles('input[type=file]', { name: 'click120.wav', mimeType: 'audio/wav', buffer: buf }); await q.waitForSelector('td:has-text("click120")', { timeout: 8000 });
  const before = await q.evaluate(() => { const t = window.__b2b.tracks.find(x => x.source === 'user'); return { bpm: t.bpm, origin: t.bpmOrigin }; });
  await q.click('button:has-text("ESTIMATE BPM")'); await q.waitForTimeout(500);
  const after = await q.evaluate(() => { const t = window.__b2b.tracks.find(x => x.source === 'user'); return { bpm: t.bpm, origin: t.bpmOrigin }; });
  res.push({ name: 'user file decodes, starts with no BPM, estimate is ~120 and labelled estimated', pass: before.bpm === null && before.origin === 'unavailable' && Math.abs(after.bpm - 120) < 1.5 && after.origin === 'estimated' && qe.length === 0, extra: JSON.stringify({ before, after }) });
  await q.screenshot({ path: `${OUT}/library-user-file.png` }); }
{ const q = await (await b.newContext({ viewport: { width: 1280, height: 800 } })).newPage(); const qe = []; q.on('pageerror', e => qe.push(String(e)));
  await q.goto(URL); await q.click('text=CLICK TO ENTER'); await q.click('text=PRACTICE'); await q.waitForSelector('.gvideo');
  const look = async () => JSON.parse(await q.getAttribute('.gvideo', 'data-look')); const start = await look();
  await q.check('input[aria-label="lock palette"]'); await q.check('input[aria-label="lock camera"]'); const seen = new Set();
  for (let i = 0; i < 15; i++) { await q.click('button:has-text("SHUFFLE VISUALS")'); const l = await look(); seen.add(l.fx + l.motion); if (l.palette !== start.palette || l.camera !== start.camera) seen.add('BROKE'); }
  await q.click('button:has-text("HIT IT")'); await q.uncheck('input[aria-label="lock palette"]'); let moved = false; for (let i = 0; i < 12 && !moved; i++) { await q.click('button:has-text("SHUFFLE VISUALS")'); moved = (await look()).palette !== start.palette; }
  res.push({ name: 'SHUFFLE VISUALS keeps locked groups, varies the rest, HIT IT works, unlocking lets the palette change', pass: !seen.has('BROKE') && seen.size > 2 && moved && qe.length === 0, extra: `${seen.size} looks seen ${qe[0] ?? ''}` });
  await q.screenshot({ path: `${OUT}/visual-shuffle.png` }); }
const p = await (await b.newContext({ viewport: { width: 1280, height: 800 } })).newPage(); const errs = []; p.on('pageerror', e => errs.push(String(e)));
await p.goto(URL); await p.click('text=CLICK TO ENTER'); await p.click('text=STUDIO (legacy)'); await p.waitForTimeout(2500); await p.screenshot({ path: `${OUT}/legacy-studio.png` });
res.push({ name: 'legacy studio still opens without page errors', pass: errs.length === 0 && (await p.locator('text=GAME MENU').count()) === 1, extra: errs[0] ?? '' });
console.log(res.map(r => `${r.pass ? 'PASS' : 'FAIL'} ${r.name} ${r.extra}`).join('\n')); fs.writeFileSync(`${OUT}/smoke.json`, JSON.stringify(res, null, 2)); await b.close(); process.exit(res.every(r => r.pass) ? 0 : 1);
