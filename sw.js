
// Bump V whenever any cached file changes, so installed copies update.
const V = 'squeeze-v6';
const CORE = [
  "./", "icon-192.png", "icon-512.png", "index.html", "manifest.webmanifest", "style.css", "tools/shared.js"
];
// Tool pages and libraries are cached when you open them, or when you press "Save" on the home page.
const OPTIONAL = ['vendor/gs.mjs', 'vendor/gs.wasm']; // cached at install if you vendored them

self.addEventListener('install', e => {
  e.waitUntil((async () => {
    const c = await caches.open(V);
    await c.addAll(CORE);
    await Promise.all(OPTIONAL.map(u => c.add(u).catch(() => { })));
    await self.skipWaiting();
  })());
});

self.addEventListener('message', e => {
  const m = e.data || [], port = e.ports[0];
  e.waitUntil((async () => {
    const c = await caches.open(V);
    if (m.type === 'status') {
      const ks = await c.keys();
      const saved = ks.map(k => new URL(k.url).pathname.replace(/^.*\/(tools\/[^/]+\.html)$/, '$1')).filter(p => /^tools\/.+\.html$/.test(p));
      port.postMessage({ saved: saved.filter(p => p !== 'tools/shared.js') });
    } else if (m.type === 'save') {
      let failed = 0;
      await Promise.all(m.urls.map(u => c.add(u).catch(() => { failed++; })));
      port.postMessage({ failed });
    } else if (m.type === 'clear') {
      for (const k of await c.keys()) { const p = new URL(k.url).pathname; if (/\/(tools\/[^/]+\.html|vendor\/[^/]+)$/.test(p)) await c.delete(k); }
      port.postMessage({ ok: true });
    }
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
