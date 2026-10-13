
// Bump V whenever any cached file changes, so installed copies update.
const V = 'squeeze-v5';
// Every page, script, style and library, so every tool works offline after the first visit.
const CORE = [
  "./",
  "icon-192.png",
  "icon-512.png",
  "index.html",
  "manifest.webmanifest",
  "style.css",
  "tools/compress-files.html",
  "tools/compress-images.html",
  "tools/compress-pdf.html",
  "tools/convert-images.html",
  "tools/images-to-pdf.html",
  "tools/merge-pdf.html",
  "tools/office-to-pdf.html",
  "tools/organize-pdf.html",
  "tools/pdf-metadata.html",
  "tools/pdf-page-numbers.html",
  "tools/pdf-to-images.html",
  "tools/pdf-to-word.html",
  "tools/resize-images.html",
  "tools/rotate-pdf.html",
  "tools/shared.js",
  "tools/split-pdf.html",
  "tools/watermark-pdf.html",
  "vendor/jszip.min.js",
  "vendor/pdf-lib.min.js",
  "vendor/pdf.min.mjs",
  "vendor/pdf.worker.min.mjs"
];
const OPTIONAL = ['vendor/gs.mjs', 'vendor/gs.wasm']; // cached at install if you vendored them

self.addEventListener('install', e => {
  e.waitUntil((async () => {
    const c = await caches.open(V);
    await c.addAll(CORE);
    await Promise.all(OPTIONAL.map(u => c.add(u).catch(() => { })));
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(ks => Promise.all(ks.filter(k => k !== V).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', e => {
  const r = e.request, u = new URL(r.url);
  if (r.method !== 'GET') return;
  const isAllowedHost = u.origin === location.origin ||
    u.hostname.includes('cdnjs.cloudflare.com') ||
    u.hostname.includes('cdn.jsdelivr.net') ||
    u.hostname.includes('fonts.googleapis.com') ||
    u.hostname.includes('fonts.gstatic.com');
  if (!isAllowedHost) return;
  const key = (r.mode === 'navigate' && u.origin === location.origin) ? r.url : r;
  e.respondWith((async () => {
    const c = await caches.open(V);
    const hit = await c.match(key, { ignoreSearch: true });
    const net = fetch(key)
      .then(res => { if (res.status === 200) c.put(key, res.clone()).catch(() => { }); return res; })
      .catch(() => null);
    if (hit) { e.waitUntil(net); return hit; }
    const res = await net;
    if (res) return res;
    return (r.mode === 'navigate' && await c.match('./')) || Response.error();
  })());
});
