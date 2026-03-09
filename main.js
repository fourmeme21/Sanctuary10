/* ═══════════════════════════════════════════════════════════════════════
   SANCTUARY — main.js  v5  (Sade & Çalışan)
   ───────────────────────────────────────────────────────────────────────
   Tek görevi:
   1. Mood seç
   2. GeminiAdapter'dan reçete al
   3. window.switchSound() ile AudioEngine'e ilet
   4. Play butonunu senkronize tut
   ═══════════════════════════════════════════════════════════════════════ */

(function (W) {
  'use strict';

  /* ── Yardımcı ── */
  function el(id)  { return document.getElementById(id); }
  function raf(fn) { requestAnimationFrame(fn); }
  function log(m)  { console.info('[Sanctuary]', m); }
  function warn(m) { console.warn('[Sanctuary]', m); }

  /* ── Durum ── */
  var selectedMood = null;
  var _timers      = [];

  /* ── Mood → gen haritası ── */
  var MOOD_GEN = {
    'Anxious':'wind',  'Tired':'rain',    'Stressed':'waves',
    'Sad':'waves',     'Calm':'binaural', 'Grateful':'zen',
    'قلق':'wind',     'مجهد':'waves',    'متعب':'rain',
    'حزين':'waves',   'هادئ':'binaural', 'ممتنّ':'zen',
  };

  /* ── Texture adı → gen ── */
  var TEXTURE_GEN = {
    ocean:'waves', sea:'waves', wave:'waves',
    rain:'rain',   storm:'rain',
    wind:'wind',   breeze:'wind',
    birds:'forest',forest:'forest',
    fire:'fire',
    piano:'binaural', guitar:'binaural', flute:'binaural',
    binaural:'binaural', space:'space', zen:'zen',
  };

  function textureToGen(textures, moodGen) {
    if (!Array.isArray(textures) || textures.length === 0) return moodGen;
    var name = (textures[0].name || '').toLowerCase();
    for (var key in TEXTURE_GEN) {
      if (name.indexOf(key) !== -1) return TEXTURE_GEN[key];
    }
    return moodGen;
  }

  /* ══════════════════════════════════════════════════════════════════════
     PLAY BUTONU — tek, sade, çakışmasız
  ══════════════════════════════════════════════════════════════════════ */
  function updatePlayUI() {
    var playing = !!W._playing;
    raf(function() {
      var btn  = el('play-btn');
      var icon = el('play-icon');
      var lbl  = el('play-lbl');
      if (btn)  { btn.classList.toggle('on', playing); btn.setAttribute('aria-pressed', String(playing)); }
      if (icon) icon.textContent = playing ? '⏸' : '▶';
      if (lbl)  lbl.textContent  = playing ? 'Duraklat' : 'Başlat';
      document.body.classList.toggle('playing', playing);
    });
  }

  /* AudioEngine'in togglePlay'ini çağır, sonra UI'ı güncelle */
  function triggerToggle() {
    if (W._ctx && W._ctx.state === 'suspended') {
      W._ctx.resume().then(function() {
        if (typeof W.togglePlay === 'function') W.togglePlay();
        setTimeout(updatePlayUI, 80);
      });
    } else {
      if (typeof W.togglePlay === 'function') W.togglePlay();
      setTimeout(updatePlayUI, 80);
    }
  }

  /* Sadece başlat (zaten oynuyorsa dokunma) */
  function startIfStopped() {
    var t = setTimeout(function() {
      if (!W._playing) {
        triggerToggle();
        log('Otomatik başlatma ✓');
      } else {
        updatePlayUI();
      }
    }, 350);
    _timers.push(t);
  }

  /* Play butonuna tek listener — AudioEngine'inkiyle çakışmamak için
     onclick="window.togglePlay()" zaten var, biz sadece UI senkronunu ekliyoruz */
  function bindPlayBtn() {
    var btn = el('play-btn');
    if (!btn || btn._v5bound) return;
    btn._v5bound = true;
    btn.addEventListener('click', function() {
      /* togglePlay onclick ile zaten çağrıldı.
         80ms sonra AudioEngine state'i set etmiş olur. */
      setTimeout(updatePlayUI, 80);
    }, true); /* capture: AudioEngine listener'ından sonra */
    log('play-btn bağlandı ✓');
  }

  /* ══════════════════════════════════════════════════════════════════════
     NEFES ANİMASYONU
  ══════════════════════════════════════════════════════════════════════ */
  var breathTimer = null;
  var BREATH_TXT  = { inhale:'Nefes Al', hold:'Tut', exhale:'Ver' };

  function startBreath(bp) {
    stopBreath();
    if (!bp) return;
    var inhale = bp.inhale || (Array.isArray(bp) ? bp[0] : 4) || 4;
    var hold   = bp.hold   || (Array.isArray(bp) ? bp[1] : 0) || 0;
    var exhale = bp.exhale || (Array.isArray(bp) ? bp[2] : 8) || 8;
    var total  = inhale + hold + exhale;
    document.documentElement.style.setProperty('--breath-speed', total + 's');

    var circle = document.querySelector('.breath-circle');
    var guide  = el('breath-guide');
    var phases = ['inhale','hold','exhale'];
    var durs   = [inhale, hold, exhale];
    var idx    = 0;

    function tick() {
      if (phases[idx] === 'hold' && durs[idx] === 0) idx = (idx+1)%3;
      var phase = phases[idx], dur = durs[idx];
      raf(function() {
        if (circle) circle.setAttribute('data-phase', phase);
        if (guide)  guide.textContent = BREATH_TXT[phase] || '';
      });
      idx = (idx+1)%3;
      var t = setTimeout(tick, dur * 1000);
      _timers.push(t);
      breathTimer = t;
    }
    tick();
  }

  function stopBreath() {
    if (breathTimer) { clearTimeout(breathTimer); breathTimer = null; }
    var circle = document.querySelector('.breath-circle');
    var guide  = el('breath-guide');
    if (circle) circle.setAttribute('data-phase', 'idle');
    if (guide)  guide.textContent = 'Touch the button when ready';
  }

  /* ══════════════════════════════════════════════════════════════════════
     REÇETE UYGULAYICI — AudioEngine'in switchSound() kapısından gir
  ══════════════════════════════════════════════════════════════════════ */
  function applyRecipe(recipe) {
    if (!recipe) return;

    var base  = recipe.baseHz     || recipe.frequencySuggestion || 432;
    var beat  = recipe.binauralHz || recipe.binaural_beat_hz    || 7;
    var scene = recipe.sceneName  || 'Calm Breath';
    var gen   = textureToGen(recipe.textures, MOOD_GEN[selectedMood] || 'waves');

    log('Reçete: ' + scene + ' | ' + base + 'Hz | beat:' + beat + ' | gen:' + gen);

    /* localStorage'a yaz — AudioEngine togglePlay bunu okuyacak */
    try {
      localStorage.setItem('lastGen',  gen);
      localStorage.setItem('lastBase', String(base));
      localStorage.setItem('lastBeat', String(beat));
      if (selectedMood) localStorage.setItem('lastMood', selectedMood);
    } catch(e) {}

    /* AudioEngine'in tek gerçek kapısı */
    if (typeof W.switchSound === 'function') {
      W.switchSound(gen, base, beat, scene, { sceneName: scene });
      log('switchSound çağrıldı ✓');
    } else {
      warn('switchSound bulunamadı!');
    }

    /* FrequencyManager */
    if (W._sancFM && typeof W._sancFM.update === 'function') {
      try { W._sancFM.update(base, beat); } catch(e) {}
    }

    /* Nefes */
    var bp = recipe.breathPattern || recipe.breath;
    if (bp) startBreath(bp);

    /* UI badge */
    raf(function() {
      var badge = el('freq-badge');
      var lbl   = el('freq-label');
      if (badge) { badge.classList.add('on'); badge.style.opacity = '1'; }
      if (lbl)   lbl.textContent = base + ' Hz · ' + scene;
    });
  }

  /* ══════════════════════════════════════════════════════════════════════
     MOOD SEÇİMİ
  ══════════════════════════════════════════════════════════════════════ */
  function selectMood(mood) {
    selectedMood = mood;
    try { localStorage.setItem('sanctuary_last_mood', mood); } catch(e) {}
    raf(function() {
      document.querySelectorAll('.mood-chip').forEach(function(c) {
        c.classList.toggle('active', c.getAttribute('data-mood') === mood);
      });
    });
    log('Mood: ' + mood);
  }

  function bindMoodChips() {
    document.querySelectorAll('.mood-chip').forEach(function(chip) {
      if (chip._v5bound) return;
      chip._v5bound = true;
      chip.addEventListener('click', function() {
        var m = chip.getAttribute('data-mood');
        if (m) selectMood(m);
      });
    });
  }

  /* ══════════════════════════════════════════════════════════════════════
     FALLBACK TABLOSU
  ══════════════════════════════════════════════════════════════════════ */
  var FALLBACK = {
    'Anxious' :{sceneName:'Calm Breath',    baseHz:396,binauralHz:6, textures:[{name:'ocean',gain:0.55},{name:'wind',gain:0.3}],  breath:[4,4,8]},
    'Stressed':{sceneName:'Deep Peace',     baseHz:432,binauralHz:6, textures:[{name:'rain', gain:0.55},{name:'piano',gain:0.25}], breath:[4,2,6]},
    'Tired'   :{sceneName:'Energy Renewal', baseHz:528,binauralHz:10,textures:[{name:'birds',gain:0.5}, {name:'wind',gain:0.35}],  breath:[5,2,5]},
    'Sad'     :{sceneName:'Light Breath',   baseHz:417,binauralHz:5, textures:[{name:'ocean',gain:0.6}, {name:'flute',gain:0.25}], breath:[4,2,7]},
    'Calm'    :{sceneName:'Focus Flow',     baseHz:40, binauralHz:7, textures:[{name:'ocean',gain:0.45},{name:'piano',gain:0.3}],  breath:[4,4,4]},
    'Grateful':{sceneName:'Heart Resonance',baseHz:528,binauralHz:10,textures:[{name:'birds',gain:0.5}, {name:'guitar',gain:0.3}], breath:[5,3,6]},
  };

  function getFallback(mood) {
    return FALLBACK[mood] || {sceneName:'Calm Breath',baseHz:432,binauralHz:7,textures:[{name:'ocean',gain:0.6}],breath:[4,4,8]};
  }

  /* ══════════════════════════════════════════════════════════════════════
     ENTER SANCTUARY — goSanctuary() WRAP
  ══════════════════════════════════════════════════════════════════════ */
  function wrapGoSanctuary() {
    var _orig = W.goSanctuary;
    if (!_orig) { warn('goSanctuary bulunamadı!'); return; }

    W.goSanctuary = function() {
      if (!selectedMood) selectedMood = 'Calm';

      var userText = (el('mood-textarea') || {}).value || '';
      var moodGen  = MOOD_GEN[selectedMood] || 'waves';
      var adapter  = W._geminiAdapter;

      /* Ekranı hemen geç */
      _orig();

      /* Reçete al ve uygula */
      function proceed(recipe) {
        applyRecipe(recipe);
        startIfStopped();
      }

      if (!adapter || typeof adapter.generateScene !== 'function') {
        warn('GeminiAdapter yok — fallback');
        proceed(getFallback(selectedMood));
        return;
      }

      adapter.generateScene(userText, selectedMood)
        .then(proceed)
        .catch(function(err) {
          warn('Gemini hata: ' + (err && err.message));
          proceed(getFallback(selectedMood));
        });
    };

    log('goSanctuary wrap ✓');
  }

  /* ══════════════════════════════════════════════════════════════════════
     GeminiAdapter BAŞLAT
  ══════════════════════════════════════════════════════════════════════ */
  function initAdapter() {
    if (typeof W.GeminiAdapter === 'function') {
      W._geminiAdapter = new W.GeminiAdapter();
      log('GeminiAdapter ✓');
    } else {
      warn('GeminiAdapter.js yüklenmemiş!');
    }
  }

  /* ══════════════════════════════════════════════════════════════════════
     PUBLIC API
  ══════════════════════════════════════════════════════════════════════ */
  W.SanctuaryApp = {
    selectMood : selectMood,
    applyRecipe: applyRecipe,
    getState   : function() {
      return { mood: selectedMood, playing: !!W._playing };
    },
  };

  /* ══════════════════════════════════════════════════════════════════════
     INIT
  ══════════════════════════════════════════════════════════════════════ */
  function init() {
    log('═══ main.js v5 başlatılıyor ═══');
    initAdapter();
    bindMoodChips();
    bindPlayBtn();
    wrapGoSanctuary();

    /* Kayıtlı mood */
    try {
      var saved = localStorage.getItem('sanctuary_last_mood');
      if (saved) selectMood(saved);
    } catch(e) {}

    log('═══ main.js v5 hazır ═══');
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  W.addEventListener('beforeunload', function() {
    _timers.forEach(function(t) { clearTimeout(t); });
  });

})(window);
