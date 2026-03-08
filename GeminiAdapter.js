/**
 * GeminiAdapter.js — Sanctuary AI Oracle v3  (Maestro Protokolü)
 * ─────────────────────────────────────────────────────────────────────────────
 * v3 YENİLİKLERİ:
 *   • Maestro Reçete Şeması  — Tek geçerli format:
 *       { baseHz, binauralHz, textures:[{name,gain,freq}], breath:[i,h,e], sceneName }
 *   • Fuzzy Matching Matrix  — textures.name → layer ID eşleştirmesi
 *   • Velvet-Ready Bayrağı   — Her reçete velvetReady:true ile çıkar
 *   • Sidechain Metadata     — textures[].freq: 'low'|'mid'|'high'
 *   • Default Maestro        — 432Hz/4Hz/%60 ocean — eski statik tablo yok
 *   • Geriye dönük uyumluluk — Eski MSD formatı alınırsa dönüştürülür
 *
 * NETLIFY PROXY:  /.netlify/functions/gemini
 * ─────────────────────────────────────────────────────────────────────────────
 * GEMİNİ'YE GÖNDERİLEN SİSTEM PROMPTU:
 *   Proxy fonksiyonu bu formatta cevap dönmeli:
 *   {
 *     "sceneName"  : "Oceanic Stillness",
 *     "baseHz"     : 396,
 *     "binauralHz" : 4.0,
 *     "textures"   : [
 *       {"name": "ocean", "gain": 0.6},
 *       {"name": "piano", "gain": 0.3}
 *     ],
 *     "breath"     : [4, 4, 8]
 *   }
 * ─────────────────────────────────────────────────────────────────────────────
 */

(function(global) {
  'use strict';

  var PROXY_URL  = '/.netlify/functions/gemini';
  var TIMEOUT_MS = 10000;

  /* ══════════════════════════════════════════════════════════════════════════
     DEFAULT MAESTRO REÇETESİ
     432 Hz taşıyıcı / 4 Hz theta / %60 ocean — universal şifa taban çizgisi
  ══════════════════════════════════════════════════════════════════════════ */
  var DEFAULT_MAESTRO = {
    sceneName   : 'Calm Breath',
    baseHz      : 432,
    binauralHz  : 4.0,
    textures    : [
      { name: 'ocean', gain: 0.60, freq: 'low' },
      { name: 'wind',  gain: 0.25, freq: 'mid' },
    ],
    breath      : [4, 4, 8],
    velvetReady : true,
    _source     : 'default_maestro',
  };

  /* ══════════════════════════════════════════════════════════════════════════
     FALLBACK MAESTRO TABLOSU  (mood bazlı)
     Her ruh hali için psikoakustik olarak optimize edilmiş reçete.
     Statik layers[] tablosu KALDIRILDI — artık Maestro formatı kullanılıyor.
  ══════════════════════════════════════════════════════════════════════════ */
  var FALLBACK_MAESTRO = {

    /* ── İngilizce ── */
    'Anxious': {
      sceneName : 'Calm Breath',
      baseHz    : 396, binauralHz: 6.0,
      textures  : [
        { name:'ocean', gain:0.55, freq:'low' },
        { name:'wind',  gain:0.30, freq:'mid' },
        { name:'piano', gain:0.20, freq:'mid' },
      ],
      breath    : [4, 4, 8],
    },
    'Stressed': {
      sceneName : 'Deep Peace',
      baseHz    : 432, binauralHz: 6.0,
      textures  : [
        { name:'rain',  gain:0.55, freq:'mid' },
        { name:'piano', gain:0.25, freq:'mid' },
      ],
      breath    : [4, 2, 6],
    },
    'Tired': {
      sceneName : 'Energy Renewal',
      baseHz    : 528, binauralHz: 10.0,
      textures  : [
        { name:'birds', gain:0.50, freq:'high' },
        { name:'wind',  gain:0.35, freq:'mid'  },
        { name:'guitar',gain:0.20, freq:'mid'  },
      ],
      breath    : [5, 2, 5],
    },
    'Sad': {
      sceneName : 'Light Breath',
      baseHz    : 417, binauralHz: 5.0,
      textures  : [
        { name:'ocean', gain:0.60, freq:'low' },
        { name:'flute', gain:0.25, freq:'high'},
      ],
      breath    : [4, 2, 7],
    },
    'Calm': {
      sceneName : 'Focus Flow',
      baseHz    : 40,  binauralHz: 7.0,
      textures  : [
        { name:'ocean', gain:0.45, freq:'low' },
        { name:'piano', gain:0.30, freq:'mid' },
      ],
      breath    : [4, 4, 4],
    },
    'Grateful': {
      sceneName : 'Heart Resonance',
      baseHz    : 528, binauralHz: 10.0,
      textures  : [
        { name:'birds',  gain:0.50, freq:'high' },
        { name:'guitar', gain:0.30, freq:'mid'  },
      ],
      breath    : [5, 3, 6],
    },

    /* ── Arapça ── */
    'قلق': {
      sceneName : 'تنفس هادئ',
      baseHz    : 396, binauralHz: 6.0,
      textures  : [
        { name:'ocean', gain:0.55, freq:'low' },
        { name:'wind',  gain:0.30, freq:'mid' },
      ],
      breath    : [4, 4, 8],
    },
    'مجهد': {
      sceneName : 'سلام عميق',
      baseHz    : 432, binauralHz: 6.0,
      textures  : [
        { name:'rain',  gain:0.55, freq:'mid' },
        { name:'piano', gain:0.25, freq:'mid' },
      ],
      breath    : [4, 2, 6],
    },
    'متعب': {
      sceneName : 'تجديد الطاقة',
      baseHz    : 528, binauralHz: 10.0,
      textures  : [
        { name:'birds', gain:0.50, freq:'high' },
        { name:'wind',  gain:0.35, freq:'mid'  },
      ],
      breath    : [5, 2, 5],
    },
    'حزين': {
      sceneName : 'نفس النور',
      baseHz    : 417, binauralHz: 5.0,
      textures  : [
        { name:'ocean', gain:0.60, freq:'low' },
        { name:'flute', gain:0.25, freq:'high'},
      ],
      breath    : [4, 2, 7],
    },
    'هادئ': {
      sceneName : 'تدفق التركيز',
      baseHz    : 40,  binauralHz: 7.0,
      textures  : [
        { name:'ocean', gain:0.45, freq:'low' },
        { name:'piano', gain:0.30, freq:'mid' },
      ],
      breath    : [4, 4, 4],
    },
    'ممتنّ': {
      sceneName : 'رنين القلب',
      baseHz    : 528, binauralHz: 10.0,
      textures  : [
        { name:'birds',  gain:0.50, freq:'high' },
        { name:'guitar', gain:0.30, freq:'mid'  },
      ],
      breath    : [5, 3, 6],
    },
  };

  /* ══════════════════════════════════════════════════════════════════════════
     FUZZY MATCHING MATRIX
     Gemini'den gelen serbest metin → SampleManager layer ID + freq band
     Her entry: { keys[], layer, freq }
     freq: 'low' | 'mid' | 'high'  (Sidechain ducking metadata)
  ══════════════════════════════════════════════════════════════════════════ */
  var FUZZY_MATRIX = [

    /* ── Su / Okyanus (LOW freq — sub-bass bölge) ── */
    {
      keys  : ['ocean','sea','wave','dalga','deniz','biolum','aqua',
               'water','su','underwater','surf','coast'],
      layer : 'waves_calm',
      freq  : 'low',
    },

    /* ── Yağmur (MID freq) ── */
    {
      keys  : ['rain','yağmur','heavy_rain','drizzle','shower',
               'monsoon','drops','downpour','sprinkle'],
      layer : 'rain_light',
      freq  : 'mid',
    },

    /* ── Rüzgar (MID freq) ── */
    {
      keys  : ['wind','rüzgar','breeze','esinti','gale','air',
               'hava','draft','zephyr','gust'],
      layer : 'wind_soft',
      freq  : 'mid',
    },

    /* ── Kuş / Orman (HIGH freq) ── */
    {
      keys  : ['bird','kuş','chirp','tweet','robin','sparrow',
               'forest','orman','jungle','nature','doğa',
               'wildlife','woodland','trees'],
      layer : 'birds_far',
      freq  : 'high',
    },

    /* ── Enstrümanlar — Piano (MID) ── */
    {
      keys  : ['piano','piyano','keys','keyboard','grands',
               'ivory','strings','classical'],
      layer : 'instrument_piano',
      freq  : 'mid',
      instrument: 'piano',
    },

    /* ── Enstrümanlar — Gitar (MID) ── */
    {
      keys  : ['guitar','gitar','acoustic','string','strum',
               'fingerpick','ukulele','lute'],
      layer : 'instrument_guitar',
      freq  : 'mid',
      instrument: 'guitar',
    },

    /* ── Enstrümanlar — Flüt (HIGH) ── */
    {
      keys  : ['flute','flüt','bamboo','breath','woodwind',
               'pan flute','shakuhachi','nay','ney','reed'],
      layer : 'instrument_flute',
      freq  : 'high',
      instrument: 'flute',
    },

    /* ── Ateş / Şömine (LOW-MID) ── */
    {
      keys  : ['fire','ateş','flame','alev','campfire',
               'fireplace','hearth','crackle'],
      layer : 'waves_calm',   /* en yakın ambiyans fallback */
      freq  : 'low',
    },

    /* ── Gece / Böcek sesleri (HIGH) ── */
    {
      keys  : ['night','gece','cricket','cicada','insect',
               'böcek','ağustos','frog','kurbağa','owl'],
      layer : 'birds_far',
      freq  : 'high',
    },
  ];

  /* ══════════════════════════════════════════════════════════════════════════
     SAHNE → GEN HARİTASI (main.js için)
  ══════════════════════════════════════════════════════════════════════════ */
  var SCENE_TO_GEN = {
    'Calm Breath'    : 'waves',    'Deep Peace'     : 'rain',
    'Light Breath'   : 'wind',     'Focus Flow'     : 'binaural',
    'Heart Resonance': 'binaural', 'Energy Renewal' : 'wind',
    'Zen Garden'     : 'zen',      'Deep Space'     : 'space',
    'Earth Grounding': 'earth',    'Night Forest'   : 'forest',
    'Morning Mist'   : 'morning',  'Joyful Radiance': 'zen',
    'Morning Light'  : 'morning',
    /* Arapça */
    'تنفس هادئ' : 'waves',  'سلام عميق'    : 'rain',
    'تجديد الطاقة':'wind',  'نفس النور'    : 'waves',
    'تدفق التركيز':'binaural','رنين القلب'  : 'binaural',
  };

  /* ══════════════════════════════════════════════════════════════════════════
     FUZZY MATCH — Texture adını eşleştir
  ══════════════════════════════════════════════════════════════════════════ */
  function fuzzyMatch(name) {
    if (!name) return { layer: 'waves_calm', freq: 'low', instrument: null };
    var lower = String(name).toLowerCase().trim();

    /* Direkt eşleşme */
    for (var i = 0; i < FUZZY_MATRIX.length; i++) {
      var entry = FUZZY_MATRIX[i];
      for (var j = 0; j < entry.keys.length; j++) {
        if (lower === entry.keys[j]) {
          return {
            layer      : entry.layer,
            freq       : entry.freq,
            instrument : entry.instrument || null,
          };
        }
      }
    }

    /* Kısmi eşleşme */
    for (var i = 0; i < FUZZY_MATRIX.length; i++) {
      var entry = FUZZY_MATRIX[i];
      for (var j = 0; j < entry.keys.length; j++) {
        if (lower.indexOf(entry.keys[j]) !== -1 ||
            entry.keys[j].indexOf(lower) !== -1) {
          return {
            layer      : entry.layer,
            freq       : entry.freq,
            instrument : entry.instrument || null,
          };
        }
      }
    }

    /* Hiç eşleşmezse: default */
    console.warn('[GeminiAdapter] Fuzzy eşleşme yok: "' + name + '" → waves_calm');
    return { layer: 'waves_calm', freq: 'low', instrument: null };
  }

  /* ══════════════════════════════════════════════════════════════════════════
     TEXTURE ENRİCHMENT
     Her texture'a fuzzy match sonucu + freq (sidechain metadata) ekler.
     Gain güvenli aralığa kırpılır: 0.05 – 0.75
  ══════════════════════════════════════════════════════════════════════════ */
  function enrichTextures(textures) {
    if (!Array.isArray(textures)) return [];

    return textures.map(function(t) {
      var matched   = fuzzyMatch(t.name);
      var safeGain  = Math.max(0.05, Math.min(0.75, parseFloat(t.gain) || 0.4));

      return {
        name       : t.name,
        gain       : safeGain,
        layer      : matched.layer,
        freq       : t.freq || matched.freq,      /* Gemini gönderirse kullan, yoksa fuzzy */
        instrument : matched.instrument,
      };
    });
  }

  /* ══════════════════════════════════════════════════════════════════════════
     MAEStro ŞEMA DOĞRULAYICI
     Yeni zorunlu format:
       baseHz (float), binauralHz (float), textures (array≥1), breath (array≥2)
     sceneName opsiyonel — yoksa çıkarılabilir.
  ══════════════════════════════════════════════════════════════════════════ */
  function validateMaestro(data) {
    if (!data || typeof data !== 'object')           return false;

    /* baseHz */
    if (typeof data.baseHz !== 'number' ||
        data.baseHz < 20 || data.baseHz > 2000)     return false;

    /* binauralHz */
    if (typeof data.binauralHz !== 'number' ||
        data.binauralHz < 0.5 || data.binauralHz > 40) return false;

    /* textures */
    if (!Array.isArray(data.textures) ||
        data.textures.length < 1)                   return false;
    for (var i = 0; i < data.textures.length; i++) {
      var t = data.textures[i];
      if (!t || typeof t.name !== 'string')          return false;
      if (typeof t.gain !== 'number' ||
          t.gain < 0 || t.gain > 1)                  return false;
    }

    /* breath */
    if (!Array.isArray(data.breath) ||
        data.breath.length < 2)                     return false;
    if (typeof data.breath[0] !== 'number' ||
        typeof data.breath[data.breath.length-1] !== 'number') return false;

    return true;
  }

  /* ══════════════════════════════════════════════════════════════════════════
     ESKİ MSD FORMATINI DÖNÜŞTÜR (geriye dönük uyumluluk)
     frequencySuggestion + layers + breathPattern → Maestro formatına
  ══════════════════════════════════════════════════════════════════════════ */
  function convertLegacyMSD(msd) {
    if (!msd) return null;

    /* Eski layers → textures */
    var textures = [];
    if (Array.isArray(msd.layers)) {
      msd.layers.forEach(function(l) {
        textures.push({
          name: l.type === 'binaural' ? 'ocean' : (l.id || 'ocean'),
          gain: parseFloat(l.volume) || 0.4,
        });
      });
    }
    if (textures.length === 0) {
      textures = [{ name: 'ocean', gain: 0.6 }];
    }

    /* Eski breathPattern → breath dizisi */
    var bp     = msd.breathPattern || {};
    var breath = [bp.inhale || 4, bp.hold || 0, bp.exhale || 8];

    console.info('[GeminiAdapter] Legacy MSD → Maestro formatına dönüştürüldü.');

    return {
      sceneName  : msd.sceneName           || 'Calm Breath',
      baseHz     : msd.frequencySuggestion || 432,
      binauralHz : msd.binaural_beat_hz    || 7,
      textures   : textures,
      breath     : breath,
      _converted : true,
    };
  }

  /* ══════════════════════════════════════════════════════════════════════════
     FİNAL REÇETE MONTAJCI
     Ham veriden (Gemini veya fallback) tam bir Maestro reçetesi üretir.
     Velvet-Ready bayrağı + sidechain metadata burada eklenir.
  ══════════════════════════════════════════════════════════════════════════ */
  function buildRecipe(raw, mood) {
    var base;

    if (validateMaestro(raw)) {
      /* ✅ Geçerli Maestro formatı */
      base = raw;
    } else if (raw && raw.frequencySuggestion) {
      /* ⚠️  Eski MSD formatı — dönüştür */
      base = convertLegacyMSD(raw);
    } else {
      /* ❌ Geçersiz veya boş — Default Maestro */
      console.warn('[GeminiAdapter] Geçersiz format → Default Maestro devreye girdi.');
      base = FALLBACK_MAESTRO[mood] || DEFAULT_MAESTRO;
    }

    /* Breath dizisini nesneye çevir */
    var breathArr = Array.isArray(base.breath) ? base.breath : [4, 0, 8];
    var breathPattern = {
      inhale : breathArr[0] || 4,
      hold   : breathArr[1] || 0,
      exhale : breathArr[breathArr.length - 1] || 8,
    };

    /* Texture'ları zenginleştir (fuzzy + freq metadata) */
    var enrichedTextures = enrichTextures(base.textures);

    /* Sidechain ducking haritası:
       LOW tekstürler (ocean/fire) → sentetik sub-pad'i duckla
       MID tekstürler (piano/rain) → mid-band osilatörleri duckla
       HIGH tekstürler (birds/flute) → high-end shimmer'ı duckla     */
    var sidechainMap = { low: [], mid: [], high: [] };
    enrichedTextures.forEach(function(t) {
      if (sidechainMap[t.freq]) sidechainMap[t.freq].push(t.name);
    });

    /* Gen çıkar */
    var genFromScene = SCENE_TO_GEN[base.sceneName] || 'waves';

    return {
      /* ── Temel Maestro Alanları ── */
      sceneName    : base.sceneName  || 'Calm Breath',
      baseHz       : base.baseHz     || 432,
      binauralHz   : base.binauralHz || 7,
      textures     : enrichedTextures,
      breath       : breathArr,
      breathPattern: breathPattern,

      /* ── main.js Uyumluluk Alanları ── */
      gen          : genFromScene,
      frequencySuggestion: base.baseHz || 432,   /* geriye dönük */

      /* ── Velvet Audio Bayrağı ── */
      velvetReady  : true,

      /* ── Sidechain Metadata ── */
      sidechainMap : sidechainMap,

      /* ── Meta ── */
      _mood        : mood || null,
      _source      : base._source || (base._converted ? 'legacy_converted' : 'gemini'),
    };
  }

  /* ══════════════════════════════════════════════════════════════════════════
     ANA SINIF
  ══════════════════════════════════════════════════════════════════════════ */
  function GeminiAdapter(config) {
    config = config || {};
    this._proxyUrl = config.proxyUrl || PROXY_URL;
    this._timeout  = config.timeout  || TIMEOUT_MS;
  }

  /**
   * Kullanıcı girdisine göre Maestro Reçetesi üretir.
   * @param  {string} userInput    — Serbest metin
   * @param  {string} selectedMood — Seçilen ruh hali
   * @returns {Promise<MaestroRecipe>}
   */
  GeminiAdapter.prototype.generateScene = function(userInput, selectedMood) {
    var self = this;

    return new Promise(function(resolve) {
      var controller = new AbortController();

      /* Timeout */
      var timeoutId = setTimeout(function() {
        controller.abort();
        console.warn('[GeminiAdapter] Timeout (' + self._timeout + 'ms) → Fallback Maestro.');
        resolve(buildRecipe(null, selectedMood));
      }, self._timeout);

      fetch(self._proxyUrl, {
        method  : 'POST',
        headers : { 'Content-Type': 'application/json' },
        signal  : controller.signal,
        body    : JSON.stringify({
          mood    : selectedMood,
          input   : userInput || '',
          /* Gemini'ye format talimatı gönder */
          schema  : 'maestro_v3',
        }),
      })
      .then(function(res) {
        clearTimeout(timeoutId);
        if (!res.ok) throw new Error('HTTP ' + res.status);
        return res.json();
      })
      .then(function(raw) {
        console.log('[GeminiAdapter] Ham yanıt:', JSON.stringify(raw).substring(0, 200));

        var recipe = buildRecipe(raw, selectedMood);

        console.log(
          '[GeminiAdapter] ✅ Maestro Reçete hazır:',
          recipe.sceneName, '|',
          recipe.baseHz + 'Hz /' + recipe.binauralHz + 'Hz binaural |',
          recipe.textures.length, 'texture |',
          'velvet:', recipe.velvetReady
        );

        resolve(recipe);
      })
      .catch(function(err) {
        clearTimeout(timeoutId);
        if (err.name === 'AbortError') return; /* timeout zaten handle edildi */
        console.error('[GeminiAdapter] Fetch hatası:', err.message, '→ Fallback Maestro.');
        resolve(buildRecipe(null, selectedMood));
      });
    });
  };

  /**
   * Belirli bir mood için fallback reçeteyi senkron döndürür.
   * main.js'in acil fallback senaryoları için.
   */
  GeminiAdapter.prototype.getFallback = function(mood) {
    return buildRecipe(null, mood);
  };

  /**
   * Fuzzy match'i dışarıdan test etmek için yardımcı.
   */
  GeminiAdapter.prototype.fuzzyMatch = function(name) {
    return fuzzyMatch(name);
  };

  /* ══════════════════════════════════════════════════════════════════════════
     EXPORT
  ══════════════════════════════════════════════════════════════════════════ */
  global.GeminiAdapter = GeminiAdapter;

})(typeof window !== 'undefined' ? window : global);
