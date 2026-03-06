/* ══════════════════════════════════════════════════════════════
   LearningEngine.js — Sanctuary Adım 10
   Kullanıcı davranışından ses ağırlıklarını günceller
   ══════════════════════════════════════════════════════════════ */
(function() {
  'use strict';

  var _sessionStart = Date.now();
  var _activeSound  = null;
  var _lastVolume   = 1.0;

  /* Ses değiştiğinde çağrılır */
  function onSoundChange(soundId, volume) {
    if (_activeSound && _activeSound !== soundId) {
      /* Önceki sesi kısa dinlediyse ağırlığı azalt */
      var duration = (Date.now() - _sessionStart) / 1000;
      if (duration < 30 && window.PreferenceManager) {
        window.PreferenceManager.updateSoundWeight(_activeSound, -0.05);
      }
    }
    _activeSound  = soundId;
    _lastVolume   = volume || 1.0;
    _sessionStart = Date.now();
    if (window.PreferenceManager) {
      window.PreferenceManager.updateSoundWeight(soundId, 0.02);
    }
  }

  /* Volume değiştiğinde çağrılır */
  function onVolumeChange(soundId, volume) {
    if (!window.PreferenceManager) return;
    var delta = volume > _lastVolume ? 0.03 : -0.03;
    window.PreferenceManager.updateSoundWeight(soundId || _activeSound, delta);
    _lastVolume = volume;
  }

  /* Oturum bittiğinde çağrılır */
  function onSessionEnd(completionRate) {
    if (window.PreferenceManager) {
      window.PreferenceManager.recordCompletion(completionRate);
      if (_activeSound) {
        window.PreferenceManager.updateSoundWeight(_activeSound, completionRate * 0.1);
      }
    }
    _showOptimizeNotif();
  }

  /* "Senin için optimize ediliyor..." bildirimi */
  function _showOptimizeNotif() {
    var existing = document.getElementById('optimize-notif');
    if (existing) existing.remove();
    var el = document.createElement('div');
    el.id = 'optimize-notif';
    el.textContent = '✦ Senin için optimize ediliyor...';
    el.style.cssText = 'position:fixed;bottom:24px;left:50%;transform:translateX(-50%);background:rgba(6,10,24,0.95);border:1px solid rgba(201,169,110,0.25);border-radius:20px;padding:8px 18px;font-size:11px;color:rgba(201,169,110,0.8);letter-spacing:1px;z-index:900;pointer-events:none;opacity:0;transition:opacity 0.4s;';
    document.body.appendChild(el);
    setTimeout(function(){ el.style.opacity='1'; }, 50);
    setTimeout(function(){ el.style.opacity='0'; setTimeout(function(){ el.remove(); }, 400); }, 3000);
  }

  function showOptimizeNotif() { _showOptimizeNotif(); }

  window.LearningEngine = {
    onSoundChange  : onSoundChange,
    onVolumeChange : onVolumeChange,
    onSessionEnd   : onSessionEnd,
    showOptimizeNotif: showOptimizeNotif
  };
  console.info('[LearningEngine] Adım 10 hazır');
})();