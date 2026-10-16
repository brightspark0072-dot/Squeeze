// ===== SHARED UTILITIES FOR ALL TOOL PAGES =====
const $ = s => document.querySelector(s);
const $$ = s => [...document.querySelectorAll(s)];

// ===== TOAST NOTIFICATIONS =====
function toast(msg, type = 'info', duration = 3500) {
  let wrap = document.getElementById('toast-wrap');
  if (!wrap) {
    wrap = document.createElement('div');
    wrap.id = 'toast-wrap';
    wrap.className = 'toast-wrap';
    wrap.setAttribute('role', 'status'); wrap.setAttribute('aria-live', 'polite');
    document.body.appendChild(wrap);
  }
  const el = document.createElement('div');
  el.className = 'toast ' + type;
  el.textContent = msg;
  if (type === 'error') { el.setAttribute('role', 'alert'); duration = Math.max(duration, 7000); }
  wrap.appendChild(el);
  setTimeout(() => el.remove(), duration);
}

// ===== FORMAT BYTES =====
function fmt(n) {
  if (n < 1024) return n + ' B';
  if (n < 1048576) return (n / 1024).toFixed(n < 10240 ? 1 : 0) + ' KB';
  return (n / 1048576).toFixed(2) + ' MB';
}

// ===== FORMAT SAVINGS =====
function savings(orig, compressed) {
  const pct = Math.max(0, Math.round(100 - 100 * compressed / orig));
  return fmt(orig) + ' \u2192 ' + fmt(compressed) + ' (\u2212' + pct + '%)';
}

// ===== DRAG AND DROP =====
function setupDrop(zone, onFiles, multiple = false, accept = null) {
  zone.addEventListener('dragover', e => { e.preventDefault(); zone.classList.add('dragover'); });
  zone.addEventListener('dragleave', () => zone.classList.remove('dragover'));
  zone.addEventListener('drop', e => {
    e.preventDefault();
    zone.classList.remove('dragover');
    let files = [...e.dataTransfer.files];
    if (accept) files = files.filter(f => {
      if (accept.includes('/')) return f.type.startsWith(accept.replace('*',''));
      return accept.split(',').some(ext => f.name.toLowerCase().endsWith(ext.trim()));
    });
    if (!files.length) { toast('No compatible files dropped', 'error'); return; }
    if (!multiple) files = [files[0]];
    onFiles(files);
  });
}

// ===== DOWNLOAD BLOB =====
// Adds a date-time stamp so every file you save has a unique name (e.g. report_merged_261012-013045.pdf).
function stamp() {
  const d = new Date(), p = n => String(n).padStart(2, '0');
  return String(d.getFullYear()).slice(2) + p(d.getMonth() + 1) + p(d.getDate()) + '-' + p(d.getHours()) + p(d.getMinutes()) + p(d.getSeconds());
}
function uniqueName(name) {
  name = String(name).replace(/[\\/:*?"<>|\u0000-\u001f]/g, '_').replace(/^\.+/, '_'); // no path characters in file names
  const m = /^(.*?)(\.[^.]+)?$/.exec(name), ext = m[2] || '';
  return m[1].slice(0, 120) + '_' + stamp() + ext;
}
function download(blob, name) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = uniqueName(name);
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}
// "report" or "report_and_2_more" for a list of files
function nameFor(files) {
  const list = [...files];
  if (!list.length) return 'files';
  return stem(list[0].name) + (list.length > 1 ? '_and_' + (list.length - 1) + '_more' : '');
}

// ===== SELF-HOSTED LIBRARIES (in /vendor, cached by the service worker, so they work offline) =====
const VENDOR = new URL('../vendor/', document.currentScript.src).href;
function loadScript(src, ready) {
  return new Promise((ok, fail) => {
    if (ready()) return ok();
    const s = document.createElement('script');
    s.src = src; s.onload = ok;
    s.onerror = () => fail(new Error('Could not load a required library. Open this app once while online so it can be saved for offline use.'));
    document.head.appendChild(s);
  });
}

let _pdfjs = null;
async function getPdfJs() {
  if (_pdfjs) return _pdfjs;
  try {
    const m = await import(VENDOR + 'pdf.min.mjs');
    m.GlobalWorkerOptions.workerSrc = VENDOR + 'pdf.worker.min.mjs';
    _pdfjs = m;
  } catch (e) { throw new Error('Could not load the PDF viewer library. Open this app once while online so it can be saved for offline use.'); }
  return _pdfjs;
}

let _pdfLib = null;
async function getPdfLib() {
  if (_pdfLib) return _pdfLib;
  await loadScript(VENDOR + 'pdf-lib.min.js', () => window.PDFLib);
  return (_pdfLib = window.PDFLib);
}

let _jszip = null;
async function getJsZip() {
  if (_jszip) return _jszip;
  await loadScript(VENDOR + 'jszip.min.js', () => window.JSZip);
  return (_jszip = window.JSZip);
}

// ===== RENDER PDF PAGE TO CANVAS =====
async function renderPage(pdfDoc, pageNum, scale = 1.5) {
  const page = await pdfDoc.getPage(pageNum);
  const vp = page.getViewport({ scale });
  const canvas = document.createElement('canvas');
  canvas.width = vp.width; canvas.height = vp.height;
  const ctx = canvas.getContext('2d');
  await page.render({ canvas, canvasContext: ctx, viewport: vp, background: 'rgb(255,255,255)' }).promise;
  return canvas;
}


// ===== PDF LOADING (password-protected files would otherwise produce blank or corrupt output) =====
async function loadPdfDoc(bytes, opts = {}) {
  const { PDFDocument } = await getPdfLib();
  let doc;
  try { doc = await PDFDocument.load(bytes, { ignoreEncryption: true, ...opts }); }
  catch (e) { throw new Error('This file could not be read as a PDF. It may be damaged or not a PDF.'); }
  if (doc.context.trailerInfo.Encrypt) throw new Error('This PDF is password-protected. Remove the password with Unlock PDF first.');
  return doc;
}
// Friendly text for errors thrown by pdf.js
function pdfErrorText(e) {
  if (e && e.name === 'PasswordException') return 'This PDF is password-protected. Remove the password with Unlock PDF first.';
  if (e && (e.name === 'InvalidPDFException' || e.name === 'MissingPDFException')) return 'This file could not be read as a PDF. It may be damaged or not a PDF.';
  return e && e.message ? e.message : String(e);
}

// ===== STEM (filename without extension) =====
function stem(filename) {
  return filename.replace(/\.[^.]+$/, '');
}


// ===== "YOU PICKED THESE FILES" LABEL (shown under every drop zone) =====
function esc(t) { return String(t).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }
(function initPicked() {
  function init() {
    const zone = document.querySelector('.drop-zone');
    const input = zone && zone.querySelector('input[type=file]');
    if (!input || document.getElementById('file-list')) return; // pages with their own file list already show names
    const bar = document.createElement('div');
    bar.className = 'picked'; bar.hidden = true; bar.setAttribute('aria-live', 'polite');
    zone.insertAdjacentElement('afterend', bar);
    const tokens = (input.accept || '').split(',').map(t => t.trim().toLowerCase()).filter(Boolean);
    const okFile = f => !tokens.length || tokens.some(t => t.startsWith('.') ? f.name.toLowerCase().endsWith(t) : t.endsWith('/*') ? f.type.startsWith(t.slice(0, -1)) : f.type === t);
    let list = [];
    function show(files) {
      files = files.filter(okFile);
      if (!files.length) return;
      list = input.multiple ? list.concat(files) : files.slice(0, 1);
      bar.innerHTML = '<span class="picked-title">Selected file' + (list.length > 1 ? 's (' + list.length + ')' : '') + '</span>' +
        list.map(f => '<span class="picked-chip" title="' + esc(f.name) + '"><b>\u2713</b> <span class="picked-name">' + esc(f.name) + '</span> <small>' + fmt(f.size) + '</small></span>').join('');
      bar.hidden = false;
    }
    function clear() { list = []; bar.hidden = true; bar.textContent = ''; }
    input.addEventListener('change', () => show([...input.files]), true);
    zone.addEventListener('drop', e => { if (e.dataTransfer) show([...e.dataTransfer.files]); }, true);
    document.querySelectorAll('#reset-btn, #btn-reset, #btn-clear').forEach(b => b.addEventListener('click', clear));
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
})();

// When a new version of the app takes over, reload once so you never keep running stale pages.
if ('serviceWorker' in navigator) { let had = !!navigator.serviceWorker.controller, rl = false; navigator.serviceWorker.addEventListener('controllerchange', () => { if (had && !rl) { rl = true; location.reload(); } had = true; }); }
