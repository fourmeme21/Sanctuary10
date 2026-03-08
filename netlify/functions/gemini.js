/* netlify/functions/gemini.js — Maestro Schema v3
   ─────────────────────────────────────────────────────────────────────────────
   Gemini'ye Maestro formatında cevap döndürmesi talimatı veriliyor:
   { sceneName, baseHz, binauralHz, textures:[{name,gain}], breath:[i,h,e] }
   ─────────────────────────────────────────────────────────────────────────────
*/

/* ── Default Maestro: 432Hz / 4Hz theta / %60 ocean ── */
const DEFAULT_MAESTRO = {
  sceneName  : 'Calm Breath',
  baseHz     : 432,
  binauralHz : 4.0,
  textures   : [
    { name: 'ocean', gain: 0.60 },
    { name: 'wind',  gain: 0.25 },
  ],
  breath     : [4, 4, 8],
};

/* ── Mood bazlı fallback tablosu (Maestro formatında) ── */
const FALLBACK_TABLE = {
  'Anxious' : { sceneName:'Calm Breath',     baseHz:396, binauralHz:6.0,  textures:[{name:'ocean',gain:0.55},{name:'wind', gain:0.30},{name:'piano', gain:0.20}], breath:[4,4,8] },
  'Stressed': { sceneName:'Deep Peace',      baseHz:432, binauralHz:6.0,  textures:[{name:'rain', gain:0.55},{name:'piano',gain:0.25}],                           breath:[4,2,6] },
  'Tired'   : { sceneName:'Energy Renewal',  baseHz:528, binauralHz:10.0, textures:[{name:'birds',gain:0.50},{name:'wind', gain:0.35},{name:'guitar',gain:0.20}], breath:[5,2,5] },
  'Sad'     : { sceneName:'Light Breath',    baseHz:417, binauralHz:5.0,  textures:[{name:'ocean',gain:0.60},{name:'flute',gain:0.25}],                           breath:[4,2,7] },
  'Calm'    : { sceneName:'Focus Flow',      baseHz:40,  binauralHz:7.0,  textures:[{name:'ocean',gain:0.45},{name:'piano',gain:0.30}],                           breath:[4,4,4] },
  'Grateful': { sceneName:'Heart Resonance', baseHz:528, binauralHz:10.0, textures:[{name:'birds',gain:0.50},{name:'guitar',gain:0.30}],                          breath:[5,3,6] },
  /* Arapça */
  'قلق'  : { sceneName:'تنفس هادئ',    baseHz:396, binauralHz:6.0,  textures:[{name:'ocean',gain:0.55},{name:'wind', gain:0.30}], breath:[4,4,8] },
  'مجهد' : { sceneName:'سلام عميق',    baseHz:432, binauralHz:6.0,  textures:[{name:'rain', gain:0.55},{name:'piano',gain:0.25}], breath:[4,2,6] },
  'متعب' : { sceneName:'تجديد الطاقة', baseHz:528, binauralHz:10.0, textures:[{name:'birds',gain:0.50},{name:'wind', gain:0.35}], breath:[5,2,5] },
  'حزين' : { sceneName:'نفس النور',    baseHz:417, binauralHz:5.0,  textures:[{name:'ocean',gain:0.60},{name:'flute',gain:0.25}], breath:[4,2,7] },
  'هادئ' : { sceneName:'تدفق التركيز', baseHz:40,  binauralHz:7.0,  textures:[{name:'ocean',gain:0.45},{name:'piano',gain:0.30}], breath:[4,4,4] },
  'ممتنّ': { sceneName:'رنين القلب',   baseHz:528, binauralHz:10.0, textures:[{name:'birds',gain:0.50},{name:'guitar',gain:0.30}], breath:[5,3,6] },
};

function getFallback(mood) {
  return FALLBACK_TABLE[mood] || DEFAULT_MAESTRO;
}

/* ── Maestro şema doğrulayıcı ──
   Sadece yeni formatı kontrol eder: baseHz, binauralHz, textures, breath
   tempo / layers / frequencySuggestion artık ARANMIYOR               */
function validateMaestro(data) {
  if (!data || typeof data !== 'object')                        return false;
  if (typeof data.baseHz !== 'number' ||
      data.baseHz < 20  || data.baseHz > 2000)                 return false;
  if (typeof data.binauralHz !== 'number' ||
      data.binauralHz < 0.5 || data.binauralHz > 40)           return false;
  if (!Array.isArray(data.textures) || data.textures.length < 1) return false;
  for (const t of data.textures) {
    if (!t || typeof t.name !== 'string')                       return false;
    if (typeof t.gain !== 'number' || t.gain < 0 || t.gain > 1) return false;
  }
  if (!Array.isArray(data.breath) || data.breath.length < 2)   return false;
  return true;
}

exports.handler = async function(event) {
  const headers = {
    'Content-Type'                : 'application/json',
    'Access-Control-Allow-Origin' : '*',
    'Access-Control-Allow-Headers': 'Content-Type',
  };

  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 204, headers, body: '' };
  }
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, headers, body: JSON.stringify({ error: 'Method Not Allowed' }) };
  }

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    console.warn('[gemini.js] GEMINI_API_KEY yok — fallback döndürülüyor');
    return { statusCode: 200, headers, body: JSON.stringify(getFallback('Calm')) };
  }

  let userMood = '', userInput = '';
  try {
    const body = JSON.parse(event.body || '{}');
    userMood  = body.mood  || body.prompt || '';
    userInput = body.input || '';
  } catch(e) {
    console.error('[gemini.js] Body parse hatası:', e.message);
  }

  /* ════════════════════════════════════════════════════════════════════════
     MAESTRO SYSTEM PROMPT
     Gemini'ye tam olarak Maestro formatını döndürmesi talimatı veriliyor.
     Eski format (tempo, frequencySuggestion, layers) artık istenmıyor.
  ════════════════════════════════════════════════════════════════════════ */
  const systemPrompt = `You are Sanctuary AI Oracle, a professional sound therapy composer.

User mood: "${userMood}"
User note: "${userInput || 'Not specified'}"

Design a personalized healing sound environment. Reply ONLY with a valid JSON object — no markdown, no explanation, no extra text.

Required JSON schema:
{
  "sceneName"  : "short evocative English name (2-4 words)",
  "baseHz"     : 432,
  "binauralHz" : 7.0,
  "textures"   : [
    { "name": "ocean", "gain": 0.6 },
    { "name": "piano", "gain": 0.3 }
  ],
  "breath"     : [4, 4, 8]
}

Rules:
- baseHz: one of these exact values: 40, 174, 285, 396, 417, 432, 528, 639, 741, 852
- binauralHz: float between 0.5 and 40.0 (choose based on desired brainwave state: delta 0.5-4, theta 4-8, alpha 8-13, beta 13-30)
- textures: array of 1-4 objects. name must be one of: ocean, rain, wind, birds, fire, forest, piano, guitar, flute, night
- gain: float between 0.05 and 0.75 per texture
- breath: array of exactly 3 integers [inhale_seconds, hold_seconds, exhale_seconds]
- Output ONLY the JSON object, nothing else`;

  const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`;

  try {
    const response = await fetch(url, {
      method : 'POST',
      headers: { 'Content-Type': 'application/json' },
      body   : JSON.stringify({
        contents        : [{ parts: [{ text: systemPrompt }] }],
        generationConfig: { temperature: 0.8, maxOutputTokens: 512 },
      }),
    });

    const data = await response.json();
    console.log('[gemini.js] HTTP status:', response.status);
    console.log('[gemini.js] raw:', JSON.stringify(data).substring(0, 400));

    if (!response.ok) {
      console.error('[gemini.js] API hatası:', response.status);
      return { statusCode: 200, headers, body: JSON.stringify(getFallback(userMood)) };
    }

    const text  = data?.candidates?.[0]?.content?.parts?.[0]?.text || '';
    const clean = text.replace(/```json|```/gi, '').trim();

    console.log('[MAESTRO DEBUG] Gemini ham metin:', clean.substring(0, 300));

    let maestro;
    try {
      maestro = JSON.parse(clean);
    } catch(e) {
      console.error('[gemini.js] JSON parse hatası:', e.message);
      return { statusCode: 200, headers, body: JSON.stringify(getFallback(userMood)) };
    }

    if (!validateMaestro(maestro)) {
      console.warn('[gemini.js] Geçersiz Maestro şeması — fallback. Gelen:', JSON.stringify(maestro).substring(0, 200));
      return { statusCode: 200, headers, body: JSON.stringify(getFallback(userMood)) };
    }

    console.log('[gemini.js] ✅ Maestro Onaylandı:', maestro.sceneName, maestro.baseHz + 'Hz /', maestro.binauralHz + 'Hz binaural /', maestro.textures.length, 'texture');
    return { statusCode: 200, headers, body: JSON.stringify(maestro) };

  } catch(e) {
    console.error('[gemini.js] fetch hatası:', e.message);
    return { statusCode: 200, headers, body: JSON.stringify(getFallback(userMood)) };
  }
};
