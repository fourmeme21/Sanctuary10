/**
 * main.js — 2. Aşama Güncellemeleri
 * ─────────────────────────────────────────────────────────────────────────────
 * Bu dosya mevcut main.js'e EKLENECEK veya içindeki ilgili fonksiyonlar
 * aşağıdaki güncellenmiş versiyonlarla DEĞİŞTİRİLECEK.
 *
 * Değişiklikler:
 *   1. Ripple (Dalga) Efekti  — mousedown olayında .ripple-circle oluşturur
 *   2. startBreathCycle       — setVolume yerine fadeTo kullanır (yumuşak geçiş)
 * ─────────────────────────────────────────────────────────────────────────────
 */

/* ══════════════════════════════════════════════════════════════════
   BÖLÜM 1 — RİPPLE (DALGA) EFEKTİ
   Mevcut main.js'e bu bloğu ekleyin (DOMContentLoaded içine veya
   dosyanın ilk çalışan bölümüne).
══════════════════════════════════════════════════════════════════ */

/**
 * Ripple efektini başlatır.
 * mousedown olayında tıklama koordinatında .ripple-circle oluşturur,
 * animasyon bitince DOM'dan kaldırır.
 *
 * Kullanım: initRippleEffect() — uygulama başlarken bir kez çağır.
 */
function initRippleEffect() {
  document.addEventListener('mousedown', function (e) {
    // Buton ve etkileşimli elementler için zaten animasyon var; tekrar ekleme
    if (e.target.closest('button, .cta-btn, .play-btn, .back-btn')) return;

    const ripple = document.createElement('div');
    ripple.className = 'ripple-circle';

    // Boyutu viewport'a göre hesapla (daha görünür etki için)
    const size = Math.max(window.innerWidth, window.innerHeight) * 0.6;
    ripple.style.width  = size + 'px';
    ripple.style.height = size + 'px';
    ripple.style.left   = e.clientX + 'px';
    ripple.style.top    = e.clientY + 'px';

    document.body.appendChild(ripple);

    // Animasyon bitince DOM'dan temizle (memory leak önlemi)
    ripple.addEventListener('animationend', function () {
      ripple.remove();
    }, { once: true });
  });
}

// ── Çağrı — DOMContentLoaded içinde veya script sonunda: ──
// initRippleEffect();


/* ══════════════════════════════════════════════════════════════════
   BÖLÜM 2 — NEFES DÖNGÜSÜ (startBreathCycle)
   Mevcut startBreathCycle fonksiyonunu bu versiyonla değiştirin.
   setVolume yerine fadeTo kullanarak ses geçişleri yumuşatılır.
══════════════════════════════════════════════════════════════════ */

/**
 * Nefes döngüsünü başlatır ve ses motoru ile senkronize eder.
 *
 * @param {object} engine        — AudioEngine instance (veya legacy adapter)
 * @param {object} breathWrap    — .breath-wrap DOM elementi
 * @param {HTMLElement} guideEl  — .breath-guide DOM elementi
 * @param {object} [options]     — Özelleştirme seçenekleri
 * @param {number} [options.inhale=4]    — Nefes alma süresi (sn)
 * @param {number} [options.hold=2]      — Tutma süresi (sn)
 * @param {number} [options.exhale=6]    — Nefes verme süresi (sn)
 * @param {number} [options.volInhale=0.85] — Nefes alırken hedef volume
 * @param {number} [options.volExhale=0.55] — Nefes verirken hedef volume
 * @returns {Function} — Döngüyü durduran cleanup fonksiyonu
 */
function startBreathCycle(engine, breathWrap, guideEl, options = {}) {
  const {
    inhale   = 4,
    hold     = 2,
    exhale   = 6,
    volInhale = 0.85,
    volExhale = 0.55,
  } = options;

  let stopped = false;
  let timers  = [];

  function clearTimers() {
    timers.forEach(clearTimeout);
    timers = [];
  }

  function setGuide(text, active = true) {
    if (!guideEl) return;
    guideEl.textContent = text;
    guideEl.classList.toggle('on', active);
  }

  function setBreathClass(cls) {
    if (!breathWrap) return;
    breathWrap.classList.remove('breath-inhale', 'breath-hold', 'breath-exhale', 'breath-idle');
    if (cls) breathWrap.classList.add(cls);
  }

  /**
   * Ses seviyesini yumuşak fade ile değiştirir.
   * setVolume'un anlık geçişi yerine fadeTo'nun kademeli eğrisini kullanır.
   */
  function smoothVolume(target, duration) {
    if (!engine) return;
    try {
      if (typeof engine.fadeTo === 'function') {
        // AudioEngine: layer bazlı fade
        engine._layers?.forEach((layer) => layer.fadeTo(target, duration * 0.9));
      } else if (typeof engine.setMasterVolume === 'function') {
        // Kademeli master volume (setTargetAtTime ile)
        engine.setMasterVolume(target);
      }
    } catch (err) {
      console.warn('[BreathCycle] Volume fade error:', err);
    }
  }

  function runCycle() {
    if (stopped) return;

    // — İNHALE —
    setBreathClass('breath-inhale');
    setGuide('Breathe in…');
    smoothVolume(volInhale, inhale);

    timers.push(setTimeout(() => {
      if (stopped) return;

      // — HOLD —
      setBreathClass('breath-hold');
      setGuide('Hold');
      // Volume sabit: tekrar fade başlatmaya gerek yok

      timers.push(setTimeout(() => {
        if (stopped) return;

        // — EXHALE —
        setBreathClass('breath-exhale');
        setGuide('Breathe out…');
        smoothVolume(volExhale, exhale);

        timers.push(setTimeout(() => {
          if (stopped) return;
          // Döngü tekrar başlasın
          runCycle();
        }, exhale * 1000));

      }, hold * 1000));

    }, inhale * 1000));
  }

  // Döngüyü başlat
  runCycle();

  // Cleanup fonksiyonu döndür
  return function stopBreathCycle() {
    stopped = true;
    clearTimers();
    setBreathClass('breath-idle');
    setGuide('', false);
  };
}


/* ══════════════════════════════════════════════════════════════════
   BÖLÜM 3 — ENTEGRASYON ÖRNEĞİ
   Mevcut main.js'de şu değişiklikleri yapın:
══════════════════════════════════════════════════════════════════ */

/*

// 1. DOMContentLoaded içinde ripple'ı başlat:
document.addEventListener('DOMContentLoaded', () => {
  initRippleEffect();

  // ... diğer init kodları ...
});


// 2. Sanctuary ekranına girildiğinde nefes döngüsünü başlat:
let stopBreath = null;

function enterSanctuaryScreen() {
  const engine    = AudioEngine.getInstance();  // veya audioOrchestrator
  const breathWrap = document.querySelector('.breath-wrap');
  const guideEl   = document.querySelector('.breath-guide');

  // Önceki döngüyü temizle
  if (stopBreath) stopBreath();

  stopBreath = startBreathCycle(engine, breathWrap, guideEl, {
    inhale:    4,
    hold:      2,
    exhale:    6,
    volInhale: 0.85,
    volExhale: 0.55,
  });
}

// Sanctuary'den çıkarken döngüyü durdur:
function exitSanctuaryScreen() {
  if (stopBreath) {
    stopBreath();
    stopBreath = null;
  }
}

*/


/* ══════════════════════════════════════════════════════════════════
   EXPORTS (ES Module ortamı için)
══════════════════════════════════════════════════════════════════ */

// ES Module
export { initRippleEffect, startBreathCycle };

// CommonJS
if (typeof module !== 'undefined') {
  module.exports = { initRippleEffect, startBreathCycle };
}
