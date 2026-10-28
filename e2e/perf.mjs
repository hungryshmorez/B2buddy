// PERFORMANCE readout check: the in-game meter reports measured numbers for the canvas engine and for BENDR.
// Usage: CHROMIUM=/path URL=http://localhost:4173/ node e2e/perf.mjs   (needs `npm run build` + `vite preview`)
// This proves the meter works. It does NOT say how fast any real device is: software GL in CI is far slower than a GPU.
import { chromium } from 'playwright';
const URL = process.env.URL || 'http://localhost:4173/'; let fail = 0;
const ok = (n, c, x = '') => { if (!c) fail++; console.log(c ? 'PASS' : 'FAIL', n, x); };
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM || undefined, args: ['--autoplay-policy=no-user-gesture-required', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox'] });
const page = await (await browser.newContext({ viewport: { width: 1360, height: 900 } })).newPage();
const errs = []; page.on('pageerror', e => errs.push(String(e)));
const run = async (qs, bendr) => {
    await page.goto(URL + qs); await page.click('button:has-text("CLICK TO ENTER")'); await page.waitForSelector('nav[aria-label="main menu"]');
    await page.click('button.gmenuitem:has-text("AI vs AI SHOW")'); await page.waitForFunction(() => window.__b2b.session && window.__b2b.session.phase === 'live', null, { timeout: 30000 });
    if (bendr) { await page.waitForFunction(() => /BENDR v/.test(document.querySelector('[data-testid="engine-status"]')?.textContent ?? ''), null, { timeout: 60000 }); await page.click('[data-testid="flash-dialog"] button >> nth=1').catch(() => undefined); }
    ok(`${qs}: readout is OFF until asked`, (await page.locator('[data-testid="perf"]').count()) === 0);
    await page.click('[data-testid="perf-toggle"]'); await page.waitForFunction(() => /game canvas: [\d.]+ fps/.test(document.querySelector('[data-testid="perf"]')?.textContent ?? ''), null, { timeout: 20000 });
    await page.waitForTimeout(bendr ? 6000 : 2500); return page.textContent('[data-testid="perf"]');
};
const c = await run('?engine=canvas', false);
ok('canvas engine: report has measured frame stats, renderer, browser', /game canvas: [\d.]+ fps over \d+ frames/.test(c) && /BENDR output: not running/.test(c) && /graphics: .+/.test(c) && /browser: .+/.test(c), c.split('\n').slice(1, 4).join(' | '));
const b = await run('?engine=bendr', true);
const m = b.match(/BENDR output: ([\d.]+) fps/);
ok('BENDR engine: report shows a measured BENDR output frame rate', !!m && parseFloat(m[1]) > 0, m ? m[0] : b);
await page.click('[data-testid="perf-copy"]'); await page.waitForFunction(() => /copied|copy blocked/.test(document.querySelector("[aria-label=performance]")?.textContent ?? ""), null, { timeout: 5000 }).then(() => ok("COPY REPORT answers (copied, or says it was blocked)", true), () => ok("COPY REPORT answers (copied, or says it was blocked)", false));
ok('no uncaught page errors', errs.length === 0, errs.join(' ; ').slice(0, 200));
await browser.close(); console.log(fail ? `${fail} FAILED` : 'all checks passed'); process.exit(fail ? 1 : 0);
