/* SANCTUARY main.js v7
   Tek değişiklik öncekine göre: autoStart YOK.
   Müziği kullanıcı Play butonuyla başlatır.
   main.js sadece switchSound() parametrelerini hazırlar.
*/
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
    'Anxious' :{sceneName:'Calm Breath',    baseHz:396,binauralHz:6, textures:[{name:'ocean',gain:0.55}],breath:[4,4,8]},
    'Stressed':{sceneName:'Deep Peace',     baseHz:432,binauralHz:6, textures:[{name:'rain', gain:0.55}], breath:[4,2,6]},
    'Tired'   :{sceneName:'Energy Renewal', baseHz:528,binauralHz:10,textures:[{name:'wind', gain:0.5}],  breath:[5,2,5]},
    'Sad'     :{sceneName:'Light Breath',   baseHz:417,binauralHz:5, textures:[{name:'ocean',gain:0.6}],  breath:[4,2,7]},
    'Calm'    :{sceneName:'Focus Flow',     baseHz:40, binauralHz:7, textures:[{name:'ocean',gain:0.45}], breath:[4,4,4]},
    'Grateful':{sceneName:'Heart Resonance',baseHz:528,binauralHz:10,textures:[{name:'birds',gain:0.5}],  breath:[5,3,6]},
  };

  var TEXTURE_GEN = {
    ocean:'waves',sea:'waves',wave:'waves',
    rain:'rain',  wind:'wind',
    birds:'forest',forest:'forest',
    piano:'binaural',guitar:'binaural',flute:'binaural',
  };

  /* ── Reçeteyi ses motoruna hazırla (sadece switchSound, togglePlay YOK) ── */
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

    console.info('[Sanctuary] Reçete:', scene, base+'Hz', gen);

    /* switchSound:
       - _playing=true ise sesi hemen değiştirir
       - _playing=false ise sadece localStorage'a yazar,
         kullanıcı Play'e basınca bu değerler kullanılır */
    if (typeof W.switchSound === 'function') {
      W.switchSound(gen, base, beat, scene, {sceneName: scene});
    }

    /* Nefes CSS */
    var bp = r.breathPattern || r.breath;
    if (bp) {
      var i = Array.isArray(bp) ? bp[0] : (bp.inhale||4);
      var h = Array.isArray(bp) ? bp[1] : (bp.hold  ||0);
      var e = Array.isArray(bp) ? bp[2] : (bp.exhale||8);
      document.documentElement.style.setProperty('--breath-speed', (i+h+e)+'s');
    }

    /* Badge güncelle */
    requestAnimationFrame(function() {
      var badge = document.getElementById('freq-badge');
      var lbl   = document.getElementById('freq-label');
      if (badge) { badge.classList.add('on'); badge.style.opacity='1'; }
      if (lbl)   lbl.textContent = base + ' Hz · ' + scene;
    });
  }

  /* ── Mood seçimi ── */
  function selectMood(m) {
    _mood = m;
    try { localStorage.setItem('sanctuary_last_mood', m); } catch(e) {}
    document.querySelectorAll('.mood-chip').forEach(function(c) {
      c.classList.toggle('active', c.getAttribute('data-mood') === m);
    });
  }

  /* ── goSanctuary wrap ── */
  function wrapGoSanctuary() {
    var _orig = W.goSanctuary;
    if (!_orig) return;

    W.goSanctuary = function() {
      if (!_mood) selectMood('Calm');
      var text = (document.getElementById('mood-textarea') || {}).value || '';

      /* Ekranı geç */
      _orig();

      /* Gemini'den reçete al, switchSound'a ilet */
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

  /* ── Init ── */
  function init() {
    /* Mood chips */
    document.querySelectorAll('.mood-chip').forEach(function(chip) {
      if (chip._v7) return; chip._v7 = true;
      chip.addEventListener('click', function() {
        var m = chip.getAttribute('data-mood');
        if (m) selectMood(m);
      });
    });

    /* Kayıtlı mood */
    try { var s = localStorage.getItem('sanctuary_last_mood'); if (s) selectMood(s); } catch(e) {}

    /* GeminiAdapter */
    if (typeof W.GeminiAdapter === 'function' && !W._geminiAdapter) {
      W._geminiAdapter = new W.GeminiAdapter();
    }

    wrapGoSanctuary();

    console.info('[Sanctuary] main.js v7 hazır ✓');
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

})(window);
