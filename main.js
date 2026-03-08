/* ═══════════════════════════════════════════════════════════════════════════
   SANCTUARY — main.js  (Entegrasyon Kontrolcüsü — Düzeltilmiş)
   ─────────────────────────────────────────────────────────────────────────────
   EKRAN ID'LERİ (index.html'den doğrulandı):
     • screen-mood        ← Mood seçim ekranı (başlangıçta .on)
     • screen-sanctuary   ← Oturum ekranı      (.off başlar)
     • screen-analytics   ← Analitik ekranı    (.off başlar)

   GEÇİŞ FONKSİYONLARI (index.html'de zaten tanımlı — override etmiyoruz):
     • window.goSanctuary() — screen-sanctuary'yi açar
     • window.goBack()      — screen-mood'a döner

   ENTER BUTONU: .cta-btn onclick="goSanctuary()" — biz GeminiAdapter'ı
   bu çağrının ÖNÜNE ekliyoruz, goSanctuary()'yi replace etmiyoruz.
   ═══════════════════════════════════════════════════════════════════════════ */

(function (global) {
  'use strict';

  /* ──────────────────────────────────────────
     YARDIMCI
  ────────────────────────────────────────── */
  function el(id) { return document.getElementById(id); }
  function raf(fn) { requestAnimationFrame(fn); }
  var TAG = '[Sanctuary]';
  function log(msg)  { console.info(TAG, msg); }
  function warn(msg) { console.warn(TAG, msg); }

  /* ──────────────────────────────────────────
     UYGULAMA DURUMU
  ────────────────────────────────────────── */
  var _state = {
    selectedMood  : null,
    userText      : '',
    currentMSD    : null,
    isPlaying     : false,
    isLoading     : false,
    breathTimer   : null,
    _timers       : [],
  };

  /* ──────────────────────────────────────────
     MODÜL REFERANSLARI
  ────────────────────────────────────────── */
  function getSync()    { return global.SanctuarySync || null; }
  function getFM()      { return global._sancFM        || null; }
  function getSM()      { return global._sancSM        || null; }
  function getAdapter() { return global._geminiAdapter || null; }

  /* ══════════════════════════════════════════════════════════════════════════
     NEFES ANİMASYONU
  ══════════════════════════════════════════════════════════════════════════ */
  var BREATH_LABELS = { inhale: 'Nefes Al', hold: 'Tut', exhale: 'Ver' };

  function startBreath(bp) {
    stopBreath();
    if (!bp || typeof bp.inhale !== 'number') return;

    var total = (bp.inhale || 4) + (bp.hold || 0) + (bp.exhale || 4);

    /* CSS değişkeni — nefes çemberinin animasyon süresi */
    document.documentElement.style.setProperty('--breath-speed', total + 's');

    var circle     = document.querySelector('.breath-circle');
    var breathLbl  = document.querySelector('.breath-label');
    var phases     = ['inhale', 'hold', 'exhale'];
    var durations  = [bp.inhale, bp.hold || 0, bp.exhale];
    var idx        = 0;

    function tick() {
      /* hold = 0 ise o fazı atla */
      if (phases[idx] === 'hold' && durations[idx] === 0) {
        idx = (idx + 1) % 3;
      }

      var phase = phases[idx];
      var dur   = durations[idx];

      raf(function() {
        if (circle)    circle.setAttribute('data-phase', phase);
        if (breathLbl) breathLbl.textContent = BREATH_LABELS[phase] || '';
      });

      idx = (idx + 1) % 3;
      var ref = setTimeout(tick, dur * 1000);
      _state._timers.push(ref);
      _state.breathTimer = ref;
    }

    tick();
    log('Nefes: ' + bp.inhale + 's / ' + (bp.hold||0) + 's / ' + bp.exhale + 's');
  }

  function stopBreath() {
    if (_state.breathTimer) {
      clearTimeout(_state.breathTimer);
      _state.breathTimer = null;
    }
    var circle    = document.querySelector('.breath-circle');
    var breathLbl = document.querySelector('.breath-label');
    if (circle)    circle.setAttribute('data-phase', 'idle');
    if (breathLbl) breathLbl.textContent = '';
  }

  /* ══════════════════════════════════════════════════════════════════════════
     MSD UYGULAYICI
  ══════════════════════════════════════════════════════════════════════════ */
  var MOOD_TO_GEN = {
    'Anxious':'wind','Tired':'rain','Stressed':'waves',
    'Sad':'waves','Calm':'binaural','Grateful':'zen',
    'قلق':'wind','مجهد':'waves','متعب':'rain',
    'حزين':'waves','هادئ':'binaural','ممتنّ':'zen',
  };

  function applyMSD(msd, gen) {
    if (!msd) return;
    _state.currentMSD = msd;

    var base  = msd.frequencySuggestion || 432;
    var beat  = msd.binaural_beat_hz    || 7;
    var scene = msd.sceneName           || 'Calm Breath';
    gen = gen || MOOD_TO_GEN[_state.selectedMood] || 'waves';

    log('MSD → ' + scene + ' | ' + base + ' Hz | beat:' + beat + ' | gen:' + gen);

    /* 1. FrequencyManager */
    var fm = getFM();
    if (fm && typeof fm.update === 'function') {
      try { fm.update(base, beat); } catch(e) { warn('FM: ' + e.message); }
    }

    /* 2. SanctuarySync.activate — atomik FM + SM + AudioEngine */
    var sync = getSync();
    if (sync && typeof sync.activate === 'function') {
      try { sync.activate(gen, base, beat, scene); }
      catch(e) { warn('SanctuarySync: ' + e.message); }
    } else if (typeof global.switchSound === 'function') {
      global.switchSound(gen, base, beat, scene, { sceneName: scene });
    }

    /* 3. SampleManager.applyGeminiData (v3.0) */
    var sm = getSM();
    if (sm && typeof sm.applyGeminiData === 'function') {
      try {
        sm.applyGeminiData({
          active_elements : msd.active_elements  || [],
          intensity       : msd.intensity        || 0.5,
          spatial_hints   : msd.spatial_hints    || [],
          emotion         : _state.selectedMood  || '',
        });
      } catch(e) { warn('SM.applyGeminiData: ' + e.message); }
    }

    /* 4. AudioEngine.updateFromGemini (v12) */
    if (typeof global.updateFromGemini === 'function') {
      try { global.updateFromGemini(msd); } catch(e) {}
    }

    /* 5. Nefes animasyonu */
    if (msd.breathPattern) startBreath(msd.breathPattern);

    /* 6. UI etiketleri */
    raf(function() {
      var badge = el('freq-badge');
      var label = el('freq-label');
      if (badge) { badge.classList.add('on'); badge.style.opacity = '1'; }
      if (label) label.textContent = base + ' Hz · ' + scene;
    });
  }

  /* ══════════════════════════════════════════════════════════════════════════
     MOOD SEÇİMİ
  ══════════════════════════════════════════════════════════════════════════ */
  function onMoodSelect(mood) {
    _state.selectedMood = mood;
    try { localStorage.setItem('sanctuary_last_mood', mood); } catch(e) {}

    raf(function() {
      document.querySelectorAll('.mood-chip').forEach(function(chip) {
        chip.classList.toggle('active', chip.getAttribute('data-mood') === mood);
      });
    });

    log('Mood: ' + mood);
  }

  /* ══════════════════════════════════════════════════════════════════════════
     ENTER SANCTUARY — goSanctuary()'nin önüne Gemini çağrısı ekliyoruz
     index.html'deki orijinal goSanctuary() fonksiyonunu WRAP ediyoruz.
  ══════════════════════════════════════════════════════════════════════════ */
  function wrapGoSanctuary() {
    var _origGoSanctuary = global.goSanctuary;

    global.goSanctuary = function() {
      if (_state.isLoading) return;

      /* Mood seçilmediyse default */
      if (!_state.selectedMood) _state.selectedMood = 'Calm';
      _state.userText  = (el('mood-textarea') || {}).value || '';
      _state.isLoading = true;

      /* Buton yükleniyor görünümü */
      var btn = document.querySelector('.cta-btn');
      raf(function() { if (btn) btn.classList.add('loading'); });

      var adapter = getAdapter();

      /* Adapter yoksa direkt geçiş yap */
      if (!adapter) {
        _state.isLoading = false;
        if (btn) raf(function() { btn.classList.remove('loading'); });
        if (typeof _origGoSanctuary === 'function') _origGoSanctuary();
        applyMSD(getFallbackMSD(_state.selectedMood), MOOD_TO_GEN[_state.selectedMood]);
        _autoPlay();
        return;
      }

      adapter.generateScene(_state.userText, _state.selectedMood)
        .then(function(msd) {
          _state.isLoading = false;
          raf(function() { if (btn) btn.classList.remove('loading'); });

          /* Önce ekranı geç (orijinal fonksiyon) */
          if (typeof _origGoSanctuary === 'function') _origGoSanctuary();

          /* Sonra MSD uygula */
          applyMSD(msd, MOOD_TO_GEN[_state.selectedMood]);

          /* AudioContext resume (mobil zorunlu) */
          if (global._ctx && global._ctx.state === 'suspended') {
            global._ctx.resume().catch(function(){});
          }

          /* Oynatmayı başlat */
          _autoPlay();
        })
        .catch(function(err) {
          _state.isLoading = false;
          warn('generateScene hatası: ' + (err && err.message));
          raf(function() { if (btn) btn.classList.remove('loading'); });
          if (typeof _origGoSanctuary === 'function') _origGoSanctuary();
          applyMSD(getFallbackMSD(_state.selectedMood), MOOD_TO_GEN[_state.selectedMood]);
          _autoPlay();
        });
    };

    log('goSanctuary wrap edildi ✓');
  }

  /* ══════════════════════════════════════════════════════════════════════════
     PLAY YÖNETİMİ
  ══════════════════════════════════════════════════════════════════════════ */
  function _autoPlay() {
    var ref = setTimeout(function() {
      if (!global._playing) {
        if (global._ctx && global._ctx.state === 'suspended') {
          global._ctx.resume().then(function() {
            if (typeof global.togglePlay === 'function') global.togglePlay();
          }).catch(function(){});
        } else {
          if (typeof global.togglePlay === 'function') global.togglePlay();
        }
      }
      _state.isPlaying = true;
      _updatePlayUI(true);
      if (_state.currentMSD && _state.currentMSD.breathPattern) {
        startBreath(_state.currentMSD.breathPattern);
      }
    }, 120);
    _state._timers.push(ref);
  }

  function _updatePlayUI(playing) {
    raf(function() {
      var btn = el('play-btn');
      if (btn) {
        btn.classList.toggle('on', playing);
        btn.setAttribute('aria-label', playing ? 'Durdur' : 'Oynat');
      }
      document.body.classList.toggle('playing', playing);
    });
  }

  function bindPlayBtn() {
    var btn = el('play-btn');
    if (!btn || btn._mainBound) return;
    btn._mainBound = true;

    btn.addEventListener('click', function() {
      var nowPlaying = !_state.isPlaying;
      _state.isPlaying = nowPlaying;
      _updatePlayUI(nowPlaying);

      if (nowPlaying) {
        if (_state.currentMSD && _state.currentMSD.breathPattern) {
          startBreath(_state.currentMSD.breathPattern);
        }
        if (global._ctx && global._ctx.state === 'suspended') {
          global._ctx.resume().catch(function(){});
        }
      } else {
        stopBreath();
      }
    });

    log('play-btn bağlandı ✓');
  }

  /* ══════════════════════════════════════════════════════════════════════════
     FALLBACK MSD
  ══════════════════════════════════════════════════════════════════════════ */
  var FALLBACK_TABLE = {
    'Anxious' : { sceneName:'Calm Breath',     tempo:52, frequencySuggestion:396, layers:[], breathPattern:{inhale:4,hold:4,exhale:8}  },
    'Stressed': { sceneName:'Deep Peace',      tempo:58, frequencySuggestion:432, layers:[], breathPattern:{inhale:4,hold:2,exhale:6}  },
    'Tired'   : { sceneName:'Energy Renewal',  tempo:65, frequencySuggestion:528, layers:[], breathPattern:{inhale:5,hold:2,exhale:5}  },
    'Sad'     : { sceneName:'Light Breath',    tempo:55, frequencySuggestion:417, layers:[], breathPattern:{inhale:4,hold:2,exhale:7}  },
    'Calm'    : { sceneName:'Focus Flow',      tempo:70, frequencySuggestion:40,  layers:[], breathPattern:{inhale:4,hold:4,exhale:4}  },
    'Grateful': { sceneName:'Heart Resonance', tempo:60, frequencySuggestion:528, layers:[], breathPattern:{inhale:5,hold:3,exhale:6}  },
  };

  function getFallbackMSD(mood) {
    return FALLBACK_TABLE[mood] || {
      sceneName:'Deep Calm', tempo:58, frequencySuggestion:432,
      layers:[], breathPattern:{inhale:4,hold:4,exhale:8}
    };
  }

  /* ══════════════════════════════════════════════════════════════════════════
     MOOD CHIP BAĞLAMA
  ══════════════════════════════════════════════════════════════════════════ */
  function bindMoodChips() {
    document.querySelectorAll('.mood-chip').forEach(function(chip) {
      if (chip._mainBound) return;
      chip._mainBound = true;
      chip.addEventListener('click', function() {
        var mood = chip.getAttribute('data-mood');
        if (mood) onMoodSelect(mood);
      });
    });
    log('Mood chip\'ler bağlandı ✓');
  }

  /* ══════════════════════════════════════════════════════════════════════════
     ORACLE BUTONU
  ══════════════════════════════════════════════════════════════════════════ */
  function bindOracle() {
    var btn = document.querySelector('.ai-generate-btn, #oracle-btn, [data-action="oracle"]');
    if (!btn || btn._mainBound) return;
    btn._mainBound = true;

    btn.addEventListener('click', function() {
      var inputEl  = document.querySelector('.oracle-input, #oracle-input');
      var text     = inputEl ? inputEl.value.trim() : '';
      var mood     = _state.selectedMood || 'Calm';
      var adapter  = getAdapter();
      if (!adapter) return;

      var resultEl = document.querySelector('.ai-result-text');
      if (resultEl) resultEl.textContent = '…';

      adapter.generateScene(text, mood).then(function(msd) {
        applyMSD(msd, MOOD_TO_GEN[mood]);
        if (resultEl && msd.affirmation) resultEl.textContent = msd.affirmation;
      }).catch(function() {
        if (resultEl) resultEl.textContent = 'Bağlantı hatası. Tekrar dene.';
      });
    });

    log('Oracle bağlandı ✓');
  }

  /* ══════════════════════════════════════════════════════════════════════════
     GEMINİ ADAPTER BAŞLATMA
  ══════════════════════════════════════════════════════════════════════════ */
  function initAdapter() {
    if (typeof global.GeminiAdapter === 'function') {
      global._geminiAdapter = new global.GeminiAdapter();
      log('GeminiAdapter hazır ✓');
    } else {
      warn('GeminiAdapter bulunamadı — Fallback aktif.');
    }
  }

  /* ══════════════════════════════════════════════════════════════════════════
     DISPOSE
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
     PUBLIC API
  ══════════════════════════════════════════════════════════════════════════ */
  global.SanctuaryApp = {
    selectMood : onMoodSelect,
    applyMSD   : applyMSD,
    dispose    : dispose,
    getState   : function() { return JSON.parse(JSON.stringify(_state)); },
  };

  /* ══════════════════════════════════════════════════════════════════════════
     INIT
  ══════════════════════════════════════════════════════════════════════════ */
  function init() {
    log('══ main.js başlatılıyor ══');

    initAdapter();
    bindMoodChips();
    bindPlayBtn();
    bindOracle();
    wrapGoSanctuary();

    /* SanctuarySync — idempotent */
    var sync = getSync();
    if (sync && typeof sync.init === 'function') {
      try { sync.init(); } catch(e) {}
    }

    /* Kayıtlı mood varsa seç */
    try {
      var saved = localStorage.getItem('sanctuary_last_mood');
      if (saved) onMoodSelect(saved);
    } catch(e) {}

    log('══ main.js hazır ══');
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  global.addEventListener('beforeunload', dispose);

})(typeof window !== 'undefined' ? window : this);
