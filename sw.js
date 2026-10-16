// Bump V whenever any app file changes, so installed copies update.
const V = 'squeeze-v11';
// The app shell: always kept, never removed by "Remove saved".
const CORE = ['./', 'icon-192.png', 'icon-512.png', 'index.html', 'manifest.webmanifest', 'style.css', 'tools/shared.js'];
const SCOPE = new URL(self.registration.scope).pathname;
const rel = u => { const p = new URL(u, self.registration.scope).pathname; return p.startsWith(SCOPE) ? p.slice(SCOPE.length) : p; };
const CORE_SET = new Set(CORE.map(p => rel(p)));
const PENDING = '__pending.json'; // saved files from the previous version, to be downloaded again after an update
let cancelSave = false, refreshing = false;

// ---------- downloading one file safely ----------
// A file is only stored when the whole body arrived and matches its declared size.
async function fetchComplete(url, tries = 3) {
  let err;
  for (let i = 0; i < tries; i++) {
    try {
      const res = await fetch(new Request(url, { cache: 'reload' }));
      if (res.status !== 200) throw new Error('HTTP ' + res.status);
      const buf = await res.arrayBuffer();
      const cl = res.headers.get('content-length');
      if (cl && !res.headers.get('content-encoding') && +cl !== buf.byteLength) throw new Error('incomplete download');
      if (!buf.byteLength) throw new Error('empty file');
      return new Response(buf, { status: 200, headers: { 'content-type': res.headers.get('content-type') || 'application/octet-stream' } });
    } catch (e) { err = e; await new Promise(r => setTimeout(r, 400 * (i + 1))); }
  }
  throw err;
}
const isQuota = e => e && (e.name === 'QuotaExceededError' || /quota|storage/i.test(String(e.message)));

async function saveFiles(urls, onProgress) {
  const c = await caches.open(V), failed = []; let done = 0, quota = false;
  cancelSave = false;
  const queue = urls.slice();
  const worker = async () => {
    while (queue.length && !cancelSave && !quota) {
      const u = queue.shift();
      try { await c.put(new URL(u, self.registration.scope).href, await fetchComplete(u)); }
      catch (e) { failed.push(u); if (isQuota(e)) quota = true; }
      onProgress && onProgress(++done, urls.length, u);
    }
  };
  await Promise.all([worker(), worker()]);
  return { failed, quota, cancelled: cancelSave };
}

// ---------- install / activate ----------
self.addEventListener('install', e => {
  e.waitUntil((async () => {
    const c = await caches.open(V);
    for (const u of CORE) await c.put(new URL(u, self.registration.scope).href, await fetchComplete(u)); // any failure aborts the install; the old version keeps working
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', e => {
  e.waitUntil((async () => {
    const c = await caches.open(V), pending = [];
    for (const k of await caches.keys()) {
      if (k === V || !k.startsWith('squeeze-')) continue;
      const old = await caches.open(k);
      for (const r of await old.keys()) { const p = rel(r.url); if (!CORE_SET.has(p) && p !== PENDING && !pending.includes(p)) pending.push(p); }
      await caches.delete(k);
    }
    if (pending.length) await c.put(new URL(PENDING, self.registration.scope).href, new Response(JSON.stringify(pending)));
    await self.clients.claim();
  })());
});

// Re-download what was saved before an update (best effort, runs when the page is in use).
async function refreshSaved() {
  if (refreshing) return; refreshing = true;
  try {
    const c = await caches.open(V), key = new URL(PENDING, self.registration.scope).href, r = await c.match(key);
    if (!r) return;
    const list = await r.json(), res = await saveFiles(list);
    if (!res.failed.length || res.cancelled) await c.delete(key);
    else await c.put(key, new Response(JSON.stringify(res.failed)));
  } catch (e) { /* try again next time */ } finally { refreshing = false; }
}

// ---------- page requests ----------
self.addEventListener('fetch', e => {
  const r = e.request, u = new URL(r.url);
  if (r.method !== 'GET' || u.origin !== location.origin || r.headers.has('range')) return;
  const p = rel(r.url);
  e.respondWith(p.startsWith('vendor/') ? cacheFirst(r) : networkFirst(r));
  if (r.mode === 'navigate') e.waitUntil(refreshSaved());
});

async function cacheFirst(r) {
  const c = await caches.open(V), hit = await c.match(r, { ignoreSearch: true });
  if (hit) return hit;
  const res = await fetch(r);
  if (res.status === 200) c.put(r, res.clone()).catch(() => { });
  return res;
}

async function networkFirst(r) {
  const c = await caches.open(V);
  try {
    const ctl = new AbortController(), t = setTimeout(() => ctl.abort(), 4000);
    const res = await fetch(r, { signal: ctl.signal }); clearTimeout(t);
    if (res.status === 200) { c.put(r, res.clone()).catch(() => { }); return res; }
    return (await c.match(r, { ignoreSearch: true })) || res;
  } catch (e) {
    const hit = await c.match(r, { ignoreSearch: true });
    if (hit) return hit;
    if (r.mode === 'navigate') { const home = await c.match(new URL('./', self.registration.scope).href); if (home) return home; }
    return Response.error();
  }
}

// ---------- messages from the home page ----------
self.addEventListener('message', e => {
  const m = e.data || {}, port = e.ports[0];
  if (!port) return;
  e.waitUntil((async () => {
    const c = await caches.open(V);
    if (m.type === 'status') {
      const paths = (await c.keys()).map(k => rel(k.url));
      port.postMessage({ paths, version: V, pending: paths.includes(PENDING) });
      refreshSaved();
    } else if (m.type === 'save') {
      const res = await saveFiles(m.urls, (done, total, file) => port.postMessage({ progress: { done, total, file } }));
      port.postMessage({ done: true, ...res });
    } else if (m.type === 'cancel') {
      cancelSave = true; port.postMessage({ ok: true });
    } else if (m.type === 'clear') {
      let n = 0;
      for (const k of await c.keys()) { if (!CORE_SET.has(rel(k.url))) { await c.delete(k); n++; } }
      port.postMessage({ removed: n });
    }
  })());
});
