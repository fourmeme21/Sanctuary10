(function(global) {

  var PROXY_URL  = '/.netlify/functions/gemini';
  var TIMEOUT_MS = 10000;

  /* ── Genişletilmiş Fallback Tablosu (Eski Veriler Korundu) ── */
  var FALLBACK_TABLE = {
    'Anxious' : { sceneName:'Calm Breath',    baseHz:396, binauralHz:8, textures:[{name:'ocean',gain:0.55}],  breath:[4,4,8] },
    'Stressed': { sceneName:'Deep Peace',     baseHz:432, binauralHz:6, textures:[{name:'rain',gain:0.6}],   breath:[4,2,6] },
    'Tired'   : { sceneName:'Energy Renewal', baseHz:528, binauralHz:10,textures:[{name:'wind',gain:0.5}],   breath:[5,2,5] },
    'Sad'     : { sceneName:'Light Breath',   baseHz:417, binauralHz:5, textures:[{name:'waves',gain:0.6}],  breath:[4,2,7] },
    'Calm'    : { sceneName:'Focus Flow',     baseHz:40,  binauralHz:7, textures:[{name:'piano',gain:0.45}], breath:[4,4,4] },
    'Grateful': { sceneName:'Heart Resonance',baseHz:528, binauralHz:10,textures:[{name:'birds',gain:0.55}], breath:[5,3,6] },
    /* Arabic Support Preserved */
    'قلق'      : { sceneName:'تنفس هادئ',       baseHz:396, binauralHz:8, textures:[{name:'ocean',gain:0.55}], breath:[4,4,8] }
  };

  var DEFAULT_MSD = {
    sceneName: 'Deep Calm', baseHz: 432, binauralHz: 7,
    textures: [{name:'ocean', gain:0.6}], breath: [4,4,8]
  };

  /* ── GÜÇLENDİRİLMİŞ VALIDASYON (Hibrit Maestro) ── */
  function validateMSD(msd) {
    if (!msd || typeof msd !== 'object') return false;
    
    // 1. Yeni Maestro Formatı Kontrolü (main.js v4 beklediği format)
    if (typeof msd.baseHz === 'number' && typeof msd.binauralHz === 'number') {
        return true; 
    }

    // 2. Eski Format Kontrolü (Geriye dönük uyumluluk)
    if (typeof msd.frequencySuggestion === 'number' && msd.breathPattern) {
        return true;
    }

    return false;
  }

  function getFallback(mood) {
    return FALLBACK_TABLE[mood] || DEFAULT_MSD;
  }

  function GeminiAdapter(config) {
    config = config || {};
    this._proxyUrl = config.proxyUrl || PROXY_URL;
    this._timeout  = config.timeout  || TIMEOUT_MS;
  }

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
        console.log('[GeminiAdapter] Ham Veri:', JSON.stringify(msd));

        if (!validateMSD(msd)) {
          console.warn('[GeminiAdapter] Geçersiz şema — fallback.');
          return resolve(getFallback(selectedMood));
        }

        console.log('[GeminiAdapter] ✅ Maestro Onayladı:', msd.sceneName);
        resolve(msd);
      })
      .catch(function(err) {
        clearTimeout(timeoutId);
        if (err.name === 'AbortError') return;
        console.error('[GeminiAdapter] Fetch hatası:', err.message);
        resolve(getFallback(selectedMood));
      });
    });
  };

  global.GeminiAdapter = GeminiAdapter;

})(typeof window !== 'undefined' ? window : global);
