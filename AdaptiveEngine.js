/* ══════════════════════════════════════════════════════════════
   AdaptiveEngine.js — Sanctuary Adım 9
   Biyometrik veriye göre ses parametrelerini adapte eder
   ══════════════════════════════════════════════════════════════ */
(function() {
  'use strict';

  var _lastData = null;
  var _throttle = null;

  function onBiometricUpdate(data) {
    _lastData = data;
    if (_throttle) return;
    _throttle = setTimeout(function() {
      _throttle = null;
      _applyAdaptation(_lastData);
    }, 500);
  }

  function _applyAdaptation(data) {
    if (!window.applyBiometricEffect) return;
    var bpmNorm   = (data.bpm - 45) / 65;
    var hrvNorm   = (data.hrv - 10) / 70;
    var stressVal = data.stress;
    window.applyBiometricEffect({
      binauralBoost  : bpmNorm * 0.4,
      sparkleReduce  : bpmNorm * 0.5,
      granularDensity: hrvNorm,
      masterVolume   : 0.8 - stressVal * 0.2,
      eqLowBoost     : bpmNorm * 3,
      eqHighCut      : -(bpmNorm * 2),
    });
  }

  function getLastData() { return _lastData; }

  window.AdaptiveEngine = { onBiometricUpdate:onBiometricUpdate, getLastData:getLastData };
  console.info('[AdaptiveEngine] Adım 9 hazır');
})();