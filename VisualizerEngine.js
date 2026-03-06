/* ══════════════════════════════════════════════════════════════
   VisualizerEngine.js — Sanctuary Adım 12
   AnalyserNode → Canvas görselleştirme
   ══════════════════════════════════════════════════════════════ */
(function() {
  'use strict';

  var _canvas    = null;
  var _ctx       = null;
  var _analyser  = null;
  var _dataArray = null;
  var _rafId     = null;
  var _active    = false;
  var _mood      = 'default';

  var MOOD_COLORS = {
    'default'   : { primary: '#4ecdc4', secondary: '#c9a96e', bg: 'rgba(7,7,26,0)' },
    'huzursuz'  : { primary: '#ff6b6b', secondary: '#c9a96e', bg: 'rgba(7,7,26,0)' },
    'yorgun'    : { primary: '#6c63ff', secondary: '#9896b8', bg: 'rgba(7,7,26,0)' },
    'mutlu'     : { primary: '#ffd93d', secondary: '#c9a96e', bg: 'rgba(7,7,26,0)' },
    'odaklan'   : { primary: '#4ecdc4', secondary: '#6c63ff', bg: 'rgba(7,7,26,0)' },
    'uyu'       : { primary: '#9896b8', secondary: '#4ecdc4', bg: 'rgba(7,7,26,0)' },
  };

  function init(canvasId, analyserNode) {
    _canvas   = document.getElementById(canvasId);
    if (!_canvas) return;
    _ctx      = _canvas.getContext('2d');
    _analyser = analyserNode;
    if (_analyser) {
      _analyser.fftSize = 256;
      _dataArray = new Uint8Array(_analyser.frequencyBinCount);
    }
    _resize();
    window.addEventListener('resize', _resize);
    console.info('[VisualizerEngine] Başlatıldı');
  }

  function _resize() {
    if (!_canvas) return;
    _canvas.width  = _canvas.offsetWidth  * (window.devicePixelRatio || 1);
    _canvas.height = _canvas.offsetHeight * (window.devicePixelRatio || 1);
    _ctx.scale(window.devicePixelRatio || 1, window.devicePixelRatio || 1);
  }

  function start() {
    if (_active) return;
    _active = true;
    _draw();
  }

  function stop() {
    _active = false;
    if (_rafId) { cancelAnimationFrame(_rafId); _rafId = null; }
    if (_ctx && _canvas) _ctx.clearRect(0, 0, _canvas.offsetWidth, _canvas.offsetHeight);
  }

  function setMood(mood) {
    _mood = (mood || 'default').toLowerCase();
  }

  function _draw() {
    if (!_active || !_canvas || !_ctx) return;
    _rafId = requestAnimationFrame(_draw);

    var W = _canvas.offsetWidth;
    var H = _canvas.offsetHeight;
    var cx = W / 2, cy = H / 2;
    var colors = MOOD_COLORS[_mood] || MOOD_COLORS['default'];

    _ctx.clearRect(0, 0, W, H);

    /* Frekans verisi */
    var avg = 0.3;
    if (_analyser && _dataArray) {
      _analyser.getByteFrequencyData(_dataArray);
      var sum = 0;
      for (var i = 0; i < _dataArray.length; i++) sum += _dataArray[i];
      avg = sum / (_dataArray.length * 255);
    } else {
      /* Analyser yoksa yumuşak nefes animasyonu */
      avg = 0.25 + Math.sin(Date.now() / 2000) * 0.1;
    }

    /* Nefes alan halkalar */
    var rings = 4;
    for (var r = 0; r < rings; r++) {
      var progress = r / rings;
      var radius   = 30 + progress * Math.min(cx, cy) * 0.7 + avg * 40;
      var alpha    = (1 - progress) * 0.35 * (0.6 + avg * 0.8);
      var color    = r % 2 === 0 ? colors.primary : colors.secondary;

      _ctx.beginPath();
      _ctx.arc(cx, cy, radius, 0, Math.PI * 2);
      _ctx.strokeStyle = color + Math.round(alpha * 255).toString(16).padStart(2,'0');
      _ctx.lineWidth   = 1.2 - progress * 0.6;
      _ctx.stroke();
    }

    /* Merkez nokta */
    var dotR = 4 + avg * 8;
    var grad = _ctx.createRadialGradient(cx, cy, 0, cx, cy, dotR * 2);
    grad.addColorStop(0, colors.primary + 'cc');
    grad.addColorStop(1, colors.primary + '00');
    _ctx.beginPath();
    _ctx.arc(cx, cy, dotR, 0, Math.PI * 2);
    _ctx.fillStyle = grad;
    _ctx.fill();
  }

  window.VisualizerEngine = { init: init, start: start, stop: stop, setMood: setMood };
  console.info('[VisualizerEngine] Adım 12 hazır');
})();