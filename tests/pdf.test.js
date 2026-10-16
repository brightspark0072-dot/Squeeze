// PDF reliability tests. Usage: node tests/pdf.test.js  (needs playwright, chromium, python3 with PIL/pypdf/reportlab; qpdf + pdftotext enable the cross-checks)
const { chromium } = require(process.env.PW || 'playwright'); const { spawn, execSync } = require('child_process'); const fs = require('fs'), path = require('path'), os = require('os');
const REPO = path.resolve(__dirname, '..'), TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'sqp-')), PORT = 8900 + Math.floor(Math.random() * 90), CHROME = process.env.CHROME || '/opt/pw-browsers/chromium';
let pass = 0, fail = 0; const ok = (c, m) => { c ? pass++ : fail++; console.log((c ? 'PASS ' : 'FAIL ') + m); };
const sh = c => execSync(c, { stdio: ['ignore', 'pipe', 'pipe'] }).toString(); const has = b => { try { sh('which ' + b); return true; } catch (e) { return false; } };
const shq = c => sh(c + ' 2>&1; true'); const QPDF = has('qpdf'), TXT = has('pdftotext'), F = n => path.join(TMP, n);
// ---- fixtures ----
sh(`python3 - <<'PY'
import random, os
from PIL import Image, ImageFilter
from reportlab.pdfgen import canvas
from pypdf import PdfWriter
T=${JSON.stringify(TMP)}
def textpdf(name,pages,word):
    c=canvas.Canvas(os.path.join(T,name))
    for i in range(pages):
        for l in range(30): c.drawString(60,780-l*22,f"{word} page {i+1} line {l+1} The quick brown fox jumps over the lazy dog")
        c.showPage()
    c.save()
textpdf('text3.pdf',3,'ALPHA'); textpdf('text2.pdf',2,'BRAVO'); textpdf('big.pdf',120,'BIG')
random.seed(1)
imgs=[]
for k in range(3):
    im=Image.effect_noise((1600,1200),60).convert('RGB').filter(ImageFilter.GaussianBlur(1.2)); imgs.append(im)
imgs[0].save(os.path.join(T,'photos.pdf'),save_all=True,append_images=imgs[1:],quality=95)
d=open(os.path.join(T,'text3.pdf'),'rb').read(); open(os.path.join(T,'broken.pdf'),'wb').write(d[:len(d)//2])
open(os.path.join(T,'notpdf.pdf'),'wb').write(b'hello this is not a pdf at all')
PY`);
if (QPDF) { sh(`cd ${TMP} && qpdf --encrypt user own 256 -- text3.pdf enc256.pdf && qpdf --allow-weak-crypto --encrypt user own 128 --use-aes=y -- text3.pdf enc128.pdf && qpdf --allow-weak-crypto --encrypt user own 128 --use-aes=n -- text3.pdf encrc4.pdf`); }
const reqs = [];
(async () => {
  const srv = spawn('python3', [path.join(REPO, 'tests/serve.py'), PORT, REPO], { stdio: 'ignore' }); await new Promise(r => setTimeout(r, 800));
  const b = await chromium.launch({ executablePath: CHROME }), ctx = await b.newContext({ acceptDownloads: true });
  ctx.on('request', r => reqs.push({ url: r.url(), method: r.method(), body: r.postData() }));
  const open = async (tool, files, sel = '#file-in') => { const p = await ctx.newPage(); p.on('pageerror', e => console.log('  PAGEERR', e.message)); p.on('dialog', d => d.accept()); await p.goto(`http://localhost:${PORT}/tools/${tool}.html`); await p.setInputFiles(sel, [].concat(files).map(F)); return p; };
  const run = async (p, runSel, out = 'pdf') => { await p.click(runSel); await p.waitForSelector('#dl-btn', { timeout: 180000 }).catch(() => null); if (!(await p.$('#dl-btn'))) return null; const [d] = await Promise.all([p.waitForEvent('download'), p.click('#dl-btn')]); const f = F('out-' + Math.random().toString(36).slice(2) + '.' + out); await d.saveAs(f); return { f, name: d.suggestedFilename() }; };
  const toastText = p => p.textContent('#toast-wrap').catch(() => '');
  const pages = f => +sh(`python3 -c "import pypdf,sys;print(len(pypdf.PdfReader(sys.argv[1]).pages))" ${f}`);
  const txt = f => TXT ? sh(`pdftotext ${f} -`) : '';

  // merge
  { const p = await open('merge-pdf', ['text3.pdf', 'text2.pdf'], 'input[type=file]'); await p.waitForTimeout(800); const o = await run(p, '#run-btn'); ok(o && pages(o.f) === 5, 'merge: 3+2 pages -> 5'); if (o && TXT) ok(/ALPHA/.test(txt(o.f)) && /BRAVO/.test(txt(o.f)), 'merge: text of both files kept'); await p.close(); }
  // merge refuses password-protected input instead of producing blanks
  if (QPDF) for (const n of ['enc256', 'enc128', 'encrc4']) { const p = await open('merge-pdf', [n + '.pdf', 'text2.pdf'], 'input[type=file]'); await p.waitForTimeout(500); await p.click('#run-btn'); await p.waitForTimeout(1500); ok(/password-protected/.test(await toastText(p)) && !(await p.$('#dl-btn')), `merge: ${n} -> asks to unlock first`); await p.close(); }
  // malformed / not a pdf
  for (const n of ['broken.pdf', 'notpdf.pdf']) { const p = await open('merge-pdf', [n, 'text2.pdf'], 'input[type=file]'); await p.waitForTimeout(500); await p.click('#run-btn'); await p.waitForTimeout(1500); const t = await toastText(p); ok(/could not be read|Error/.test(t) && !(await p.$('#dl-btn')), `merge: ${n} -> clear error, no download (${t.trim().slice(0, 70)})`); await p.close(); }
  // split all pages
  { const p = await open('split-pdf', 'text3.pdf'); await p.waitForSelector('#sel-all', { state: 'visible' }); await p.click('#sel-all'); const o = await run(p, '#extract-btn'); ok(o && pages(o.f) === 3, 'split: selecting all pages keeps 3 pages'); await p.close(); }
  // rotate
  { const p = await open('rotate-pdf', 'text3.pdf'); await p.waitForSelector('canvas'); const o = await run(p, '#save-btn'); ok(!!o && pages(o.f) === 3, 'rotate: output has 3 pages'); await p.close(); }
  // compress: photos shrink, text never grows
  for (const mode of ['images', 'raster']) {
    const p = await open('compress-pdf', 'photos.pdf'); await p.waitForSelector('#run-btn', { state: 'visible' }); const sel = await p.$(`input[value="${mode}"]`); if (sel) await sel.check().catch(() => sel.click());
    const o = await run(p, '#run-btn'); const ratio = o ? fs.statSync(o.f).size / fs.statSync(F('photos.pdf')).size : 9; ok(!!o && ratio < 1, `compress (${mode}): photo PDF smaller (${o ? Math.round(ratio * 100) + '% of original' : 'no output'})`); if (o && QPDF) ok(/No syntax or stream encoding errors found/.test(shq(`qpdf --check ${o.f}`)), `compress (${mode}): output passes qpdf --check`); await p.close();
  }
  { const p = await open('compress-pdf', 'text3.pdf'); await p.waitForSelector('#run-btn', { state: 'visible' }); await p.click('#run-btn'); await p.waitForTimeout(6000); const dl = await p.$('#dl-btn'); const sum = await p.textContent('#summary'); let good = true; if (dl) { const [d] = await Promise.all([p.waitForEvent('download'), p.click('#dl-btn')]); const f = F('tc.pdf'); await d.saveAs(f); good = fs.statSync(f).size < fs.statSync(F('text3.pdf')).size; } ok(good, 'compress: a download is only offered when the file is really smaller: "' + sum.trim().slice(0, 60) + '"'); await p.close(); }
  // large file
  { const t0 = Date.now(); const p = await open('merge-pdf', ['big.pdf', 'big.pdf'], 'input[type=file]'); await p.waitForTimeout(800); const o = await run(p, '#run-btn'); ok(o && pages(o.f) === 240, 'large: 120+120 pages merged in ' + ((Date.now() - t0) / 1000).toFixed(1) + 's'); await p.close(); }
  // protect -> verify independently with qpdf, wrong password refused, unlock round trip
  { const p = await open('protect-pdf', 'text3.pdf'); await p.waitForSelector('#pw1', { state: 'visible' }); await p.fill('#pw1', 'Pa55w0rd!'); await p.fill('#pw2', 'Pa55w0rd!'); await p.fill('#pw-owner', 'OwnerKey'); await p.uncheck('#a-copy'); const o = await run(p, '#run-btn');
    ok(!!o, 'protect: produced a file'); if (o && QPDF) { ok(/R = 6/.test(sh(`qpdf --show-encryption --password='Pa55w0rd!' ${o.f} 2>&1`)), 'protect: qpdf sees AES-256 (R=6)'); ok(/password/i.test(shq(`qpdf --check ${o.f}`)), 'protect: qpdf refuses to open without the password'); ok(shq(`qpdf --check --password='Pa55w0rd!' ${o.f}`).includes('No syntax or stream encoding errors'), 'protect: qpdf --check passes with the user password'); ok(/ALPHA page 3/.test(sh(`pdftotext -upw 'Pa55w0rd!' ${o.f} -`)), 'protect: text readable with the password'); ok(/invalid password/i.test(shq(`qpdf --check --password=wrong ${o.f}`)), 'protect: wrong password rejected by qpdf');
      ok(/extract for any purpose: not allowed/.test(sh(`qpdf --show-encryption --password=OwnerKey ${o.f} 2>&1`)), 'protect: copy restriction recorded'); fs.copyFileSync(o.f, F('mine-protected.pdf')); }
    await p.close(); }
  if (fs.existsSync(F('mine-protected.pdf'))) { const p = await open('unlock-pdf', 'mine-protected.pdf'); await p.waitForSelector('#pw', { state: 'visible' }); await p.fill('#pw', 'nope'); await p.click('#run-btn'); await p.waitForTimeout(1500); ok(/not correct/.test(await toastText(p)) && !(await p.$('#dl-btn')), 'unlock: wrong password -> clear message, no file'); await p.fill('#pw', 'Pa55w0rd!'); const o = await run(p, '#run-btn'); ok(!!o && pages(o.f) === 3, 'unlock: own protected file round-trips'); if (o && TXT) ok(/ALPHA page 2/.test(txt(o.f)), 'unlock: text intact'); await p.close(); }
  if (QPDF) for (const [n, pw] of [['enc256', 'user'], ['enc128', 'own'], ['encrc4', 'user']]) { const p = await open('unlock-pdf', n + '.pdf'); await p.waitForSelector('#pw', { state: 'visible' }); await p.fill('#pw', pw); const o = await run(p, '#run-btn'); ok(!!o && pages(o.f) === 3 && (!TXT || /ALPHA page 1/.test(txt(o.f))), `unlock: qpdf-made ${n} opens with ${pw === 'own' ? 'owner' : 'user'} password`); if (o) ok(/not encrypted/i.test(shq(`qpdf --check ${o.f}`)), `unlock: ${n} output is no longer encrypted`); await p.close(); }
  // privacy: nothing left the machine and nothing was uploaded
  const external = reqs.filter(r => !r.url.startsWith(`http://localhost:${PORT}/`) && !r.url.startsWith('data:') && !r.url.startsWith('blob:'));
  const posts = reqs.filter(r => r.method !== 'GET' && r.method !== 'HEAD');
  ok(external.length === 0, 'privacy: no request left localhost (' + reqs.length + ' requests checked' + (external.length ? '; ' + external[0].url : '') + ')');
  ok(posts.length === 0, 'privacy: no POST/PUT requests were made');
  console.log(`\n${pass} passed, ${fail} failed`); await b.close(); srv.kill(); process.exit(fail ? 1 : 0);
})().catch(e => { console.log('TEST CRASH', e.stack); process.exit(2); });
