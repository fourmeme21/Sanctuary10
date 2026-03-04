/**
 * AudioEngine.js — Sanctuary 12. Aşama (Safari/iOS Uyumluluğu)
 * ─────────────────────────────────────────────────────────────────────────────
 * Değişiklikler (Phase 6):
 *   1. Safari ses politikası: ilk kullanıcı etkileşiminde AudioContext.resume()
 *   2. AudioWorklet yükleme hatasına karşı try-catch fallback (Safari uyumlu)
 *   3. _attachSafariAudioUnlock(): click/touchstart ile AudioContext kilidini açar
 *   4. initialize() güçlendirildi: state 'suspended' ise otomatik resume dener
 * ─────────────────────────────────────────────────────────────────────────────
 * Değişiklikler (Phase 5):
 *   1. WebAudioAdapter.loadAudioFile → cache: 'force-cache' eklendi
 *   2. PreloadCache → tekrar indirmeyi önler, cache-first fetch
 *   3. _attachAppStateListeners → listener referansları kaydedilir, dispose'da kaldırılır
 *   4. dispose() → gainNode/sourceNode disconnect, AudioContext kapat, tüm listener'ları temizle
 *   5. Visibility API → sekme arka plana geçince AudioContext suspend, öne gelince resume
 *   6. Waveform RAF → cancelAnimationFrame desteği ile stopWaveformLoop eklendi
 * ─────────────────────────────────────────────────────────────────────────────
 */

'use strict';

/* ═══════════════════════════════════════════════════════════════
   SECTION 1 — SABİTLER
═══════════════════════════════════════════════════════════════ */

const AUDIO_CONFIG = {
  DEFAULT_MASTER_VOLUME:  0.8,
  MAX_TRACK_VOLUME:       0.5,
  FFT_SIZE:               256,
  SMOOTHING:              0.8,
  MAX_LAYERS:             3,
  CROSSFADE_DURATION:     1.5,
  FADE_IN_DURATION:       1.5,
  FADE_OUT_DURATION:      1.5,
  PRELOAD_BUFFER_SECONDS: 4,
  LOOP_GAP_THRESHOLD:     0.05,
};

/* ═══════════════════════════════════════════════════════════════
   SECTION 2 — NATIVE ADAPTER
═══════════════════════════════════════════════════════════════ */

class WebAudioAdapter {
  createContext() {
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) throw new Error('[AudioEngine] Web Audio API desteklenmiyor.');
    return new Ctx();
  }

  async resumeContext(ctx) {
    if (ctx && ctx.state === 'suspended') {
      await ctx.resume();
    }
  }

  async suspendContext(ctx) {
    if (ctx && ctx.state === 'running') {
      await ctx.suspend();
    }
  }

  async closeContext(ctx) {
    if (ctx && ctx.state !== 'closed') {
      await ctx.close();
    }
  }

  /**
   * PHASE 5 — cache: 'force-cache' ile Service Worker önbelleğinden yükler.
   * Aynı ses dosyası ikinci kez indirilmez — ağ trafiği ve veri tasarrufu sağlar.
   */
  async loadAudioFile(ctx, uri) {
    const response = await fetch(uri, {
      cache: 'force-cache',           // SW/HTTP önbelleğinden al
      credentials: 'same-origin',
    });
    if (!response.ok) {
      throw new Error(`[AudioEngine] Ses dosyası alınamadı (${response.status}): ${uri}`);
    }
    const arrayBuffer = await response.arrayBuffer();
    return ctx.decodeAudioData(arrayBuffer);
  }
}

/* ═══════════════════════════════════════════════════════════════
   SECTION 3 — PRELOAD CACHE
   PHASE 5: Aynı URI için promise paylaşımı + Map önbelleği.
   Duplicate fetch tamamen önlenir.
═══════════════════════════════════════════════════════════════ */

class PreloadCache {
  constructor() {
    this._cache   = new Map(); // uri → AudioBuffer
    this._pending = new Map(); // uri → Promise<AudioBuffer>
  }

  has(uri)  { return this._cache.has(uri); }
  get(uri)  { return this._cache.get(uri) || null; }

  /**
   * PHASE 5: Aynı URI için eş zamanlı birden fazla yükleme isteği
   * tek bir fetch'e indirgenir (promise deduplication).
   */
  async load(ctx, uri, adapter) {
    if (this._cache.has(uri))   return this._cache.get(uri);
    if (this._pending.has(uri)) return this._pending.get(uri);

    const promise = adapter.loadAudioFile(ctx, uri)
      .then((buffer) => {
        this._cache.set(uri, buffer);
        this._pending.delete(uri);
        console.info('[PreloadCache] Yüklendi:', uri);
        return buffer;
      })
      .catch((err) => {
        this._pending.delete(uri);
        console.error('[PreloadCache] Yükleme hatası:', uri, err);
        throw err;
      });

    this._pending.set(uri, promise);
    return promise;
  }

  async preloadMany(ctx, uris, adapter) {
    const results = await Promise.allSettled(
      uris.map((uri) => this.load(ctx, uri, adapter))
    );
    const failed = results.filter((r) => r.status === 'rejected');
    if (failed.length > 0) {
      console.warn('[PreloadCache] Bazı dosyalar yüklenemedi:', failed.length);
    }
  }

  /** PHASE 5: Belleği tamamen boşalt */
  clear() {
    this._cache.clear();
    this._pending.clear();
    console.info('[PreloadCache] Önbellek temizlendi.');
  }

  get size() { return this._cache.size; }
}

/* ═══════════════════════════════════════════════════════════════
   SECTION 4 — AUDIO LAYER
═══════════════════════════════════════════════════════════════ */

class AudioLayer {
  constructor(id, type, params = {}) {
    this.id     = id;
    this.type   = type;
    this.params = { volume: 0.5, pitch: 1.0, ...params };

    this._ctx         = null;
    this.gainNode     = null;
    this._source      = null;
    this._nextSource  = null;
    this._workletNode = null;
    this._buffer      = null;

    this._state       = 'idle';
    this._startTime   = 0;
    this._pauseOffset = 0;
  }

  async initialize(ctx, masterGain, buffer = null) {
    this._ctx    = ctx;
    this._buffer = buffer;

    this.gainNode = ctx.createGain();
    this.gainNode.gain.value = this.params.volume * AUDIO_CONFIG.MAX_TRACK_VOLUME;
    this.gainNode.connect(masterGain);

    if (this.type === 'granular' || this.type === 'binaural') {
      try {
        await this._initWorklet();
      } catch {
        this._initFallbackGenerator();
      }
    } else if (this.type === 'file' && this._buffer) {
      this._prepareBufferSource(this._buffer);
    }

    this._state = 'idle';
  }

  async _initWorklet() {
    /* PHASE 6 — try-catch: Safari'de AudioWorklet desteklenmeyebilir veya
     * Blob URL politikaları nedeniyle addModule() başarısız olabilir.
     * Bu durumda _initFallbackGenerator() otomatik devreye girer. */
    const blob = new Blob([WORKLET_PROCESSOR_CODE], { type: 'application/javascript' });
    const url  = URL.createObjectURL(blob);
    try {
      await this._ctx.audioWorklet.addModule(url);
    } catch (workletErr) {
      URL.revokeObjectURL(url);
      throw workletErr; // Üst katman (initialize) fallback'e yönlendirir
    }
    URL.revokeObjectURL(url);

    this._workletNode = new AudioWorkletNode(this._ctx, 'ambient-processor');
    this._workletNode.port.postMessage({
      type: 'init',
      generator: this.params.generator || 'wind',
      sampleRate: this._ctx.sampleRate,
    });
    this._workletNode.connect(this.gainNode);
  }

  _initFallbackGenerator() {
    const sampleRate = this._ctx.sampleRate;
    const bufferSize = sampleRate * AUDIO_CONFIG.PRELOAD_BUFFER_SECONDS;
    const buffer     = this._ctx.createBuffer(2, bufferSize, sampleRate);

    for (let ch = 0; ch < 2; ch++) {
      this._fillGeneratorData(buffer.getChannelData(ch), ch);
    }

    this._buffer = buffer;
    this._prepareBufferSource(buffer);
  }

  _fillGeneratorData(data, channel) {
    const gen = this.params.generator || 'wind';
    for (let i = 0; i < data.length; i++) {
      const t = i / this._ctx.sampleRate;
      switch (gen) {
        case 'rain':
          data[i] = (Math.random() * 2 - 1) * 0.25;
          break;
        case 'waves':
          data[i] = Math.sin(2 * Math.PI * 0.12 * t) * 0.18 + (Math.random() * 2 - 1) * 0.08;
          break;
        case 'binaural': {
          const baseFreq = this.params.baseFreq || 200;
          const beatFreq = this.params.beatFreq || 10;
          const chFreq   = channel === 0 ? baseFreq : baseFreq + beatFreq;
          data[i] = Math.sin(2 * Math.PI * chFreq * t) * 0.12;
          break;
        }
        case 'fire':
          data[i] = (Math.random() * 2 - 1) * 0.15 * (0.8 + Math.sin(t * 3) * 0.2);
          break;
        default: // wind
          data[i] = (Math.random() * 2 - 1) * 0.15 * Math.abs(Math.sin(t * 0.5));
          break;
      }
    }
  }

  _prepareBufferSource(buffer) {
    const src = this._ctx.createBufferSource();
    src.buffer           = buffer;
    src.loop             = true;
    src.loopStart        = 0;
    src.loopEnd          = buffer.duration;
    src.playbackRate.value = this.params.pitch || 1.0;
    src.connect(this.gainNode);
    this._source = src;
    return src;
  }

  play(when = 0) {
    if (this._state === 'playing') return;

    const offset = this._pauseOffset;

    if (this._workletNode) {
      this._workletNode.port.postMessage({ type: 'play' });
    } else if (this._source) {
      if (this._state === 'paused' && this._buffer) {
        this._prepareBufferSource(this._buffer);
      }
      this._source.start(when, offset);
      this._startTime = this._ctx.currentTime - offset + when;
    }

    this._state = 'playing';
  }

  pause() {
    if (this._state !== 'playing') return;
    this._pauseOffset = (this._ctx.currentTime - this._startTime) % (this._buffer?.duration || 1);

    if (this._workletNode) {
      this._workletNode.port.postMessage({ type: 'pause' });
    } else if (this._source) {
      try { this._source.stop(); } catch { /* zaten durmuş */ }
      this._source = null;
    }

    this._state = 'paused';
  }

  /**
   * PHASE 5: stop() — tüm node'ları disconnect ederek bellek boşaltır
   */
  stop() {
    try {
      if (this._workletNode) {
        this._workletNode.port.postMessage({ type: 'stop' });
        this._workletNode.disconnect();
        this._workletNode = null;
      }
      if (this._source) {
        try { this._source.stop(); } catch { /* zaten durmuş */ }
        this._source.disconnect();
        this._source = null;
      }
      if (this._nextSource) {
        try { this._nextSource.stop(); } catch { /* zaten durmuş */ }
        this._nextSource.disconnect();
        this._nextSource = null;
      }
      /* PHASE 5: gainNode'u da disconnect et */
      if (this.gainNode) {
        this.gainNode.disconnect();
        /* gainNode referansını null yapma — dispose() içinde yapılır */
      }
    } catch (err) {
      console.warn('[AudioLayer.stop] Temizleme uyarısı:', err);
    }

    this._state       = 'stopped';
    this._pauseOffset = 0;
  }

  /**
   * PHASE 5: dispose() — AudioLayer'ı tamamen serbest bırakır
   */
  dispose() {
    this.stop();
    this.gainNode     = null;
    this._buffer      = null;
    this._ctx         = null;
  }

  setVolume(value) {
    this.params.volume = value;
    if (this.gainNode && this._ctx) {
      this.gainNode.gain.setTargetAtTime(
        value * AUDIO_CONFIG.MAX_TRACK_VOLUME,
        this._ctx.currentTime,
        0.05,
      );
    }
  }

  fadeTo(targetVolume, duration = AUDIO_CONFIG.CROSSFADE_DURATION) {
    if (!this.gainNode || !this._ctx) return;
    const now = this._ctx.currentTime;
    this.gainNode.gain.cancelScheduledValues(now);
    this.gainNode.gain.setValueAtTime(this.gainNode.gain.value, now);
    this.gainNode.gain.linearRampToValueAtTime(
      targetVolume * AUDIO_CONFIG.MAX_TRACK_VOLUME,
      now + duration,
    );
    this.params.volume = targetVolume;
  }

  fadeIn(targetVolume = this.params.volume, duration = AUDIO_CONFIG.FADE_IN_DURATION) {
    if (!this.gainNode || !this._ctx) return;
    const now = this._ctx.currentTime;
    this.gainNode.gain.cancelScheduledValues(now);
    this.gainNode.gain.setValueAtTime(0, now);
    this.gainNode.gain.linearRampToValueAtTime(
      targetVolume * AUDIO_CONFIG.MAX_TRACK_VOLUME,
      now + duration,
    );
  }

  fadeOut(duration = AUDIO_CONFIG.FADE_OUT_DURATION) {
    return new Promise((resolve) => {
      if (!this.gainNode || !this._ctx) { resolve(); return; }
      const now = this._ctx.currentTime;
      this.gainNode.gain.cancelScheduledValues(now);
      this.gainNode.gain.setValueAtTime(this.gainNode.gain.value, now);
      this.gainNode.gain.linearRampToValueAtTime(0, now + duration);
      setTimeout(resolve, duration * 1000);
    });
  }

  setParameter(param, value) {
    this.params[param] = value;
    if (this._workletNode) {
      this._workletNode.port.postMessage({ type: 'param', [param]: value });
    }
    if (param === 'pitch' && this._source && this._ctx) {
      this._source.playbackRate.setTargetAtTime(value, this._ctx.currentTime, 0.1);
    }
  }

  get isPlaying() { return this._state === 'playing'; }
  get isPaused()  { return this._state === 'paused';  }
  get isStopped() { return this._state === 'stopped' || this._state === 'idle'; }
}

/* ═══════════════════════════════════════════════════════════════
   SECTION 5 — AUDIO WORKLET PROCESSOR KODU
═══════════════════════════════════════════════════════════════ */

const WORKLET_PROCESSOR_CODE = /* js */ `
class AmbientProcessor extends AudioWorkletProcessor {
  constructor(options) {
    super(options);
    this.generator = 'wind';
    this.phase     = 0;      /* PHASE 12 — her zaman sıfır ile başla, NaN'a karşı güvenli */
    this.active    = true;
    this.port.onmessage = ({ data }) => {
      if (data.type === 'init') {
        const newGen = data.generator || 'wind';
        /* Generator değiştiğinde phase'i sıfırla — geçiş anında 'pop' engellenir */
        if (newGen !== this.generator) { this.phase = 0; }
        this.generator = newGen;
      }
      if (data.type === 'param') {
        /* generator değişimi varsa phase sıfırla */
        if (data.generator && data.generator !== this.generator) { this.phase = 0; }
        Object.assign(this, data);
      }
      if (data.type === 'stop')  { this.active = false; }
      if (data.type === 'play')  { this.active = true; }
      if (data.type === 'pause') { this.active = false; }
    };
  }

  process(inputs, outputs) {
    const out = outputs[0];
    if (!out || out.length === 0) return true;

    /* NaN koruması — sampleRate geçersizse sessiz çıkış ver */
    const sr = typeof sampleRate === 'number' && isFinite(sampleRate) && sampleRate > 0
      ? sampleRate : 44100;

    for (let ch = 0; ch < out.length; ch++) {
      const channel = out[ch];
      if (!channel) continue;
      for (let i = 0; i < channel.length; i++) {
        if (!this.active) { channel[i] = 0; continue; }

        /* phase hiçbir zaman NaN olmasın */
        if (!isFinite(this.phase)) this.phase = 0;

        let sample = 0;
        switch (this.generator) {
          case 'rain':
            sample = (Math.random() * 2 - 1) * 0.22;
            break;
          case 'waves':
            sample = Math.sin(this.phase * (0.0008 * 44100 / sr)) * 0.18
                   + (Math.random() * 2 - 1) * 0.06;
            break;
          case 'fire':
            sample = (Math.random() * 2 - 1) * 0.14
                   * (0.8 + Math.sin(this.phase * (0.003 * 44100 / sr)) * 0.2);
            break;
          default: /* wind */
            sample = (Math.random() * 2 - 1) * 0.14
                   * Math.abs(Math.sin(this.phase * (0.0002 * 44100 / sr)));
        }

        /* Çıkış örneğini [-1, 1] aralığına sıkıştır */
        channel[i] = Math.max(-1, Math.min(1, isFinite(sample) ? sample : 0));
        this.phase++;

        /* phase taşmasını önle (2^31 sınırında sıfırla) */
        if (this.phase > 2147483647) this.phase = 0;
      }
    }
    return true;
  }
}
registerProcessor('ambient-processor', AmbientProcessor);
`;

/* ═══════════════════════════════════════════════════════════════
   SECTION 6 — WAVEFORM RAF MANAGER
   PHASE 5: requestAnimationFrame döngüsünü yönetir.
   Sekme gizlendiğinde otomatik durur, görünür olunca devam eder.
═══════════════════════════════════════════════════════════════ */

class WaveformRAFManager {
  constructor() {
    this._rafId       = null;
    this._callback    = null;
    this._active      = false;
    this._tabVisible  = !document.hidden;

    /* PHASE 5: Visibility değiştiğinde RAF'ı otomatik durdur/başlat */
    this._visHandler  = () => {
      this._tabVisible = !document.hidden;
      if (!this._tabVisible) {
        this._pauseRAF();
      } else if (this._active) {
        this._resumeRAF();
      }
    };
    document.addEventListener('visibilitychange', this._visHandler);
  }

  start(callback) {
    this._callback = callback;
    this._active   = true;
    if (this._tabVisible) this._resumeRAF();
  }

  stop() {
    this._active = false;
    this._pauseRAF();
  }

  _resumeRAF() {
    if (this._rafId) return; // zaten çalışıyor
    const loop = () => {
      if (!this._active || !this._tabVisible) {
        this._rafId = null;
        return;
      }
      try { if (this._callback) this._callback(); } catch { /* yoksay */ }
      this._rafId = requestAnimationFrame(loop);
    };
    this._rafId = requestAnimationFrame(loop);
  }

  _pauseRAF() {
    if (this._rafId) {
      cancelAnimationFrame(this._rafId);
      this._rafId = null;
    }
  }

  dispose() {
    this.stop();
    document.removeEventListener('visibilitychange', this._visHandler);
    this._callback = null;
  }
}

/* ═══════════════════════════════════════════════════════════════
   SECTION 7 — AUDIO ENGINE (Singleton)
   PHASE 5 değişiklikleri:
     - _attachAppStateListeners: listener referansları kaydedilir
     - dispose(): tüm listener'lar removeEventListener ile kaldırılır
     - dispose(): masterGain + analyser disconnect edilir
     - Visibility API: arka planda AudioContext otomatik suspend olur
═══════════════════════════════════════════════════════════════ */

class AudioEngine {
  constructor() {
    if (AudioEngine._instance) return AudioEngine._instance;
    AudioEngine._instance = this;

    this._ctx             = null;
    this._masterGain      = null;
    this._analyser        = null;
    this._layers          = new Map();
    this.isInitialized    = false;
    this._initPromise     = null;
    this._playing         = false;

    this._appInBackground = false;
    this._backgroundVolume = 0.4;

    this._adapter         = new WebAudioAdapter();
    this._preloadCache    = new PreloadCache();
    this._waveformRAF     = new WaveformRAFManager();

    this._sessionStart    = null;
    this._listeners       = new Map();

    /* PHASE 5: Event listener referansları — dispose()'da kaldırılır */
    this._boundHandlers   = {};

    this._attachAppStateListeners();
  }

  static getInstance() {
    if (!AudioEngine._instance) new AudioEngine();
    return AudioEngine._instance;
  }

  async initialize() {
    if (this.isInitialized) return;
    if (this._initPromise) return this._initPromise;

    this._initPromise = (async () => {
      try {
        this._ctx = this._adapter.createContext();

        /* PHASE 6 — Safari ses politikası:
         * Safari'de AudioContext kullanıcı etkileşimi olmadan 'suspended' başlar.
         * Önce resume dene; başarısız olursa kullanıcı etkileşimi dinleyicisi ekle. */
        try {
          await this._adapter.resumeContext(this._ctx);
        } catch (resumeErr) {
          console.warn('[AudioEngine] İlk resume başarısız (Safari bekleniyor):', resumeErr);
        }

        /* PHASE 6 — Safari AudioContext kilit açma:
         * İlk kullanıcı etkileşiminde (click / touchstart) resume() çağrılır. */
        this._attachSafariAudioUnlock();

        this._masterGain = this._ctx.createGain();
        this._masterGain.gain.value = AUDIO_CONFIG.DEFAULT_MASTER_VOLUME;

        this._analyser = this._ctx.createAnalyser();
        this._analyser.fftSize                = AUDIO_CONFIG.FFT_SIZE;
        this._analyser.smoothingTimeConstant  = AUDIO_CONFIG.SMOOTHING;

        this._masterGain.connect(this._analyser);
        this._analyser.connect(this._ctx.destination);

        this.isInitialized = true;
        this._emit('initialized');
        console.info('[AudioEngine] Başlatıldı. State:', this._ctx.state);
      } catch (err) {
        this._initPromise = null;
        console.error('[AudioEngine] Başlatma hatası:', err);
        throw err;
      } finally {
        this._initPromise = null;
      }
    })();

    return this._initPromise;
  }

  async _ensureReady() {
    if (!this.isInitialized) await this.initialize();
    await this._adapter.resumeContext(this._ctx);
  }

  async preload(uris = []) {
    await this._ensureReady();
    await this._preloadCache.preloadMany(this._ctx, uris, this._adapter);
    this._emit('preloadComplete', { uris });
  }

  async loadScript(script, options = {}) {
    if (!script?.tracks) throw new Error('[AudioEngine] Geçersiz script formatı.');
    await this._ensureReady();

    const {
      crossfade = true,
      crossfadeDuration = AUDIO_CONFIG.CROSSFADE_DURATION,
    } = options;

    const incoming = await this._buildLayers(script);

    if (crossfade && this._layers.size > 0 && this._playing) {
      await this._crossfadeTo(incoming, crossfadeDuration);
    } else {
      await this._stopAllLayers();
      this._layers = incoming;
      if (script.mix?.masterVolume != null) {
        this._masterGain.gain.value = script.mix.masterVolume;
      }
      if (this._playing) this._startAllLayers();
    }

    this._emit('scriptLoaded', { scene: script.scene, trackCount: incoming.size });
    /* PHASE 12 — Frekansı kaydet (getFrequency() için) */
    const baseTrack = script.tracks?.find(t => t.baseFreq || t.type === 'binaural');
    if (baseTrack?.baseFreq) this._currentFreq = baseTrack.baseFreq;
    return script;
  }

  async _buildLayers(script) {
    const limit = Math.min(script.tracks.length, AUDIO_CONFIG.MAX_LAYERS);
    const map   = new Map();

    for (let i = 0; i < limit; i++) {
      const track  = script.tracks[i];
      const id     = track.id || track.generator || `track_${i}`;

      let buffer = null;
      if (track.uri) {
        /* PHASE 5: PreloadCache deduplication — aynı URI için tek fetch */
        buffer = this._preloadCache.has(track.uri)
          ? this._preloadCache.get(track.uri)
          : await this._preloadCache.load(this._ctx, track.uri, this._adapter);
      }

      const volume = script.mix?.trackVolumes?.[i] ?? track.parameters?.volume ?? 0.5;
      const layer  = new AudioLayer(id, track.type || 'granular', { ...track.parameters, volume });
      await layer.initialize(this._ctx, this._masterGain, buffer);

      map.set(id, layer);
    }

    return map;
  }

  async _crossfadeTo(incomingMap, duration) {
    const outgoing = this._layers;
    const now      = this._ctx.currentTime;

    incomingMap.forEach((layer) => {
      layer.gainNode.gain.cancelScheduledValues(now);
      layer.gainNode.gain.setValueAtTime(0, now);
      layer.gainNode.gain.linearRampToValueAtTime(
        layer.params.volume * AUDIO_CONFIG.MAX_TRACK_VOLUME,
        now + duration,
      );
      layer.play(0);
    });

    outgoing.forEach((layer) => {
      if (layer.gainNode && this._ctx) {
        layer.gainNode.gain.cancelScheduledValues(now);
        layer.gainNode.gain.setValueAtTime(layer.gainNode.gain.value, now);
        layer.gainNode.gain.linearRampToValueAtTime(0, now + duration);
      }
    });

    await new Promise((resolve) => setTimeout(resolve, duration * 1000));

    /* PHASE 5: stop() yerine dispose() — node'ları tamamen serbest bırak */
    outgoing.forEach((layer) => layer.dispose());
    outgoing.clear();

    this._layers = incomingMap;
  }

  /* ── Oynatma Kontrolleri ──────────────────────────────────── */

  async play() {
    await this._ensureReady();
    if (this._playing) return;

    this._startAllLayers();
    this._playing      = true;
    this._sessionStart = Date.now();
    this._emit('play');
  }

  async pause() {
    if (!this._playing) return;
    this._layers.forEach((layer) => layer.pause());
    await this._adapter.suspendContext(this._ctx);
    this._playing = false;
    this._emit('pause');
  }

  async stop() {
    const sessionInfo = this._finalizeSession();
    await this._stopAllLayers();
    await this._adapter.suspendContext(this._ctx);
    this._playing = false;
    this._emit('stop', sessionInfo);
    return sessionInfo;
  }

  async togglePlay() {
    if (this._playing) {
      await this.pause();
    } else {
      await this.play();
    }
    return this._playing;
  }

  /* ── Volume / Fade ────────────────────────────────────────── */

  setMasterVolume(value) {
    if (!this._masterGain) return;
    const clamped = Math.max(0, Math.min(1, value));
    this._masterGain.gain.setTargetAtTime(clamped, this._ctx?.currentTime ?? 0, 0.05);
    this._emit('volumeChange', { master: clamped });
  }

  setLayerVolume(layerId, value) {
    const layer = this._layers.get(layerId);
    if (layer) layer.setVolume(value);
  }

  async fadeOutAll(duration = 3) {
    if (!this._masterGain || !this._ctx) return;
    const now = this._ctx.currentTime;
    this._masterGain.gain.cancelScheduledValues(now);
    this._masterGain.gain.setValueAtTime(this._masterGain.gain.value, now);
    this._masterGain.gain.linearRampToValueAtTime(0, now + duration);
    return new Promise((resolve) => setTimeout(resolve, duration * 1000));
  }

  setLayerParameter(layerId, param, value) {
    const layer = this._layers.get(layerId);
    if (layer) layer.setParameter(param, value);
  }

  /* ── Waveform RAF ─────────────────────────────────────────── */

  /**
   * PHASE 5: RAF döngüsünü başlatır.
   * Sekme arka plana geçince otomatik durur (WaveformRAFManager).
   */
  startWaveformLoop(callback) {
    this._waveformRAF.start(callback);
  }

  /**
   * PHASE 5: RAF döngüsünü tamamen durdurur ve cancelAnimationFrame çağırır.
   */
  stopWaveformLoop() {
    this._waveformRAF.stop();
    console.info('[AudioEngine] Waveform RAF döngüsü durduruldu.');
  }

  /* ── Analiz verisi ────────────────────────────────────────── */

  getAudioData() {
    if (!this._analyser) return null;
    try {
      const data = new Uint8Array(this._analyser.frequencyBinCount);
      this._analyser.getByteFrequencyData(data);
      let sum = 0, peak = 0;
      for (let i = 0; i < data.length; i++) {
        sum += data[i];
        if (data[i] > peak) peak = data[i];
      }
      return {
        frequencies: Array.from(data),
        peak:        peak / 255,
        average:     (sum / data.length) / 255,
      };
    } catch {
      return null;
    }
  }

  get isPlaying()    { return this._playing; }
  get masterVolume() { return this._masterGain?.gain.value ?? 0; }
  get activeLayers() { return Array.from(this._layers.keys()); }
  get contextState() { return this._ctx?.state ?? 'closed'; }

  /* ── PHASE 12: Frekans ve Ses Seviyesi Erişim Metodları ──── */

  /**
   * Mevcut temel frekansı döndürür.
   * loadScript() çağrıldığında _currentFreq güncellenir.
   */
  getFrequency() {
    return this._currentFreq ?? 432;
  }

  /**
   * Temel frekansı değiştirir — binaural beat layer'larına parametre olarak gönderir.
   * @param {number} hz — yeni temel frekans (Hz)
   */
  setFrequency(hz) {
    const freq = isFinite(hz) && hz > 0 ? hz : 432;
    this._currentFreq = freq;
    this._layers.forEach((layer) => {
      if (layer.type === 'binaural') {
        layer.setParameter('baseFreq', freq);
      }
    });
    this._emit('frequencyChange', { frequency: freq });
  }

  /**
   * Mevcut master volume değerini döndürür (0–1 arası).
   * masterVolume getter ile aynı işlev; harici kod için alias.
   */
  getMasterVolume() {
    return this._masterGain?.gain.value ?? 0;
  }

  /* ── Background Audio ────────────────────────────────────── */

  handleAppBackground() {
    if (this._appInBackground) return;
    this._appInBackground = true;

    if (this._masterGain && this._ctx) {
      this._masterGain.gain.setTargetAtTime(
        this._backgroundVolume,
        this._ctx.currentTime,
        0.3,
      );
    }
    /* PHASE 5: Arka planda waveform RAF'ı durdur — CPU tasarrufu */
    this._waveformRAF.stop();
    this._emit('background');
  }

  async handleAppForeground() {
    if (!this._appInBackground) return;
    this._appInBackground = false;

    await this._adapter.resumeContext(this._ctx);
    if (this._masterGain && this._ctx) {
      this._masterGain.gain.setTargetAtTime(
        AUDIO_CONFIG.DEFAULT_MASTER_VOLUME,
        this._ctx.currentTime,
        0.3,
      );
    }
    this._emit('foreground');
  }

  /**
   * PHASE 5: Listener referansları _boundHandlers'a kaydedilir.
   * dispose() içinde removeEventListener ile temizlenir.
   * Bellek sızıntısı önlenir.
   */
  /**
   * PHASE 6 — Safari AudioContext Kilit Açma
   * Safari'de AudioContext kullanıcı etkileşimi olmadan 'suspended' kalır.
   * İlk click veya touchstart olayında resume() çağrılır ve dinleyici kaldırılır.
   * Bu yöntem iOS 15+, Safari 14+ ile tam uyumludur.
   */
  _attachSafariAudioUnlock() {
    if (!this._ctx) return;

    const unlock = async () => {
      if (this._ctx && this._ctx.state === 'suspended') {
        try {
          await this._ctx.resume();
          console.info('[AudioEngine] Safari AudioContext kullanıcı etkileşimiyle açıldı.');
        } catch (err) {
          console.warn('[AudioEngine] Safari unlock hatası:', err);
        }
      }
      // Dinleyicileri tek seferlik kaldır
      document.removeEventListener('click',      unlock, true);
      document.removeEventListener('touchstart', unlock, true);
      document.removeEventListener('touchend',   unlock, true);
      document.removeEventListener('keydown',    unlock, true);
    };

    document.addEventListener('click',      unlock, { once: true, capture: true, passive: true });
    document.addEventListener('touchstart', unlock, { once: true, capture: true, passive: true });
    document.addEventListener('touchend',   unlock, { once: true, capture: true, passive: true });
    document.addEventListener('keydown',    unlock, { once: true, capture: true, passive: true });
  }

  _attachAppStateListeners() {
    if (typeof document === 'undefined') return;

    /* Visibility change handler */
    this._boundHandlers.visibilityChange = () => {
      if (document.hidden) {
        this.handleAppBackground();
      } else {
        this.handleAppForeground();
      }
    };
    document.addEventListener('visibilitychange', this._boundHandlers.visibilityChange);

    if (typeof window !== 'undefined') {
      /* Message handler (React Native WebView) */
      this._boundHandlers.message = (event) => {
        try {
          const data = typeof event.data === 'string' ? JSON.parse(event.data) : event.data;
          if (data?.type === 'APP_STATE_CHANGE') {
            if (data.state === 'background') this.handleAppBackground();
            if (data.state === 'active')     this.handleAppForeground();
          }
        } catch { /* yoksay */ }
      };
      window.addEventListener('message', this._boundHandlers.message);
      document.addEventListener('message', this._boundHandlers.message);

      /* Page hide — mobil tarayıcılarda sekme kapatılınca */
      this._boundHandlers.pageHide = () => {
        this.handleAppBackground();
      };
      window.addEventListener('pagehide', this._boundHandlers.pageHide);
    }
  }

  _finalizeSession() {
    if (!this._sessionStart) return { duration: 0 };
    const duration     = Math.floor((Date.now() - this._sessionStart) / 1000);
    this._sessionStart = null;
    return { duration, timestamp: new Date().toISOString() };
  }

  _startAllLayers() {
    this._layers.forEach((layer) => {
      if (!layer.isPlaying) layer.play();
    });
  }

  async _stopAllLayers() {
    /* PHASE 5: dispose() ile node'ları tamamen serbest bırak */
    this._layers.forEach((layer) => layer.dispose());
    this._layers.clear();
  }

  on(event, callback) {
    if (!this._listeners.has(event)) this._listeners.set(event, new Set());
    this._listeners.get(event).add(callback);
    return () => this._listeners.get(event)?.delete(callback);
  }

  _emit(event, payload) {
    this._listeners.get(event)?.forEach((cb) => {
      try { cb(payload); } catch (err) { console.warn('[AudioEngine] Listener hatası:', err); }
    });
  }

  /**
   * PHASE 5: dispose() — Tam temizleme
   *   1. Tüm layer'ları dispose et (gainNode + sourceNode disconnect)
   *   2. masterGain + analyser disconnect et
   *   3. AudioContext'i kapat
   *   4. Tüm event listener'ları removeEventListener ile kaldır
   *   5. WaveformRAF'ı durdur
   *   6. PreloadCache'i boşalt
   *   7. Singleton referansını sıfırla
   */
  async dispose() {
    console.info('[AudioEngine] Dispose başlatılıyor...');

    /* 1. Waveform RAF durdur */
    this._waveformRAF.dispose();

    /* 2. Layer'ları temizle */
    await this._stopAllLayers();

    /* 3. Audio graph node'larını disconnect et */
    try {
      if (this._analyser) {
        this._analyser.disconnect();
        this._analyser = null;
      }
      if (this._masterGain) {
        this._masterGain.disconnect();
        this._masterGain = null;
      }
    } catch (err) {
      console.warn('[AudioEngine] Node disconnect uyarısı:', err);
    }

    /* 4. AudioContext kapat */
    try {
      await this._adapter.closeContext(this._ctx);
      this._ctx = null;
    } catch (err) {
      console.warn('[AudioEngine] AudioContext kapatma uyarısı:', err);
    }

    /* 5. Event listener'ları kaldır — PHASE 5 bellek sızıntısı önlemi */
    try {
      if (this._boundHandlers.visibilityChange) {
        document.removeEventListener('visibilitychange', this._boundHandlers.visibilityChange);
      }
      if (this._boundHandlers.message && typeof window !== 'undefined') {
        window.removeEventListener('message', this._boundHandlers.message);
        document.removeEventListener('message', this._boundHandlers.message);
      }
      if (this._boundHandlers.pageHide && typeof window !== 'undefined') {
        window.removeEventListener('pagehide', this._boundHandlers.pageHide);
      }
      this._boundHandlers = {};
      console.info('[AudioEngine] Event listener\'lar temizlendi.');
    } catch (err) {
      console.warn('[AudioEngine] Listener temizleme uyarısı:', err);
    }

    /* 6. Önbelleği boşalt */
    this._preloadCache.clear();

    /* 7. Singleton + state sıfırla */
    this.isInitialized    = false;
    this._playing         = false;
    this._listeners.clear();
    AudioEngine._instance = null;

    console.info('[AudioEngine] Dispose tamamlandı.');
    this._emit('disposed');
  }
}

AudioEngine._instance = null;

/* ═══════════════════════════════════════════════════════════════
   SECTION 8B — ROOM SYNC (Phase 10)
   RoomManager ile ses köprüsü:
     - syncRoomAudio()          Host sesi değişince engine'i günceller
     - startBreathBroadcast()   Nefes başlayınca odaya bildirim
     - stopBreathBroadcast()    Nefes bitince odaya bildirim
     - _listenRoomEvents()      RoomManager event'lerini dinler
═══════════════════════════════════════════════════════════════ */

AudioEngine.prototype.syncRoomAudio = function syncRoomAudio(roomId, audioConfig) {
  if (!audioConfig) return;
  var engine = this;

  // 1. RoomManager'a bildir (kaydeder + broadcast eder)
  try {
    if (typeof RoomManager !== 'undefined') {
      RoomManager.syncRoomAudio(roomId, audioConfig);
    }
  } catch (e) { /* RoomManager yüklenmemiş olabilir */ }

  // 2. Yerel AudioEngine'i yeni konfigürasyona çek (sessizce)
  var script = {
    scene: audioConfig.label || 'room_sync',
    tracks: [{
      id:   audioConfig.gen || 'binaural',
      type: audioConfig.gen === 'rain' || audioConfig.gen === 'waves' || audioConfig.gen === 'wind' || audioConfig.gen === 'fire'
              ? 'granular' : 'binaural',
      parameters: {
        generator: audioConfig.gen  || 'binaural',
        baseFreq:  audioConfig.base || 432,
        beatFreq:  audioConfig.beat || 7,
        volume:    0.6,
      },
    }],
    mix: { masterVolume: 0.75 },
  };

  if (engine.isInitialized && engine._playing) {
    engine.loadScript(script, { crossfade: true, crossfadeDuration: 2.5 })
      .then(function () {
        console.info('[AudioEngine] Room ses senkronizasyonu tamamlandı:', audioConfig);
        engine._emit('roomAudioSynced', { roomId: roomId, audioConfig: audioConfig });
      })
      .catch(function (err) {
        console.warn('[AudioEngine] Room ses senkronizasyonu hatası:', err);
      });
  }
};

/**
 * Nefes döngüsü başladığında odaya bildir.
 * startBreathCycle() çağrısıyla birlikte kullanılır.
 * @param {string} roomId  — Bulunulan oda ID'si
 * @param {string} userId  — Yerel kullanıcı ID'si (varsayılan: 'user_local')
 */
AudioEngine.prototype.startBreathBroadcast = function startBreathBroadcast(roomId, userId) {
  userId = userId || 'user_local';
  try {
    if (typeof RoomManager !== 'undefined') {
      RoomManager.setBreathing(roomId, userId, true);
    }
  } catch (e) {}
  this._emit('breathStart', { roomId: roomId, userId: userId });
  console.info('[AudioEngine] Nefes yayını başladı:', userId);
};

/**
 * Nefes döngüsü bittiğinde odaya bildir.
 */
AudioEngine.prototype.stopBreathBroadcast = function stopBreathBroadcast(roomId, userId) {
  userId = userId || 'user_local';
  try {
    if (typeof RoomManager !== 'undefined') {
      RoomManager.setBreathing(roomId, userId, false);
    }
  } catch (e) {}
  this._emit('breathStop', { roomId: roomId, userId: userId });
  console.info('[AudioEngine] Nefes yayını durduruldu:', userId);
};

/**
 * RoomManager'ın broadcast event'lerini dinler.
 * Başka bir host ses değiştirince bu engine otomatik güncellenir.
 * @param {string} roomId  — Takip edilecek oda
 */
AudioEngine.prototype._listenRoomEvents = function _listenRoomEvents(roomId) {
  var engine = this;
  if (!roomId) return;

  try {
    if (typeof RoomManager === 'undefined') return;

    RoomManager.on('audio_sync', function (data) {
      if (data && data.roomId === roomId) {
        console.info('[AudioEngine] Host ses güncellemesi alındı:', data.audioConfig);

        // Kullanıcıya toast bildirimi
        try {
          if (window.SanctuaryToast) {
            window.SanctuaryToast.info(
              (data.audioConfig.base || '') + ' Hz · ' + (data.audioConfig.gen || ''),
              '🎵 Host sesi güncelledi'
            );
          }
        } catch (e) {}

        // Motoru güncelle (crossfade ile sessizce geçiş)
        if (engine.isInitialized) {
          var script = {
            scene: 'host_sync',
            tracks: [{
              id:   data.audioConfig.gen || 'binaural',
              type: 'granular',
              parameters: {
                generator: data.audioConfig.gen  || 'binaural',
                baseFreq:  data.audioConfig.base || 432,
                beatFreq:  data.audioConfig.beat || 7,
                volume:    0.6,
              },
            }],
            mix: { masterVolume: 0.75 },
          };
          engine.loadScript(script, { crossfade: true, crossfadeDuration: 2.0 })
            .catch(function (err) { console.warn('[AudioEngine] Host sync yükleme hatası:', err); });
        }
      }
    });

    RoomManager.on('host_changed', function (data) {
      if (data && data.roomId === roomId) {
        console.info('[AudioEngine] Yeni host:', data.newHost);
        engine._emit('hostChanged', data);
      }
    });

    console.info('[AudioEngine] Room event dinleyicileri kuruldu. OdaID:', roomId);
  } catch (e) {
    console.warn('[AudioEngine] _listenRoomEvents hatası:', e);
  }
};

/* ═══════════════════════════════════════════════════════════════
   SECTION 8 — LEGACY ADAPTER
═══════════════════════════════════════════════════════════════ */

function createLegacyAdapter() {
  const engine = AudioEngine.getInstance();

  return {
    get isInitialized()    { return engine.isInitialized; },
    get masterGain()       { return engine._masterGain; },
    get analyser()         { return engine._analyser; },

    initialize:            ()           => engine.initialize(),
    loadScript:            (script)     => engine.loadScript(script),
    startAllLayers:        ()           => engine._startAllLayers(),
    stopAllLayers:         ()           => engine._stopAllLayers(),
    togglePlay:            ()           => engine.togglePlay(),
    setTrackVolume:        (id, vol)    => engine.setLayerVolume(id, vol),
    updateTrackParameter:  (id, p, v)   => engine.setLayerParameter(id, p, v),
    getAudioData:          ()           => engine.getAudioData(),
    stopAndSaveSession:    ()           => Promise.resolve(engine._finalizeSession()),
    startWaveformLoop:     (cb)         => engine.startWaveformLoop(cb),
    stopWaveformLoop:      ()           => engine.stopWaveformLoop(),
    dispose:               ()           => engine.dispose(),
  };
}

/* ═══════════════════════════════════════════════════════════════
   EXPORTS
═══════════════════════════════════════════════════════════════ */

export default AudioEngine;
export {
  AudioEngine,
  AudioLayer,
  PreloadCache,
  WebAudioAdapter,
  WaveformRAFManager,
  createLegacyAdapter,
  AUDIO_CONFIG,
};

if (typeof module !== 'undefined') {
  module.exports                       = AudioEngine;
  module.exports.AudioEngine           = AudioEngine;
  module.exports.AudioLayer            = AudioLayer;
  module.exports.PreloadCache          = PreloadCache;
  module.exports.WebAudioAdapter       = WebAudioAdapter;
  module.exports.WaveformRAFManager    = WaveformRAFManager;
  module.exports.createLegacyAdapter   = createLegacyAdapter;
  module.exports.AUDIO_CONFIG          = AUDIO_CONFIG;
}
