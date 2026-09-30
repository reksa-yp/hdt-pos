/*
 * HDT POS - Service Worker
 * Menyimpan "kulit" aplikasi (HTML/ikon) di cache agar aplikasi tetap bisa
 * dibuka dan dipakai walau tidak ada internet sama sekali. Data (produk,
 * transaksi, dst) disimpan terpisah di IndexedDB oleh index.html, bukan di sini.
 */
const CACHE_NAME = 'hdtpos-shell-v4';
const SHELL_FILES = [
  './',
  './index.html',
  './manifest.json',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/icon-512-maskable.png'
];

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => cache.addAll(SHELL_FILES))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(names => Promise.all(
      names.filter(n => n !== CACHE_NAME).map(n => caches.delete(n))
    )).then(() => self.clients.claim())
  );
});

// Strategi: "network first, jatuh ke cache" untuk index.html (supaya update terbaru
// langsung kepakai begitu online), dan "cache first" untuk aset statis lain (ikon dst).
self.addEventListener('fetch', event => {
  const req = event.request;
  if (req.method !== 'GET') { return; }
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) { return; } // jangan campuri panggilan ke Google Apps Script

  const isAppShell = req.mode === 'navigate' || url.pathname.endsWith('/index.html') || url.pathname.endsWith('/');
  if (isAppShell) {
    event.respondWith(
      fetch(req).then(res => {
        const copy = res.clone();
        caches.open(CACHE_NAME).then(cache => cache.put('./index.html', copy));
        return res;
      }).catch(() => caches.match('./index.html'))
    );
    return;
  }

  event.respondWith(
    caches.match(req).then(cached => cached || fetch(req).then(res => {
      const copy = res.clone();
      caches.open(CACHE_NAME).then(cache => cache.put(req, copy));
      return res;
    }).catch(() => cached))
  );
});
