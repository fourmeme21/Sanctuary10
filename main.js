/* ═══════════════════════════════════════════════════════════════════════════
   SANCTUARY — main.js  v4  (Hibrit Maestro)
   ─────────────────────────────────────────────────────────────────────────────
   YENİLİKLER:
     1. Velvet Audio Master Bus
        AudioEngine'in _comp → destination bağlantısını ARAYA GİRİP
        _comp → velvetLP → velvetLimiter → velvetGain → destination
        zinciriyle değiştiriyoruz.
        • velvetLP     : BiquadFilter lowpass 15000 Hz  → keskin tizleri traşlar
        • velvetLimiter: DynamicsCompressor (-3dB, 12:1) → dijital patlama yok
        • velvetGain   : GainNode 0.88                  → güvenli çıkış seviyesi

     2. Maestro Reçete Sistemi
        GeminiAdapter'dan gelen yeni JSON formatını parse eder:
        { binauralHz, baseHz, textures:[{name,gain}], breath:[i,h,e] }
        textures.name → fuzzy match → SampleManager layer
        Geriye dönük uyumluluk: eski MSD objesi de çalışmaya devam eder.

     3. Otomatik Başlatma (v3'ten korundu, güçlendirildi)
     4. window._playing single-source-of-truth (v3'ten korundu)

   EKRAN ID'LERİ: screen-mood / screen-sanctuary / screen-analytics
   GEÇİŞ FONK. : goSanctuary() / goBack()  (index.html'de, wrap ediyoruz)
   ═══════════════════════════════════════════════════════════════════════════ */

(function (global) {
  'use strict';

  /* ──────────────────────────────────────────────────────────────────────────
     YARDIMCI
  ────────────────────────────────────────────────────────────────────────── */
  function el(id)  { return document.getElementById(id); }
  function raf(fn) { requestAnimationFrame(fn); }
  var TAG = '[Sanctuary]';
  function log(msg)  { console.info(TAG,  msg); }
  function warn(msg) { console.warn(TAG,  msg); }

  /* ──────────────────────────────────────────────────────────────────────────
     DURUM
  ────────────────────────────────────────────────────────────────────────── */
  var _state = {
    selectedMood  : null,
    userText      : '',
    currentMSD    : null,   /* son MSD veya Maestro reçetesi */
    isLoading     : false,
    breathTimer   : null,
    velvetReady   : false,  /* Master Bus kuruldu mu? */
    _timers       : [],
  };

  /* AudioEngine'in tek gerçeği */
  function isPlaying() { return !!global._playing; }

  /* Modül referansları */
  function getSync()    { return global.SanctuarySync || null; }
  function getFM()      { return global._sancFM        || null; }
  function getSM()      { return global._sancSM        || null; }
  function getAdapter() { return global._geminiAdapter || null; }

  /* ══════════════════════════════════════════════════════════════════════════
     1. VELVET AUDIO MASTER BUS
     AudioEngine'de mevcut zincir:
       _comp → ctx.destination
     Biz bunu şuna çeviriyoruz:
       _comp → velvetLP → velvetLimiter → velvetGain → ctx.destination

     AudioEngine ensureMaster() çalıştıktan sonra bağlantıyı kuruyoruz.
     ensureMaster'ın çalışması için togglePlay'in ilk çağrısını bekliyoruz.
  ══════════════════════════════════════════════════════════════════════════ */

  var _velvetLP      = null;
  var _velvetLimiter = null;
  var _velvetGain    = null;

  function installVelvetBus() {
    if (_state.velvetReady) return;

    var ctx  = global._ctx;
    var comp = global._comp;   /* AudioEngine'in son kompresörü */
    if (!ctx || !comp) return;

    try {
      /* --- Low-Pass Filter: 15 kHz üstünü traşla --- */
      _velvetLP = ctx.createBiquadFilter();
      _velvetLP.type            = 'lowpass';
      _velvetLP.frequency.value = 15000;
      _velvetLP.Q.value         = 0.5;   /* yumuşak kesim eğrisi */

      /* --- Limiter: -3 dB threshold, 12:1 ratio --- */
      _velvetLimiter = ctx.createDynamicsCompressor();
      _velvetLimiter.threshold.value = -3;
      _velvetLimiter.knee.value      = 10;
      _velvetLimiter.ratio.value     = 12;
      _velvetLimiter.attack.value    = 0.001;  /* anlık tepki */
      _velvetLimiter.release.value   = 0.15;

      /* --- Output Gain: güvenli çıkış seviyesi --- */
      _velvetGain = ctx.createGain();
      _velvetGain.gain.value = 0.88;

      /* --- Bağlantı: _comp'u destination'dan ayır, araya gir --- */
      try { comp.disconnect(ctx.destination); } catch(e) { /* zaten bağlı değilse sorun değil */ }

      comp.connect(_velvetLP);
      _velvetLP.connect(_velvetLimiter);
      _velvetLimiter.connect(_velvetGain);
      _velvetGain.connect(ctx.destination);

      /* Global referans — debug/dispose için */
      global._velvetLP      = _velvetLP;
      global._velvetLimiter = _velvetLimiter;
      global._velvetGain    = _velvetGain;

      _state.velvetReady = true;
      log('Velvet Audio Master Bus kuruldu ✓  (LP:15kHz | Limiter:-3dB,12:1 | Gain:0.88)');
    } catch(e) {
      warn('Velvet Bus kurulum hatası: ' + e.message);
    }
  }

  /* AudioEngine ilk togglePlay'den sonra _ctx ve _comp hazır olur.
     Biz o anı yakalamak için togglePlay'i de wrap ediyoruz — sadece
     ilk çağrıda Bus'ı kuruyoruz, sonra kendimizi devreden çıkarıyoruz. */
  function hookTogglePlayForVelvet() {
    var _origTP = global.togglePlay;
    if (!_origTP) return;

    global.togglePlay = function() {
      /* Orijinali çağır — AudioEngine _ctx ve _comp'u oluşturur */
      _origTP.apply(this, arguments);

      /* Bus henüz kurulmadıysa şimdi kur */
      if (!_state.velvetReady) {
        /* ensureMaster senkron, hemen erişilebilir */
        installVelvetBus();
      }

      /* Bir kez kurulduktan sonra wrap'i kaldır, orijinalini geri koy */
      if (_state.velvetReady) {
        global.togglePlay = _origTP;
        log('togglePlay hook kaldırıldı (Velvet Bus aktif)');
      }
    };
    log('togglePlay Velvet hook bağlandı ✓');
  }

  /* ══════════════════════════════════════════════════════════════════════════
     2. MAESTRO REÇETE SİSTEMİ

     Yeni format (Gemini'den beklenen):
       {
         "binauralHz" : 4.0,
         "baseHz"     : 200,
         "textures"   : [{"name":"ocean","gain":0.5},{"name":"piano","gain":0.3}],
         "breath"     : [4, 4, 8]
       }

     Geriye dönük uyumluluk: eski MSD formatı (sceneName, frequencySuggestion,
     breathPattern...) da normalleştirilerek çalışır.
  ══════════════════════════════════════════════════════════════════════════ */

  /* --- Fuzzy Match tablosu ---
     texture.name (Gemini'den) → SampleManager'ın bildiği layer ID'si
     Anahtar: küçük harf keyword parçası                                   */
  var TEXTURE_FUZZY = [
    /* Su / dalga */
    { keys:['ocean','sea','wave','deniz','dalga','su','water','biolum','aqua'], layer:'waves_calm'  },
    /* Yağmur */
    { keys:['rain','yağmur','storm','fırtına','drizzle','shower'],             layer:'rain_light'  },
    /* Rüzgar / kuşlar */
    { keys:['wind','rüzgar','breeze','esinti','air','hava'],                   layer:'wind_soft'   },
    { keys:['bird','kuş','chirp','forest','orman','nature','doğa','jungle'],   layer:'birds_far'   },
  ];

  /* Bilinen SampleManager ortam layer ID'leri */
  var KNOWN_LAYERS = ['waves_calm', 'rain_light', 'wind_soft', 'birds_far'];

  /**
   * texture.name → SampleManager layer ID
   * Önce direkt eşleşme dener, sonra fuzzy.
   */
  function fuzzyMatchLayer(name) {
    if (!name) return 'waves_calm';
    var lower = name.toLowerCase().trim();

    /* Direkt eşleşme */
    if (KNOWN_LAYERS.indexOf(lower) !== -1) return lower;

    /* Fuzzy keyword */
    for (var i = 0; i < TEXTURE_FUZZY.length; i++) {
      var entry = TEXTURE_FUZZY[i];
      for (var j = 0; j < entry.keys.length; j++) {
        if (lower.indexOf(entry.keys[j]) !== -1) {
          log('Fuzzy: "' + name + '" → ' + entry.layer);
          return entry.layer;
        }
      }
    }

    warn('Fuzzy eşleşme bulunamadı: "' + name + '" → waves_calm (default)');
    return 'waves_calm';
  }

  /* Enstrüman adlarını SampleManager'ın bildiği tiplere çevir */
  var INSTRUMENT_FUZZY = [
    { keys:['piano','piyano','keys','keyboard'],          type:'piano'  },
    { keys:['guitar','gitar','acoustic','string'],        type:'guitar' },
    { keys:['flute','flüt','flüt','bamboo','breath'],     type:'flute'  },
  ];

  function fuzzyMatchInstrument(name) {
    if (!name) return null;
    var lower = name.toLowerCase().trim();
    for (var i = 0; i < INSTRUMENT_FUZZY.length; i++) {
      var entry = INSTRUMENT_FUZZY[i];
      for (var j = 0; j < entry.keys.length; j++) {
        if (lower.indexOf(entry.keys[j]) !== -1) return entry.type;
      }
    }
    return null;
  }

  /* --- Reçete Normalize Edici ---
     Hem yeni Maestro formatını hem eski MSD formatını kabul eder.
     Her iki durumda da aynı iç yapıya (NormalizedRecipe) dönüştürür.   */
  function normalizeRecipe(raw) {
    if (!raw) return null;

    /* Yeni Maestro formatı: binauralHz + baseHz + textures + breath dizisi */
    if (raw.baseHz || raw.binauralHz || Array.isArray(raw.breath)) {
      var breath = Array.isArray(raw.breath) && raw.breath.length >= 2
        ? { inhale: raw.breath[0] || 4, hold: raw.breath[1] || 0, exhale: raw.breath[2] || 8 }
        : { inhale: 4, hold: 4, exhale: 8 };

      return {
        _format      : 'maestro',
        baseHz       : raw.baseHz        || 432,
        binauralHz   : raw.binauralHz    || 7,
        textures     : Array.isArray(raw.textures) ? raw.textures : [],
        breathPattern: breath,
        sceneName    : raw.sceneName     || _inferSceneFromTextures(raw.textures),
        intensity    : raw.intensity     || 0.5,
      };
    }

    /* Eski MSD formatı: sceneName + frequencySuggestion + breathPattern */
    return {
      _format      : 'msd',
      baseHz       : raw.frequencySuggestion || 432,
      binauralHz   : raw.binaural_beat_hz    || 7,
      textures     : [],
      breathPattern: raw.breathPattern || { inhale:4, hold:4, exhale:8 },
      sceneName    : raw.sceneName     || 'Calm Breath',
      intensity    : raw.intensity     || 0.5,
      _raw         : raw,   /* orijinal — updateFromGemini için */
    };
  }

  function _inferSceneFromTextures(textures) {
    if (!Array.isArray(textures) || textures.length === 0) return 'Calm Breath';
    var first = (textures[0].name || '').toLowerCase();
    if (first.indexOf('ocean') !== -1 || first.indexOf('wave') !== -1) return 'Calm Breath';
    if (first.indexOf('rain')  !== -1) return 'Deep Peace';
    if (first.indexOf('wind')  !== -1) return 'Light Breath';
    if (first.indexOf('zen')   !== -1) return 'Zen Garden';
    if (first.indexOf('space') !== -1) return 'Deep Space';
    return 'Calm Breath';
  }

  /* ══════════════════════════════════════════════════════════════════════════
     SAHNE FALLBACK  (v3'ten korundu)
  ══════════════════════════════════════════════════════════════════════════ */
  var MOOD_TO_GEN = {
    'Anxious':'wind', 'Tired':'rain', 'Stressed':'waves',
    'Sad':'waves',    'Calm':'binaural', 'Grateful':'zen',
    'قلق':'wind',    'مجهد':'waves',   'متعب':'rain',
    'حزين':'waves',  'هادئ':'binaural','ممتنّ':'zen',
  };

  var KNOWN_SCENES = [
    'Calm Breath','Deep Peace','Light Breath','Focus Flow',
    'Heart Resonance','Energy Renewal','Zen Garden','Deep Space',
    'Earth Grounding','Night Forest','Morning Mist',
    'Joyful Radiance','Morning Light','تنفس هادئ','سلام عميق',
  ];

  var SCENE_KEYWORD_MAP = [
    { keys:['ocean','sea','wave','deniz','dalga','biolum','aqua'], gen:'waves'    },
    { keys:['rain','yağmur','storm','drizzle'],                    gen:'rain'     },
    { keys:['wind','rüzgar','breeze','esinti','air'],              gen:'wind'     },
    { keys:['fire','ateş','flame','campfire'],                     gen:'fire'     },
    { keys:['forest','orman','jungle','nature','night'],           gen:'forest'   },
    { keys:['zen','garden','bahçe','temple'],                      gen:'zen'      },
    { keys:['space','uzay','cosmos','galaxy','deep'],              gen:'space'    },
    { keys:['earth','toprak','ground','grounding'],                gen:'earth'    },
    { keys:['morning','sabah','dawn','mist','sis'],                gen:'morning'  },
    { keys:['binaural','heart','kalp','resonance'],                gen:'binaural' },
  ];

  function resolveScene(sceneName, moodGen) {
    if (KNOWN_SCENES.indexOf(sceneName) !== -1) {
      return { scene: sceneName, gen: moodGen || 'waves' };
    }
    var lower = (sceneName || '').toLowerCase();
    for (var i = 0; i < SCENE_KEYWORD_MAP.length; i++) {
      var e = SCENE_KEYWORD_MAP[i];
      for (var j = 0; j < e.keys.length; j++) {
        if (lower.indexOf(e.keys[j]) !== -1) {
          var s = genToDefaultScene(e.gen);
          log('Scene fallback: "' + sceneName + '" → ' + s);
          return { scene: s, gen: e.gen };
        }
      }
    }
    var dg = moodGen || 'waves';
    return { scene: genToDefaultScene(dg), gen: dg };
  }

  function genToDefaultScene(gen) {
    var m = {
      waves:'Calm Breath', rain:'Deep Peace',   wind:'Light Breath',
      fire:'Energy Renewal', forest:'Night Forest', zen:'Zen Garden',
      space:'Deep Space',  earth:'Earth Grounding', morning:'Morning Mist',
      binaural:'Heart Resonance',
    };
    return m[gen] || 'Calm Breath';
  }

  /* ══════════════════════════════════════════════════════════════════════════
     MSD / REÇETE UYGULAYICI  (v4 — Maestro formatı + Velvet uyumu)
  ══════════════════════════════════════════════════════════════════════════ */
  function applyMSD(raw, moodGen) {
    var recipe = normalizeRecipe(raw);
    if (!recipe) return;
    _state.currentMSD = recipe;

    var base  = recipe.baseHz;
    var beat  = recipe.binauralHz;
    var gen   = moodGen || MOOD_TO_GEN[_state.selectedMood] || 'waves';

    /* Sahne adı çözümle */
    var resolved = resolveScene(recipe.sceneName, gen);
    var scene = resolved.scene;
    gen       = resolved.gen;

    /* Intensity güvenli aralık */
    var safeIntensity = Math.max(0.1, Math.min(0.65, parseFloat(recipe.intensity) || 0.5));

    log('Reçete (' + recipe._format + ') → "' + scene + '" | ' + base + 'Hz | beat:' + beat + 'Hz | gen:' + gen);

    /* localStorage — AudioEngine togglePlay'in okuyacağı */
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

    /* 2. SanctuarySync.activate — atomik */
    var sync = getSync();
    if (sync && typeof sync.activate === 'function') {
      try { sync.activate(gen, base, beat, scene); }
      catch(e) { warn('SanctuarySync: ' + e.message); }
    } else if (typeof global.switchSound === 'function') {
      global.switchSound(gen, base, beat, scene, { sceneName: scene });
    }

    /* 3. Maestro Texture Uygulaması — SampleManager'a layer + gain gönder */
    _applyTextures(recipe.textures, safeIntensity, scene);

    /* 4. AudioEngine.updateFromGemini (v12) — eski MSD gönder */
    if (typeof global.updateFromGemini === 'function') {
      try { global.updateFromGemini(recipe._raw || raw); } catch(e) {}
    }

    /* 5. Nefes animasyonu */
    if (recipe.breathPattern) startBreath(recipe.breathPattern);

    /* 6. UI */
    raf(function() {
      var badge = el('freq-badge');
      var lbl   = el('freq-label');
      if (badge) { badge.classList.add('on'); badge.style.opacity = '1'; }
      if (lbl)   lbl.textContent = base + ' Hz · ' + scene;
    });
  }

  /**
   * Maestro textures dizisini SampleManager'a uygular.
   * Her texture: { name, gain } → fuzzy match → layer ID + kazanç
   */
  function _applyTextures(textures, globalIntensity, sceneName) {
    var sm = getSM();

    /* Eski applyScene çağrısı (her zaman) */
    if (sm && typeof sm.applyScene === 'function') {
      sm.applyScene(sceneName).catch(function(e) {
        warn('SM.applyScene: ' + e.message);
      });
    }

    /* Gemini'den texture dizisi geldiyse ek olarak applyGeminiData */
    if (sm && typeof sm.applyGeminiData === 'function') {
      var activeElements = [];
      var spatialHints   = [];

      if (Array.isArray(textures) && textures.length > 0) {
        textures.forEach(function(t) {
          var layerId    = fuzzyMatchLayer(t.name);
          var instrType  = fuzzyMatchInstrument(t.name);
          var safeGain   = Math.max(0.05, Math.min(0.75, parseFloat(t.gain) || 0.4));

          /* active_elements için eleman adı */
          if (layerId === 'birds_far')  activeElements.push('birds');
          if (layerId === 'wind_soft')  activeElements.push('wind');
          if (layerId === 'rain_light') activeElements.push('rain');
          if (layerId === 'waves_calm') activeElements.push('water');
          if (instrType) activeElements.push(instrType);

          log('Texture: "' + t.name + '" → layer:' + layerId + ' gain:' + safeGain.toFixed(2));
        });
      }

      try {
        sm.applyGeminiData({
          active_elements : activeElements,
          intensity       : globalIntensity,
          spatial_hints   : spatialHints,
          emotion         : _state.selectedMood || '',
        });
      } catch(e) { warn('SM.applyGeminiData: ' + e.message); }
    }
  }

  /* ══════════════════════════════════════════════════════════════════════════
     NEFES ANİMASYONU
  ══════════════════════════════════════════════════════════════════════════ */
  var BREATH_LABELS = { inhale:'Nefes Al', hold:'Tut', exhale:'Ver' };

  function startBreath(bp) {
    stopBreath();
    if (!bp || typeof bp.inhale !== 'number') return;

    var total = (bp.inhale || 4) + (bp.hold || 0) + (bp.exhale || 4);
    document.documentElement.style.setProperty('--breath-speed', total + 's');

    var circle    = document.querySelector('.breath-circle');
    var breathLbl = document.querySelector('.breath-label');
    var phases    = ['inhale','hold','exhale'];
    var durs      = [bp.inhale, bp.hold || 0, bp.exhale];
    var idx       = 0;

    function tick() {
      if (phases[idx] === 'hold' && durs[idx] === 0) idx = (idx + 1) % 3;
      var phase = phases[idx], dur = durs[idx];
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
  }

  function stopBreath() {
    if (_state.breathTimer) { clearTimeout(_state.breathTimer); _state.breathTimer = null; }
    var circle    = document.querySelector('.breath-circle');
    var breathLbl = document.querySelector('.breath-label');
    if (circle)    circle.setAttribute('data-phase', 'idle');
    if (breathLbl) breathLbl.textContent = '';
  }

  /* ══════════════════════════════════════════════════════════════════════════
     PLAY / PAUSE  (window._playing single source of truth)
  ══════════════════════════════════════════════════════════════════════════ */
  function doPlay() {
    if (isPlaying()) { _updatePlayUI(true); return; }
    var resume = (global._ctx && global._ctx.state === 'suspended')
      ? global._ctx.resume() : Promise.resolve();
    resume.then(function() {
      if (typeof global.togglePlay === 'function') global.togglePlay();
      /* togglePlay senkron — hemen UI güncelle, sonra bir tick sonra tekrar kontrol et */
      _updatePlayUI(true);
      setTimeout(function() { _updatePlayUI(isPlaying()); }, 50);
      if (_state.currentMSD && _state.currentMSD.breathPattern) {
        startBreath(_state.currentMSD.breathPattern);
      }
    }).catch(function(e) { warn('resume: ' + e); });
  }

  function doPause() {
    if (!isPlaying()) { _updatePlayUI(false); return; }
    if (typeof global.togglePlay === 'function') global.togglePlay();
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

  /* ══════════════════════════════════════════════════════════════════════════
     OTOMATİK BAŞLATMA  (MSD gelince tetiklenir)
  ══════════════════════════════════════════════════════════════════════════ */
  function autoStart() {
    var ref = setTimeout(function() {
      if (!isPlaying()) {
        doPlay();
        /* UI'ı biraz sonra güncelle — AudioEngine state set etsin */
        setTimeout(function() { _updatePlayUI(isPlaying()); }, 200);
        log('Otomatik başlatma ✓');
      } else {
        /* Zaten çalıyorsa sadece UI'ı senkronize et */
        _updatePlayUI(true);
      }
    }, 300);
    _state._timers.push(ref);
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
     FALLBACK MSD
  ══════════════════════════════════════════════════════════════════════════ */
  var FALLBACK_TABLE = {
    'Anxious' :{ sceneName:'Calm Breath',    baseHz:396, binauralHz:8,  textures:[{name:'ocean',gain:0.55},{name:'wind',gain:0.3}],  breath:[4,4,8] },
    'Stressed':{ sceneName:'Deep Peace',     baseHz:432, binauralHz:6,  textures:[{name:'rain',gain:0.55}, {name:'piano',gain:0.25}],breath:[4,2,6] },
    'Tired'   :{ sceneName:'Energy Renewal', baseHz:528, binauralHz:10, textures:[{name:'bird',gain:0.5},  {name:'wind',gain:0.35}], breath:[5,2,5] },
    'Sad'     :{ sceneName:'Light Breath',   baseHz:417, binauralHz:5,  textures:[{name:'ocean',gain:0.6}, {name:'flute',gain:0.25}],breath:[4,2,7] },
    'Calm'    :{ sceneName:'Focus Flow',     baseHz:40,  binauralHz:7,  textures:[{name:'ocean',gain:0.45},{name:'piano',gain:0.3}], breath:[4,4,4] },
    'Grateful':{ sceneName:'Heart Resonance',baseHz:528, binauralHz:10, textures:[{name:'bird',gain:0.5},  {name:'guitar',gain:0.3}],breath:[5,3,6] },
  };

  function getFallbackMSD(mood) {
    return FALLBACK_TABLE[mood] || {
      sceneName:'Calm Breath', baseHz:432, binauralHz:7,
      textures:[{name:'ocean',gain:0.5}], breath:[4,4,8]
    };
  }

  /* ══════════════════════════════════════════════════════════════════════════
     ENTER SANCTUARY — goSanctuary() WRAP
  ══════════════════════════════════════════════════════════════════════════ */
  function wrapGoSanctuary() {
    var _orig = global.goSanctuary;

    global.goSanctuary = function() {
      if (_state.isLoading) return;
      if (!_state.selectedMood) _state.selectedMood = 'Calm';

      _state.userText  = (el('mood-textarea') || {}).value || '';
      _state.isLoading = true;

      var btn = document.querySelector('.cta-btn');
      raf(function() { if (btn) { btn.disabled = true; btn.classList.add('loading'); } });

      var moodGen = MOOD_TO_GEN[_state.selectedMood] || 'waves';
      var adapter = getAdapter();

      function proceed(raw) {
        _state.isLoading = false;
        raf(function() { if (btn) { btn.disabled = false; btn.classList.remove('loading'); } });

        /* Ekran geçişi */
        if (typeof _orig === 'function') _orig();

        /* Reçeteyi uygula */
        applyMSD(raw, moodGen);

        /* AudioContext unlock + otomatik başlat */
        if (global._ctx && global._ctx.state === 'suspended') {
          global._ctx.resume().then(autoStart).catch(autoStart);
        } else {
          autoStart();
        }
      }

      if (!adapter) {
        warn('GeminiAdapter yok — fallback.');
        proceed(getFallbackMSD(_state.selectedMood));
        return;
      }

      adapter.generateScene(_state.userText, _state.selectedMood)
        .then(proceed)
        .catch(function(err) {
          warn('generateScene: ' + (err && err.message));
          proceed(getFallbackMSD(_state.selectedMood));
        });
    };

    log('goSanctuary wrap edildi ✓');
  }

  /* ══════════════════════════════════════════════════════════════════════════
     PLAY BUTONU  (AudioEngine'in listener'ından sonra bağlanır)
  ══════════════════════════════════════════════════════════════════════════ */
  function bindPlayBtn() {
    var ref = setTimeout(function() {
      var btn = el('play-btn');
      if (!btn || btn._mainBound) return;
      btn._mainBound = true;

      btn.addEventListener('click', function() {
        /* AudioEngine togglePlay zaten çalıştı.
           Velvet Bus ilk tıklamada kurulur (hookTogglePlayForVelvet aracılığıyla).
           Biz sadece breath + UI senkronu yapıyoruz. */
        var nowPlaying = isPlaying();
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

      log('play-btn senkron listener bağlandı ✓');
    }, 0);
    _state._timers.push(ref);
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
      adapter.generateScene(text, mood)
        .then(function(raw) {
          applyMSD(raw, MOOD_TO_GEN[mood]);
          if (resultEl && raw.affirmation) resultEl.textContent = raw.affirmation;
        })
        .catch(function() {
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
    _state._timers.forEach(function(t) { clearTimeout(t); clearInterval(t); });
    _state._timers = [];

    /* Velvet Bus temizle */
    if (_velvetGain)    { try { _velvetGain.disconnect();    } catch(e){} }
    if (_velvetLimiter) { try { _velvetLimiter.disconnect(); } catch(e){} }
    if (_velvetLP)      { try { _velvetLP.disconnect();      } catch(e){} }

    var sync = getSync();
    if (sync && typeof sync.dispose === 'function') { try { sync.dispose(); } catch(e){} }
    log('Dispose tamamlandı.');
  }

  /* ══════════════════════════════════════════════════════════════════════════
     PUBLIC API
  ══════════════════════════════════════════════════════════════════════════ */
  global.SanctuaryApp = {
    selectMood : onMoodSelect,
    applyMSD   : applyMSD,
    play       : doPlay,
    pause      : doPause,
    dispose    : dispose,
    getState   : function() {
      return {
        mood       : _state.selectedMood,
        isPlaying  : isPlaying(),
        scene      : _state.currentMSD ? _state.currentMSD.sceneName : null,
        loading    : _state.isLoading,
        velvetBus  : _state.velvetReady,
      };
    },
  };

  /* ══════════════════════════════════════════════════════════════════════════
     INIT
  ══════════════════════════════════════════════════════════════════════════ */
  function init() {
    log('══ main.js v4 (Hibrit Maestro) başlatılıyor ══');

    initAdapter();
    bindMoodChips();
    bindPlayBtn();
    bindOracle();
    wrapGoSanctuary();

    /* Velvet Bus hook — ilk togglePlay'de kurulacak */
    hookTogglePlayForVelvet();

    /* SanctuarySync */
    var sync = getSync();
    if (sync && typeof sync.init === 'function') { try { sync.init(); } catch(e){} }

    /* Kayıtlı mood */
    try {
      var saved = localStorage.getItem('sanctuary_last_mood');
      if (saved) onMoodSelect(saved);
    } catch(e) {}

    log('══ main.js v4 hazır ══');
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  global.addEventListener('beforeunload', dispose);

})(typeof window !== 'undefined' ? window : this);