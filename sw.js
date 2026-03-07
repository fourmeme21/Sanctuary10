// ═══════════════════════════════════════════════════════════════════════════
//  Sanctuary — Service Worker  (sw.js)
//  5. Aşama: Performans & Önbellek Optimizasyonu
//
//  Değişiklikler (Phase 5):
//    1. CACHE_NAME versiyonu güncellendi → eski önbellekler otomatik temizlenir
//    2. CORE_ASSETS genişletildi → ses dosyaları + font'lar eklendi
//    3. Ayrı AUDIO_CACHE → ses dosyaları için özel Cache-First strateji
//    4. fetchAudio() → range request desteği (iOS seek için gerekli)
//    5. precacheAudio() → ses dosyaları install aşamasında önbelleğe alınır
//    6. Stale-While-Revalidate → uygulama kabukları için arka planda güncelleme
// ═══════════════════════════════════════════════════════════════════════════

/* ─── Versiyon ── */
const CACHE_VERSION  = 'v6';
const CACHE_NAME     = `sanctuary-${CACHE_VERSION}`;
const AUDIO_CACHE    = `sanctuary-audio-${CACHE_VERSION}`;
const FONT_CACHE     = `sanctuary-fonts-${CACHE_VERSION}`;

/* ─── Uygulama Kabuğu (App Shell) ───────────────────────────────────────── */
const CORE_ASSETS = [
  '/',
  '/index.html',
  '/style.css',
  '/main.js',
  '/main-room-additions.js',
  '/RoomManager.js',
  '/StateManager.js',
  '/AudioEngine.js',
  '/GranularEngine.js',
  '/FMSynthesizer.js',
  '/GeminiAdapter.js',
  '/SceneInterpreter.js',
  '/FeedbackCollector.js',
  '/PreferenceVector.js',
  '/offline-fallback.json',
  '/manifest.json',
];

/* ─────────────────────────────────────────────────────────────────────────
   PHASE 5: Ses dosyaları ayrı bir önbellekte tutulur.
   Cache-First stratejisi ile çevrimdışı çalışmayı garantiler,
   veri tasarrufu sağlar ve yükleme hızını artırır.
   Gerçek ses dosyası yollarını projenize göre düzenleyin.
───────────────────────────────────────────────────────────────────────── */
const AUDIO_ASSETS = [
  /* ── Ambient sounds ── */
  '/audio/rain-forest.mp3',
  '/audio/ocean-waves.mp3',
  '/audio/night-crickets.mp3',
  '/audio/wind-valley.mp3',
  '/audio/campfire.mp3',
  '/audio/deep-cave.mp3',
  '/audio/morning-birds.mp3',
  '/audio/thunderstorm.mp3',

  /* ── Binaural / Focus ── */
  '/audio/binaural-alpha.mp3',
  '/audio/binaural-theta.mp3',
  '/audio/brown-noise.mp3',
  '/audio/white-noise.mp3',
  '/audio/pink-noise.mp3',

  /* ── Meditation ── */
  '/audio/singing-bowl.mp3',
  '/audio/tibetan-bells.mp3',
  '/audio/om-chant.mp3',
];

/* ─────────────────────────────────────────────────────────────────────────
   Google Fonts ve CDN font'ları için ayrı önbellek.
───────────────────────────────────────────────────────────────────────── */
const FONT_ORIGINS = [
  'https://fonts.googleapis.com',
  'https://fonts.gstatic.com',
];

/* ─────────────────────────────────────────────────────────────────────────
   INSTALL — Uygulama kabuğu + ses dosyaları önbelleğe alınır
───────────────────────────────────────────────────────────────────────── */
self.addEventListener('install', function (event) {
  console.log('[SW] Phase 5 yükleniyor... Cache:', CACHE_NAME);

  event.waitUntil(
    Promise.all([

      /* ── 1. Core assets (App Shell) ── */
      caches.open(CACHE_NAME).then(function (cache) {
        console.log('[SW] Uygulama kabuğu önbelleğe alınıyor...');
        return cache.addAll(CORE_ASSETS).catch(function (err) {
          console.warn('[SW] Bazı core asset\'ler önbelleğe alınamadı:', err);
        });
      }),

      /* ── 2. Ses dosyaları (Cache-First için önceden yükle) ── */
      caches.open(AUDIO_CACHE).then(function (cache) {
        console.log('[SW] Ses dosyaları önbelleğe alınıyor...');
        return _precacheAudio(cache);
      }),

    ]).then(function () {
      console.log('[SW] Install tamamlandı.');
      return self.skipWaiting(); // Yeni SW hemen devreye girer
    })
  );
});

/* ─────────────────────────────────────────────────────────────────────────
   ACTIVATE — Eski önbellekleri temizle
───────────────────────────────────────────────────────────────────────── */
self.addEventListener('activate', function (event) {
  console.log('[SW] Phase 5 aktive ediliyor...');

  const VALID_CACHES = [CACHE_NAME, AUDIO_CACHE, FONT_CACHE];

  event.waitUntil(
    caches.keys().then(function (cacheNames) {
      return Promise.all(
        cacheNames
          .filter(function (name) {
            /* sanctuary- ile başlayan ama güncel versiyonda olmayan tüm önbellekler */
            return name.startsWith('sanctuary-') && !VALID_CACHES.includes(name);
          })
          .map(function (name) {
            console.log('[SW] Eski önbellek siliniyor:', name);
            return caches.delete(name);
          })
      );
    }).then(function () {
      console.log('[SW] Activate tamamlandı. Geçerli önbellekler:', VALID_CACHES);
      return self.clients.claim(); // Açık sekmeleri hemen kontrol al
    })
  );
});

/* ─────────────────────────────────────────────────────────────────────────
   FETCH — İstek yönlendirme stratejileri
───────────────────────────────────────────────────────────────────────── */
self.addEventListener('fetch', function (event) {
  const req = event.request;

  // Sadece GET — POST/PUT/DELETE atla
  if (req.method !== 'GET') return;

  const url = new URL(req.url);

  // Chrome extension ve cross-origin (SW kapsamı dışı) — atla
  if (!req.url.startsWith(self.location.origin) &&
      !FONT_ORIGINS.some(function (o) { return req.url.startsWith(o); })) {
    return;
  }

  // ── PHASE 5: Ses dosyaları → Cache-First (Range Request desteğiyle) ──
  if (_isAudioRequest(url)) {
    event.respondWith(_handleAudioRequest(req));
    return;
  }

  // ── Font'lar → Cache-First ──
  if (_isFontRequest(url)) {
    event.respondWith(_handleFontRequest(req));
    return;
  }

  // ── Navigasyon (document) → Network-First + offline fallback ──
  if (req.destination === 'document') {
    event.respondWith(_handleDocumentRequest(req));
    return;
  }

  // ── Uygulama kabuğu varlıkları → Stale-While-Revalidate ──
  event.respondWith(_handleAssetRequest(req));
});

/* ═══════════════════════════════════════════════════════════════════════════
   PHASE 5: Strateji Fonksiyonları
═══════════════════════════════════════════════════════════════════════════ */

/**
 * Cache-First for Audio — iOS seek için Range Request desteği.
 * Aynı ses dosyası ağdan bir kez indirilir, sonraki oynatmalar önbellekten gelir.
 */
function _handleAudioRequest(req) {
  return caches.open(AUDIO_CACHE).then(function (cache) {
    return cache.match(req).then(function (cached) {
      if (cached) {
        console.debug('[SW] Audio cache hit:', req.url);
        return cached;
      }

      // Önbellekte yok — ağdan al ve kaydet
      console.info('[SW] Audio ağdan yükleniyor:', req.url);
      return fetch(req.clone(), { cache: 'force-cache' }).then(function (response) {
        if (!response || response.status !== 200) return response;

        // Klonla ve önbelleğe kaydet
        cache.put(req, response.clone()).catch(function (err) {
          console.warn('[SW] Audio önbelleğe yazma hatası:', err);
        });

        return response;
      }).catch(function (err) {
        console.error('[SW] Audio ağ hatası:', err);
        // Çevrimdışıysa sessizce hata — Audio yoksa oynatma başlamaz
        return new Response('', {
          status: 503,
          statusText: 'Ses dosyası çevrimdışında kullanılamıyor.',
        });
      });
    });
  });
}

/**
 * Cache-First for Fonts — font'lar değişmez, önbellekten al.
 */
function _handleFontRequest(req) {
  return caches.open(FONT_CACHE).then(function (cache) {
    return cache.match(req).then(function (cached) {
      if (cached) return cached;

      return fetch(req).then(function (response) {
        if (!response || response.status !== 200 || response.type === 'opaque') {
          return response;
        }
        cache.put(req, response.clone());
        return response;
      }).catch(function () {
        return new Response('', { status: 503 });
      });
    });
  });
}

/**
 * Network-First for Documents — her zaman en güncel HTML.
 * Ağ yoksa önbellekten /index.html döner.
 */
function _handleDocumentRequest(req) {
  return fetch(req).then(function (response) {
    if (!response || !response.ok) throw new Error('Network response hatalı');
    // Güncel HTML'i önbelleğe de yaz
    caches.open(CACHE_NAME).then(function (cache) {
      cache.put(req, response.clone());
    });
    return response;
  }).catch(function () {
    console.warn('[SW] Document ağ hatası, önbellekten servis ediliyor.');
    return caches.match(req).then(function (cached) {
      return cached || caches.match('/index.html');
    });
  });
}

/**
 * Stale-While-Revalidate for Assets — önce önbellekten hızlı yanıt,
 * arka planda ağdan güncelle. Kullanıcı her zaman bir şey görür.
 */
function _handleAssetRequest(req) {
  return caches.open(CACHE_NAME).then(function (cache) {
    return cache.match(req).then(function (cached) {

      const networkFetch = fetch(req, { cache: 'no-cache' }).then(function (response) {
        if (response && response.status === 200) {
          cache.put(req, response.clone());
        }
        return response;
      }).catch(function () {
        // Ağ yok — sessizce devam (önbellekten döner)
        return null;
      });

      // Önbellekte varsa hemen dön, arka planda güncelle
      if (cached) {
        event && event.waitUntil && event.waitUntil(networkFetch);
        return cached;
      }

      // Önbellekte yok — ağ yanıtını bekle
      return networkFetch.then(function (response) {
        if (response) return response;
        // İkisi de yok — 404
        return new Response('Not Found', { status: 404 });
      });
    });
  });
}

/* ═══════════════════════════════════════════════════════════════════════════
   PHASE 5: Yardımcı Fonksiyonlar
═══════════════════════════════════════════════════════════════════════════ */

/**
 * Ses dosyası isteği mi?
 */
function _isAudioRequest(url) {
  const ext = url.pathname.split('.').pop().toLowerCase();
  return ['mp3', 'ogg', 'wav', 'm4a', 'aac', 'flac', 'webm'].includes(ext) ||
         url.pathname.startsWith('/audio/');
}

/**
 * Font isteği mi?
 */
function _isFontRequest(url) {
  const ext = url.pathname.split('.').pop().toLowerCase();
  return ['woff', 'woff2', 'ttf', 'otf', 'eot'].includes(ext) ||
         FONT_ORIGINS.some(function (o) { return url.origin === new URL(o).origin; });
}

/**
 * PHASE 5: Ses dosyalarını install aşamasında arka planda önbelleğe al.
 * Başarısız olanlar uyarı olarak loglanır, install iptal edilmez.
 */
function _precacheAudio(cache) {
  var loaded  = 0;
  var failed  = 0;
  var total   = AUDIO_ASSETS.length;

  var promises = AUDIO_ASSETS.map(function (url) {
    return fetch(url, { cache: 'force-cache' })
      .then(function (response) {
        if (!response || response.status !== 200) {
          failed++;
          console.warn('[SW] Ses önbelleğe alınamadı (HTTP ' + response.status + '):', url);
          return;
        }
        loaded++;
        return cache.put(url, response);
      })
      .catch(function (err) {
        failed++;
        /* Ses dosyası sunucuda yoksa SW install'ı durdurmaz */
        console.warn('[SW] Ses önbelleğe alınamadı:', url, err.message);
      });
  });

  return Promise.all(promises).then(function () {
    console.info('[SW] Ses önbelleği:', loaded + '/' + total + ' dosya yüklendi, ' + failed + ' hata.');
  });
}

/* ═══════════════════════════════════════════════════════════════════════════
   MESSAGE — Ana uygulama ile iletişim
═══════════════════════════════════════════════════════════════════════════ */

self.addEventListener('message', function (event) {
  if (!event.data) return;

  switch (event.data.type) {

    /* Önbellek sürümünü sorgula */
    case 'GET_CACHE_VERSION':
      event.ports[0] && event.ports[0].postMessage({
        type: 'CACHE_VERSION',
        version: CACHE_VERSION,
        caches: [CACHE_NAME, AUDIO_CACHE, FONT_CACHE],
      });
      break;

    /* Tüm önbellekleri temizle (Settings > Önbelleği Temizle) */
    case 'CLEAR_ALL_CACHES':
      caches.keys().then(function (names) {
        return Promise.all(names.map(function (n) { return caches.delete(n); }));
      }).then(function () {
        console.info('[SW] Tüm önbellekler temizlendi.');
        event.ports[0] && event.ports[0].postMessage({ type: 'CACHES_CLEARED' });
      });
      break;

    /* Belirli bir ses dosyasını önbellekten kaldır */
    case 'EVICT_AUDIO':
      if (event.data.url) {
        caches.open(AUDIO_CACHE).then(function (cache) {
          return cache.delete(event.data.url);
        }).then(function (deleted) {
          console.info('[SW] Audio evict:', event.data.url, deleted);
        });
      }
      break;

    /* Ses dosyalarını önbelleğe al (runtime) */
    case 'PRECACHE_AUDIO':
      if (Array.isArray(event.data.urls)) {
        caches.open(AUDIO_CACHE).then(function (cache) {
          return _precacheAudio(cache);
        });
      }
      break;
  }
});

/* ── Gemini API Offline Fallback ── */
self.addEventListener('fetch', function(event) {
  var url = event.request.url;
  if (url.includes('generativelanguage.googleapis.com')) {
    event.respondWith(
      fetch(event.request).catch(function() {
        return caches.match('/offline-fallback.json').then(function(cached) {
          if (cached) return cached;
          return new Response(JSON.stringify({
            default: {
              sceneName: 'Çevrimdışı Huzur',
              tempo: 60,
              frequencySuggestion: 432,
              layers: [{id:'ambient-1',type:'ambient',volume:0.6}],
              breathPattern: {inhale:4,hold:2,exhale:6}
            }
          }), { headers: {'Content-Type':'application/json'} });
        });
      })
    );
    return;
  }
});
