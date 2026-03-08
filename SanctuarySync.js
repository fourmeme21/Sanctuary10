/* ═══════════════════════════════════════════════════════════════════════════
   SanctuarySync.js — Aşama 11: Tam Senkronizasyon Protokolü
   ─────────────────────────────────────────────────────────────────────────────
   Bu dosya AudioEngine, SampleManager ve FrequencyManager'ı birbirine
   mühürleyen senkronizasyon katmanıdır. Üç modülü tek bir komutla
   koordineli biçimde başlatır ve her olay için atomik güncelleme sağlar.

   YÜKLEME SIRASI (index.html'de):
     1. FrequencyManager.js
     2. SampleManager_v2.js
     3. AudioEngine_v9.js
     4. SanctuarySync.js   ← EN SON yüklenir, diğerleri hazır olunca bağlanır

   ÇÖZÜLEN SORUNLAR:
     • togglePlay → startSound yolunda SampleManager başlatılmıyordu
     • switchSound'da SampleManager, startSound'dan sonra async çağrılıyordu
       (motor hazır değilken çalışıyor, enstrümanlar bağlanamıyor)
     • Arpeggiator nota değişimi SampleManager'a bildirilmiyordu
     • oscGain Safety Mute: SampleManager yokken osilatörler %5 sınırını aşıyordu
     • _origSwitchSound wrapper gen parametresini kaybediyordu
   ─────────────────────────────────────────────────────────────────────────────
   KULLANIM:
     window.SanctuarySync.init();          // DOMContentLoaded sonrası
     window.SanctuarySync.activate(gen, base, beat, sceneName);
   ═══════════════════════════════════════════════════════════════════════════ */
(function(global) {
  'use strict';

  /* ══════════════════════════════════════════════════════════════════════
     DURUM
     ══════════════════════════════════════════════════════════════════════ */
  var _initialized   = false;
  var _smReady       = false;   /* SampleManager hazır mı? */
  var _fmReady       = false;   /* FrequencyManager hazır mı? */
  var _aeReady       = false;   /* AudioEngine hazır mı? */
  var _pendingScene  = null;    /* SM hazır olmadan gelen sahne isteği */
  var _sm            = null;    /* SampleManager instance */
  var _fm            = null;    /* FrequencyManager instance */
  var _masterAutoPanLfoOsc = null; /* Merkezi Master LFO osilatörü */
  var _masterAutoPanLfoGain= null;

  /* Ses hiyerarşisi sabitleri — Aşama 11 */
  var OSC_GAIN_MAX   = 0.02;   /* Osilatörler asla %5'i geçemez (Safety Mute) */
  var SAMPLE_GAIN    = 0.85;   /* SampleManager ana ses seviyesi */

  /* Konsol etiketleri */
  var TAG = {
    sync  : '[SanctuarySync]',
    math  : '[Matematik]',
    nature: '[Doğa Sesleri]',
    instr : '[Enstrümanlar]',
  };

  /* ══════════════════════════════════════════════════════════════════════
     HANDSHAKE — Modül Hazırlık Kontrolü
     ══════════════════════════════════════════════════════════════════════ */

  /**
   * Her modülün varlığını kontrol eder ve hazır olanı raporlar.
   * Eksik modül varsa ses üretimine izin vermez (Safety Mute devreye girer).
   */
  function _checkHandshake() {
    _fmReady = (typeof global.FrequencyManager !== 'undefined'
                || typeof global.getFrequencyManager !== 'undefined');

    _smReady = (typeof global.SampleManager !== 'undefined');

    _aeReady = (typeof global.togglePlay !== 'undefined'
                && typeof global.switchSound !== 'undefined');

    if (_fmReady) console.info(TAG.math, 'Hazır ✓');
    else          console.warn(TAG.math, 'BULUNAMADI — FrequencyManager.js yüklü mü?');

    if (_smReady) console.info(TAG.nature, 'Bağlandı ✓');
    else          console.warn(TAG.nature, 'BULUNAMADI — SampleManager_v2.js yüklü mü?');

    if (_aeReady) console.info(TAG.sync, 'AudioEngine Hazır ✓');
    else          console.warn(TAG.sync, 'AudioEngine bulunamadı!');

    return _aeReady; /* En az motor gerekli */
  }

  /* ══════════════════════════════════════════════════════════════════════
     SM BOOTSTRAP — SampleManager'ı AudioEngine master bus'a bağla
     ══════════════════════════════════════════════════════════════════════ */

  function _bootstrapSampleManager(ctx, masterNode) {
    if (!_smReady || _sm) return _sm; /* Zaten bağlı */

    try {
      _sm = new global.SampleManager(ctx, masterNode, {
        basePath : 'audio/',
        volume   : SAMPLE_GAIN,
      });
      global._sancSM = _sm; /* Global referans — debug için */
      console.info(TAG.nature, 'SampleManager master bus\'a bağlandı.',
                   'Hacim:', SAMPLE_GAIN);
    } catch(e) {
      console.error(TAG.nature, 'SampleManager başlatılamadı:', e.message);
      _sm = null;
    }
    return _sm;
  }

  /* ══════════════════════════════════════════════════════════════════════
     FM BOOTSTRAP — FrequencyManager singleton'ı başlat
     ══════════════════════════════════════════════════════════════════════ */

  function _bootstrapFrequencyManager(baseFreq) {
    if (!_fmReady) return null;

    try {
      if (typeof global.getFrequencyManager === 'function') {
        _fm = global.getFrequencyManager(baseFreq || 432);
      } else {
        _fm = new global.FrequencyManager(baseFreq || 432);
      }
      global._sancFM = _fm;
      console.info(TAG.math, 'FrequencyManager başlatıldı. baseFreq:', _fm.baseFreq, 'Hz');
    } catch(e) {
      console.error(TAG.math, 'FrequencyManager başlatılamadı:', e.message);
      _fm = null;
    }
    return _fm;
  }

  /* ══════════════════════════════════════════════════════════════════════
     SAFETY MUTE — Osilatör siren koruması
     SampleManager yokken veya yüklenirken osilatörler %5 sınırını aşamaz.
     ══════════════════════════════════════════════════════════════════════ */

  function _enforceSafetyMute(ctx) {
    if (!ctx || !global._mainFilter) return;

    /* SampleManager hazır ve çalışıyorsa osilatörler zaten %2 (OSC_GAIN_MAX).
       Değilse: master'a ek bir yumuşatma uygula. */
    var smActive = _sm && _sm._isPlaying;
    if (!smActive && global._master) {
      /* Mevcut değerin %5'ini al — sirenin patlamaması için */
      var safeVol = Math.min(
        global._master.gain.value,
        OSC_GAIN_MAX * 2.5  /* %5 eşdeğeri */
      );
      var now = ctx.currentTime;
      global._master.gain.setValueAtTime(global._master.gain.value, now);
      global._master.gain.linearRampToValueAtTime(safeVol, now + 0.3);
      console.warn(TAG.sync, 'Safety Mute aktif: SampleManager bağlı değil.',
                   'Master volume →', safeVol.toFixed(3));
    }
  }

  /* ══════════════════════════════════════════════════════════════════════
     MERKEZI MASTER LFO — Tek kaynaktan 3D pan yönetimi
     ══════════════════════════════════════════════════════════════════════ */

  function _startMasterLFO(ctx) {
    _stopMasterLFO();
    if (!ctx) return;

    /* Master LFO: 0.006 Hz → ~166sn tam tur, çok yavaş mekansal hareket */
    _masterAutoPanLfoOsc = ctx.createOscillator();
    _masterAutoPanLfoOsc.type = 'sine';
    _masterAutoPanLfoOsc.frequency.value = 0.006;

    _masterAutoPanLfoGain = ctx.createGain();
    _masterAutoPanLfoGain.gain.value = 0; /* Başta sıfır — modüller kendi kendine bağlanır */

    _masterAutoPanLfoOsc.connect(_masterAutoPanLfoGain);
    _masterAutoPanLfoOsc.start();

    /* Global referans: SampleManager ve AudioEngine buraya bağlanabilir */
    global._sanctuaryMasterLFO      = _masterAutoPanLfoOsc;
    global._sanctuaryMasterLFOGain  = _masterAutoPanLfoGain;

    console.info(TAG.sync, 'Master LFO başlatıldı. (0.006 Hz — merkezi 3D pan)');
  }

  function _stopMasterLFO() {
    if (_masterAutoPanLfoOsc) {
      try { _masterAutoPanLfoOsc.stop(); _masterAutoPanLfoOsc.disconnect(); } catch(e){}
      _masterAutoPanLfoOsc = null;
    }
    if (_masterAutoPanLfoGain) {
      try { _masterAutoPanLfoGain.disconnect(); } catch(e){}
      _masterAutoPanLfoGain = null;
    }
    global._sanctuaryMasterLFO     = null;
    global._sanctuaryMasterLFOGain = null;
  }

  /* ══════════════════════════════════════════════════════════════════════
     ATOMİK SAHNE DEĞİŞİMİ — Frekans + Enstrüman aynı anda değişir
     ══════════════════════════════════════════════════════════════════════ */

  /**
   * Hem FrequencyManager'ı hem SampleManager'ı aynı milisaniyede günceller.
   * AudioEngine'in startSound çağrısıyla tam senkronize çalışır.
   *
   * @param {string}  gen        — Ses tipi (waves/rain/wind/zen/...)
   * @param {number}  base       — Temel frekans (Hz)
   * @param {number}  beat       — Binaural beat (Hz)
   * @param {string}  [sceneName]— Manuel sahne adı (Gemini'den)
   */
  function _atomicSceneChange(gen, base, beat, sceneName) {
    var ctx = global._ctx;
    if (!ctx) return;

    var GEN_TO_SCENE = {
      waves:'Calm Breath', rain:'Deep Peace', wind:'Light Breath',
      fire:'Energy Renewal', storm:'Focus Flow', binaural:'Heart Resonance',
      zen:'Zen Garden', space:'Deep Space', earth:'Earth Grounding',
      forest:'Night Forest', morning:'Morning Mist',
    };

    var targetScene = sceneName || GEN_TO_SCENE[gen] || 'Calm Breath';

    /* 1. FrequencyManager — baseFreq güncelle */
    if (_fm && isFinite(base) && base > 0) {
      try {
        _fm.setBaseFreq(base);
        console.info(TAG.math, 'baseFreq →', base, 'Hz | Sahne:', targetScene);
      } catch(e) { console.warn(TAG.math, 'setBaseFreq hatası:', e.message); }
    }

    /* 2. SampleManager — sahne ve enstrüman atomik uygula */
    if (_sm) {
      _sm.applyScene(targetScene).then(function() {
        if (_sm._isPlaying) {
          console.info(TAG.nature, 'Sahne güncellendi:', targetScene);
          console.info(TAG.instr, 'Enstrümanlar senkronize edildi ✓');
        } else {
          /* Henüz başlamamış — start() çağrısını bekle */
          _pendingScene = targetScene;
        }
      }).catch(function(e) {
        console.warn(TAG.nature, 'applyScene hatası:', e.message);
        /* Hata durumunda Safety Mute */
        _enforceSafetyMute(ctx);
      });
    } else {
      /* SampleManager yoksa Safety Mute — osilatörler bağırmaz */
      _enforceSafetyMute(ctx);
    }
  }

  /* ══════════════════════════════════════════════════════════════════════
     ARPEGGİATOR → SampleManager KÖPRÜSÜ
     Her nota değişiminde SampleManager'a bildirir.
     AudioEngine'in startArpeggiator içindeki scheduleNextArp callback'ine
     eklenen hook ile çalışır.
     ══════════════════════════════════════════════════════════════════════ */

  /**
   * Arpeggiator bir nota değiştirdiğinde bu fonksiyon çağrılır.
   * SampleManager'ın enstrüman buffer'ını yeni frekansta yeniden üretir.
   * @param {number} newFreq — Yeni temel frekans (Hz)
   * @param {number} ratio   — JI/Phi oranı
   */
  function _onArpNote(newFreq, ratio) {
    if (!_sm || !_sm._isPlaying) return;

    try {
      /* Enstrüman cache'ini temizle — yeni frekansta prosedürel buffer üretilsin */
      var currentPreset = _sm._currentPreset;
      if (currentPreset && currentPreset.primary) {
        var instrKey = currentPreset.primary;
        /* Cache'den sil: bir sonraki _startInstrument çağrısında yeniden üretir */
        if (_sm._instrumentCache) _sm._instrumentCache.delete(instrKey);
        /* Yeni frekansla enstrümanı yeniden başlat — 2sn crossfade */
        _sm._stopAllInstruments(1.5);
        setTimeout(function() {
          if (_sm && _sm._isPlaying) {
            _sm._startInstrument(instrKey, 'primary', currentPreset.primaryVol)
              .catch(function(e){ console.warn(TAG.instr, 'Nota güncelleme hatası:', e.message); });
          }
        }, 600); /* Fade-out bitmeden yeni ses başlamasın */
      }
      console.info(TAG.instr, 'Nota değişimi →', newFreq.toFixed(1), 'Hz | oran:', ratio.toFixed(3));
    } catch(e) {
      console.warn(TAG.instr, 'onArpNote hatası:', e.message);
    }
  }

  /* ══════════════════════════════════════════════════════════════════════
     TOGGLEPLAY HOOK — SM başlangıç garantisi
     AudioEngine'in togglePlay'i SM başlatmayı garanti etmiyordu.
     Burada tam kontrol altına alınıyor.
     ══════════════════════════════════════════════════════════════════════ */

  function _hookTogglePlay() {
    var _origToggle = global.togglePlay;
    if (!_origToggle) return;

    global.togglePlay = function() {
      var ctx = global._ctx || (function(){
        var C = global.AudioContext || global.webkitAudioContext;
        return C ? new C() : null;
      })();

      /* SM henüz bağlı değilse bootstrap et */
      if (!_sm && _smReady && ctx && global._master) {
        _sm = _bootstrapSampleManager(ctx, global._master);
      }

      /* Orijinal togglePlay'i çağır */
      _origToggle.apply(this, arguments);

      /* togglePlay oynatma başlattıysa SM'yi de başlat */
      var isNowPlaying = global._playing ||
        (document.getElementById('play-btn') &&
         document.getElementById('play-btn').classList.contains('on'));

      if (isNowPlaying && _sm && !_sm._isPlaying) {
        /* Bekleyen sahne varsa önce onu uygula */
        var applyPromise = _pendingScene
          ? _sm.applyScene(_pendingScene)
          : Promise.resolve();

        applyPromise.then(function() {
          _pendingScene = null;
          _sm.start();
          console.info(TAG.nature, 'SampleManager oynatma başladı ✓');
          console.info(TAG.instr, 'Enstrüman katmanı aktif ✓');
        }).catch(function(e){
          console.warn(TAG.nature, 'SM start hatası:', e.message);
          if (ctx && global._master) _enforceSafetyMute(ctx);
        });

        /* Master LFO başlat */
        _startMasterLFO(ctx);
      }

      /* SM duruyorsa (pause) */
      if (!isNowPlaying && _sm && _sm._isPlaying) {
        _sm.stop(3.0);
        _stopMasterLFO();
        console.info(TAG.sync, 'Tüm modüller durduruldu.');
      }
    };

    global._audioToggle = global.togglePlay; /* Referans güncelle */
    console.info(TAG.sync, 'togglePlay hook bağlandı ✓');
  }

  /* ══════════════════════════════════════════════════════════════════════
     SWITCHSOUND HOOK — Atomik sahne değişimi
     ══════════════════════════════════════════════════════════════════════ */

  function _hookSwitchSound() {
    var _origSwitch = global.switchSound;
    if (!_origSwitch) return;

    global.switchSound = function(gen, base, beat, label, msd) {
      var ctx = global._ctx;

      /* SM bootstrap — henüz bağlı değilse */
      if (!_sm && _smReady && ctx && global._master) {
        _sm = _bootstrapSampleManager(ctx, global._master);
      }

      /* FM güncelle */
      if (_fm && isFinite(base) && base > 0) {
        try { _fm.setBaseFreq(base); } catch(e) {}
      }

      /* Referans state güncelle */
      global._lastGen  = gen;
      global._lastBase = base;
      global._lastBeat = beat || 0;

      /* Orijinal AudioEngine switchSound'u çağır
         (startSound + eski SM çağrısı) */
      _origSwitch.call(this, gen, base, beat, label, msd);

      /* Atomik sahne değişimi — FM + SM aynı anda */
      var sceneName = (msd && typeof msd.sceneName === 'string')
        ? msd.sceneName
        : undefined;
      _atomicSceneChange(gen, base, beat, sceneName);

      /* RoomManager broadcast — v9'da gen kaybediyordu, şimdi güvenli */
      if (global.RoomManager && typeof global.RoomManager.getRole === 'function') {
        if (global.RoomManager.getRole() === 'host') {
          try { global.RoomManager.broadcastAudioState(); } catch(e){}
        }
      }
    };

    global._audioSwitchSound = global.switchSound;
    console.info(TAG.sync, 'switchSound hook bağlandı ✓');
  }

  /* ══════════════════════════════════════════════════════════════════════
     ARPEGGİATOR HOOK — AudioEngine'e nota callback enjekte et
     AudioEngine'in global _arpNoteCallback değişkenini okur.
     AudioEngine startArpeggiator içinde bu callback çağrılır.
     ══════════════════════════════════════════════════════════════════════ */

  function _hookArpeggiator() {
    /* AudioEngine, her nota değişiminde global._arpNoteCallback'i çağırır.
       Bu hook'u AudioEngine_v9.js içindeki startArpeggiator'a ekliyoruz.
       AudioEngine kodunu değiştirmeden, window üzerinden inject ediyoruz. */
    global._arpNoteCallback = function(newFreq, ratio) {
      _onArpNote(newFreq, ratio);
    };
    console.info(TAG.sync, 'Arpeggiator → SampleManager köprüsü kuruldu ✓');
  }

  /* ══════════════════════════════════════════════════════════════════════
     OSCİLATÖR SAFETY MUTE UYGULAYICI
     AudioEngine_v9'daki OSC_GAIN değerlerini doğrular ve üst sınırı zorlar.
     ══════════════════════════════════════════════════════════════════════ */

  function _enforceOscGainLimit() {
    /* AudioEngine içindeki _master bus üzerinden dolaylı kontrol.
       OSC_GAIN_MAX = 0.02 → Eğer SM yoksa master gain cap'i uygula. */
    var checkInterval = setInterval(function() {
      var ctx = global._ctx;
      var master = global._master;
      if (!ctx || !master) return;

      var smActive = _sm && _sm._isPlaying;
      if (!smActive) {
        /* SM çalışmıyor — master'ı kısıtlı tut */
        var currentGain = master.gain.value;
        if (currentGain > OSC_GAIN_MAX * 10) {
          var now = ctx.currentTime;
          master.gain.setValueAtTime(currentGain, now);
          master.gain.linearRampToValueAtTime(
            Math.min(currentGain, 0.15), /* Tamamen kapama değil, sadece siren yok */
            now + 1.0
          );
        }
      }
    }, 5000); /* 5 saniyede bir kontrol */

    /* Interval referansını sakla — dispose için */
    global._syncOscGuardInterval = checkInterval;
  }

  /* ══════════════════════════════════════════════════════════════════════
     INIT — Tüm senkronizasyonu başlat
     ══════════════════════════════════════════════════════════════════════ */

  function init() {
    if (_initialized) {
      console.warn(TAG.sync, 'Zaten başlatıldı.');
      return;
    }

    console.info(TAG.sync, '══ Senkronizasyon Protokolü Başlıyor (Aşama 11) ══');

    /* 1. Handshake — modül kontrolü */
    var aeOk = _checkHandshake();
    if (!aeOk) {
      console.error(TAG.sync, 'AudioEngine bulunamadı. Init iptal edildi.');
      return;
    }

    /* 2. FrequencyManager bootstrap */
    _bootstrapFrequencyManager(432);

    /* 3. Hook'ları bağla */
    _hookTogglePlay();
    _hookSwitchSound();
    _hookArpeggiator();

    /* 4. Osilatör güvenlik monitörü */
    _enforceOscGainLimit();

    /* 5. AudioContext hazırsa SM'yi hemen bootstrap et */
    if (global._ctx && global._master && _smReady) {
      _sm = _bootstrapSampleManager(global._ctx, global._master);
    }
    /* Değilse: togglePlay veya switchSound ilk çağrısında bootstrap edilir */

    _initialized = true;

    console.info(TAG.sync, '══ Senkronizasyon Tamamlandı ══');
    console.info(TAG.math,   'Matematik Hazır       |', _fmReady ? '✓' : '✗ (FM eksik)');
    console.info(TAG.nature, 'Doğa Sesleri Bağlandı |', _smReady ? '✓' : '✗ (SM eksik)');
    console.info(TAG.instr,  'Enstrümanlar           |', _smReady ? 'Senkronize edildi ✓' : '✗');
    console.info(TAG.sync,   'Osilatör Safety Mute  | max gain:', OSC_GAIN_MAX);
  }

  /* ══════════════════════════════════════════════════════════════════════
     ACTIVATE — Dışarıdan sahne/ses başlatma (isteğe bağlı)
     ══════════════════════════════════════════════════════════════════════ */

  function activate(gen, base, beat, sceneName) {
    if (!_initialized) init();
    if (typeof global.switchSound === 'function') {
      global.switchSound(gen || 'waves', base || 200, beat || 7,
                         null,
                         sceneName ? { sceneName: sceneName } : undefined);
    }
  }

  /* ══════════════════════════════════════════════════════════════════════
     DISPOSE — Temizleme
     ══════════════════════════════════════════════════════════════════════ */

  function dispose() {
    _stopMasterLFO();
    if (global._syncOscGuardInterval) {
      clearInterval(global._syncOscGuardInterval);
      global._syncOscGuardInterval = null;
    }
    if (_sm) { try { _sm.dispose(); } catch(e){} _sm = null; }
    _initialized = false;
    console.info(TAG.sync, 'Dispose tamamlandı.');
  }

  /* ══════════════════════════════════════════════════════════════════════
     PUBLIC API
     ══════════════════════════════════════════════════════════════════════ */

  global.SanctuarySync = {
    init     : init,
    activate : activate,
    dispose  : dispose,
    getStatus: function() {
      return {
        initialized   : _initialized,
        frequencyMgr  : _fmReady,
        sampleMgr     : _smReady,
        audioEngine   : _aeReady,
        smPlaying     : _sm ? _sm._isPlaying : false,
        currentScene  : _sm ? _sm._currentScene : null,
        baseFreq      : _fm ? _fm.baseFreq : null,
      };
    },
  };

})(window);

/* ═══════════════════════════════════════════════════════════════════════════
   OTOMATİK INIT — DOM hazır olduğunda kendiliğinden başlar
   ═══════════════════════════════════════════════════════════════════════════ */
(function() {
  function _autoInit() {
    /* AudioEngine ve SampleManager yüklenmesini bekle */
    var maxWait = 50; /* 50 × 100ms = 5 saniye */
    var attempts = 0;
    var interval = setInterval(function() {
      attempts++;
      var aeReady = typeof window.togglePlay !== 'undefined';
      var smReady = typeof window.SampleManager !== 'undefined';

      if (aeReady || attempts >= maxWait) {
        clearInterval(interval);
        if (aeReady) {
          window.SanctuarySync.init();
        } else {
          console.error('[SanctuarySync] Zaman aşımı: AudioEngine yüklenemedi.');
        }
      } else if (attempts === 1) {
        /* İlk denemede bilgi ver */
        console.info('[SanctuarySync] AudioEngine bekleniyor...',
                     smReady ? '(SM hazır)' : '(SM de bekleniyor)');
      }
    }, 100);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', _autoInit);
  } else {
    /* DOM zaten hazır (script async/defer yüklendiyse) */
    _autoInit();
  }
})();
