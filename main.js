/* SANCTUARY main.js v8 — sadece Gemini entegrasyonu */
(function(W) {
  'use strict';

  var _mood = null;

  var MOOD_GEN = {
    'Anxious':'wind','Tired':'rain','Stressed':'waves',
    'Sad':'waves','Calm':'binaural','Grateful':'zen',
    'قلق':'wind','مجهد':'waves','متعب':'rain',
    'حزين':'waves','هادئ':'binaural','ممتنّ':'zen',
  };

  var FALLBACK = {
    'Anxious' :{sceneName:'Calm Breath',    baseHz:396,binauralHz:6},
    'Stressed':{sceneName:'Deep Peace',     baseHz:432,binauralHz:6},
    'Tired'   :{sceneName:'Energy Renewal', baseHz:528,binauralHz:10},
    'Sad'     :{sceneName:'Light Breath',   baseHz:417,binauralHz:5},
    'Calm'    :{sceneName:'Focus Flow',     baseHz:40, binauralHz:7},
    'Grateful':{sceneName:'Heart Resonance',baseHz:528,binauralHz:10},
  };

  var TEXTURE_GEN = {
    ocean:'waves',sea:'waves',wave:'waves',rain:'rain',
    wind:'wind',birds:'forest',piano:'binaural',guitar:'binaural',flute:'binaural',
  };

  function applyRecipe(r) {
    if (!r) return;
    var base  = r.baseHz  || r.frequencySuggestion || 432;
    var beat  = r.binauralHz || 7;
    var scene = r.sceneName  || 'Calm Breath';
    var gen   = MOOD_GEN[_mood] || 'waves';

    if (r.textures && r.textures[0]) {
      var n = (r.textures[0].name || '').toLowerCase();
      for (var k in TEXTURE_GEN) {
        if (n.indexOf(k) !== -1) { gen = TEXTURE_GEN[k]; break; }
      }
    }

    /* Sadece switchSound — togglePlay'e DOKUNMA */
    if (typeof W.switchSound === 'function') {
      W.switchSound(gen, base, beat, scene, {sceneName: scene});
    }
  }

  function selectMood(m) {
    _mood = m;
    try { localStorage.setItem('sanctuary_last_mood', m); } catch(e) {}
    document.querySelectorAll('.mood-chip').forEach(function(c) {
      c.classList.toggle('active', c.getAttribute('data-mood') === m);
    });
  }

  function init() {
    /* Mood chips */
    document.querySelectorAll('.mood-chip').forEach(function(chip) {
      if (chip._v8) return; chip._v8 = true;
      chip.addEventListener('click', function() {
        var m = chip.getAttribute('data-mood');
        if (m) selectMood(m);
      });
    });

    try { var s = localStorage.getItem('sanctuary_last_mood'); if (s) selectMood(s); } catch(e) {}

    /* GeminiAdapter */
    if (typeof W.GeminiAdapter === 'function' && !W._geminiAdapter) {
      W._geminiAdapter = new W.GeminiAdapter();
    }

    /* goSanctuary wrap — SADECE Gemini çağrısı ekle */
    var _orig = W.goSanctuary;
    if (_orig) {
      W.goSanctuary = function() {
        if (!_mood) selectMood('Calm');
        var text = (document.getElementById('mood-textarea') || {}).value || '';
        _orig(); /* orijinal ekran geçişi */

        var adapter = W._geminiAdapter;
        if (adapter && typeof adapter.generateScene === 'function') {
          adapter.generateScene(text, _mood)
            .then(applyRecipe)
            .catch(function() { applyRecipe(FALLBACK[_mood] || FALLBACK.Calm); });
        } else {
          applyRecipe(FALLBACK[_mood] || FALLBACK.Calm);
        }
      };
    }

    console.info('[Sanctuary] main.js v8 hazır ✓');
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

})(window);
