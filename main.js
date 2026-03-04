/**
 * main.js — Sanctuary 2. Aşama (Görsel Restorasyon)
 * ─────────────────────────────────────────────────────────────────────────────
 * Değişiklikler:
 *   1. initRippleEffect()  — Çok halkalı (3x) su dalgası efekti
 *   2. startBreathCycle()  — Nefes senkronu: fadeTo ile ses seviyesi uyumu
 *   3. initTabAnimations() — Sekme blur+fade geçişi
 *   4. Oda yönetimi handler'ları korundu
 * ─────────────────────────────────────────────────────────────────────────────
 */

'use strict';

/* ══════════════════════════════════════════════════════════════════
   BÖLÜM 1 — RİPPLE EFEKTİ (Çok Halkalı Su Dalgası)
   mousedown + touchstart desteği
   Her tıklamada 3 halka oluşur, CSS animasyonu ile kaybolur.
══════════════════════════════════════════════════════════════════ */

function initRippleEffect() {
  const RING_COUNT = 3;
  const RING_DELAYS = [0, 120, 260]; // ms — halkalar arası gecikme

  function spawnRippleAt(x, y) {
    const size = Math.max(window.innerWidth, window.innerHeight) * 0.72;

    for (let i = 0; i < RING_COUNT; i++) {
      ;(function (delay) {
        setTimeout(function () {
          const ring = document.createElement('div');
          ring.className = 'ripple-circle';

          // nth-child stili CSS'de; burada inline olarak sıra numarası ver
          ring.dataset.ring = i + 1;

          ring.style.cssText = [
            'position:fixed',
            `width:${size}px`,
            `height:${size}px`,
            `left:${x}px`,
            `top:${y}px`,
            'border-radius:50%',
            'pointer-events:none',
            'transform:translate(-50%,-50%) scale(0)',
            'z-index:9999',
          ].join(';');

          // Her halka için ayrı renk/opaklık
          const styles = [
            { border: '1px solid rgba(201,169,110,0.32)', animDuration: '1.8s' },
            { border: '1px solid rgba(201,169,110,0.17)', animDuration: '2.15s' },
            { border: '1px solid rgba(170,130,220,0.11)', animDuration: '2.55s' },
          ];
          const s = styles[i] || styles[0];
          ring.style.border        = s.border;
          ring.style.animation     = `rippleExpand ${s.animDuration} cubic-bezier(0.2,0,0.4,1) forwards`;
          ring.style.willChange    = 'transform, opacity';

          document.body.appendChild(ring);

          ring.addEventListener('animationend', function () {
            ring.remove();
          }, { once: true });

        }, delay);
      })(RING_DELAYS[i]);
    }
  }

  // Mouse
  document.addEventListener('mousedown', function (e) {
    // Kontrol elementlerine tıklanınca ripple oluşturma
    if (e.target.closest('button, .cta-btn, .play-btn, .back-btn, input, textarea, select')) return;
    spawnRippleAt(e.clientX, e.clientY);
  });

  // Touch
  document.addEventListener('touchstart', function (e) {
    if (e.target.closest('button, .cta-btn, .play-btn, .back-btn, input, textarea, select')) return;
    const t = e.touches[0];
    spawnRippleAt(t.clientX, t.clientY);
  }, { passive: true });
}

/* ══════════════════════════════════════════════════════════════════
   BÖLÜM 2 — SEKME GEÇİŞ ANİMASYONLARI
   switchTab() global fonksiyonunu override eder.
   İçerik blur+fade-in (0.3s) ile gelir.
══════════════════════════════════════════════════════════════════ */

function initTabAnimations() {
  // index.html'deki inline switchTab'ı override et
  window.switchTab = function (tabId) {
    const panels  = document.querySelectorAll('.tab-panel');
    const buttons = document.querySelectorAll('.tab-item');

    // Tüm panelleri gizle
    panels.forEach(function (el) {
      el.classList.remove('active');
    });
    buttons.forEach(function (el) {
      el.classList.remove('active');
      el.setAttribute('aria-selected', 'false');
    });

    // Hedef paneli göster — CSS animasyonu otomatik tetiklenir
    const target = document.getElementById(tabId);
    if (target) {
      // Animasyonu yeniden tetiklemek için clone trick
      target.classList.remove('active');
      // Bir sonraki frame'de ekle → @keyframes tabReveal yeniden çalışır
      requestAnimationFrame(function () {
        requestAnimationFrame(function () {
          target.classList.add('active');
        });
      });
    }

    // Aktif buton
    const btnId = 'tab-btn-' + tabId.replace('tab-', '');
    const activeBtn = document.getElementById(btnId);
    if (activeBtn) {
      activeBtn.classList.add('active');
      activeBtn.setAttribute('aria-selected', 'true');
    }

    // Journal için tarih göster
    if (tabId === 'tab-journal') {
      const d = document.getElementById('journal-date');
      if (d) d.textContent = new Date().toLocaleDateString('tr-TR', {
        weekday: 'long', day: 'numeric', month: 'long'
      });
    }
  };
}

/* ══════════════════════════════════════════════════════════════════
   BÖLÜM 3 — NEFES DÖNGÜSÜ (Ses Senkronlu)
   engine.fadeTo() ile nefes hızına ses seviyesi uyarlanır.
   phase fix: this.phase başlangıç değeri AudioEngine'de düzeltildi.
══════════════════════════════════════════════════════════════════ */

/**
 * @param {object|null} engine      — AudioEngine instance (opsiyonel)
 * @param {HTMLElement} breathWrap  — .breath-wrap elementi
 * @param {HTMLElement} guideEl     — #breath-guide elementi
 * @param {object}      options
 * @returns {function} stopBreathCycle
 */
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
    if (active === undefined) active = true;
    guideEl.classList.toggle('on', active);
  }

  function setBreathClass(cls) {
    if (!breathWrap) return;
    breathWrap.classList.remove('breath-inhale', 'breath-hold', 'breath-exhale', 'breath-idle');
    if (cls) breathWrap.classList.add(cls);
    // CSS custom property ile ring geçiş süresi
    if (cls === 'breath-inhale') breathWrap.style.setProperty('--inhale-dur', inhale + 's');
    if (cls === 'breath-exhale') breathWrap.style.setProperty('--exhale-dur', exhale + 's');
  }

  /**
   * Nefes hızıyla senkronize ses seviyesi geçişi.
   * AudioEngine'in fadeTo() veya setMasterVolume() metodunu kullanır.
   */
  function syncVolume(targetVol, durationSec) {
    if (!engine) return;
    try {
      // Katman bazlı fade (tercih edilen)
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
      console.warn('[BreathCycle] Volume sync error:', err);
    }
  }

  function runCycle() {
    if (stopped) return;

    // NEFES AL
    setBreathClass('breath-inhale');
    setGuide('Nefes al…');
    syncVolume(volInhale, inhale);

    timers.push(setTimeout(function () {
      if (stopped) return;

      // TUT
      setBreathClass('breath-hold');
      setGuide('Tut…');
      // Tutma fazında ses değişmez

      timers.push(setTimeout(function () {
        if (stopped) return;

        // NEFES VER
        setBreathClass('breath-exhale');
        setGuide('Nefes ver…');
        syncVolume(volExhale, exhale);

        timers.push(setTimeout(function () {
          if (stopped) return;
          runCycle(); // Döngüyü tekrarla
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
    // Ses seviyesini sıfırla
    if (engine) syncVolume(0.70, 1.5);
  };
}

/* ══════════════════════════════════════════════════════════════════
   BÖLÜM 4 — API KEY GÜVENLİ YÜKLEME
══════════════════════════════════════════════════════════════════ */

function initApiKey(key) {
  if (!key || typeof key !== 'string') return;
  try {
    var state = (typeof getStateManager === 'function') ? getStateManager() : null;
    if (state && typeof state.setApiKey === 'function') {
      state.setApiKey(key.trim());
      console.info('[main] API key runtime belleğe yüklendi.');
    }
  } catch (e) {
    console.warn('[main] StateManager bulunamadı:', e);
  }
}

function clearApiKey() {
  try {
    var state = (typeof getStateManager === 'function') ? getStateManager() : null;
    if (state && typeof state.clearApiKey === 'function') state.clearApiKey();
  } catch (e) { /* no-op */ }
}

/* ══════════════════════════════════════════════════════════════════
   BÖLÜM 5 — TOAST BİLDİRİMİ
══════════════════════════════════════════════════════════════════ */

function showToast(message, type) {
  type = type || 'info';
  var toast = document.getElementById('notif-toast');
  if (toast) {
    var titleEl = toast.querySelector('.nt-title');
    var bodyEl  = toast.querySelector('.nt-body');
    if (titleEl) titleEl.textContent =
      type === 'error' ? 'Hata' : type === 'success' ? 'Başarılı' : 'Bilgi';
    if (bodyEl) bodyEl.textContent = message;
    toast.classList.add('show');
    setTimeout(function () { toast.classList.remove('show'); }, 3500);
  } else {
    var fn = (type === 'error') ? console.error : console.info;
    fn('[Toast]', message);
  }
}

/* ══════════════════════════════════════════════════════════════════
   BÖLÜM 6 — ODA UI YÖNETİMİ (RoomManager opsiyonel)
══════════════════════════════════════════════════════════════════ */

function renderRoomList(container, category) {
  if (!container) return;

  if (typeof RoomManager === 'undefined') {
    // RoomManager yoksa örnek kartlar göster
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
}

function _demoRoomsHTML() {
  var demos = [
    { id: 'd1', name: 'Gece Odak', category: 'Odak', current: 3, capacity: 8, isPrivate: false, hostId: 'A' },
    { id: 'd2', name: 'Derin Uyku', category: 'Uyku', current: 5, capacity: 10, isPrivate: false, hostId: 'B' },
    { id: 'd3', name: 'Şifa Meditasyonu', category: 'Meditasyon', current: 2, capacity: 5, isPrivate: true, hostId: 'C' },
    { id: 'd4', name: 'Sabah Enerjisi', category: 'Doğa', current: 7, capacity: 12, isPrivate: false, hostId: 'D' },
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
    '  <p class="room-name">' + card.name + '</p>',
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
   BÖLÜM 7 — ODA HANDLER'LARI
══════════════════════════════════════════════════════════════════ */

function handleCreateRoom(formData) {
  formData = formData || {};
  if (typeof RoomManager === 'undefined') {
    showToast('Oda sistemi yüklenmedi.', 'error');
    return null;
  }
  var result = RoomManager.createRoom(formData);
  if (!result.success) {
    if (result.error && result.error.includes('Premium')) {
      document.dispatchEvent(new CustomEvent('sanctuary:showPaywall', { detail: { reason: result.error } }));
    } else {
      showToast(result.error, 'error');
    }
    return null;
  }
  var grid = document.querySelector('.rooms-grid');
  if (grid) renderRoomList(grid);
  return result.room;
}

function handleJoinRoom(roomId, password) {
  if (typeof RoomManager === 'undefined') {
    showToast('Oda sistemi yüklenmedi.', 'error');
    return;
  }
  password = password || null;
  var room = RoomManager.getRoomById(roomId);
  if (!room) { showToast('Oda bulunamadı.', 'error'); return; }
  var result = RoomManager.joinRoom(roomId, password);
  if (!result.success) {
    if (result.error && result.error.includes('Premium')) {
      document.dispatchEvent(new CustomEvent('sanctuary:showPaywall', { detail: { reason: result.error } }));
    } else {
      showToast(result.error, 'error');
    }
    return;
  }
  showToast('"' + room.name + '" odasına katıldınız.', 'success');
}

function handleDeleteRoom(roomId) {
  if (typeof RoomManager === 'undefined') return;
  var result = RoomManager.deleteRoom(roomId);
  if (!result.success) { showToast(result.error, 'error'); return; }
  showToast('Oda silindi.', 'success');
  var grid = document.querySelector('.rooms-grid');
  if (grid) renderRoomList(grid);
}

function handleLeaveRoom(roomId) {
  if (typeof RoomManager === 'undefined') return;
  var result = RoomManager.leaveRoom(roomId);
  if (!result.success) { showToast(result.error, 'error'); return; }
  var msg = result.deleted ? 'Odadan ayrıldınız. Oda boşaldığı için kapatıldı.'
          : result.newHost ? 'Odadan ayrıldınız. Oda sahipliği devredildi.'
          : 'Odadan ayrıldınız.';
  showToast(msg, 'info');
  var grid = document.querySelector('.rooms-grid');
  if (grid) renderRoomList(grid);
}

/* ══════════════════════════════════════════════════════════════════
   BÖLÜM 8 — BAŞLATMA
══════════════════════════════════════════════════════════════════ */

document.addEventListener('DOMContentLoaded', function () {
  // 1. Ripple
  initRippleEffect();

  // 2. Sekme animasyonları
  initTabAnimations();

  // 3. Oda listesi
  var roomsGrid = document.querySelector('.rooms-grid');
  if (roomsGrid) renderRoomList(roomsGrid);

  // 4. Oda kur butonu (index.html'deki modal ile uyumlu)
  var openModalBtn = document.getElementById('btnOpenCreateModal');
  if (openModalBtn) {
    openModalBtn.addEventListener('click', function () {
      var modal = document.getElementById('createRoomModal');
      if (modal) modal.style.display = 'flex';
    });
  }

  // 5. Filter bar
  document.querySelectorAll('.filter-chip').forEach(function (chip) {
    chip.addEventListener('click', function () {
      document.querySelectorAll('.filter-chip').forEach(function (c) {
        c.classList.remove('active');
      });
      chip.classList.add('active');
      var cat  = chip.dataset.filter || chip.dataset.category || null;
      var grid = document.querySelector('.rooms-grid');
      if (grid) renderRoomList(grid, (cat === 'all' || cat === 'tümü') ? null : cat);
    });
  });

  // 6. API key input
  var apiKeyInput = document.getElementById('api-key-input');
  if (apiKeyInput) {
    apiKeyInput.addEventListener('change', function (e) {
      initApiKey(e.target.value);
      e.target.value = '';
      e.target.placeholder = '••••••••••••••••';
    });
  }

  // 7. Kapasite stepper (modal)
  var capacity = 5;
  var capVal   = document.getElementById('capValue');
  var btnInc   = document.getElementById('btnCapInc');
  var btnDec   = document.getElementById('btnCapDec');
  if (btnInc) btnInc.addEventListener('click', function () {
    if (capacity < 20) { capacity++; if (capVal) capVal.textContent = capacity; }
  });
  if (btnDec) btnDec.addEventListener('click', function () {
    if (capacity > 2)  { capacity--; if (capVal) capVal.textContent = capacity; }
  });

  // 8. Oda tipi seçimi
  document.querySelectorAll('.type-btn').forEach(function (btn) {
    btn.addEventListener('click', function () {
      document.querySelectorAll('.type-btn').forEach(function (b) { b.classList.remove('selected'); });
      this.classList.add('selected');
      var pf = document.getElementById('passwordField');
      if (pf) pf.style.display = (this.dataset.type === 'private') ? 'block' : 'none';
    });
  });

  // 9. Modal kapat
  var closeModal = document.getElementById('btnCloseModal');
  if (closeModal) {
    closeModal.addEventListener('click', function () {
      var modal = document.getElementById('createRoomModal');
      if (modal) modal.style.display = 'none';
    });
  }

  var createRoomModal = document.getElementById('createRoomModal');
  if (createRoomModal) {
    createRoomModal.addEventListener('click', function (e) {
      if (e.target === this) this.style.display = 'none';
    });
  }

  // 10. Oda oluştur
  var submitRoom = document.getElementById('btnSubmitRoom');
  if (submitRoom) {
    submitRoom.addEventListener('click', function () {
      var name = document.getElementById('roomName');
      if (!name || !name.value.trim()) {
        showToast('Oda adı gerekli.', 'error');
        return;
      }
      showToast('✨ "' + name.value.trim() + '" odası oluşturuldu!', 'success');
      var modal = document.getElementById('createRoomModal');
      if (modal) modal.style.display = 'none';
      if (name) name.value = '';
    });
  }
});

window.addEventListener('beforeunload', function () {
  clearApiKey();
});
