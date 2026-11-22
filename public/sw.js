// Lode Runner 2099 service worker: offline play.
// - hashed build assets (/assets/*), icons: cache-first
// - HTML navigations: network-first, cached fallback (and every fresh page re-caches the assets it references)
// - never touches /api/*, /ws/*, non-GET or cross-origin requests
const CACHE = 'lr2099-v2';
const SHELL = ['./', './pad', './manifest.webmanifest', './icons/icon-192.png', './icons/icon-512.png', './favicon.png'];
const scope = new URL(self.registration.scope);
const isAsset = (u) => /\/assets\//.test(u.pathname) || /\/icons\//.test(u.pathname) || /\.(png|ico|woff2?)$/.test(u.pathname);
const assetsIn = (html, base) =>
  [...html.matchAll(/(?:src|href)="([^"]+\.(?:js|css|png|woff2?))"/g)].map((m) => new URL(m[1], base).href).filter((u) => !/\/splash\//.test(u));

async function cachePage(cache, url, res) {
  const html = await res.clone().text();
  await cache.put(url, res);
  const refs = assetsIn(html, url);
  await Promise.all(refs.map(async (a) => { if (!(await cache.match(a))) await cache.add(a).catch(() => {}); }));
  return refs;
}
async function prune(cache) {
  // drop old hashed assets that no cached page references any more
  const keys = await cache.keys();
  const pages = keys.filter((r) => !isAsset(new URL(r.url)) && !/\.webmanifest$/.test(r.url));
  const keep = new Set(SHELL.map((s) => new URL(s, scope).href));
  for (const p of pages) { const r = await cache.match(p); if (r) assetsIn(await r.text(), p.url).forEach((a) => keep.add(a)); }
  await Promise.all(keys.filter((r) => /\/assets\//.test(r.url) && !keep.has(r.url)).map((r) => cache.delete(r)));
}

self.addEventListener('install', (e) => {
  e.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    for (const s of SHELL) {
      const url = new URL(s, scope).href;
      try {
        const res = await fetch(url, { cache: 'no-cache' });
        if (!res.ok) continue;
        if ((res.headers.get('content-type') || '').includes('text/html')) await cachePage(cache, url, res);
        else await cache.put(url, res);
      } catch { /* offline install: skip */ }
    }
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', (e) => {
  e.waitUntil((async () => {
    for (const k of await caches.keys()) if (k !== CACHE) await caches.delete(k);
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  const url = new URL(req.url);
  if (req.method !== 'GET' || url.origin !== scope.origin || /^\/(api|ws|app)(\/|$)/.test(url.pathname)) return;
  if (req.mode === 'navigate' || (req.headers.get('accept') || '').includes('text/html')) {
    const key = url.origin + url.pathname; // ignore ?seed=… etc. for the cache key
    e.respondWith((async () => {
      const cache = await caches.open(CACHE);
      try {
        const res = await fetch(req);
        if (res.ok) e.waitUntil(cachePage(cache, key, res.clone()).then(() => prune(cache)));
        return res;
      } catch {
        return (await cache.match(key)) || (await cache.match(new URL('./', scope).href)) || Response.error();
      }
    })());
    return;
  }
  if (isAsset(url)) {
    e.respondWith((async () => {
      const cache = await caches.open(CACHE);
      const hit = await cache.match(req);
      if (hit) return hit;
      const res = await fetch(req);
      if (res.ok) cache.put(req, res.clone());
      return res;
    })());
  }
});
