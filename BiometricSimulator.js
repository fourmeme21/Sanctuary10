/* ══════════════════════════════════════════════════════════════
   BiometricSimulator.js — Sanctuary Adım 9
   Web'de HealthKit olmadığı için BPM + HRV simülasyonu
   ══════════════════════════════════════════════════════════════ */
(function() {
  'use strict';

  var _bpm       = 72;   /* Kalp atışı (40-120) */
  var _hrv       = 45;   /* HRV ms (10-80) */
  var _stress    = 0.3;  /* 0=sakin, 1=stresli */
  var _interval  = null;
  var _listeners = [];

  /* Rastgele doğal dalgalanma */
  function _naturalDrift() {
    _bpm = Math.max(45, Math.min(110, _bpm + (Math.random() - 0.5) * 3));
    _hrv = Math.max(10, Math.min(80,  _hrv + (Math.random() - 0.5) * 2));
    _stress = Math.max(0, Math.min(1, (_bpm - 45) / 65));
    _notify();
  }

  function _notify() {
    var data = { bpm: Math.round(_bpm), hrv: Math.round(_hrv), stress: parseFloat(_stress.toFixed(2)) };
    _listeners.forEach(function(fn) { try { fn(data); } catch(e){} });
    /* AdaptiveEngine'i tetikle */
    if (window.AdaptiveEngine) window.AdaptiveEngine.onBiometricUpdate(data);
  }

  function start(intervalMs) {
    if (_interval) return;
    _interval = setInterval(_naturalDrift, intervalMs || 3000);
    console.info('[BiometricSim] Başladı');
  }

  function stop() {
    clearInterval(_interval);
    _interval = null;
  }

  function setBPM(val) {
    _bpm = Math.max(45, Math.min(110, val));
    _stress = (_bpm - 45) / 65;
    _notify();
  }

  function setHRV(val) {
    _hrv = Math.max(10, Math.min(80, val));
    _notify();
  }

  function subscribe(fn) { _listeners.push(fn); }

  function getState() {
    return { bpm: Math.round(_bpm), hrv: Math.round(_hrv), stress: parseFloat(_stress.toFixed(2)) };
  }

  window.BiometricSimulator = { start:start, stop:stop, setBPM:setBPM, setHRV:setHRV, subscribe:subscribe, getState:getState };
  console.info('[BiometricSimulator] Adım 9 hazır');
})();