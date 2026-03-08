/* ═══════════════════════════════════════════════════════════════════════════
   SANCTUARY — main.js  (Entegrasyon Kontrolcüsü)
   ─────────────────────────────────────────────────────────────────────────────
   BAĞIMLILIK YÜKLEME SIRASI (index.html'de):
     1. FrequencyManager.js
     2. SampleManager_v2.js
     3. AudioEngine_v9.js   (togglePlay + switchSound tanımlanır)
     4. SanctuarySync.js    (hook'lar bağlanır)
     5. GeminiAdapter.js
     6. main.js             ← EN SON — tüm modüller hazır

   SORUMLULUKLAR:
     • Mood seçimi → GeminiAdapter.generateScene() → MSD uygulama
     • FrequencyManager + SampleManager + SanctuarySync senkronizasyonu
     • breathPattern → CSS değişkenleri + animasyon
     • Play/Pause yönetimi (AudioContext state dahil)
     • Ekran geçişleri (.screen.on / .screen.off)
     • 60 FPS için tüm DOM işlemleri requestAnimationFrame / class toggle
     • Hata durumunda Fallback tablosu

   PERFORMANS KURALLARI:
     • Hiçbir layout-triggering property okunmaz (offsetWidth vb.)
     • Animasyonlar yalnızca transform + opacity üzerinden
     • Tüm timer'lar dispose()'da temizlenir
   ═══════════════════════════════════════════════════════════════════════════ */

(function (global) {
  'use strict';

  /* ══════════════════════════════════════════════════════════════════════════
     0. YARDIMCI
     ══════════════════════════════════════════════════════════════════════════ */

  /** DOM kısayolu */
  function el(id) { return document.getElementById(id); }

  /** Güvenli class toggle — null kontrollü */
  function cls(node, add, remove) {
    if (!node) return;
    if (add)    add.split(' ').forEach(function(c){ if(c) node.classList.add(c); });
    if (remove) remove.split(' ').forEach(function(c){ if(c) node.classList.remove(c); });
  }

  /** rAF ile tek seferlik DOM güncelleme */
  function raf(fn) { requestAnimationFrame(fn); }

  /** Hata logları */
  var TAG = '[Sanctuary]';
  function log(msg)  { console.info(TAG,  msg); }
  function warn(msg) { console.warn(TAG,  msg); }

  /* ══════════════════════════════════════════════════════════════════════════
     1. UYGULAMA DURUMU
     ══════════════════════════════════════════════════════════════════════════ */

  var _state = {
    selectedMood  : null,   /* 'Anxious' | 'Calm' | ... */
    userText      : '',     /* Mood textarea içeriği */
    currentMSD    : null,   /* Son gelen MSD objesi */
    isPlaying     : false,
    isLoading     : false,  /* Gemini isteği devam ediyor mu? */
    sessionActive : false,  /* Session ekranı açık mı? */
    breathTimer   : null,   /* Nefes animasyon interval */
    _timers       : [],     /* Tüm timer ref'leri (dispose için) */
  };

  /* ══════════════════════════════════════════════════════════════════════════
     2. MODÜL REFERANSLARI — lazy, güvenli
     ══════════════════════════════════════════════════════════════════════════ */

  function getSync()   { return global.SanctuarySync  || null; }
  function getFM()     { return global._sancFM         || null; }
  function getSM()     { return global._sancSM         || null; }
  function getAdapter(){ return global._geminiAdapter  || null; }

  /* ══════════════════════════════════════════════════════════════════════════
     3. EKRAN GEÇİŞLERİ
     Sadece .on / .off class'ı toggle edilir — CSS transform+opacity ile geçiş.
     ══════════════════════════════════════════════════════════════════════════ */

  /**
   * Hedef ekranı .on yap, diğerlerini .off.
   * @param {string} targetId — Gösterilecek .screen elementinin id'si
   */
  function showScreen(targetId) {
    raf(function() {
      document.querySelectorAll('.screen').forEach(function(s) {
        if (s.id === targetId) {
          cls(s, 'on', 'off');
        } else {
          cls(s, 'off', 'on');
        }
      });
      log('Ekran: ' + targetId);
    });
  }

  /* ══════════════════════════════════════════════════════════════════════════
     4. NEFES ANİMASYONU
     breathPattern: { inhale, hold, exhale } (saniye cinsinden)
     CSS --breath-speed değişkeni + data-phase attribute ile yönetilir.
     ══════════════════════════════════════════════════════════════════════════ */

  var BREATH_PHASES = ['inhale', 'hold', 'exhale'];

  /**
   * Nefes animasyonunu başlatır veya günceller.
   * @param {{ inhale:number, hold:number, exhale:number }} bp
   */
  function startBreath(bp) {
    stopBreath();

    if (!bp || typeof bp.inhale !== 'number') return;

    var totalCycle = (bp.inhale + (bp.hold || 0) + bp.exhale);
    if (totalCycle < 1) return;

    /* CSS değişkeni: toplam döngü süresi */
    raf(function() {
      document.documentElement.style.setProperty(
        '--breath-speed', totalCycle + 's'
      );
    });

    /* Nefes fazı gösterimi */
    var circle  = document.querySelector('.breath-circle');
    var breathLabel = document.querySelector('.breath-label');
    var phaseIdx = 0;
    var phaseDurations = [bp.inhale, bp.hold || 0, bp.exhale];

    function runPhase() {
      var phase    = BREATH_PHASES[phaseIdx];
      var duration = phaseDurations[phaseIdx];

      raf(function() {
        if (circle) circle.setAttribute('data-phase', phase);
        if (breathLabel) {
          breathLabel.textContent =
            phase === 'inhale' ? 'Nefes Al'  :
            phase === 'hold'   ? 'Tut'        :
                                 'Ver';
        }
      });

      phaseIdx = (phaseIdx + 1) % 3;

      /* hold süresi 0 ise o fazı atla */
      var nextDur = phaseDurations[phaseIdx];
      if (phase === 'inhale' && (bp.hold === 0 || bp.hold == null)) {
        phaseIdx = 2; /* doğrudan exhale'e geç */
      }

      var ref = setTimeout(runPhase, duration * 1000);
      _state._timers.push(ref);
      _state.breathTimer = ref;
    }

    runPhase();
    log('Nefes döngüsü başladı: ' + bp.inhale + 's / ' + (bp.hold||0) + 's / ' + bp.exhale + 's');
  }

  function stopBreath() {
    if (_state.breathTimer) {
      clearTimeout(_state.breathTimer);
      _state.breathTimer = null;
    }
    var circle = document.querySelector('.breath-circle');
    var breathLabel = document.querySelector('.breath-label');
    raf(function() {
      if (circle) circle.setAttribute('data-phase', 'idle');
      if (breathLabel) breathLabel.textContent = '';
    });
  }

  /* ══════════════════════════════════════════════════════════════════════════
     5. MSD UYGULAYICI
     GeminiAdapter'dan gelen MSD'yi tüm motorlara dağıtır.
     ══════════════════════════════════════════════════════════════════════════ */

  /**
   * @param {Object} msd — Geçerli Musical Scene Descriptor
   * @param {string} gen — AudioEngine gen tipi ('waves'|'rain'|'wind'|...)
   */
  function applyMSD(msd, gen) {
    if (!msd) return;
    _state.currentMSD = msd;

    var base = msd.frequencySuggestion || 432;
    var beat = msd.binaural_beat_hz    || 7;
    var scene = msd.sceneName          || 'Calm Breath';

    log('MSD uygulanıyor → ' + scene + ' | ' + base + 'Hz | beat:' + beat);

    /* ── 5a. FrequencyManager ── */
    var fm = getFM();
    if (fm && typeof fm.update === 'function') {
      try { fm.update(base, beat); } catch(e) { warn('FM güncelleme hatası: ' + e.message); }
    }

    /* ── 5b. SanctuarySync.activate → AudioEngine + SampleManager atomik ── */
    var sync = getSync();
    if (sync && typeof sync.activate === 'function') {
      try {
        sync.activate(gen || 'waves', base, beat, scene);
      } catch(e) { warn('SanctuarySync.activate hatası: ' + e.message); }
    } else if (typeof global.switchSound === 'function') {
      /* Fallback: doğrudan AudioEngine */
      global.switchSound(gen || 'waves', base, beat, scene, { sceneName: scene });
    }

    /* ── 5c. SampleManager: applyGeminiData (v3.0) ── */
    var sm = getSM();
    if (sm && typeof sm.applyGeminiData === 'function') {
      try {
        sm.applyGeminiData({
          active_elements  : msd.active_elements   || [],
          intensity        : msd.intensity         || 0.5,
          spatial_hints    : msd.spatial_hints     || [],
          emotion          : _state.selectedMood   || '',
        });
      } catch(e) { warn('SampleManager.applyGeminiData hatası: ' + e.message); }
    }

    /* ── 5d. AudioEngine: updateFromGemini (v12) ── */
    if (typeof global.updateFromGemini === 'function') {
      try { global.updateFromGemini(msd); } catch(e) {}
    }

    /* ── 5e. Nefes animasyonu ── */
    if (msd.breathPattern) {
      startBreath(msd.breathPattern);
    }

    /* ── 5f. UI badge / frekans etiketi ── */
    raf(function() {
      var badge = el('freq-badge');
      var label = el('freq-label');
      if (badge) { badge.classList.add('on'); badge.style.opacity = '1'; }
      if (label) label.textContent = base + ' Hz · ' + scene;

      /* Sahne adı varsa session ekranında göster */
      var sceneLabel = document.querySelector('.scene-name');
      if (sceneLabel) sceneLabel.textContent = scene;
    });

    /* ── 5g. Biyometrik efekt (varsa) ── */
    if (typeof global.applyBiometricEffect === 'function' && msd.biometric) {
      try { global.applyBiometricEffect(msd.biometric); } catch(e) {}
    }
  }

  /* ══════════════════════════════════════════════════════════════════════════
     6. GEN HARİTASI — Mood → AudioEngine gen tipi
     AudioEngine v9'daki MOOD_MAP ile senkron tutulur.
     ══════════════════════════════════════════════════════════════════════════ */

  var MOOD_TO_GEN = {
    'Anxious'  : 'wind',
    'Tired'    : 'rain',
    'Stressed' : 'waves',
    'Sad'      : 'waves',
    'Calm'     : 'binaural',
    'Grateful' : 'zen',
    /* Arapça */
    'قلق'   : 'wind',
    'مجهد'  : 'waves',
    'متعب'  : 'rain',
    'حزين'  : 'waves',
    'هادئ'  : 'binaural',
    'ممتنّ' : 'zen',
  };

  function genForMood(mood) {
    return MOOD_TO_GEN[mood] || 'waves';
  }

  /* ══════════════════════════════════════════════════════════════════════════
     7. MOOD SEÇİMİ — .mood-chip tıklaması
     ══════════════════════════════════════════════════════════════════════════ */

  function onMoodSelect(mood) {
    if (_state.isLoading) return;     /* Önceki istek bitmeden tıklamayı engelle */
    _state.selectedMood = mood;

    /* Aktif chip görselini güncelle */
    raf(function() {
      document.querySelectorAll('.mood-chip').forEach(function(chip) {
        chip.classList.toggle('active', chip.getAttribute('data-mood') === mood);
      });
    });

    log('Mood seçildi: ' + mood);
  }

  /* ══════════════════════════════════════════════════════════════════════════
     8. ENTER / OTURUMU BAŞLAT
     "Enter Sanctuary" butonuna tıklanınca:
       1. GeminiAdapter.generateScene() → MSD
       2. Ekran geçişi
       3. applyMSD()
       4. togglePlay()
     ══════════════════════════════════════════════════════════════════════════ */

  function onEnterSanctuary() {
    if (_state.isLoading) return;
    if (!_state.selectedMood) {
      /* Mood seçilmediyse ilk mood'u varsayılan al */
      _state.selectedMood = 'Calm';
    }

    _state.isLoading = true;
    _state.userText  = (el('mood-textarea') || {}).value || '';

    /* Yükleme UI */
    raf(function() {
      var btn = el('enter-btn') || document.querySelector('.enter-btn') || document.querySelector('[data-action="enter"]');
      if (btn) { btn.disabled = true; btn.classList.add('loading'); }
    });

    var adapter = getAdapter();
    if (!adapter) {
      warn('GeminiAdapter bulunamadı — fallback ile devam ediliyor.');
      adapter = { generateScene: function(text, mood) {
        var FALLBACK = {
          'Anxious' : { sceneName:'Calm Breath',     tempo:52, frequencySuggestion:396, layers:[], breathPattern:{inhale:4,hold:4,exhale:8}  },
          'Stressed': { sceneName:'Deep Peace',      tempo:58, frequencySuggestion:432, layers:[], breathPattern:{inhale:4,hold:2,exhale:6}  },
          'Tired'   : { sceneName:'Energy Renewal',  tempo:65, frequencySuggestion:528, layers:[], breathPattern:{inhale:5,hold:2,exhale:5}  },
          'Sad'     : { sceneName:'Light Breath',    tempo:55, frequencySuggestion:417, layers:[], breathPattern:{inhale:4,hold:2,exhale:7}  },
          'Calm'    : { sceneName:'Focus Flow',      tempo:70, frequencySuggestion:40,  layers:[], breathPattern:{inhale:4,hold:4,exhale:4}  },
          'Grateful': { sceneName:'Heart Resonance', tempo:60, frequencySuggestion:528, layers:[], breathPattern:{inhale:5,hold:3,exhale:6}  },
        };
        return Promise.resolve(FALLBACK[mood] || { sceneName:'Deep Calm', tempo:58, frequencySuggestion:432, layers:[], breathPattern:{inhale:4,hold:4,exhale:8} });
      }};
    }

    adapter.generateScene(_state.userText, _state.selectedMood)
      .then(function(msd) {
        _state.isLoading = false;

        /* Buton sıfırla */
        raf(function() {
          var btn = el('enter-btn') || document.querySelector('.enter-btn') || document.querySelector('[data-action="enter"]');
          if (btn) { btn.disabled = false; btn.classList.remove('loading'); }
        });

        /* Ekran geçişi: mood screen → session screen */
        showScreen('session-screen');
        _state.sessionActive = true;

        /* MSD uygula */
        var gen = genForMood(_state.selectedMood);
        applyMSD(msd, gen);

        /* AudioContext: kullanıcı etkileşimi sonrası resume */
        if (global._ctx && global._ctx.state === 'suspended') {
          global._ctx.resume().catch(function() {});
        }

        /* Play başlat */
        _startPlayback();
      })
      .catch(function(err) {
        _state.isLoading = false;
        warn('generateScene hatası: ' + (err && err.message));
        raf(function() {
          var btn = el('enter-btn') || document.querySelector('.enter-btn') || document.querySelector('[data-action="enter"]');
          if (btn) { btn.disabled = false; btn.classList.remove('loading'); }
        });
      });
  }

  /* ══════════════════════════════════════════════════════════════════════════
     9. PLAY / PAUSE YÖNETİMİ
     ══════════════════════════════════════════════════════════════════════════ */

  function _startPlayback() {
    /* AudioContext suspend koruma */
    if (global._ctx && global._ctx.state === 'suspended') {
      global._ctx.resume().then(_doPlay).catch(_doPlay);
    } else {
      _doPlay();
    }
  }

  function _doPlay() {
    if (_state.isPlaying) return;

    /* AudioEngine togglePlay — kendi iç state'ini yönetir */
    if (typeof global.togglePlay === 'function') {
      try { global.togglePlay(); } catch(e) { warn('togglePlay hatası: ' + e.message); }
    }

    _state.isPlaying = true;
    _updatePlayBtn(true);

    /* Nefes animasyonu: MSD varsa yenile */
    if (_state.currentMSD && _state.currentMSD.breathPattern) {
      startBreath(_state.currentMSD.breathPattern);
    }

    /* Canvas / arka plan animasyonu */
    raf(function() {
      var canvas = el('gen-canvas');
      if (canvas) canvas.classList.add('playing');
      cls(document.body, 'playing', null);
    });

    log('Oynatma başladı.');
  }

  function _doPause() {
    if (!_state.isPlaying) return;

    if (typeof global.togglePlay === 'function') {
      try { global.togglePlay(); } catch(e) {}
    }

    _state.isPlaying = false;
    _updatePlayBtn(false);
    stopBreath();

    raf(function() {
      var canvas = el('gen-canvas');
      if (canvas) canvas.classList.remove('playing');
      cls(document.body, null, 'playing');
    });

    log('Oynatma durduruldu.');
  }

  function onPlayBtnClick() {
    /* AudioContext unlock — mobil için zorunlu */
    if (global._ctx && global._ctx.state === 'suspended') {
      global._ctx.resume().catch(function() {});
    }

    if (_state.isPlaying) {
      _doPause();
    } else {
      /* Session aktif değilse önce session'ı başlat */
      if (!_state.sessionActive && _state.selectedMood) {
        onEnterSanctuary();
      } else {
        _doPlay();
      }
    }
  }

  function _updatePlayBtn(playing) {
    raf(function() {
      var btn = el('play-btn');
      if (!btn) return;
      btn.classList.toggle('playing', playing);
      /* aria-label erişilebilirlik */
      btn.setAttribute('aria-label', playing ? 'Durdur' : 'Oynat');

      /* İkon: AudioEngine v12 kendi .wbar toggle'ını yönetir, biz sadece btn class'ı */
      var icon = btn.querySelector('.play-icon');
      var pauseIcon = btn.querySelector('.pause-icon');
      if (icon)      icon.style.display      = playing ? 'none'  : '';
      if (pauseIcon) pauseIcon.style.display = playing ? ''      : 'none';
    });
  }

  /* ══════════════════════════════════════════════════════════════════════════
     10. TAB NAVİGASYONU
     Zaten index.html'de switchTab() var; biz sadece eksik event bağlarız.
     ══════════════════════════════════════════════════════════════════════════ */

  function bindTabs() {
    document.querySelectorAll('.tab-item').forEach(function(btn) {
      btn.addEventListener('click', function() {
        var tab = btn.getAttribute('data-tab') || btn.id.replace('tab-btn-', 'tab-');
        if (typeof global.switchTab === 'function') global.switchTab(tab);
      });
    });
  }

  /* ══════════════════════════════════════════════════════════════════════════
     11. ORACLE (AI Mesajı) — session ekranındaki Gemini text kutusu
     ══════════════════════════════════════════════════════════════════════════ */

  function onOracleRequest() {
    var input   = document.querySelector('.oracle-input') || el('oracle-input');
    var text    = input ? input.value.trim() : '';
    var mood    = _state.selectedMood || 'Calm';

    var adapter = getAdapter();
    if (!adapter) return;

    var resultEl = document.querySelector('.ai-result-text');
    if (resultEl) resultEl.textContent = '…';

    adapter.generateScene(text, mood).then(function(msd) {
      var gen = genForMood(mood);
      applyMSD(msd, gen);
      if (resultEl && msd.affirmation) resultEl.textContent = msd.affirmation;
    }).catch(function() {
      if (resultEl) resultEl.textContent = 'Bağlantı hatası. Lütfen tekrar dene.';
    });
  }

  /* ══════════════════════════════════════════════════════════════════════════
     12. SES SEVİYESİ SLIDER (isteğe bağlı)
     ══════════════════════════════════════════════════════════════════════════ */

  function bindVolumeSlider() {
    var slider = el('volume-slider') || document.querySelector('input[type="range"][data-target="volume"]');
    if (!slider) return;
    slider.addEventListener('input', function() {
      var vol = parseFloat(slider.value) || 0.8;
      if (typeof global.setMasterVolume === 'function') global.setMasterVolume(vol);
    });
  }

  /* ══════════════════════════════════════════════════════════════════════════
     13. GERİ BUTONU
     ══════════════════════════════════════════════════════════════════════════ */

  function onBack() {
    _doPause();
    stopBreath();
    _state.sessionActive = false;
    _state.currentMSD    = null;

    /* Mood ekranına dön */
    showScreen('mood-screen');

    raf(function() {
      /* Chip seçimini sıfırla */
      document.querySelectorAll('.mood-chip').forEach(function(c){ c.classList.remove('active'); });
      /* Freq badge kapat */
      var badge = el('freq-badge');
      if (badge) badge.classList.remove('on');
    });

    log('Session sonlandırıldı, mood ekranına dönüldü.');
  }

  /* ══════════════════════════════════════════════════════════════════════════
     14. EVENT BINDING — Tüm listener'ları tek noktada bağla
     ══════════════════════════════════════════════════════════════════════════ */

  function bindEvents() {

    /* ── Mood chip'leri ── */
    document.querySelectorAll('.mood-chip').forEach(function(chip) {
      chip.addEventListener('click', function() {
        var mood = chip.getAttribute('data-mood');
        if (mood) onMoodSelect(mood);
      });
    });

    /* ── Enter Sanctuary butonu ── */
    var enterSelectors = [
      '#enter-btn',
      '.enter-btn',
      '[data-action="enter"]',
      '.cta-btn[data-i18n="Enter Sanctuary"]',
    ];
    enterSelectors.forEach(function(sel) {
      var btn = document.querySelector(sel);
      if (btn && !btn._sanctuaryBound) {
        btn._sanctuaryBound = true;
        btn.addEventListener('click', onEnterSanctuary);
      }
    });

    /* ── Play butonu ──
       AudioEngine v12 kendi listener'ını cloneNode ile temizleyip yeniden
       bağlıyor. Biz AudioEngine'in bağladığı listener'ın ÜSTÜNde bir
       wrapper çalıştırmak için _audioToggle yedek referansını kullanıyoruz.
       Çakışmayı önlemek için doğrudan global.togglePlay kullanıyoruz.
       AudioEngine'in kendi binding'i zaten çalışıyor; biz sadece _state'i
       ve UI'yı senkronize ediyoruz. */
    var playBtn = el('play-btn');
    if (playBtn && !playBtn._mainBound) {
      playBtn._mainBound = true;
      playBtn.addEventListener('click', function() {
        /* AudioEngine'in kendi handler'ı zaten togglePlay'i çağıracak.
           Biz sadece _state ve breath animasyonunu güncelliyoruz. */
        var willPlay = !_state.isPlaying;
        _state.isPlaying = willPlay;
        _updatePlayBtn(willPlay);
        if (willPlay) {
          if (_state.currentMSD && _state.currentMSD.breathPattern) {
            startBreath(_state.currentMSD.breathPattern);
          }
        } else {
          stopBreath();
        }
      });
    }

    /* ── Geri butonları ── */
    document.querySelectorAll('.back-btn, [data-action="back"]').forEach(function(btn) {
      if (!btn._sanctuaryBound) {
        btn._sanctuaryBound = true;
        btn.addEventListener('click', onBack);
      }
    });

    /* ── Oracle butonu ── */
    var oracleBtn = document.querySelector('.ai-generate-btn, [data-action="oracle"], #oracle-btn');
    if (oracleBtn && !oracleBtn._sanctuaryBound) {
      oracleBtn._sanctuaryBound = true;
      oracleBtn.addEventListener('click', onOracleRequest);
    }

    /* ── Volume slider ── */
    bindVolumeSlider();

    /* ── Tab navigasyonu ── */
    bindTabs();

    log('Event listener\'lar bağlandı ✓');
  }

  /* ══════════════════════════════════════════════════════════════════════════
     15. GEMINİ ADAPTER BAŞLATMA
     ══════════════════════════════════════════════════════════════════════════ */

  function initAdapter() {
    if (typeof global.GeminiAdapter === 'function') {
      global._geminiAdapter = new global.GeminiAdapter();
      log('GeminiAdapter hazır ✓');
    } else {
      warn('GeminiAdapter bulunamadı — Fallback tablosu aktif.');
    }
  }

  /* ══════════════════════════════════════════════════════════════════════════
     16. UYGULAMA BAŞLATICI
     ══════════════════════════════════════════════════════════════════════════ */

  function init() {
    log('══ Sanctuary main.js başlatılıyor ══');

    /* GeminiAdapter singleton */
    initAdapter();

    /* Event'leri bağla */
    bindEvents();

    /* SanctuarySync: AudioEngine hazır değilse otomatik init zaten tetikler.
       Hazırsa ikinci kez çağırmak zararsız (idempotent guard var). */
    var sync = getSync();
    if (sync && typeof sync.init === 'function') {
      try { sync.init(); } catch(e) {}
    }

    /* İlk ekran: mood seçim ekranı */
    showScreen('mood-screen');

    /* localStorage'dan önceki mood'u yükle (UX) */
    try {
      var savedMood = localStorage.getItem('sanctuary_last_mood');
      if (savedMood) onMoodSelect(savedMood);
    } catch(e) {}

    log('══ Sanctuary hazır ══');
  }

  /* ══════════════════════════════════════════════════════════════════════════
     17. DISPOSE — Temizleme (sayfa kapatma / hot-reload)
     ══════════════════════════════════════════════════════════════════════════ */

  function dispose() {
    stopBreath();
    _state._timers.forEach(function(t){ clearTimeout(t); clearInterval(t); });
    _state._timers = [];
    var sync = getSync();
    if (sync && typeof sync.dispose === 'function') {
      try { sync.dispose(); } catch(e) {}
    }
    log('Dispose tamamlandı.');
  }

  /* ══════════════════════════════════════════════════════════════════════════
     18. PUBLIC API — Debug ve dışarıdan tetikleme için
     ══════════════════════════════════════════════════════════════════════════ */

  global.SanctuaryApp = {
    selectMood   : onMoodSelect,
    enter        : onEnterSanctuary,
    play         : _doPlay,
    pause        : _doPause,
    applyMSD     : applyMSD,
    oracleRequest: onOracleRequest,
    back         : onBack,
    dispose      : dispose,
    getState     : function() { return JSON.parse(JSON.stringify(_state)); },
  };

  /* ══════════════════════════════════════════════════════════════════════════
     19. OTOMATİK BAŞLATMA
     ══════════════════════════════════════════════════════════════════════════ */

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  /* Sayfa kapatılırken temizle */
  global.addEventListener('beforeunload', dispose);

})(typeof window !== 'undefined' ? window : this);
