/**
 * AudioEngine.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Singleton-pattern, DOM-bağımsız, React Native / Expo uyumlu ses motoru.
 *
 * Kullanım (Web / React Native WebView):
 *   import AudioEngine from './AudioEngine';
 *   const engine = AudioEngine.getInstance();
 *   await engine.initialize();
 *   await engine.play();
 *
 * React Native (expo-av / react-native-track-player):
 *   Bu dosya Web Audio API'yi doğrudan kullanır fakat tüm I/O noktaları
 *   `NativeAdapter` interface'i üzerinden geçer — platforma özel adapter'ı
 *   inject ederek native modüllere geçiş yapılabilir.
 * ─────────────────────────────────────────────────────────────────────────────
 */

'use strict';

/* ═══════════════════════════════════════════════════════════════
   SECTION 1 — SABİTLER
═══════════════════════════════════════════════════════════════ */

const AUDIO_CONFIG = {
  DEFAULT_MASTER_VOLUME: 0.8,
  MAX_TRACK_VOLUME: 0.5,
  FFT_SIZE: 256,
  SMOOTHING: 0.8,
  MAX_LAYERS: 3,
  CROSSFADE_DURATION: 2.5,   // saniye — gapless geçiş süresi
  FADE_IN_DURATION: 1.5,     // saniye
  FADE_OUT_DURATION: 1.5,    // saniye
  PRELOAD_BUFFER_SECONDS: 4, // buffer önceden doldurulacak süre
  LOOP_GAP_THRESHOLD: 0.05,  // sn — loop seam tespit eşiği
};

/* ═══════════════════════════════════════════════════════════════
   SECTION 2 — NATIVE ADAPTER (platform soyutlama katmanı)
   React Native'de expo-av veya react-native-track-player ile
   değiştirilebilir. Web'de Web Audio API kullanılır.
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
    if (ctx) await ctx.close();
  }

  async loadAudioFile(ctx, uri) {
    const response = await fetch(uri);
    const arrayBuffer = await response.arrayBuffer();
    return ctx.decodeAudioData(arrayBuffer);
  }
}

/* ═══════════════════════════════════════════════════════════════
   SECTION 3 — PRELOAD CACHE
═══════════════════════════════════════════════════════════════ */

class PreloadCache {
  constructor() {
    this._cache = new Map();
    this._pending = new Map();
  }

  has(uri)  { return this._cache.has(uri); }
  get(uri)  { return this._cache.get(uri) || null; }

  async load(ctx, uri, adapter) {
    if (this._cache.has(uri)) return this._cache.get(uri);
    if (this._pending.has(uri)) return this._pending.get(uri);

    const promise = adapter.loadAudioFile(ctx, uri).then((buffer) => {
      this._cache.set(uri, buffer);
      this._pending.delete(uri);
      return buffer;
    }).catch((err) => {
      this._pending.delete(uri);
      throw err;
    });

    this._pending.set(uri, promise);
    return promise;
  }

  async preloadMany(ctx, uris, adapter) {
    await Promise.allSettled(uris.map((uri) => this.load(ctx, uri, adapter)));
  }

  clear() {
    this._cache.clear();
    this._pending.clear();
  }
}

/* ═══════════════════════════════════════════════════════════════
   SECTION 4 — AUDIO LAYER
═══════════════════════════════════════════════════════════════ */

class AudioLayer {
  constructor(id, type, params = {}) {
    this.id = id;
    this.type = type;
    this.params = { volume: 0.5, pitch: 1.0, ...params };

    this._ctx = null;
    this.gainNode = null;
    this._source = null;
    this._nextSource = null;
    this._workletNode = null;
    this._buffer = null;

    this._state = 'idle';
    this._startTime = 0;
    this._pauseOffset = 0;
  }

  async initialize(ctx, masterGain, buffer = null) {
    this._ctx = ctx;
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
    const code = WORKLET_PROCESSOR_CODE;
    const blob = new Blob([code], { type: 'application/javascript' });
    const url = URL.createObjectURL(blob);
    await this._ctx.audioWorklet.addModule(url);
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
    const buffer = this._ctx.createBuffer(2, bufferSize, sampleRate);

    for (let ch = 0; ch < 2; ch++) {
      const data = buffer.getChannelData(ch);
      this._fillGeneratorData(data, ch);
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
          const chFreq = channel === 0 ? baseFreq : baseFreq + beatFreq;
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

  /* ── Buffer Source ────────────────────────────────────────── */
  /* FIX 1: src.offset ataması kaldırıldı. Offset artık play() içinde
     doğrudan this._source.start(when, offset) ile geçiliyor. */

  _prepareBufferSource(buffer) {
    const src = this._ctx.createBufferSource();
    src.buffer = buffer;
    src.loop = true;
    src.loopStart = 0;
    src.loopEnd = buffer.duration;
    src.playbackRate.value = this.params.pitch || 1.0;
    src.connect(this.gainNode);
    // NOT: src.offset buraya atanmıyor — play() metodunda start(when, offset) ile kullanılır
    this._source = src;
    return src;
  }

  /* ── Oynatma Kontrolü ─────────────────────────────────────── */

  /**
   * FIX 1 (devam): offset, start() çağrısına doğrudan geçilir.
   */
  play(when = 0) {
    if (this._state === 'playing') return;

    const offset = this._pauseOffset;

    if (this._workletNode) {
      this._workletNode.port.postMessage({ type: 'play' });
    } else if (this._source) {
      // BufferSourceNode tek kullanımlık; pause→play için yeniden oluştur
      if (this._state === 'paused' && this._buffer) {
        this._prepareBufferSource(this._buffer);
      }
      // offset doğrudan start() argümanı olarak geçiliyor (hata düzeltme)
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
      this._source.stop();
      this._source = null;
    }

    this._state = 'paused';
  }

  stop() {
    try {
      if (this._workletNode) {
        this._workletNode.port.postMessage({ type: 'stop' });
        this._workletNode.disconnect();
        this._workletNode = null;
      }
      if (this._source) {
        this._source.stop();
        this._source.disconnect();
        this._source = null;
      }
      if (this._nextSource) {
        this._nextSource.stop();
        this._nextSource.disconnect();
        this._nextSource = null;
      }
    } catch { /* bilerek yoksay — zaten durmuş olabilir */ }

    this._state = 'stopped';
    this._pauseOffset = 0;
  }

  /* ── Volume / Fade ────────────────────────────────────────── */

  setVolume(value) {
    this.params.volume = value;
    if (this.gainNode) {
      this.gainNode.gain.setTargetAtTime(
        value * AUDIO_CONFIG.MAX_TRACK_VOLUME,
        this._ctx.currentTime,
        0.05,
      );
    }
  }

  fadeTo(targetVolume, duration = AUDIO_CONFIG.CROSSFADE_DURATION) {
    if (!this.gainNode) return;
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
    if (!this.gainNode) return;
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
      if (!this.gainNode) { resolve(); return; }
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
    if (param === 'pitch' && this._source) {
      this._source.playbackRate.setTargetAtTime(value, this._ctx.currentTime, 0.1);
    }
  }

  get isPlaying() { return this._state === 'playing'; }
  get isPaused()  { return this._state === 'paused';  }
  get isStopped() { return this._state === 'stopped' || this._state === 'idle'; }
}

/* ═══════════════════════════════════════════════════════════════
   SECTION 5 — AUDIO WORKLET PROCESSOR KODU
   FIX 2: AmbientProcessor constructor'ına this.phase = 0 eklendi.
═══════════════════════════════════════════════════════════════ */

const WORKLET_PROCESSOR_CODE = /* js */ `
class AmbientProcessor extends AudioWorkletProcessor {
  constructor(options) {
    super(options);
    this.generator = 'wind';
    this.phase = 0;          // FIX 2: phase başlangıç değeri tanımlandı
    this.active = true;
    this.port.onmessage = ({ data }) => {
      if (data.type === 'init')  { this.generator = data.generator || 'wind'; }
      if (data.type === 'param') { Object.assign(this, data); }
      if (data.type === 'stop')  { this.active = false; }
      if (data.type === 'play')  { this.active = true; }
      if (data.type === 'pause') { this.active = false; }
    };
  }

  process(inputs, outputs) {
    const out = outputs[0];
    for (let ch = 0; ch < out.length; ch++) {
      const channel = out[ch];
      for (let i = 0; i < channel.length; i++) {
        if (!this.active) { channel[i] = 0; continue; }
        switch (this.generator) {
          case 'rain':   channel[i] = (Math.random() * 2 - 1) * 0.22; break;
          case 'waves':  channel[i] = Math.sin(this.phase * 0.0008) * 0.18 + (Math.random() * 2 - 1) * 0.06; break;
          case 'fire':   channel[i] = (Math.random() * 2 - 1) * 0.14 * (0.8 + Math.sin(this.phase * 0.003) * 0.2); break;
          default:       channel[i] = (Math.random() * 2 - 1) * 0.14 * Math.abs(Math.sin(this.phase * 0.0002));
        }
        this.phase++;
      }
    }
    return true;
  }
}
registerProcessor('ambient-processor', AmbientProcessor);
`;

/* ═══════════════════════════════════════════════════════════════
   SECTION 6 — AUDIO ENGINE (Singleton)
═══════════════════════════════════════════════════════════════ */

class AudioEngine {
  constructor() {
    if (AudioEngine._instance) return AudioEngine._instance;
    AudioEngine._instance = this;

    this._ctx = null;
    this._masterGain = null;
    this._analyser = null;
    this._layers = new Map();
    this.isInitialized = false;
    this._initPromise = null;
    this._playing = false;

    this._appInBackground = false;
    this._backgroundVolume = 0.4;

    this._adapter = new WebAudioAdapter();
    this._preloadCache = new PreloadCache();

    this._sessionStart = null;
    this._listeners = new Map();

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
        await this._adapter.resumeContext(this._ctx);

        this._masterGain = this._ctx.createGain();
        this._masterGain.gain.value = AUDIO_CONFIG.DEFAULT_MASTER_VOLUME;

        this._analyser = this._ctx.createAnalyser();
        this._analyser.fftSize = AUDIO_CONFIG.FFT_SIZE;
        this._analyser.smoothingTimeConstant = AUDIO_CONFIG.SMOOTHING;

        this._masterGain.connect(this._analyser);
        this._analyser.connect(this._ctx.destination);

        this.isInitialized = true;
        this._emit('initialized');
      } catch (err) {
        this._initPromise = null;
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
    return script;
  }

  async _buildLayers(script) {
    const limit = Math.min(script.tracks.length, AUDIO_CONFIG.MAX_LAYERS);
    const map = new Map();

    for (let i = 0; i < limit; i++) {
      const track = script.tracks[i];
      const id = track.id || track.generator || `track_${i}`;

      let buffer = null;
      if (track.uri) {
        buffer = this._preloadCache.has(track.uri)
          ? this._preloadCache.get(track.uri)
          : await this._preloadCache.load(this._ctx, track.uri, this._adapter);
      }

      const volume = script.mix?.trackVolumes?.[i] ?? track.parameters?.volume ?? 0.5;
      const layer = new AudioLayer(id, track.type || 'granular', { ...track.parameters, volume });
      await layer.initialize(this._ctx, this._masterGain, buffer);

      map.set(id, layer);
    }

    return map;
  }

  /* ── Crossfade ────────────────────────────────────────────── */
  /* FIX 3: currentTime referansı kullanılarak yeni ve eski katmanlar
     aynı zaman noktasından senkronize şekilde başlatılır. */

  async _crossfadeTo(incomingMap, duration) {
    const outgoing = this._layers;
    // Senkronizasyon noktası: her iki fade aynı currentTime'dan başlar
    const now = this._ctx.currentTime;

    // Yeni katmanları sıfır volume'dan tam olarak 'now' anında başlat
    incomingMap.forEach((layer) => {
      layer.gainNode.gain.cancelScheduledValues(now);
      layer.gainNode.gain.setValueAtTime(0, now);
      layer.gainNode.gain.linearRampToValueAtTime(
        layer.params.volume * AUDIO_CONFIG.MAX_TRACK_VOLUME,
        now + duration,
      );
      layer.play(0); // AudioContext zamanlamasıyla başlat
    });

    // Eski katmanları aynı 'now' anında fade-out başlat
    outgoing.forEach((layer) => {
      if (layer.gainNode) {
        layer.gainNode.gain.cancelScheduledValues(now);
        layer.gainNode.gain.setValueAtTime(layer.gainNode.gain.value, now);
        layer.gainNode.gain.linearRampToValueAtTime(0, now + duration);
      }
    });

    // Fade süresi dolunca eski katmanları durdur
    await new Promise((resolve) => setTimeout(resolve, duration * 1000));
    outgoing.forEach((layer) => layer.stop());

    this._layers = incomingMap;
  }

  /* ── Oynatma Kontrolleri ──────────────────────────────────── */

  async play() {
    await this._ensureReady();
    if (this._playing) return;

    this._startAllLayers();
    this._playing = true;
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
        peak: peak / 255,
        average: (sum / data.length) / 255,
      };
    } catch {
      return null;
    }
  }

  get isPlaying()    { return this._playing; }
  get masterVolume() { return this._masterGain?.gain.value ?? 0; }
  get activeLayers() { return Array.from(this._layers.keys()); }
  get contextState() { return this._ctx?.state ?? 'closed'; }

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

  _attachAppStateListeners() {
    if (typeof document === 'undefined') return;

    document.addEventListener('visibilitychange', () => {
      if (document.hidden) {
        this.handleAppBackground();
      } else {
        this.handleAppForeground();
      }
    });

    if (typeof window !== 'undefined') {
      const handler = (event) => {
        try {
          const data = typeof event.data === 'string' ? JSON.parse(event.data) : event.data;
          if (data?.type === 'APP_STATE_CHANGE') {
            if (data.state === 'background') this.handleAppBackground();
            if (data.state === 'active')     this.handleAppForeground();
          }
        } catch { /* yoksay */ }
      };
      window.addEventListener('message', handler);
      document.addEventListener('message', handler);
    }
  }

  _finalizeSession() {
    if (!this._sessionStart) return { duration: 0 };
    const duration = Math.floor((Date.now() - this._sessionStart) / 1000);
    this._sessionStart = null;
    return { duration, timestamp: new Date().toISOString() };
  }

  _startAllLayers() {
    this._layers.forEach((layer) => {
      if (!layer.isPlaying) layer.play();
    });
  }

  async _stopAllLayers() {
    this._layers.forEach((layer) => layer.stop());
    this._layers.clear();
  }

  on(event, callback) {
    if (!this._listeners.has(event)) this._listeners.set(event, new Set());
    this._listeners.get(event).add(callback);
    return () => this._listeners.get(event)?.delete(callback);
  }

  _emit(event, payload) {
    this._listeners.get(event)?.forEach((cb) => {
      try { cb(payload); } catch (err) { console.warn('[AudioEngine] Listener error:', err); }
    });
  }

  async dispose() {
    await this._stopAllLayers();
    this._preloadCache.clear();
    await this._adapter.closeContext(this._ctx);
    this._ctx = null;
    this._masterGain = null;
    this._analyser = null;
    this.isInitialized = false;
    this._playing = false;
    this._listeners.clear();
    AudioEngine._instance = null;
    this._emit('disposed');
  }
}

AudioEngine._instance = null;

/* ═══════════════════════════════════════════════════════════════
   SECTION 7 — LEGACY ADAPTER
═══════════════════════════════════════════════════════════════ */

function createLegacyAdapter() {
  const engine = AudioEngine.getInstance();

  return {
    get isInitialized()   { return engine.isInitialized; },
    get masterGain()      { return engine._masterGain; },
    get analyser()        { return engine._analyser; },

    initialize:           ()           => engine.initialize(),
    loadScript:           (script)     => engine.loadScript(script),
    startAllLayers:       ()           => engine._startAllLayers(),
    stopAllLayers:        ()           => engine._stopAllLayers(),
    togglePlay:           ()           => engine.togglePlay(),
    setTrackVolume:       (id, vol)    => engine.setLayerVolume(id, vol),
    updateTrackParameter: (id, p, v)   => engine.setLayerParameter(id, p, v),
    getAudioData:         ()           => engine.getAudioData(),
    stopAndSaveSession:   ()           => Promise.resolve(engine._finalizeSession()),
    dispose:              ()           => engine.dispose(),
  };
}

/* ═══════════════════════════════════════════════════════════════
   EXPORTS
═══════════════════════════════════════════════════════════════ */

export default AudioEngine;
export { AudioEngine, AudioLayer, PreloadCache, WebAudioAdapter, createLegacyAdapter, AUDIO_CONFIG };

if (typeof module !== 'undefined') {
  module.exports = AudioEngine;
  module.exports.AudioEngine = AudioEngine;
  module.exports.AudioLayer = AudioLayer;
  module.exports.PreloadCache = PreloadCache;
  module.exports.WebAudioAdapter = WebAudioAdapter;
  module.exports.createLegacyAdapter = createLegacyAdapter;
  module.exports.AUDIO_CONFIG = AUDIO_CONFIG;
}
