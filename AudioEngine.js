/* ═══════════════════════════════════════════════════════════════════════════
   SANCTUARY SES MOTORU — v11.0 (Tam Senkronizasyon Protokolü)
   ─────────────────────────────────────────────────────────────────────────────
   v11.0 — Aşama 11 CERRAHİ YAMALAR (v9.0 tabanı korundu):
     • startSound içinde SM garantili bootstrap — ses üretiminden önce
     • Arpeggiator → _arpNoteCallback hook — SanctuarySync köprüsü
     • SampleManager.js v2.0 ve SanctuarySync.js ile tam senkronize
   Tüm v9.0 özellikleri aynen korundu.
   ─────────────────────────────────────────────────────────────────────────────
   Sinyal Zinciri:
     Kaynaklar:
       [A] Warm Sub-Pad (Osilatörler — %70 düşürülmüş gain, yumuşak FM)
       [B] Pink Noise Doğa Katmanı (anlık, SampleManager bağımsız)
       [C] SampleManager (Organik Ortam + Enstrüman Bankası)
           → Piano / Guitar / Flute prosedürel sentezi
           → Canlılık katmanı: Kuş, böcek, kurbağa (15–30sn rastgele)
       Tüm kaynaklar → _mainFilter → _masteringComp → _satNode (k=8)
         → _tremoloNode → _master → EQ → _comp → destination

   v9.0 — Aşama 9 YENİLİKLERİ:
     • Siren Etkisi Tamamen Yok      : Osilatör gain'leri %70 düşürüldü.
                                        FM derinliği yumuşatıldı: "metalik" → "sıcak".
                                        Sinüs dominansı bitişti; osilatörler artık
                                        sadece derin sub-pad arka planı sağlar.
     • Organik Öncelik               : Kullanıcının duyduğu ana karakter:
                                        Piano / Guitar / Flute (SampleManager v2.0)
                                        + Pink Noise doğa katmanı.
     • Müzikal Sahne Presetleri      : switchSound → SampleManager v2.0 applyScene()
                                        Her sahne için otomatik enstrüman kombinasyonu.
                                        Zen Garden: Flüt + Kuşlar
                                        Deep Space: Piyano (geniş reverb)
                                        Earth Grounding: Gitar + Rüzgar + Orman
     • Canlılık Katmanı              : SampleManager v2.0'ın _scheduleLifeEvent()
                                        sistemi üzerinden çalışır. AudioEngine
                                        müdahale etmez — SampleManager yönetir.
     • Gelişmiş 3D Sahneleme         : Pink Noise + Bowl Auto-Pan korundu.
                                        SampleManager HRTF PannerNode ile kuşların
                                        3D hareketi sağlanıyor.
     • Tüm v8.0 özellikleri korundu  : Auto-Pan, Pink Noise, Arpeggiator (4–6sn),
                                        filter zarf, tremolo, chaos engine.
   ═══════════════════════════════════════════════════════════════════════════ */
(function(){
  'use strict';

  /* ── Modül-Düzeyi Değişkenler ── */
  var _ctx=null, _master=null, _comp=null, _mainFilter=null, _masteringComp=null;
  var _satNode=null, _tremoloNode=null;
  var _eqLow=null, _eqMid=null, _eqHigh=null;
  var _oscs=[], _fmOscs=[], _harmLfos=[];
  var _noise=null, _noiseGain=null, _granular=null;
  var _playing=false, _startTime=0, _pauseOffset=0;
  var _loopDur=8, _curGen=null, _curBase=0, _curBeat=0;

  var _lfoOsc=null, _lfoGain=null, _lfoInvert=null;
  var _filterLfoOsc=null, _filterLfoGain=null;
  var _tremoloOsc=null, _tremoloDepth=null;
  var _chaosTimer=null;
  var _arpTimer=null;
  var _sampleManager=null;

  /* v8.0: Anlık doğa sesi katmanı */
  var _directWindSrc=null, _directWindGain=null, _directWindPan=null;
  var _directWaveSrc=null, _directWaveGain=null, _directWavePan=null;
  var _directWindPanOsc=null, _directWavePanOsc=null;

  /* Bowl Auto-Pan */
  var _bowlPanOscL=null, _bowlPanOscR=null;

  /* Sabitler */
  var GOLDEN = 1.618034;
  var ARP_RATIOS = [1/1, 9/8, 5/4, 4/3, 3/2, 5/3, 15/8, 2/1];

  /* ═══════════════════════════════════════════════════════════════
     AŞAMA 9: GEN → SAHNE HARİTASI (Genişletildi)
     Yeni müzikal presetler: Zen Garden, Deep Space, Earth Grounding
  ═══════════════════════════════════════════════════════════════ */
  var GEN_TO_SCENE = {
    waves       : 'Calm Breath',
    rain        : 'Deep Peace',
    wind        : 'Light Breath',
    fire        : 'Energy Renewal',
    storm       : 'Focus Flow',
    binaural    : 'Heart Resonance',
    zen         : 'Zen Garden',
    space       : 'Deep Space',
    earth       : 'Earth Grounding',
    forest      : 'Night Forest',
    morning     : 'Morning Mist',
  };

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
    waves   : { ambient: 0.55, tones: 0.45 },
    rain    : { ambient: 0.50, tones: 0.50 },
    wind    : { ambient: 0.50, tones: 0.50 },
    fire    : { ambient: 0.50, tones: 0.50 },
    storm   : { ambient: 0.55, tones: 0.45 },
    binaural: { ambient: 0.25, tones: 0.75 },
    zen     : { ambient: 0.60, tones: 0.40 },
    space   : { ambient: 0.40, tones: 0.60 },
    earth   : { ambient: 0.65, tones: 0.35 },
    forest  : { ambient: 0.65, tones: 0.35 },
    morning : { ambient: 0.60, tones: 0.40 },
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
     MASTER BUS — v9.0 (v8.0'dan korundu)
     ══════════════════════════════════════════════════════════════════════ */
  function ensureMaster(ctx) {
    if (_master) return;

    _comp = ctx.createDynamicsCompressor();
    _comp.threshold.value = -6;
    _comp.ratio.value     = 10;
    _comp.knee.value      = 8;
    _comp.attack.value    = 0.003;
    _comp.release.value   = 0.25;

    _masteringComp = ctx.createDynamicsCompressor();
    _masteringComp.threshold.value = -24;
    _masteringComp.knee.value      = 30;
    _masteringComp.ratio.value     = 12;
    _masteringComp.attack.value    = 0.003;
    _masteringComp.release.value   = 0.25;

    /* Soft-Clip k=8 */
    _satNode = ctx.createWaveShaper();
    (function() {
      var samples = 4096, k = 8.0, tanhK = Math.tanh(k);
      var curve = new Float32Array(samples);
      for (var i = 0; i < samples; i++) {
        var x = (i * 2) / (samples - 1) - 1;
        curve[i] = Math.tanh(k * x) / tanhK;
      }
      _satNode.curve = curve;
    })();
    _satNode.oversample = '4x';

    _tremoloNode = ctx.createGain();
    _tremoloNode.gain.value = 0.80;

    /* EQ */
    _eqLow = ctx.createBiquadFilter();
    _eqLow.type = 'lowshelf';
    _eqLow.frequency.value = 200;
    _eqLow.gain.value = 2;

    _eqMid = ctx.createBiquadFilter();
    _eqMid.type = 'peaking';
    _eqMid.frequency.value = 1000;
    _eqMid.Q.value = 0.8;
    _eqMid.gain.value = -1;

    _eqHigh = ctx.createBiquadFilter();
    _eqHigh.type = 'highshelf';
    _eqHigh.frequency.value = 6000;
    _eqHigh.gain.value = 1.5;

    _mainFilter = ctx.createBiquadFilter();
    _mainFilter.type            = 'lowpass';
    _mainFilter.frequency.value = 1900;
    _mainFilter.Q.value         = 4.0;

    _master = ctx.createGain();
    _master.gain.value = (window._prefVector ? window._prefVector.masterVolume : 0.8);

    _mainFilter.connect(_masteringComp);
    _masteringComp.connect(_satNode);
    _satNode.connect(_tremoloNode);
    _tremoloNode.connect(_master);
    _master.connect(_eqLow);
    _eqLow.connect(_eqMid);
    _eqMid.connect(_eqHigh);
    _eqHigh.connect(_comp);
    _comp.connect(ctx.destination);

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

  /* ════════════════════════════════════════════════════════════════════════
     AŞAMA 9: WARM SUB-PAD SENTEZLEYICI — buildWarmPad()
     ────────────────────────────────────────────────────────────────────────
     v9.0 radikal değişiklikleri:
       • Gain %70 düşürüldü → Osilatörler artık ana ses DEĞİL, sub-pad.
       • FM derinliği dramatik biçimde yumuşatıldı:
           v8.0: freq × 0.030 (metalik, keskin)
           v9.0: freq × 0.004 (sıcak, yumuşak warmth)
         Artık "piyano altındaki derin sıcaklık" tınısı veriyor.
       • FM modülatör oranı: 0.27 → 0.50 (sub-octave pad karakteri)
       • Micro-LFO: gainVal × 0.32 → gainVal × 0.12
         Daha sessiz, neredeyse fark edilmez nefes.
       • Osilatör tipi tercihi: 'sine' baskın — 'triangle' kaldırıldı.
         Sinüs dalgası warmth için uygun, metalik değil.
     ════════════════════════════════════════════════════════════════════════ */
  function buildWarmPad(ctx, freq, detuneCents, gainVal, destGain, attackSec) {
    var now = ctx.currentTime;

    /* ── Ana Pad Osilatörü — saf sinüs, sub karakteri ── */
    var carrier = ctx.createOscillator();
    carrier.type = 'sine';
    carrier.frequency.value = freq;
    carrier.detune.value = detuneCents;

    /* ── Soft FM Modülatör — v9.0: sıcak pad warmth ──────────────────────
     * Oran: 0.50 → tam sub-octave FM → derin, sıcak bass warmth.
     * Derinlik: freq × 0.004 → sadece hafif tını rengi, metalik değil. */
    var fmMod = ctx.createOscillator();
    fmMod.type = 'sine';
    fmMod.frequency.value = freq * 0.50;  /* Sub-octave ratio */

    var fmDepth = ctx.createGain();
    /* v9.0: 0.030 → 0.004 — metalik çınlama yerine sıcak warmth */
    fmDepth.gain.value = Math.max(0.3, freq * 0.004);
    fmMod.connect(fmDepth);
    fmDepth.connect(carrier.frequency);

    /* ── Micro-LFO — v9.0: neredeyse fark edilmez, sadece doku ──────────
     * gainVal × 0.12 → çok hafif nefes, kulak fark etmiyor ama canlılık var. */
    var lfoRate = 0.08 + Math.random() * 0.25; /* Daha yavaş */
    var lfo = ctx.createOscillator();
    lfo.type = 'sine';
    lfo.frequency.value = lfoRate;

    var lfoAmp = ctx.createGain();
    lfoAmp.gain.value = gainVal * 0.12;  /* v9.0: 0.32 → 0.12 */
    lfo.connect(lfoAmp);

    var shimmer = ctx.createGain();
    shimmer.gain.value = 1.0;
    lfoAmp.connect(shimmer.gain);

    /* ── ADSR Zarfı — v9.0: Uzun atak, yumuşak ── */
    var envNode = ctx.createGain();
    envNode.gain.setValueAtTime(0.0001, now);
    envNode.gain.exponentialRampToValueAtTime(gainVal, now + attackSec);
    envNode.connect(destGain);

    carrier.connect(shimmer);
    shimmer.connect(envNode);

    carrier.start(now);
    fmMod.start(now);
    lfo.start(now);

    return { carrier: carrier, fmMod: fmMod, lfo: lfo };
  }

  /* ════════════════════════════════════════════════════════════════════════
     PINK NOISE BUFFER (v8.0'dan korundu)
     ════════════════════════════════════════════════════════════════════════ */
  function makePinkNoiseBuffer(ctx, gen) {
    var sr  = ctx.sampleRate || 44100;
    var dur = 12;
    var len = Math.round(sr * dur);
    var buf = ctx.createBuffer(2, len, sr);

    for (var ch = 0; ch < 2; ch++) {
      var d = buf.getChannelData(ch);
      var b0=0,b1=0,b2=0,b3=0,b4=0,b5=0,b6=0;
      var p1=0, p2=0, p3=0;

      for (var i = 0; i < len; i++) {
        var white = Math.random() * 2 - 1;
        b0=0.99886*b0+white*0.0555179; b1=0.99332*b1+white*0.0750759;
        b2=0.96900*b2+white*0.1538520; b3=0.86650*b3+white*0.3104856;
        b4=0.55000*b4+white*0.5329522; b5=-0.7616*b5-white*0.0168980;
        var pink=(b0+b1+b2+b3+b4+b5+b6+white*0.5362)*0.11; b6=white*0.115926;

        var v = 0;
        if (gen==='wind'||gen==='binaural'||gen==='zen'||gen==='earth'||gen==='forest') {
          p1+=(2*Math.PI*0.09)/sr; p2+=(2*Math.PI*0.04)/sr;
          var windEnv=Math.max(0,0.5+Math.sin(p2)*0.38+Math.sin(p1*0.4)*0.12);
          v=pink*0.60*windEnv;
        } else if (gen==='waves'||gen==='morning') {
          p1+=(2*Math.PI*0.07)/sr; p2+=(2*Math.PI*0.15)/sr; p3+=(2*Math.PI*0.032)/sr;
          var swell=0.55+Math.sin(p3)*0.45;
          v=pink*0.45*swell+Math.sin(p1)*0.12*swell+Math.sin(p2)*0.06*swell;
        } else if (gen==='rain') {
          p1+=(2*Math.PI*0.35)/sr;
          v=pink*0.40*(0.7+Math.sin(p1)*0.3);
          if(Math.random()<0.0006) v+=(Math.random()*2-1)*0.22;
        } else if (gen==='fire') {
          p1+=(2*Math.PI*2.2)/sr; p2+=(2*Math.PI*0.06)/sr;
          v=pink*0.50*(0.6+Math.sin(p2)*0.4)+Math.sin(p1)*0.03;
          if(Math.random()<0.007) v+=(Math.random()*2-1)*0.40;
        } else if (gen==='storm') {
          p1+=(2*Math.PI*0.22)/sr; p2+=(2*Math.PI*0.04)/sr;
          v=pink*0.75*(0.6+Math.sin(p1)*0.4)+Math.sin(p2)*0.025;
        } else if (gen==='space') {
          /* Uzay: çok sessiz, derin */
          v=pink*0.15;
        } else {
          v=pink*0.30;
        }
        d[i]=isFinite(v)?Math.max(-1,Math.min(1,v)):0;
      }
    }
    return buf;
  }

  /* ════════════════════════════════════════════════════════════════════════
     AUTO-PAN (v8.0'dan korundu)
     ════════════════════════════════════════════════════════════════════════ */
  function createAutoPan(ctx, pannerNode, lfoHz, depth, phaseOffset) {
    var lfo = ctx.createOscillator();
    lfo.type = 'sine';
    lfo.frequency.value = lfoHz;
    var lfoDepth = ctx.createGain();
    lfoDepth.gain.value = depth;
    lfo.connect(lfoDepth);
    lfoDepth.connect(pannerNode.pan);
    lfo.start(ctx.currentTime + (phaseOffset || 0));
    return lfo;
  }

  /* ════════════════════════════════════════════════════════════════════════
     DOĞRUDAN DOĞA SESİ (v8.0'dan korundu)
     ════════════════════════════════════════════════════════════════════════ */
  function startDirectNature(ctx, gen, ambVol) {
    stopDirectNature();
    var now = ctx.currentTime;

    var windBuf = makePinkNoiseBuffer(ctx, gen);
    _directWindSrc = ctx.createBufferSource();
    _directWindSrc.buffer = windBuf;
    _directWindSrc.loop = true;
    _directWindSrc.loopStart = 0;
    _directWindSrc.loopEnd = windBuf.duration;

    var windFilt = ctx.createBiquadFilter();
    windFilt.type = 'bandpass';
    windFilt.frequency.value = {
      waves:600, rain:2200, wind:1100, fire:1400, storm:800, binaural:700,
      zen:900, space:300, earth:700, forest:800, morning:1000
    }[gen] || 900;
    windFilt.Q.value = 0.6;

    _directWindPan = ctx.createStereoPanner();
    _directWindPan.pan.value = 0;
    _directWindPanOsc = createAutoPan(ctx, _directWindPan, 0.007, 0.55, 0);

    _directWindGain = ctx.createGain();
    _directWindGain.gain.setValueAtTime(0.0001, now);
    _directWindGain.gain.exponentialRampToValueAtTime(ambVol * 0.75, now + 2.0);

    _directWindSrc.connect(windFilt);
    windFilt.connect(_directWindGain);
    _directWindGain.connect(_directWindPan);
    _directWindPan.connect(_mainFilter);
    _directWindSrc.start(0);

    if (gen==='waves'||gen==='binaural'||gen==='rain'||gen==='morning') {
      var secGen = (gen==='rain') ? 'wind' : 'waves';
      var waveBuf = makePinkNoiseBuffer(ctx, secGen);
      _directWaveSrc = ctx.createBufferSource();
      _directWaveSrc.buffer = waveBuf;
      _directWaveSrc.loop = true;
      _directWaveSrc.loopStart = 0;
      _directWaveSrc.loopEnd = waveBuf.duration;

      var waveFilt = ctx.createBiquadFilter();
      waveFilt.type = 'lowpass';
      waveFilt.frequency.value = 500;
      waveFilt.Q.value = 0.5;

      _directWavePan = ctx.createStereoPanner();
      _directWavePan.pan.value = 0;
      _directWavePanOsc = createAutoPan(ctx, _directWavePan, 0.005, 0.40, 71);

      _directWaveGain = ctx.createGain();
      _directWaveGain.gain.setValueAtTime(0.0001, now);
      _directWaveGain.gain.exponentialRampToValueAtTime(ambVol * 0.45, now + 3.5);

      _directWaveSrc.connect(waveFilt);
      waveFilt.connect(_directWaveGain);
      _directWaveGain.connect(_directWavePan);
      _directWavePan.connect(_mainFilter);
      _directWaveSrc.start(0);
    }
  }

  function stopDirectNature() {
    if (_directWindPanOsc)  { try{_directWindPanOsc.stop();_directWindPanOsc.disconnect();}catch(e){} _directWindPanOsc=null; }
    if (_directWindGain)    { try{_directWindGain.disconnect();}catch(e){} _directWindGain=null; }
    if (_directWindPan)     { try{_directWindPan.disconnect();}catch(e){} _directWindPan=null; }
    if (_directWindSrc)     { try{_directWindSrc.stop();_directWindSrc.disconnect();}catch(e){} _directWindSrc=null; }
    if (_directWavePanOsc)  { try{_directWavePanOsc.stop();_directWavePanOsc.disconnect();}catch(e){} _directWavePanOsc=null; }
    if (_directWaveGain)    { try{_directWaveGain.disconnect();}catch(e){} _directWaveGain=null; }
    if (_directWavePan)     { try{_directWavePan.disconnect();}catch(e){} _directWavePan=null; }
    if (_directWaveSrc)     { try{_directWaveSrc.stop();_directWaveSrc.disconnect();}catch(e){} _directWaveSrc=null; }
  }

  /* ════════════════════════════════════════════════════════════════════════
     MODÜLASYON (v8.0'dan korundu)
     ════════════════════════════════════════════════════════════════════════ */
  function startModulation(ctx) {
    stopModulation();
    var now = ctx.currentTime;

    _filterLfoOsc = ctx.createOscillator();
    _filterLfoOsc.type = 'sine';
    _filterLfoOsc.frequency.value = 0.05;

    _filterLfoGain = ctx.createGain();
    _filterLfoGain.gain.setValueAtTime(30, now);
    _filterLfoGain.gain.linearRampToValueAtTime(1300, now + 5.5);

    _filterLfoOsc.connect(_filterLfoGain);
    _filterLfoGain.connect(_mainFilter.frequency);
    _filterLfoOsc.start();

    _tremoloOsc = ctx.createOscillator();
    _tremoloOsc.type = 'sine';
    _tremoloOsc.frequency.value = 0.08;

    _tremoloDepth = ctx.createGain();
    _tremoloDepth.gain.value = 0.20;

    _tremoloOsc.connect(_tremoloDepth);
    _tremoloDepth.connect(_tremoloNode.gain);
    _tremoloOsc.start();

    function scheduleNextChaos() {
      var delay = 3000 + Math.random() * 3000;
      _chaosTimer = setTimeout(function() {
        if (!_playing || !_oscs.length) return;
        try {
          var idx = Math.floor(Math.random() * _oscs.length);
          var osc = _oscs[idx];
          if (osc && osc.detune) {
            var cur  = osc.detune.value;
            var drift= (Math.random() - 0.5) * 8.0;
            var next = Math.max(-8, Math.min(8, cur + drift));
            osc.detune.setValueAtTime(cur, ctx.currentTime);
            osc.detune.linearRampToValueAtTime(next, ctx.currentTime + 1.5);
          }
        } catch(e) {}
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
    stopArpeggiator();
    if (_mainFilter) {
      try { _mainFilter.frequency.cancelScheduledValues(0); } catch(e){}
      try { _mainFilter.frequency.value = 1900; } catch(e){}
    }
    if (_tremoloNode) {
      try { _tremoloNode.gain.cancelScheduledValues(0); } catch(e){}
      try { _tremoloNode.gain.value = 0.80; } catch(e){}
    }
  }

  /* ════════════════════════════════════════════════════════════════════════
     GOLDEN RATIO ARPEGGİATOR — v9.0 (v8.0'dan korundu: 4–6 sn, 1.5–2.5 sn glide)
     ════════════════════════════════════════════════════════════════════════ */
  function startArpeggiator(ctx) {
    stopArpeggiator();
    if (!_curBase || !_oscs.length) return;

    var phiAccum = 0;

    function scheduleNextArp() {
      var delay = 4000 + Math.random() * 2000;
      _arpTimer = setTimeout(function() {
        if (!_playing || !_oscs.length) { scheduleNextArp(); return; }

        phiAccum = (phiAccum + GOLDEN) % ARP_RATIOS.length;
        var stepIdx = Math.floor(phiAccum) % ARP_RATIOS.length;
        var ratio   = ARP_RATIOS[stepIdx];

        var phiFrac   = phiAccum - Math.floor(phiAccum);
        var microDrift = 1.0 + (phiFrac - 0.5) * 0.036;
        var targetBase = _curBase * ratio * microDrift;
        targetBase = Math.max(20, Math.min(1200, targetBase));

        var ratioChange = targetBase / _curBase;
        var glide = 1.5 + Math.random() * 1.0;
        var now   = ctx.currentTime;

        _oscs.forEach(function(osc) {
          if (!osc || !osc.frequency) return;
          var cur    = osc.frequency.value;
          var newFreq= Math.min(20000, Math.max(20, cur * ratioChange));
          osc.frequency.setValueAtTime(cur, now);
          osc.frequency.linearRampToValueAtTime(newFreq, now + glide);
        });

        /* Aşama 11: SanctuarySync köprüsüne nota değişimini bildir */
        if (typeof window._arpNoteCallback === 'function') {
          try { window._arpNoteCallback(targetBase, ratio); } catch(e) {}
        }

        scheduleNextArp();
      }, delay);
    }
    scheduleNextArp();
  }

  function stopArpeggiator() {
    if (_arpTimer) { clearTimeout(_arpTimer); _arpTimer = null; }
  }

  /* ── Temizleyiciler ── */
  function stopLFO() {
    if (_lfoOsc)    { try{_lfoOsc.stop();}catch(e){} _lfoOsc=null; }
    if (_lfoGain)   { try{_lfoGain.disconnect();}catch(e){} _lfoGain=null; }
    if (_lfoInvert) { try{_lfoInvert.disconnect();}catch(e){} _lfoInvert=null; }
  }

  function stopBowlPans() {
    if (_bowlPanOscL) { try{_bowlPanOscL.stop();_bowlPanOscL.disconnect();}catch(e){} _bowlPanOscL=null; }
    if (_bowlPanOscR) { try{_bowlPanOscR.stop();_bowlPanOscR.disconnect();}catch(e){} _bowlPanOscR=null; }
  }

  function stopOscs() {
    _oscs.forEach(function(o){ try{o.stop();o.disconnect();}catch(e){} });
    _oscs = [];
    _fmOscs.forEach(function(o){ try{o.stop();o.disconnect();}catch(e){} });
    _fmOscs = [];
    _harmLfos.forEach(function(o){ try{o.stop();o.disconnect();}catch(e){} });
    _harmLfos = [];
    stopArpeggiator();
    stopLFO();
    stopBowlPans();
  }

  function stopNoise() {
    if (_noiseGain) { try{_noiseGain.disconnect();}catch(e){} _noiseGain=null; }
    if (_noise)     { try{_noise.stop();_noise.disconnect();}catch(e){} _noise=null; }
    if (_granular)  { try{_granular.stop();}catch(e){} _granular=null; }
  }

  /* ════════════════════════════════════════════════════════════════════════
     SES BAŞLAT — startSound v9.0
     ════════════════════════════════════════════════════════════════════════ */
  function startSound(gen, base, beat, offset) {
    var ctx = getCtx();
    if (ctx.state === 'suspended') ctx.resume();
    ensureMaster(ctx);

    /* Aşama 11: SM henüz bağlı değilse bootstrap et — MOTOR SESİ ÜRETMEDEN ÖNCE */
    if (!_sampleManager && typeof window.SampleManager !== 'undefined' && _master) {
      try {
        _sampleManager = new window.SampleManager(ctx, _master, {
          basePath: 'audio/',
          volume  : 0.85,
        });
        console.info('[AudioEngine v11] SampleManager startSound içinde bootstrap edildi.');
      } catch(e) { console.warn('[AudioEngine v11] SM bootstrap hatası:', e.message); }
    }

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
    stopDirectNature();

    /* ── Filtre Zarfı ── */
    var _fEnvNow = ctx.currentTime;
    _mainFilter.frequency.cancelScheduledValues(_fEnvNow);
    _mainFilter.frequency.setValueAtTime(350, _fEnvNow);
    _mainFilter.frequency.exponentialRampToValueAtTime(1900, _fEnvNow + 5.0);

    /* ── Sahne Mikseri ── */
    var _baseVol = window._prefVector ? window._prefVector.getLayerGains().ambient * 0.85 : 0.60;
    var _mix     = SCENE_MIX[gen] || { ambient: 0.50, tones: 0.50 };
    var ambVol   = Math.max(0.05, Math.min(0.95, _baseVol * (_mix.ambient / 0.50)));

    /* ══ Aşama 9: Sub-Pad Gain — %70 düşürüldü ═══════════════════════════
     * v9.0: Osilatörler artık sadece arka plan warmth sağlar.
     * Kulağın duyduğu ana ses = SampleManager enstrümanları. */
    var oscVol = _mix.tones * 0.30; /* v9.0: 1.00 → 0.30 (%70 düşüş) */

    var xfDur   = 2.5;
    var PAD_ATTACK = 5.5; /* v9.0: Daha yavaş atak — sub-pad doğal açılım */

    /* ══ DOĞRUDAN DOĞA SESİ ══ */
    startDirectNature(ctx, gen, ambVol);

    /* ══ Aşama 9: WARM SUB-PAD OSİLATÖRLER ═══════════════════════════════
     * buildWarmPad: FM çok yumuşak, gain çok düşük.
     * Kulak sadece perde değişimlerinde fark eder — siren yok. */
    if (beat > 0) {
      var _fm = (typeof window.getFrequencyManager === 'function')
        ? window.getFrequencyManager(base)
        : null;
      if (_fm) _fm.setBaseFreq(isFinite(base) ? base : 200);

      var _leftFreq = _fm ? _fm.getNextFrequency() : (isFinite(base) ? base : 200);

      /* Auto-Pan StereoPanners */
      var panL = ctx.createStereoPanner();
      var panR = ctx.createStereoPanner();
      panL.pan.value = -0.8;
      panR.pan.value =  0.8;

      _bowlPanOscL = createAutoPan(ctx, panL, 0.003, 0.20, 0);
      _bowlPanOscR = createAutoPan(ctx, panR, 0.003, 0.20, 166);

      panL.connect(_mainFilter);
      panR.connect(_mainFilter);

      var _oscStartNow = ctx.currentTime;

      var envGainL = ctx.createGain();
      envGainL.gain.setValueAtTime(0.0001, _oscStartNow);
      envGainL.gain.exponentialRampToValueAtTime(oscVol, _oscStartNow + PAD_ATTACK);

      var envGainR = ctx.createGain();
      envGainR.gain.setValueAtTime(0.0001, _oscStartNow);
      envGainR.gain.exponentialRampToValueAtTime(oscVol, _oscStartNow + PAD_ATTACK);

      /* Cross-panning LFO */
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

      /* ── Aşama 9: Sadece 2 harmonik — daha az sinüs yoğunluğu ──────────
       * v8.0: 4 harmonik × 2 kanal = 8 osilatör → siren riski yüksek.
       * v9.0: 2 harmonik × 2 kanal = 4 osilatör → sub-pad karakteri. */
      var _beat = isFinite(beat) ? beat : 0;
      var PAD_HARMONICS = [
        { mult:1, gainVal: oscVol * 1.0 },  /* Temel */
        { mult:2, gainVal: oscVol * 0.4 },  /* Oktav — derin warmth */
      ];

      PAD_HARMONICS.forEach(function(h) {
        var freqL = Math.min(20000, _leftFreq * h.mult);
        var freqR = Math.min(20000, _leftFreq * h.mult + _beat * h.mult);
        var detuneL = (Math.random() - 0.5) * 10.0; /* Daha az detune */
        var detuneR = (Math.random() - 0.5) * 10.0;

        var vL = buildWarmPad(ctx, freqL, detuneL, h.gainVal, envGainL, PAD_ATTACK);
        _oscs.push(vL.carrier);
        _fmOscs.push(vL.fmMod);
        _harmLfos.push(vL.lfo);

        var vR = buildWarmPad(ctx, freqR, detuneR, h.gainVal, envGainR, PAD_ATTACK);
        _oscs.push(vR.carrier);
        _fmOscs.push(vR.fmMod);
        _harmLfos.push(vR.lfo);
      });

      _lfoOsc.start();
    }

    var now = ctx.currentTime;

    /* ══ GranularEngine / Fallback ══════════════════════════════════════ */
    if (window.GranularEngine) {
      var grainTypeMap = {waves:'waves',rain:'rain',wind:'wind',fire:'forest',storm:'wind',binaural:'forest',zen:'wind',space:'wind',earth:'forest',forest:'forest',morning:'wind'};
      var grainType = grainTypeMap[gen] || 'wind';
      var _panner = ctx.createStereoPanner ? ctx.createStereoPanner() : null;
      var _panVal = {waves:0.6,rain:0.4,wind:0.7,fire:0.5,storm:0.8,binaural:0.0,zen:0.5,space:0.3,earth:0.6,forest:0.7,morning:0.4}[gen]||0.3;
      if (_panner) {
        _panner.pan.value = (Math.random()>0.5?1:-1)*_panVal;
        _panner.connect(_mainFilter);
      }
      var _granDest = _panner || _mainFilter;
      _granular = new window.GranularEngine(ctx, _granDest, { volume: ambVol * 0.50 });
      _granular.generateBuffer(grainType);
      _granular.start();
      _startTime = now;
    } else {
      var src  = ctx.createBufferSource();
      var filt = ctx.createBiquadFilter();
      var gain = ctx.createGain();
      src.buffer    = makePinkNoiseBuffer(ctx, gen);
      src.loop      = true;
      src.loopStart = 0;
      src.loopEnd   = src.buffer.duration;
      filt.type            = 'highpass';
      filt.frequency.value = {waves:800,rain:2000,wind:1500,fire:1000,storm:2500,binaural:300,zen:1200,space:200,earth:700,forest:900,morning:1100}[gen]||700;
      filt.Q.value = 0.6;
      src.connect(filt); filt.connect(gain); gain.connect(_mainFilter);

      var off = isFinite(offset) ? (offset % _loopDur + _loopDur) % _loopDur : 0;
      gain.gain.setValueAtTime(0.0001, now);
      gain.gain.exponentialRampToValueAtTime(ambVol * 0.35, now + xfDur);

      if (_noiseGain) {
        var oldG = _noiseGain;
        oldG.gain.setValueAtTime(oldG.gain.value, now);
        oldG.gain.exponentialRampToValueAtTime(0.0001, now + xfDur);
        setTimeout(function(){ try{oldG.disconnect();}catch(e){} }, (xfDur+0.1)*1000);
      }
      src.start(0, off); _startTime=now; _noise=src; _noiseGain=gain;
    }

    /* ── Modülasyon + Arpeggiator ── */
    setTimeout(function() {
      if (_playing && _ctx) startModulation(_ctx);
    }, 300);

    setTimeout(function() {
      if (_playing && _ctx && _oscs.length) startArpeggiator(_ctx);
    }, 800);

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
      stopDirectNature();
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

  /* ════════════════════════════════════════════════════════════════════════
     switchSound — v9.0: Enstrüman Preset Entegrasyonu
     ════════════════════════════════════════════════════════════════════════ */
  window.switchSound = function(gen, base, beat, label, msd) {
    try{ localStorage.setItem('lastGen',gen); localStorage.setItem('lastBase',base); localStorage.setItem('lastBeat',beat); }catch(e){}
    if (window._prefVector) try{ window._prefVector.recordSoundChoice(gen, base, beat); }catch(e){}
    _pauseOffset = 0;
    if (_playing) startSound(gen, base, beat, 0);

    /* ── SampleManager v2.0 — Sahne + Enstrüman Preset ── */
    if (typeof window.SampleManager !== 'undefined') {
      var ctx = getCtx();
      ensureMaster(ctx);
      if (!_sampleManager) {
        _sampleManager = new window.SampleManager(ctx, _master, {
          basePath : 'audio/',
          volume   : 0.65,
        });
      }
      var _sceneTarget = (msd && typeof msd.sceneName === 'string')
        ? msd.sceneName
        : (GEN_TO_SCENE[gen] || 'Calm Breath');

      /* applyScene hem ortam seslerini hem enstrüman presetini uygular */
      _sampleManager.applyScene(_sceneTarget).then(function() {
        if (_playing) _sampleManager.start();
      }).catch(function(e){ console.warn('[SampleManager] applyScene hata:', e); });
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

/* ══ ADIM 8+9: Listener adaptasyonu + syncStart ══ */

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
    if (window._mainFilter && p.filterFreq !== undefined)
      window._mainFilter.frequency.linearRampToValueAtTime(
        Math.max(500, Math.min(8000, p.filterFreq)), now + ramp
      );
  } catch(e) { console.warn('[applyBiometricEffect]', e); }
};

/* ── Yedek referans ── */
window._audioToggle      = window.togglePlay;
window._audioSwitchSound = window.switchSound;
window._audioSleepTimer  = window.setSleepTimer;
