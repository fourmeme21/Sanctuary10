/**
 * FMSynthesizer.js — Sanctuary FM Sentez Motoru
 * ─────────────────────────────────────────────────────────────────────────────
 * 2 operatörlü FM sentezleyici: Taşıyıcı (Carrier) + Modülatör
 * Derin frekanslar, binaural vuruşlar ve meditasyon tonları için ADSR zarf.
 * ─────────────────────────────────────────────────────────────────────────────
 */

class FMSynthesizer {
  /**
   * @param {AudioContext} ctx
   * @param {AudioNode}    destination
   * @param {object}       params
   * @param {number}       params.carrierFreq    — Hz (taşıyıcı frekans)
   * @param {number}       params.modulatorRatio — modülatör/taşıyıcı oranı
   * @param {number}       params.modulationIndex — modülasyon derinliği
   * @param {number}       params.volume          — 0–1
   * @param {object}       params.adsr            — { attack, decay, sustain, release } saniye
   * @param {boolean}      params.binaural        — stereo binaural mod
   * @param {number}       params.binauralBeat    — Hz fark (binaural)
   */
  constructor(ctx, destination, params = {}) {
    this._ctx         = ctx;
    this._destination = destination;
    this._active      = false;

    /* Operatör node'ları */
    this._carrier     = null;
    this._modulator   = null;
    this._modGain     = null;
    this._outputGain  = null;
    this._carrierR    = null;   // binaural sağ kanal
    this._merger      = null;

    this.params = {
      carrierFreq    : params.carrierFreq     || 432,
      modulatorRatio : params.modulatorRatio  || 2.0,
      modulationIndex: params.modulationIndex || 3.0,
      volume         : Math.max(0, Math.min(1, params.volume || 0.5)),
      binaural       : params.binaural        || false,
      binauralBeat   : params.binauralBeat    || 7,       // Hz
      adsr           : {
        attack : params.adsr?.attack  ?? 2.0,    // saniye
        decay  : params.adsr?.decay   ?? 1.0,
        sustain: params.adsr?.sustain ?? 0.75,   // seviye (0–1)
        release: params.adsr?.release ?? 3.0,
      },
    };
  }

  /* ── Başlat ───────────────────────────────────────────────────────────── */
  start() {
    if (this._active) return;
    this._active = true;

    const ctx = this._ctx;
    const now = ctx.currentTime;
    const p   = this.params;

    /* ── Çıkış gain ── */
    this._outputGain = ctx.createGain();
    this._outputGain.gain.setValueAtTime(0, now);
    this._outputGain.connect(this._destination);

    if (p.binaural) {
      this._startBinaural(now);
    } else {
      this._startMono(now);
    }

    /* ADSR: Attack → Decay → Sustain */
    this._applyADSR(now);
  }

  /* ── Durdur (Release fazı) ─────────────────────────────────────────────── */
  stop() {
    if (!this._active) return;
    this._active = false;

    const ctx     = this._ctx;
    const now     = ctx.currentTime;
    const release = this.params.adsr.release;

    /* Release fade */
    this._outputGain.gain.cancelScheduledValues(now);
    this._outputGain.gain.setValueAtTime(this._outputGain.gain.value, now);
    this._outputGain.gain.linearRampToValueAtTime(0, now + release);

    /* Tüm osc'ları release sonrası kapat */
    const stopTime = now + release + 0.1;
    [this._carrier, this._carrierR, this._modulator].forEach((osc) => {
      if (!osc) return;
      try { osc.stop(stopTime); } catch { /* ok */ }
    });

    setTimeout(() => this.dispose(), (release + 0.3) * 1000);
  }

  /* ── Parametre güncelle ───────────────────────────────────────────────── */
  setCarrierFreq(freq) {
    if (!isFinite(freq) || freq <= 0) return;
    this.params.carrierFreq = freq;
    const now = this._ctx.currentTime;
    if (this._carrier)  this._carrier.frequency.setTargetAtTime(freq, now, 0.1);
    if (this._carrierR) this._carrierR.frequency.setTargetAtTime(freq + this.params.binauralBeat, now, 0.1);
    if (this._modulator) {
      const modFreq = freq * this.params.modulatorRatio;
      this._modulator.frequency.setTargetAtTime(modFreq, now, 0.1);
      if (this._modGain) {
        this._modGain.gain.setTargetAtTime(modFreq * this.params.modulationIndex, now, 0.1);
      }
    }
  }

  setModulationIndex(index) {
    if (!isFinite(index)) return;
    this.params.modulationIndex = index;
    const now     = this._ctx.currentTime;
    const modFreq = this.params.carrierFreq * this.params.modulatorRatio;
    if (this._modGain) {
      this._modGain.gain.setTargetAtTime(modFreq * index, now, 0.1);
    }
  }

  setVolume(vol) {
    vol = Math.max(0, Math.min(1, vol));
    this.params.volume = vol;
    if (this._outputGain && this._active) {
      const now = this._ctx.currentTime;
      this._outputGain.gain.setTargetAtTime(vol * this.params.adsr.sustain, now, 0.2);
    }
  }

  /* ── Reverb iskeleti ──────────────────────────────────────────────────── */
  /**
   * Basit convolver-based reverb zinciri.
   * @param {number} roomSize  — 0–1
   * @param {number} wetMix    — 0–1
   */
  addReverb(roomSize = 0.3, wetMix = 0.25) {
    const ctx = this._ctx;
    const impulse = this._makeImpulse(roomSize);

    const convolver = ctx.createConvolver();
    convolver.buffer = impulse;

    const wetGain = ctx.createGain();
    wetGain.gain.value = wetMix;

    const dryGain = ctx.createGain();
    dryGain.gain.value = 1 - wetMix;

    /* Zincir: outputGain → dry → destination */
    /*                      → convolver → wet → destination */
    this._outputGain.disconnect();
    this._outputGain.connect(dryGain);
    this._outputGain.connect(convolver);
    dryGain.connect(this._destination);
    convolver.connect(wetGain);
    wetGain.connect(this._destination);
  }

  /* ── Saturation iskeleti ─────────────────────────────────────────────── */
  /**
   * Yumuşak harmonik zenginleştirme (waveshaper).
   * @param {number} amount — 0–1 (sıcaklık miktarı)
   */
  addSaturation(amount = 0.2) {
    const ctx    = this._ctx;
    const shaper = ctx.createWaveShaper();
    shaper.curve    = this._makeSaturationCurve(amount);
    shaper.oversample = '4x';

    this._outputGain.disconnect();
    this._outputGain.connect(shaper);
    shaper.connect(this._destination);
  }

  /* ── Temizlik ─────────────────────────────────────────────────────────── */
  dispose() {
    [this._carrier, this._carrierR, this._modulator, this._modGain,
     this._outputGain, this._merger].forEach((node) => {
      if (!node) return;
      try { node.disconnect(); } catch { /* ok */ }
    });
    this._carrier = this._carrierR = this._modulator =
    this._modGain = this._outputGain = this._merger = null;
  }

  /* ────────────────────────────────────────────────────────────────────────
   * ÖZEL METODLAR
   * ──────────────────────────────────────────────────────────────────────── */

  _startMono(now) {
    const ctx = this._ctx;
    const p   = this.params;

    /* Modülatör */
    this._modulator = ctx.createOscillator();
    this._modulator.type            = 'sine';
    this._modulator.frequency.value = p.carrierFreq * p.modulatorRatio;

    this._modGain = ctx.createGain();
    this._modGain.gain.value = p.carrierFreq * p.modulatorRatio * p.modulationIndex;

    this._modulator.connect(this._modGain);

    /* Taşıyıcı */
    this._carrier = ctx.createOscillator();
    this._carrier.type            = 'sine';
    this._carrier.frequency.value = p.carrierFreq;

    this._modGain.connect(this._carrier.frequency);  // FM bağlantısı
    this._carrier.connect(this._outputGain);

    this._modulator.start(now);
    this._carrier.start(now);
  }

  _startBinaural(now) {
    const ctx = this._ctx;
    const p   = this.params;

    this._merger = ctx.createChannelMerger(2);
    this._merger.connect(this._outputGain);

    /* Sol kanal — taşıyıcı */
    this._modulator = ctx.createOscillator();
    this._modulator.type            = 'sine';
    this._modulator.frequency.value = p.carrierFreq * p.modulatorRatio;

    this._modGain = ctx.createGain();
    this._modGain.gain.value = p.carrierFreq * p.modulatorRatio * p.modulationIndex;

    this._modulator.connect(this._modGain);

    this._carrier = ctx.createOscillator();
    this._carrier.type            = 'sine';
    this._carrier.frequency.value = p.carrierFreq;
    this._modGain.connect(this._carrier.frequency);

    const leftGain = ctx.createGain();
    leftGain.gain.value = 0.7;
    this._carrier.connect(leftGain);
    leftGain.connect(this._merger, 0, 0);

    /* Sağ kanal — binauralBeat Hz fark */
    this._carrierR = ctx.createOscillator();
    this._carrierR.type            = 'sine';
    this._carrierR.frequency.value = p.carrierFreq + p.binauralBeat;

    const rightGain = ctx.createGain();
    rightGain.gain.value = 0.7;
    this._carrierR.connect(rightGain);
    rightGain.connect(this._merger, 0, 1);

    this._modulator.start(now);
    this._carrier.start(now);
    this._carrierR.start(now);
  }

  _applyADSR(now) {
    const { attack, decay, sustain, release } = this.params.adsr;
    const peakVol = this.params.volume;
    const susVol  = peakVol * sustain;
    const g       = this._outputGain.gain;

    g.setValueAtTime(0, now);
    g.linearRampToValueAtTime(peakVol, now + attack);           // Attack
    g.linearRampToValueAtTime(susVol, now + attack + decay);    // Decay → Sustain
    /* Sustain seviyesi release başlayana kadar sabit kalır */
  }

  /* Impulse response (basit üstel çürüme) */
  _makeImpulse(roomSize) {
    const ctx    = this._ctx;
    const sr     = ctx.sampleRate;
    const length = Math.floor(sr * (0.5 + roomSize * 2.5));
    const buf    = ctx.createBuffer(2, length, sr);

    for (let ch = 0; ch < 2; ch++) {
      const d = buf.getChannelData(ch);
      for (let i = 0; i < length; i++) {
        const decay = Math.pow(1 - i / length, 2 + roomSize * 3);
        d[i] = (Math.random() * 2 - 1) * decay;
      }
    }
    return buf;
  }

  /* Waveshaper eğrisi (yumuşak kırpma) */
  _makeSaturationCurve(amount) {
    const n      = 256;
    const curve  = new Float32Array(n);
    const k      = amount * 100;
    for (let i = 0; i < n; i++) {
      const x  = (i * 2) / n - 1;
      curve[i] = x * (Math.PI + k) / (Math.PI + k * Math.abs(x));
    }
    return curve;
  }
}

/* ── Export ───────────────────────────────────────────────────────────────── */
if (typeof module !== 'undefined') {
  module.exports = FMSynthesizer;
} else {
  window.FMSynthesizer = FMSynthesizer;
}
