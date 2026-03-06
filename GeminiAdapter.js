/**
 * GeminiAdapter.js — Sanctuary AI Oracle Katmanı
 * ─────────────────────────────────────────────────────────────────────────────
 * Kullanıcının ruh halini alır, Gemini API'ye gönderir,
 * MSD (Musical Scene Descriptor) JSON döndürür.
 *
 * GÜVENLİK NOTU:
 *   API anahtarını frontend'e gömme. Üretim ortamında bir backend proxy
 *   (örn. /api/gemini) veya environment değişkeni (VITE_GEMINI_KEY) kullan.
 *   Geliştirme sırasında window.SANCTUARY_GEMINI_KEY ile runtime'da set edilebilir.
 * ─────────────────────────────────────────────────────────────────────────────
 */

const GEMINI_API_URL =
  'https://generativelanguage.googleapis.com/v1beta/models/gemini-pro:generateContent';

const GEMINI_TIMEOUT_MS = 10000; // 10 saniye

/* ── MSD Şema Tanımı (dökümantasyon amaçlı) ──────────────────────────────────
 * {
 *   sceneName        : string,          // "Derin Odak", "Gece Huzuru" vb.
 *   tempo            : number,          // BPM (40–120)
 *   frequencySuggestion: number,        // Hz (40–1000)
 *   layers: [
 *     { id: string, type: string, volume: number }   // type: ambient|binaural|tone
 *   ],
 *   breathPattern: {
 *     inhale : number,   // saniye
 *     hold   : number,   // saniye
 *     exhale : number    // saniye
 *   }
 * }
 * ─────────────────────────────────────────────────────────────────────────────
 */

class GeminiAdapter {
  /**
   * @param {object} config
   * @param {string} [config.apiKey]        — Runtime API anahtarı (opsiyonel)
   * @param {string} [config.fallbackPath]  — Fallback JSON dosyasının URL'i
   */
  constructor(config = {}) {
    this._apiKey      = config.apiKey
                     || (typeof window !== 'undefined' && window.SANCTUARY_GEMINI_KEY)
                     || null;
    this._fallbackPath = config.fallbackPath || './offline-fallback.json';
    this._fallbackData = null;   // önbelleğe alınan fallback
  }

  /* ── API anahtarını runtime'da güvenli set et ─────────────────────────── */
  setApiKey(key) {
    if (typeof key === 'string' && key.trim().length > 0) {
      this._apiKey = key.trim();
    }
  }

  /* ── Ana metod ─────────────────────────────────────────────────────────── */
  /**
   * Kullanıcı girdisine göre MSD üretir.
   * @param {string} userInput    — Kullanıcının yazdığı metin
   * @param {string} selectedMood — Seçilen ruh hali etiketi (ör. "Kaygılı")
   * @returns {Promise<MSD>}
   */
  async generateScene(userInput, selectedMood) {
    if (!this._apiKey) {
      console.warn('[GeminiAdapter] API anahtarı yok — fallback kullanılıyor.');
      return this._getFallback(selectedMood);
    }

    const prompt = this._buildPrompt(userInput, selectedMood);

    try {
      const msd = await this._callGemini(prompt);
      return this._validateMSD(msd) ? msd : this._getFallback(selectedMood);
    } catch (err) {
      console.error('[GeminiAdapter] API hatası:', err.message);
      return this._getFallback(selectedMood);
    }
  }

  /* ── Prompt oluşturucu ─────────────────────────────────────────────────── */
  _buildPrompt(userInput, selectedMood) {
    return `Sen Sanctuary AI Oracle'sın. Bir müzik terapisti gibi davran.

Kullanıcının ruh hali: "${selectedMood}"
Kullanıcının notu: "${userInput || 'Belirtilmedi'}"

Görevin: Kullanıcının ruh haline uygun bir ses ortamı tasarla.
SADECE aşağıdaki JSON formatında yanıt ver, başka hiçbir şey yazma:

{
  "sceneName": "sahne adı",
  "tempo": 60,
  "frequencySuggestion": 432,
  "layers": [
    { "id": "ambient-1", "type": "ambient", "volume": 0.6 },
    { "id": "binaural-1", "type": "binaural", "volume": 0.3 }
  ],
  "breathPattern": {
    "inhale": 4,
    "hold": 2,
    "exhale": 6
  }
}

Kurallar:
- tempo: 40 ile 120 BPM arası
- frequencySuggestion: 40 ile 1000 Hz arası
- volume: 0.0 ile 1.0 arası
- layers: en az 1, en fazla 4 katman
- breathPattern değerleri saniye cinsinden
- Yanıt yalnızca geçerli JSON olmalı, markdown veya açıklama içermemeli`;
  }

  /* ── Gemini API çağrısı (timeout + hata yönetimi) ─────────────────────── */
  async _callGemini(prompt) {
    const controller = new AbortController();
    const timeoutId  = setTimeout(() => controller.abort(), GEMINI_TIMEOUT_MS);

    let response;
    try {
      response = await fetch(`${GEMINI_API_URL}?key=${this._apiKey}`, {
        method : 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal : controller.signal,
        body   : JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: {
            temperature    : 0.7,
            maxOutputTokens: 512,
          },
        }),
      });
    } finally {
      clearTimeout(timeoutId);
    }

    if (!response.ok) {
      throw new Error(`Gemini HTTP ${response.status}: ${response.statusText}`);
    }

    const data = await response.json();

    /* Gemini yanıt yapısını ayrıştır */
    const text = data?.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!text) throw new Error('Gemini boş yanıt döndürdü.');

    /* JSON'u temizle (markdown kod bloğu varsa kaldır) */
    const clean = text.replace(/```json|```/gi, '').trim();

    let msd;
    try {
      msd = JSON.parse(clean);
    } catch {
      throw new Error(`Geçersiz JSON: ${clean.slice(0, 100)}`);
    }

    return msd;
  }

  /* ── MSD doğrulama ─────────────────────────────────────────────────────── */
  _validateMSD(msd) {
    if (!msd || typeof msd !== 'object')                     return false;
    if (typeof msd.sceneName !== 'string')                   return false;
    if (typeof msd.tempo !== 'number' || msd.tempo < 40 || msd.tempo > 120) return false;
    if (typeof msd.frequencySuggestion !== 'number')         return false;
    if (!Array.isArray(msd.layers) || msd.layers.length < 1) return false;
    if (!msd.breathPattern)                                  return false;
    const bp = msd.breathPattern;
    if (typeof bp.inhale !== 'number' || typeof bp.exhale !== 'number') return false;
    return true;
  }

  /* ── Fallback yükle ve döndür ─────────────────────────────────────────── */
  async _getFallback(mood) {
    /* Önce önbellekten dene */
    if (this._fallbackData) {
      return this._selectFallbackScene(this._fallbackData, mood);
    }

    try {
      const res  = await fetch(this._fallbackPath);
      const data = await res.json();
      this._fallbackData = data;
      return this._selectFallbackScene(data, mood);
    } catch {
      /* Fetch de başarısızsa hardcoded fallback */
      return this._hardcodedFallback(mood);
    }
  }

  _selectFallbackScene(data, mood) {
    /* data.scenes nesnesi varsa mood'a göre seç */
    if (data.scenes && data.scenes[mood]) return data.scenes[mood];
    if (data.scenes && data.scenes['default']) return data.scenes['default'];
    if (data.default) return data.default;
    return this._hardcodedFallback(mood);
  }

  /* ── Hardcoded son çare fallback tablosu (Rapor 3.2) ─────────────────── */
  _hardcodedFallback(mood) {
    const table = {
      'Kaygılı' : { sceneName:'Sakin Nefes',   tempo:52, frequencySuggestion:396, layers:[{id:'ambient-1',type:'ambient',volume:0.55},{id:'binaural-1',type:'binaural',volume:0.25}], breathPattern:{inhale:4,hold:4,exhale:8}  },
      'Huzursuz': { sceneName:'Derin Huzur',    tempo:58, frequencySuggestion:432, layers:[{id:'ambient-1',type:'ambient',volume:0.6}, {id:'binaural-1',type:'binaural',volume:0.2}],  breathPattern:{inhale:4,hold:2,exhale:6}  },
      'Yorgun'  : { sceneName:'Enerji Yenileme',tempo:65, frequencySuggestion:528, layers:[{id:'ambient-1',type:'ambient',volume:0.5}, {id:'tone-1',type:'tone',volume:0.3}],           breathPattern:{inhale:5,hold:2,exhale:5}  },
      'Mutsuz'  : { sceneName:'Işık Nefesi',    tempo:55, frequencySuggestion:417, layers:[{id:'ambient-1',type:'ambient',volume:0.6}, {id:'binaural-1',type:'binaural',volume:0.3}],  breathPattern:{inhale:4,hold:2,exhale:7}  },
      'Sakin'   : { sceneName:'Odak Akışı',     tempo:70, frequencySuggestion:40,  layers:[{id:'ambient-1',type:'ambient',volume:0.45},{id:'binaural-1',type:'binaural',volume:0.35}], breathPattern:{inhale:4,hold:4,exhale:4}  },
      'Minnettar':{ sceneName:'Kalp Rezonansı', tempo:60, frequencySuggestion:528, layers:[{id:'ambient-1',type:'ambient',volume:0.55},{id:'binaural-1',type:'binaural',volume:0.3}],  breathPattern:{inhale:5,hold:3,exhale:6}  },
    };
    return table[mood] || table['Sakin'];
  }
}

/* ── Export ───────────────────────────────────────────────────────────────── */
if (typeof module !== 'undefined') {
  module.exports = GeminiAdapter;
} else {
  window.GeminiAdapter = GeminiAdapter;
}