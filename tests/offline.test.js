// Offline reliability tests. Usage: node tests/offline.test.js   (needs playwright + chromium)
// Copies the app to a temp dir, serves it with GitHub-Pages rules, and drives a real browser + service worker.
const { chromium } = require(process.env.PW || 'playwright'); const { spawn, execSync } = require('child_process'); const fs = require('fs'), path = require('path'), os = require('os');
const REPO = path.resolve(__dirname, '..'), TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'sq-')), SITE = path.join(TMP, 'site'), PORT = 8200 + Math.floor(Math.random() * 500);
const CHROME = process.env.CHROME || '/opt/pw-browsers/chromium'; let pass = 0, fail = 0;
const ok = (c, m) => { c ? pass++ : fail++; console.log((c ? 'PASS ' : 'FAIL ') + m); };
execSync(`mkdir -p ${SITE} && cd ${REPO} && tar cf - --exclude=.git --exclude=tests . | tar xf - -C ${SITE}`);
let srv; const start = () => { srv = spawn('python3', [path.join(REPO, 'tests/serve.py'), PORT, SITE, 'jszip.min.js'], { stdio: 'ignore' }); return new Promise(r => setTimeout(r, 800)); };
const stop = () => { try { srv.kill(); } catch (e) {} return new Promise(r => setTimeout(r, 300)); };
const URL_ = p => `http://localhost:${PORT}/${p}`;
(async () => {
  await start();
  const b = await chromium.launch({ executablePath: CHROME }), ctx = await b.newContext({ acceptDownloads: true }), p = await ctx.newPage();
  p.on('pageerror', e => console.log('PAGEERR', e.message)); p.on('dialog', d => d.accept());
  await p.goto(URL_('index.html')); await p.evaluate(() => navigator.serviceWorker.ready); await p.waitForTimeout(1500);
  const status = () => p.textContent('#off-status');
  const tick = async name => (await p.locator('.off-item', { hasText: name }).textContent());
  await p.click('.offline-panel summary');
  ok(+(await p.textContent('#tool-count')) === await p.locator('.tool-card').count(), 'tool count equals rendered cards');
  ok(/0 of \d+ ready/.test(await status()), 'starts with nothing saved: ' + await status());

  // 1. interrupted download must not count as saved
  fs.writeFileSync(path.join(TMP, 'flaky.flag'), '1');
  await p.check('.off-item:has-text("Compress to ZIP") input'); await p.click('#off-save'); await p.waitForFunction(() => !document.getElementById('off-save').disabled, null, { timeout: 60000 }); await p.waitForTimeout(500);
  ok(/incomplete/.test(await tick('Compress to ZIP')) || !/ready/.test(await tick('Compress to ZIP')), 'truncated download is NOT reported ready: "' + (await tick('Compress to ZIP')).trim() + '"');
  fs.unlinkSync(path.join(TMP, 'flaky.flag'));
  await p.check('.off-item:has-text("Compress to ZIP") input'); await p.click('#off-save'); await p.waitForFunction(() => !document.getElementById('off-save').disabled, null, { timeout: 60000 }); await p.waitForTimeout(500);
  ok(/ready/.test(await tick('Compress to ZIP')), 'retry after the connection recovers: ready');

  // 2. save OCR + Watermark, readiness needs the libraries too
  for (const n of ['OCR PDF', 'Watermark PDF']) await p.check(`.off-item:has-text("${n}") input`);
  await p.click('#off-save'); await p.waitForFunction(() => !document.getElementById('off-save').disabled, null, { timeout: 120000 }); await p.waitForTimeout(500);
  ok(/ready/.test(await tick('OCR PDF')) && /ready/.test(await tick('Watermark PDF')), 'OCR + Watermark ready');
  ok(!/ready/.test(await tick('Hindi')), 'Hindi data is not ready until saved');
  // readiness is about dependencies: remove one library file and the tool must stop being ready
  await p.evaluate(async () => { const c = await caches.open((await caches.keys()).find(k => k.startsWith('squeeze-'))); for (const k of await c.keys()) if (k.url.endsWith('pdf-lib.min.js')) await c.delete(k); });
  await p.reload(); await p.waitForTimeout(1000); await p.click('.offline-panel summary').catch(() => {});
  ok(/incomplete/.test(await tick('Watermark PDF')), 'tool with a missing library is "incomplete", not ready');
  await p.check('.off-item:has-text("Watermark PDF") input'); await p.click('#off-save'); await p.waitForFunction(() => !document.getElementById('off-save').disabled, null, { timeout: 60000 }); await p.waitForTimeout(500);

  // 3. real offline: server off. Saved tool works, Hindi offline gives a clear message
  await stop();
  const q = await ctx.newPage(); q.on('pageerror', e => console.log('PAGEERR', e.message));
  await q.goto(URL_('tools/ocr-pdf.html')); ok((await q.title()).includes('OCR'), 'saved OCR page opens with server off');
  await q.setInputFiles('#file-in', path.join(REPO, 'tests/fixtures/print.pdf')); await q.waitForSelector('#run-btn', { state: 'visible' });
  await q.click('#run-btn'); await q.waitForSelector('#dl-btn', { timeout: 120000 }); await q.click('details summary');
  ok(/INVOICE/i.test(await q.textContent('#summary')), 'OCR ran fully offline and found the text');
  await q.goto(URL_('tools/ocr-pdf.html')); await q.setInputFiles('#file-in', path.join(REPO, 'tests/fixtures/print.pdf')); await q.waitForSelector('#run-btn', { state: 'visible' });
  await q.check('#l-hin'); await q.click('#run-btn'); await q.waitForTimeout(2500);
  ok(/Hindi language data is not saved on this device/.test(await q.textContent('#toast-wrap')), 'Hindi not saved + offline -> clear message');
  await q.goto(URL_('tools/merge-pdf.html')); ok((await q.title()).includes('Offline') || !(await q.title()).includes('Merge'), 'unsaved tool offline falls back to home');
  await q.close();

  // 3b. save Hindi while online, then run Hindi+English OCR with the server off again
  await start(); await p.goto(URL_('index.html')); await p.waitForTimeout(800); await p.click('.offline-panel summary').catch(() => {});
  await p.check('.off-item:has-text("Hindi") input'); await p.click('#off-save'); await p.waitForFunction(() => !document.getElementById('off-save').disabled, null, { timeout: 60000 }); await p.waitForTimeout(500);
  ok(/ready/.test(await tick('Hindi')), 'Hindi data saved: ready'); await stop();
  const h = await ctx.newPage(); await h.goto(URL_('tools/ocr-pdf.html')); await h.setInputFiles('#file-in', path.join(REPO, 'tests/fixtures/print.pdf')); await h.waitForSelector('#run-btn', { state: 'visible' });
  await h.check('#l-hin'); await h.click('#run-btn'); await h.waitForSelector('#dl-btn', { timeout: 150000 });
  ok(/INVOICE/i.test(await h.textContent('#summary')), 'Hindi+English OCR runs fully offline once Hindi data is saved'); await h.close();

  // 4. Remove saved: keeps the shell, removes tools and nested OCR files
  await start(); await p.bringToFront(); await p.goto(URL_('index.html')); await p.waitForTimeout(1000); await p.click('.offline-panel summary').catch(() => {});
  await p.click('#off-clear'); await p.waitForTimeout(1200);
  const keys = await p.evaluate(async () => { const c = await caches.open((await caches.keys()).find(k => k.startsWith('squeeze-'))); return (await c.keys()).map(k => new URL(k.url).pathname); });
  ok(!keys.some(k => /tesseract|vendor|tools\/.+\.html/.test(k)), 'Remove saved deletes tools, libraries and nested OCR files');
  ok(['index.html', 'style.css', 'shared.js', 'manifest.webmanifest'].every(n => keys.some(k => k.endsWith(n))), 'Remove saved keeps the app shell: ' + keys.length + ' files left');
  ok(/0 of \d+ ready/.test(await status()), 'status after removal: ' + await status());

  // 5. update path: new service worker version re-downloads what was saved, no stale leftovers
  await p.check('.off-item:has-text("Watermark PDF") input'); await p.click('#off-save'); await p.waitForFunction(() => !document.getElementById('off-save').disabled, null, { timeout: 60000 }); await p.waitForTimeout(500);
  const sw = fs.readFileSync(path.join(SITE, 'sw.js'), 'utf8'); fs.writeFileSync(path.join(SITE, 'sw.js'), sw.replace(/squeeze-v\d+/, 'squeeze-v999'));
  await p.evaluate(() => navigator.serviceWorker.getRegistration().then(r => r.update())); await p.waitForTimeout(3000);
  await p.goto(URL_('index.html')); await p.waitForTimeout(3500);
  const names = await p.evaluate(() => caches.keys());
  ok(names.length === 1 && names[0] === 'squeeze-v999', 'old cache removed after update: ' + names.join(','));
  await p.click('.offline-panel summary').catch(() => {});
  ok(/ready/.test(await tick('Watermark PDF')), 'saved tool survives the update (re-downloaded in background)');
  console.log(`\n${pass} passed, ${fail} failed`); await b.close(); await stop(); process.exit(fail ? 1 : 0);
})().catch(async e => { console.log('TEST CRASH', e.message); await stop(); process.exit(2); });
