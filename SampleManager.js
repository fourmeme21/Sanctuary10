/**
 * SampleManager.js — Sanctuary Organik Ses Katmanı v1.3 (Aşama 3)
 * ─────────────────────────────────────────────────────────────────────────────
 * Aşama 3 değişiklikleri:
 *   • Tüm fallback üreticiler Brownian Noise algoritmasına geçirildi
 *   • Fade-in/out: linearRamp → exponentialRamp, 0 → 0.0001
 *   • Fade-in: 2.5sn | Fade-out: 3.0sn | Crossfade: 2.5sn
 * ─────────────────────────────────────────────────────────────────────────────
 * GeminiAdapter'dan gelen sceneName değerine göre uygun ses örneklerini
 * eşleştirir, 3D HRTF uzayda konumlandırır ve seamless loop ile çalar.
 *
 * Bağımlılıklar: Web Audio API (PannerNode, GainNode, AudioBufferSourceNode)
 * Kullanım:
 *   const sm = new SampleManager(audioCtx, masterGainNode);
 *   sm.applyScene('Calm Breath');
 *   sm.start();
 *   sm.stop();
 * ─────────────────────────────────────────────────────────────────────────────
 */

'use strict';

/* ═══════════════════════════════════════════════════════════════
   SAHNE → KATMAN HARİTASI
   sceneName (GeminiAdapter çıktısı) → organik ses katmanları
═══════════════════════════════════════════════════════════════ */

const SCENE_SAMPLE_MAP = {
  // Sakin / Nefes sahneleri
  'Calm Breath'     : ['waves_calm', 'wind_soft'],
  'Deep Peace'      : ['waves_calm', 'rain_light'],
  'Light Breath'    : ['wind_soft', 'birds_far'],
  'Focus Flow'      : ['rain_light', 'wind_soft'],
  'Heart Resonance' : ['waves_calm', 'birds_far'],
  'Energy Renewal'  : ['birds_far', 'wind_soft'],

  // Türkçe sahne adları
  'Derin Huzur'     : ['waves_calm', 'rain_light'],
  'Işık Nefesi'     : ['wind_soft', 'birds_far'],
  'Odak Akışı'      : ['rain_light', 'wind_soft'],

  // Arapça
  'تنفس هادئ'       : ['waves_calm', 'wind_soft'],
  'سلام عميق'       : ['waves_calm', 'rain_light'],

  // Joyful / Enerjik
  'Joyful Radiance' : ['birds_far', 'wind_soft'],
  'Morning Light'   : ['birds_far', 'waves_calm'],

  // Varsayılan
  _default          : ['waves_calm', 'wind_soft'],
};

/* ═══════════════════════════════════════════════════════════════
   SES KATMANI 3D POZİSYONLARI (x, y, z)
   HRTF: x = sol/sağ, y = aşağı/yukarı, z = ön/arka
═══════════════════════════════════════════════════════════════ */

const SAMPLE_POSITIONS = {
  waves_calm : { x: -1.5, y: 0,    z: -2.0 },  // Sol-arka (okyanus hissi)
  rain_light : { x:  0,   y: 1.5,  z:  0   },  // Yukarıdan yağıyor
  birds_far  : { x:  2.0, y: 0.8,  z: -3.0 },  // Sağ-uzak-yukarı
  wind_soft  : { x:  0,   y: 0,    z: -1.0 },  // Arkadan esiyor
};

/* ═══════════════════════════════════════════════════════════════
   FALLBACK BUFFER ÜRETİCİLERİ
   Gerçek ses dosyaları yüklenemezse prosedürel ses üretir.
═══════════════════════════════════════════════════════════════ */

const FALLBACK_GENERATORS = {

  waves_calm(ctx) {
    const sr = ctx.sampleRate, dur = 8, len = sr * dur;
    const buf = ctx.createBuffer(2, len, sr);
    for (let ch = 0; ch < 2; ch++) {
      const d = buf.getChannelData(ch);
      let p1 = 0, p2 = 0, p3 = 0, lastOut = 0; /* Brownian state */
      for (let i = 0; i < len; i++) {
        p1 += (2 * Math.PI * 0.07) / sr;
        p2 += (2 * Math.PI * 0.15) / sr;
        p3 += (2 * Math.PI * 0.035) / sr;
        const white = Math.random() * 2 - 1;
        lastOut = (lastOut + 0.02 * white) / 1.02; /* Brownian dönüşümü */
        const swell = 0.55 + Math.sin(p3) * 0.45;
        const v = Math.sin(p1) * 0.18 * swell
                + Math.sin(p2) * 0.09 * swell
                + lastOut * 0.06 * swell; /* Brownian — derin dalga dokusu */
        d[i] = Math.max(-1, Math.min(1, isFinite(v) ? v : 0));
      }
    }
    return buf;
  },

  rain_light(ctx) {
    const sr = ctx.sampleRate, dur = 8, len = sr * dur;
    const buf = ctx.createBuffer(2, len, sr);
    for (let ch = 0; ch < 2; ch++) {
      const d = buf.getChannelData(ch);
      let p1 = 0, lastOut = 0; /* Brownian state */
      for (let i = 0; i < len; i++) {
        p1 += (2 * Math.PI * 0.4) / sr;
        const white = Math.random() * 2 - 1;
        lastOut = (lastOut + 0.02 * white) / 1.02; /* Brownian zemin */
        /* Sürekli zemin Brownian; nadir damlalar beyaz (fiziksel doğruluk) */
        let v = lastOut * 0.35 * (0.75 + Math.sin(p1) * 0.25);
        if (Math.random() < 0.0006) v += (Math.random() * 2 - 1) * 0.28;
        d[i] = Math.max(-1, Math.min(1, isFinite(v) ? v : 0));
      }
    }
    return buf;
  },

  birds_far(ctx) {
    const sr = ctx.sampleRate, dur = 8, len = sr * dur;
    const buf = ctx.createBuffer(2, len, sr);
    for (let ch = 0; ch < 2; ch++) {
      const d = buf.getChannelData(ch);
      let p1 = 0, p2 = 0;
      for (let i = 0; i < len; i++) {
        p1 += (2 * Math.PI * 2800) / sr;   // Kuş sesi ~ 2.8kHz
        p2 += (2 * Math.PI * 0.8) / sr;    // Zaman zarfı
        const env = Math.max(0, Math.sin(p2));
        // Çok seyrek ötüşler
        const chirp = Math.random() < 0.0003
          ? Math.sin(p1) * 0.18 * env
          : 0;
        const ambience = (Math.random() * 2 - 1) * 0.018;
        d[i] = Math.max(-1, Math.min(1, chirp + ambience));
      }
    }
    return buf;
  },

  wind_soft(ctx) {
    const sr = ctx.sampleRate, dur = 8, len = sr * dur;
    const buf = ctx.createBuffer(2, len, sr);
    for (let ch = 0; ch < 2; ch++) {
      const d = buf.getChannelData(ch);
      let p1 = 0, p2 = 0, lastOut = 0; /* Brownian state */
      for (let i = 0; i < len; i++) {
        p1 += (2 * Math.PI * 0.09) / sr;
        p2 += (2 * Math.PI * 0.04) / sr;
        const white = Math.random() * 2 - 1;
        lastOut = (lastOut + 0.02 * white) / 1.02; /* Brownian rüzgar dokusu */
        const env = Math.max(0, 0.5 + Math.sin(p2) * 0.35 + Math.sin(p1 * 0.4) * 0.15);
        const v = lastOut * 0.55 * env; /* Beyaz gürültü yerine Brownian */
        d[i] = Math.max(-1, Math.min(1, isFinite(v) ? v : 0));
      }
    }
    return buf;
  },
};

/* ═══════════════════════════════════════════════════════════════
   SAMPLE MANAGER SINIFI
═══════════════════════════════════════════════════════════════ */

class SampleManager {

  /**
   * @param {AudioContext} ctx         — Web Audio bağlamı
   * @param {AudioNode}    destination — Bağlanacak master gain / bus
   * @param {object}       [options]
   * @param {string}  [options.basePath='audio/'] — Ses dosyalarının yolu
   * @param {number}  [options.volume=0.55]        — Katman ses seviyesi
   */
  constructor(ctx, destination, options = {}) {
    this._ctx         = ctx;
    this._destination = destination;
    this._basePath    = options.basePath  || 'audio/';
    this._volume      = options.volume    ?? 0.55;

    this._activeLayers = new Map();  // sampleId → { source, panner, gain }
    this._bufferCache  = new Map();  // sampleId → AudioBuffer
    this._currentScene = null;
    this._isPlaying    = false;

    /* Master gain — tüm organik katmanlar burada birleşir */
    this._masterGain = ctx.createGain();
    this._masterGain.gain.value = this._volume;
    this._masterGain.connect(destination);
  }

  /* ── Sahne Uygula ──────────────────────────────────────────── */

  /**
   * GeminiAdapter'dan gelen sceneName'e göre katmanları ayarla.
   * Oynatma devam ediyorsa crossfade ile geçiş yapar.
   * @param {string} sceneName
   */
  async applyScene(sceneName) {
    const sampleIds = SCENE_SAMPLE_MAP[sceneName]
      || SCENE_SAMPLE_MAP._default;

    console.info('[SampleManager] Sahne uygulanıyor:', sceneName, '→', sampleIds);
    this._currentScene = sceneName;

    /* Tampon yükleme */
    await this._preloadSamples(sampleIds);

    if (this._isPlaying) {
      await this._crossfadeTo(sampleIds);
    }
  }

  /**
   * MSD (GeminiAdapter çıktısı) nesnesini doğrudan kabul eder.
   * @param {object} msd — { sceneName: string, ... }
   */
  async applyMSD(msd) {
    if (msd && typeof msd.sceneName === 'string') {
      await this.applyScene(msd.sceneName);
    }
  }

  /* ── Oynatma Kontrolleri ───────────────────────────────────── */

  async start() {
    if (this._isPlaying) return;
    this._isPlaying = true;

    const sampleIds = this._currentScene
      ? (SCENE_SAMPLE_MAP[this._currentScene] || SCENE_SAMPLE_MAP._default)
      : SCENE_SAMPLE_MAP._default;

    await this._preloadSamples(sampleIds);
    sampleIds.forEach(id => this._startLayer(id));
    console.info('[SampleManager] Başlatıldı. Aktif katmanlar:', sampleIds);
  }

  stop(fadeDuration = 3.0) {
    if (!this._isPlaying) return;
    this._isPlaying = false;

    const now = this._ctx.currentTime;
    this._activeLayers.forEach((layer, id) => {
      try {
        layer.gain.gain.setValueAtTime(layer.gain.gain.value, now);
        /* Aşama 3: linearRamp → exponentialRamp, 0 → 0.0001 */
        layer.gain.gain.exponentialRampToValueAtTime(0.0001, now + fadeDuration);
        setTimeout(() => this._disposeLayer(id), (fadeDuration + 0.2) * 1000);
      } catch (e) { /* zaten durmuş */ }
    });

    console.info('[SampleManager] Durduruldu.');
  }

  setVolume(vol) {
    this._volume = Math.max(0.0001, Math.min(1, vol)); /* 0.0001 min — exponential için */
    if (this._masterGain && this._ctx) {
      const now = this._ctx.currentTime;
      this._masterGain.gain.setValueAtTime(this._masterGain.gain.value, now);
      /* Aşama 3: linearRamp → exponentialRamp */
      this._masterGain.gain.exponentialRampToValueAtTime(this._volume, now + 0.3);
    }
  }

  dispose() {
    this.stop(0.1);
    setTimeout(() => {
      try { this._masterGain.disconnect(); } catch (e) {}
      this._bufferCache.clear();
      this._activeLayers.clear();
    }, 300);
    console.info('[SampleManager] Dispose tamamlandı.');
  }

  /* ── 3D Konumlandırma ─────────────────────────────────────── */

  /**
   * Belirli bir katmanın 3D pozisyonunu güncelle.
   * @param {string} sampleId
   * @param {number} x
   * @param {number} y
   * @param {number} z
   */
  setPosition(sampleId, x, y, z) {
    const layer = this._activeLayers.get(sampleId);
    if (!layer || !layer.panner) return;
    if (typeof layer.panner.positionX !== 'undefined') {
      // Modern API
      layer.panner.positionX.value = x;
      layer.panner.positionY.value = y;
      layer.panner.positionZ.value = z;
    } else {
      layer.panner.setPosition(x, y, z);
    }
  }

  /* ── Dahili Yardımcılar ────────────────────────────────────── */

  async _preloadSamples(sampleIds) {
    await Promise.allSettled(
      sampleIds.map(id => this._loadBuffer(id))
    );
  }

  async _loadBuffer(sampleId) {
    if (this._bufferCache.has(sampleId)) return this._bufferCache.get(sampleId);

    /* Önce gerçek dosyayı dene */
    const uri = `${this._basePath}${sampleId}.mp3`;
    try {
      const res = await fetch(uri, { cache: 'force-cache', credentials: 'same-origin' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const arrayBuf = await res.arrayBuffer();
      const audioBuf = await this._ctx.decodeAudioData(arrayBuf);
      this._bufferCache.set(sampleId, audioBuf);
      console.info('[SampleManager] Ses yüklendi:', sampleId);
      return audioBuf;
    } catch (e) {
      /* Dosya yoksa prosedürel fallback */
      console.warn('[SampleManager] Dosya yüklenemedi, fallback:', sampleId, e.message);
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

    /* ── PannerNode — 3D HRTF ── */
    const panner = ctx.createPanner();
    panner.panningModel    = 'HRTF';
    panner.distanceModel   = 'inverse';
    panner.refDistance     = 1;
    panner.maxDistance     = 10000;
    panner.rolloffFactor   = 0.8;
    panner.coneInnerAngle  = 360;
    panner.coneOuterAngle  = 360;
    panner.coneOuterGain   = 0;

    if (typeof panner.positionX !== 'undefined') {
      panner.positionX.value = pos.x;
      panner.positionY.value = pos.y;
      panner.positionZ.value = pos.z;
    } else {
      panner.setPosition(pos.x, pos.y, pos.z);
    }

    /* ── Gain ── */
    const gain = ctx.createGain();
    const now  = ctx.currentTime;

    if (fadeIn) {
      gain.gain.setValueAtTime(0.0001, now);
      gain.gain.exponentialRampToValueAtTime(0.8, now + 2.5); /* Aşama 3: exponential, 2.5sn */
    } else {
      gain.gain.value = 0.8;
    }

    /* ── BufferSource — seamless loop ── */
    const source      = ctx.createBufferSource();
    source.buffer     = buf;
    source.loop       = true;   // Seamless loop
    source.loopStart  = 0;
    source.loopEnd    = buf.duration;

    /* Zincir: source → panner → gain → masterGain → destination */
    source.connect(panner);
    panner.connect(gain);
    gain.connect(this._masterGain);
    source.start(0);

    this._activeLayers.set(sampleId, { source, panner, gain });
    console.info('[SampleManager] Katman başlatıldı:', sampleId, '@ pozisyon', pos);
  }

  _disposeLayer(sampleId) {
    const layer = this._activeLayers.get(sampleId);
    if (!layer) return;
    try { layer.source.stop(); } catch (e) {}
    try { layer.source.disconnect(); } catch (e) {}
    try { layer.panner.disconnect(); } catch (e) {}
    try { layer.gain.disconnect(); } catch (e) {}
    this._activeLayers.delete(sampleId);
  }

  async _crossfadeTo(newSampleIds, duration = 2.5) {
    const now = this._ctx.currentTime;

    /* Mevcut katmanları fade-out — Aşama 3: exponentialRamp */
    this._activeLayers.forEach((layer, id) => {
      if (!newSampleIds.includes(id)) {
        layer.gain.gain.setValueAtTime(layer.gain.gain.value, now);
        layer.gain.gain.exponentialRampToValueAtTime(0.0001, now + duration);
        setTimeout(() => this._disposeLayer(id), (duration + 0.2) * 1000);
      }
    });

    /* Yeni katmanları yükle ve fade-in */
    await this._preloadSamples(newSampleIds);
    newSampleIds.forEach(id => {
      if (!this._activeLayers.has(id)) {
        this._startLayer(id, true);
      }
    });
  }
}

/* ═══════════════════════════════════════════════════════════════
   EXPORT — Browser global
═══════════════════════════════════════════════════════════════ */
window.SampleManager = SampleManager;
