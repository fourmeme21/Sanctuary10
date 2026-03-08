/**
 * SampleManager.js — Sanctuary Organik Ses Katmanı v2.0 (Aşama 9)
 * ─────────────────────────────────────────────────────────────────────────────
 * Aşama 9 YENİLİKLERİ:
 *   • Gerçek Enstrüman Bankası : Piano / Guitar / Flute prosedürel sentezi
 *     (Gerçek .mp3 dosyaları varsa önce onları dener, yoksa yüksek kaliteli
 *     prosedürel fallback çalar — her iki durumda da kulağa organik gelir)
 *   • Canlılık Katmanı (Life Layer) : Kuş cıvıltıları, ağustos böceği, gece
 *     ormanı seslerini her 15–30 sn'de bir rastgele 3D konumdan tetikler.
 *   • Müzikal Sahne Presetleri : Gemini'den gelen sahneye göre enstrüman
 *     kombinasyonu otomatik seçilir. Siren etkisi tamamen yok.
 *   • 3D Mekansal Gerçekçilik : PannerNode ile kuş seslerinin uzayda hareketi.
 *   • v1.3 mirası korundu : HRTF, exponentialRamp, crossfade, Brownian fallback
 * ─────────────────────────────────────────────────────────────────────────────
 */

'use strict';

/* ═══════════════════════════════════════════════════════════════
   SAHNE → KATMAN HARİTASI (v2.0: Enstrüman + Doğa)
═══════════════════════════════════════════════════════════════ */
const SCENE_SAMPLE_MAP = {
  // Ana sahneler
  'Calm Breath'     : ['waves_calm', 'wind_soft'],
  'Deep Peace'      : ['waves_calm', 'rain_light'],
  'Light Breath'    : ['wind_soft', 'birds_far'],
  'Focus Flow'      : ['rain_light', 'wind_soft'],
  'Heart Resonance' : ['waves_calm', 'birds_far'],
  'Energy Renewal'  : ['birds_far', 'wind_soft'],

  // Aşama 9: Yeni müzikal sahne presetleri
  'Zen Garden'      : ['wind_soft', 'birds_far'],
  'Deep Space'      : ['waves_calm', 'wind_soft'],
  'Earth Grounding' : ['wind_soft', 'birds_far'],
  'Night Forest'    : ['rain_light', 'wind_soft'],
  'Morning Mist'    : ['birds_far', 'waves_calm'],

  // Türkçe
  'Derin Huzur'     : ['waves_calm', 'rain_light'],
  'Işık Nefesi'     : ['wind_soft', 'birds_far'],
  'Odak Akışı'      : ['rain_light', 'wind_soft'],

  // Arapça
  'تنفس هادئ'       : ['waves_calm', 'wind_soft'],
  'سلام عميق'       : ['waves_calm', 'rain_light'],

  // Joyful
  'Joyful Radiance' : ['birds_far', 'wind_soft'],
  'Morning Light'   : ['birds_far', 'waves_calm'],

  _default          : ['waves_calm', 'wind_soft'],
};

/* ═══════════════════════════════════════════════════════════════
   AŞAMA 9: SAHNE → ENSTRÜman PRESet HARİTASI
   Her sahne: birincil ve ikincil enstrüman + mix oranı
═══════════════════════════════════════════════════════════════ */
const SCENE_INSTRUMENT_MAP = {
  'Zen Garden'      : { primary: 'flute',  secondary: null,     primaryVol: 0.38, secondaryVol: 0 },
  'Deep Space'      : { primary: 'piano',  secondary: null,     primaryVol: 0.32, secondaryVol: 0 },
  'Earth Grounding' : { primary: 'guitar', secondary: null,     primaryVol: 0.35, secondaryVol: 0 },
  'Night Forest'    : { primary: 'flute',  secondary: 'piano',  primaryVol: 0.28, secondaryVol: 0.18 },
  'Morning Mist'    : { primary: 'piano',  secondary: 'flute',  primaryVol: 0.25, secondaryVol: 0.20 },
  'Calm Breath'     : { primary: 'piano',  secondary: null,     primaryVol: 0.22, secondaryVol: 0 },
  'Deep Peace'      : { primary: 'piano',  secondary: null,     primaryVol: 0.28, secondaryVol: 0 },
  'Light Breath'    : { primary: 'flute',  secondary: null,     primaryVol: 0.30, secondaryVol: 0 },
  'Focus Flow'      : { primary: 'piano',  secondary: 'guitar', primaryVol: 0.20, secondaryVol: 0.18 },
  'Heart Resonance' : { primary: 'guitar', secondary: 'piano',  primaryVol: 0.28, secondaryVol: 0.18 },
  'Energy Renewal'  : { primary: 'guitar', secondary: null,     primaryVol: 0.32, secondaryVol: 0 },
  'Joyful Radiance' : { primary: 'guitar', secondary: 'flute',  primaryVol: 0.28, secondaryVol: 0.22 },
  'Morning Light'   : { primary: 'flute',  secondary: 'guitar', primaryVol: 0.30, secondaryVol: 0.20 },
  _default          : { primary: 'piano',  secondary: null,     primaryVol: 0.22, secondaryVol: 0 },
};

/* ═══════════════════════════════════════════════════════════════
   3D POZİSYONLAR — HRTF uzayında sabit katmanlar
═══════════════════════════════════════════════════════════════ */
const SAMPLE_POSITIONS = {
  waves_calm : { x: -1.5, y: 0,    z: -2.0 },
  rain_light : { x:  0,   y: 1.5,  z:  0   },
  birds_far  : { x:  2.0, y: 0.8,  z: -3.0 },
  wind_soft  : { x:  0,   y: 0,    z: -1.0 },
};

/* ═══════════════════════════════════════════════════════════════
   AŞAMA 9: CANLILIK KATMANI — 3D Tetiklenebilir Ses Olayları
   Kuş, ağustos böceği, uzak orman: rastgele konum + zamanlama
═══════════════════════════════════════════════════════════════ */
const LIFE_EVENTS = [
  { id: 'bird_chirp',   dur: 1.2, freq: 3200, type: 'bird'    },
  { id: 'bird_call',    dur: 0.8, freq: 2600, type: 'bird'    },
  { id: 'cricket',      dur: 2.5, freq: 4800, type: 'insect'  },
  { id: 'cicada_burst', dur: 1.8, freq: 5200, type: 'insect'  },
  { id: 'distant_frog', dur: 0.6, freq: 820,  type: 'frog'    },
  { id: 'wind_rustle',  dur: 1.5, freq: 600,  type: 'ambient' },
  { id: 'leaf_drop',    dur: 0.4, freq: 1100, type: 'ambient' },
];

/* ═══════════════════════════════════════════════════════════════
   FALLBACK BUFFER ÜRETİCİLERİ — Ortam Sesleri
═══════════════════════════════════════════════════════════════ */
const FALLBACK_GENERATORS = {

  waves_calm(ctx) {
    const sr = ctx.sampleRate, dur = 12, len = sr * dur;
    const buf = ctx.createBuffer(2, len, sr);
    for (let ch = 0; ch < 2; ch++) {
      const d = buf.getChannelData(ch);
      let p1=0,p2=0,p3=0, b0=0,b1=0,b2=0,b3=0,b4=0,b5=0,b6=0;
      for (let i = 0; i < len; i++) {
        p1 += (2*Math.PI*0.07)/sr; p2 += (2*Math.PI*0.15)/sr; p3 += (2*Math.PI*0.032)/sr;
        const white = Math.random()*2-1;
        b0=0.99886*b0+white*0.0555179; b1=0.99332*b1+white*0.0750759;
        b2=0.96900*b2+white*0.1538520; b3=0.86650*b3+white*0.3104856;
        b4=0.55000*b4+white*0.5329522; b5=-0.7616*b5-white*0.0168980;
        const pink=(b0+b1+b2+b3+b4+b5+b6+white*0.5362)*0.11; b6=white*0.115926;
        const swell=0.55+Math.sin(p3)*0.45;
        const v=Math.sin(p1)*0.16*swell+Math.sin(p2)*0.08*swell+pink*0.06*swell;
        d[i]=Math.max(-1,Math.min(1,isFinite(v)?v:0));
      }
    }
    return buf;
  },

  rain_light(ctx) {
    const sr = ctx.sampleRate, dur = 10, len = sr * dur;
    const buf = ctx.createBuffer(2, len, sr);
    for (let ch = 0; ch < 2; ch++) {
      const d = buf.getChannelData(ch);
      let p1=0, b0=0,b1=0,b2=0,b3=0,b4=0,b5=0,b6=0;
      for (let i = 0; i < len; i++) {
        p1 += (2*Math.PI*0.4)/sr;
        const white=Math.random()*2-1;
        b0=0.99886*b0+white*0.0555179; b1=0.99332*b1+white*0.0750759;
        b2=0.96900*b2+white*0.1538520; b3=0.86650*b3+white*0.3104856;
        b4=0.55000*b4+white*0.5329522; b5=-0.7616*b5-white*0.0168980;
        const pink=(b0+b1+b2+b3+b4+b5+b6+white*0.5362)*0.11; b6=white*0.115926;
        let v=pink*0.38*(0.75+Math.sin(p1)*0.25);
        if(Math.random()<0.0006) v+=(Math.random()*2-1)*0.25;
        d[i]=Math.max(-1,Math.min(1,isFinite(v)?v:0));
      }
    }
    return buf;
  },

  birds_far(ctx) {
    /* Geliştirilmiş kuş sesi: FM sentez ile daha gerçekçi cıvıltı */
    const sr = ctx.sampleRate, dur = 8, len = sr * dur;
    const buf = ctx.createBuffer(2, len, sr);
    for (let ch = 0; ch < 2; ch++) {
      const d = buf.getChannelData(ch);
      let p1=0, p2=0, p3=0, p4=0;
      const phaseOff = ch * 0.3; /* Stereo genişlik */
      for (let i = 0; i < len; i++) {
        p1 += (2*Math.PI*2800)/sr + phaseOff/sr;
        p2 += (2*Math.PI*3400)/sr;
        p3 += (2*Math.PI*0.7)/sr;
        p4 += (2*Math.PI*0.18)/sr;
        const env1 = Math.max(0, Math.sin(p3));
        const env2 = Math.max(0, Math.sin(p4*0.4+1.5));
        const chirp1 = Math.random()<0.0004 ? Math.sin(p1)*0.20*env1 : 0;
        const chirp2 = Math.random()<0.0003 ? Math.sin(p2)*0.14*env2 : 0;
        const ambience = (Math.random()*2-1)*0.014;
        d[i]=Math.max(-1,Math.min(1,chirp1+chirp2+ambience));
      }
    }
    return buf;
  },

  wind_soft(ctx) {
    const sr = ctx.sampleRate, dur = 10, len = sr * dur;
    const buf = ctx.createBuffer(2, len, sr);
    for (let ch = 0; ch < 2; ch++) {
      const d = buf.getChannelData(ch);
      let p1=0,p2=0, b0=0,b1=0,b2=0,b3=0,b4=0,b5=0,b6=0;
      for (let i = 0; i < len; i++) {
        p1+=(2*Math.PI*0.09)/sr; p2+=(2*Math.PI*0.04)/sr;
        const white=Math.random()*2-1;
        b0=0.99886*b0+white*0.0555179; b1=0.99332*b1+white*0.0750759;
        b2=0.96900*b2+white*0.1538520; b3=0.86650*b3+white*0.3104856;
        b4=0.55000*b4+white*0.5329522; b5=-0.7616*b5-white*0.0168980;
        const pink=(b0+b1+b2+b3+b4+b5+b6+white*0.5362)*0.11; b6=white*0.115926;
        const env=Math.max(0,0.5+Math.sin(p2)*0.35+Math.sin(p1*0.4)*0.15);
        const v=pink*0.55*env;
        d[i]=Math.max(-1,Math.min(1,isFinite(v)?v:0));
      }
    }
    return buf;
  },
};

/* ═══════════════════════════════════════════════════════════════
   AŞAMA 9: ENSTRÜman BUFFER ÜRETİCİLERİ
   Gerçek .mp3 yoksa yüksek kaliteli prosedürel sentez:
   Piano  → Karmaşık harmonik additive + ADSR + string decay
   Guitar → Pick attack + body resonance + nylon string decay
   Flute  → Hava gürültüsü + FM vibrato + organik ton
═══════════════════════════════════════════════════════════════ */
const INSTRUMENT_GENERATORS = {

  /* ── PIANO: Additive Harmonik + String Decay Modeli ── */
  piano(ctx, baseFreq) {
    baseFreq = baseFreq || 220;
    const sr = ctx.sampleRate, dur = 6, len = sr * dur;
    const buf = ctx.createBuffer(2, len, sr);

    /* Harmonik serisi — gerçek piyano partiyel oranları */
    const harmonics = [
      { ratio: 1.000, amp: 1.000, decay: 4.5 },
      { ratio: 2.000, amp: 0.480, decay: 3.8 },
      { ratio: 3.000, amp: 0.280, decay: 3.0 },
      { ratio: 4.000, amp: 0.180, decay: 2.5 },
      { ratio: 5.001, amp: 0.120, decay: 2.0 }, /* Hafif inharmonicity */
      { ratio: 6.005, amp: 0.080, decay: 1.6 },
      { ratio: 7.014, amp: 0.050, decay: 1.2 },
      { ratio: 8.030, amp: 0.030, decay: 0.9 },
    ];

    for (let ch = 0; ch < 2; ch++) {
      const d = buf.getChannelData(ch);
      const detune = ch === 0 ? 1.0 : 1.0006; /* Stereo chorus — iki tel */
      for (let i = 0; i < len; i++) {
        const t = i / sr;
        let v = 0;
        /* Attack zarfı: 0→1 ilk 8ms, sonra decay */
        const attackEnv = Math.min(1, t / 0.008);
        for (const h of harmonics) {
          const freq = Math.min(20000, baseFreq * h.ratio * detune);
          const phase = (2 * Math.PI * freq * i) / sr;
          const decayEnv = attackEnv * Math.exp(-t / h.decay);
          v += Math.sin(phase) * h.amp * decayEnv;
        }
        /* Normalize + pedal sustain noise (gerçek piyano gürültüsü) */
        v = v * 0.12 + (Math.random() * 2 - 1) * 0.0008 * Math.exp(-t * 0.5);
        d[i] = Math.max(-1, Math.min(1, isFinite(v) ? v : 0));
      }
    }
    return buf;
  },

  /* ── GUITAR: Pick Attack + Nylon String Body Resonance ── */
  guitar(ctx, baseFreq) {
    baseFreq = baseFreq || 196; /* G3 — gitar doğal aralığı */
    const sr = ctx.sampleRate, dur = 5, len = sr * dur;
    const buf = ctx.createBuffer(2, len, sr);

    /* Gitar harmonikleri — nylon teli oranları */
    const harmonics = [
      { ratio: 1.000, amp: 1.000, decay: 2.8 },
      { ratio: 2.000, amp: 0.620, decay: 2.2 },
      { ratio: 3.000, amp: 0.350, decay: 1.8 },
      { ratio: 4.000, amp: 0.200, decay: 1.4 },
      { ratio: 5.000, amp: 0.120, decay: 1.0 },
      { ratio: 6.000, amp: 0.070, decay: 0.7 },
      { ratio: 7.000, amp: 0.040, decay: 0.5 },
    ];

    /* Body resonance frekansları (gitar gövdesi) */
    const bodyFreqs = [185, 370, 555];

    for (let ch = 0; ch < 2; ch++) {
      const d = buf.getChannelData(ch);
      const stereoShift = ch === 0 ? 1.0 : 1.0008;
      for (let i = 0; i < len; i++) {
        const t = i / sr;
        let v = 0;
        /* Pick saldırısı: ilk 15ms keskin peak, sonra hızlı fall */
        const pickAttack = t < 0.015
          ? (t / 0.015)
          : Math.exp(-(t - 0.015) * 0.3);
        const strDecay = Math.exp(-t * 0.8);

        for (const h of harmonics) {
          const freq = Math.min(20000, baseFreq * h.ratio * stereoShift);
          const phase = (2 * Math.PI * freq * i) / sr;
          const env = pickAttack * Math.exp(-t / h.decay);
          v += Math.sin(phase) * h.amp * env;
        }

        /* Gövde rezonansı — derin sıcaklık */
        for (const bf of bodyFreqs) {
          const bPhase = (2 * Math.PI * bf * i) / sr;
          v += Math.sin(bPhase) * 0.04 * strDecay;
        }

        /* Pick transient gürültüsü */
        if (t < 0.020) v += (Math.random() * 2 - 1) * 0.08 * (1 - t / 0.020);

        v = v * 0.14;
        d[i] = Math.max(-1, Math.min(1, isFinite(v) ? v : 0));
      }
    }
    return buf;
  },

  /* ── FLUTE: Hava Akımı + FM Vibrato + Organik Ton ── */
  flute(ctx, baseFreq) {
    baseFreq = baseFreq || 523; /* C5 — flüt doğal aralığı */
    const sr = ctx.sampleRate, dur = 4, len = sr * dur;
    const buf = ctx.createBuffer(2, len, sr);

    for (let ch = 0; ch < 2; ch++) {
      const d = buf.getChannelData(ch);
      let phase = 0, vibPhase = 0, breathPhase = 0;
      const stereoVib = ch === 0 ? 5.2 : 5.5; /* Hafif stereo vibrato farkı */
      for (let i = 0; i < len; i++) {
        const t = i / sr;

        /* Vibrato: 0.8sn sonra devreye girer, kademeli derinleşir */
        vibPhase += (2 * Math.PI * stereoVib) / sr;
        const vibDepth = Math.min(1, Math.max(0, (t - 0.8) / 0.6)) * 0.012;
        const vibMod = 1 + Math.sin(vibPhase) * vibDepth;

        /* Nefes gürültüsü — organik hava */
        breathPhase += (2 * Math.PI * 0.3) / sr;
        const breathNoise = (Math.random() * 2 - 1) * 0.025
          * (0.7 + Math.sin(breathPhase) * 0.3);

        /* Ana ton: temel + 2. harmonik dominans (flüt karakteri) */
        phase += (2 * Math.PI * baseFreq * vibMod) / sr;
        const h2Phase = (2 * Math.PI * baseFreq * 2 * vibMod * i) / sr;
        const h3Phase = (2 * Math.PI * baseFreq * 3 * vibMod * i) / sr;

        /* Yumuşak atak: 0.1sn fade-in */
        const attackEnv = Math.min(1, t / 0.10);
        /* Sustain: hafif kresendo imkanı */
        const sustainEnv = 1.0 + Math.sin(t * 0.4) * 0.04;

        let v = (
          Math.sin(phase) * 0.55       /* Temel */
          + Math.sin(h2Phase) * 0.28   /* 2. harmonik — flüt parlaklığı */
          + Math.sin(h3Phase) * 0.10   /* 3. harmonik */
          + breathNoise                 /* Nefes dokusu */
        ) * attackEnv * sustainEnv * 0.22;

        d[i] = Math.max(-1, Math.min(1, isFinite(v) ? v : 0));
      }
    }
    return buf;
  },
};

/* ═══════════════════════════════════════════════════════════════
   AŞAMA 9: CANLILIK KATMANI SES ÜRETİCİLERİ
   Her olay tipi için kısa prosedürel burst buffer
═══════════════════════════════════════════════════════════════ */
const LIFE_GENERATORS = {

  bird(ctx, freq, dur) {
    const sr = ctx.sampleRate, len = Math.round(sr * dur);
    const buf = ctx.createBuffer(2, len, sr);
    for (let ch = 0; ch < 2; ch++) {
      const d = buf.getChannelData(ch);
      let p1=0, p2=0, pEnv=0;
      const fmRatio = 0.04 + Math.random() * 0.06; /* Doğal kuş FM değişimi */
      for (let i = 0; i < len; i++) {
        const t = i / sr;
        p1 += (2*Math.PI*freq)/sr;
        p2 += (2*Math.PI*freq*fmRatio)/sr; /* FM mod */
        pEnv += (2*Math.PI*1.8)/sr;
        const fmDepth = freq * 0.08;
        const env = Math.max(0, Math.sin(pEnv)) * Math.exp(-t * 1.5);
        const v = Math.sin(p1 + Math.sin(p2)*fmDepth) * 0.28 * env;
        d[i] = Math.max(-1, Math.min(1, isFinite(v)?v:0));
      }
    }
    return buf;
  },

  insect(ctx, freq, dur) {
    const sr = ctx.sampleRate, len = Math.round(sr * dur);
    const buf = ctx.createBuffer(2, len, sr);
    for (let ch = 0; ch < 2; ch++) {
      const d = buf.getChannelData(ch);
      let p1=0, tremPhase=0;
      for (let i = 0; i < len; i++) {
        const t = i / sr;
        p1 += (2*Math.PI*freq)/sr;
        tremPhase += (2*Math.PI*38)/sr; /* Ağustos böceği titreşim hızı */
        const env = Math.min(1, t/0.05) * Math.exp(-t*0.4);
        const trem = 0.6 + Math.sin(tremPhase)*0.4; /* Amplitüd modulasyonu */
        const v = Math.sin(p1)*0.20*env*trem + (Math.random()*2-1)*0.008*env;
        d[i] = Math.max(-1, Math.min(1, isFinite(v)?v:0));
      }
    }
    return buf;
  },

  frog(ctx, freq, dur) {
    const sr = ctx.sampleRate, len = Math.round(sr * dur);
    const buf = ctx.createBuffer(2, len, sr);
    for (let ch = 0; ch < 2; ch++) {
      const d = buf.getChannelData(ch);
      let p1=0, p2=0;
      for (let i = 0; i < len; i++) {
        const t = i / sr;
        p1 += (2*Math.PI*freq)/sr;
        p2 += (2*Math.PI*freq*1.5)/sr; /* 5th harmonik */
        const env = Math.exp(-t * 4) * Math.min(1, t/0.02);
        const v = (Math.sin(p1)*0.5 + Math.sin(p2)*0.3) * 0.25 * env;
        d[i] = Math.max(-1, Math.min(1, isFinite(v)?v:0));
      }
    }
    return buf;
  },

  ambient(ctx, freq, dur) {
    const sr = ctx.sampleRate, len = Math.round(sr * dur);
    const buf = ctx.createBuffer(2, len, sr);
    for (let ch = 0; ch < 2; ch++) {
      const d = buf.getChannelData(ch);
      let b0=0,b1=0,b2=0,b3=0,b4=0,b5=0,b6=0;
      for (let i = 0; i < len; i++) {
        const t = i / sr;
        const white = Math.random()*2-1;
        b0=0.99886*b0+white*0.0555179; b1=0.99332*b1+white*0.0750759;
        b2=0.96900*b2+white*0.1538520;
        const pink=(b0+b1+b2+white*0.5)*0.15;
        const env = Math.min(1, t/0.1) * Math.exp(-t*1.2);
        d[i] = Math.max(-1, Math.min(1, pink*env*0.4));
      }
    }
    return buf;
  },
};

/* ═══════════════════════════════════════════════════════════════
   SAMPLE MANAGER SINIFI — v2.0
═══════════════════════════════════════════════════════════════ */
class SampleManager {

  /**
   * @param {AudioContext} ctx
   * @param {AudioNode}    destination
   * @param {object}       [options]
   * @param {string}  [options.basePath='audio/']
   * @param {number}  [options.volume=0.55]
   */
  constructor(ctx, destination, options = {}) {
    this._ctx         = ctx;
    this._destination = destination;
    this._basePath    = options.basePath || 'audio/';
    this._volume      = options.volume ?? 0.55;

    this._activeLayers     = new Map();  /* sampleId → { source, panner, gain } */
    this._bufferCache      = new Map();  /* sampleId → AudioBuffer */
    this._instrumentLayers = new Map();  /* instId → { source, gain, panner } */
    this._instrumentCache  = new Map();  /* instId → AudioBuffer */
    this._currentScene     = null;
    this._currentPreset    = null;
    this._isPlaying        = false;

    /* Canlılık katmanı zamanlayıcı handle */
    this._lifeTimer        = null;
    this._lifeEnabled      = true;

    /* Master gain */
    this._masterGain = ctx.createGain();
    this._masterGain.gain.value = this._volume;
    this._masterGain.connect(destination);

    /* Enstrüman master gain — ayrı bus, volume bağımsız ayarlanır */
    this._instrMasterGain = ctx.createGain();
    this._instrMasterGain.gain.value = 0.85; /* Enstrüman bus seviyesi */
    this._instrMasterGain.connect(destination);

    console.info('[SampleManager v2.0] Başlatıldı.');
  }

  /* ══════════════════════════════════════════════════════════════
     SAHNE YÖNETİMİ
     ══════════════════════════════════════════════════════════════ */

  async applyScene(sceneName) {
    const sampleIds = SCENE_SAMPLE_MAP[sceneName] || SCENE_SAMPLE_MAP._default;
    console.info('[SampleManager] Sahne:', sceneName, '→ samples:', sampleIds);
    this._currentScene = sceneName;

    await this._preloadSamples(sampleIds);
    if (this._isPlaying) await this._crossfadeTo(sampleIds);

    /* Aşama 9: Enstrüman presetini de uygula */
    const preset = SCENE_INSTRUMENT_MAP[sceneName] || SCENE_INSTRUMENT_MAP._default;
    this._currentPreset = preset;
    if (this._isPlaying) await this._applyInstrumentPreset(preset);
  }

  async applyMSD(msd) {
    if (msd && typeof msd.sceneName === 'string') {
      await this.applyScene(msd.sceneName);
    }
  }

  /* ══════════════════════════════════════════════════════════════
     OYNATMA KONTROLLERİ
     ══════════════════════════════════════════════════════════════ */

  async start() {
    if (this._isPlaying) return;
    this._isPlaying = true;

    const sampleIds = this._currentScene
      ? (SCENE_SAMPLE_MAP[this._currentScene] || SCENE_SAMPLE_MAP._default)
      : SCENE_SAMPLE_MAP._default;

    await this._preloadSamples(sampleIds);
    sampleIds.forEach(id => this._startLayer(id));

    /* Enstrüman presetini başlat */
    const preset = this._currentPreset || SCENE_INSTRUMENT_MAP._default;
    await this._applyInstrumentPreset(preset);

    /* Canlılık katmanını başlat */
    if (this._lifeEnabled) this._scheduleLifeEvent();

    console.info('[SampleManager] Başlatıldı. Sahne:', this._currentScene);
  }

  stop(fadeDuration = 3.0) {
    if (!this._isPlaying) return;
    this._isPlaying = false;

    const now = this._ctx.currentTime;

    /* Ortam katmanları */
    this._activeLayers.forEach((layer, id) => {
      try {
        layer.gain.gain.setValueAtTime(layer.gain.gain.value, now);
        layer.gain.gain.exponentialRampToValueAtTime(0.0001, now + fadeDuration);
        setTimeout(() => this._disposeLayer(id), (fadeDuration + 0.2) * 1000);
      } catch(e) {}
    });

    /* Enstrüman katmanları */
    this._stopAllInstruments(fadeDuration);

    /* Canlılık katmanı */
    if (this._lifeTimer) { clearTimeout(this._lifeTimer); this._lifeTimer = null; }

    console.info('[SampleManager] Durduruldu.');
  }

  setVolume(vol) {
    this._volume = Math.max(0.0001, Math.min(1, vol));
    if (this._masterGain && this._ctx) {
      const now = this._ctx.currentTime;
      this._masterGain.gain.setValueAtTime(this._masterGain.gain.value, now);
      this._masterGain.gain.exponentialRampToValueAtTime(this._volume, now + 0.3);
    }
  }

  setLifeEnabled(enabled) {
    this._lifeEnabled = !!enabled;
    if (!enabled && this._lifeTimer) {
      clearTimeout(this._lifeTimer);
      this._lifeTimer = null;
    } else if (enabled && this._isPlaying && !this._lifeTimer) {
      this._scheduleLifeEvent();
    }
  }

  dispose() {
    this.stop(0.1);
    setTimeout(() => {
      try { this._masterGain.disconnect(); } catch(e) {}
      try { this._instrMasterGain.disconnect(); } catch(e) {}
      this._bufferCache.clear();
      this._activeLayers.clear();
      this._instrumentCache.clear();
      this._instrumentLayers.clear();
    }, 300);
  }

  setPosition(sampleId, x, y, z) {
    const layer = this._activeLayers.get(sampleId);
    if (!layer || !layer.panner) return;
    if (typeof layer.panner.positionX !== 'undefined') {
      layer.panner.positionX.value = x;
      layer.panner.positionY.value = y;
      layer.panner.positionZ.value = z;
    } else {
      layer.panner.setPosition(x, y, z);
    }
  }

  /* ══════════════════════════════════════════════════════════════
     AŞAMA 9: ENSTRÜman KATMANI
     ══════════════════════════════════════════════════════════════ */

  async _applyInstrumentPreset(preset) {
    if (!preset) return;

    /* Mevcut enstrümanları yumuşak kapat */
    this._stopAllInstruments(2.0);

    await new Promise(r => setTimeout(r, 400)); /* Kısa geçiş boşluğu */

    /* Birincil enstrüman */
    if (preset.primary) {
      await this._startInstrument(preset.primary, 'primary', preset.primaryVol);
    }

    /* İkincil enstrüman (varsa, 1 sn gecikmeli) */
    if (preset.secondary) {
      setTimeout(async () => {
        if (this._isPlaying) {
          await this._startInstrument(preset.secondary, 'secondary', preset.secondaryVol);
        }
      }, 1000);
    }
  }

  async _startInstrument(instrName, role, vol) {
    const cacheKey = instrName;
    let buf = this._instrumentCache.get(cacheKey);

    if (!buf) {
      /* Önce gerçek dosyayı dene */
      const uri = `${this._basePath}instruments/${instrName}_loop.mp3`;
      try {
        const res = await fetch(uri, { cache: 'force-cache', credentials: 'same-origin' });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const ab = await res.arrayBuffer();
        buf = await this._ctx.decodeAudioData(ab);
        console.info('[SampleManager] Enstrüman dosyası yüklendi:', instrName);
      } catch(e) {
        /* Prosedürel fallback */
        console.warn('[SampleManager] Enstrüman prosedürel:', instrName, e.message);
        const gen = INSTRUMENT_GENERATORS[instrName] || INSTRUMENT_GENERATORS.piano;
        buf = gen(this._ctx);
      }
      this._instrumentCache.set(cacheKey, buf);
    }

    const ctx = this._ctx;
    const now = ctx.currentTime;

    /* 3D Konum — enstrümanlar oda içinde sabit ama gerçekçi konumda */
    const instrPositions = {
      piano  : { x: -1.2, y: 0.2,  z: -1.5 },
      guitar : { x:  1.0, y: 0.0,  z: -1.2 },
      flute  : { x:  0.0, y: 0.5,  z: -2.0 },
    };
    const pos = instrPositions[instrName] || { x: 0, y: 0, z: -1 };

    const panner = this._createPanner(pos.x, pos.y, pos.z);

    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(vol, now + 3.0); /* 3sn fade-in */

    const source = ctx.createBufferSource();
    source.buffer    = buf;
    source.loop      = true;
    source.loopStart = 0;
    source.loopEnd   = buf.duration;

    source.connect(panner);
    panner.connect(gain);
    gain.connect(this._instrMasterGain);
    source.start(0);

    const layerKey = `${instrName}_${role}`;
    this._instrumentLayers.set(layerKey, { source, panner, gain });
    console.info('[SampleManager] Enstrüman başlatıldı:', instrName, 'rol:', role, 'vol:', vol);
  }

  _stopAllInstruments(fadeDuration = 2.0) {
    const now = this._ctx.currentTime;
    this._instrumentLayers.forEach((layer, key) => {
      try {
        layer.gain.gain.setValueAtTime(layer.gain.gain.value, now);
        layer.gain.gain.exponentialRampToValueAtTime(0.0001, now + fadeDuration);
        setTimeout(() => {
          try { layer.source.stop(); layer.source.disconnect(); } catch(e) {}
          try { layer.panner.disconnect(); } catch(e) {}
          try { layer.gain.disconnect(); } catch(e) {}
          this._instrumentLayers.delete(key);
        }, (fadeDuration + 0.2) * 1000);
      } catch(e) {}
    });
  }

  /* ══════════════════════════════════════════════════════════════
     AŞAMA 9: CANLILIK KATMANI — Rastgele 3D Ses Olayları
     ══════════════════════════════════════════════════════════════ */

  _scheduleLifeEvent() {
    if (!this._isPlaying || !this._lifeEnabled) return;

    /* 15–30 saniye arası rastgele bekleme */
    const delay = 15000 + Math.random() * 15000;

    this._lifeTimer = setTimeout(() => {
      if (this._isPlaying && this._lifeEnabled) {
        this._triggerLifeEvent();
        this._scheduleLifeEvent(); /* Bir sonrakini planla */
      }
    }, delay);
  }

  _triggerLifeEvent() {
    const ctx = this._ctx;
    if (!ctx) return;

    /* Rastgele bir olay seç */
    const event = LIFE_EVENTS[Math.floor(Math.random() * LIFE_EVENTS.length)];

    /* Rastgele 3D konum — "uzaktan geliyor" hissi */
    const angle = Math.random() * Math.PI * 2;
    const radius = 3.0 + Math.random() * 4.0; /* 3–7 birim uzakta */
    const height = (Math.random() - 0.3) * 2.0; /* Hafif yukarıdan */
    const x = Math.cos(angle) * radius;
    const z = Math.sin(angle) * radius;
    const y = height;

    try {
      const gen = LIFE_GENERATORS[event.type] || LIFE_GENERATORS.ambient;
      const buf = gen(ctx, event.freq, event.dur);

      const panner = this._createPanner(x, y, z);

      const gain = ctx.createGain();
      const vol = 0.15 + Math.random() * 0.20; /* 0.15–0.35 arası rastgele */
      gain.gain.setValueAtTime(0.0001, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(vol, ctx.currentTime + 0.05);
      /* Fade-out: son %20'sinde */
      const fadeOutAt = ctx.currentTime + event.dur * 0.8;
      gain.gain.setValueAtTime(vol, fadeOutAt);
      gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + event.dur);

      const source = ctx.createBufferSource();
      source.buffer = buf;
      source.loop   = false;

      source.connect(panner);
      panner.connect(gain);
      gain.connect(this._masterGain);
      source.start(0);

      /* Temizle */
      source.onended = () => {
        try { source.disconnect(); panner.disconnect(); gain.disconnect(); } catch(e) {}
      };

      console.info('[SampleManager] Canlılık olayı:', event.id,
        `@ (${x.toFixed(1)}, ${y.toFixed(1)}, ${z.toFixed(1)})`);
    } catch(e) {
      console.warn('[SampleManager] Canlılık olayı hatası:', e.message);
    }
  }

  /* ══════════════════════════════════════════════════════════════
     ORTAM KATMANLARI — v1.3'ten korundu + Pink Noise geliştirildi
     ══════════════════════════════════════════════════════════════ */

  async _preloadSamples(sampleIds) {
    await Promise.allSettled(sampleIds.map(id => this._loadBuffer(id)));
  }

  async _loadBuffer(sampleId) {
    if (this._bufferCache.has(sampleId)) return this._bufferCache.get(sampleId);

    const uri = `${this._basePath}${sampleId}.mp3`;
    try {
      const res = await fetch(uri, { cache: 'force-cache', credentials: 'same-origin' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const ab = await res.arrayBuffer();
      const audioBuf = await this._ctx.decodeAudioData(ab);
      this._bufferCache.set(sampleId, audioBuf);
      console.info('[SampleManager] Ses yüklendi:', sampleId);
      return audioBuf;
    } catch(e) {
      console.warn('[SampleManager] Fallback:', sampleId, e.message);
      const gen = FALLBACK_GENERATORS[sampleId] || FALLBACK_GENERATORS.wind_soft;
      const buf = gen(this._ctx);
      this._bufferCache.set(sampleId, buf);
      return buf;
    }
  }

  _startLayer(sampleId, fadeIn = true) {
    if (this._activeLayers.has(sampleId)) return;
    const buf = this._bufferCache.get(sampleId);
    if (!buf) return;

    const ctx = this._ctx;
    const pos = SAMPLE_POSITIONS[sampleId] || { x: 0, y: 0, z: -1 };

    const panner = this._createPanner(pos.x, pos.y, pos.z);
    const gain   = ctx.createGain();
    const now    = ctx.currentTime;

    if (fadeIn) {
      gain.gain.setValueAtTime(0.0001, now);
      gain.gain.exponentialRampToValueAtTime(0.8, now + 2.5);
    } else {
      gain.gain.value = 0.8;
    }

    const source     = ctx.createBufferSource();
    source.buffer    = buf;
    source.loop      = true;
    source.loopStart = 0;
    source.loopEnd   = buf.duration;

    source.connect(panner);
    panner.connect(gain);
    gain.connect(this._masterGain);
    source.start(0);

    this._activeLayers.set(sampleId, { source, panner, gain });
    console.info('[SampleManager] Ortam katmanı:', sampleId, '@ pozisyon', pos);
  }

  _disposeLayer(sampleId) {
    const layer = this._activeLayers.get(sampleId);
    if (!layer) return;
    try { layer.source.stop(); } catch(e) {}
    try { layer.source.disconnect(); } catch(e) {}
    try { layer.panner.disconnect(); } catch(e) {}
    try { layer.gain.disconnect(); } catch(e) {}
    this._activeLayers.delete(sampleId);
  }

  async _crossfadeTo(newSampleIds, duration = 2.5) {
    const now = this._ctx.currentTime;
    this._activeLayers.forEach((layer, id) => {
      if (!newSampleIds.includes(id)) {
        layer.gain.gain.setValueAtTime(layer.gain.gain.value, now);
        layer.gain.gain.exponentialRampToValueAtTime(0.0001, now + duration);
        setTimeout(() => this._disposeLayer(id), (duration + 0.2) * 1000);
      }
    });
    await this._preloadSamples(newSampleIds);
    newSampleIds.forEach(id => {
      if (!this._activeLayers.has(id)) this._startLayer(id, true);
    });
  }

  /* ── Yardımcı: PannerNode oluştur ── */
  _createPanner(x, y, z) {
    const panner = this._ctx.createPanner();
    panner.panningModel   = 'HRTF';
    panner.distanceModel  = 'inverse';
    panner.refDistance    = 1;
    panner.maxDistance    = 10000;
    panner.rolloffFactor  = 0.8;
    panner.coneInnerAngle = 360;
    panner.coneOuterAngle = 360;
    panner.coneOuterGain  = 0;
    if (typeof panner.positionX !== 'undefined') {
      panner.positionX.value = x;
      panner.positionY.value = y;
      panner.positionZ.value = z;
    } else {
      panner.setPosition(x, y, z);
    }
    return panner;
  }
}

/* ═══════════════════════════════════════════════════════════════
   EXPORT
═══════════════════════════════════════════════════════════════ */
window.SampleManager = SampleManager;
