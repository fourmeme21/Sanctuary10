/* ═══════════════════════════════════════════════════════════════════════════
   SANCTUARY SES MOTORU — v7.0 (Enstrümantal Doku, Canlı Doğa, Sahne Aktivasyonu)
   ─────────────────────────────────────────────────────────────────────────────
   Sinyal Zinciri:
     Kaynaklar (Singing Bowl FM Sentez + Ambient)
       → _mainFilter  (Filtre Zarfı: 350→1900 Hz @ 5sn | LFO kademeli açılım | Q:4.0)
       → _masteringComp
       → _satNode     (tanh Soft-Clip k=8, 4x — analog sıcaklık)
       → _tremoloNode (±20% @ 0.08 Hz — fiziksel nabız)
       → _master
       → EQ (low/mid/high)
       → _comp
       → destination

   v7.0 — Aşama 7 YENİLİKLERİ:
     • Singing Bowl FM Sentez : Her harmonik = Carrier + FM Mod (×0.27) + Micro-Gain LFO (0.1–0.5 Hz)
                                 Saf sinüs → "Metal kase / Deep Pad" enstrüman karakteri
     • Enstrüman Filtre Zarfı : 350 Hz → 1900 Hz, 5 sn exponential açılım (yaylı çalgı atağı)
                                 LFO derinliği de 0 → 1300 Hz'e kademeli yükselir
     • Golden Ratio Arpeggiator: 8–12 sn'de bir JI+φ nota değişimi, 3–4.5 sn glide
                                 "Statik frekans" hissi tamamen yok edildi
     • Sahne Aktivasyonu      : switchSound → SampleManager.applyScene(gen→scene) otomatik
                                 SampleManager volume 0.65 (eskiden ~0.30)
     • gen→scene haritası     : waves/rain/wind/fire/storm/binaural → Sahne adları
     • Tüm v6.1 özellikleri korundu (Q:4.0, k=8, ±20% tremolo, ±4ct chaos, harmonik binaural)

   v6.1 mirası:
     • Filter Q:4.0 | Soft-Clip k=8 | Tremolo ±20% | Chaos ±4ct, 3–6sn
     • 4 katmanlı harmonik binaural diferansiyel (1×,2×,3×,4×)
     • FrequencyManager / SampleManager / ADIM 8 / ADIM 9 entegrasyonları sağlam
   ═══════════════════════════════════════════════════════════════════════════ */
(function(){
  'use strict';

  /* ── Modül-Düzeyi Değişkenler ── */
  var _ctx=null, _master=null, _comp=null, _mainFilter=null, _masteringComp=null;
  var _satNode=null, _tremoloNode=null;
  var _eqLow=null, _eqMid=null, _eqHigh=null;
  var _oscs=[], _fmOscs=[], _harmLfos=[];  /* Aşama 7: FM + harmonic LFO arrays */
  var _noise=null, _noiseGain=null, _granular=null;
  var _playing=false, _startTime=0, _pauseOffset=0;
  var _loopDur=8, _curGen=null, _curBase=0, _curBeat=0;

  var _lfoOsc=null, _lfoGain=null, _lfoInvert=null;
  var _filterLfoOsc=null, _filterLfoGain=null;
  var _tremoloOsc=null,   _tremoloDepth=null;
  var _chaosTimer=null;
  var _arpTimer=null;     /* Aşama 7: Golden Ratio Arpeggiator handle */
  var _sampleManager=null;

  /* Aşama 7: Sabitler */
  var GOLDEN = 1.618034;
  var ARP_RATIOS = [1/1, 9/8, 5/4, 4/3, 3/2, 5/3, 15/8, 2/1]; /* Just Intonation paleti */

  /* Aşama 7: gen → SampleManager sahne adı haritası */
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

  /* ── Sahne Mikseri (Aşama 7: tones oranı artırıldı, SampleManager ambiyansı yüklenir) ── */
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
     MASTER BUS — v7.0
     Sinyal zinciri:
       kaynaklar → _mainFilter (Zarf: 350→1900 Hz | Q:4.0 | LFO kademeli)
                 → _masteringComp → _satNode (k=8, 4x)
                 → _tremoloNode (±20%) → _master → EQ → _comp → destination
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

    /* Ana Lowpass Filtresi — Q:4.0, merkez 1900 Hz
     * Başlangıç: 350 Hz (kapalı). startSound'da zarf ile 1900 Hz'e açılır.
     * LFO modülasyonu da kademeli başlar (0 → ±1300 Hz). */
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
     AŞAMA 7: SINGING BOWL FM SENTEZLEYİCİ
     ────────────────────────────────────────────────────────────────────────
     buildBowlVoice(ctx, freq, detuneCents, oscType, gainVal, destGain, attackSec)

     Her harmonik için üç katmanlı ses motoru:
       1. Carrier   : Temel frekans osilatörü (verilen tip: sine/triangle)
       2. FM Mod    : carrier×0.27 Hz'de modülatör → carrier.frequency'e bağlı
                      Metal kase / Singing Bowl'un "ring" karakteri buradan gelir.
                      FM depth = freq×0.010 → yüksek partiyeller daha parlak shimmer.
       3. Micro LFO : 0.1–0.5 Hz rastgele hız, ±%20 genlik salınımı
                      Her harmonik bağımsız nefes alır → ensemble/koro hissi.

     Sinyal zinciri: carrier → shimmer (LFO mod) → envNode (yavaş atak) → destGain
     ════════════════════════════════════════════════════════════════════════ */
  function buildBowlVoice(ctx, freq, detuneCents, oscType, gainVal, destGain, attackSec) {
    var now = ctx.currentTime;

    /* ── Carrier Osilatör ── */
    var carrier = ctx.createOscillator();
    carrier.type = oscType;
    carrier.frequency.value = freq;
    carrier.detune.value = detuneCents;

    /* ── FM Shimmer Modülatör ──────────────────────────────────────────────
     * carrier×0.27: alt harmonik ratio — metallophone / singing bowl karakteri.
     * Düşük oran → sıcak, "çınlayan" (ringing) metalik doku.
     * FM derinliği (depth) frekansla orantılı: tizde daha belirgin shimmer. */
    var fmMod = ctx.createOscillator();
    fmMod.type = 'sine';
    fmMod.frequency.value = freq * 0.27;

    var fmDepth = ctx.createGain();
    fmDepth.gain.value = Math.max(1.2, freq * 0.010);
    fmMod.connect(fmDepth);
    fmDepth.connect(carrier.frequency);   /* FM → carrier.frequency AudioParam */

    /* ── Micro-Gain LFO — her harmonik bağımsız ─────────────────────────
     * Rastgele 0.1–0.5 Hz: her voice'ın kendi nefes ritmi.
     * Ensemble etkisi: çok ses aynı anda değil, farklı fazlarda titreşir. */
    var lfoRate = 0.10 + Math.random() * 0.40;
    var lfo = ctx.createOscillator();
    lfo.type = 'sine';
    lfo.frequency.value = lfoRate;

    var lfoAmp = ctx.createGain();
    lfoAmp.gain.value = gainVal * 0.22;  /* ±%22 shimmer derinliği */
    lfo.connect(lfoAmp);

    /* Shimmer: gain=1.0 base + LFO sapma */
    var shimmer = ctx.createGain();
    shimmer.gain.value = 1.0;
    lfoAmp.connect(shimmer.gain);

    /* ── Enstrüman Zarfı — Yavaş Atak ───────────────────────────────────
     * Aşama 7: gainVal hedefe attackSec saniyede ulaşır.
     * attackSec = 4.0: yaylı çalgı / tahta kase gibi yavaşça dolgunlaşma.
     * Dijital "anında açılma" yerine organik, canlı bir giriş. */
    var envNode = ctx.createGain();
    envNode.gain.setValueAtTime(0.0001, now);
    envNode.gain.exponentialRampToValueAtTime(gainVal, now + attackSec);
    envNode.connect(destGain);

    /* Zincir: carrier → shimmer → envNode → destGain */
    carrier.connect(shimmer);
    shimmer.connect(envNode);

    carrier.start(now);
    fmMod.start(now);
    lfo.start(now);

    return { carrier: carrier, fmMod: fmMod, lfo: lfo };
  }

  /* ── Ses Buffer Üretici (Brownian Noise — Fallback) ── */
  function makeBuffer(ctx, type) {
    var sr  = ctx.sampleRate || 44100;
    var len = Math.round(sr * _loopDur);
    var buf = ctx.createBuffer(2, len, sr);
    for (var ch = 0; ch < 2; ch++) {
      var d = buf.getChannelData(ch);
      var p1=0, p2=0, p3=0, lastOut=0;
      for (var i = 0; i < len; i++) {
        var v = 0;
        var white = Math.random() * 2 - 1;
        lastOut = (lastOut + 0.02 * white) / 1.02;
        if (type === 'waves') {
          p1 += (2*Math.PI*0.08)/sr; p2 += (2*Math.PI*0.19)/sr; p3 += (2*Math.PI*0.04)/sr;
          var sw = Math.sin(p3)*0.4+0.6;
          v = Math.sin(p1)*0.18*sw + Math.sin(p2)*0.09*sw + lastOut*0.12*sw;
        } else if (type === 'rain') {
          p1 += (2*Math.PI*0.6)/sr;
          v = lastOut*0.45 + (Math.random()<0.003?(Math.random()*2-1)*0.6:0);
          v *= (0.7+Math.sin(p1)*0.3);
        } else if (type === 'wind') {
          p1 += (2*Math.PI*0.12)/sr; p2 += (2*Math.PI*0.05)/sr;
          v = lastOut*0.7*Math.max(0, 0.5+Math.sin(p2)*0.4+Math.sin(p1*0.3)*0.1);
        } else if (type === 'fire') {
          p1 += (2*Math.PI*2.5)/sr; p2 += (2*Math.PI*0.07)/sr;
          v = lastOut*0.5*(0.6+Math.sin(p2)*0.4)+Math.sin(p1)*0.04
            +(Math.random()<0.008?(Math.random()*2-1)*0.5:0);
        } else if (type === 'storm') {
          p1 += (2*Math.PI*0.25)/sr; p2 += (2*Math.PI*0.04)/sr;
          v = lastOut*0.85*(0.6+Math.sin(p1)*0.4)+Math.sin(p2)*0.03;
        } else {
          v = lastOut * 0.25;
        }
        d[i] = isFinite(v) ? Math.max(-1, Math.min(1, v)) : 0;
      }
    }
    return buf;
  }

  /* ════════════════════════════════════════════════════════════════════════
     MODÜLASYON SİSTEMİ — v7.0
     ────────────────────────────────────────────────────────────────────────
     startModulation(ctx):
       1. Filter LFO (0.05 Hz) — gain kademeli: 0 → ±1300 Hz (5.5 sn)
          Filtre zarfıyla eşzamanlı açılır. Q:4.0 vokal rezonans.
       2. Tremolo LFO (0.08 Hz, ±0.20) — %20 fiziksel nabız
       3. Chaos Engine (3–6 sn, ±4 cent) — analog drift

     Aşama 7 farkı: Filter LFO derinliği "0 → 1300" rampi ile başlar.
       Bu, filtre zarfıyla birlikte organik bir "açılım" yaratır:
       ses hem frekans aralığını hem de LFO derinliğini eş zamanlı genişletir.
     ════════════════════════════════════════════════════════════════════════ */
  function startModulation(ctx) {
    stopModulation();
    var now = ctx.currentTime;

    /* 1. Filter LFO — Kademeli açılım (filtre zarfıyla senkron) */
    _filterLfoOsc = ctx.createOscillator();
    _filterLfoOsc.type = 'sine';
    _filterLfoOsc.frequency.value = 0.05;

    _filterLfoGain = ctx.createGain();
    /* Aşama 7: LFO derinliği 0'dan başlar, 5.5 sn'de 1300 Hz'e yükselir */
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
     AŞAMA 7: GOLDEN RATIO ARPEGGİATOR
     ────────────────────────────────────────────────────────────────────────
     Her 8–12 saniyede bir, osilatörlerin frekanslarını Just Intonation serisi
     içinde bir sonraki adıma (altın oran ağırlıklı) 3–4.5 sn glide ile kaydırır.

     Neden etkili?
     - Beyin aynı frekansı sabit kalınca "kayıt" olarak tanır → fark etmez.
     - Minik nota değişimleri → beyin "yeni olay" olarak kodlar → dikkat taze kalır.
     - Just Intonation: armoni bozulmaz (oranlar doğal rezonans serisi).
     - Golden Ratio adım ilerlemesi: büyüsel/matematiksel uyum, tahmin edilemez sıra.

     Yöntem: tüm _oscs'ları aynı oran×değişim ile ölçekler → binaural yapısı korunur.
     ════════════════════════════════════════════════════════════════════════ */
  function startArpeggiator(ctx) {
    stopArpeggiator();
    if (!_curBase || !_oscs.length) return;

    var phiAccum = 0; /* Golden Ratio birikimine dayalı adım */

    function scheduleNextArp() {
      var delay = 8000 + Math.random() * 4000; /* 8–12 sn */
      _arpTimer = setTimeout(function() {
        if (!_playing || !_oscs.length) { scheduleNextArp(); return; }

        /* Golden Ratio tabanlı adım ilerlemesi */
        phiAccum = (phiAccum + GOLDEN) % ARP_RATIOS.length;
        var stepIdx = Math.floor(phiAccum) % ARP_RATIOS.length;
        var ratio   = ARP_RATIOS[stepIdx];

        /* Mikro-drift: φ'nin ondalık kısmı küçük bir sapma ekler (±%1.8) */
        var phiFrac  = phiAccum - Math.floor(phiAccum);
        var microDrift = 1.0 + (phiFrac - 0.5) * 0.036;
        var targetBase = _curBase * ratio * microDrift;
        targetBase = Math.max(20, Math.min(1200, targetBase));

        /* Oran değişimi — tüm oscs orantılı kayar (binaural korunur) */
        var ratioChange = targetBase / _curBase;
        var glide = 3.0 + Math.random() * 1.5; /* 3–4.5 sn yumuşak glide */
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

  function stopOscs() {
    /* Carrier oscillators */
    _oscs.forEach(function(o){ try{o.stop();o.disconnect();}catch(e){} });
    _oscs = [];
    /* FM modulator oscillators */
    _fmOscs.forEach(function(o){ try{o.stop();o.disconnect();}catch(e){} });
    _fmOscs = [];
    /* Harmonic micro-gain LFOs */
    _harmLfos.forEach(function(o){ try{o.stop();o.disconnect();}catch(e){} });
    _harmLfos = [];
    stopArpeggiator();
    stopLFO();
  }

  function stopNoise() {
    if (_noiseGain) { try{_noiseGain.disconnect();}catch(e){} _noiseGain=null; }
    if (_noise)     { try{_noise.stop();_noise.disconnect();}catch(e){} _noise=null; }
    if (_granular)  { try{_granular.stop();}catch(e){} _granular=null; }
  }

  /* ════════════════════════════════════════════════════════════════════════
     SES BAŞLAT — startSound(gen, base, beat, offset)
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

    /* ── Aşama 7: Enstrüman Filtre Zarfı ──────────────────────────────────
     * Filtre 350 Hz'den başlar, 5 sn'de 1900 Hz'e açılır.
     * Yaylı çalgı / tahta kase'nin "yavaş dolgunlaşma" karakterini verir.
     * LFO'nun derinliği de aynı sürede 0→1300 Hz'e yükselir (startModulation'da).
     * İki açılım eş zamanlı: ses hem genişler hem canlanır. */
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
    var BOWL_ATTACK = 4.0; /* Aşama 7: Enstrüman atağı — 4 saniye */

    /* ══ Binaural + Singing Bowl Osilatörler ═══════════════════════════════
     *
     * v7.0: Her harmonik artık buildBowlVoice() ile oluşturuluyor.
     * Standart sinüs yerine: Carrier + FM (×0.27) + Micro-LFO → tam enstrüman karakteri.
     * Harmonik binaural diferansiyel (N×beat) korundu — v6.1 mirası. */
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

      /* Envelope gains — Singing Bowl atağı bu envelope ile ölçeklenir */
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

      /* ── v7.0: 4 Katmanlı Harmonik Binaural × Singing Bowl FM ──────────
       * Her harmonik buildBowlVoice() ile oluşturuluyor:
       *   1. Carrier (sine/triangle) + FM shimmer + Micro-gain LFO
       *   2. N×beat binaural diferansiyel korunuyor
       *   3. ±8 cent koro detune korunuyor (v6.1)
       *   4. Yavaş enstrüman atağı: BOWL_ATTACK=4sn */
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
        var detuneL = (Math.random() - 0.5) * 16.0; /* [-8, +8] cent */
        var detuneR = (Math.random() - 0.5) * 16.0;

        /* Sol kanal — Singing Bowl voice */
        var vL = buildBowlVoice(ctx, freqL, detuneL, h.type, h.gainVal, envGainL, BOWL_ATTACK);
        _oscs.push(vL.carrier);
        _fmOscs.push(vL.fmMod);
        _harmLfos.push(vL.lfo);

        /* Sağ kanal — binaural diferansiyel freqR ile */
        var vR = buildBowlVoice(ctx, freqR, detuneR, h.type, h.gainVal, envGainR, BOWL_ATTACK);
        _oscs.push(vR.carrier);
        _fmOscs.push(vR.fmMod);
        _harmLfos.push(vR.lfo);
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

    /* ── Modülasyon + Arpeggiator — Gecikmeli başlatma ───────────────────
     * 300ms: LFO derinliği 0'dan başladığı için ani sıçrama yok.
     * Arpeggiator 800ms sonra: osilatörler tam çalışıyor olsun. */
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
     switchSound — v7.0: SampleManager.applyScene() otomatik çağrısı
     ────────────────────────────────────────────────────────────────────────
     Aşama 7 değişikliği:
       gen adı → GEN_TO_SCENE haritasıyla sahne adına dönüştürülür.
       SampleManager her zaman oluşturulur ve applyScene() çağrılır.
       msd varsa sceneName öncelikli; yoksa GEN_TO_SCENE kullanılır.
       SampleManager volume: 0.65 (%65 mikste — doğa öne çıkıyor).
     ════════════════════════════════════════════════════════════════════════ */
  window.switchSound = function(gen, base, beat, label, msd) {
    try{ localStorage.setItem('lastGen',gen); localStorage.setItem('lastBase',base); localStorage.setItem('lastBeat',beat); }catch(e){}
    if (window._prefVector) try{ window._prefVector.recordSoundChoice(gen, base, beat); }catch(e){}
    _pauseOffset = 0;
    if (_playing) startSound(gen, base, beat, 0);

    /* Aşama 7: SampleManager her zaman aktive edilir */
    if (typeof window.SampleManager !== 'undefined') {
      var ctx = getCtx();
      ensureMaster(ctx);
      if (!_sampleManager) {
        _sampleManager = new window.SampleManager(ctx, _master, {
          basePath : 'audio/',
          volume   : 0.65, /* Aşama 7: %30 → %65 — doğa sesleri ön plana */
        });
      }
      /* msd.sceneName öncelikli; yoksa gen→scene haritası */
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
