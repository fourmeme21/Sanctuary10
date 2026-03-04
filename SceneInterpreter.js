/**
 * SceneInterpreter.js — MSD → AudioEngine + CSS Komut Çevirici
 * ─────────────────────────────────────────────────────────────────────────────
 * Gemini'den gelen MSD (Musical Scene Descriptor) JSON'unu
 * AudioEngine ve style.css'in anlayacağı komutlara çevirir.
 * ─────────────────────────────────────────────────────────────────────────────
 */

const SceneInterpreter = (function () {

  /* ── Tip → AudioEngine generator eşlemesi ─────────────────────────────── */
  const TYPE_TO_GEN = {
    ambient  : 'waves',
    binaural : 'binaural',
    tone     : 'rain',
    noise    : 'wind',
    fire     : 'fire',
  };

  /* ── CSS tema eşlemesi (frequencySuggestion aralıklarına göre) ─────────── */
  const FREQ_TO_THEME = [
    { max: 100,  theme: 'theme-delta',  label: 'Delta'  },   // 0–100 Hz
    { max: 250,  theme: 'theme-theta',  label: 'Theta'  },   // 100–250 Hz
    { max: 500,  theme: 'theme-alpha',  label: 'Alpha'  },   // 250–500 Hz
    { max: 1000, theme: 'theme-beta',   label: 'Beta'   },   // 500–1000 Hz
    { max: Infinity, theme: 'theme-gamma', label: 'Gamma' },
  ];

  /**
   * MSD'yi AudioEngine komutlarına çevir.
   * @param {object} msd — GeminiAdapter'dan gelen MSD
   * @returns {object}   — { audioCommands, cssCommands, uiCommands }
   */
  function interpret(msd) {
    if (!msd || typeof msd !== 'object') {
      console.error('[SceneInterpreter] Geçersiz MSD:', msd);
      return null;
    }

    return {
      audioCommands : _buildAudioCommands(msd),
      cssCommands   : _buildCSSCommands(msd),
      uiCommands    : _buildUICommands(msd),
    };
  }

  /**
   * Yorumlanan komutları AudioEngine + DOM'a uygula.
   * @param {object} result  — interpret() çıktısı
   * @param {object} options — { engine: AudioEngine instance (opsiyonel) }
   */
  function apply(result, options = {}) {
    if (!result) return;

    /* 1. Ses komutları */
    _applyAudioCommands(result.audioCommands, options.engine);

    /* 2. CSS komutları */
    _applyCSSCommands(result.cssCommands);

    /* 3. UI komutları */
    _applyUICommands(result.uiCommands);
  }

  /* ──────────────────────────────────────────────────────────────────────── */
  /*  AUDIO                                                                   */
  /* ──────────────────────────────────────────────────────────────────────── */

  function _buildAudioCommands(msd) {
    const commands = [];
    const layers   = Array.isArray(msd.layers) ? msd.layers : [];

    layers.forEach((layer) => {
      const gen = TYPE_TO_GEN[layer.type] || 'waves';
      commands.push({
        action  : 'setLayer',
        id      : layer.id,
        gen,
        volume  : typeof layer.volume === 'number' ? Math.max(0, Math.min(1, layer.volume)) : 0.5,
      });
    });

    /* Ana frekans */
    if (msd.frequencySuggestion) {
      commands.push({
        action: 'setFrequency',
        value : msd.frequencySuggestion,
      });
    }

    /* Nefes ritmine göre tempo */
    if (msd.breathPattern) {
      commands.push({
        action       : 'setBreathPattern',
        inhale       : msd.breathPattern.inhale  || 4,
        hold         : msd.breathPattern.hold    || 2,
        exhale       : msd.breathPattern.exhale  || 6,
      });
    }

    return commands;
  }

  function _applyAudioCommands(commands, engine) {
    if (!Array.isArray(commands)) return;

    commands.forEach((cmd) => {
      try {
        switch (cmd.action) {
          case 'setLayer':
            /* window.switchSound varsa ilk ambient katmanı için kullan */
            if (cmd.gen && typeof window.switchSound === 'function') {
              const base = _freqFromGen(cmd.gen);
              const beat = _beatFromGen(cmd.gen);
              window.switchSound(cmd.gen, base, beat, cmd.id);
            }
            /* engine.setLayerVolume varsa uygula */
            if (engine && typeof engine.setLayerVolume === 'function') {
              engine.setLayerVolume(cmd.id, cmd.volume);
            }
            break;

          case 'setFrequency':
            if (typeof window.setFrequency === 'function') {
              window.setFrequency(cmd.value);
            }
            break;

          case 'setBreathPattern':
            /* Nefes döngüsü varsa güncelle */
            if (typeof window.updateBreathPattern === 'function') {
              window.updateBreathPattern(cmd.inhale, cmd.hold, cmd.exhale);
            }
            break;
        }
      } catch (e) {
        console.warn('[SceneInterpreter] Ses komutu hatası:', cmd, e);
      }
    });
  }

  /* ──────────────────────────────────────────────────────────────────────── */
  /*  CSS                                                                     */
  /* ──────────────────────────────────────────────────────────────────────── */

  function _buildCSSCommands(msd) {
    const freq  = msd.frequencySuggestion || 432;
    const entry = FREQ_TO_THEME.find((e) => freq <= e.max) || FREQ_TO_THEME[FREQ_TO_THEME.length - 1];
    return {
      theme : entry.theme,
      label : entry.label,
      tempo : msd.tempo || 60,
    };
  }

  function _applyCSSCommands(css) {
    if (!css) return;
    try {
      const root = document.documentElement;

      /* Tema class'ı */
      root.classList.forEach((cls) => {
        if (cls.startsWith('theme-')) root.classList.remove(cls);
      });
      root.classList.add(css.theme);

      /* Tempo → CSS custom property (animasyon hızı için) */
      const beatDuration = (60 / css.tempo).toFixed(3) + 's';
      root.style.setProperty('--beat-duration', beatDuration);
      root.style.setProperty('--tempo-bpm', css.tempo);
    } catch (e) {
      console.warn('[SceneInterpreter] CSS komutu hatası:', e);
    }
  }

  /* ──────────────────────────────────────────────────────────────────────── */
  /*  UI                                                                      */
  /* ──────────────────────────────────────────────────────────────────────── */

  function _buildUICommands(msd) {
    return {
      sceneName : msd.sceneName   || 'Sanctuary',
      freqLabel : (msd.frequencySuggestion || '') + ' Hz',
      breathPattern: msd.breathPattern || { inhale:4, hold:2, exhale:6 },
    };
  }

  function _applyUICommands(ui) {
    if (!ui) return;
    try {
      /* Sahne adı */
      const nameEl = document.getElementById('scene-name') || document.getElementById('freq-label');
      if (nameEl) nameEl.textContent = ui.sceneName;

      /* Frekans rozeti */
      const freqEl = document.getElementById('freq-label');
      if (freqEl) freqEl.textContent = ui.freqLabel;

      /* AI sonuç alanı */
      const resultEl = document.getElementById('ai-result-text');
      if (resultEl) resultEl.textContent = ui.sceneName + ' sahnesi yüklendi.';

      /* Frekans rozeti görünürlük */
      const badge = document.getElementById('freq-badge');
      if (badge) badge.style.opacity = '1';
    } catch (e) {
      console.warn('[SceneInterpreter] UI komutu hatası:', e);
    }
  }

  /* ── Yardımcı: generator tipinden temel frekans ─────────────────────────── */
  function _freqFromGen(gen) {
    const map = { waves:432, binaural:200, rain:528, wind:396, fire:174 };
    return map[gen] || 432;
  }

  function _beatFromGen(gen) {
    const map = { binaural:7, waves:0, rain:4, wind:8, fire:3 };
    return map[gen] || 0;
  }

  /* ── Public API ─────────────────────────────────────────────────────────── */
  return { interpret, apply };

})();

/* ── Export ───────────────────────────────────────────────────────────────── */
if (typeof module !== 'undefined') {
  module.exports = SceneInterpreter;
} else {
  window.SceneInterpreter = SceneInterpreter;
}
