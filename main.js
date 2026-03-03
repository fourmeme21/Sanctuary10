/**
 * main.js — Sanctuary Ana Giriş Noktası
 * ═══════════════════════════════════════════════════════════════════════════
 * AudioEngine ve StateManager'ı birbirine bağlar.
 * DOM manipülasyonu minimumda tutulmuş; tüm iş mantığı iki motora delege edilir.
 *
 * Mimari:
 *  1. Initialization  → StorageAdapter, StateManager, hydrate()
 *  2. State-UI Binding → subscribe() ile reaktif UI güncellemeleri
 *  3. Event Handling  → HTML inline onclick'leri window.* fonksiyonlarına bağlar
 *  4. Mood & Scene    → Mood seçimi → AudioEngine.loadScript() + crossfade
 *  5. Timer & Breath  → Uyku zamanlayıcı + 4-7-8 nefes döngüsü
 *  6. Skeleton Reveal → Her şey hazır olduğunda revealContent() çağrısı
 * ═══════════════════════════════════════════════════════════════════════════
 */

import AudioEngine from './AudioEngine.js';
import { StateManager, getStateManager } from './StateManager.js';
import RoomManager from './RoomManager.js';
import { initRoomUI, renderRooms, openCreateModal, closeCreateModal } from './main-room-additions.js';

/* ──────────────────────────────────────────────────────────────────────────
   BÖLÜM 1 — StorageAdapter (localStorage wrapper)
   StateManager'a enjekte edilir. React Native'de AsyncStorage ile değiştirin.
────────────────────────────────────────────────────────────────────────── */

const localStorageAdapter = {
  get: async (key) => {
    try { return window.localStorage.getItem(key); }
    catch { return null; }
  },
  set: async (key, value) => {
    try { window.localStorage.setItem(key, value); }
    catch { /* storage dolu veya erişim yok */ }
  },
  remove: async (key) => {
    try { window.localStorage.removeItem(key); }
    catch { /* yoksay */ }
  },
};

/* ──────────────────────────────────────────────────────────────────────────
   BÖLÜM 2 — MOOD VERİSİ & SAHNE SCRIPT'LERİ
   Her mood için AudioEngine.loadScript()'e uygun scene script tanımları.
────────────────────────────────────────────────────────────────────────── */

/**
 * Mood adı → { emoji, label, scene, message, frequency, script }
 * `script` → AudioEngine.loadScript() beklediği formata uygun nesne
 */
const MOOD_CATALOG = {
  'Huzursuz': {
    emoji: '🌊',
    label: 'Huzursuz',
    scene: 'ocean_calm',
    freqLabel: '432 Hz — Deniz Dalgaları',
    message: 'Huzursuzluk enerjini fark et. Şimdi sadece nefes al ve dalgaların sesine bırak kendini.',
    breathPattern: { inhale: 4, hold: 4, exhale: 6, label: '4 · 4 · 6 — Denge Nefesi' },
    script: {
      scene: 'ocean_calm',
      tracks: [
        { id: 'waves',    type: 'granular', generator: 'waves',    parameters: { volume: 0.7 } },
        { id: 'binaural', type: 'granular', generator: 'binaural', parameters: { volume: 0.4, baseFreq: 200, beatFreq: 8 } },
      ],
      mix: { masterVolume: 0.8, trackVolumes: [0.7, 0.4] },
    },
  },
  'Yorgun': {
    emoji: '🌙',
    label: 'Yorgun',
    scene: 'deep_sleep',
    freqLabel: '396 Hz — Derin Dinlenme',
    message: 'Bedenin sana bir şey söylüyor: dinlenme vakti. Gözlerini kapat, her şeyi bırak.',
    breathPattern: { inhale: 4, hold: 7, exhale: 8, label: '4 · 7 · 8 — Uyku Nefesi' },
    script: {
      scene: 'deep_sleep',
      tracks: [
        { id: 'wind',     type: 'granular', generator: 'wind',     parameters: { volume: 0.5 } },
        { id: 'binaural', type: 'granular', generator: 'binaural', parameters: { volume: 0.45, baseFreq: 180, beatFreq: 3 } },
      ],
      mix: { masterVolume: 0.75, trackVolumes: [0.5, 0.45] },
    },
  },
  'Kaygılı': {
    emoji: '🌪',
    label: 'Kaygılı',
    scene: 'forest_calm',
    freqLabel: '528 Hz — Kaygı Giderici',
    message: 'Kaygı geçici. Şu an güvendesin. Ormandaki sessizliğe katıl, adım adım nefes al.',
    breathPattern: { inhale: 4, hold: 1, exhale: 8, label: '4 · 1 · 8 — Sakinleştirici' },
    script: {
      scene: 'forest_calm',
      tracks: [
        { id: 'wind',     type: 'granular', generator: 'wind',     parameters: { volume: 0.6 } },
        { id: 'rain',     type: 'granular', generator: 'rain',     parameters: { volume: 0.25 } },
        { id: 'binaural', type: 'granular', generator: 'binaural', parameters: { volume: 0.4, baseFreq: 210, beatFreq: 10 } },
      ],
      mix: { masterVolume: 0.8, trackVolumes: [0.6, 0.25, 0.4] },
    },
  },
  'Mutsuz': {
    emoji: '🌧',
    label: 'Mutsuz',
    scene: 'rainy_comfort',
    freqLabel: '417 Hz — Duygusal Dönüşüm',
    message: 'Mutsuzluğun geçerli. Yağmurun sesini duy — bazen hissetmek en cesur eylemdir.',
    breathPattern: { inhale: 5, hold: 2, exhale: 7, label: '5 · 2 · 7 — Şefkat Nefesi' },
    script: {
      scene: 'rainy_comfort',
      tracks: [
        { id: 'rain',     type: 'granular', generator: 'rain',     parameters: { volume: 0.65 } },
        { id: 'binaural', type: 'granular', generator: 'binaural', parameters: { volume: 0.35, baseFreq: 190, beatFreq: 6 } },
      ],
      mix: { masterVolume: 0.75, trackVolumes: [0.65, 0.35] },
    },
  },
  'Sakin': {
    emoji: '🕯',
    label: 'Sakin',
    scene: 'candlelight',
    freqLabel: '963 Hz — Bilinç Genişletme',
    message: 'Harika bir yer. Sakinliğini koru, derinleştir. İçindeki ateşi hisset.',
    breathPattern: { inhale: 4, hold: 4, exhale: 4, label: '4 · 4 · 4 — Kutu Nefesi' },
    script: {
      scene: 'candlelight',
      tracks: [
        { id: 'fire',     type: 'granular', generator: 'fire',     parameters: { volume: 0.55 } },
        { id: 'binaural', type: 'granular', generator: 'binaural', parameters: { volume: 0.4, baseFreq: 220, beatFreq: 10 } },
      ],
      mix: { masterVolume: 0.8, trackVolumes: [0.55, 0.4] },
    },
  },
  'Minnettar': {
    emoji: '✨',
    label: 'Minnettar',
    scene: 'golden_light',
    freqLabel: '741 Hz — İfade & Minnet',
    message: 'Minnettarlık en güçlü ilaçtır. Bu hissi tut, büyüt, etrafındakilere yansıt.',
    breathPattern: { inhale: 6, hold: 2, exhale: 6, label: '6 · 2 · 6 — Minnet Nefesi' },
    script: {
      scene: 'golden_light',
      tracks: [
        { id: 'waves',    type: 'granular', generator: 'waves',    parameters: { volume: 0.4 } },
        { id: 'binaural', type: 'granular', generator: 'binaural', parameters: { volume: 0.5, baseFreq: 230, beatFreq: 12 } },
      ],
      mix: { masterVolume: 0.8, trackVolumes: [0.4, 0.5] },
    },
  },
};

/** Premium ses kartları için katalog */
const PREMIUM_SOUNDS = [
  { id: 'binaural_beats',   icon: '🎛️', name: 'Binaural Beats',   sub: '40 Hz Gama Odaklanma', isPremium: true },
  { id: 'uyku_hipnozu',     icon: '🌙', name: 'Uyku Hipnozu',      sub: '3 Hz Delta Dalgaları',  isPremium: true },
  { id: 'aktif_meditasyon', icon: '🧘', name: 'Aktif Meditasyon',  sub: '8 Hz Alfa Derinliği',  isPremium: true },
  { id: 'derin_odak_pro',   icon: '🔬', name: 'Derin Odak Pro',    sub: '14 Hz Beta Odağı',     isPremium: true, requiresPro: true },
];

/* ──────────────────────────────────────────────────────────────────────────
   BÖLÜM 3 — UYGULAMA BAŞLATMA
────────────────────────────────────────────────────────────────────────── */

const state   = getStateManager(localStorageAdapter);
const engine  = AudioEngine.getInstance();

/* ── Global köprü: RoomManager ve main-room-additions bu nesnelere erişebilir ── */
window._sanctuaryState  = state;
window._sanctuaryEngine = engine;

/** Aktif zamanlayıcı ve nefes interval ID'lerini tutar */
const _timers = {
  sleepCountdown: null,   // setInterval — uyku sayacı UI güncelleyici
  breathLoop: null,       // setTimeout zinciri — nefes döngüsü
  sessionTick: null,      // setInterval — seans süresi sayacı
  waveform: null,         // requestAnimationFrame döngüsü
};

/** Nefes döngüsü aktif mi? */
let _breathActive = false;

/* ──────────────────────────────────────────────────────────────────────────
   BÖLÜM 4 — STATE-UI BINDING (Reaktif Arayüz)
   Tüm UI güncellemeleri bu subscribe bloklarında merkeze alınır.
────────────────────────────────────────────────────────────────────────── */

function setupStateBindings() {
  /* ── playing → play/pause butonu ── */
  state.subscribe('playing', (isPlaying) => {
    const btn  = document.getElementById('play-btn');
    const icon = document.getElementById('play-icon');
    const lbl  = document.getElementById('play-lbl');
    if (!btn) return;

    btn.setAttribute('aria-pressed', String(isPlaying));
    if (isPlaying) {
      icon.textContent = '⏸';
      lbl.textContent  = 'Duraklat';
      btn.classList.add('playing');
      startWaveformLoop();
    } else {
      icon.textContent = '▶';
      lbl.textContent  = 'Frekansı Başlat';
      btn.classList.remove('playing');
      stopWaveformLoop();
    }
  });

  /* ── selectedMood → chip aktif sınıfı + badge + mesaj ── */
  state.subscribe('selectedMood', (mood) => {
    // Önce tüm chip'lerden active sınıfını temizle
    document.querySelectorAll('.mood-chip').forEach((el) =>
      el.classList.remove('active')
    );

    // Eşleşen chip'e active ekle
    const activeChip = document.querySelector(`.mood-chip[data-mood="${mood}"]`);
    if (activeChip) activeChip.classList.add('active');

    // Sanctuary ekranındaki badge'i güncelle
    const moodData = MOOD_CATALOG[mood];
    if (moodData) {
      const emojiEl = document.getElementById('s-emoji');
      const moodEl  = document.getElementById('s-mood');
      const msgEl   = document.getElementById('s-message');
      const freqEl  = document.getElementById('freq-label');

      if (emojiEl) emojiEl.textContent = moodData.emoji;
      if (moodEl)  moodEl.textContent  = moodData.label;
      if (msgEl)   msgEl.textContent   = moodData.message;
      if (freqEl)  freqEl.textContent  = moodData.freqLabel;

      // Nefes pattern güncelle
      updateBreathGuide(moodData.breathPattern.label);
    }
  });

  /* ── isTimerActive → uyku zamanlayıcı UI ── */
  state.subscribe('isTimerActive', (active) => {
    const cancelBtn = document.getElementById('stimer-cancel-btn');
    if (cancelBtn) cancelBtn.style.display = active ? 'inline-flex' : 'none';

    if (active) {
      startSleepCountdownUI();
    } else {
      stopSleepCountdownUI();
    }
  });

  /* ── bannerDismissed → HP banner ── */
  state.subscribe('bannerDismissed', (dismissed) => {
    const banner = document.getElementById('hp-banner');
    if (banner) banner.style.display = dismissed ? 'none' : '';
  });

  /* ── isPremium → premium rozet güncellemeleri ── */
  state.subscribe('isPremium', () => {
    renderPremiumSounds();
  });

  /* ── activeMood → tüm modüllere (Detox dahil) yansıt ── */
  state.subscribe('activeMood', (mood) => {
    // window._activeMood her zaman StateManager ile senkron kalsın
    window._activeMood = mood;
    // Detox modülü aktifse mevcut mood bilgisini al (çakışma yok, sadece state)
    if (window.DetoxModule?.isActive?.()) {
      console.info('[main] activeMood değişti (Detox aktif):', mood);
    }
  });
}

/* ──────────────────────────────────────────────────────────────────────────
   BÖLÜM 5 — MOOD & SCENE LOGIC
────────────────────────────────────────────────────────────────────────── */

/**
 * Kullanıcı bir mood chip'ine tıkladığında çağrılır.
 * StateManager'ı günceller, AudioEngine için sahneyi hazırlar (preload).
 * @param {HTMLElement} el — tıklanan .mood-chip elementi
 */
window.pickMood = function pickMood(el) {
  const mood = el?.dataset?.mood;
  if (!mood || !MOOD_CATALOG[mood]) return;

  // Önceki aktif chip'i kaldır
  document.querySelectorAll('.mood-chip').forEach((c) => c.classList.remove('active'));
  el.classList.add('active');

  // ── State senkronizasyonu: activeMood'u StateManager'a kaydet (Mood state sync fix) ──
  try {
    state.set('activeMood', mood);
    state.setCurrentScene(MOOD_CATALOG[mood].scene);
    // window._activeMood subscribe üzerinden otomatik güncellenecek;
    // ancak subscribe async olabileceği için burada da set ediyoruz.
    window._activeMood = mood;
  } catch { /* yoksay */ }

  // UI'yı doğrudan güncelleyelim (selectedMood enum uyumsuzluğunu bypass ederek)
  _applyMoodToUI(mood);

  // Sahneyi önceden preload et (ses dosyaları olmadığından burada mock)
  // Gerçek ses dosyaları olduğunda: engine.preload([moodData.script.tracks.map(t => t.uri)])
};

/**
 * StateManager enum kısıtlaması olmaksızın mood UI'sını uygular.
 * @private
 */
function _applyMoodToUI(mood) {
  const moodData = MOOD_CATALOG[mood];
  if (!moodData) return;

  const emojiEl = document.getElementById('s-emoji');
  const moodEl  = document.getElementById('s-mood');
  const msgEl   = document.getElementById('s-message');
  const freqEl  = document.getElementById('freq-label');

  if (emojiEl) emojiEl.textContent = moodData.emoji;
  if (moodEl)  moodEl.textContent  = moodData.label;
  if (msgEl)   msgEl.textContent   = moodData.message;
  if (freqEl)  freqEl.textContent  = moodData.freqLabel;

  updateBreathGuide(moodData.breathPattern.label);

  // Aktif sahneyi sakla (scene script için)
  window._activeMood = mood;
}

/**
 * Sanctuary ekranına geçiş + ses sahnesi yükleme.
 * play/pause ile tetikleneceği için burada sadece sahne hazırlığı yapılır.
 */
window.goSanctuary = function goSanctuary() {
  const mood = window._activeMood ||
    document.querySelector('.mood-chip.active')?.dataset?.mood ||
    'Sakin';

  if (!window._activeMood) _applyMoodToUI(mood);

  // Ekran geçişi
  switchScreen('screen-sanctuary');

  // AI Oracle skeleton'ını kısa süre sonra kaldır
  setTimeout(() => {
    const sk = document.getElementById('ai-oracle-skeleton');
    const ct = document.getElementById('ai-oracle-content');
    if (sk) sk.style.display = 'none';
    if (ct) ct.style.display = 'block';
  }, 600);

  // Seans başlat
  state.startSession();
};

/* ──────────────────────────────────────────────────────────────────────────
   BÖLÜM 6 — PLAY / PAUSE
────────────────────────────────────────────────────────────────────────── */

/**
 * Play/Pause toggle — HTML butona bağlı.
 * İlk çağrıda AudioContext başlatılır ve sahne yüklenir.
 */
window.togglePlay = async function togglePlay() {
  try {
    // AudioContext ilk kez kullanıcı etkileşimiyle başlatılır
    if (!engine.isInitialized) {
      await engine.initialize();
    }

    const mood = window._activeMood || 'Sakin';
    const moodData = MOOD_CATALOG[mood];

    if (!engine.isPlaying) {
      // Sahne yükle + crossfade ile başlat
      if (moodData?.script) {
        await engine.loadScript(moodData.script, { crossfade: true });
      }
      await engine.play();
      state.setPlaying(true);

      // Nefes döngüsünü başlat
      if (moodData?.breathPattern) {
        startBreathCycle(moodData.breathPattern);
      }
    } else {
      await engine.pause();
      state.setPlaying(false);
      stopBreathCycle();
    }
  } catch (err) {
    console.error('[main] togglePlay hatası:', err);
    showFallbackNotice('Ses başlatılamadı, tekrar deneyin.');
  }
};

/* ──────────────────────────────────────────────────────────────────────────
   BÖLÜM 7 — WAVEFORM VİZUALİZER
────────────────────────────────────────────────────────────────────────── */

function startWaveformLoop() {
  const container = document.getElementById('waveform');
  if (!container || _timers.waveform) return;

  // Waveform bar'larını oluştur (ilk kez)
  if (!container.children.length) {
    for (let i = 0; i < 20; i++) {
      const bar = document.createElement('div');
      bar.className = 'wf-bar';
      container.appendChild(bar);
    }
  }

  const bars = container.querySelectorAll('.wf-bar');

  function tick() {
    const data = engine.getAudioData();
    bars.forEach((bar, i) => {
      let height;
      if (data?.frequencies) {
        const step = Math.floor(data.frequencies.length / bars.length);
        height = 4 + (data.frequencies[i * step] / 255) * 36;
      } else {
        height = 4 + Math.random() * 20; // fallback animasyon
      }
      bar.style.height = `${height}px`;
    });
    _timers.waveform = requestAnimationFrame(tick);
  }

  _timers.waveform = requestAnimationFrame(tick);
}

function stopWaveformLoop() {
  if (_timers.waveform) {
    cancelAnimationFrame(_timers.waveform);
    _timers.waveform = null;
  }
  // Barları sıfırla
  document.querySelectorAll('.wf-bar').forEach((bar) => {
    bar.style.height = '4px';
  });
}

/* ──────────────────────────────────────────────────────────────────────────
   BÖLÜM 8 — NEFES (BREATHING) DÖNGÜSÜ
────────────────────────────────────────────────────────────────────────── */

/**
 * 4-7-8 veya mood'a özgü nefes döngüsünü başlatır.
 * @param {{ inhale: number, hold: number, exhale: number, label: string }} pattern
 */
function startBreathCycle(pattern) {
  stopBreathCycle();
  _breathActive = true;

  const bCore  = document.getElementById('b-core');
  const guide  = document.getElementById('breath-guide');

  /**
   * Her aşamayı sırayla çalıştıran recursive setTimeout zinciri.
   * setInterval yerine setTimeout kullanılır; gecikme sürüklenmesi engellenir.
   */
  function runPhase(phase) {
    if (!_breathActive) return;

    switch (phase) {
      case 'inhale':
        if (guide) guide.textContent = `Nefes Al — ${pattern.inhale} saniye`;
        if (bCore) {
          bCore.style.transition = `transform ${pattern.inhale}s ease-in-out`;
          bCore.style.transform  = 'scale(1.35)';
        }
        _timers.breathLoop = setTimeout(() => runPhase('hold'), pattern.inhale * 1000);
        break;

      case 'hold':
        if (pattern.hold > 0) {
          if (guide) guide.textContent = `Tut — ${pattern.hold} saniye`;
          if (bCore) {
            bCore.style.transition = `transform 0.3s ease`;
            bCore.style.transform  = 'scale(1.35)';
          }
          _timers.breathLoop = setTimeout(() => runPhase('exhale'), pattern.hold * 1000);
        } else {
          runPhase('exhale');
        }
        break;

      case 'exhale':
        if (guide) guide.textContent = `Nefes Ver — ${pattern.exhale} saniye`;
        if (bCore) {
          bCore.style.transition = `transform ${pattern.exhale}s ease-in-out`;
          bCore.style.transform  = 'scale(1)';
        }
        _timers.breathLoop = setTimeout(() => runPhase('inhale'), pattern.exhale * 1000);
        break;
    }
  }

  runPhase('inhale');
}

function stopBreathCycle() {
  _breathActive = false;
  if (_timers.breathLoop) {
    clearTimeout(_timers.breathLoop);
    _timers.breathLoop = null;
  }
  const guide = document.getElementById('breath-guide');
  if (guide) guide.textContent = 'Hazır olduğunda butona dokun';

  const bCore = document.getElementById('b-core');
  if (bCore) {
    bCore.style.transition = 'transform 0.5s ease';
    bCore.style.transform  = 'scale(1)';
  }
}

function updateBreathGuide(text) {
  const guide = document.getElementById('breath-guide');
  // Sadece nefes aktif değilken güncelle
  if (guide && !_breathActive) {
    guide.textContent = text || 'Hazır olduğunda butona dokun';
  }
}

/* ──────────────────────────────────────────────────────────────────────────
   BÖLÜM 9 — UYKU ZAMANLAYICI
────────────────────────────────────────────────────────────────────────── */

/**
 * Uyku zamanlayıcısını başlatır.
 * @param {number} minutes
 */
window.setSleepTimer = function setSleepTimer(minutes) {
  // StateManager zamanlayıcıyı yönetir; süresi dolunca onExpire callback'i çalışır
  state.setSleepTimer(minutes, async () => {
    // Zamanlayıcı sona erdi → sesi kapat
    await engine.fadeOutAll(4);
    await engine.pause();
    state.setPlaying(false);
    stopBreathCycle();

    const statusEl = document.getElementById('stimer-status');
    if (statusEl) statusEl.textContent = 'İyi geceler 🌙';
  });

  // Aktif butonu vurgula
  document.querySelectorAll('.stimer-btn').forEach((btn) => {
    btn.classList.remove('active');
    if (parseInt(btn.textContent) === minutes) btn.classList.add('active');
  });
};

window.cancelSleepTimer = function cancelSleepTimer() {
  state.cancelSleepTimer();

  document.querySelectorAll('.stimer-btn').forEach((btn) => btn.classList.remove('active'));
  const statusEl = document.getElementById('stimer-status');
  if (statusEl) statusEl.textContent = '';
};

/** setInterval ile her saniye kalan süreyi ekranda günceller */
function startSleepCountdownUI() {
  stopSleepCountdownUI();

  _timers.sleepCountdown = setInterval(() => {
    const remaining = state.getRemainingTimerSeconds();
    const statusEl  = document.getElementById('stimer-status');
    if (!statusEl) return;

    if (remaining <= 0) {
      stopSleepCountdownUI();
      return;
    }

    const m = Math.floor(remaining / 60).toString().padStart(2, '0');
    const s = (remaining % 60).toString().padStart(2, '0');
    statusEl.textContent = `⏱ ${m}:${s}`;
  }, 1000);
}

function stopSleepCountdownUI() {
  if (_timers.sleepCountdown) {
    clearInterval(_timers.sleepCountdown);
    _timers.sleepCountdown = null;
  }
}

/* ──────────────────────────────────────────────────────────────────────────
   BÖLÜM 10 — EKRAN GEÇİŞLERİ
────────────────────────────────────────────────────────────────────────── */

/**
 * Hedef ekranı 'on' yapar, diğerlerini 'off' yapar.
 * @param {string} screenId
 */
function switchScreen(screenId) {
  document.querySelectorAll('.screen').forEach((s) => {
    s.className = s.id === screenId ? 'screen on' : 'screen off';
  });
  window.scrollTo(0, 0);
}

window.goBack = function goBack() {
  const current = document.querySelector('.screen.on');
  if (current?.id === 'screen-analytics') {
    switchScreen('screen-sanctuary');
  } else {
    // Sanctuary → Mood ekranına dön
    if (engine.isPlaying) {
      engine.pause().then(() => state.setPlaying(false));
      stopBreathCycle();
    }
    const session = state.endSession();
    if (session) saveSessionToStorage(session);
    switchScreen('screen-mood');
  }
};

window.showAnalytics = function showAnalytics() {
  renderAnalytics();
  switchScreen('screen-analytics');
};

/* ──────────────────────────────────────────────────────────────────────────
   BÖLÜM 11 — HP BANNER
────────────────────────────────────────────────────────────────────────── */

window.dismissBanner = function dismissBanner() {
  state.setBannerDismissed(true);
  const banner = document.getElementById('hp-banner');
  if (banner) banner.style.display = 'none';
};

/* ──────────────────────────────────────────────────────────────────────────
   BÖLÜM 12 — PREMIUM SESLER (Premium Sounds Grid)
────────────────────────────────────────────────────────────────────────── */

function renderPremiumSounds() {
  const grid = document.getElementById('premium-sounds-grid');
  if (!grid) return;

  grid.innerHTML = '';
  PREMIUM_SOUNDS.forEach((sound) => {
    const { allowed } = state.checkContentAccess(sound.id);
    const card = document.createElement('div');
    card.className = `s-sound-card${allowed ? '' : ' locked'}`;
    card.innerHTML = `
      <span class="s-sound-ic">${sound.icon}</span>
      <span class="s-sound-nm">${sound.name}</span>
      <span class="s-sound-sub">${sound.sub}</span>
      ${!allowed ? '<span class="s-sound-lock">🔒</span>' : ''}
    `;
    card.addEventListener('click', () => {
      if (!allowed) {
        openPaywall();
      } else {
        loadPremiumSound(sound.id);
      }
    });
    grid.appendChild(card);
  });

  if (typeof window.revealPremiumSounds === 'function') {
    window.revealPremiumSounds();
  }
}

async function loadPremiumSound(soundId) {
  const script = buildPremiumScript(soundId);
  if (!script) return;

  if (!engine.isInitialized) await engine.initialize();
  await engine.loadScript(script, { crossfade: true });
  if (!engine.isPlaying) {
    await engine.play();
    state.setPlaying(true);
  }
}

function buildPremiumScript(soundId) {
  const scripts = {
    binaural_beats:   { scene: 'binaural_beats',   tracks: [{ id: 'binaural', type: 'granular', generator: 'binaural', parameters: { volume: 0.6, baseFreq: 200, beatFreq: 40 } }], mix: { masterVolume: 0.8 } },
    uyku_hipnozu:     { scene: 'uyku_hipnozu',      tracks: [{ id: 'binaural', type: 'granular', generator: 'binaural', parameters: { volume: 0.55, baseFreq: 180, beatFreq: 3 } }, { id: 'wind', type: 'granular', generator: 'wind', parameters: { volume: 0.4 } }], mix: { masterVolume: 0.75 } },
    aktif_meditasyon: { scene: 'aktif_meditasyon',  tracks: [{ id: 'binaural', type: 'granular', generator: 'binaural', parameters: { volume: 0.5, baseFreq: 200, beatFreq: 8 } }, { id: 'waves', type: 'granular', generator: 'waves', parameters: { volume: 0.5 } }], mix: { masterVolume: 0.8 } },
    derin_odak_pro:   { scene: 'derin_odak_pro',    tracks: [{ id: 'binaural', type: 'granular', generator: 'binaural', parameters: { volume: 0.6, baseFreq: 200, beatFreq: 14 } }, { id: 'fire', type: 'granular', generator: 'fire', parameters: { volume: 0.3 } }], mix: { masterVolume: 0.8 } },
  };
  return scripts[soundId] || null;
}

/* ──────────────────────────────────────────────────────────────────────────
   BÖLÜM 13 — AI ORACLE
────────────────────────────────────────────────────────────────────────── */

window.generateAIFreq = async function generateAIFreq() {
  const input  = document.getElementById('ai-input');
  const result = document.getElementById('ai-result');
  const text   = document.getElementById('ai-result-text');
  const freq   = document.getElementById('ai-result-freq');
  const btn    = document.getElementById('ai-generate-btn');
  const proc   = document.getElementById('ai-processing');

  if (!input?.value.trim()) return;

  const apiKey = state.get('apiKey');

  // Processing overlay
  if (proc) proc.style.display = 'flex';
  if (btn)  btn.disabled = true;

  try {
    let oracleMessage = '';
    let freqRec = '';

    if (apiKey) {
      // Gerçek API çağrısı
      const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${apiKey}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [{ text: `Sen Sanctuary uygulamasının AI Oracle'ısın. Kullanıcı şunu söylüyor: "${input.value}". Kısa, teselli edici bir mesaj ver ve hangi ses frekansının yardımcı olacağını öner (Hz değeri ile). Türkçe yanıtla.` }] }],
        }),
      });
      const data = await res.json();
      oracleMessage = data?.candidates?.[0]?.content?.parts?.[0]?.text || fallbackOracle(input.value);
      freqRec = extractFreqFromText(oracleMessage);
    } else {
      // API key yoksa fallback
      oracleMessage = fallbackOracle(input.value);
      freqRec = '432 Hz — Evrensel Uyum';
    }

    if (text)   text.textContent  = oracleMessage;
    if (freq)   freq.textContent  = `🎵 Önerilen: ${freqRec}`;
    if (result) result.style.display = 'block';

  } catch (err) {
    console.warn('[main] AI Oracle hatası:', err);
    if (text) text.textContent = fallbackOracle(input.value);
    if (result) result.style.display = 'block';
  } finally {
    if (proc) proc.style.display = 'none';
    if (btn)  btn.disabled = false;
  }
};

function fallbackOracle(input) {
  const lower = input.toLowerCase();
  if (lower.includes('kaygı') || lower.includes('endişe') || lower.includes('korku')) {
    return 'Kaygın, seni korumaya çalışıyor. Şu an güvendesin. 528 Hz frekansı zihnini yumuşatacak.';
  }
  if (lower.includes('yorgun') || lower.includes('uyku')) {
    return 'Bedenin dinlenmeyi hak ediyor. 396 Hz ile derin bir uyku yolculuğuna çık.';
  }
  if (lower.includes('mutsuz') || lower.includes('üzgün')) {
    return 'Hislerin geçerli. 417 Hz dönüşüm frekansı kalp ağırlığını hafifletir.';
  }
  return 'İçinden geçenler değerli. 432 Hz evrensel uyum frekansı şu an en iyi eşlikçin.';
}

function extractFreqFromText(text) {
  const match = text.match(/(\d{3,4})\s*Hz/i);
  return match ? `${match[1]} Hz` : '432 Hz — Evrensel Uyum';
}

/* ──────────────────────────────────────────────────────────────────────────
   BÖLÜM 14 — ANALİTİK
────────────────────────────────────────────────────────────────────────── */

function saveSessionToStorage(session) {
  try {
    const sessions = JSON.parse(localStorage.getItem('sanctuary:sessions') || '[]');
    sessions.push(session);
    // Son 90 seans sakla
    if (sessions.length > 90) sessions.splice(0, sessions.length - 90);
    localStorage.setItem('sanctuary:sessions', JSON.stringify(sessions));
  } catch { /* yoksay */ }
}

function loadSessions() {
  try {
    return JSON.parse(localStorage.getItem('sanctuary:sessions') || '[]');
  } catch { return []; }
}

function renderAnalytics() {
  const sessions = loadSessions();
  const totalMin = Math.floor(sessions.reduce((acc, s) => acc + (s.duration || 0), 0) / 60);

  // Streak hesapla
  const streak = calculateStreak(sessions);

  const sessEl  = document.getElementById('stat-sessions');
  const minEl   = document.getElementById('stat-minutes');
  const strEl   = document.getElementById('stat-streak');

  if (sessEl) sessEl.textContent = sessions.length;
  if (minEl)  minEl.textContent  = totalMin;
  if (strEl)  strEl.textContent  = streak;

  // Son 7 günlük canvas grafiği
  renderAnalyticsChart(sessions);

  // Mood log listesi
  renderMoodLog(sessions);
}

function calculateStreak(sessions) {
  if (!sessions.length) return 0;
  const days = new Set(sessions.map((s) => new Date(s.date || 0).toDateString()));
  let streak = 0;
  const today = new Date();
  for (let i = 0; i < 365; i++) {
    const d = new Date(today);
    d.setDate(today.getDate() - i);
    if (days.has(d.toDateString())) { streak++; } else break;
  }
  return streak;
}

function renderAnalyticsChart(sessions) {
  const canvas = document.getElementById('analytics-canvas');
  if (!canvas) return;
  const ctx2d = canvas.getContext('2d');
  const W = canvas.offsetWidth || 300;
  const H = 120;
  canvas.width = W;

  // Son 7 gün
  const days = Array.from({ length: 7 }, (_, i) => {
    const d = new Date();
    d.setDate(d.getDate() - (6 - i));
    return d.toDateString();
  });

  const counts = days.map((d) =>
    sessions.filter((s) => new Date(s.date || 0).toDateString() === d).length
  );

  const max   = Math.max(...counts, 1);
  const barW  = (W - 20) / 7;
  const pad   = 10;

  ctx2d.clearRect(0, 0, W, H);

  days.forEach((d, i) => {
    const barH = (counts[i] / max) * (H - 30);
    const x    = pad + i * barW + barW * 0.2;
    const y    = H - 20 - barH;

    const grad = ctx2d.createLinearGradient(0, y, 0, H - 20);
    grad.addColorStop(0, 'rgba(201,169,110,0.9)');
    grad.addColorStop(1, 'rgba(201,169,110,0.2)');

    ctx2d.fillStyle = grad;
    ctx2d.beginPath();
    ctx2d.roundRect(x, y, barW * 0.6, barH, 4);
    ctx2d.fill();

    // Gün etiketi
    ctx2d.fillStyle = 'rgba(255,255,255,0.4)';
    ctx2d.font = '9px -apple-system, sans-serif';
    ctx2d.textAlign = 'center';
    const label = ['Pz', 'Pt', 'Sa', 'Ça', 'Pe', 'Cu', 'Ct'][new Date(d).getDay()];
    ctx2d.fillText(label, x + barW * 0.3, H - 5);
  });
}

function renderMoodLog(sessions) {
  const list = document.getElementById('mood-log-list');
  if (!list) return;

  const recent = sessions.slice(-10).reverse();
  list.innerHTML = recent.length
    ? recent.map((s) => {
        const moodData = MOOD_CATALOG[s.mood] || { emoji: '🌿', label: s.mood || 'Bilinmiyor' };
        const dur = s.duration ? `${Math.floor(s.duration / 60)} dk` : '—';
        const date = s.date ? new Date(s.date).toLocaleDateString('tr-TR', { day: 'numeric', month: 'short' }) : '';
        return `<div class="mood-log-item">
          <span class="ml-emoji">${moodData.emoji}</span>
          <span class="ml-mood">${moodData.label}</span>
          <span class="ml-dur">${dur}</span>
          <span class="ml-date">${date}</span>
        </div>`;
      }).join('')
    : '<p style="opacity:0.4;text-align:center;padding:20px 0;">Henüz oturum yok</p>';
}

window.clearData = function clearData() {
  if (!confirm('Tüm veriler silinecek. Emin misin?')) return;
  try { localStorage.removeItem('sanctuary:sessions'); } catch { }
  state.clearPersistedState().then(() => renderAnalytics());
};

/* ──────────────────────────────────────────────────────────────────────────
   BÖLÜM 15 — PAYWALL & SATIN ALMA
────────────────────────────────────────────────────────────────────────── */

function openPaywall() {
  const overlay = document.getElementById('paywall-overlay');
  if (overlay) overlay.style.display = 'flex';
}

window.closePaywall = function closePaywall() {
  const overlay = document.getElementById('paywall-overlay');
  if (overlay) overlay.style.display = 'none';
};

window.selectPlan = function selectPlan(el) {
  document.querySelectorAll('.pw-plan').forEach((p) => p.classList.remove('sel'));
  el.classList.add('sel');
  updateTrialState();
};

window.updateTrialState = function updateTrialState() {
  const toggle  = document.getElementById('pw-trial-toggle');
  const ctaBtn  = document.getElementById('pw-cta-btn');
  const ctaNote = document.getElementById('pw-cta-note');
  const plan    = document.querySelector('.pw-plan.sel')?.dataset?.plan || 'yearly';
  const trial   = toggle?.checked;

  const prices = { monthly: '$9.99/ay', yearly: '$59.99/yıl', lifetime: '$199' };

  if (ctaBtn) ctaBtn.textContent = trial ? 'Ücretsiz Dene — 7 Gün' : `Şimdi Al — ${prices[plan] || ''}`;
  if (ctaNote) {
    ctaNote.textContent = trial
      ? `Deneme bittikten sonra ${prices[plan] || ''} olarak faturalandırılır.`
      : 'İstediğin zaman iptal edebilirsin.';
  }
};

window.handlePurchase = function handlePurchase() {
  // Gerçek uygulamada: App Store / Play Store satın alma akışı başlatılır.
  // Burada mock olarak premium aktif edilir.
  const plan = document.querySelector('.pw-plan.sel')?.dataset?.plan === 'lifetime' ? 'pro' : 'basic';
  try {
    state.setPremiumStatus({
      plan,
      billingCycle: 'yearly',
      receiptToken: 'mock_token_' + Date.now(),
    });
    renderPremiumSounds();
    closePaywall();
    alert('🎉 Sanctuary Premium aktif edildi!');
  } catch (err) {
    console.warn('[main] Premium aktivasyon hatası:', err);
  }
};

window.restorePurchase = function restorePurchase() {
  alert('Satın alım geri yükleme: Gerçek uygulamada App Store/Play Store sorgulanır.');
};

/* ──────────────────────────────────────────────────────────────────────────
   BÖLÜM 16 — SAĞLIK UYGULAMASI VERİSİ
────────────────────────────────────────────────────────────────────────── */

window.exportHealth = function exportHealth() {
  const sessions = loadSessions();
  const healthData = sessions.map((s) => ({
    type:      'HKCategoryTypeIdentifierMindfulSession',
    startDate: s.date,
    endDate:   new Date(new Date(s.date).getTime() + (s.duration || 0) * 1000).toISOString(),
    value:     'HKCategoryValueMindfulSessionTypeUnspecified',
    metadata:  { mood: s.mood, scene: s.scene },
  }));

  const jsonEl = document.getElementById('health-json-content');
  if (jsonEl) jsonEl.textContent = JSON.stringify({ HealthData: healthData }, null, 2);

  const modal = document.getElementById('health-modal');
  if (modal) modal.style.display = 'flex';
};

window.closeHealthModal = function closeHealthModal(e) {
  if (!e || e.target === document.getElementById('health-modal')) {
    document.getElementById('health-modal').style.display = 'none';
  }
};

window.copyHealthData = function copyHealthData() {
  const text = document.getElementById('health-json-content')?.textContent;
  if (text) navigator.clipboard?.writeText(text).then(() => alert('Kopyalandı!'));
};

/* ──────────────────────────────────────────────────────────────────────────
   BÖLÜM 17 — YASAL UYARI
────────────────────────────────────────────────────────────────────────── */

window.acceptDisclaimer = function acceptDisclaimer() {
  const disc = document.getElementById('legal-disclaimer');
  if (disc) disc.style.display = 'none';
  localStorage.setItem('sanctuary:disclaimer', '1');
};

function checkDisclaimer() {
  if (!localStorage.getItem('sanctuary:disclaimer')) {
    const disc = document.getElementById('legal-disclaimer');
    if (disc) disc.style.display = 'flex';
  }
}

/* ──────────────────────────────────────────────────────────────────────────
   BÖLÜM 18 — PWA INSTALL
────────────────────────────────────────────────────────────────────────── */

let _deferredPrompt = null;

window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  _deferredPrompt = e;
  const banner = document.getElementById('pwa-banner');
  if (banner) banner.style.display = 'flex';
});

window.triggerPWAInstall = async function triggerPWAInstall() {
  if (!_deferredPrompt) return;
  _deferredPrompt.prompt();
  await _deferredPrompt.userChoice;
  _deferredPrompt = null;
  dismissPWABanner();
};

window.dismissPWABanner = function dismissPWABanner() {
  const banner = document.getElementById('pwa-banner');
  if (banner) banner.style.display = 'none';
};

/* ──────────────────────────────────────────────────────────────────────────
   BÖLÜM 19 — YARDIMCI FONKSIYONLAR
────────────────────────────────────────────────────────────────────────── */

/* ── ODA SİSTEMİ KÖPRÜ FONKSİYONLARI ─────────────────────────────────────
   RoomManager ↔ main-room-additions.js arasındaki gerçek veri köprüsü.
   HTML inline handler'lar window.loadRooms ve window.joinRoom'u çağırır.
────────────────────────────────────────────────────────────────────────── */

/**
 * Herkese açık odaları RoomManager'dan çeker ve renderRooms'a iletir.
 * localStorage'da kayıtlı oda yoksa mock seed odaları enjekte eder
 * (geliştirme / demo modu için).
 * @param {string|null} [category] — opsiyonel kategori filtresi
 */
async function loadRooms(category = null) {
  let rooms = RoomManager.getPublicRooms(category);

  // Gerçek oda yoksa demo seed'leri göster (production'da kaldırın)
  if (rooms.length === 0) {
    rooms = [
      { id: 'r1', name: 'Derin Uyku Seansı 🌙', category: 'uyku',       lang: 'tr', type: 'public', hostName: 'Ayşe K.',  current: 4, capacity: 8  },
      { id: 'r2', name: 'Focus Flow · Lo-fi',    category: 'odak',       lang: 'en', type: 'public', hostName: 'Max R.',   current: 2, capacity: 10 },
      { id: 'r3', name: 'Sabah Meditasyonu ☀️',  category: 'meditasyon', lang: 'tr', type: 'public', hostName: 'Mert S.',  current: 3, capacity: 6  },
    ].map(seed => ({
      ...seed,
      participants: Array.from({ length: seed.current }, (_, i) => `mock_user_${i}`),
      isActive: true,
      createdAt: Date.now(),
      hostId: `host_${seed.id}`,
      password: null,
    }));
  }

  renderRooms(rooms);
  return rooms;
}

/**
 * Oda katılım köprüsü — RoomManager.joinRoom() çağrısı yapar.
 * Katılım başarılıysa StateManager üzerinden activeMood sync'lenir.
 * @param {string} roomId
 * @param {string|null} [password]
 */
window.joinRoom = function joinRoom(roomId, password = null) {
  // currentUser mock (gerçek auth entegre edilene kadar)
  const user = state.get('currentUser') || { id: 'guest_' + Date.now(), isPremium: false };

  // State'e geçici kullanıcı yaz (RoomManager._currentUser() için)
  if (!state.get('currentUser')) {
    try { state.set('currentUser', user); } catch { /* yoksay */ }
  }

  const result = RoomManager.joinRoom(roomId, password);

  if (result.success) {
    console.info('[main] Odaya katılındı:', roomId);
    // Aktif mood'u state üzerinden tüm modüllere yansıt
    const currentMood = window._activeMood || state.get('activeMood') || 'Sakin';
    try { state.set('activeMood', currentMood); } catch { /* yoksay */ }
  } else {
    console.warn('[main] Odaya katılım başarısız:', result.error);
    showFallbackNotice(result.error || 'Odaya katılınamadı.');
  }
};

function showFallbackNotice(msg) {
  const notice = document.getElementById('fallback-notice');
  const text   = document.getElementById('fallback-notice-text');
  if (text)   text.textContent = msg || 'Default Zen modu aktif — 432 Hz';
  if (notice) {
    notice.style.display = 'flex';
    setTimeout(() => { if (notice) notice.style.display = 'none'; }, 4000);
  }
}

/* ──────────────────────────────────────────────────────────────────────────
   BÖLÜM 20 — BAŞLATMA (DOMContentLoaded)
────────────────────────────────────────────────────────────────────────── */

async function init() {
  try {
    // 1. StateManager'ı hydrate et (localStorage'dan önceki state'i geri yükle)
    await state.hydrate();

    // 2. Reaktif UI binding'leri kur
    setupStateBindings();

    // 3. Banner önceki oturumda kapatıldıysa gizle
    if (state.get('bannerDismissed')) {
      const banner = document.getElementById('hp-banner');
      if (banner) banner.style.display = 'none';
    }

    // 4. Son seçilen mood'u (varsa) geri yükle
    const savedScene = state.get('currentScene');
    const restoredMood = Object.keys(MOOD_CATALOG).find(
      (k) => MOOD_CATALOG[k].scene === savedScene
    );
    if (restoredMood) {
      const chip = document.querySelector(`.mood-chip[data-mood="${restoredMood}"]`);
      if (chip) chip.classList.add('active');
      window._activeMood = restoredMood;
    }

    // 5. Son açılış tarihini güncelle
    state.setLastOpenDate();

    // 6. Premium sesler grid'ini render et
    renderPremiumSounds();

    // 7. AudioEngine'i kullanıcı etkileşimi için hazır tut (initialize çağrılmaz;
    //    initialize() ilk togglePlay() veya loadScript() çağrısında tetiklenir)
    engine.on('initialized', () => {
      console.info('[main] AudioEngine hazır');
    });

    engine.on('play',  () => console.info('[main] Ses oynatılıyor'));
    engine.on('pause', () => console.info('[main] Ses duraklatıldı'));
    engine.on('stop',  (info) => {
      if (info?.duration) saveSessionToStorage({ ...state.endSession?.() || {}, ...info });
    });

    // 8. Yasal uyarıyı kontrol et
    checkDisclaimer();

    // 9. Oda sistemini başlat — RoomManager UI bağlantıları ve ilk oda yüklemesi
    await initRoomUI();

    // 10. Skeleton reveal — tüm sistemler hazır
    if (typeof window.revealContent === 'function') {
      window.revealContent();
    } else {
      // Fallback: manuel reveal
      const sk   = document.getElementById('mood-grid-skeleton');
      const grid = document.getElementById('mood-grid');
      if (sk)   sk.style.display   = 'none';
      if (grid) grid.style.display = 'grid';
    }

    /* ── Oda UI olaylarını main-room-additions.js'e delege et ────────────────
       openCreateModal, closeCreateModal ve joinRoom fonksiyonları
       import edilmiş veya köprülenmiş olup window.* aracılığıyla
       HTML inline handler'larına açılır.
       loadRooms: RoomManager.getPublicRooms() köprüsü (BÖLÜM 19'da tanımlı)
       Bu sayede main.js oda mantığından tamamen ayrışır.
    ───────────────────────────────────────────────────────────────────────── */
    window.openCreateModal  = openCreateModal;
    window.closeCreateModal = closeCreateModal;
    window.loadRooms        = loadRooms;   // BÖLÜM 19'daki RoomManager köprüsü

    console.info('[main] Sanctuary başlatıldı ✓');

  } catch (err) {
    console.error('[main] Başlatma hatası:', err);
    showFallbackNotice('Sistem başlatılırken bir hata oluştu.');
  }
}

// DOM hazır olduğunda başlat
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}

// Uygulama kapanırken kaynakları temizle
window.addEventListener('beforeunload', () => {
  stopBreathCycle();
  stopSleepCountdownUI();
  stopWaveformLoop();
  engine.dispose().catch(() => {});
  state.dispose();
});
/* ============================================================
   SANCTUARY — Digital Detox (Cooldown Mode)
   EKLEME YERİ: main.js dosyasının EN SONUNA yapıştır
   (window.addEventListener('beforeunload',...) bloğunun hemen ardından)

   BAĞIMLILIKLAR (main.js ile tam uyumlu):
   - state  : getStateManager() ile oluşturulmuş StateManager örneği
   - engine : AudioEngine.getInstance() ile oluşturulmuş AudioEngine örneği
   Her ikisi de bu dosyada zaten tanımlı; window.* ataması gerekmez.
   ============================================================ */

(function () {
  'use strict';

  /* ──────────────────────────────────────────────
     0. Güvenli Yardımcılar
  ────────────────────────────────────────────── */
  const $ = (sel, ctx = document) => ctx.querySelector(sel);
  const log = (...args) => console.log('[Detox]', ...args);

  /* ──────────────────────────────────────────────
     1. Yapılandırma
  ────────────────────────────────────────────── */
  const CONFIG = {
    DETOX_DURATION_SEC : 5 * 60,   // Varsayılan: 5 dakika (saniye)
    LONG_PRESS_MS      : 3000,     // Çıkış için basılı tutma süresi
    TARGET_FREQ_HZ     : 9,        // Alpha/Theta: 9 Hz
    NATURE_VOLUME_MAX  : 0.15,
    PARTICLE_COUNT     : 22,
    MESSAGES: [
      'Dijital dünyadan uzaklaş ve nefesine odaklan.',
      'Şu an burada olman yeterli.',
      'Her nefes, bir yeni başlangıç.',
      'Zihnin dinlenmeyi hak ediyor.',
      'Sessizlik de bir sestir.',
    ],
  };

  /* Detoks sahne scripti — engine.loadScript() formatına uygun */
  const DETOX_SCENE_SCRIPT = {
    scene: 'detox_deep',
    tracks: [
      { id: 'rain',     type: 'granular', generator: 'rain',     parameters: { volume: 0.35 } },
      { id: 'binaural', type: 'granular', generator: 'binaural', parameters: { volume: 0.45, baseFreq: 200, beatFreq: CONFIG.TARGET_FREQ_HZ } },
    ],
    mix: { masterVolume: 0.35, trackVolumes: [0.35, 0.45] },
  };

  /* ──────────────────────────────────────────────
     2. DOM Referansları
  ────────────────────────────────────────────── */
  const DOM = {
    trigger      : $('#cooldownTrigger'),
    overlay      : $('#detoxOverlay'),
    particles    : $('#detoxParticles'),
    breathPhase  : $('#breathPhase'),
    timerDisplay : $('#detoxTimerDisplay'),
    timerFill    : $('#detoxTimerFill'),
    message      : $('#detoxMessage'),
    exitBtn      : $('#detoxExitBtn'),
    exitProgress : $('#detoxExitProgress'),
  };

  /* ──────────────────────────────────────────────
     3. Dahili Durum
  ────────────────────────────────────────────── */
  const _ds = {
    isActive        : false,
    remainingSec    : CONFIG.DETOX_DURATION_SEC,
    timerInterval   : null,
    breathInterval  : null,
    msgInterval     : null,
    longPressStart  : null,
    rafId           : null,
    prevMasterVol   : null,
    prevFreq        : null,
    wasPlaying      : false,
  };

  /* ──────────────────────────────────────────────
     4. StateManager Köprüsü
     main.js'deki `state` nesnesini kullanır.
     StateManager henüz yüklenmemişse güvenle atlar.
  ────────────────────────────────────────────── */
  function _stateSet(key, value) {
    try {
      if (typeof state !== 'undefined' && typeof state.set === 'function') {
        state.set(key, value);
        log('StateManager →', key, ':', value);
      }
    } catch (e) {
      log('StateManager yazma hatası (yoksayıldı):', e);
    }
  }

  function _stateGet(key) {
    try {
      if (typeof state !== 'undefined' && typeof state.get === 'function') {
        return state.get(key);
      }
    } catch { /* yoksay */ }
    return undefined;
  }

  /* ──────────────────────────────────────────────
     5. Low-Power Mode
  ────────────────────────────────────────────── */
  function enableLowPower() {
    document.documentElement.classList.add('low-power');
    log('Low-power: ON');
  }

  function disableLowPower() {
    document.documentElement.classList.remove('low-power');
    log('Low-power: OFF');
  }

  /* ──────────────────────────────────────────────
     6. AudioEngine Köprüsü
     main.js'deki `engine` (AudioEngine.getInstance()) kullanılır.
     engine henüz başlatılmamışsa initialize() çağrılır.
     engine yoksa tüm ses işlemleri sessizce atlanır.
  ────────────────────────────────────────────── */
  async function audioDetoxEnter() {
    try {
      if (typeof engine === 'undefined' || !engine) return;

      // AudioContext henüz başlatılmamışsa başlat
      if (!engine.isInitialized) {
        await engine.initialize();
      }

      // Önceki durumu sakla
      _ds.wasPlaying = !!engine.isPlaying;
      _ds.prevMasterVol = typeof engine.getMasterVolume === 'function'
        ? engine.getMasterVolume()
        : null;

      // Mevcut frekansı sakla (varsa)
      if (typeof engine.getFrequency === 'function') {
        _ds.prevFreq = engine.getFrequency();
      }

      // Detoks sahnesini yükle (crossfade ile)
      await engine.loadScript(DETOX_SCENE_SCRIPT, { crossfade: true });

      // Oynatmayı başlat (yoksa)
      if (!engine.isPlaying) await engine.play();

      // Master ses seviyesini detoks moduna indir
      if (typeof engine.setMasterVolume === 'function') {
        engine.setMasterVolume(0.35);
      }

      // Frekansı 9 Hz'e çek (varsa)
      if (typeof engine.setFrequency === 'function') {
        engine.setFrequency(CONFIG.TARGET_FREQ_HZ);
      } else if (typeof engine.setBinauralFrequency === 'function') {
        engine.setBinauralFrequency(CONFIG.TARGET_FREQ_HZ);
      }

      // Doğa ses kanalını düşür (varsa)
      if (typeof engine.fadeVolumeTo === 'function') {
        engine.fadeVolumeTo('nature', CONFIG.NATURE_VOLUME_MAX, 3000);
      }

      log('AudioEngine → detox sahne yüklendi (9 Hz, master 0.35)');
    } catch (e) {
      log('AudioEngine detox giriş hatası (yoksayıldı):', e);
    }
  }

  async function audioDetoxExit() {
    try {
      if (typeof engine === 'undefined' || !engine) return;

      // Oynatmayı durdur
      if (engine.isPlaying) await engine.pause();

      // Önceki mood sahnesini geri yükle
      const activeMood = window._activeMood || 'Sakin';
      const prevScript = MOOD_CATALOG?.[activeMood]?.script;
      if (prevScript) {
        await engine.loadScript(prevScript, { crossfade: true });
        if (_ds.wasPlaying) await engine.play();
      }

      // Ses seviyesini geri al
      if (_ds.prevMasterVol !== null && typeof engine.setMasterVolume === 'function') {
        engine.setMasterVolume(_ds.prevMasterVol);
      }

      // Frekansı geri al
      if (_ds.prevFreq !== null) {
        if (typeof engine.setFrequency === 'function') {
          engine.setFrequency(_ds.prevFreq);
        } else if (typeof engine.setBinauralFrequency === 'function') {
          engine.setBinauralFrequency(_ds.prevFreq);
        }
      }

      // Doğa ses kanalını geri al
      if (typeof engine.fadeVolumeTo === 'function') {
        engine.fadeVolumeTo('nature', 0.7, 3000);
      }

      log('AudioEngine → önceki sahneye dönüldü');
    } catch (e) {
      log('AudioEngine detox çıkış hatası (yoksayıldı):', e);
    }
  }

  /* ──────────────────────────────────────────────
     7. Parçacık Arka Planı
  ────────────────────────────────────────────── */
  function createParticles() {
    if (!DOM.particles) return;
    DOM.particles.innerHTML = '';
    for (let i = 0; i < CONFIG.PARTICLE_COUNT; i++) {
      const p = document.createElement('div');
      p.className = 'detox-particle';
      p.style.cssText = `
        left: ${Math.random() * 100}%;
        width: ${1 + Math.random() * 3}px;
        height: ${1 + Math.random() * 3}px;
        animation-duration: ${8 + Math.random() * 18}s;
        animation-delay: ${Math.random() * 15}s;
        opacity: ${0.1 + Math.random() * 0.3};
      `;
      DOM.particles.appendChild(p);
    }
  }

  /* ──────────────────────────────────────────────
     8. Nefes Döngüsü
  ────────────────────────────────────────────── */
  const BREATH_PHASES = [
    { label: 'Nefes Al',  duration: 4000 },
    { label: 'Tut',        duration: 1000 },
    { label: 'Nefes Ver', duration: 4000 },
    { label: 'Tut',        duration: 1000 },
  ];

  function startDetoxBreathCycle() {
    let idx = 0;
    function nextPhase() {
      if (!_ds.isActive) return;
      const phase = BREATH_PHASES[idx % BREATH_PHASES.length];
      if (DOM.breathPhase) {
        DOM.breathPhase.style.opacity = '0';
        setTimeout(() => {
          if (DOM.breathPhase) {
            DOM.breathPhase.textContent = phase.label;
            DOM.breathPhase.style.opacity = '1';
          }
        }, 300);
      }
      idx++;
      _ds.breathInterval = setTimeout(nextPhase, phase.duration);
    }
    nextPhase();
  }

  function stopDetoxBreathCycle() {
    clearTimeout(_ds.breathInterval);
  }

  /* ──────────────────────────────────────────────
     9. Geri Sayım Sayacı
  ────────────────────────────────────────────── */
  function formatTime(sec) {
    const m = String(Math.floor(sec / 60)).padStart(2, '0');
    const s = String(sec % 60).padStart(2, '0');
    return `${m}:${s}`;
  }

  function updateDetoxTimer() {
    if (!_ds.isActive) return;
    const ratio = _ds.remainingSec / CONFIG.DETOX_DURATION_SEC;
    if (DOM.timerDisplay) DOM.timerDisplay.textContent = formatTime(_ds.remainingSec);
    if (DOM.timerFill)    DOM.timerFill.style.transform = `scaleX(${ratio})`;

    if (_ds.remainingSec <= 0) { endDetox(true); return; }
    _ds.remainingSec--;
  }

  function startDetoxTimer() {
    _ds.remainingSec = CONFIG.DETOX_DURATION_SEC;
    updateDetoxTimer();
    _ds.timerInterval = setInterval(updateDetoxTimer, 1000);
  }

  function stopDetoxTimer() {
    clearInterval(_ds.timerInterval);
  }

  /* ──────────────────────────────────────────────
     10. Mesaj Döngüsü
  ────────────────────────────────────────────── */
  function startMsgCycle() {
    let idx = 1;
    _ds.msgInterval = setInterval(() => {
      if (!_ds.isActive || !DOM.message) return;
      DOM.message.style.opacity = '0';
      setTimeout(() => {
        if (DOM.message) {
          DOM.message.textContent = CONFIG.MESSAGES[idx % CONFIG.MESSAGES.length];
          DOM.message.style.opacity = '1';
          idx++;
        }
      }, 600);
    }, 12000);
  }

  function stopMsgCycle() {
    clearInterval(_ds.msgInterval);
  }

  /* ──────────────────────────────────────────────
     11. Uzun Basma (Long Press) — 3 saniyelik kilit
  ────────────────────────────────────────────── */
  const CIRCUMFERENCE = 2 * Math.PI * 26; // ~163.4

  function resetExitProgress() {
    if (DOM.exitProgress) DOM.exitProgress.style.strokeDashoffset = CIRCUMFERENCE;
    if (DOM.exitBtn) DOM.exitBtn.classList.remove('is-pressing');
  }

  function startLongPress() {
    if (!DOM.exitBtn || !DOM.exitProgress) return;
    DOM.exitBtn.classList.add('is-pressing');
    _ds.longPressStart = Date.now();

    function tick() {
      if (!_ds.longPressStart) return;
      const elapsed = Date.now() - _ds.longPressStart;
      const ratio   = Math.min(elapsed / CONFIG.LONG_PRESS_MS, 1);
      DOM.exitProgress.style.strokeDashoffset = CIRCUMFERENCE * (1 - ratio);

      if (ratio >= 1) {
        cancelLongPress(false);
        endDetox(false);
      } else {
        _ds.rafId = requestAnimationFrame(tick);
      }
    }
    _ds.rafId = requestAnimationFrame(tick);
  }

  function cancelLongPress(reset = true) {
    _ds.longPressStart = null;
    if (_ds.rafId) { cancelAnimationFrame(_ds.rafId); _ds.rafId = null; }
    if (reset) resetExitProgress();
  }

  function bindExitButton() {
    if (!DOM.exitBtn) return;
    DOM.exitBtn.addEventListener('mousedown',   startLongPress);
    DOM.exitBtn.addEventListener('mouseup',     () => cancelLongPress(true));
    DOM.exitBtn.addEventListener('mouseleave',  () => cancelLongPress(true));
    DOM.exitBtn.addEventListener('touchstart',  (e) => { e.preventDefault(); startLongPress(); }, { passive: false });
    DOM.exitBtn.addEventListener('touchend',    () => cancelLongPress(true));
    DOM.exitBtn.addEventListener('touchcancel', () => cancelLongPress(true));
  }

  /* ──────────────────────────────────────────────
     12. ESC Engeli
  ────────────────────────────────────────────── */
  function blockEsc(e) {
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      log('ESC engellendi — çıkış için 3 sn basılı tut.');
    }
  }

  /* ──────────────────────────────────────────────
     13. Detox Başlat / Bitir
  ────────────────────────────────────────────── */
  function startDetox() {
    if (_ds.isActive) return;
    log('Detox başlatılıyor...');

    _ds.isActive = true;
    _stateSet('isDetoxActive', true);

    enableLowPower();           // ← document.documentElement.classList.add('low-power')
    audioDetoxEnter();          // ← engine.loadScript(DETOX_SCENE_SCRIPT) + frekans köprüsü
    createParticles();

    if (DOM.overlay) {
      DOM.overlay.removeAttribute('aria-hidden');
      DOM.overlay.classList.add('is-active');
    }

    if (DOM.message) DOM.message.textContent = CONFIG.MESSAGES[0];

    startDetoxTimer();
    startDetoxBreathCycle();
    startMsgCycle();
    resetExitProgress();
    document.addEventListener('keydown', blockEsc);

    // main.js nefes döngüsünü durdur (çakışma engeli)
    if (typeof stopBreathCycle === 'function') stopBreathCycle();

    log('Detox aktif ✓');
  }

  function endDetox(timerCompleted = false) {
    if (!_ds.isActive) return;
    log('Detox bitiyor...', timerCompleted ? '(süre doldu)' : '(kullanıcı)');

    stopDetoxTimer();
    stopDetoxBreathCycle();
    stopMsgCycle();
    document.removeEventListener('keydown', blockEsc);

    if (DOM.overlay) {
      DOM.overlay.setAttribute('aria-hidden', 'true');
      DOM.overlay.classList.remove('is-active');
    }

    _ds.isActive = false;
    _stateSet('isDetoxActive', false);

    disableLowPower();
    audioDetoxExit();
    resetExitProgress();

    if (DOM.trigger) DOM.trigger.focus();
    log('Detox tamamlandı ✓');
  }

  /* ──────────────────────────────────────────────
     14. Tetikleyici Buton
  ────────────────────────────────────────────── */
  function bindTrigger() {
    if (!DOM.trigger) { log('Uyarı: #cooldownTrigger bulunamadı.'); return; }
    DOM.trigger.addEventListener('click', startDetox);
  }

  /* ──────────────────────────────────────────────
     15. Başlatma
  ────────────────────────────────────────────── */
  function detoxInit() {
    // Önceki oturumda aktif kalmış olabilecek detox durumunu sıfırla
    if (_stateGet('isDetoxActive')) {
      log('Önceki oturumda aktif detox bulundu, sıfırlanıyor...');
      _stateSet('isDetoxActive', false);
    }

    bindTrigger();
    bindExitButton();

    // Sayacı göster (başlatmadan)
    if (DOM.timerDisplay) DOM.timerDisplay.textContent = formatTime(CONFIG.DETOX_DURATION_SEC);
    if (DOM.timerFill)    DOM.timerFill.style.transform = 'scaleX(1)';

    log('Digital Detox modülü hazır ✓');
  }

  // DOM hazırsa hemen çalıştır, değilse bekle
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', detoxInit);
  } else {
    detoxInit();
  }

  /* ──────────────────────────────────────────────
     16. Genel API — window.DetoxModule
     Diğer modüllerden erişmek için:
       window.DetoxModule.start()
       window.DetoxModule.end()
       window.DetoxModule.isActive()
  ────────────────────────────────────────────── */
  window.DetoxModule = {
    start    : startDetox,
    end      : endDetox,
    isActive : () => _ds.isActive,
  };

})();
