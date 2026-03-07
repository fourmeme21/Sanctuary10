/**
 * FrequencyManager.js — Sanctuary Harmonik Frekans Yönetimi v1
 * ─────────────────────────────────────────────────────────────────────────────
 * GeminiAdapter'dan gelen frequencySuggestion'ı baseFreq olarak alır,
 * Just Intonation oranları ve Altın Oran (φ) formülüyle harmonik
 * frekans dizisi üretir. İnsan kulağı sınırları (20Hz–20kHz) korunur.
 * ─────────────────────────────────────────────────────────────────────────────
 */

'use strict';

/* ═══════════════════════════════════════════════════════════════
   SABİTLER
═══════════════════════════════════════════════════════════════ */

/** Just Intonation — Saf Mizaç oranları (1 oktav, 8 adım) */
const JUST_INTONATION_RATIOS = [
  1/1,    // Unison
  9/8,    // Büyük ikili (Major 2nd)
  5/4,    // Büyük üçlü (Major 3rd)
  4/3,    // Dörtlü (Perfect 4th)
  3/2,    // Beşli (Perfect 5th)
  5/3,    // Büyük altılı (Major 6th)
  15/8,   // Büyük yedili (Major 7th)
  2/1,    // Oktav
];

/** Altın Oran (φ) */
const PHI = 1.618033988749895;

/** İnsan kulağı frekans sınırları (Hz) */
const FREQ_MIN = 20;
const FREQ_MAX = 20000;

/** Varsayılan temel frekans (GeminiAdapter'dan veri gelmezse) */
const DEFAULT_BASE_FREQ = 432;

/* ═══════════════════════════════════════════════════════════════
   FREQUENCY MANAGER SINIFI
═══════════════════════════════════════════════════════════════ */

class FrequencyManager {

  /**
   * @param {number} [baseFreq]  — Başlangıç temel frekansı (Hz).
   *                               GeminiAdapter'ın frequencySuggestion değeri
   *                               dışarıdan setBaseFreq() ile de atanabilir.
   */
  constructor(baseFreq) {
    this._baseFreq      = this._clamp(baseFreq || DEFAULT_BASE_FREQ);
    this._stepIndex     = 0;   // Just Intonation dizi adım sayacı
    this._phiIndex      = 0;   // Altın Oran üs sayacı
    this._mode          = 'just'; // 'just' | 'phi' | 'blend'
    this._harmonicCache = [];
    this._rebuildCache();
  }

  /* ── Temel Frekans ─────────────────────────────────────────── */

  /**
   * GeminiAdapter'dan gelen frequencySuggestion'ı baseFreq olarak ayarla.
   * @param {number} freq — Hz
   */
  setBaseFreq(freq) {
    if (!isFinite(freq) || freq <= 0) {
      console.warn('[FrequencyManager] Geçersiz baseFreq, varsayılan kullanılıyor:', DEFAULT_BASE_FREQ);
      this._baseFreq = DEFAULT_BASE_FREQ;
    } else {
      this._baseFreq = this._clamp(freq);
    }
    this._stepIndex = 0;
    this._phiIndex  = 0;
    this._rebuildCache();
    console.info('[FrequencyManager] baseFreq güncellendi:', this._baseFreq, 'Hz');
  }

  /**
   * MSD (Musical Scene Descriptor) nesnesinden doğrudan baseFreq ata.
   * GeminiAdapter.generateScene() çıktısıyla uyumludur.
   * @param {object} msd — { frequencySuggestion: number, ... }
   */
  applyMSD(msd) {
    if (msd && typeof msd.frequencySuggestion === 'number') {
      this.setBaseFreq(msd.frequencySuggestion);
    }
  }

  get baseFreq() { return this._baseFreq; }

  /* ── Harmonik Mod ──────────────────────────────────────────── */

  /**
   * Frekans üretim modunu ayarla.
   * @param {'just'|'phi'|'blend'} mode
   */
  setMode(mode) {
    if (['just', 'phi', 'blend'].includes(mode)) {
      this._mode = mode;
      this._stepIndex = 0;
      this._phiIndex  = 0;
    }
  }

  /* ── Frekans Üretici API ───────────────────────────────────── */

  /**
   * Bir sonraki harmonik frekansı döndürür.
   * AudioEngine.js içindeki createOscillator çağrılarında
   * doğrudan frekans değeri yerine bu metod kullanılır.
   *
   * @returns {number} Hz — 20 ile 20000 arasında, harmonik frekans
   */
  getNextFrequency() {
    switch (this._mode) {
      case 'just':  return this._nextJust();
      case 'phi':   return this._nextPhi();
      case 'blend': return this._blendFrequency();
      default:      return this._nextJust();
    }
  }

  /**
   * Binaural beat için sol/sağ kanal frekans çifti döndürür.
   * Sol: baseFreq × ratio  |  Sağ: sol + beatOffset
   * @param {number} beatOffset — Hz (örn: 7)
   * @returns {{ left: number, right: number }}
   */
  getBinauralPair(beatOffset) {
    const beat = (isFinite(beatOffset) && beatOffset > 0) ? beatOffset : 7;
    const left  = this.getNextFrequency();
    const right = this._clamp(left + beat);
    return { left, right };
  }

  /**
   * Tüm Just Intonation harmoniklerini dizi olarak döndürür.
   * (Tam oktav, baseFreq bazlı)
   * @returns {number[]}
   */
  getHarmonicSeries() {
    return [...this._harmonicCache];
  }

  /**
   * Altın Oran serisi: f = baseFreq * φ^k  (k = 0..n-1)
   * @param {number} [count=8]
   * @returns {number[]}
   */
  getPhiSeries(count) {
    count = Math.max(1, count || 8);
    const result = [];
    for (let k = 0; k < count; k++) {
      result.push(this._clamp(this._baseFreq * Math.pow(PHI, k)));
    }
    return result;
  }

  /* ── Dahili Yardımcılar ────────────────────────────────────── */

  /** Just Intonation — sıradaki harmonik adım */
  _nextJust() {
    const ratio = JUST_INTONATION_RATIOS[this._stepIndex % JUST_INTONATION_RATIOS.length];
    this._stepIndex = (this._stepIndex + 1) % JUST_INTONATION_RATIOS.length;
    return this._clamp(this._baseFreq * ratio);
  }

  /** Altın Oran — bir sonraki üs adımı */
  _nextPhi() {
    const freq = this._clamp(this._baseFreq * Math.pow(PHI, this._phiIndex));
    this._phiIndex++;
    // Üst sınıra ulaşıldıysa sıfırla (mod benzeri davranış)
    if (this._baseFreq * Math.pow(PHI, this._phiIndex) > FREQ_MAX) {
      this._phiIndex = 0;
    }
    return freq;
  }

  /** Blend — Just Intonation + Phi oranlarını ağırlıklı karıştır */
  _blendFrequency() {
    const justFreq = this._nextJust();
    const phiRatio = Math.pow(PHI, (this._phiIndex % 4));
    this._phiIndex = (this._phiIndex + 1) % 4;
    const blended  = justFreq * 0.7 + (this._baseFreq * phiRatio) * 0.3;
    return this._clamp(blended);
  }

  /** Harmonik önbelleği yeniden oluştur */
  _rebuildCache() {
    this._harmonicCache = JUST_INTONATION_RATIOS.map(r =>
      this._clamp(this._baseFreq * r)
    );
  }

  /**
   * İnsan kulağı sınırlarına (20Hz–20kHz) sıkıştır.
   * Geçersiz sayılar için DEFAULT_BASE_FREQ döner.
   * @param {number} freq
   * @returns {number}
   */
  _clamp(freq) {
    if (!isFinite(freq) || freq <= 0) return DEFAULT_BASE_FREQ;
    return Math.max(FREQ_MIN, Math.min(FREQ_MAX, freq));
  }
}

/* ═══════════════════════════════════════════════════════════════
   EXPORT — Browser global
═══════════════════════════════════════════════════════════════ */
window.FrequencyManager = FrequencyManager;

/* Kolaylık: tek seferlik singleton factory */
window.getFrequencyManager = (function () {
  let _instance = null;
  return function (baseFreq) {
    if (!_instance) _instance = new FrequencyManager(baseFreq);
    return _instance;
  };
})();
