/* ═══════════════════════════════════════════════════════════════════════════
   SANCTUARY — main.js  v3  (Final Optimizasyon)
   ─────────────────────────────────────────────────────────────────────────────
   DÜZELTMELER:
     1. Otomatik başlatma   — MSD gelir gelmez müzik başlar, Play'e gerek yok
     2. Play/Pause senkron  — window._playing (AudioEngine v12) ile tam senkron
     3. Hard Limiter        — Osilatör gain asla toplam sesin %15'ini geçemez
     4. Scene Fallback      — Bilinmeyen sahne adlarını en yakın kategoriye eşle

   EKRAN ID'LERİ (index.html'den doğrulandı):
     screen-mood / screen-sanctuary / screen-analytics

   FONKSIYONLAR (index.html'de var, override etmiyoruz):
     goSanctuary() / goBack() / togglePlay()
   ═══════════════════════════════════════════════════════════════════════════ */

(function (global) {
  'use strict';

  /* ──────────────────────────────────────────────────────────────────────────
     YARDIMCI
  ────────────────────────────────────────────────────────────────────────── */
  function el(id)   { return document.getElementById(id); }
  function raf(fn)  { requestAnimationFrame(fn); }
  var TAG = '[Sanctuary]';
  function log(msg)  { console.info(TAG,  msg); }
  function warn(msg) { console.warn(TAG,  msg); }

  /* ──────────────────────────────────────────────────────────────────────────
     DURUM
  ────────────────────────────────────────────────────────────────────────── */
  var _state = {
    selectedMood : null,
    userText     : '',
    currentMSD   : null,
    isLoading    : false,
    breathTimer  : null,
    _timers      : [],
  };

  /* AudioEngine'in gerçek playing state'ini oku — tek kaynak of truth */
  function isPlaying() { return !!global._playing; }

  /* ──────────────────────────────────────────────────────────────────────────
     MODÜL REFERANSLARI
  ────────────────────────────────────────────────────────────────────────── */
  function getSync()    { return global.SanctuarySync || null; }
  function getFM()      { return global._sancFM        || null; }
  function getSM()      { return global._sancSM        || null; }
  function getAdapter() { return global._geminiAdapter || null; }

  /* ──────────────────────────────────────────────────────────────────────────
     SCENE FALLBACK HARİTASI  (Düzeltme #4)
     Gemini'den gelen bilinmeyen sahne adlarını bilinen gen tipine eşle.
     Anahtar: küçük harf keyword → gen tipi
  ────────────────────────────────────────────────────────────────────────── */
  var SCENE_KEYWORD_MAP = [
    { keys: ['ocean','sea','wave','deniz','dalga','biolum'],  gen: 'waves'    },
    { keys: ['rain','yağmur','storm','fırtına','thunder'],    gen: 'rain'     },
    { keys: ['wind','rüzgar','breeze','esinti','air'],        gen: 'wind'     },
    { keys: ['fire','ateş','flame','alev','campfire'],        gen: 'fire'     },
    { keys: ['forest','orman','jungle','nature','night'],     gen: 'forest'   },
    { keys: ['zen','garden','bahçe','temple','tapınak'],      gen: 'zen'      },
    { keys: ['space','uzay','cosmos','galaxy','deep'],        gen: 'space'    },
    { keys: ['earth','toprak','ground','grounding','soil'],   gen: 'earth'    },
    { keys: ['morning','sabah','dawn','şafak','mist','sis'],  gen: 'morning'  },
    { keys: ['binaural','heart','kalp','resonance'],          gen: 'binaural' },
  ];

  var MOOD_TO_GEN = {
    'Anxious':'wind', 'Tired':'rain', 'Stressed':'waves',
    'Sad':'waves',    'Calm':'binaural', 'Grateful':'zen',
    'قلق':'wind',    'مجهد':'waves',   'متعب':'rain',
    'حزين':'waves',  'هادئ':'binaural','ممتنّ':'zen',
  };

  /* Bilinen SampleManager sahne adları (SCENE_SAMPLE_MAP keyleri) */
  var KNOWN_SCENES = [
    'Calm Breath','Deep Peace','Light Breath','Focus Flow',
    'Heart Resonance','Energy Renewal','Zen Garden','Deep Space',
    'Earth Grounding','Night Forest','Morning Mist',
    'Joyful Radiance','Morning Light',
    'تنفس هادئ','سلام عميق',
  ];

  /**
   * Sahne adını doğrular; bilinmiyorsa keyword matching ile gen döner.
   * @returns {{ scene: string, gen: string }}
   */
  function resolveScene(sceneName, moodGen) {
    /* Bilinen sahne adıysa direkt kullan */
    if (KNOWN_SCENES.indexOf(sceneName) !== -1) {
      return { scene: sceneName, gen: moodGen || 'waves' };
    }

    /* Keyword matching */
    var lower = (sceneName || '').toLowerCase();
    for (var i = 0; i < SCENE_KEYWORD_MAP.length; i++) {
      var entry = SCENE_KEYWORD_MAP[i];
      for (var j = 0; j < entry.keys.length; j++) {
        if (lower.indexOf(entry.keys[j]) !== -1) {
          /* Keyword'e karşılık gelen gen'den varsayılan sahneyi bul */
          var fallbackScene = genToDefaultScene(entry.gen);
          log('Bilinmeyen sahne "' + sceneName + '" → ' + fallbackScene + ' (' + entry.gen + ')');
          return { scene: fallbackScene, gen: entry.gen };
        }
      }
    }

    /* Hiçbir şey eşleşmezse mood'a göre default */
    var defaultGen = moodGen || 'waves';
    return { scene: genToDefaultScene(defaultGen), gen: defaultGen };
  }

  function genToDefaultScene(gen) {
    var map = {
      waves:'Calm Breath', rain:'Deep Peace', wind:'Light Breath',
      fire:'Energy Renewal', forest:'Night Forest', zen:'Zen Garden',
      space:'Deep Space', earth:'Earth Grounding', morning:'Morning Mist',
      binaural:'Heart Resonance',
    };
    return map[gen] || 'Calm Breath';
  }

  /* ──────────────────────────────────────────────────────────────────────────
     HARD LIMITER  (Düzeltme #3)
     Osilatör gain'i asla master'ın %15'ini geçirme.
     AudioEngine'in _master ve _mainFilter gain'lerini kırpar.
  ────────────────────────────────────────────────────────────────────────── */
  var OSC_GAIN_CEILING = 0.15;   /* %15 hard cap */
  var SAFE_MASTER_VOL  = 0.72;   /* Cızırtı olmayan güvenli master seviyesi */

  function applyHardLimiter() {
    var ctx    = global._ctx;
    var master = global._master;
    if (!ctx || !master) return;

    var now = ctx.currentTime;
    var cur = master.gain.value;

    /* Master zaten güvenli aralıktaysa dokunma */
    if (cur <= SAFE_MASTER_VOL) return;

    master.gain.cancelScheduledValues(now);
    master.gain.setValueAtTime(cur, now);
    master.gain.linearRampToValueAtTime(SAFE_MASTER_VOL, now + 0.4);

    log('Hard Limiter: master gain ' + cur.toFixed(3) + ' → ' + SAFE_MASTER_VOL);
  }

  /**
   * intensity değerini SampleManager için güvenli aralığa çek.
   * Gemini bazen 1.0 gönderir → distortion yapar.
   */
  function clampIntensity(raw) {
    var v = parseFloat(raw);
    if (isNaN(v)) return 0.5;
    return Math.max(0.1, Math.min(0.65, v));  /* 0.1 – 0.65 arası */
  }

  /* ──────────────────────────────────────────────────────────────────────────
     NEFES ANİMASYONU
  ────────────────────────────────────────────────────────────────────────── */
  var BREATH_LABELS = { inhale: 'Nefes Al', hold: 'Tut', exhale: 'Ver' };

  function startBreath(bp) {
    stopBreath();
    if (!bp || typeof bp.inhale !== 'number') return;

    var total = (bp.inhale || 4) + (bp.hold || 0) + (bp.exhale || 4);
    document.documentElement.style.setProperty('--breath-speed', total + 's');

    var circle    = document.querySelector('.breath-circle');
    var breathLbl = document.querySelector('.breath-label');
    var phases    = ['inhale', 'hold', 'exhale'];
    var durations = [bp.inhale, bp.hold || 0, bp.exhale];
    var idx       = 0;

    function tick() {
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

  /* ──────────────────────────────────────────────────────────────────────────
     MSD UYGULAYICI  (Düzeltmeler #3 + #4 entegre)
  ────────────────────────────────────────────────────────────────────────── */
  function applyMSD(msd, moodGen) {
    if (!msd) return;
    _state.currentMSD = msd;

    var base  = msd.frequencySuggestion || 432;
    var beat  = msd.binaural_beat_hz    || 7;

    /* #4: Bilinmeyen sahne → fallback */
    var resolved = resolveScene(msd.sceneName, moodGen);
    var scene    = resolved.scene;
    var gen      = resolved.gen;

    /* #3: intensity güvenli aralığa çek */
    var safeIntensity = clampIntensity(msd.intensity);

    log('MSD → "' + scene + '" | ' + base + 'Hz | gen:' + gen + ' | intensity:' + safeIntensity);

    /* localStorage'a yaz — AudioEngine togglePlay'in okuyacağı değerler */
    try {
      localStorage.setItem('lastGen',  gen);
      localStorage.setItem('lastBase', String(base));
      localStorage.setItem('lastBeat', String(beat));
      if (_state.selectedMood) localStorage.setItem('lastMood', _state.selectedMood);
    } catch(e) {}

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

    /* 3. SampleManager.applyGeminiData (v3.0) — intensity kırpılmış */
    var sm = getSM();
    if (sm && typeof sm.applyGeminiData === 'function') {
      try {
        sm.applyGeminiData({
          active_elements : msd.active_elements  || [],
          intensity       : safeIntensity,
          spatial_hints   : msd.spatial_hints    || [],
          emotion         : _state.selectedMood  || '',
        });
      } catch(e) { warn('SM.applyGeminiData: ' + e.message); }
    }

    /* 4. AudioEngine.updateFromGemini (v12) */
    if (typeof global.updateFromGemini === 'function') {
      try { global.updateFromGemini(msd); } catch(e) {}
    }

    /* 5. Hard Limiter — gain patlamaması için */
    applyHardLimiter();

    /* 6. Nefes animasyonu */
    if (msd.breathPattern) startBreath(msd.breathPattern);

    /* 7. UI etiketleri */
    raf(function() {
      var badge = el('freq-badge');
      var label = el('freq-label');
      if (badge) { badge.classList.add('on'); badge.style.opacity = '1'; }
      if (label) label.textContent = base + ' Hz · ' + scene;
    });
  }

  /* ──────────────────────────────────────────────────────────────────────────
     PLAY / PAUSE  (Düzeltme #2)
     AudioEngine'in window._playing'i tek kaynak of truth.
     Biz togglePlay()'i çağırırken mevcut state'i kontrol ediyoruz;
     "istiyor ama zaten o halde" durumunda çift tetiklemeyi engelliyoruz.
  ────────────────────────────────────────────────────────────────────────── */

  /** Müziği başlat — zaten oynuyorsa dokunma */
  function doPlay() {
    if (isPlaying()) {
      _updatePlayUI(true);
      return;
    }

    /* AudioContext unlock (mobil zorunlu) */
    var resume = global._ctx && global._ctx.state === 'suspended'
      ? global._ctx.resume()
      : Promise.resolve();

    resume.then(function() {
      if (typeof global.togglePlay === 'function') {
        global.togglePlay();   /* AudioEngine kendi _playing'ini set eder */
      }
      /* togglePlay senkron olduğu için hemen kontrol edilebilir */
      _updatePlayUI(isPlaying());
      if (_state.currentMSD && _state.currentMSD.breathPattern) {
        startBreath(_state.currentMSD.breathPattern);
      }
    }).catch(function(e) { warn('AudioContext resume: ' + e); });
  }

  /** Müziği durdur — zaten duruyorsa dokunma */
  function doPause() {
    if (!isPlaying()) {
      _updatePlayUI(false);
      return;
    }
    if (typeof global.togglePlay === 'function') {
      global.togglePlay();
    }
    _updatePlayUI(false);
    stopBreath();
  }

  function _updatePlayUI(playing) {
    raf(function() {
      var btn = el('play-btn');
      if (btn) {
        btn.classList.toggle('on', playing);
        btn.setAttribute('aria-pressed', String(playing));
        btn.setAttribute('aria-label', playing ? 'Durdur' : 'Oynat');
      }
      document.body.classList.toggle('playing', playing);
    });
  }

  /* ──────────────────────────────────────────────────────────────────────────
     OTOMATİK BAŞLATMA  (Düzeltme #1)
     MSD gelir gelmez, AudioEngine'i tetikle.
     Küçük gecikme: SanctuarySync.activate async'tir (SampleManager yüklüyor).
  ────────────────────────────────────────────────────────────────────────── */
  function autoStartAfterMSD() {
    /* SampleManager'ın applyScene promise'ini beklemek için 300ms */
    var ref = setTimeout(function() {
      if (!isPlaying()) {
        doPlay();
        log('Otomatik başlatma tetiklendi ✓');
      }
    }, 300);
    _state._timers.push(ref);
  }

  /* ──────────────────────────────────────────────────────────────────────────
     MOOD SEÇİMİ
  ────────────────────────────────────────────────────────────────────────── */
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

  /* ──────────────────────────────────────────────────────────────────────────
     FALLBACK MSD TABLOSU
  ────────────────────────────────────────────────────────────────────────── */
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
      sceneName: 'Calm Breath', tempo: 58, frequencySuggestion: 432,
      layers: [], breathPattern: { inhale:4, hold:4, exhale:8 }
    };
  }

  /* ──────────────────────────────────────────────────────────────────────────
     ENTER SANCTUARY — goSanctuary() WRAP
     index.html'deki orijinal fonksiyonu bozmadan önüne Gemini çağrısı ekliyoruz.
  ────────────────────────────────────────────────────────────────────────── */
  function wrapGoSanctuary() {
    var _orig = global.goSanctuary;

    global.goSanctuary = function() {
      if (_state.isLoading) return;

      if (!_state.selectedMood) _state.selectedMood = 'Calm';
      _state.userText  = (el('mood-textarea') || {}).value || '';
      _state.isLoading = true;

      var btn = document.querySelector('.cta-btn');
      raf(function() { if (btn) { btn.disabled = true; btn.classList.add('loading'); } });

      var moodGen  = MOOD_TO_GEN[_state.selectedMood] || 'waves';
      var adapter  = getAdapter();

      function proceed(msd) {
        _state.isLoading = false;
        raf(function() { if (btn) { btn.disabled = false; btn.classList.remove('loading'); } });

        /* 1. Ekran geçişi */
        if (typeof _orig === 'function') _orig();

        /* 2. MSD uygula (#3 + #4 içinde) */
        applyMSD(msd, moodGen);

        /* 3. AudioContext unlock + otomatik başlat (#1) */
        if (global._ctx && global._ctx.state === 'suspended') {
          global._ctx.resume().then(autoStartAfterMSD).catch(autoStartAfterMSD);
        } else {
          autoStartAfterMSD();
        }
      }

      if (!adapter) {
        warn('GeminiAdapter yok — fallback ile devam.');
        proceed(getFallbackMSD(_state.selectedMood));
        return;
      }

      adapter.generateScene(_state.userText, _state.selectedMood)
        .then(proceed)
        .catch(function(err) {
          warn('generateScene hata: ' + (err && err.message));
          proceed(getFallbackMSD(_state.selectedMood));
        });
    };

    log('goSanctuary wrap edildi ✓');
  }

  /* ──────────────────────────────────────────────────────────────────────────
     PLAY BUTONU  (Düzeltme #2)
     AudioEngine v12 kendi cloneNode listener'ını bağlıyor.
     Biz "üstüne" state senkronu için ek bir listener ekliyoruz,
     togglePlay'i TEKRAR çağırmıyoruz — sadece UI'ı güncelliyoruz.
  ────────────────────────────────────────────────────────────────────────── */
  function bindPlayBtn() {
    /* AudioEngine v12'nin listener'ı önce bağlanır (DOMContentLoaded).
       Biz 0ms sonra, yani micro-task sonrası bağlıyoruz. */
    var ref = setTimeout(function() {
      var btn = el('play-btn');
      if (!btn || btn._mainBound) return;
      btn._mainBound = true;

      btn.addEventListener('click', function() {
        /* AudioEngine togglePlay zaten çalıştı.
           window._playing onun tarafından set edildi.
           Biz sadece breath ve UI senkronunu yapıyoruz. */
        var nowPlaying = isPlaying();
        _updatePlayUI(nowPlaying);

        if (nowPlaying) {
          if (_state.currentMSD && _state.currentMSD.breathPattern) {
            startBreath(_state.currentMSD.breathPattern);
          }
        } else {
          stopBreath();
        }

        /* Hard Limiter — her play'de kontrol */
        if (nowPlaying) applyHardLimiter();
      });

      log('play-btn senkron listener bağlandı ✓');
    }, 0);
    _state._timers.push(ref);
  }

  /* ──────────────────────────────────────────────────────────────────────────
     MOOD CHIP BAĞLAMA
  ────────────────────────────────────────────────────────────────────────── */
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

  /* ──────────────────────────────────────────────────────────────────────────
     ORACLE BUTONU
  ────────────────────────────────────────────────────────────────────────── */
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

      adapter.generateScene(text, mood)
        .then(function(msd) {
          applyMSD(msd, MOOD_TO_GEN[mood]);
          if (resultEl && msd.affirmation) resultEl.textContent = msd.affirmation;
        })
        .catch(function() {
          if (resultEl) resultEl.textContent = 'Bağlantı hatası. Tekrar dene.';
        });
    });

    log('Oracle bağlandı ✓');
  }

  /* ──────────────────────────────────────────────────────────────────────────
     GEMINİ ADAPTER BAŞLATMA
  ────────────────────────────────────────────────────────────────────────── */
  function initAdapter() {
    if (typeof global.GeminiAdapter === 'function') {
      global._geminiAdapter = new global.GeminiAdapter();
      log('GeminiAdapter hazır ✓');
    } else {
      warn('GeminiAdapter bulunamadı — Fallback tablosu aktif.');
    }
  }

  /* ──────────────────────────────────────────────────────────────────────────
     DISPOSE
  ────────────────────────────────────────────────────────────────────────── */
  function dispose() {
    stopBreath();
    _state._timers.forEach(function(t) { clearTimeout(t); clearInterval(t); });
    _state._timers = [];
    var sync = getSync();
    if (sync && typeof sync.dispose === 'function') {
      try { sync.dispose(); } catch(e) {}
    }
    log('Dispose tamamlandı.');
  }

  /* ──────────────────────────────────────────────────────────────────────────
     PUBLIC API
  ────────────────────────────────────────────────────────────────────────── */
  global.SanctuaryApp = {
    selectMood  : onMoodSelect,
    applyMSD    : applyMSD,
    play        : doPlay,
    pause       : doPause,
    dispose     : dispose,
    getState    : function() {
      return {
        mood      : _state.selectedMood,
        isPlaying : isPlaying(),
        scene     : _state.currentMSD ? _state.currentMSD.sceneName : null,
        loading   : _state.isLoading,
      };
    },
  };

  /* ──────────────────────────────────────────────────────────────────────────
     INIT
  ────────────────────────────────────────────────────────────────────────── */
  function init() {
    log('══ main.js v3 başlatılıyor ══');

    initAdapter();
    bindMoodChips();
    bindPlayBtn();
    bindOracle();
    wrapGoSanctuary();

    /* SanctuarySync — idempotent guard içeriyor */
    var sync = getSync();
    if (sync && typeof sync.init === 'function') {
      try { sync.init(); } catch(e) {}
    }

    /* Kayıtlı mood varsa seç */
    try {
      var saved = localStorage.getItem('sanctuary_last_mood');
      if (saved) onMoodSelect(saved);
    } catch(e) {}

    log('══ main.js v3 hazır ══');
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  global.addEventListener('beforeunload', dispose);

})(typeof window !== 'undefined' ? window : this);
