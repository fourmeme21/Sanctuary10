/* ══════════════════════════════════════════════════════════════
   AdaptiveEngine.js — Sanctuary Adım 9
   Biyometrik veriye göre ses parametrelerini adapte eder
   ══════════════════════════════════════════════════════════════ */
(function() {
  'use strict';

  var _lastData  = null;
  var _throttle  = null;

  /* Biyometrik → Ses kuralları
     BPM yüksek → binaural artır, parıltı azalt
     HRV düşük  → granular yoğunluk azalt, reverb artır  */
  function onBiometricUpdate(data) {
    _lastData = data;
    if (_throttle) return;
    _throttle = setTimeout(function() {
      _throttle = null;
      _applyAdaptation(data);
    }, 500); /* 500ms debounce */
  }

  function _applyAdaptation(data) {
    if (!window.applyBiometricEffect) return;

    var bpmNorm   = (data.bpm - 45) / 65;   /* 0=düşük, 1=yüksek */
    var hrvNorm   = (data.hrv - 10) / 70;   /* 0=stresli, 1=sakin */
    var stressVal = data.stress;

    var params = {
      binauralBoost  : bpmNorm * 0.4,        /* BPM yüksekse binaural +%40 */
      sparkleReduce  : bpmNorm * 0.5,        /* BPM yüksekse yüksek frekans -%50 */
      granularDensity: hrvNorm,              /* HRV düşükse granular azalt */
      masterVolume   : 0.8 - stressVal * 0.2,/* Stres varsa volume hafif düşür */
      eqLowBoost     : bpmNorm * 3,          /* Düşük frekans EQ boost (dB) */
      eqHighCut      : -(bpmNorm * 2),       /* Yüksek frekans EQ cut (dB) */
    };

    window.applyBiometricEffect(params);
    _updatePanel(data, params);
  }

  function _updatePanel(data, params) {
    var bpmEl    = document.getElementById('bio-bpm');
    var hrvEl    = document.getElementById('bio-hrv');
    var stressEl = document.getElementById('bio-stress');
    var barEl    = document.getElementById('bio-stress-bar');

    if (bpmEl)    bpmEl.textContent    = data.bpm + ' bpm';
    if (hrvEl)    hrvEl.textContent    = data.hrv + ' ms';
    if (stressEl) stressEl.textContent = data.stress < 0.3 ? 'Sakin' : data.stress < 0.6 ? 'Orta' : 'Stresli';
    if (barEl)    barEl.style.width    = (data.stress * 100) + '%';

    /* Renk — yeşil→sarı→kırmızı */
    if (barEl) {
      var h = Math.round((1 - data.stress) * 120);
      barEl.style.background = 'hsl(' + h + ',70%,45%)';
    }
  }

  function getLastData() { return _lastData; }

  window.AdaptiveEngine = { onBiometricUpdate:onBiometricUpdate, getLastData:getLastData };
  console.info('[AdaptiveEngine] Adım 9 hazır');
})();