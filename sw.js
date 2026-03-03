// ═══════════════════════════════════════
//  Sanctuary — Service Worker  (sw.js)
//  Offline-first cache strategy
// ═══════════════════════════════════════

const CACHE_NAME = 'sanctuary-v1';

// Önbelleğe alınacak tüm uygulama dosyaları
const CORE_ASSETS = [
  '/',
  '/index.html',
  '/style.css',
  '/main.js',
  '/main-room-additions.js',
  '/RoomManager.js',
  '/StateManager.js',
  '/AudioEngine.js',
  '/manifest.json'
];

// ── Install: tüm çekirdek dosyaları önbelleğe al ──
self.addEventListener('install', function(event) {
  console.log('[SW] Yükleniyor...');
  event.waitUntil(
    caches.open(CACHE_NAME).then(function(cache) {
      console.log('[SW] Dosyalar önbelleğe alınıyor');
      return cache.addAll(CORE_ASSETS);
    }).then(function() {
      // Yeni SW aktive olmak için beklemez
      return self.skipWaiting();
    })
  );
});

// ── Activate: eski önbellekleri temizle ──
self.addEventListener('activate', function(event) {
  console.log('[SW] Aktive ediliyor...');
  event.waitUntil(
    caches.keys().then(function(cacheNames) {
      return Promise.all(
        cacheNames
          .filter(function(name) { return name !== CACHE_NAME; })
          .map(function(name) {
            console.log('[SW] Eski önbellek siliniyor:', name);
            return caches.delete(name);
          })
      );
    }).then(function() {
      // Açık sekmeleri hemen kontrol al
      return self.clients.claim();
    })
  );
});

// ── Fetch: Önce cache, yoksa network ──
self.addEventListener('fetch', function(event) {
  // Sadece GET isteklerini yakala
  if (event.request.method !== 'GET') return;

  // Chrome extension ve cross-origin isteklerini atla
  if (!event.request.url.startsWith(self.location.origin)) return;

  event.respondWith(
    caches.match(event.request).then(function(cachedResponse) {
      if (cachedResponse) {
        // Önbellekte var → direkt dön (offline çalışır)
        return cachedResponse;
      }

      // Önbellekte yok → network'ten getir ve önbelleğe ekle
      return fetch(event.request).then(function(networkResponse) {
        // Geçersiz yanıtları önbelleğe alma
        if (!networkResponse || networkResponse.status !== 200 || networkResponse.type === 'opaque') {
          return networkResponse;
        }

        // Yanıtı klonla (stream sadece bir kez tüketilir)
        const responseToCache = networkResponse.clone();
        caches.open(CACHE_NAME).then(function(cache) {
          cache.put(event.request, responseToCache);
        });

        return networkResponse;
      }).catch(function() {
        // Network de çalışmıyor: index.html'i fallback olarak dön
        if (event.request.destination === 'document') {
          return caches.match('/index.html');
        }
      });
    })
  );
});
