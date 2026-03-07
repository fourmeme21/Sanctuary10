/* v3 — Aşama 3: Sinyal Zinciri & Ses Kalitesi Revizyonu */

/* ═══════════════════════════════════════════════════════════════════
   SANCTUARY SES MOTORU (v3 — Analog Sıcaklık, Düzeltilmiş Sinyal Yolu)
   Sinyal Şeması:
     Osilatörler/Gürültü → _mainFilter (LP 2kHz) → _master → EQ → Comp → destination
   togglePlay, switchSound, setSleepTimer burada tanımlı
   ═══════════════════════════════════════════════════════════════════ */
(function(){
  'use strict';

  /* ── Modül-Düzeyi Değişkenler ── */
  var _ctx=null, _master=null, _comp=null, _mainFilter=null;
  var _eqLow=null, _eqMid=null, _eqHigh=null;
  var _oscs=[], _noise=null, _noiseGain=null, _granular=null;
  var _playing=false, _startTime=0, _pauseOffset=0;
  var _loopDur=8, _curGen=null, _curBase=0, _curBeat=0;

  /* Aşama 2 — LFO + SampleManager */
  var _lfoOsc=null, _lfoGain=null;
  var _sampleManager=null;

  /* ── Ruh Hali Haritası ── */
  var MOOD_MAP = {
    'Huzursuz' : {base:180, beat:6,  gen:'waves'},
    'Yorgun'   : {base:200, beat:4,  gen:'rain'},
    'Kaygılı'  : {base:160, beat:8,  gen:'wind'},
    'Mutsuz'   : {base:220, beat:5,  gen:'waves'},
    'Sakin'    : {base:200, beat:7,  gen:'binaural'},
    'Minnettar': {base:528, beat:10, gen:'rain'},
  };

  /* ── AudioContext ── */
  function getCtx() {
    if (!_ctx) {
      var C = window.AudioContext || window.webkitAudioContext;
      _ctx = new C();
      window._ctx = _ctx; /* Dış erişim için yayınla (applyBiometricEffect, RoomManager) */
    }
    return _ctx;
  }

  /* ── Master Bus: mainFilter → Gain → EQ → Compressor/Limiter ──
   *
   * Aşama 3 — Sinyal Zinciri DÜZELTİLDİ:
   *   Tüm kaynaklar → _mainFilter → _master → eqLow → eqMid → eqHigh → _comp → destination
   *   _mainFilter: BiquadFilter lowpass @ 2000 Hz, Q 0.707
   *   Hışırtı ve tiz kirlilikler _mainFilter tarafından traşlanır;
   *   _master öncesinde konumlandırılması tüm kaynakları etkiler.
   * ────────────────────────────────────────────────────────────── */
  function ensureMaster(ctx) {
    if (_master) return;

    /* DynamicsCompressor — ses patlamalarını önle */
    _comp = ctx.createDynamicsCompressor();
    _comp.threshold.value = -6;
    _comp.ratio.value     = 10;
    _comp.knee.value      = 8;
    _comp.attack.value    = 0.003;
    _comp.release.value   = 0.25;

    /* 3-band EQ */
    _eqLow  = ctx.createBiquadFilter();
    _eqLow.type = 'lowshelf';
    _eqLow.frequency.value = 200;
    _eqLow.gain.value = 2;

    _eqMid  = ctx.createBiquadFilter();
    _eqMid.type = 'peaking';
    _eqMid.frequency.value = 1000;
    _eqMid.Q.value = 0.8;
    _eqMid.gain.value = -1;

    _eqHigh = ctx.createBiquadFilter();
    _eqHigh.type = 'highshelf';
    _eqHigh.frequency.value = 6000;
    _eqHigh.gain.value = 1.5;

    /* Aşama 3 — Ana Lowpass Filtresi (kaynaklar buraya bağlanır) */
    _mainFilter = ctx.createBiquadFilter();
    _mainFilter.type            = 'lowpass';
    _mainFilter.frequency.value = 2000;   /* Hz — hışırtı sınırı */
    _mainFilter.Q.value         = 0.707;  /* Butterworth — yumuşak kesim */

    /* Master gain */
    _master = ctx.createGain();
    _master.gain.value = (window._prefVector ? window._prefVector.masterVolume : 0.8);

    /* ═══ Zincir bağlantısı ═══
     * kaynaklar → _mainFilter → _master → eqLow → eqMid → eqHigh → _comp → destination */
    _mainFilter.connect(_master);
    _master.connect(_eqLow);
    _eqLow.connect(_eqMid);
    _eqMid.connect(_eqHigh);
    _eqHigh.connect(_comp);
    _comp.connect(ctx.destination);

    /* Dış erişim için yayınla */
    window._master     = _master;
    window._mainFilter = _mainFilter;
    window._eqLow      = _eqLow;
    window._eqMid      = _eqMid;
    window._eqHigh     = _eqHigh;
  }

  /* ── Solfeggio + Pentatonic ── */
  var SCALES = {
    solfeggio:  [174, 285, 396, 417, 528, 639, 741, 852, 963],
    pentatonic: [261.63, 293.66, 329.63, 392.00, 440.00, 523.25, 587.33, 659.25, 783.99, 880.00],
  };

  function snapToScale(freq, scaleName) {
    if (!isFinite(freq) || freq <= 0) return freq;
    var scale = SCALES[scaleName] || SCALES.solfeggio;
    var best = scale[0], bestDiff = Infinity;
    scale.forEach(function(note) {
      var n = note;
      while (n < freq * 0.7) n *= 2;
      while (n > freq * 1.4) n /= 2;
      var diff = Math.abs(n - freq);
      if (diff < bestDiff) { bestDiff = diff; best = n; }
    });
    return best;
  }

  /* ── Ses Buffer Üretici (Aşama 3: Brownian Noise) ──
   *
   * Beyaz gürültü (Math.random) TÜM sürekli gürültü katmanlarında
   * Brownian Noise algoritmasıyla değiştirildi:
   *   lastOut = (lastOut + 0.02 * white) / 1.02
   * Bu formül yüksek frekansları doğal olarak baskılar; ses daha
   * derin, organik ve analogdur.
   * ─────────────────────────────────────────────────────────────── */
  function makeBuffer(ctx, type) {
    var sr  = ctx.sampleRate || 44100;
    var len = Math.round(sr * _loopDur);
    var buf = ctx.createBuffer(2, len, sr);
    for (var ch = 0; ch < 2; ch++) {
      var d = buf.getChannelData(ch);
      var p1=0, p2=0, p3=0;
      var lastOut = 0; /* Brownian state — her kanal için sıfırlanır */
      for (var i = 0; i < len; i++) {
        var v = 0;
        var white = Math.random() * 2 - 1; /* Ham beyaz gürültü */
        /* Brownian dönüşümü: yüksek frekansları entegre ederek bastırır */
        lastOut = (lastOut + 0.02 * white) / 1.02;

        if (type === 'waves') {
          p1 += (2*Math.PI*0.08)/sr; p2 += (2*Math.PI*0.19)/sr; p3 += (2*Math.PI*0.04)/sr;
          var sw = Math.sin(p3)*0.4+0.6;
          /* Brownian gürültü dalga yüzeyi üzerine bindiriliyor */
          v = Math.sin(p1)*0.18*sw + Math.sin(p2)*0.09*sw + lastOut * 0.12 * sw;
        } else if (type === 'rain') {
          p1 += (2*Math.PI*0.6)/sr;
          /* Sürekli zemin: Brownian; nadir ani damlalar: beyaz (fiziksel doğruluk) */
          v  = lastOut * 0.45 + (Math.random()<0.003?(Math.random()*2-1)*0.6:0);
          v *= (0.7 + Math.sin(p1)*0.3);
        } else if (type === 'wind') {
          p1 += (2*Math.PI*0.12)/sr; p2 += (2*Math.PI*0.05)/sr;
          v  = lastOut * 0.7 * Math.max(0, 0.5+Math.sin(p2)*0.4+Math.sin(p1*0.3)*0.1);
        } else if (type === 'fire') {
          p1 += (2*Math.PI*2.5)/sr; p2 += (2*Math.PI*0.07)/sr;
          v  = lastOut * 0.5 * (0.6+Math.sin(p2)*0.4) + Math.sin(p1)*0.04
             + (Math.random()<0.008?(Math.random()*2-1)*0.5:0);
        } else if (type === 'storm') {
          p1 += (2*Math.PI*0.25)/sr; p2 += (2*Math.PI*0.04)/sr;
          v  = lastOut * 0.85 * (0.6+Math.sin(p1)*0.4) + Math.sin(p2)*0.03;
        } else {
          /* binaural / varsayılan — minimal ambiyans */
          v = lastOut * 0.25;
        }
        d[i] = isFinite(v) ? Math.max(-1, Math.min(1, v)) : 0;
      }
    }
    return buf;
  }

  /* ── Temizleyiciler ── */
  function stopLFO() {
    if (_lfoOsc)  { try { _lfoOsc.stop();        } catch(e){} _lfoOsc  = null; }
    if (_lfoGain) { try { _lfoGain.disconnect();  } catch(e){} _lfoGain = null; }
  }

  function stopOscs() {
    _oscs.forEach(function(o){ try{o.stop();o.disconnect();}catch(e){} });
    _oscs = [];
    stopLFO();
  }

  function stopNoise() {
    if (_noiseGain) { try{_noiseGain.disconnect();}catch(e){} _noiseGain = null; }
    if (_noise)     { try{_noise.stop();_noise.disconnect();}catch(e){} _noise = null; }
    if (_granular)  { try{_granular.stop();}catch(e){} _granular = null; }
  }

  /* ── Ses Başlat ──
   *
   * Aşama 3 değişiklikleri:
   *   1. Binaural osilatörler: sine (temel) + triangle (harmonik, %30 vol)
   *   2. Tüm kaynaklar _mainFilter'a bağlanır (_master'a doğrudan değil)
   *   3. Fade-in: exponentialRampToValueAtTime(0.0001 → hedef, 2sn)
   * ─────────────────────────────────────────────────────────────── */
  function startSound(gen, base, beat, offset) {
    var ctx = getCtx();
    if (ctx.state === 'suspended') ctx.resume();
    ensureMaster(ctx);

    /* Sahne geçişinde master gain'i sıfırla (önceki fade-out'u iptal et) */
    if (_master) {
      var _cancelNow = ctx.currentTime;
      _master.gain.cancelScheduledValues(_cancelNow);
      _master.gain.setValueAtTime(
        window._prefVector ? window._prefVector.masterVolume : 0.8,
        _cancelNow
      );
    }

    stopOscs();

    /* ═══ Binaural Osilatörler ═══
     * Aşama 3 — Osilatör Zenginleştirme (Layering):
     *   • Temel frekans: 'sine' dalgası
     *   • Harmonik (3. kısmi): 'triangle' dalgası, temel sesin %30'u kadar kazanç
     *   • Her iki osilatör de _mainFilter üzerinden _master'a gider
     * ────────────────────────────────────────────────────────────── */
    if (beat > 0) {
      var _fm = (typeof window.getFrequencyManager === 'function')
        ? window.getFrequencyManager(base)
        : null;
      if (_fm) _fm.setBaseFreq(isFinite(base) ? base : 200);

      var _leftFreq  = _fm ? _fm.getNextFrequency() : (isFinite(base) ? base : 200);
      var _rightFreq = _fm
        ? Math.max(20, Math.min(20000, _leftFreq + beat))
        : (isFinite(base + beat) ? base + beat : 207);

      /* ChannelMerger → _mainFilter (düzeltilmiş bağlantı noktası) */
      var mg = ctx.createChannelMerger(2);
      mg.connect(_mainFilter); /* Aşama 3: _master yerine _mainFilter */

      /* LFO — "nefes" modülasyonu */
      stopLFO();
      _lfoGain         = ctx.createGain();
      _lfoGain.gain.value = 0;

      _lfoOsc          = ctx.createOscillator();
      _lfoOsc.type     = 'sine';
      _lfoOsc.frequency.value = 0.1;

      var _lfoDepth = ctx.createGain();
      _lfoDepth.gain.value = 0.03;
      _lfoOsc.connect(_lfoDepth);

      var _oscStartNow = ctx.currentTime;

      [[_leftFreq, 0], [_rightFreq, 1]].forEach(function(p) {
        /* Aşama 3 — Zarf (Envelope) için ayrı gain düğümü */
        var envGain = ctx.createGain();
        envGain.gain.setValueAtTime(0.0001, _oscStartNow);
        envGain.gain.exponentialRampToValueAtTime(1.0, _oscStartNow + 2); /* 2sn fade-in */
        envGain.connect(mg, 0, p[1]);

        /* ── Temel Osilatör: sine ── */
        var o = ctx.createOscillator();
        var g = ctx.createGain();
        o.type = 'sine';
        o.frequency.value = p[0];
        g.gain.value = 0.10;
        _lfoDepth.connect(g.gain); /* LFO nefes modülasyonu */
        o.connect(g);
        g.connect(envGain);
        o.start(); _oscs.push(o);

        /* ── Harmonik Osilatör: triangle (3. kısmi, %30 kazanç) ── */
        var harmonicFreq = Math.min(20000, p[0] * 3);
        var oH = ctx.createOscillator();
        var gH = ctx.createGain();
        oH.type = 'triangle';
        oH.frequency.value = harmonicFreq;
        gH.gain.value = 0.03; /* 0.10 × 0.30 = 0.03 (temel sesin %30'u) */
        oH.connect(gH);
        gH.connect(envGain);
        oH.start(); _oscs.push(oH);
      });

      _lfoOsc.start();
    }

    var now    = ctx.currentTime;
    var ambVol = window._prefVector ? window._prefVector.getLayerGains().ambient * 0.85 : 0.60;
    var xfDur  = 2.0; /* Aşama 3: Sabit 2sn geçiş süresi */

    /* ═══ Ortam Sesi (Ambient Layer) ═══ */
    if (window.GranularEngine) {
      var grainTypeMap = {waves:'waves', rain:'rain', wind:'wind', fire:'forest', storm:'wind', binaural:'forest'};
      var grainType = grainTypeMap[gen] || 'wind';
      var _panner = ctx.createStereoPanner ? ctx.createStereoPanner() : null;
      var _panVal = {waves:0.6, rain:0.4, wind:0.7, fire:0.5, storm:0.8, binaural:0.0}[gen] || 0.3;
      /* Aşama 3: GranularEngine çıkışı _mainFilter'a gider */
      if (_panner) {
        _panner.pan.value = (Math.random()>0.5?1:-1)*_panVal;
        _panner.connect(_mainFilter); /* Düzeltildi: _master → _mainFilter */
      }
      var _granDest = _panner || _mainFilter;
      _granular = new window.GranularEngine(ctx, _granDest, { volume: ambVol });
      _granular.generateBuffer(grainType);
      _granular.start();
      _startTime = now;
    } else {
      /* ── Fallback: Brownian Buffer Kaynağı ──
       * Aşama 3: gain → _mainFilter (düzeltildi), exponentialRamp fade-in */
      var src  = ctx.createBufferSource();
      var filt = ctx.createBiquadFilter();
      var gain = ctx.createGain();
      src.buffer    = makeBuffer(ctx, gen);
      src.loop      = true;
      src.loopStart = 0;
      src.loopEnd   = _loopDur;
      filt.type            = 'lowpass';
      filt.frequency.value = {waves:900,rain:2500,wind:1800,fire:1200,storm:3000,binaural:400}[gen]||800;
      filt.Q.value = 0.8;

      /* Aşama 3: _master yerine _mainFilter (sinyal zinciri düzeltmesi) */
      src.connect(filt); filt.connect(gain); gain.connect(_mainFilter);

      var off = isFinite(offset) ? (offset % _loopDur + _loopDur) % _loopDur : 0;

      /* Aşama 3: exponentialRamp, 0.0001'den başla */
      gain.gain.setValueAtTime(0.0001, now);
      gain.gain.exponentialRampToValueAtTime(ambVol, now + xfDur);

      /* Çapraz geçiş: eski gürültüyü kademeli kapat */
      if (_noiseGain) {
        var oldG = _noiseGain;
        oldG.gain.setValueAtTime(oldG.gain.value, now);
        oldG.gain.exponentialRampToValueAtTime(0.0001, now + xfDur);
        setTimeout(function(){ try{oldG.disconnect();}catch(e){} }, (xfDur+0.1)*1000);
      }

      src.start(0, off); _startTime=now; _noise=src; _noiseGain=gain;
    }

    _curGen  = gen;
    _curBase = isFinite(base) ? base : 0;
    _curBeat = isFinite(beat) ? beat : 0;

    /* UI güncelle */
    var badge = document.getElementById('freq-badge');
    var lbl   = document.getElementById('freq-label');
    if (badge) badge.classList.add('on');
    if (lbl)   lbl.textContent = _curBase + ' Hz · ' + gen;
    var wf = document.getElementById('waveform');
    if (wf) {
      if (!wf.children.length) {
        for (var i=0; i<12; i++) {
          var b = document.createElement('div');
          b.className = 'wbar';
          b.style.setProperty('--dur', (0.4+Math.random()*0.6)+'s');
          b.style.setProperty('--del', (Math.random()*0.4)+'s');
          wf.appendChild(b);
        }
      }
      wf.querySelectorAll('.wbar').forEach(function(b){ b.classList.add('on'); });
    }
  }

  /* ══════════════════════════════════════════════
     GLOBAL API
     ══════════════════════════════════════════════ */

  window.togglePlay = function() {
    var btn  = document.getElementById('play-btn');
    var icon = document.getElementById('play-icon');
    var lbl  = document.getElementById('play-lbl');
    var wrap = document.querySelector('.breath-wrap');

    _playing = !_playing;

    if (icon) icon.textContent = _playing ? '⏸' : '▶';
    if (btn)  { btn.setAttribute('aria-pressed', String(_playing)); btn.classList.toggle('on', _playing); }
    if (lbl)  lbl.textContent  = _playing ? 'Duraklat' : 'Frekansı Başlat';
    if (wrap) {
      wrap.classList.remove('breath-idle','breath-inhale');
      wrap.classList.add(_playing ? 'breath-inhale' : 'breath-idle');
    }

    if (_playing) {
      try {
        var gen='', base=0, beat=0;
        try { gen=localStorage.getItem('lastGen')||''; base=parseInt(localStorage.getItem('lastBase')||'0')||0; beat=parseInt(localStorage.getItem('lastBeat')||'0')||0; } catch(e){}
        if (!gen || !base) {
          var mood='Sakin'; try{ mood=localStorage.getItem('lastMood')||'Sakin'; }catch(e){}
          var cfg = MOOD_MAP[mood] || MOOD_MAP['Sakin'];
          gen=cfg.gen; base=cfg.base; beat=cfg.beat;
        }
        startSound(gen, base, beat, _pauseOffset);
        if (window._feedbackCollector) try{ window._feedbackCollector.startSession(mood||null); }catch(e){}
      } catch(e) {
        _playing = false;
        if (icon) icon.textContent = '▶';
        if (btn)  { btn.setAttribute('aria-pressed','false'); btn.classList.remove('on'); }
        if (lbl)  lbl.textContent = 'Frekansı Başlat';
        console.warn('[togglePlay]', e);
      }
    } else {
      /* Aşama 3 — Yumuşak Durdurma: 2sn exponentialRamp fade-out */
      if (_ctx && _startTime) _pauseOffset = (_ctx.currentTime - _startTime) % _loopDur;
      if (_ctx && _master) {
        var _stopNow = _ctx.currentTime;
        _master.gain.cancelScheduledValues(_stopNow);
        _master.gain.setValueAtTime(_master.gain.value, _stopNow);
        _master.gain.exponentialRampToValueAtTime(0.0001, _stopNow + 2);
        setTimeout(function() {
          stopOscs(); stopNoise();
          if (_sampleManager) { try { _sampleManager.stop(); } catch(e){} }
          if (_ctx) try{ _ctx.suspend(); }catch(e){}
          /* Sonraki play için master gain'i sıfırla */
          if (_master && _ctx) {
            _master.gain.setValueAtTime(
              window._prefVector ? window._prefVector.masterVolume : 0.8,
              _ctx.currentTime
            );
          }
        }, 2100);
      } else {
        stopOscs(); stopNoise();
        if (_sampleManager) { try { _sampleManager.stop(); } catch(e){} }
        if (_ctx) try{ _ctx.suspend(); }catch(e){}
      }
      document.querySelectorAll('.wbar').forEach(function(b){ b.classList.remove('on'); });
      var badge = document.getElementById('freq-badge');
      if (badge) badge.classList.remove('on');
      if (window._feedbackCollector) try{ window._feedbackCollector.endSession(); }catch(e){}
    }
  };

  window.switchSound = function(gen, base, beat, label, msd) {
    try{ localStorage.setItem('lastGen',gen); localStorage.setItem('lastBase',base); localStorage.setItem('lastBeat',beat); }catch(e){}
    if (window._prefVector) try{ window._prefVector.recordSoundChoice(gen, base, beat); }catch(e){}
    _pauseOffset = 0;
    if (_playing) startSound(gen, base, beat, 0);

    /* Aşama 2 — Hibrit: SampleManager organik katmanı güncelle */
    if (msd && typeof window.SampleManager !== 'undefined') {
      var ctx = getCtx();
      ensureMaster(ctx);
      if (!_sampleManager) {
        _sampleManager = new window.SampleManager(ctx, _master, { basePath: 'audio/' });
      }
      _sampleManager.applyMSD(msd).then(function() {
        if (_playing) _sampleManager.start();
      }).catch(function(e){ console.warn('[SampleManager] applyMSD hata:', e); });
    }

    var lbl   = document.getElementById('freq-label');
    var badge = document.getElementById('freq-badge');
    if (lbl)   lbl.textContent = (base||'') + ' Hz · ' + (label||gen);
    if (badge) { badge.classList.add('on'); badge.style.opacity='1'; }
  };

  window.setSleepTimer = function(minutes) {
    if (window._sleepTimerRef) clearTimeout(window._sleepTimerRef);
    document.querySelectorAll('.stimer-btn').forEach(function(b){ b.classList.remove('active','fading'); });
    var activeBtn = Array.from(document.querySelectorAll('.stimer-btn'))
      .find(function(b){ return b.textContent.trim() === minutes+'dk'; });
    if (activeBtn) activeBtn.classList.add('active');
    var st = document.getElementById('stimer-status');
    if (st) { st.textContent='⏰ '+minutes+' dk sonra duracak'; st.className='active'; }
    var fadeAt=(minutes-2)*60*1000, stopAt=minutes*60*1000;
    if (fadeAt>0) setTimeout(function(){
      if(_ctx&&_master){var now=_ctx.currentTime;_master.gain.setValueAtTime(_master.gain.value,now);_master.gain.linearRampToValueAtTime(0,now+120);}
      if(st){st.textContent='🌙 Ses kısılıyor...';st.className='fading';}
      if(activeBtn)activeBtn.classList.add('fading');
    }, fadeAt);
    window._sleepTimerRef = setTimeout(function(){
      if(_playing) window.togglePlay();
      if(st){st.textContent='✓ Tamamlandı';st.className='';}
      document.querySelectorAll('.stimer-btn').forEach(function(b){b.classList.remove('active','fading');});
      window._sleepTimerRef = null;
    }, stopAt);
  };

  window.cancelSleepTimer = function() {
    if(window._sleepTimerRef){clearTimeout(window._sleepTimerRef);window._sleepTimerRef=null;}
    document.querySelectorAll('.stimer-btn').forEach(function(b){b.classList.remove('active','fading');});
    var st=document.getElementById('stimer-status');
    if(st){st.textContent='';st.className='';}
    if(_ctx&&_master&&_playing){var now=_ctx.currentTime;_master.gain.cancelScheduledValues(now);_master.gain.setValueAtTime(_master.gain.value,now);_master.gain.linearRampToValueAtTime(0.8,now+1);}
  };

  window.getFrequency    = function(){ return _curBase; };
  window.getMasterVolume = function(){ return _master ? _master.gain.value : 0.8; };
  window.setMasterVolume = function(vol){
    vol = Math.max(0,Math.min(1,vol));
    if(_master&&_ctx){var now=_ctx.currentTime;_master.gain.setValueAtTime(_master.gain.value,now);_master.gain.linearRampToValueAtTime(vol,now+0.3);}
  };

})();
/* ═══════════════════════════════════════════════════ */

/* ══ ADIM 8: Listener adaptasyonu + syncStart ══ */

  /* applyRemoteState — Host'tan gelen parametreleri uygula */
  window.applyRemoteState = function(params) {
    if (!params) return;
    try {
      if (params.volume !== undefined) window.setMasterVolume && window.setMasterVolume(params.volume);
      if (params.gen && params.base) {
        window.switchSound && window.switchSound(params.gen, params.base, params.beat||0);
      }
    } catch(e) { console.warn('[applyRemoteState]', e); }
  };

  /* syncStart — odadaki herkes aynı anda başlar */
  window.syncStart = function(timestamp) {
    var delay = Math.max(0, timestamp - Date.now());
    setTimeout(function() {
      if (!window._playing) window.togglePlay && window.togglePlay();
    }, delay);
    console.info('[syncStart] delay:', delay, 'ms');
  };

  /* Ses değişimlerini kaydet (RoomManager yayın için kullanır) */
  var _origSwitchSound = window.switchSound;
  window.switchSound = function(gen, base, beat, label) {
    window._lastGen  = gen;
    window._lastBase = base;
    window._lastBeat = beat||0;
    if (_origSwitchSound) _origSwitchSound.apply(this, arguments);
    /* Host ise anında yayınla */
    if (window.RoomManager && window.RoomManager.getRole()==='host') {
      window.RoomManager.broadcastAudioState();
    }
  };

/* ══ ADIM 9: Biyometrik Adaptasyon ══ */
window.applyBiometricEffect = function(p) {
  if (!p || !window._ctx) return;
  var now  = window._ctx.currentTime;
  var ramp = 2.0;
  try {
    if (window._master && p.masterVolume !== undefined)
      window._master.gain.linearRampToValueAtTime(Math.max(0.1, Math.min(1, p.masterVolume)), now + ramp);
    if (window._eqLow && p.eqLowBoost !== undefined)
      window._eqLow.gain.linearRampToValueAtTime(Math.max(-6, Math.min(6, 2 + p.eqLowBoost)), now + ramp);
    if (window._eqHigh && p.eqHighCut !== undefined)
      window._eqHigh.gain.linearRampToValueAtTime(Math.max(-6, Math.min(6, 1.5 + p.eqHighCut)), now + ramp);
    if (window._granular && typeof window._granular.setDensity === 'function')
      window._granular.setDensity(Math.max(0.2, p.granularDensity || 0.8));
    /* Aşama 3: mainFilter frekansını da biyometrik parametreye göre ayarla */
    if (window._mainFilter && p.filterFreq !== undefined)
      window._mainFilter.frequency.linearRampToValueAtTime(
        Math.max(500, Math.min(8000, p.filterFreq)), now + ramp
      );
  } catch(e) { console.warn('[applyBiometricEffect]', e); }
};

/* ── Yedek referans: main.js'deki wrapper'lar için güvenlik kilidi ── */
window._audioToggle      = window.togglePlay;
window._audioSwitchSound = window.switchSound;
window._audioSleepTimer  = window.setSleepTimer;
