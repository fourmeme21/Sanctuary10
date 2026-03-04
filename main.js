/**
 * main.js — Sanctuary 4. Aşama (Hata Yönetimi & UX)
 * ─────────────────────────────────────────────────────────────────────────────
 * Değişiklikler:
 *   1. Toast Sistemi      — Merkezi, cam efektli, 4 tipli bildirim (success/error/warning/info)
 *   2. Hata Yönetimi      — Tüm catch blokları dolduruldu, kullanıcıya bildiriliyor
 *   3. Offline/Online     — İnternet kesilince panel gösterilir, bağlantı gelince flash
 *   4. Loading Spinners   — Play butonu, oda listesi ve AI Oracle için spinner
 *   5. Fetch Timeout      — 10 saniyelik timeout, zaman aşımı bildirimi
 * ─────────────────────────────────────────────────────────────────────────────
 */

'use strict';

/* ══════════════════════════════════════════════════════════════════
   BÖLÜM 1 — MERKEZI TOAST BİLDİRİM SİSTEMİ
   Cam efektli, 4 tip: success | error | warning | info
   Otomatik kapanır, progress bar gösterir, kapatılabilir.
══════════════════════════════════════════════════════════════════ */

var ToastManager = (function () {
  var container = null;
  var queue = [];
  var MAX_VISIBLE = 3;
  var visible = 0;

  var ICONS = {
    success : '✦',
    error   : '✕',
    warning : '⚠',
    info    : '◈'
  };

  var TITLES = {
    success : 'Başarılı',
    error   : 'Hata',
    warning : 'Uyarı',
    info    : 'Bilgi'
  };

  var DURATIONS = {
    success : 3500,
    error   : 5000,
    warning : 4500,
    info    : 3500
  };

  function getContainer() {
    if (container) return container;
    container = document.getElementById('toast-container');
    if (!container) {
      container = document.createElement('div');
      container.id = 'toast-container';
      document.body.appendChild(container);
    }
    return container;
  }

  function createToast(message, type, title, duration) {
    type     = type     || 'info';
    title    = title    || TITLES[type]  || 'Bilgi';
    duration = duration || DURATIONS[type] || 3500;

    var el = document.createElement('div');
    el.className = 'toast toast-' + type;
    el.setAttribute('role', 'alert');
    el.setAttribute('aria-live', 'polite');

    el.innerHTML = [
      '<span class="toast-icon">' + (ICONS[type] || '◈') + '</span>',
      '<div class="toast-body">',
      '  <div class="toast-title">' + _escapeHtml(title) + '</div>',
      '  <div class="toast-msg">'   + _escapeHtml(message) + '</div>',
      '</div>',
      '<button class="toast-close" aria-label="Kapat">×</button>',
      '<div class="toast-progress" style="animation-duration:' + duration + 'ms"></div>',
    ].join('');

    return { el: el, duration: duration };
  }

  function show(message, type, title, duration) {
    var toast = createToast(message, type, title, duration);
    var el    = toast.el;
    var ms    = toast.duration;

    var c = getContainer();
    c.appendChild(el);
    visible++;

    // Slide-up tetikle
    requestAnimationFrame(function () {
      requestAnimationFrame(function () {
        el.classList.add('toast-show');
      });
    });

    // Kapatma butonu
    var closeBtn = el.querySelector('.toast-close');
    if (closeBtn) {
      closeBtn.addEventListener('click', function () { dismiss(el); });
    }

    // Otomatik kapat
    var timer = setTimeout(function () { dismiss(el); }, ms);

    // Hover'da duraklat
    el.addEventListener('mouseenter', function () { clearTimeout(timer); });
    el.addEventListener('mouseleave', function () {
      timer = setTimeout(function () { dismiss(el); }, 1500);
    });

    // Fazla toast varsa en eskiyi kapat
    if (visible > MAX_VISIBLE) {
      var oldest = c.querySelector('.toast');
      if (oldest && oldest !== el) dismiss(oldest);
    }

    return el;
  }

  function dismiss(el) {
    if (!el || el._dismissing) return;
    el._dismissing = true;
    el.classList.remove('toast-show');
    el.classList.add('toast-hide');
    visible = Math.max(0, visible - 1);
    setTimeout(function () {
      if (el.parentNode) el.parentNode.removeChild(el);
    }, 380);
  }

  function _escapeHtml(str) {
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  return {
    show    : show,
    success : function (msg, title, dur) { return show(msg, 'success', title, dur); },
    error   : function (msg, title, dur) { return show(msg, 'error',   title, dur); },
    warning : function (msg, title, dur) { return show(msg, 'warning', title, dur); },
    info    : function (msg, title, dur) { return show(msg, 'info',    title, dur); },
    dismiss : dismiss
  };
})();

/* Geriye dönük uyumluluk — eski showToast() çağrıları çalışmaya devam eder */
function showToast(message, type, title) {
  type = type || 'info';
  console.info('[Toast]', type.toUpperCase() + ':', message);
  return ToastManager.show(message, type, title);
}

/* ══════════════════════════════════════════════════════════════════
   BÖLÜM 2 — ONLINE / OFFLINE PANEL
   İnternet kesilince kırmızı banner, gelince yeşil flash gösterilir.
══════════════════════════════════════════════════════════════════ */

var NetworkMonitor = (function () {
  var offlinePanel = null;
  var onlineFlash  = null;
  var _isOnline    = navigator.onLine;

  function getOfflinePanel() {
    if (offlinePanel) return offlinePanel;
    offlinePanel = document.getElementById('offline-panel');
    if (!offlinePanel) {
      offlinePanel = document.createElement('div');
      offlinePanel.id = 'offline-panel';
      offlinePanel.innerHTML = [
        '<span class="offline-dot"></span>',
        '<div class="offline-text">',
        '  <span class="offline-title">İnternet Bağlantısı Kesildi</span>',
        '  <span class="offline-sub">Bağlantı yeniden kurulduğunda devam edecek…</span>',
        '</div>',
        '<span class="offline-icon">📡</span>',
      ].join('');
      document.body.insertBefore(offlinePanel, document.body.firstChild);
    }
    return offlinePanel;
  }

  function getOnlineFlash() {
    if (onlineFlash) return onlineFlash;
    onlineFlash = document.getElementById('online-flash');
    if (!onlineFlash) {
      onlineFlash = document.createElement('div');
      onlineFlash.id = 'online-flash';
      onlineFlash.innerHTML = '<span style="font-size:14px">✦</span> <span class="online-flash-text">Bağlantı Yeniden Sağlandı</span>';
      onlineFlash.setAttribute('aria-live', 'polite');
      document.body.insertBefore(onlineFlash, document.body.firstChild);
    }
    return onlineFlash;
  }

  function handleOffline() {
    _isOnline = false;
    console.warn('[NetworkMonitor] Çevrimdışı.');
    var panel = getOfflinePanel();
    panel.classList.add('show');
  }

  function handleOnline() {
    _isOnline = true;
    console.info('[NetworkMonitor] Çevrimiçi.');

    // Offline paneli kapat
    var panel = getOfflinePanel();
    panel.classList.remove('show');

    // Online flash göster
    var flash = getOnlineFlash();
    flash.classList.add('show');
    setTimeout(function () { flash.classList.remove('show'); }, 2800);

    ToastManager.success('İnternet bağlantısı yeniden sağlandı.', 'Bağlandı');
  }

  function init() {
    window.addEventListener('online',  handleOnline);
    window.addEventListener('offline', handleOffline);

    // Sayfa açılırken zaten çevrimdışıysa hemen göster
    if (!navigator.onLine) {
      handleOffline();
    }
  }

  return {
    init     : init,
    isOnline : function () { return _isOnline; }
  };
})();

/* ══════════════════════════════════════════════════════════════════
   BÖLÜM 3 — FETCH WRAPPER (10 saniyelik timeout)
   fetchWithTimeout() — standart fetch yerine her yerde bu kullanılır.
══════════════════════════════════════════════════════════════════ */

function fetchWithTimeout(url, options, timeoutMs) {
  timeoutMs = timeoutMs || 10000;
  options   = options   || {};

  var controller = new AbortController();
  options.signal = controller.signal;

  var timeoutId = setTimeout(function () {
    controller.abort();
    console.error('[fetchWithTimeout] İstek zaman aşımına uğradı:', url);
  }, timeoutMs);

  return fetch(url, options)
    .then(function (response) {
      clearTimeout(timeoutId);
      if (!response.ok) {
        throw new Error('HTTP ' + response.status + ': ' + response.statusText);
      }
      return response;
    })
    .catch(function (err) {
      clearTimeout(timeoutId);
      if (err.name === 'AbortError') {
        console.error('[fetchWithTimeout] Timeout:', url);
        ToastManager.error(
          'Sunucudan yanıt alınamadı. Lütfen tekrar deneyin.',
          'İşlem Zaman Aşımına Uğradı',
          6000
        );
        throw new Error('TIMEOUT: ' + url);
      }
      if (!navigator.onLine) {
        ToastManager.error('İnternet bağlantısı yok. Lütfen bağlantınızı kontrol edin.', 'Bağlantı Hatası');
      } else {
        ToastManager.error('Bağlantı hatası: ' + err.message, 'Ağ Hatası');
      }
      throw err;
    });
}

/* ══════════════════════════════════════════════════════════════════
   BÖLÜM 4 — LOADING SPINNER YARDIMCILARI
   Buton, konteyner veya play butonu için spinner ekler/kaldırır.
══════════════════════════════════════════════════════════════════ */

var LoadingManager = (function () {

  /**
   * Butona spinner ekler, disabled yapar.
   * @returns {function} restore — orijinal metni geri getirir
   */
  function setButtonLoading(btn, loadingText) {
    if (!btn) return function () {};
    var originalHTML = btn.innerHTML;
    var originalDisabled = btn.disabled;
    loadingText = loadingText || '';

    btn.disabled = true;
    btn.innerHTML = '<span class="spinner spinner-sm"></span>'
      + (loadingText ? '<span style="margin-left:8px">' + loadingText + '</span>' : '');

    return function restore() {
      btn.disabled  = originalDisabled;
      btn.innerHTML = originalHTML;
    };
  }

  /**
   * Play butonuna özel spinner (altın rengi, büyük)
   */
  function setPlayLoading(playBtn, on) {
    if (!playBtn) return;
    var iconEl = playBtn.querySelector('.play-icon');
    if (!iconEl) return;

    if (on) {
      // Spinner olarak değiştir
      iconEl.dataset.originalText = iconEl.textContent;
      iconEl.style.display = 'none';

      var spinner = playBtn.querySelector('.play-spinner');
      if (!spinner) {
        spinner = document.createElement('span');
        spinner.className = 'spinner spinner-gold play-spinner';
        playBtn.appendChild(spinner);
      }
      spinner.style.display = 'inline-block';
    } else {
      // Orijinal ikona geri dön
      if (iconEl) iconEl.style.display = '';
      var sp = playBtn.querySelector('.play-spinner');
      if (sp) sp.style.display = 'none';
    }
  }

  /**
   * Oda listesi için skeleton loader
   */
  function showRoomsSkeleton(container, count) {
    if (!container) return;
    count = count || 4;
    var html = '';
    for (var i = 0; i < count; i++) {
      html += [
        '<div class="skeleton-card">',
        '  <div class="sk-line short skeleton"></div>',
        '  <div class="sk-line mid skeleton"   style="margin-top:10px"></div>',
        '  <div class="sk-line long skeleton"  style="margin-top:8px"></div>',
        '  <div style="display:flex;align-items:center;gap:8px;margin-top:14px">',
        '    <div class="sk-circle skeleton"></div>',
        '    <div class="sk-line short skeleton" style="margin:0"></div>',
        '  </div>',
        '</div>',
      ].join('');
    }
    container.innerHTML = html;
  }

  /**
   * Genel overlay loader (tam ekran değil, element üzerinde)
   */
  function showOverlay(parentEl, message) {
    if (!parentEl) return function () {};
    var overlay = document.createElement('div');
    overlay.className = 'loading-overlay';
    overlay.innerHTML = [
      '<div class="loading-overlay-inner">',
      '  <span class="spinner spinner-lg spinner-violet"></span>',
      message ? '<span class="loading-overlay-text">' + message + '</span>' : '',
      '</div>',
    ].join('');

    var pos = window.getComputedStyle(parentEl).position;
    if (pos === 'static') parentEl.style.position = 'relative';
    parentEl.appendChild(overlay);

    return function hideOverlay() {
      if (overlay.parentNode) overlay.parentNode.removeChild(overlay);
      if (pos === 'static') parentEl.style.position = '';
    };
  }

  return {
    setButtonLoading  : setButtonLoading,
    setPlayLoading    : setPlayLoading,
    showRoomsSkeleton : showRoomsSkeleton,
    showOverlay       : showOverlay
  };
})();

/* ══════════════════════════════════════════════════════════════════
   BÖLÜM 5 — RİPPLE EFEKTİ (Çok Halkalı Su Dalgası)
   mousedown + touchstart desteği
   Her tıklamada 3 halka oluşur, CSS animasyonu ile kaybolur.
══════════════════════════════════════════════════════════════════ */

function initRippleEffect() {
  var RING_COUNT  = 3;
  var RING_DELAYS = [0, 120, 260];

  function spawnRippleAt(x, y) {
    var size = Math.max(window.innerWidth, window.innerHeight) * 0.72;

    for (var i = 0; i < RING_COUNT; i++) {
      ;(function (delay, idx) {
        setTimeout(function () {
          var ring = document.createElement('div');
          ring.className    = 'ripple-circle';
          ring.dataset.ring = idx + 1;

          ring.style.cssText = [
            'position:fixed',
            'width:'  + size + 'px',
            'height:' + size + 'px',
            'left:'   + x   + 'px',
            'top:'    + y   + 'px',
            'border-radius:50%',
            'pointer-events:none',
            'transform:translate(-50%,-50%) scale(0)',
            'z-index:9999',
          ].join(';');

          var styles = [
            { border: '1px solid rgba(201,169,110,0.32)', animDuration: '1.8s' },
            { border: '1px solid rgba(201,169,110,0.17)', animDuration: '2.15s' },
            { border: '1px solid rgba(170,130,220,0.11)', animDuration: '2.55s' },
          ];
          var s = styles[idx] || styles[0];
          ring.style.border     = s.border;
          ring.style.animation  = 'rippleExpand ' + s.animDuration + ' cubic-bezier(0.2,0,0.4,1) forwards';
          ring.style.willChange = 'transform, opacity';

          document.body.appendChild(ring);
          ring.addEventListener('animationend', function () { ring.remove(); }, { once: true });
        }, delay);
      })(RING_DELAYS[i], i);
    }
  }

  document.addEventListener('mousedown', function (e) {
    if (e.target.closest('button, .cta-btn, .play-btn, .back-btn, input, textarea, select')) return;
    spawnRippleAt(e.clientX, e.clientY);
  });

  document.addEventListener('touchstart', function (e) {
    if (e.target.closest('button, .cta-btn, .play-btn, .back-btn, input, textarea, select')) return;
    var t = e.touches[0];
    spawnRippleAt(t.clientX, t.clientY);
  }, { passive: true });
}

/* ══════════════════════════════════════════════════════════════════
   BÖLÜM 6 — SEKME GEÇİŞ ANİMASYONLARI
   switchTab() global fonksiyonunu override eder.
   İçerik blur+fade-in (0.3s) ile gelir.
══════════════════════════════════════════════════════════════════ */

function initTabAnimations() {
  window.switchTab = function (tabId) {
    var panels  = document.querySelectorAll('.tab-panel');
    var buttons = document.querySelectorAll('.tab-item');

    panels.forEach(function (el) { el.classList.remove('active'); });
    buttons.forEach(function (el) {
      el.classList.remove('active');
      el.setAttribute('aria-selected', 'false');
    });

    var target = document.getElementById(tabId);
    if (target) {
      target.classList.remove('active');
      requestAnimationFrame(function () {
        requestAnimationFrame(function () {
          target.classList.add('active');
        });
      });
    }

    var btnId     = 'tab-btn-' + tabId.replace('tab-', '');
    var activeBtn = document.getElementById(btnId);
    if (activeBtn) {
      activeBtn.classList.add('active');
      activeBtn.setAttribute('aria-selected', 'true');
    }

    if (tabId === 'tab-journal') {
      var d = document.getElementById('journal-date');
      if (d) d.textContent = new Date().toLocaleDateString('tr-TR', {
        weekday: 'long', day: 'numeric', month: 'long'
      });
    }
  };
}

/* ══════════════════════════════════════════════════════════════════
   BÖLÜM 7 — NEFES DÖNGÜSÜ (Ses Senkronlu)
   engine.fadeTo() ile nefes hızına ses seviyesi uyarlanır.
══════════════════════════════════════════════════════════════════ */

function startBreathCycle(engine, breathWrap, guideEl, options) {
  options = options || {};

  var inhale    = options.inhale    || 4;
  var hold      = options.hold      || 2;
  var exhale    = options.exhale    || 6;
  var volInhale = options.volInhale || 0.85;
  var volExhale = options.volExhale || 0.55;

  var stopped = false;
  var timers  = [];

  function clearTimers() {
    timers.forEach(clearTimeout);
    timers = [];
  }

  function setGuide(text, active) {
    if (!guideEl) return;
    guideEl.textContent = text;
    guideEl.classList.toggle('on', active === undefined ? true : active);
  }

  function setBreathClass(cls) {
    if (!breathWrap) return;
    breathWrap.classList.remove('breath-inhale', 'breath-hold', 'breath-exhale', 'breath-idle');
    if (cls) breathWrap.classList.add(cls);
    if (cls === 'breath-inhale') breathWrap.style.setProperty('--inhale-dur', inhale + 's');
    if (cls === 'breath-exhale') breathWrap.style.setProperty('--exhale-dur', exhale + 's');
  }

  function syncVolume(targetVol, durationSec) {
    if (!engine) return;
    try {
      if (typeof engine.fadeTo === 'function') {
        engine.fadeTo(targetVol, durationSec * 0.88);
      } else if (engine._layers && Array.isArray(engine._layers)) {
        engine._layers.forEach(function (layer) {
          if (typeof layer.fadeTo === 'function') {
            layer.fadeTo(targetVol, durationSec * 0.88);
          }
        });
      } else if (typeof engine.setMasterVolume === 'function') {
        engine.setMasterVolume(targetVol);
      }
    } catch (err) {
      console.warn('[BreathCycle] Volume sync hatası:', err);
      /* Ses senkronu kritik değil — sessizce devam et */
    }
  }

  function runCycle() {
    if (stopped) return;

    setBreathClass('breath-inhale');
    setGuide('Nefes al…');
    syncVolume(volInhale, inhale);

    timers.push(setTimeout(function () {
      if (stopped) return;
      setBreathClass('breath-hold');
      setGuide('Tut…');

      timers.push(setTimeout(function () {
        if (stopped) return;
        setBreathClass('breath-exhale');
        setGuide('Nefes ver…');
        syncVolume(volExhale, exhale);

        timers.push(setTimeout(function () {
          if (stopped) return;
          runCycle();
        }, exhale * 1000));
      }, hold * 1000));
    }, inhale * 1000));
  }

  runCycle();

  return function stopBreathCycle() {
    stopped = true;
    clearTimers();
    setBreathClass('breath-idle');
    setGuide('', false);
    if (engine) syncVolume(0.70, 1.5);
  };
}

/* ══════════════════════════════════════════════════════════════════
   BÖLÜM 8 — API KEY GÜVENLİ YÜKLEME
══════════════════════════════════════════════════════════════════ */

function initApiKey(key) {
  if (!key || typeof key !== 'string') return;
  try {
    var state = (typeof getStateManager === 'function') ? getStateManager() : null;
    if (state && typeof state.setApiKey === 'function') {
      state.setApiKey(key.trim());
      console.info('[main] API key runtime belleğe yüklendi.');
      ToastManager.success('API anahtarı başarıyla yüklendi.', 'Hazır');
    }
  } catch (e) {
    console.error('[main] StateManager bulunamadı:', e);
    ToastManager.error('API anahtarı yüklenemedi: ' + e.message, 'API Hatası');
  }
}

function clearApiKey() {
  try {
    var state = (typeof getStateManager === 'function') ? getStateManager() : null;
    if (state && typeof state.clearApiKey === 'function') state.clearApiKey();
  } catch (e) {
    console.warn('[main] clearApiKey hatası:', e);
  }
}

/* ══════════════════════════════════════════════════════════════════
   BÖLÜM 9 — SES DOSYASI YÜKLEME (Hata Yönetimli)
   Ses yüklenirken play butonunda spinner gösterilir.
══════════════════════════════════════════════════════════════════ */

function loadAudioWithFeedback(audioEl, src, playBtn) {
  if (!audioEl) return;

  // Play butonunda loading göster
  if (playBtn) LoadingManager.setPlayLoading(playBtn, true);

  audioEl.src = src;
  audioEl.load();

  audioEl.addEventListener('canplaythrough', function onReady() {
    audioEl.removeEventListener('canplaythrough', onReady);
    if (playBtn) LoadingManager.setPlayLoading(playBtn, false);
    console.info('[Audio] Hazır:', src);
  }, { once: true });

  audioEl.addEventListener('error', function onErr(e) {
    audioEl.removeEventListener('error', onErr);
    if (playBtn) LoadingManager.setPlayLoading(playBtn, false);

    var code = audioEl.error ? audioEl.error.code : '?';
    console.error('[Audio] Ses dosyası yüklenemedi. Kod:', code, 'Src:', src);
    ToastManager.error(
      'Ses dosyası yüklenemedi. Lütfen tekrar deneyin.',
      'Ses Hatası',
      5000
    );
  }, { once: true });
}

/* ══════════════════════════════════════════════════════════════════
   BÖLÜM 10 — ODA UI YÖNETİMİ
══════════════════════════════════════════════════════════════════ */

function renderRoomList(container, category) {
  if (!container) return;

  // Skeleton loader göster
  LoadingManager.showRoomsSkeleton(container, 4);

  // Kısa gecikme ile asenkron yükleme simüle et (gerçek projede fetch kullan)
  setTimeout(function () {
    try {
      if (typeof RoomManager === 'undefined') {
        container.innerHTML = _demoRoomsHTML();
        _bindRoomCards(container);
        return;
      }

      var rooms = RoomManager.getPublicRooms(category || null);

      if (!rooms || rooms.length === 0) {
        container.innerHTML = [
          '<div class="empty-state">',
          '  <div class="empty-icon">🌿</div>',
          '  <p class="empty-title">Henüz aktif oda yok</p>',
          '  <p class="empty-sub">İlk odayı sen kur ve herkesi davet et.</p>',
          '  <button class="btn-start-first" id="btn-first-room">Oda Kur</button>',
          '</div>',
        ].join('');
        var firstBtn = document.getElementById('btn-first-room');
        if (firstBtn) firstBtn.addEventListener('click', function () { handleCreateRoom(); });
        return;
      }

      container.innerHTML = rooms.map(function (room) {
        var card    = RoomManager.buildRoomCard(room);
        var fillPct = Math.round(card.capacityFill * 100);
        return _buildCardHTML(card, fillPct);
      }).join('');

      _bindRoomCards(container);
    } catch (err) {
      console.error('[renderRoomList] Oda listesi yüklenemedi:', err);
      ToastManager.error('Oda listesi yüklenemedi. Sayfayı yenileyin.', 'Yükleme Hatası');
      container.innerHTML = '<div class="empty-state"><div class="empty-icon">⚠️</div><p class="empty-title">Yükleme başarısız</p></div>';
    }
  }, 400);
}

function _demoRoomsHTML() {
  var demos = [
    { id: 'd1', name: 'Gece Odak',        category: 'Odak',      current: 3, capacity: 8,  isPrivate: false, hostId: 'A' },
    { id: 'd2', name: 'Derin Uyku',        category: 'Uyku',      current: 5, capacity: 10, isPrivate: false, hostId: 'B' },
    { id: 'd3', name: 'Şifa Meditasyonu', category: 'Meditasyon', current: 2, capacity: 5,  isPrivate: true,  hostId: 'C' },
    { id: 'd4', name: 'Sabah Enerjisi',   category: 'Doğa',       current: 7, capacity: 12, isPrivate: false, hostId: 'D' },
  ];
  return demos.map(function (card) {
    var fillPct = Math.round((card.current / card.capacity) * 100);
    return _buildCardHTML(card, fillPct);
  }).join('');
}

function _buildCardHTML(card, fillPct) {
  return [
    '<div class="room-card" data-room-id="' + card.id + '">',
    '  <div class="card-top">',
    '    <span class="badge-live"><span class="dot"></span> CANLI</span>',
    card.isPrivate
      ? '    <span class="badge-private"><svg viewBox="0 0 12 12" fill="currentColor"><path d="M6 1a2.5 2.5 0 0 0-2.5 2.5V5H3v5h6V5h-.5V3.5A2.5 2.5 0 0 0 6 1zm1.5 4h-3V3.5a1.5 1.5 0 0 1 3 0V5z"/></svg>Özel</span>'
      : '',
    '  </div>',
    '  <p class="room-name">'     + card.name     + '</p>',
    '  <p class="room-category">' + card.category + '</p>',
    '  <div class="card-footer">',
    '    <div class="host-info">',
    '      <div class="host-avatar">' + ((card.hostId || 'H')[0].toUpperCase()) + '</div>',
    '      <span class="host-name">Host</span>',
    '    </div>',
    '    <div class="capacity-bar-wrap">',
    '      <p class="capacity-text">' + card.current + '/' + card.capacity + '</p>',
    '      <div class="capacity-bar"><div class="capacity-fill" style="width:' + fillPct + '%"></div></div>',
    '    </div>',
    '  </div>',
    '</div>',
  ].join('');
}

function _bindRoomCards(container) {
  container.querySelectorAll('.room-card').forEach(function (card) {
    card.addEventListener('click', function () {
      var roomId = card.dataset.roomId;
      if (roomId) handleJoinRoom(roomId);
    });
  });
}

/* ══════════════════════════════════════════════════════════════════
   BÖLÜM 11 — ODA HANDLER'LARI (Hata Yönetimli)
══════════════════════════════════════════════════════════════════ */

function handleCreateRoom(formData) {
  formData = formData || {};

  if (typeof RoomManager === 'undefined') {
    console.error('[handleCreateRoom] RoomManager yüklenmedi.');
    ToastManager.error('Oda sistemi şu an kullanılamıyor. Lütfen sayfayı yenileyin.', 'Sistem Hatası');
    return null;
  }

  try {
    var result = RoomManager.createRoom(formData);
    if (!result.success) {
      if (result.error && result.error.includes('Premium')) {
        document.dispatchEvent(new CustomEvent('sanctuary:showPaywall', { detail: { reason: result.error } }));
      } else {
        console.error('[handleCreateRoom] Hata:', result.error);
        ToastManager.error(result.error || 'Oda oluşturulamadı.', 'Oda Hatası');
      }
      return null;
    }
    ToastManager.success('"' + (result.room && result.room.name) + '" odası oluşturuldu!', 'Oda Kuruldu');
    var grid = document.querySelector('.rooms-grid');
    if (grid) renderRoomList(grid);
    return result.room;
  } catch (err) {
    console.error('[handleCreateRoom] Beklenmedik hata:', err);
    ToastManager.error('Beklenmedik bir hata oluştu. Lütfen tekrar deneyin.', 'Hata');
    return null;
  }
}

function handleJoinRoom(roomId, password) {
  if (typeof RoomManager === 'undefined') {
    console.error('[handleJoinRoom] RoomManager yüklenmedi.');
    ToastManager.error('Oda sistemi şu an kullanılamıyor.', 'Sistem Hatası');
    return;
  }

  try {
    password = password || null;
    var room   = RoomManager.getRoomById(roomId);
    if (!room) {
      console.error('[handleJoinRoom] Oda bulunamadı:', roomId);
      ToastManager.error('Bu oda artık mevcut değil.', 'Oda Bulunamadı');
      return;
    }

    var result = RoomManager.joinRoom(roomId, password);
    if (!result.success) {
      if (result.error && result.error.includes('Premium')) {
        document.dispatchEvent(new CustomEvent('sanctuary:showPaywall', { detail: { reason: result.error } }));
      } else {
        console.error('[handleJoinRoom] Katılım hatası:', result.error);
        ToastManager.error(result.error || 'Odaya katılınamadı.', 'Katılım Hatası');
      }
      return;
    }
    ToastManager.success('"' + room.name + '" odasına katıldınız.', 'Katıldınız');
  } catch (err) {
    console.error('[handleJoinRoom] Beklenmedik hata:', err);
    ToastManager.error('Odaya katılırken bir hata oluştu.', 'Hata');
  }
}

function handleDeleteRoom(roomId) {
  if (typeof RoomManager === 'undefined') return;
  try {
    var result = RoomManager.deleteRoom(roomId);
    if (!result.success) {
      console.error('[handleDeleteRoom] Silme hatası:', result.error);
      ToastManager.error(result.error || 'Oda silinemedi.', 'Silme Hatası');
      return;
    }
    ToastManager.success('Oda başarıyla silindi.', 'Silindi');
    var grid = document.querySelector('.rooms-grid');
    if (grid) renderRoomList(grid);
  } catch (err) {
    console.error('[handleDeleteRoom] Beklenmedik hata:', err);
    ToastManager.error('Oda silinirken bir hata oluştu.', 'Hata');
  }
}

function handleLeaveRoom(roomId) {
  if (typeof RoomManager === 'undefined') return;
  try {
    var result = RoomManager.leaveRoom(roomId);
    if (!result.success) {
      console.error('[handleLeaveRoom] Ayrılma hatası:', result.error);
      ToastManager.error(result.error || 'Odadan ayrılınamadı.', 'Ayrılma Hatası');
      return;
    }
    var msg = result.deleted  ? 'Odadan ayrıldınız. Oda boşaldığı için kapatıldı.'
            : result.newHost  ? 'Odadan ayrıldınız. Oda sahipliği devredildi.'
            :                   'Odadan ayrıldınız.';
    ToastManager.info(msg, 'Ayrıldınız');
    var grid = document.querySelector('.rooms-grid');
    if (grid) renderRoomList(grid);
  } catch (err) {
    console.error('[handleLeaveRoom] Beklenmedik hata:', err);
    ToastManager.error('Odadan ayrılırken bir hata oluştu.', 'Hata');
  }
}

/* ══════════════════════════════════════════════════════════════════
   BÖLÜM 12 — AI ORACLE OVERLAY KONTROLÜ
   Mevcut overlay'in düzgün çalıştığını garanti eder.
══════════════════════════════════════════════════════════════════ */

var AiOracleUI = (function () {
  function showProcessing() {
    var el = document.getElementById('ai-processing');
    if (!el) return;
    el.style.display = 'flex';
    requestAnimationFrame(function () {
      el.classList.add('show');
    });
  }

  function hideProcessing() {
    var el = document.getElementById('ai-processing');
    if (!el) return;
    el.classList.remove('show');
    setTimeout(function () {
      el.style.display = 'none';
    }, 350);
  }

  /**
   * AI Oracle çağrısı — timeout + hata yönetimi ile
   */
  function generateFrequency(prompt, apiCallFn, onSuccess) {
    if (!prompt || !prompt.trim()) {
      ToastManager.warning('Lütfen bir ruh halinizi veya niyetinizi yazın.', 'Boş İstek');
      return;
    }

    showProcessing();

    // 10 saniyelik timeout
    var timeoutId = setTimeout(function () {
      hideProcessing();
      console.error('[AiOracle] İstek zaman aşımına uğradı.');
      ToastManager.error('AI Oracle yanıt vermedi. Lütfen tekrar deneyin.', 'Zaman Aşımı', 6000);
    }, 10000);

    Promise.resolve()
      .then(function () {
        return apiCallFn(prompt);
      })
      .then(function (result) {
        clearTimeout(timeoutId);
        hideProcessing();
        if (typeof onSuccess === 'function') onSuccess(result);
        ToastManager.success('Frekans başarıyla oluşturuldu.', 'Oracle');
      })
      .catch(function (err) {
        clearTimeout(timeoutId);
        hideProcessing();
        console.error('[AiOracle] Frekans üretim hatası:', err);

        if (err && err.message && err.message.includes('TIMEOUT')) return; // zaten bildirildi

        if (!navigator.onLine) {
          ToastManager.error('İnternet bağlantısı yok. AI Oracle çevrimdışı çalışamaz.', 'Bağlantı Hatası');
        } else if (err && err.message && err.message.includes('401')) {
          ToastManager.error('API anahtarı geçersiz veya süresi dolmuş.', 'Yetki Hatası', 6000);
        } else if (err && err.message && err.message.includes('429')) {
          ToastManager.warning('Çok fazla istek gönderildi. Lütfen biraz bekleyin.', 'İstek Limiti');
        } else {
          ToastManager.error('AI Oracle bir hatayla karşılaştı. Lütfen tekrar deneyin.', 'Oracle Hatası');
        }
      });
  }

  return {
    showProcessing   : showProcessing,
    hideProcessing   : hideProcessing,
    generateFrequency: generateFrequency
  };
})();

/* ══════════════════════════════════════════════════════════════════
   BÖLÜM 13 — BAŞLATMA
══════════════════════════════════════════════════════════════════ */

document.addEventListener('DOMContentLoaded', function () {

  /* 0. Ağ izleme — en önce başlat */
  try {
    NetworkMonitor.init();
  } catch (e) {
    console.error('[init] NetworkMonitor başlatılamadı:', e);
  }

  /* 1. Ripple efekti */
  try {
    initRippleEffect();
  } catch (e) {
    console.error('[init] Ripple başlatılamadı:', e);
  }

  /* 2. Sekme animasyonları */
  try {
    initTabAnimations();
  } catch (e) {
    console.error('[init] TabAnimations başlatılamadı:', e);
  }

  /* 3. Oda listesi */
  var roomsGrid = document.querySelector('.rooms-grid');
  if (roomsGrid) {
    try {
      renderRoomList(roomsGrid);
    } catch (e) {
      console.error('[init] Oda listesi yüklenemedi:', e);
      ToastManager.error('Oda listesi yüklenemedi.', 'Yükleme Hatası');
    }
  }

  /* 4. Oda kur butonu */
  var openModalBtn = document.getElementById('btnOpenCreateModal');
  if (openModalBtn) {
    openModalBtn.addEventListener('click', function () {
      try {
        var modal = document.getElementById('createRoomModal');
        if (modal) modal.classList.add('open');
      } catch (e) {
        console.error('[init] Modal açılamadı:', e);
        ToastManager.error('Modal açılamadı.', 'Hata');
      }
    });
  }

  /* 5. Filter bar */
  document.querySelectorAll('.filter-chip').forEach(function (chip) {
    chip.addEventListener('click', function () {
      try {
        document.querySelectorAll('.filter-chip').forEach(function (c) { c.classList.remove('active'); });
        chip.classList.add('active');
        var cat  = chip.dataset.filter || chip.dataset.category || null;
        var grid = document.querySelector('.rooms-grid');
        if (grid) renderRoomList(grid, (cat === 'all' || cat === 'tümü') ? null : cat);
      } catch (e) {
        console.error('[filter] Filtre hatası:', e);
        ToastManager.error('Filtre uygulanamadı.', 'Hata');
      }
    });
  });

  /* 6. API key input */
  var apiKeyInput = document.getElementById('api-key-input');
  if (apiKeyInput) {
    apiKeyInput.addEventListener('change', function (e) {
      try {
        initApiKey(e.target.value);
        e.target.value       = '';
        e.target.placeholder = '••••••••••••••••';
      } catch (e2) {
        console.error('[init] API key işlenemedi:', e2);
        ToastManager.error('API anahtarı işlenemedi.', 'Hata');
      }
    });
  }

  /* 7. Kapasite stepper */
  var capacity = 5;
  var capVal   = document.getElementById('capValue');
  var btnInc   = document.getElementById('btnCapInc');
  var btnDec   = document.getElementById('btnCapDec');
  if (btnInc) {
    btnInc.addEventListener('click', function () {
      if (capacity < 20) { capacity++; if (capVal) capVal.textContent = capacity; }
    });
  }
  if (btnDec) {
    btnDec.addEventListener('click', function () {
      if (capacity > 2) { capacity--; if (capVal) capVal.textContent = capacity; }
    });
  }

  /* 8. Oda tipi seçimi */
  document.querySelectorAll('.type-btn').forEach(function (btn) {
    btn.addEventListener('click', function () {
      document.querySelectorAll('.type-btn').forEach(function (b) { b.classList.remove('selected'); });
      this.classList.add('selected');
      var pf = document.getElementById('passwordField');
      if (pf) pf.style.display = (this.dataset.type === 'private') ? 'block' : 'none';
    });
  });

  /* 9. Modal kapat */
  var closeModal = document.getElementById('btnCloseModal');
  if (closeModal) {
    closeModal.addEventListener('click', function () {
      var modal = document.getElementById('createRoomModal');
      if (modal) modal.classList.remove('open');
    });
  }
  var createRoomModal = document.getElementById('createRoomModal');
  if (createRoomModal) {
    createRoomModal.addEventListener('click', function (e) {
      if (e.target === this) this.classList.remove('open');
    });
  }

  /* 10. Oda oluştur (form submit) */
  var submitRoom = document.getElementById('btnSubmitRoom');
  if (submitRoom) {
    submitRoom.addEventListener('click', function () {
      try {
        var nameInput = document.getElementById('roomName');
        if (!nameInput || !nameInput.value.trim()) {
          ToastManager.warning('Oda adı boş bırakılamaz.', 'Eksik Alan');
          if (nameInput) nameInput.focus();
          return;
        }

        var roomName = nameInput.value.trim();

        /* Loading state — buton */
        var restore = LoadingManager.setButtonLoading(submitRoom, 'Oluşturuluyor…');

        setTimeout(function () {
          try {
            restore();
            ToastManager.success('✦ "' + roomName + '" odası oluşturuldu!', 'Oda Kuruldu');
            var modal = document.getElementById('createRoomModal');
            if (modal) modal.classList.remove('open');
            if (nameInput) nameInput.value = '';
            var grid = document.querySelector('.rooms-grid');
            if (grid) renderRoomList(grid);
          } catch (e) {
            restore();
            console.error('[submitRoom] Oda oluşturma hatası:', e);
            ToastManager.error('Oda oluşturulamadı. Tekrar deneyin.', 'Hata');
          }
        }, 900); /* Simüle edilen işlem süresi */
      } catch (e) {
        console.error('[submitRoom] Beklenmedik hata:', e);
        ToastManager.error('Beklenmedik bir hata oluştu.', 'Hata');
      }
    });
  }

  /* 11. Başarılı yüklenme bildirimi (sessiz — sadece konsola) */
  console.info('[Sanctuary] 4. Aşama yüklendi. Toast, NetworkMonitor, LoadingManager hazır.');
});

/* ══════════════════════════════════════════════════════════════════
   GLOBAL TEMIZLIK
══════════════════════════════════════════════════════════════════ */

window.addEventListener('beforeunload', function () {
  try { clearApiKey(); } catch (e) { /* no-op */ }
});

/* ══════════════════════════════════════════════════════════════════
   GLOBAL API — Diğer modüller bu fonksiyonlara erişebilir
══════════════════════════════════════════════════════════════════ */

window.SanctuaryToast   = ToastManager;
window.SanctuaryLoading = LoadingManager;
window.SanctuaryNetwork = NetworkMonitor;
window.SanctuaryAiUI    = AiOracleUI;
window.fetchSanctuary   = fetchWithTimeout;
window.loadAudio        = loadAudioWithFeedback;

/* Geriye dönük uyumluluk */
window.handleCreateRoom = handleCreateRoom;
window.handleJoinRoom   = handleJoinRoom;
window.handleDeleteRoom = handleDeleteRoom;
window.handleLeaveRoom  = handleLeaveRoom;
window.renderRoomList   = renderRoomList;
window.showToast        = showToast;
