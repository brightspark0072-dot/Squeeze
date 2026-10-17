// Mobile/accessibility audit. Usage: node tests/ux.test.js  (needs playwright + chromium)
const { chromium } = require(process.env.PW || 'playwright'); const { spawn } = require('child_process'); const fs = require('fs'), path = require('path');
const REPO = path.resolve(__dirname, '..'), PORT = 8700 + Math.floor(Math.random() * 200), CHROME = process.env.CHROME || '/opt/pw-browsers/chromium';
let pass = 0, fail = 0; const ok = (c, m) => { c ? pass++ : fail++; console.log((c ? 'PASS ' : 'FAIL ') + m); };
const lum = c => { const [r, g, b] = c.map(v => { v /= 255; return v <= .03928 ? v / 12.92 : Math.pow((v + .055) / 1.055, 2.4); }); return .2126 * r + .7152 * g + .0722 * b; };
const ratio = (a, b) => { const x = lum(a), y = lum(b); return (Math.max(x, y) + .05) / (Math.min(x, y) + .05); };
(async () => {
  const srv = spawn('python3', [path.join(REPO, 'tests/serve.py'), PORT, REPO], { stdio: 'ignore' }); await new Promise(r => setTimeout(r, 800));
  const b = await chromium.launch({ executablePath: CHROME }), ctx = await b.newContext({ viewport: { width: 360, height: 740 }, hasTouch: true, isMobile: true });
  const pages = ['index.html', ...fs.readdirSync(path.join(REPO, 'tools')).filter(f => f.endsWith('.html')).map(f => 'tools/' + f)];
  for (const pg of pages) {
    const p = await ctx.newPage(); const errs = []; p.on('pageerror', e => errs.push(e.message));
    await p.goto(`http://localhost:${PORT}/${pg}`); await p.waitForTimeout(500);
    const r = await p.evaluate(() => {
      const out = { overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth, small: [], unlabeled: [], lowContrast: [] };
      const vis = e => { const s = getComputedStyle(e), r = e.getBoundingClientRect(); return s.display !== 'none' && s.visibility !== 'hidden' && r.width > 0 && r.height > 0; };
      document.querySelectorAll('button, a.btn-primary, a.btn-secondary, .radio-pill, select, input[type=text], input[type=number], input[type=password], input[type=search], .back-link, summary, .tool-card').forEach(e => {
        if (!vis(e)) return; const r = e.getBoundingClientRect(); if (r.height < 43.5 || r.width < 43.5) out.small.push((e.id || e.className || e.tagName).toString().slice(0, 30) + ' ' + Math.round(r.width) + 'x' + Math.round(r.height));
      });
      document.querySelectorAll('button, input:not([type=hidden]):not([type=file]), select, textarea').forEach(e => { if (!vis(e) && e.type !== 'checkbox' && e.type !== 'radio') return;
        const lab = e.getAttribute('aria-label') || e.title || (e.id && document.querySelector('label[for="' + e.id + '"]')) || e.closest('label') || e.textContent.trim() || e.placeholder || e.getAttribute('aria-labelledby') || e.closest('.control-row'); if (!lab) out.unlabeled.push(e.id || e.tagName); });
      const parse = s => (s.match(/[\d.]+/g) || []).slice(0, 3).map(Number);
      const bgOf = e => { for (; e; e = e.parentElement) { const c = getComputedStyle(e).backgroundColor, m = c.match(/[\d.]+/g); if (m && (m.length < 4 || +m[3] > .9)) return parse(c); } return [251, 247, 238]; };
      document.querySelectorAll('p, span, h1, h2, h3, label, a, button, em, summary').forEach(e => { if (!vis(e) || ![...e.childNodes].some(n => n.nodeType === 3 && n.textContent.trim())) return;
        const fg = parse(getComputedStyle(e).color), bg = bgOf(e); out.lowContrast.push({ t: e.textContent.trim().slice(0, 24), fg, bg, size: parseFloat(getComputedStyle(e).fontSize), op: +getComputedStyle(e).opacity }); });
      return out;
    });
    const lows = r.lowContrast.filter(x => { const need = x.size >= 18 ? 3 : 4.5; return ratio(x.fg, x.bg) < need - 0.01 && x.op > 0.5; });
    ok(r.overflow <= 0, pg + ': no horizontal overflow' + (r.overflow > 0 ? ' (' + r.overflow + 'px)' : ''));
    ok(!r.small.length, pg + ': touch targets >= 44px' + (r.small.length ? ' -> ' + [...new Set(r.small)].slice(0, 5).join(', ') : ''));
    ok(!r.unlabeled.length, pg + ': controls labelled' + (r.unlabeled.length ? ' -> ' + r.unlabeled.slice(0, 4).join(',') : ''));
    ok(!lows.length, pg + ': text contrast' + (lows.length ? ' -> ' + lows.slice(0, 3).map(x => `"${x.t}" ${ratio(x.fg, x.bg).toFixed(1)}`).join('; ') : ''));
    ok(!errs.length, pg + ': no script errors' + (errs.length ? ' ' + errs[0] : '')); await p.close();
  }
  // long file names must not break the layout once a file is loaded
  const os = require('os'); const long = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'sqx-')), 'a_really_long_scanned_document_name_that_goes_on_and_on_and_on_for_a_very_long_time_2026_final_v7.pdf');
  fs.copyFileSync(path.join(REPO, 'tests/fixtures/print.pdf'), long);
  for (const pg of ['merge-pdf', 'split-pdf', 'rotate-pdf', 'compress-pdf', 'watermark-pdf', 'pdf-page-numbers', 'ocr-pdf', 'protect-pdf', 'organize-pdf', 'pdf-to-images']) {
    const p = await ctx.newPage(); await p.goto(`http://localhost:${PORT}/tools/${pg}.html`); await p.setInputFiles('input[type=file]', long); await p.waitForTimeout(1500);
    const ov = await p.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    ok(ov <= 0, pg + ': long file name does not overflow at 360px' + (ov > 0 ? ' (' + ov + 'px)' : '')); await p.close();
  }
  console.log(`\n${pass} passed, ${fail} failed`); await b.close(); srv.kill(); process.exit(fail ? 1 : 0);
})();
