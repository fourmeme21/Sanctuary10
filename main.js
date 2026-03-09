/* SANCTUARY main.js v6 — minimal, sadece 3 görev:
   1. Mood chip seçimi
   2. goSanctuary() → Gemini → switchSound()
   3. Play buton UI senkronu
*/
(function(W) {
  'use strict';

  var _mood   = null;
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
  var TEXTURE_GEN = {ocean:'waves',sea:'waves',wave:'waves',rain:'rain',wind:'wind',birds:'forest',piano:'binaural',guitar:'binaural',flute:'binaural'};

  /* ─── 1. Mood chip ─── */
  function selectMood(m) {
    _mood = m;
    try { localStorage.setItem('sanctuary_last_mood', m); } catch(e) {}
    document.querySelectorAll('.mood-chip').forEach(function(c) {
      c.classList.toggle('active', c.getAttribute('data-mood') === m);
    });
  }

  /* ─── 2. Reçeteyi ses motoruna ilet ─── */
  function applyRecipe(r) {
    if (!r) return;
    var base  = r.baseHz  || r.frequencySuggestion || 432;
    var beat  = r.binauralHz || 7;
    var scene = r.sceneName || 'Calm Breath';
    var gen   = _mood ? (MOOD_GEN[_mood] || 'waves') : 'waves';

    /* Texture'dan gen belirle */
    if (r.textures && r.textures[0]) {
      var n = (r.textures[0].name || '').toLowerCase();
      for (var k in TEXTURE_GEN) {
        if (n.indexOf(k) !== -1) { gen = TEXTURE_GEN[k]; break; }
      }
    }

    console.info('[Sanctuary] applyRecipe:', scene, base+'Hz', gen);

    /* localStorage yaz — AudioEngine togglePlay bunu okur */
    try {
      localStorage.setItem('lastGen', gen);
      localStorage.setItem('lastBase', String(base));
      localStorage.setItem('lastBeat', String(beat));
    } catch(e) {}

    /* switchSound — AudioEngine'in tek kapısı */
    if (typeof W.switchSound === 'function') {
      W.switchSound(gen, base, beat, scene, {sceneName: scene});
    }

    /* Nefes */
    var bp = r.breathPattern || r.breath;
    if (bp) {
      var inhale = Array.isArray(bp) ? bp[0] : (bp.inhale || 4);
      var hold   = Array.isArray(bp) ? bp[1] : (bp.hold   || 0);
      var exhale = Array.isArray(bp) ? bp[2] : (bp.exhale || 8);
      var total  = inhale + hold + exhale;
      document.documentElement.style.setProperty('--breath-speed', total + 's');
    }

    /* Badge */
    requestAnimationFrame(function() {
      var badge = document.getElementById('freq-badge');
      var lbl   = document.getElementById('freq-label');
      if (badge) { badge.classList.add('on'); badge.style.opacity = '1'; }
      if (lbl)   lbl.textContent = base + ' Hz · ' + scene;
    });
  }

  /* ─── 3. Play buton UI — AudioEngine'in kendi togglePlay'i çalışıyor,
          biz sadece icon/label senkronluyoruz ─── */
  function syncPlayUI() {
    var playing = !!W._playing;
    var btn  = document.getElementById('play-btn');
    var icon = document.getElementById('play-icon');
    var lbl  = document.getElementById('play-lbl');
    if (btn)  btn.classList.toggle('on', playing);
    if (icon) icon.textContent = playing ? '⏸' : '▶';
    if (lbl)  lbl.textContent  = playing ? 'Duraklat' : 'Başlat';
  }

  /* ─── goSanctuary wrap ─── */
  function init() {
    /* Mood chips */
    document.querySelectorAll('.mood-chip').forEach(function(chip) {
      if (chip._v6) return; chip._v6 = true;
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

    /* goSanctuary wrap */
    var _orig = W.goSanctuary;
    if (!_orig) { console.warn('[Sanctuary] goSanctuary yok!'); return; }

    W.goSanctuary = function() {
      if (!_mood) selectMood('Calm');
      var text = (document.getElementById('mood-textarea') || {}).value || '';

      /* Önce ekranı geç */
      _orig();

      /* Reçete al */
      var adapter = W._geminiAdapter;
      if (adapter && typeof adapter.generateScene === 'function') {
        adapter.generateScene(text, _mood)
          .then(function(r) {
            applyRecipe(r);
            /* Müzik başlamamışsa başlat */
            setTimeout(function() {
              if (!W._playing && typeof W.togglePlay === 'function') {
                if (W._ctx && W._ctx.state === 'suspended') {
                  W._ctx.resume().then(function() { W.togglePlay(); setTimeout(syncPlayUI, 100); });
                } else {
                  W.togglePlay();
                  setTimeout(syncPlayUI, 100);
                }
              } else {
                syncPlayUI();
              }
            }, 300);
          })
          .catch(function() {
            applyRecipe(FALLBACK[_mood] || FALLBACK['Calm']);
          });
      } else {
        applyRecipe(FALLBACK[_mood] || FALLBACK['Calm']);
      }
    };

    /* Play buton senkronu — sadece icon/label, togglePlay'e dokunma */
    var btn = document.getElementById('play-btn');
    if (btn && !btn._v6) {
      btn._v6 = true;
      btn.addEventListener('click', function() {
        setTimeout(syncPlayUI, 100);
      });
    }

    console.info('[Sanctuary] main.js v6 hazır ✓');
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

})(window);
