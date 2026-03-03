/**
 * main.js — 3. Aşama Güncellemeleri
 * ─────────────────────────────────────────────────────────────────────────────
 * Önceki aşamalardan gelen initRippleEffect ve startBreathCycle korundu.
 * Bu aşamada eklenenler:
 *   1. initApiKey()       — API key'i localStorage yerine StateManager runtime'a yükler
 *   2. renderRoomList()   — Oda kartları buildRoomCard() ile render edilir
 *   3. handleCreateRoom() — Premium kontrolü + hata geri bildirimi
 *   4. handleJoinRoom()   — Şifre hash + premium + kapasite kontrollü katılım
 *   5. handleDeleteRoom() — Host yetkisi kontrolü
 *   6. handleLeaveRoom()  — Host ayrılırsa otomatik host devri
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { getStateManager } from './StateManager.js';
import RoomManager         from './RoomManager.js';

/* ══════════════════════════════════════════════════════════════════
   BÖLÜM 1 — RİPPLE EFEKTİ (2. Aşamadan korundu)
══════════════════════════════════════════════════════════════════ */

function initRippleEffect() {
  document.addEventListener('mousedown', function (e) {
    if (e.target.closest('button, .cta-btn, .play-btn, .back-btn')) return;

    const ripple = document.createElement('div');
    ripple.className = 'ripple-circle';

    const size = Math.max(window.innerWidth, window.innerHeight) * 0.6;
    ripple.style.width  = size + 'px';
    ripple.style.height = size + 'px';
    ripple.style.left   = e.clientX + 'px';
    ripple.style.top    = e.clientY + 'px';

    document.body.appendChild(ripple);

    ripple.addEventListener('animationend', function () {
      ripple.remove();
    }, { once: true });
  });
}

/* ══════════════════════════════════════════════════════════════════
   BÖLÜM 2 — NEFES DÖNGÜSÜ (2. Aşamadan korundu)
══════════════════════════════════════════════════════════════════ */

function startBreathCycle(engine, breathWrap, guideEl, options = {}) {
  const {
    inhale    = 4,
    hold      = 2,
    exhale    = 6,
    volInhale = 0.85,
    volExhale = 0.55,
  } = options;

  let stopped = false;
  let timers  = [];

  function clearTimers() {
    timers.forEach(clearTimeout);
    timers = [];
  }

  function setGuide(text, active = true) {
    if (!guideEl) return;
    guideEl.textContent = text;
    guideEl.classList.toggle('on', active);
  }

  function setBreathClass(cls) {
    if (!breathWrap) return;
    breathWrap.classList.remove('breath-inhale', 'breath-hold', 'breath-exhale', 'breath-idle');
    if (cls) breathWrap.classList.add(cls);
  }

  function smoothVolume(target, duration) {
    if (!engine) return;
    try {
      if (typeof engine.fadeTo === 'function') {
        engine._layers?.forEach((layer) => layer.fadeTo(target, duration * 0.9));
      } else if (typeof engine.setMasterVolume === 'function') {
        engine.setMasterVolume(target);
      }
    } catch (err) {
      console.warn('[BreathCycle] Volume fade error:', err);
    }
  }

  function runCycle() {
    if (stopped) return;

    setBreathClass('breath-inhale');
    setGuide('Breathe in…');
    smoothVolume(volInhale, inhale);

    timers.push(setTimeout(() => {
      if (stopped) return;
      setBreathClass('breath-hold');
      setGuide('Hold');

      timers.push(setTimeout(() => {
        if (stopped) return;
        setBreathClass('breath-exhale');
        setGuide('Breathe out…');
        smoothVolume(volExhale, exhale);

        timers.push(setTimeout(() => {
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
  };
}

/* ══════════════════════════════════════════════════════════════════
   BÖLÜM 3 — API KEY GÜVENLİ YÜKLEME
   FIX: API key localStorage'a yazılmaz; StateManager runtime'a yüklenir.
══════════════════════════════════════════════════════════════════ */

/**
 * API anahtarını güvenli şekilde başlatır.
 * Güvenlik değişikliği: Artık localStorage'a hiç yazılmıyor.
 * StateManager.setApiKey() → #apiKeyRuntime private alanında saklar.
 *
 * @param {string} key
 */
function initApiKey(key) {
  if (!key || typeof key !== 'string') return;
  const state = getStateManager();
  state.setApiKey(key.trim());
  console.info('[main] API key runtime belleğe yüklendi. localStorage\'a yazılmadı.');
}

/** Uygulama kapanırken veya logout'ta API key'i temizler. */
function clearApiKey() {
  getStateManager().clearApiKey();
}

/* ══════════════════════════════════════════════════════════════════
   BÖLÜM 4 — ODA UI YÖNETİMİ
   buildRoomCard + participants.length tabanlı render
══════════════════════════════════════════════════════════════════ */

/**
 * Oda listesini DOM'a render eder.
 * FIX: Her kart buildRoomCard() üzerinden geçirilir;
 * kapasite gösterimi room.participants.length'ten türetilir.
 *
 * @param {HTMLElement} container — .rooms-grid elementi
 * @param {string|null} [category]
 */
function renderRoomList(container, category = null) {
  if (!container) return;

  const rooms = RoomManager.getPublicRooms(category);

  if (rooms.length === 0) {
    container.innerHTML = `
      <div class="empty-state">
        <div class="empty-icon">🌿</div>
        <p class="empty-title">Henüz aktif oda yok</p>
        <p class="empty-sub">İlk odayı sen kur ve herkesi davet et.</p>
        <button class="btn-start-first" id="btn-first-room">Oda Kur</button>
      </div>`;
    document.getElementById('btn-first-room')
      ?.addEventListener('click', () => handleCreateRoom());
    return;
  }

  container.innerHTML = rooms
    .map(room => {
      // FIX: buildRoomCard participants.length'i current olarak döndürür
      const card    = RoomManager.buildRoomCard(room);
      const fillPct = Math.round(card.capacityFill * 100);
      return `
        <div class="room-card" data-room-id="${card.id}">
          <div class="card-top">
            <span class="badge-live"><span class="dot"></span> CANLI</span>
            ${card.isPrivate
              ? `<span class="badge-private">
                   <svg viewBox="0 0 12 12" fill="currentColor">
                     <path d="M6 1a2.5 2.5 0 0 0-2.5 2.5V5H3v5h6V5h-.5V3.5A2.5 2.5 0 0 0 6 1zm1.5 4h-3V3.5a1.5 1.5 0 0 1 3 0V5z"/>
                   </svg>
                   Özel
                 </span>`
              : ''}
          </div>
          <p class="room-name">${card.name}</p>
          <p class="room-category">${card.category}</p>
          <div class="card-footer">
            <div class="host-info">
              <div class="host-avatar">${card.hostId?.[0]?.toUpperCase() ?? 'H'}</div>
              <span class="host-name">Host</span>
            </div>
            <div class="capacity-bar-wrap">
              <p class="capacity-text">${card.current}/${card.capacity}</p>
              <div class="capacity-bar">
                <div class="capacity-fill" style="width:${fillPct}%"></div>
              </div>
            </div>
          </div>
        </div>`;
    })
    .join('');

  // Kart tıklamalarını bağla
  container.querySelectorAll('.room-card').forEach(card => {
    card.addEventListener('click', () => {
      const roomId = card.dataset.roomId;
      if (roomId) handleJoinRoom(roomId);
    });
  });
}

/* ══════════════════════════════════════════════════════════════════
   BÖLÜM 5 — ODA İŞLEM HANDLER'LARI
══════════════════════════════════════════════════════════════════ */

/**
 * Oda oluşturma.
 * FIX: Premium kontrolü RoomManager.createRoom içinde StateManager üzerinden yapılır.
 *
 * @param {object} [formData]
 * @returns {object|null} Oluşturulan oda ya da null
 */
function handleCreateRoom(formData = {}) {
  const result = RoomManager.createRoom(formData);

  if (!result.success) {
    console.warn('[main] Oda oluşturulamadı:', result.error);

    if (result.error.includes('Premium')) {
      document.dispatchEvent(new CustomEvent('sanctuary:showPaywall', {
        detail: { reason: result.error },
      }));
    } else {
      showToast(result.error, 'error');
    }
    return null;
  }

  console.info('[main] Oda oluşturuldu:', result.room.id);
  const grid = document.querySelector('.rooms-grid');
  if (grid) renderRoomList(grid);
  return result.room;
}

/**
 * Odaya katılma.
 * FIX: Şifre hash'leme RoomManager.joinRoom içinde yapılır.
 *      Private oda + premium kontrolü RoomManager tarafından uygulanır.
 *
 * @param {string} roomId
 * @param {string|null} [password]
 */
async function handleJoinRoom(roomId, password = null) {
  const room = RoomManager.getRoomById(roomId);
  if (!room) {
    showToast('Oda bulunamadı.', 'error');
    return;
  }

  // Private oda şifre gerektiriyorsa kullanıcıdan al
  if (room.type === 'private' && room.password && password === null) {
    password = await promptPassword('Bu oda şifre korumalı. Lütfen şifreyi girin:');
    if (password === null) return; // kullanıcı iptal etti
  }

  const result = RoomManager.joinRoom(roomId, password);

  if (!result.success) {
    if (result.error.includes('Premium')) {
      document.dispatchEvent(new CustomEvent('sanctuary:showPaywall', {
        detail: { reason: result.error },
      }));
    } else {
      showToast(result.error, 'error');
    }
    return;
  }

  showToast(`"${room.name}" odasına katıldınız.`, 'success');
}

/**
 * Oda silme.
 * FIX: Host yetkisi kontrolü RoomManager.deleteRoom içinde yapılır.
 */
function handleDeleteRoom(roomId) {
  const result = RoomManager.deleteRoom(roomId);

  if (!result.success) {
    showToast(result.error, 'error');
    return;
  }

  showToast('Oda silindi.', 'success');
  const grid = document.querySelector('.rooms-grid');
  if (grid) renderRoomList(grid);
}

/**
 * Odadan ayrılma.
 * FIX: Host ayrılırsa yeni host otomatik atanır (RoomManager içinde).
 */
function handleLeaveRoom(roomId) {
  const result = RoomManager.leaveRoom(roomId);

  if (!result.success) {
    showToast(result.error, 'error');
    return;
  }

  if (result.deleted) {
    showToast('Odadan ayrıldınız. Oda boşaldığı için kapatıldı.', 'info');
  } else if (result.newHost) {
    showToast('Odadan ayrıldınız. Oda sahipliği devredildi.', 'info');
  } else {
    showToast('Odadan ayrıldınız.', 'success');
  }

  const grid = document.querySelector('.rooms-grid');
  if (grid) renderRoomList(grid);
}

/* ══════════════════════════════════════════════════════════════════
   BÖLÜM 6 — UI YARDIMCILARI
══════════════════════════════════════════════════════════════════ */

function showToast(message, type = 'info') {
  const toast = document.getElementById('notif-toast');
  if (toast) {
    const titleEl = toast.querySelector('.nt-title');
    const bodyEl  = toast.querySelector('.nt-body');
    if (titleEl) titleEl.textContent =
      type === 'error' ? 'Hata' : type === 'success' ? 'Başarılı' : 'Bilgi';
    if (bodyEl) bodyEl.textContent = message;
    toast.classList.add('show');
    setTimeout(() => toast.classList.remove('show'), 3500);
  } else {
    console[type === 'error' ? 'error' : 'info']('[Toast]', message);
  }
}

/**
 * Şifre girişi — üretimde projenin modal sistemiyle replace edilmeli.
 * @returns {Promise<string|null>}
 */
async function promptPassword(message) {
  // TODO: window.prompt yerine özel modal kullanın
  const pwd = window.prompt(message);
  return pwd !== null ? pwd : null;
}

/* ══════════════════════════════════════════════════════════════════
   BÖLÜM 7 — BAŞLATMA
══════════════════════════════════════════════════════════════════ */

document.addEventListener('DOMContentLoaded', () => {
  initRippleEffect();

  // Oda listesini render et
  const roomsGrid = document.querySelector('.rooms-grid');
  if (roomsGrid) renderRoomList(roomsGrid);

  // Oda kur butonu
  document.getElementById('btn-create-room')
    ?.addEventListener('click', () => {
      const modal = document.getElementById('create-room-modal');
      if (modal) modal.classList.add('open');
    });

  // API key input — güvenli yükleme
  const apiKeyInput = document.getElementById('api-key-input');
  if (apiKeyInput) {
    apiKeyInput.addEventListener('change', (e) => {
      initApiKey(e.target.value);
      e.target.value = '';
      e.target.placeholder = '••••••••••••••••';
    });
  }

  // Filter bar
  document.querySelectorAll('.filter-chip').forEach(chip => {
    chip.addEventListener('click', () => {
      document.querySelectorAll('.filter-chip').forEach(c => c.classList.remove('active'));
      chip.classList.add('active');
      const cat = chip.dataset.category || null;
      const grid = document.querySelector('.rooms-grid');
      if (grid) renderRoomList(grid, cat === 'tümü' ? null : cat);
    });
  });
});

window.addEventListener('beforeunload', () => {
  clearApiKey();
});

/* ══════════════════════════════════════════════════════════════════
   EXPORTS
══════════════════════════════════════════════════════════════════ */

export {
  initRippleEffect,
  startBreathCycle,
  initApiKey,
  clearApiKey,
  renderRoomList,
  handleCreateRoom,
  handleJoinRoom,
  handleDeleteRoom,
  handleLeaveRoom,
  showToast,
};
