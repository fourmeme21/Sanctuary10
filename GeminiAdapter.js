/**
 * GeminiAdapter.js — Sanctuary AI Oracle v2
 * Netlify Function proxy üzerinden MSD (Musical Scene Descriptor) döndürür.
 * Doğrudan Gemini API çağrısı yapmaz — API key frontend'de gizli kalır.
 */

(function(global) {

  var PROXY_URL      = '/.netlify/functions/gemini';
  var TIMEOUT_MS     = 10000;

  /* ── Fallback MSD tablosu ─────────────────────────────────────────────── */
  var FALLBACK_TABLE = {
    'Anxious' : { sceneName:'Calm Breath',     tempo:52, frequencySuggestion:396, layers:[{id:'ambient-1',type:'ambient',volume:0.55},{id:'binaural-1',type:'binaural',volume:0.25}], breathPattern:{inhale:4,hold:4,exhale:8}  },
    'Stressed': { sceneName:'Deep Peace',      tempo:58, frequencySuggestion:432, layers:[{id:'ambient-1',type:'ambient',volume:0.6}, {id:'binaural-1',type:'binaural',volume:0.2}],  breathPattern:{inhale:4,hold:2,exhale:6}  },
    'Tired'   : { sceneName:'Energy Renewal',  tempo:65, frequencySuggestion:528, layers:[{id:'ambient-1',type:'ambient',volume:0.5}, {id:'tone-1',type:'tone',volume:0.3}],           breathPattern:{inhale:5,hold:2,exhale:5}  },
    'Sad'     : { sceneName:'Light Breath',    tempo:55, frequencySuggestion:417, layers:[{id:'ambient-1',type:'ambient',volume:0.6}, {id:'binaural-1',type:'binaural',volume:0.3}],  breathPattern:{inhale:4,hold:2,exhale:7}  },
    'Calm'    : { sceneName:'Focus Flow',      tempo:70, frequencySuggestion:40,  layers:[{id:'ambient-1',type:'ambient',volume:0.45},{id:'binaural-1',type:'binaural',volume:0.35}], breathPattern:{inhale:4,hold:4,exhale:4}  },
    'Grateful': { sceneName:'Heart Resonance', tempo:60, frequencySuggestion:528, layers:[{id:'ambient-1',type:'ambient',volume:0.55},{id:'binaural-1',type:'binaural',volume:0.3}],  breathPattern:{inhale:5,hold:3,exhale:6}  },
    /* Arabic */
    'قلق'    : { sceneName:'تنفس هادئ',    tempo:52, frequencySuggestion:396, layers:[{id:'ambient-1',type:'ambient',volume:0.55},{id:'binaural-1',type:'binaural',volume:0.25}], breathPattern:{inhale:4,hold:4,exhale:8} },
    'مجهد'   : { sceneName:'سلام عميق',    tempo:58, frequencySuggestion:432, layers:[{id:'ambient-1',type:'ambient',volume:0.6}, {id:'binaural-1',type:'binaural',volume:0.2}],  breathPattern:{inhale:4,hold:2,exhale:6} },
    'متعب'   : { sceneName:'تجديد الطاقة', tempo:65, frequencySuggestion:528, layers:[{id:'ambient-1',type:'ambient',volume:0.5}, {id:'tone-1',type:'tone',volume:0.3}],           breathPattern:{inhale:5,hold:2,exhale:5} },
    'حزين'   : { sceneName:'نفس النور',    tempo:55, frequencySuggestion:417, layers:[{id:'ambient-1',type:'ambient',volume:0.6}, {id:'binaural-1',type:'binaural',volume:0.3}],  breathPattern:{inhale:4,hold:2,exhale:7} },
    'هادئ'   : { sceneName:'تدفق التركيز', tempo:70, frequencySuggestion:40,  layers:[{id:'ambient-1',type:'ambient',volume:0.45},{id:'binaural-1',type:'binaural',volume:0.35}], breathPattern:{inhale:4,hold:4,exhale:4} },
    'ممتنّ'  : { sceneName:'رنين القلب',   tempo:60, frequencySuggestion:528, layers:[{id:'ambient-1',type:'ambient',volume:0.55},{id:'binaural-1',type:'binaural',volume:0.3}],  breathPattern:{inhale:5,hold:3,exhale:6} },
  };

  var DEFAULT_MSD = {
    sceneName: 'Deep Calm', tempo: 58, frequencySuggestion: 432,
    layers: [{id:'ambient-1',type:'ambient',volume:0.6},{id:'binaural-1',type:'binaural',volume:0.25}],
    breathPattern: {inhale:4,hold:4,exhale:8}
  };

  /* ── MSD doğrulama ────────────────────────────────────────────────────── */
  function validateMSD(msd) {
    if (!msd || typeof msd !== 'object')                              return false;
    if (typeof msd.sceneName !== 'string')                            return false;
    if (typeof msd.tempo !== 'number' || msd.tempo < 40 || msd.tempo > 120) return false;
    if (typeof msd.frequencySuggestion !== 'number')                  return false;
    if (!Array.isArray(msd.layers) || msd.layers.length < 1)         return false;
    if (!msd.breathPattern)                                           return false;
    var bp = msd.breathPattern;
    if (typeof bp.inhale !== 'number' || typeof bp.exhale !== 'number') return false;
    return true;
  }

  function getFallback(mood) {
    return FALLBACK_TABLE[mood] || DEFAULT_MSD;
  }

  /* ── Ana sınıf ────────────────────────────────────────────────────────── */
  function GeminiAdapter(config) {
    config = config || {};
    this._proxyUrl = config.proxyUrl || PROXY_URL;
    this._timeout  = config.timeout  || TIMEOUT_MS;
  }

  /**
   * Kullanıcı girdisine göre MSD üretir.
   * @param {string} userInput    — Kullanıcının yazdığı metin
   * @param {string} selectedMood — Seçilen ruh hali (ör. "Anxious")
   * @returns {Promise<MSD>}
   */
  GeminiAdapter.prototype.generateScene = function(userInput, selectedMood) {
    var self = this;

    return new Promise(function(resolve) {
      var controller = new AbortController();
      var timeoutId  = setTimeout(function() {
        controller.abort();
        console.warn('[GeminiAdapter] Timeout — fallback kullanılıyor.');
        resolve(getFallback(selectedMood));
      }, self._timeout);

      fetch(self._proxyUrl, {
        method : 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal : controller.signal,
        body   : JSON.stringify({ mood: selectedMood, input: userInput || '' }),
      })
      .then(function(res) {
        clearTimeout(timeoutId);
        if (!res.ok) throw new Error('HTTP ' + res.status);
        return res.json();
      })
      .then(function(msd) {
        /* ── Debug: ham veriyi konsola bas ── */
        console.log('[GeminiAdapter] Ham MSD:', JSON.stringify(msd));

        /* ── Validasyon ── */
        if (!validateMSD(msd)) {
          console.warn('[GeminiAdapter] Geçersiz MSD şeması — fallback. Gelen:', JSON.stringify(msd).substring(0, 150));
          return resolve(getFallback(selectedMood));
        }

        console.log('[GeminiAdapter] ✅ Geçerli MSD:', msd.sceneName, msd.frequencySuggestion + 'Hz');
        resolve(msd);
      })
      .catch(function(err) {
        clearTimeout(timeoutId);
        if (err.name === 'AbortError') return; /* timeout zaten handle edildi */
        console.error('[GeminiAdapter] Fetch hatası:', err.message);
        resolve(getFallback(selectedMood));
      });
    });
  };

  /* ── window.GeminiAdapter olarak kaydet ─────────────────────────────── */
  global.GeminiAdapter = GeminiAdapter;

})(typeof window !== 'undefined' ? window : global);
