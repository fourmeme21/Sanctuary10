/* ═══════════════════════════════════════════════════════════════════════════
   SANCTUARY SES MOTORU — v8.0 (Organik Katman Operasyonu)
   ─────────────────────────────────────────────────────────────────────────────
   Sinyal Zinciri:
     Kaynaklar (Singing Bowl FM v8 + Pink Noise Rüzgar + Stereo Auto-Pan)
       → _mainFilter  (Filtre Zarfı: 350→1900 Hz @ 5sn | LFO kademeli açılım | Q:4.0)
       → _masteringComp
       → _satNode     (tanh Soft-Clip k=8, 4x — analog sıcaklık)
       → _tremoloNode (±20% @ 0.08 Hz — fiziksel nabız)
       → _master
       → EQ (low/mid/high)
       → _comp
       → destination

   v8.0 — Aşama 8 YENİLİKLERİ:
     • FM Derinliği 3× Artırıldı   : fmDepth = freq × 0.030 (eskiden 0.010)
                                       Metalik "ring" ve çınlama artık net duyuluyor.
                                       Daha belirgin Singing Bowl karakteri.
     • Hızlandırılmış Arpeggiator  : 4–6 sn (eskiden 8–12 sn)
                                       Glide: 1.5–2.5 sn (eskiden 3–4.5 sn)
                                       Beyin yeni olayı zamanında algılar → taze dikkat.
     • Anlık Pink Noise Rüzgar     : SampleManager'ı BEKLEMEDEN, AudioEngine başlar
                                       başlamaz doğrudan Pink Noise tabanlı organik rüzgar
                                       çalar. Sessizlik anı tamamen ortadan kalkar.
                                       _directWindGain / _directWindSrc değişkenleri.
     • Stereo Auto-Pan (3D Hareket): Her ses kaynağı StereoPannerNode ile sürekli
                                       ama çok yavaş sağdan sola gezinir.
                                       Oranlar: Rüzgar 0.007 Hz, Dalga 0.005 Hz, Bowl 0.003 Hz
                                       Kullanıcı sesin içinde "döndüğünü" hissetmeli.
     • FM Micro-LFO Derinliği +    : ±%32 shimmer (eskiden ±%22) → daha canlı ensemble.
     • Tüm v7.0 özellikleri korundu (Q:4.0, k=8, ±20% tremolo, ±4ct chaos, binaural,
                                       Sahne Aktivasyonu, GEN_TO_SCENE, BOWL_ATTACK)
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
  var _tremoloOsc=null,   _tremoloDepth=null;
  var _chaosTimer=null;
  var _arpTimer=null;
  var _sampleManager=null;

  /* v8.0: Anlık doğa sesi katmanı (SampleManager bağımsız) */
  var _directWindSrc=null, _directWindGain=null, _directWindPan=null;
  var _directWaveSrc=null, _directWaveGain=null, _directWavePan=null;
  var _directWindPanOsc=null, _directWavePanOsc=null;

  /* v8.0: Bowl Auto-Pan osilatörleri */
  var _bowlPanOscL=null, _bowlPanOscR=null;

  /* Sabitler */
  var GOLDEN = 1.618034;
  var ARP_RATIOS = [1/1, 9/8, 5/4, 4/3, 3/2, 5/3, 15/8, 2/1];

  /* gen → SampleManager sahne adı haritası */
  var GEN_TO_SCENE = {
    waves   : 'Calm Breath',
    rain    : 'Deep Peace',
    wind    : 'Light Breath',
    fire    : 'Energy Renewal',
    storm   : 'Focus Flow',
    binaural: 'Heart Resonance',
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
     MASTER BUS — v8.0 (v7.0'dan korundu)
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

    /* Soft-Clip WaveShaper k=8 */
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

    /* Tremolo — base 0.80, ±20% */
    _tremoloNode = ctx.createGain();
    _tremoloNode.gain.value = 0.80;

    /* 3-Band EQ */
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

    /* Ana Lowpass Filtresi — Q:4.0 */
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
     AŞAMA 8: SINGING BOWL FM SENTEZLEYİCİ — v8.0 (FM 3× Güçlendirildi)
     ────────────────────────────────────────────────────────────────────────
     v8.0 değişiklikleri:
       • FM derinliği: freq × 0.010 → freq × 0.030 (3× artış)
         Metal kase "ring" artık net ve belirgin duyuluyor.
         Tiz frekanslarda parlak shimmer, basta derin çınlama.
       • Micro-LFO derinliği: gainVal × 0.22 → gainVal × 0.32
         Her harmonik daha canlı, bağımsız nefes alıyor.
       • Auto-Pan desteği: bowlPanGain parametresi eklendi.
         BuildBowlVoice çıkışı pannerNode'a yönlendirilebilir.
     ════════════════════════════════════════════════════════════════════════ */
  function buildBowlVoice(ctx, freq, detuneCents, oscType, gainVal, destGain, attackSec) {
    var now = ctx.currentTime;

    /* ── Carrier Osilatör ── */
    var carrier = ctx.createOscillator();
    carrier.type = oscType;
    carrier.frequency.value = freq;
    carrier.detune.value = detuneCents;

    /* ── FM Shimmer Modülatör — v8.0: 3× daha derin ─────────────────────
     * freq × 0.030: metalik "ring" karakteri belirgin ve net.
     * Eskiden 0.010 → sadece hafif doku; şimdi gerçek Singing Bowl çınlaması. */
    var fmMod = ctx.createOscillator();
    fmMod.type = 'sine';
    fmMod.frequency.value = freq * 0.27;  /* Metalophone harmonik oranı korundu */

    var fmDepth = ctx.createGain();
    /* v8.0: 3× artış — freq × 0.030 (eskiden 0.010) */
    fmDepth.gain.value = Math.max(3.6, freq * 0.030);
    fmMod.connect(fmDepth);
    fmDepth.connect(carrier.frequency);

    /* ── Micro-Gain LFO — v8.0: ±%32 shimmer (eskiden ±%22) ─────────────
     * Daha derin nefes: her harmonik ensemble içinde daha belirgin titreşir. */
    var lfoRate = 0.10 + Math.random() * 0.40;
    var lfo = ctx.createOscillator();
    lfo.type = 'sine';
    lfo.frequency.value = lfoRate;

    var lfoAmp = ctx.createGain();
    lfoAmp.gain.value = gainVal * 0.32;  /* v8.0: 0.22 → 0.32 */
    lfo.connect(lfoAmp);

    var shimmer = ctx.createGain();
    shimmer.gain.value = 1.0;
    lfoAmp.connect(shimmer.gain);

    /* ── Enstrüman Zarfı — Yavaş Atak ── */
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
     AŞAMA 8: PINK NOISE TABАНLI ORGANİK RÜZGAR — Anlık, Doğrudan
     ────────────────────────────────────────────────────────────────────────
     Paul Kellet algoritması ile Pink Noise üretimi.
     SampleManager bağımsız: AudioEngine başladığı anda çalar.
     Sessizlik anı = 0ms. Her zaman bir doğa sesi var.

     Sinyal: PinkNoise → BPF (doğa rengi) → StereoPanner (Auto-Pan) → _mainFilter
     ════════════════════════════════════════════════════════════════════════ */
  function makePinkNoiseBuffer(ctx, gen) {
    var sr  = ctx.sampleRate || 44100;
    var dur = 12;  /* 12 saniye loop — daha az tekrarlayan doku */
    var len = Math.round(sr * dur);
    var buf = ctx.createBuffer(2, len, sr);

    for (var ch = 0; ch < 2; ch++) {
      var d = buf.getChannelData(ch);
      /* Paul Kellet Pink Noise filtresi */
      var b0=0,b1=0,b2=0,b3=0,b4=0,b5=0,b6=0;
      /* Ek parametreler — gen'e göre renk */
      var p1=0, p2=0, p3=0;

      for (var i = 0; i < len; i++) {
        var white = Math.random() * 2 - 1;
        /* Pink noise dönüşümü (Paul Kellet) */
        b0 = 0.99886*b0 + white*0.0555179;
        b1 = 0.99332*b1 + white*0.0750759;
        b2 = 0.96900*b2 + white*0.1538520;
        b3 = 0.86650*b3 + white*0.3104856;
        b4 = 0.55000*b4 + white*0.5329522;
        b5 = -0.7616*b5 - white*0.0168980;
        var pink = (b0+b1+b2+b3+b4+b5+b6 + white*0.5362) * 0.11;
        b6 = white * 0.115926;

        var v = 0;
        if (gen === 'wind' || gen === 'binaural') {
          /* Organik rüzgar: Pink Noise + yavaş dalga modülasyonu */
          p1 += (2*Math.PI*0.09)/sr;
          p2 += (2*Math.PI*0.04)/sr;
          var windEnv = Math.max(0, 0.5 + Math.sin(p2)*0.38 + Math.sin(p1*0.4)*0.12);
          v = pink * 0.60 * windEnv;
        } else if (gen === 'waves') {
          /* Okyanus: Pink + dalga sürme */
          p1 += (2*Math.PI*0.07)/sr;
          p2 += (2*Math.PI*0.15)/sr;
          p3 += (2*Math.PI*0.032)/sr;
          var swell = 0.55 + Math.sin(p3)*0.45;
          v = pink * 0.45 * swell + Math.sin(p1)*0.12*swell + Math.sin(p2)*0.06*swell;
        } else if (gen === 'rain') {
          /* Yağmur: Pink zemin + nadir damlalar */
          p1 += (2*Math.PI*0.35)/sr;
          v = pink * 0.40 * (0.7 + Math.sin(p1)*0.3);
          if (Math.random() < 0.0006) v += (Math.random()*2-1)*0.22;
        } else if (gen === 'fire') {
          /* Ateş: Pink + çatlama impulsleri */
          p1 += (2*Math.PI*2.2)/sr;
          p2 += (2*Math.PI*0.06)/sr;
          v = pink * 0.50 * (0.6+Math.sin(p2)*0.4) + Math.sin(p1)*0.03;
          if (Math.random() < 0.007) v += (Math.random()*2-1)*0.40;
        } else if (gen === 'storm') {
          /* Fırtına: Yoğun Pink + güçlü gümbürtü */
          p1 += (2*Math.PI*0.22)/sr;
          p2 += (2*Math.PI*0.04)/sr;
          v = pink * 0.75 * (0.6+Math.sin(p1)*0.4) + Math.sin(p2)*0.025;
        } else {
          v = pink * 0.30;
        }
        d[i] = isFinite(v) ? Math.max(-1, Math.min(1, v)) : 0;
      }
    }
    return buf;
  }

  /* ════════════════════════════════════════════════════════════════════════
     AŞAMA 8: STEREO AUTO-PAN SİSTEMİ
     ────────────────────────────────────────────────────────────────────────
     Bir StereoPannerNode'un pan AudioParam'ına LFO bağlar.
     Kullanıcı sesin içinde yavaşça "döndüğünü" hisseder.

     lfoHz: Çok yavaş — algılanabilir ama dikkat çekici değil.
       • Rüzgar/Dalga : 0.007 Hz (~143 sn tam tur)
       • Bowl         : 0.003 Hz (~333 sn tam tur)
     depth: Maksimum pan sapması (0=merkez, 1=tam sağ/sol)
     ════════════════════════════════════════════════════════════════════════ */
  function createAutoPan(ctx, pannerNode, lfoHz, depth, phaseOffset) {
    var lfo = ctx.createOscillator();
    lfo.type = 'sine';
    lfo.frequency.value = lfoHz;

    /* Faz sapması: farklı kaynaklar aynı anda aynı yönde değil */
    var phaseBuf = ctx.createBuffer(1, 1, ctx.sampleRate);
    phaseBuf.getChannelData(0)[0] = 0;

    var lfoDepth = ctx.createGain();
    lfoDepth.gain.value = depth;

    lfo.connect(lfoDepth);
    lfoDepth.connect(pannerNode.pan);
    lfo.start(ctx.currentTime + (phaseOffset || 0));

    return lfo;
  }

  /* ════════════════════════════════════════════════════════════════════════
     AŞAMA 8: DOĞRUDAN DOĞA SESİ BAŞLATICI
     ────────────────────────────────────────────────────────────────────────
     AudioEngine başladığı anda SampleManager'ı beklemeden
     Pink Noise tabanlı dalga + rüzgar katmanlarını çalar.
     Her iki katman da Auto-Pan ile stereo uzayda hareket eder.
     ════════════════════════════════════════════════════════════════════════ */
  function startDirectNature(ctx, gen, ambVol) {
    stopDirectNature();

    var now = ctx.currentTime;

    /* ── Katman 1: Rüzgar/Ana Ortam (Pink Noise) ── */
    var windBuf = makePinkNoiseBuffer(ctx, gen);

    _directWindSrc = ctx.createBufferSource();
    _directWindSrc.buffer    = windBuf;
    _directWindSrc.loop      = true;
    _directWindSrc.loopStart = 0;
    _directWindSrc.loopEnd   = windBuf.duration;

    /* BPF: gen'e özel renk filtresi */
    var windFilt = ctx.createBiquadFilter();
    windFilt.type = 'bandpass';
    windFilt.frequency.value = {
      waves: 600, rain: 2200, wind: 1100, fire: 1400, storm: 800, binaural: 700
    }[gen] || 900;
    windFilt.Q.value = 0.6;

    /* Auto-Pan: 0.007 Hz, depth 0.55, faz=0 */
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

    /* ── Katman 2: Dalga/İkincil Ortam (Pink Noise, waves sahnesinde) ── */
    /* Dalgalı sahnelerde ikinci bir Pink Noise katmanı: daha yumuşak, ters fazda */
    if (gen === 'waves' || gen === 'binaural' || gen === 'rain') {
      var secGen = (gen === 'rain') ? 'wind' : 'waves';
      var waveBuf = makePinkNoiseBuffer(ctx, secGen);

      _directWaveSrc = ctx.createBufferSource();
      _directWaveSrc.buffer    = waveBuf;
      _directWaveSrc.loop      = true;
      _directWaveSrc.loopStart = 0;
      _directWaveSrc.loopEnd   = waveBuf.duration;

      var waveFilt = ctx.createBiquadFilter();
      waveFilt.type = 'lowpass';
      waveFilt.frequency.value = 500;
      waveFilt.Q.value = 0.5;

      /* Auto-Pan: ters faz (Math.PI / 2 offset ile başlatılır zaman ötelemesiyle) */
      _directWavePan = ctx.createStereoPanner();
      _directWavePan.pan.value = 0;
      /* Rüzgar 143 saniyede tam tur → dalga 71 saniye sonra başlıyor gibi davranır */
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

    console.info('[AudioEngine v8.0] Anlık doğa sesi başlatıldı:', gen, 'hacim:', ambVol.toFixed(2));
  }

  function stopDirectNature() {
    /* Rüzgar katmanı */
    if (_directWindPanOsc)  { try{_directWindPanOsc.stop(); _directWindPanOsc.disconnect();}catch(e){} _directWindPanOsc=null; }
    if (_directWindGain)    { try{_directWindGain.disconnect();}catch(e){} _directWindGain=null; }
    if (_directWindPan)     { try{_directWindPan.disconnect();}catch(e){} _directWindPan=null; }
    if (_directWindSrc)     { try{_directWindSrc.stop(); _directWindSrc.disconnect();}catch(e){} _directWindSrc=null; }
    /* Dalga katmanı */
    if (_directWavePanOsc)  { try{_directWavePanOsc.stop(); _directWavePanOsc.disconnect();}catch(e){} _directWavePanOsc=null; }
    if (_directWaveGain)    { try{_directWaveGain.disconnect();}catch(e){} _directWaveGain=null; }
    if (_directWavePan)     { try{_directWavePan.disconnect();}catch(e){} _directWavePan=null; }
    if (_directWaveSrc)     { try{_directWaveSrc.stop(); _directWaveSrc.disconnect();}catch(e){} _directWaveSrc=null; }
  }

  /* ════════════════════════════════════════════════════════════════════════
     MODÜLASYON SİSTEMİ — v8.0 (v7.0'dan korundu)
     ════════════════════════════════════════════════════════════════════════ */
  function startModulation(ctx) {
    stopModulation();
    var now = ctx.currentTime;

    /* 1. Filter LFO — Kademeli açılım */
    _filterLfoOsc = ctx.createOscillator();
    _filterLfoOsc.type = 'sine';
    _filterLfoOsc.frequency.value = 0.05;

    _filterLfoGain = ctx.createGain();
    _filterLfoGain.gain.setValueAtTime(30, now);
    _filterLfoGain.gain.linearRampToValueAtTime(1300, now + 5.5);

    _filterLfoOsc.connect(_filterLfoGain);
    _filterLfoGain.connect(_mainFilter.frequency);
    _filterLfoOsc.start();

    /* 2. Tremolo LFO — %20 fiziksel nabız */
    _tremoloOsc = ctx.createOscillator();
    _tremoloOsc.type = 'sine';
    _tremoloOsc.frequency.value = 0.08;

    _tremoloDepth = ctx.createGain();
    _tremoloDepth.gain.value = 0.20;

    _tremoloOsc.connect(_tremoloDepth);
    _tremoloDepth.connect(_tremoloNode.gain);
    _tremoloOsc.start();

    /* 3. Chaos Engine — Analog Drift ±4 cent */
    function scheduleNextChaos() {
      var delay = 3000 + Math.random() * 3000;
      _chaosTimer = setTimeout(function() {
        if (!_playing || !_oscs.length) return;
        try {
          var idx  = Math.floor(Math.random() * _oscs.length);
          var osc  = _oscs[idx];
          if (osc && osc.detune) {
            var cur   = osc.detune.value;
            var drift = (Math.random() - 0.5) * 8.0;
            var next  = Math.max(-8, Math.min(8, cur + drift));
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
     AŞAMA 8: GOLDEN RATIO ARPEGGİATOR — v8.0 (Hızlandırıldı)
     ────────────────────────────────────────────────────────────────────────
     v8.0 değişiklikleri:
       • Bekleme süresi: 8–12 sn → 4–6 sn (beyin yeni olayı daha erken algılar)
       • Glide süresi: 3–4.5 sn → 1.5–2.5 sn (daha akışkan, daha az "bekleme")
       • Phi birikimi aynı: Golden Ratio adım ilerlemesi korundu.
     ════════════════════════════════════════════════════════════════════════ */
  function startArpeggiator(ctx) {
    stopArpeggiator();
    if (!_curBase || !_oscs.length) return;

    var phiAccum = 0;

    function scheduleNextArp() {
      /* v8.0: 4–6 sn (eskiden 8–12 sn) */
      var delay = 4000 + Math.random() * 2000;
      _arpTimer = setTimeout(function() {
        if (!_playing || !_oscs.length) { scheduleNextArp(); return; }

        phiAccum = (phiAccum + GOLDEN) % ARP_RATIOS.length;
        var stepIdx = Math.floor(phiAccum) % ARP_RATIOS.length;
        var ratio   = ARP_RATIOS[stepIdx];

        var phiFrac  = phiAccum - Math.floor(phiAccum);
        var microDrift = 1.0 + (phiFrac - 0.5) * 0.036;
        var targetBase = _curBase * ratio * microDrift;
        targetBase = Math.max(20, Math.min(1200, targetBase));

        var ratioChange = targetBase / _curBase;
        /* v8.0: 1.5–2.5 sn glide (eskiden 3–4.5 sn) */
        var glide = 1.5 + Math.random() * 1.0;
        var now = ctx.currentTime;

        _oscs.forEach(function(osc) {
          if (!osc || !osc.frequency) return;
          var cur = osc.frequency.value;
          var newFreq = Math.min(20000, Math.max(20, cur * ratioChange));
          osc.frequency.setValueAtTime(cur, now);
          osc.frequency.linearRampToValueAtTime(newFreq, now + glide);
        });

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
    if (_bowlPanOscL) { try{_bowlPanOscL.stop(); _bowlPanOscL.disconnect();}catch(e){} _bowlPanOscL=null; }
    if (_bowlPanOscR) { try{_bowlPanOscR.stop(); _bowlPanOscR.disconnect();}catch(e){} _bowlPanOscR=null; }
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
     SES BAŞLAT — startSound v8.0
     ════════════════════════════════════════════════════════════════════════ */
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
    stopDirectNature();  /* v8.0: önceki doğa seslerini temizle */

    /* ── Filtre Zarfı ── */
    var _fEnvNow = ctx.currentTime;
    _mainFilter.frequency.cancelScheduledValues(_fEnvNow);
    _mainFilter.frequency.setValueAtTime(350, _fEnvNow);
    _mainFilter.frequency.exponentialRampToValueAtTime(1900, _fEnvNow + 5.0);

    /* ── Sahne Mikseri ── */
    var _baseVol = window._prefVector ? window._prefVector.getLayerGains().ambient * 0.85 : 0.60;
    var _mix     = SCENE_MIX[gen] || { ambient: 0.50, tones: 0.50 };
    var ambVol   = Math.max(0.05, Math.min(0.95, _baseVol * (_mix.ambient / 0.50)));
    var oscVol   = _mix.tones;

    var xfDur = 2.5;
    var BOWL_ATTACK = 4.0;

    /* ════════════════════════════════════════════════════════════════════
       v8.0: AŞAMA 8 — DOĞRUDAN DOĞA SESİ (SampleManager bağımsız)
       Pink Noise tabanlı ortam sesi HEMEN başlar.
       SampleManager sonradan eklenince crossfade ile geçiş yapar.
       ════════════════════════════════════════════════════════════════════ */
    startDirectNature(ctx, gen, ambVol);

    /* ══ Binaural + Singing Bowl Osilatörler ═══════════════════════════════
     * v8.0: buildBowlVoice FM derinliği 3×, LFO derinliği %32.
     * Auto-Pan: Bowl osilatörleri de yavaşça stereo uzayda dolaşır. */
    if (beat > 0) {
      var _fm = (typeof window.getFrequencyManager === 'function')
        ? window.getFrequencyManager(base)
        : null;
      if (_fm) _fm.setBaseFreq(isFinite(base) ? base : 200);

      var _leftFreq = _fm ? _fm.getNextFrequency() : (isFinite(base) ? base : 200);

      /* v8.0: Auto-Pan StereoPanners — Bowl sesi de döner */
      var panL = ctx.createStereoPanner();
      var panR = ctx.createStereoPanner();
      panL.pan.value = -0.8;
      panR.pan.value =  0.8;

      /* Bowl Auto-Pan — 0.003 Hz, depth 0.20 (çok yavaş, hafif) */
      _bowlPanOscL = createAutoPan(ctx, panL, 0.003, 0.20, 0);
      _bowlPanOscR = createAutoPan(ctx, panR, 0.003, 0.20, 166); /* ~ters faz */

      panL.connect(_mainFilter);
      panR.connect(_mainFilter);

      var _oscStartNow = ctx.currentTime;

      var envGainL = ctx.createGain();
      envGainL.gain.setValueAtTime(0.0001, _oscStartNow);
      envGainL.gain.exponentialRampToValueAtTime(oscVol, _oscStartNow + BOWL_ATTACK);

      var envGainR = ctx.createGain();
      envGainR.gain.setValueAtTime(0.0001, _oscStartNow);
      envGainR.gain.exponentialRampToValueAtTime(oscVol, _oscStartNow + BOWL_ATTACK);

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

      /* ── v8.0: 4 Katmanlı Harmonik Binaural × Singing Bowl FM ──────────
       * FM derinliği 3× artırıldı (buildBowlVoice içinde freq×0.030).
       * LFO shimmer %32 (eskiden %22). */
      var _beat = isFinite(beat) ? beat : 0;
      var HARMONICS = [
        { mult:1, type:'sine',     gainVal:0.10  },
        { mult:2, type:'sine',     gainVal:0.05  },
        { mult:3, type:'triangle', gainVal:0.03  },
        { mult:4, type:'sine',     gainVal:0.015 },
      ];

      HARMONICS.forEach(function(h) {
        var freqL = Math.min(20000, _leftFreq * h.mult);
        var freqR = Math.min(20000, _leftFreq * h.mult + _beat * h.mult);
        var detuneL = (Math.random() - 0.5) * 16.0;
        var detuneR = (Math.random() - 0.5) * 16.0;

        var vL = buildBowlVoice(ctx, freqL, detuneL, h.type, h.gainVal, envGainL, BOWL_ATTACK);
        _oscs.push(vL.carrier);
        _fmOscs.push(vL.fmMod);
        _harmLfos.push(vL.lfo);

        var vR = buildBowlVoice(ctx, freqR, detuneR, h.type, h.gainVal, envGainR, BOWL_ATTACK);
        _oscs.push(vR.carrier);
        _fmOscs.push(vR.fmMod);
        _harmLfos.push(vR.lfo);
      });

      _lfoOsc.start();
    }

    var now = ctx.currentTime;

    /* ══ GranularEngine / Fallback Ortam Sesi ═══════════════════════════
     * GranularEngine varsa çalıştır (v8.0: Pink Noise ile paralel çalışır,
     * ikisi birlikte daha zengin doku).
     * Yoksa: makeBuffer fallback — Direct Nature zaten çalışıyor. */
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
      _granular = new window.GranularEngine(ctx, _granDest, { volume: ambVol * 0.60 }); /* v8.0: %60 — Direct Nature ile denge */
      _granular.generateBuffer(grainType);
      _granular.start();
      _startTime = now;
    } else {
      /* Fallback buffer: Direct Nature zaten çalışıyor, bu yüzden hacim düşük */
      var src  = ctx.createBufferSource();
      var filt = ctx.createBiquadFilter();
      var gain = ctx.createGain();
      src.buffer    = makePinkNoiseBuffer(ctx, gen); /* v8.0: fallback da Pink Noise kullanıyor */
      src.loop      = true;
      src.loopStart = 0;
      src.loopEnd   = src.buffer.duration;
      filt.type            = 'highpass'; /* Tiz renk — Direct Nature'un bass'ını tamamlar */
      filt.frequency.value = {waves:800, rain:2000, wind:1500, fire:1000, storm:2500, binaural:300}[gen]||700;
      filt.Q.value = 0.6;
      src.connect(filt); filt.connect(gain); gain.connect(_mainFilter);

      var off = isFinite(offset) ? (offset % _loopDur + _loopDur) % _loopDur : 0;
      gain.gain.setValueAtTime(0.0001, now);
      gain.gain.exponentialRampToValueAtTime(ambVol * 0.40, now + xfDur); /* v8.0: 0.40× — Direct Nature'la denge */

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
      stopDirectNature();  /* v8.0: Direct Nature da durdurulur */
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
     switchSound — v8.0: SampleManager + Direct Nature paralel
     ────────────────────────────────────────────────────────────────────────
     v8.0: Direct Nature anında başlatılır (SampleManager beklemeden).
     SampleManager gelince ses zenginleşir, kulakta kopukluk olmaz.
     ════════════════════════════════════════════════════════════════════════ */
  window.switchSound = function(gen, base, beat, label, msd) {
    try{ localStorage.setItem('lastGen',gen); localStorage.setItem('lastBase',base); localStorage.setItem('lastBeat',beat); }catch(e){}
    if (window._prefVector) try{ window._prefVector.recordSoundChoice(gen, base, beat); }catch(e){}
    _pauseOffset = 0;
    if (_playing) startSound(gen, base, beat, 0);

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
