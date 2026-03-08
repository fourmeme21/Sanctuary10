/* v6.0 — Aşama 6: Psikoakustik Güçlendirme, Doku, Analog Karakter */

/* ═══════════════════════════════════════════════════════════════════
   SANCTUARY SES MOTORU (v5.0 — Canlı Organizma)
   Sinyal Şeması:
     Kaynaklar → _mainFilter (LFO: 1200–2200 Hz @ 0.05 Hz)
       → _masteringComp → _tremoloNode (±5% @ 0.08 Hz)
       → _master → EQ → _comp → destination
   Aşama 5 değişiklikleri:
     • Filter LFO : _mainFilter.frequency 1200–2200 Hz arası 0.05 Hz'de salınır (Nefes)
     • Tremolo    : _tremoloNode ±5% @ 0.08 Hz kalp atışı dalgalanması
     • Chaos Engine: 5–10 sn'de bir osilatör detune'larına ±0.5 cent rastgele drift
     • Sahne Mikseri: gen adına göre ambient/tones oranı dinamik (waves→70/30, binaural→25/75)
   Aşama 4 mirası:
     • Gerçek binaural: Sol pan:-1 @ baseFreq | Sağ pan:+1 @ baseFreq+beatFreq
     • Harmonik detune: 1.5–3 cent koro etkisi
     • Cross-panning LFO 0.07 Hz | _masteringComp glue
   ═══════════════════════════════════════════════════════════════════ */
(function(){
  'use strict';

  /* ── Modül-Düzeyi Değişkenler ── */
  var _ctx=null, _master=null, _comp=null, _mainFilter=null, _masteringComp=null;
  var _satNode=null;    /* Aşama 6: Soft-Clip WaveShaper — sıcaklık dokusu */
  var _tremoloNode=null;
  var _eqLow=null, _eqMid=null, _eqHigh=null;
  var _oscs=[], _noise=null, _noiseGain=null, _granular=null;
  var _playing=false, _startTime=0, _pauseOffset=0;
  var _loopDur=8, _curGen=null, _curBase=0, _curBeat=0;

  /* Aşama 4 — LFO | Aşama 5: filter + tremolo + chaos eklendi */
  var _lfoOsc=null, _lfoGain=null, _lfoInvert=null;
  var _filterLfoOsc=null, _filterLfoGain=null; /* Aşama 5: nefes alan filtre */
  var _tremoloOsc=null,   _tremoloDepth=null;  /* Aşama 5: kalp atışı tremolo */
  var _chaosTimer=null;                         /* Aşama 5: chaos engine handle */
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

  /* ── Aşama 5: Sahne Mikseri — ambient/tones dengesi ──
   * Her sahne için {ambient, tones} oranları — toplam ~1.0.
   * Waves/rain/wind gibi doğa sahnelerinde ambiyans öne çıkar;
   * binaural sahnelerinde tonlar öne çıkar. */
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

  /* ── Master Bus ──
   * Aşama 5 — Sinyal Zinciri:
   *   Kaynaklar → _mainFilter → _masteringComp → _tremoloNode → _master → EQ → _comp → destination
   *   _tremoloNode: GainNode (base: 0.925). Tremolo LFO ±0.05 modüle eder → 0.875–0.975 arası.
   *   Tremolo LFO başlatma/durdurma startModulation/stopModulation ile yönetilir.
   * ────────────────────────────────────────────────────────────── */
  function ensureMaster(ctx) {
    if (_master) return;

    /* Son aşama limiter */
    _comp = ctx.createDynamicsCompressor();
    _comp.threshold.value = -6;
    _comp.ratio.value     = 10;
    _comp.knee.value      = 8;
    _comp.attack.value    = 0.003;
    _comp.release.value   = 0.25;

    /* Glue compressor */
    _masteringComp = ctx.createDynamicsCompressor();
    _masteringComp.threshold.value = -24;
    _masteringComp.knee.value      = 30;
    _masteringComp.ratio.value     = 12;
    _masteringComp.attack.value    = 0.003;
    _masteringComp.release.value   = 0.25;

    /* Aşama 6: Soft-Clip WaveShaper — analog sıcaklık/doku
     * tanh S-eğrisi: düşük genlikler temiz, yüksek genlikler yumuşak kırpılır.
     * oversample 4x: aliasing bastırılır, daha müzikal saturasyon. */
    _satNode = ctx.createWaveShaper();
    (function() {
      var samples = 2048, k = 4.0, tanhK = Math.tanh(k);
      var curve = new Float32Array(samples);
      for (var i = 0; i < samples; i++) {
        var x = (i * 2) / (samples - 1) - 1;
        curve[i] = Math.tanh(k * x) / tanhK;
      }
      _satNode.curve = curve;
    })();
    _satNode.oversample = '4x';

    /* Tremolo düğümü (Aşama 6: base 0.85, LFO ±0.15 → 0.70–1.00 fiziksel nabız) */
    _tremoloNode = ctx.createGain();
    _tremoloNode.gain.value = 0.85; /* Aşama 6: ±15% için geniş bant */

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

    /* Ana Lowpass Filtresi (kaynaklar buraya bağlanır)
     * Aşama 5: başlangıç 1700 Hz → LFO onu 1200–2200 Hz arasında tarar */
    _mainFilter = ctx.createBiquadFilter();
    _mainFilter.type            = 'lowpass';
    _mainFilter.frequency.value = 1900;  /* Aşama 6: merkez yükseltildi (LFO ±1300) */
    _mainFilter.Q.value         = 3.5;   /* Aşama 6: vokal rezonans */

    /* Master gain */
    _master = ctx.createGain();
    _master.gain.value = (window._prefVector ? window._prefVector.masterVolume : 0.8);

    /* ═══ Zincir bağlantısı (Aşama 5) ═══
     * kaynaklar → _mainFilter → _masteringComp → _tremoloNode → _master → EQ → _comp → destination */
    _mainFilter.connect(_masteringComp);
    _masteringComp.connect(_satNode);
    _satNode.connect(_tremoloNode);
    _tremoloNode.connect(_master);
    _master.connect(_eqLow);
    _eqLow.connect(_eqMid);
    _eqMid.connect(_eqHigh);
    _eqHigh.connect(_comp);
    _comp.connect(ctx.destination);

    /* Dış erişim için yayınla */
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

  /* ── Aşama 5: Modülasyon Sistemi ──────────────────────────────────────
   *
   * startModulation(ctx):
   *   1. Filter LFO (0.05 Hz, ±500 Hz) → _mainFilter.frequency nefes alır
   *   2. Tremolo LFO (0.08 Hz, ±0.05)  → _tremoloNode.gain ±5% salınır
   *   3. Chaos Engine                   → 5–10 sn'de bir rastgele osilatöre ±0.5 cent drift
   *
   * stopModulation():
   *   Üç sistemi de temizle, node değerlerini varsayılana döndür.
   * ──────────────────────────────────────────────────────────────────── */
  function startModulation(ctx) {
    stopModulation();

    /* 1. Filter LFO — "nefes alan ses perdesi"
     * 0.05 Hz → ~20 saniye tam döngü. Bilinçaltı seviyede algılanır.
     * ±500 Hz sapma: alt 1200 Hz (koyu) ↔ üst 2200 Hz (parlak).
     * Ses sürekli açılıp kapanıyor — deniz nefesi gibi. */
    _filterLfoOsc = ctx.createOscillator();
    _filterLfoOsc.type = 'sine';
    _filterLfoOsc.frequency.value = 0.05; /* 20 sn döngü */

    _filterLfoGain = ctx.createGain();
    _filterLfoGain.gain.value = 1300; /* Aşama 6: ±1300 Hz (600–3200 Hz arası) */

    _filterLfoOsc.connect(_filterLfoGain);
    _filterLfoGain.connect(_mainFilter.frequency); /* AudioParam'a bağlantı: ekler */
    _filterLfoOsc.start();

    /* 2. Tremolo LFO — "kalp atışı dalgalanması"
     * 0.08 Hz → ~12.5 sn döngü.
     * ±0.05 → _tremoloNode.gain (0.925) etrafında 0.875–0.975 arasında salınır.
     * Volümdeki bu hafif nefes ritmi "canlı ama sessiz" bir his yaratır. */
    _tremoloOsc = ctx.createOscillator();
    _tremoloOsc.type = 'sine';
    _tremoloOsc.frequency.value = 0.08;

    _tremoloDepth = ctx.createGain();
    _tremoloDepth.gain.value = 0.15; /* Aşama 6: ±15% fiziksel nabız */

    _tremoloOsc.connect(_tremoloDepth);
    _tremoloDepth.connect(_tremoloNode.gain); /* AudioParam: 0.925 ± 0.05 */
    _tremoloOsc.start();

    /* 3. Chaos Engine — "analog synthesizer drift"
     * Analog sentezleyiciler sıcaklık değişimi ve voltaj dalgalanması
     * nedeniyle sürekli hafif detune olur. Bu, onları "sıcak" yapar.
     * Burada setTimeout zinciri bu doğallığı simüle eder.
     * 5–10 sn arası: fark edilemez ama beyin "yeni veri" olarak kodlar. */
    function scheduleNextChaos() {
      var delay = 3000 + Math.random() * 3000; /* Aşama 6: 3–6 sn */
      _chaosTimer = setTimeout(function() {
        if (!_playing || !_oscs.length) return;
        try {
          var idx = Math.floor(Math.random() * _oscs.length);
          var osc = _oscs[idx];
          if (osc && osc.detune) {
            var cur = osc.detune.value;
            var drift = (Math.random() - 0.5) * 8.0; /* Aşama 6: [-4, +4] cent */
            var next  = Math.max(-6, Math.min(6, cur + drift));
            /* Yumuşak glide: anında sıçrama değil, 2 sn'de erir */
            osc.detune.setValueAtTime(cur, ctx.currentTime);
            osc.detune.linearRampToValueAtTime(next, ctx.currentTime + 1.5); /* Aşama 6 */
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
    /* Kalıcı düğümleri varsayılan değerlerine döndür */
    if (_mainFilter) {
      try { _mainFilter.frequency.cancelScheduledValues(0); } catch(e){}
      try { _mainFilter.frequency.value = 1900; } catch(e){} /* Aşama 6 */
    }
    if (_tremoloNode) {
      try { _tremoloNode.gain.cancelScheduledValues(0); } catch(e){}
      try { _tremoloNode.gain.value = 0.85; /* Aşama 6: ±15% için geniş bant */ } catch(e){}
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

  /* ── Ses Başlat ──
   *
   * Aşama 5 değişiklikleri:
   *   1. Sahne Mikseri: gen'e göre ambVol ve oscVol SCENE_MIX'ten alınır
   *   2. startModulation(ctx) çağrısı → filter LFO + tremolo + chaos devreye girer
   * ─────────────────────────────────────────────────────────────── */
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

    /* ── Aşama 5: Sahne Mikseri ──
     * prefVector'dan gelen temel hacim değerini SCENE_MIX oranlarıyla çarp.
     * Normalize etmek için 0.50 baz (SCENE_MIX'in "nötr" noktası) kullanılır. */
    var _baseVol = window._prefVector ? window._prefVector.getLayerGains().ambient * 0.85 : 0.60;
    var _mix     = SCENE_MIX[gen] || { ambient: 0.50, tones: 0.50 };
    var ambVol   = Math.max(0.05, Math.min(0.95, _baseVol * (_mix.ambient / 0.50)));
    var oscVol   = _mix.tones; /* tones oranı envGain hedef değeri olarak */

    var xfDur = 2.5;

    /* ═══ Binaural Osilatörler (Aşama 4 mirası + Aşama 5 mikser) ═══ */
    if (beat > 0) {
      var _fm = (typeof window.getFrequencyManager === 'function')
        ? window.getFrequencyManager(base)
        : null;
      if (_fm) _fm.setBaseFreq(isFinite(base) ? base : 200);

      var _leftFreq  = _fm ? _fm.getNextFrequency() : (isFinite(base) ? base : 200);
      /* _rightFreq removed in v6.0: N×beat differential computed per harmonic */

      var panL = ctx.createStereoPanner();
      var panR = ctx.createStereoPanner();
      panL.pan.value = -1;
      panR.pan.value =  1;
      panL.connect(_mainFilter);
      panR.connect(_mainFilter);

      var _oscStartNow = ctx.currentTime;

      /* Zarf: fade-in 2.5sn | Aşama 5: oscVol sahne oranından */
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

      /* ── Aşama 6: Harmonik Binaural Diferansiyel ──────────────────
       * Her N. harmonik: Sol = N×baseFreq | Sağ = N×baseFreq + N×beat
       * Binaural etki: temel 1× → harmonikler 2×, 3×, 4× katlı etki.
       * Beyin dört frekanslı binaural sinyali çok daha derin işler. */
      var _beat = isFinite(beat) ? beat : 0;
      var HARMONICS = [
        { mult: 1, type: 'sine',     gainVal: 0.10 },
        { mult: 2, type: 'sine',     gainVal: 0.04 },
        { mult: 3, type: 'triangle', gainVal: 0.02 },
        { mult: 4, type: 'sine',     gainVal: 0.01 },
      ];
      HARMONICS.forEach(function(h) {
        var freqL = Math.min(20000, _leftFreq * h.mult);
        var freqR = Math.min(20000, _leftFreq * h.mult + _beat * h.mult);
        var oL = ctx.createOscillator(), gL = ctx.createGain();
        oL.type = h.type; oL.frequency.value = freqL;
        oL.detune.value = 1.5 + Math.random() * 1.5;
        gL.gain.value = h.gainVal;
        oL.connect(gL); gL.connect(envGainL);
        oL.start(); _oscs.push(oL);
        var oR = ctx.createOscillator(), gR = ctx.createGain();
        oR.type = h.type; oR.frequency.value = freqR;
        oR.detune.value = 1.5 + Math.random() * 1.5;
        gR.gain.value = h.gainVal;
        oR.connect(gR); gR.connect(envGainR);
        oR.start(); _oscs.push(oR);
      });

      _lfoOsc.start();
    }

    var now = ctx.currentTime;

    /* ═══ Ortam Sesi (Ambient Layer) — Aşama 5: ambVol sahne mikserinden ═══ */
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

    /* ── Aşama 5: Modülasyon sistemlerini başlat ──
     * 300ms gecikme: fade-in ile örtüşen ilk anda algılanabilir sıçramayı önler. */
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
      stopModulation(); /* Aşama 5: modülasyon sistemlerini hemen durdur */
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
    /* Aşama 5 uyumu: filterFreq biyometrik parametresi LFO merkezini kaydırır.
     * Doğrudan value atamak LFO modülasyonunu bozmaz; LFO buna ±500 Hz ekler. */
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
