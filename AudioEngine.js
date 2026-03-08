/* ═══════════════════════════════════════════════════════════════════════════
   SANCTUARY SES MOTORU — v6.1 (Mimari Entegrasyon & Psikoakustik Restorasyon)
   ─────────────────────────────────────────────────────────────────────────────
   Sinyal Zinciri:
     Kaynaklar
       → _mainFilter  (LFO: 600–3200 Hz @ 0.05 Hz | Q:4.0 — vokal rezonans)
       → _masteringComp
       → _satNode     (tanh Soft-Clip k=8, oversample 4x — agresif analog sıcaklık)
       → _tremoloNode (±20% @ 0.08 Hz — fiziksel nabız, duyulur seviye)
       → _master
       → EQ (low/mid/high)
       → _comp
       → destination

   v6.1 değişiklikleri (Psikoakustik Restorasyon):
     • Filter Q          : 3.5 → 4.0 — filtre hareketi sırasında daha keskin vokal formant
     • Binaural Koro     : detune ±1.5–3 cent → ±8 cent — analog koro genişliği, dijital soğukluk kırıldı
     • Soft-Clip         : k=6 → k=8 — orta genliklerde bile bariz doygunluk, "potansiyel" doldu
     • Tremolo Derinliği : %18 → %20 — gain 0.60–1.00 (base 0.80), bilinçaltı ritim tetiklendi
     • Chaos Drift       : ±4 cent, 3–6 sn — (v6.0 optimum, korundu)
     • Filter LFO        : ±1300 Hz → 600–3200 Hz — (v6.0 optimum, korundu)
     • Harmonik Binaural : 4 katman N×beat — (v6.0 optimum, korundu)

   Mimari bütünlük:
     FrequencyManager entegrasyonu bozulmadı (_fm.setBaseFreq / getNextFrequency).
     SampleManager entegrasyonu bozulmadı (applyMSD / start / stop).
     ADIM 8 (applyRemoteState, syncStart) ve ADIM 9 (applyBiometricEffect) korundu.
   ═══════════════════════════════════════════════════════════════════════════ */
(function(){
  'use strict';

  /* ── Modül-Düzeyi Değişkenler ── */
  var _ctx=null, _master=null, _comp=null, _mainFilter=null, _masteringComp=null;
  var _satNode=null;
  var _tremoloNode=null;
  var _eqLow=null, _eqMid=null, _eqHigh=null;
  var _oscs=[], _noise=null, _noiseGain=null, _granular=null;
  var _playing=false, _startTime=0, _pauseOffset=0;
  var _loopDur=8, _curGen=null, _curBase=0, _curBeat=0;

  var _lfoOsc=null, _lfoGain=null, _lfoInvert=null;
  var _filterLfoOsc=null, _filterLfoGain=null;
  var _tremoloOsc=null,   _tremoloDepth=null;
  var _chaosTimer=null;
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

  /* ── Sahne Mikseri ── */
  var SCENE_MIX = {
    waves   : { ambient: 0.70, tones: 0.30 },
    rain    : { ambient: 0.65, tones: 0.35 },
    wind    : { ambient: 0.60, tones: 0.40 },
    fire    : { ambient: 0.60, tones: 0.40 },
    storm   : { ambient: 0.65, tones: 0.35 },
    binaural: { ambient: 0.25, tones: 0.75 },
  };

  /* ── AudioContext ── */
  function getCtx() {
    if (!_ctx) {
      var C = window.AudioContext || window.webkitAudioContext;
      _ctx = new C();
      window._ctx = _ctx;
    }
    return _ctx;
  }

  /* ══════════════════════════════════════════════════════════════════════
     MASTER BUS — v6.1
     Sinyal zinciri:
       kaynaklar → _mainFilter (Q:4.0, LFO:600–3200Hz)
                 → _masteringComp
                 → _satNode (tanh k=8, 4x — agresif sıcaklık)
                 → _tremoloNode (base:0.80, LFO ±0.20 → 0.60–1.00)
                 → _master → EQ → _comp → destination
     ══════════════════════════════════════════════════════════════════════ */
  function ensureMaster(ctx) {
    if (_master) return;

    /* ── Son Aşama Limiter ── */
    _comp = ctx.createDynamicsCompressor();
    _comp.threshold.value = -6;
    _comp.ratio.value     = 10;
    _comp.knee.value      = 8;
    _comp.attack.value    = 0.003;
    _comp.release.value   = 0.25;

    /* ── Glue Compressor ── */
    _masteringComp = ctx.createDynamicsCompressor();
    _masteringComp.threshold.value = -24;
    _masteringComp.knee.value      = 30;
    _masteringComp.ratio.value     = 12;
    _masteringComp.attack.value    = 0.003;
    _masteringComp.release.value   = 0.25;

    /* ── v6.1: Soft-Clip WaveShaper — Agresif Analog Sıcaklık & Doku ────────
     * tanh(k*x)/tanh(k) S-eğrisi — k=8:
     *   k=8: orta güçlü sinyaller bile belirgin doygunluk alır — "potansiyel doldu" hissi.
     *   k=6'ya kıyasla daha dik S-eğrisi; dijital "soğuk" ton lambalı amfinin
     *   sıcak, dolgulu karakterine dönüşür.
     *   Ses kırılmaz, çıkış her zaman [-1,+1] — ama artık "canlı" ve "ısınmış".
     * 4096 sample: pürüzsüz eğri, müzikal harmonik içerik.
     * oversample '4x': yüksek frekanslarda aliasing bastırılmış. */
    _satNode = ctx.createWaveShaper();
    (function() {
      var samples = 4096;
      var k       = 8.0;          /* v6.1: 6 → 8 — bariz analog doygunluk */
      var tanhK   = Math.tanh(k);
      var curve   = new Float32Array(samples);
      for (var i = 0; i < samples; i++) {
        var x    = (i * 2) / (samples - 1) - 1; /* [-1, +1] normalize */
        curve[i] = Math.tanh(k * x) / tanhK;    /* S-eğrisi, çıkış da [-1,+1] */
      }
      _satNode.curve = curve;
    })();
    _satNode.oversample = '4x';

    /* ── v6.1: Tremolo Düğümü — Fiziksel Nabız %20 ───────────────────────
     * base 0.80: LFO ±0.20 → gain aralığı 0.60–1.00.
     * %20 derinlik + 0.08 Hz tempo: kulak ve beden tarafından
     * "rahatlama dalgası" veya "nefes ritmi" olarak fiziksel algılanır.
     * v6.0'ın %18'inden bir adım daha ileri — bilinçaltı tetikleyici devrede. */
    _tremoloNode = ctx.createGain();
    _tremoloNode.gain.value = 0.80; /* v6.1: ±20% için taban değer */

    /* ── 3-Band EQ ── */
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

    /* ── v6.1: Ana Lowpass Filtresi — Visseral Filtre Modülasyonu ────────
     * merkez 1900 Hz + LFO ±1300 Hz → tarama aralığı 600–3200 Hz.
     * Q 4.0 (v6.0: 3.5):
     *   Rezonans tümseği daha keskin → filtre hareket ederken "açılma-kapanma" bariz.
     *   600 Hz'de koyu, kapalı; 3200 Hz'e tırmanırken vurgulu vokal formant karakteri.
     *   Ses "konuşur" ve "nefes alır" — API komutundan bağımsız, her zaman. */
    _mainFilter = ctx.createBiquadFilter();
    _mainFilter.type            = 'lowpass';
    _mainFilter.frequency.value = 1900;
    _mainFilter.Q.value         = 4.0;  /* v6.1: 3.5 → 4.0 — daha keskin vokal rezonans */

    /* ── Master Gain ── */
    _master = ctx.createGain();
    _master.gain.value = (window._prefVector ? window._prefVector.masterVolume : 0.8);

    /* ── Zincir Bağlantısı ── */
    _mainFilter.connect(_masteringComp);
    _masteringComp.connect(_satNode);
    _satNode.connect(_tremoloNode);
    _tremoloNode.connect(_master);
    _master.connect(_eqLow);
    _eqLow.connect(_eqMid);
    _eqMid.connect(_eqHigh);
    _eqHigh.connect(_comp);
    _comp.connect(ctx.destination);

    /* Dış erişim için global referanslar */
    window._master        = _master;
    window._mainFilter    = _mainFilter;
    window._masteringComp = _masteringComp;
    window._satNode       = _satNode;
    window._tremoloNode   = _tremoloNode;
    window._eqLow         = _eqLow;
    window._eqMid         = _eqMid;
    window._eqHigh        = _eqHigh;
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

  /* ── Ses Buffer Üretici (Brownian Noise) ── */
  function makeBuffer(ctx, type) {
    var sr  = ctx.sampleRate || 44100;
    var len = Math.round(sr * _loopDur);
    var buf = ctx.createBuffer(2, len, sr);
    for (var ch = 0; ch < 2; ch++) {
      var d = buf.getChannelData(ch);
      var p1=0, p2=0, p3=0;
      var lastOut = 0;
      for (var i = 0; i < len; i++) {
        var v = 0;
        var white = Math.random() * 2 - 1;
        lastOut = (lastOut + 0.02 * white) / 1.02;

        if (type === 'waves') {
          p1 += (2*Math.PI*0.08)/sr; p2 += (2*Math.PI*0.19)/sr; p3 += (2*Math.PI*0.04)/sr;
          var sw = Math.sin(p3)*0.4+0.6;
          v = Math.sin(p1)*0.18*sw + Math.sin(p2)*0.09*sw + lastOut * 0.12 * sw;
        } else if (type === 'rain') {
          p1 += (2*Math.PI*0.6)/sr;
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
          v = lastOut * 0.25;
        }
        d[i] = isFinite(v) ? Math.max(-1, Math.min(1, v)) : 0;
      }
    }
    return buf;
  }

  /* ══════════════════════════════════════════════════════════════════════
     MODÜLASYON SİSTEMİ — v6.1
     ─────────────────────────────────────────────────────────────────────
     startModulation(ctx):
       1. Filter LFO (0.05 Hz, ±1300 Hz, Q:4.0) → vokal nefes hareketi
       2. Tremolo LFO (0.08 Hz, ±0.20)           → %20 fiziksel nabız
       3. Chaos Engine (3–6 sn, ±4 cent)         → organik analog drift

     API Bağımsızlığı Garantisi:
       Bu üç sistem dışarıdan komut gelmese de sesi sürekli modüle eder.
       Ses asla "donuk kayıt" gibi durmaz — canlı organizma gibi esneyip nefes alır.

     stopModulation():
       Üç sistemi temizle, node değerlerini varsayılana döndür.
     ══════════════════════════════════════════════════════════════════════ */
  function startModulation(ctx) {
    stopModulation();

    /* ── 1. Filter LFO — "Visseral Nefes Alma / Açılma-Kapanma Efekti" ──────
     * 0.05 Hz → ~20 sn tam döngü: yavaş, adaptasyon engellenir.
     * ±1300 Hz: 600 Hz (koyu, kapalı) ↔ 3200 Hz (parlak, açık).
     * Q 4.0 ile: her geçişte rezonans tepesi bariz vokal/uğultu karakteri üretir.
     * Kulak bu hareketi "sesin konuşması" veya "nefes alması" olarak algılar.
     * API komutundan bağımsız çalışır — ses motoru kendi kendine "yaşar". */
    _filterLfoOsc = ctx.createOscillator();
    _filterLfoOsc.type = 'sine';
    _filterLfoOsc.frequency.value = 0.05;

    _filterLfoGain = ctx.createGain();
    _filterLfoGain.gain.value = 1300; /* ±1300 Hz sapma → 600–3200 Hz tarama */

    _filterLfoOsc.connect(_filterLfoGain);
    _filterLfoGain.connect(_mainFilter.frequency); /* AudioParam: mevcut değere eklenir */
    _filterLfoOsc.start();

    /* ── 2. Tremolo LFO — "Fiziksel Nabız %20" ───────────────────────────
     * 0.08 Hz → ~12.5 sn döngü.
     * v6.1: depth 0.20 (±20%) → gain 0.60–1.00 (base 0.80).
     * %20 derinlik: yavaş tempo ile birlikte kulak ve beden tarafından
     * "rahatlama dalgası" veya "nefes ritmi" olarak fiziksel algılanır.
     * Psikoakustik hedefleme: yavaş AM → dinleyiciyi senkronize eder. */
    _tremoloOsc = ctx.createOscillator();
    _tremoloOsc.type = 'sine';
    _tremoloOsc.frequency.value = 0.08;

    _tremoloDepth = ctx.createGain();
    _tremoloDepth.gain.value = 0.20; /* v6.1: %20 fiziksel nabız derinliği */

    _tremoloOsc.connect(_tremoloDepth);
    _tremoloDepth.connect(_tremoloNode.gain); /* AudioParam: 0.80 ± 0.20 = [0.60–1.00] */
    _tremoloOsc.start();

    /* ── 3. Chaos Engine — "Analog Synthesizer Drift" ─────────────────────
     * Gerçek analog sentezleyiciler voltaj dalgalanması + ısıl kararsızlık
     * nedeniyle sürekli hafif detune olur. Bu "canlılık" hissinin ana kaynağı.
     *   ±4 cent: fark edilir ama armoniyi bozmaz
     *   3–6 sn: beyin "statik kayıt" olarak kodlamaz, sürekli "yeni veri" alır
     *   1.5 sn glide: anında sıçrama yok — organik, analog kayma davranışı */
    function scheduleNextChaos() {
      var delay = 3000 + Math.random() * 3000; /* 3–6 sn arası rastgele */
      _chaosTimer = setTimeout(function() {
        if (!_playing || !_oscs.length) return;
        try {
          var idx   = Math.floor(Math.random() * _oscs.length);
          var osc   = _oscs[idx];
          if (osc && osc.detune) {
            var cur   = osc.detune.value;
            var drift = (Math.random() - 0.5) * 8.0; /* [-4, +4] cent */
            var next  = Math.max(-8, Math.min(8, cur + drift));
            osc.detune.setValueAtTime(cur, ctx.currentTime);
            osc.detune.linearRampToValueAtTime(next, ctx.currentTime + 1.5);
          }
        } catch(e) { /* Osilatör durmuş olabilir — sessizce geç */ }
        scheduleNextChaos();
      }, delay);
    }
    scheduleNextChaos();
  }

  function stopModulation() {
    if (_filterLfoOsc)  { try{_filterLfoOsc.stop();_filterLfoOsc.disconnect();}catch(e){} _filterLfoOsc=null; }
    if (_filterLfoGain) { try{_filterLfoGain.disconnect();}catch(e){} _filterLfoGain=null; }
    if (_tremoloOsc)    { try{_tremoloOsc.stop();_tremoloOsc.disconnect();}catch(e){} _tremoloOsc=null; }
    if (_tremoloDepth)  { try{_tremoloDepth.disconnect();}catch(e){} _tremoloDepth=null; }
    if (_chaosTimer)    { clearTimeout(_chaosTimer); _chaosTimer=null; }
    if (_mainFilter) {
      try { _mainFilter.frequency.cancelScheduledValues(0); } catch(e){}
      try { _mainFilter.frequency.value = 1900; } catch(e){}
    }
    if (_tremoloNode) {
      try { _tremoloNode.gain.cancelScheduledValues(0); } catch(e){}
      try { _tremoloNode.gain.value = 0.80; } catch(e){} /* v6.1: ±20% taban */
    }
  }

  /* ── Temizleyiciler ── */
  function stopLFO() {
    if (_lfoOsc)    { try { _lfoOsc.stop();         } catch(e){} _lfoOsc    = null; }
    if (_lfoGain)   { try { _lfoGain.disconnect();   } catch(e){} _lfoGain   = null; }
    if (_lfoInvert) { try { _lfoInvert.disconnect(); } catch(e){} _lfoInvert = null; }
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

  /* ══════════════════════════════════════════════════════════════════════
     SES BAŞLAT — startSound(gen, base, beat, offset)
     ══════════════════════════════════════════════════════════════════════ */
  function startSound(gen, base, beat, offset) {
    var ctx = getCtx();
    if (ctx.state === 'suspended') ctx.resume();
    ensureMaster(ctx);

    if (_master) {
      var _cancelNow = ctx.currentTime;
      _master.gain.cancelScheduledValues(_cancelNow);
      _master.gain.setValueAtTime(
        window._prefVector ? window._prefVector.masterVolume : 0.8,
        _cancelNow
      );
    }

    stopOscs();
    stopModulation();

    /* ── Sahne Mikseri ── */
    var _baseVol = window._prefVector ? window._prefVector.getLayerGains().ambient * 0.85 : 0.60;
    var _mix     = SCENE_MIX[gen] || { ambient: 0.50, tones: 0.50 };
    var ambVol   = Math.max(0.05, Math.min(0.95, _baseVol * (_mix.ambient / 0.50)));
    var oscVol   = _mix.tones;

    var xfDur = 2.5;

    /* ══ Binaural Osilatörler ═══════════════════════════════════════════════
     *
     * v6.1: Agresif Binaural + Geniş Koro (Chorus) Etkisi
     * ───────────────────────────────────────────────────────────────────────
     * 1. Harmonik Binaural Diferansiyel (v6.0 optimum, korundu):
     *    Sol = N×baseFreq | Sağ = N×baseFreq + N×beat (N = 1,2,3,4)
     *    Beyin dört katmanda binaural işler → derin, geniş titreşim alanı.
     *
     * 2. v6.1: Koro Detune ±8 cent (v6.0: ±1.5–3 cent):
     *    Her osilatör [-8, +8] cent aralığından rastgele detune alır.
     *    Sol ve sağ kanal farklı değerler → gerçek stereo genişliği.
     *    ±8 cent: armoniyi bozmadan bariz "analog ensemble" koro karakteri.
     *    Soğuk, dar dijital mono tını tamamen kırılır — geniş, sıcak, hava dolu. */
    if (beat > 0) {
      var _fm = (typeof window.getFrequencyManager === 'function')
        ? window.getFrequencyManager(base)
        : null;
      if (_fm) _fm.setBaseFreq(isFinite(base) ? base : 200);

      var _leftFreq = _fm ? _fm.getNextFrequency() : (isFinite(base) ? base : 200);

      var panL = ctx.createStereoPanner();
      var panR = ctx.createStereoPanner();
      panL.pan.value = -1;
      panR.pan.value =  1;
      panL.connect(_mainFilter);
      panR.connect(_mainFilter);

      var _oscStartNow = ctx.currentTime;

      var envGainL = ctx.createGain();
      envGainL.gain.setValueAtTime(0.0001, _oscStartNow);
      envGainL.gain.exponentialRampToValueAtTime(oscVol, _oscStartNow + 2.5);

      var envGainR = ctx.createGain();
      envGainR.gain.setValueAtTime(0.0001, _oscStartNow);
      envGainR.gain.exponentialRampToValueAtTime(oscVol, _oscStartNow + 2.5);

      /* Cross-panning LFO (0.07 Hz) */
      stopLFO();
      _lfoOsc = ctx.createOscillator();
      _lfoOsc.type = 'sine';
      _lfoOsc.frequency.value = 0.07;

      _lfoGain = ctx.createGain();
      _lfoGain.gain.value = 0.08;

      _lfoInvert = ctx.createGain();
      _lfoInvert.gain.value = -1;

      var xGainL = ctx.createGain(); xGainL.gain.value = 1.0;
      var xGainR = ctx.createGain(); xGainR.gain.value = 1.0;

      _lfoOsc.connect(_lfoGain);
      _lfoGain.connect(xGainL.gain);
      _lfoGain.connect(_lfoInvert);
      _lfoInvert.connect(xGainR.gain);

      envGainL.connect(xGainL); xGainL.connect(panL);
      envGainR.connect(xGainR); xGainR.connect(panR);

      /* ── v6.1: 4 Katmanlı Harmonik Binaural + ±8 Cent Koro Detune ── */
      var _beat = isFinite(beat) ? beat : 0;
      var HARMONICS = [
        { mult: 1, type: 'sine',     gainVal: 0.10  }, /* temel: 1×beat binaural */
        { mult: 2, type: 'sine',     gainVal: 0.05  }, /* 2. harmonik: 2×beat */
        { mult: 3, type: 'triangle', gainVal: 0.03  }, /* 3. harmonik: 3×beat, yumuşak tını */
        { mult: 4, type: 'sine',     gainVal: 0.015 }, /* 4. harmonik: 4×beat, geniş alan */
      ];

      HARMONICS.forEach(function(h) {
        var freqL = Math.min(20000, _leftFreq * h.mult);
        var freqR = Math.min(20000, _leftFreq * h.mult + _beat * h.mult);

        /* v6.1: ±8 cent — geniş analog koro, soğuk dijital yapı kırıldı */
        var detuneL = (Math.random() - 0.5) * 16.0; /* [-8, +8] cent sol kanal */
        var detuneR = (Math.random() - 0.5) * 16.0; /* [-8, +8] cent sağ kanal — farklı değer */

        var oL = ctx.createOscillator(), gL = ctx.createGain();
        oL.type = h.type;
        oL.frequency.value = freqL;
        oL.detune.value = detuneL;
        gL.gain.value = h.gainVal;
        oL.connect(gL); gL.connect(envGainL);
        oL.start(); _oscs.push(oL);

        var oR = ctx.createOscillator(), gR = ctx.createGain();
        oR.type = h.type;
        oR.frequency.value = freqR;
        oR.detune.value = detuneR;
        gR.gain.value = h.gainVal;
        oR.connect(gR); gR.connect(envGainR);
        oR.start(); _oscs.push(oR);
      });

      _lfoOsc.start();
    }

    var now = ctx.currentTime;

    /* ══ Ortam Sesi (Ambient Layer) ═══════════════════════════════════════ */
    if (window.GranularEngine) {
      var grainTypeMap = {waves:'waves', rain:'rain', wind:'wind', fire:'forest', storm:'wind', binaural:'forest'};
      var grainType = grainTypeMap[gen] || 'wind';
      var _panner = ctx.createStereoPanner ? ctx.createStereoPanner() : null;
      var _panVal = {waves:0.6, rain:0.4, wind:0.7, fire:0.5, storm:0.8, binaural:0.0}[gen] || 0.3;
      if (_panner) {
        _panner.pan.value = (Math.random()>0.5?1:-1)*_panVal;
        _panner.connect(_mainFilter);
      }
      var _granDest = _panner || _mainFilter;
      _granular = new window.GranularEngine(ctx, _granDest, { volume: ambVol });
      _granular.generateBuffer(grainType);
      _granular.start();
      _startTime = now;
    } else {
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

      src.connect(filt); filt.connect(gain); gain.connect(_mainFilter);

      var off = isFinite(offset) ? (offset % _loopDur + _loopDur) % _loopDur : 0;

      gain.gain.setValueAtTime(0.0001, now);
      gain.gain.exponentialRampToValueAtTime(ambVol, now + xfDur);

      if (_noiseGain) {
        var oldG = _noiseGain;
        oldG.gain.setValueAtTime(oldG.gain.value, now);
        oldG.gain.exponentialRampToValueAtTime(0.0001, now + xfDur);
        setTimeout(function(){ try{oldG.disconnect();}catch(e){} }, (xfDur+0.1)*1000);
      }

      src.start(0, off); _startTime=now; _noise=src; _noiseGain=gain;
    }

    /* ── Modülasyon Sistemlerini Başlat ──
     * 300ms gecikme: fade-in ile örtüşen ilk anda sıçramayı önler.
     * API bağımsızlığı: bu sistemler dışarıdan komut gelmeden de sesi canlı tutar. */
    setTimeout(function() {
      if (_playing && _ctx) startModulation(_ctx);
    }, 300);

    _curGen  = gen;
    _curBase = isFinite(base) ? base : 0;
    _curBeat = isFinite(beat) ? beat : 0;

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
      if (_ctx && _startTime) _pauseOffset = (_ctx.currentTime - _startTime) % _loopDur;
      stopModulation();
      if (_ctx && _master) {
        var _stopNow = _ctx.currentTime;
        _master.gain.cancelScheduledValues(_stopNow);
        _master.gain.setValueAtTime(_master.gain.value, _stopNow);
        _master.gain.exponentialRampToValueAtTime(0.0001, _stopNow + 3.0);
        setTimeout(function() {
          stopOscs(); stopNoise();
          if (_sampleManager) { try { _sampleManager.stop(); } catch(e){} }
          if (_ctx) try{ _ctx.suspend(); }catch(e){}
          if (_master && _ctx) {
            _master.gain.setValueAtTime(
              window._prefVector ? window._prefVector.masterVolume : 0.8,
              _ctx.currentTime
            );
          }
        }, 3100);
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

  window.applyRemoteState = function(params) {
    if (!params) return;
    try {
      if (params.volume !== undefined) window.setMasterVolume && window.setMasterVolume(params.volume);
      if (params.gen && params.base) {
        window.switchSound && window.switchSound(params.gen, params.base, params.beat||0);
      }
    } catch(e) { console.warn('[applyRemoteState]', e); }
  };

  window.syncStart = function(timestamp) {
    var delay = Math.max(0, timestamp - Date.now());
    setTimeout(function() {
      if (!window._playing) window.togglePlay && window.togglePlay();
    }, delay);
    console.info('[syncStart] delay:', delay, 'ms');
  };

  var _origSwitchSound = window.switchSound;
  window.switchSound = function(gen, base, beat, label) {
    window._lastGen  = gen;
    window._lastBase = base;
    window._lastBeat = beat||0;
    if (_origSwitchSound) _origSwitchSound.apply(this, arguments);
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
    /* filterFreq biyometrik parametresi LFO merkezini kaydırır.
     * Doğrudan value atamak LFO modülasyonunu bozmaz; LFO buna ±1300 Hz ekler. */
    if (window._mainFilter && p.filterFreq !== undefined)
      window._mainFilter.frequency.linearRampToValueAtTime(
        Math.max(500, Math.min(8000, p.filterFreq)), now + ramp
      );
  } catch(e) { console.warn('[applyBiometricEffect]', e); }
};

/* ── Yedek referans: main.js wrapper'ları için güvenlik kilidi ── */
window._audioToggle      = window.togglePlay;
window._audioSwitchSound = window.switchSound;
window._audioSleepTimer  = window.setSleepTimer;
