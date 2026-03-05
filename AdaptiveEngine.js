/* ══════════════════════════════════════════════════════════════
   AdaptiveEngine.js — Sanctuary Adım 9
   Biyometrik veriye göre ses parametrelerini adapte eder
   ══════════════════════════════════════════════════════════════ */
(function() {
  'use strict';

  var _lastData  = null;
  var _throttle  = null;

  function onBiometricUpdate(data) {
    _lastData = data;
    if (_throttle) return;
    _throttle = setTimeout(function() {
      _throttle = null;
      _applyAdaptation(data);
    }, 500);
  }

  function _applyAdaptation(data) {
    if (!window.applyBiometricEffect) return;

    var bpmNorm   = (data.bpm - 45) / 65;
    var hrvNorm   = (data.hrv - 10) / 70;
    var stressVal = data.stress;

    var params = {
      binauralBoost  : bpmNorm * 0.4,
      sparkleReduce  : bpmNorm * 0.5,
      granularDensity: hrvNorm,
      masterVolume   : 0.8 - stressVal * 0.2,
      eqLowBoost     : bpmNorm * 3,
      eqHighCut      : -(bpmNorm * 2),
    };

    window.applyBiometricEffect(params);
    _updatePanel(data, params);
  }

  function _updatePanel(data, params) {
    var barEl    = document.getElementById('bio-fill');
    var stressEl = document.getElementById('bio-status');
    if (barEl) {
      barEl.style.width = (data.stress * 100) + '%';
      var h = Math.round((1 - data.stress) * 120);
      barEl.style.background = 'hsl(' + h + ',70%,50%)';
    }
    if (stressEl) stressEl.textContent = data.stress < 0.3 ? 'Sakin' : data.stress < 0.6 ? 'Orta' : 'Stresli';

    var bpmEl = document.getElementById('bio-bpm');
    var hrvEl = document.getElementById('bio-hrv');
    if (bpmEl) bpmEl.textContent = data.bpm + ' bpm';
    if (hrvEl) hrvEl.textContent = data.hrv + ' ms';
  }

  function getLastData() { return _lastData; }

  window.AdaptiveEngine = { onBiometricUpdate:onBiometricUpdate, getLastData:getLastData };
  console.info('[AdaptiveEngine] Adım 9 hazır');
})();