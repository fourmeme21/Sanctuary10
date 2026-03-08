/* netlify/functions/gemini.js — Maestro Schema v3.2
   FIX: gemini-2.5-flash thinking modu JSON'u kesiyor.
   Çözüm: thinkingConfig ile thinking kapatıldı.
   Fallback model: gemini-1.5-flash (thinking yok, hızlı)
*/

const DEFAULT_MAESTRO = {
  sceneName:'Calm Breath', baseHz:432, binauralHz:4.0,
  textures:[{name:'ocean',gain:0.60},{name:'wind',gain:0.25}],
  breath:[4,4,8],
};

const FALLBACK_TABLE = {
  'Anxious' :{sceneName:'Calm Breath',    baseHz:396, binauralHz:6.0,  textures:[{name:'ocean',gain:0.55},{name:'wind', gain:0.30},{name:'piano', gain:0.20}],breath:[4,4,8]},
  'Stressed':{sceneName:'Deep Peace',     baseHz:432, binauralHz:6.0,  textures:[{name:'rain', gain:0.55},{name:'piano',gain:0.25}],                          breath:[4,2,6]},
  'Tired'   :{sceneName:'Energy Renewal', baseHz:528, binauralHz:10.0, textures:[{name:'birds',gain:0.50},{name:'wind', gain:0.35},{name:'guitar',gain:0.20}],breath:[5,2,5]},
  'Sad'     :{sceneName:'Light Breath',   baseHz:417, binauralHz:5.0,  textures:[{name:'ocean',gain:0.60},{name:'flute',gain:0.25}],                          breath:[4,2,7]},
  'Calm'    :{sceneName:'Focus Flow',     baseHz:40,  binauralHz:7.0,  textures:[{name:'ocean',gain:0.45},{name:'piano',gain:0.30}],                          breath:[4,4,4]},
  'Grateful':{sceneName:'Heart Resonance',baseHz:528, binauralHz:10.0, textures:[{name:'birds',gain:0.50},{name:'guitar',gain:0.30}],                         breath:[5,3,6]},
  'قلق'  :{sceneName:'تنفس هادئ',    baseHz:396, binauralHz:6.0,  textures:[{name:'ocean',gain:0.55},{name:'wind', gain:0.30}],breath:[4,4,8]},
  'مجهد' :{sceneName:'سلام عميق',    baseHz:432, binauralHz:6.0,  textures:[{name:'rain', gain:0.55},{name:'piano',gain:0.25}],breath:[4,2,6]},
  'متعب' :{sceneName:'تجديد الطاقة', baseHz:528, binauralHz:10.0, textures:[{name:'birds',gain:0.50},{name:'wind', gain:0.35}],breath:[5,2,5]},
  'حزين' :{sceneName:'نفس النور',    baseHz:417, binauralHz:5.0,  textures:[{name:'ocean',gain:0.60},{name:'flute',gain:0.25}],breath:[4,2,7]},
  'هادئ' :{sceneName:'تدفق التركيز', baseHz:40,  binauralHz:7.0,  textures:[{name:'ocean',gain:0.45},{name:'piano',gain:0.30}],breath:[4,4,4]},
  'ممتنّ':{sceneName:'رنين القلب',   baseHz:528, binauralHz:10.0, textures:[{name:'birds',gain:0.50},{name:'guitar',gain:0.30}],breath:[5,3,6]},
};

function getFallback(mood) {
  return FALLBACK_TABLE[mood] || DEFAULT_MAESTRO;
}

function validateMaestro(d) {
  if (!d || typeof d !== 'object') return false;
  if (typeof d.baseHz !== 'number' || d.baseHz < 20 || d.baseHz > 2000) return false;
  if (typeof d.binauralHz !== 'number' || d.binauralHz < 0.5 || d.binauralHz > 40) return false;
  if (!Array.isArray(d.textures) || d.textures.length < 1) return false;
  for (const t of d.textures) {
    if (!t || typeof t.name !== 'string') return false;
    if (typeof t.gain !== 'number' || t.gain < 0 || t.gain > 1) return false;
  }
  if (!Array.isArray(d.breath) || d.breath.length < 2) return false;
  return true;
}

async function callGemini(apiKey, model, systemPrompt, thinkingBudget) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;

  const body = {
    contents        : [{parts:[{text: systemPrompt}]}],
    generationConfig: {
      temperature    : 0.8,
      maxOutputTokens: 512,
    },
  };

  /* Thinking budget — 0 = thinking kapalı (2.5-flash için) */
  if (thinkingBudget !== undefined) {
    body.generationConfig.thinkingConfig = { thinkingBudget };
  }

  const response = await fetch(url, {
    method : 'POST',
    headers: {'Content-Type':'application/json'},
    body   : JSON.stringify(body),
  });

  const data = await response.json();
  return { response, data };
}

exports.handler = async function(event) {
  const headers = {
    'Content-Type'                : 'application/json',
    'Access-Control-Allow-Origin' : '*',
    'Access-Control-Allow-Headers': 'Content-Type',
  };

  if (event.httpMethod === 'OPTIONS') return {statusCode:204, headers, body:''};
  if (event.httpMethod !== 'POST')    return {statusCode:405, headers, body:JSON.stringify({error:'Method Not Allowed'})};

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    console.warn('[gemini.js] GEMINI_API_KEY yok');
    return {statusCode:200, headers, body:JSON.stringify(getFallback('Calm'))};
  }

  let userMood = '', userInput = '';
  try {
    const body = JSON.parse(event.body || '{}');
    userMood  = body.mood  || body.prompt || '';
    userInput = body.input || '';
  } catch(e) {}

  const systemPrompt = `Sound therapy AI. Mood:"${userMood}" Note:"${userInput||'none'}"
Reply with ONLY this JSON object, nothing else, no markdown:
{"sceneName":"NAME","baseHz":432,"binauralHz":7.0,"textures":[{"name":"ocean","gain":0.6},{"name":"piano","gain":0.3}],"breath":[4,4,8]}
baseHz: one of [40,174,285,396,417,432,528,639,741,852]
binauralHz: 0.5-40.0
textures: 1-3 items, name one of [ocean,rain,wind,birds,fire,piano,guitar,flute], gain 0.05-0.75
breath: [inhale,hold,exhale] as integers`;

  try {
    /* ── Deneme 1: gemini-2.5-flash, thinking kapalı (budget=0) ── */
    console.log('[gemini.js] Deneme 1: gemini-2.5-flash (thinkingBudget:0)');
    let { response, data } = await callGemini(apiKey, 'gemini-2.5-flash', systemPrompt, 0);

    console.log('[gemini.js] status:', response.status);
    console.log('[gemini.js] raw:', JSON.stringify(data).substring(0, 400));

    let text = '';
    if (response.ok) {
      text = data?.candidates?.[0]?.content?.parts?.[0]?.text || '';
    }

    /* ── Deneme 2: 2.5-flash başarısızsa gemini-1.5-flash ── */
    if (!text || data?.candidates?.[0]?.finishReason === 'MAX_TOKENS') {
      console.warn('[gemini.js] Deneme 2: gemini-1.5-flash');
      const r2 = await callGemini(apiKey, 'gemini-1.5-flash', systemPrompt, undefined);
      console.log('[gemini.js] 1.5-flash raw:', JSON.stringify(r2.data).substring(0, 400));
      if (r2.response.ok) {
        text = r2.data?.candidates?.[0]?.content?.parts?.[0]?.text || '';
      }
    }

    if (!text) {
      console.error('[gemini.js] İki model de boş döndü');
      return {statusCode:200, headers, body:JSON.stringify(getFallback(userMood))};
    }

    const clean = text.replace(/```json|```/gi, '').trim();
    console.log('[MAESTRO DEBUG] Gemini metin:', clean.substring(0, 300));

    let maestro;
    try {
      maestro = JSON.parse(clean);
    } catch(e) {
      console.error('[gemini.js] JSON parse hatası:', e.message, '| metin:', clean.substring(0, 150));
      return {statusCode:200, headers, body:JSON.stringify(getFallback(userMood))};
    }

    if (!validateMaestro(maestro)) {
      console.warn('[gemini.js] Geçersiz Maestro — fallback:', JSON.stringify(maestro).substring(0, 200));
      return {statusCode:200, headers, body:JSON.stringify(getFallback(userMood))};
    }

    console.log('[gemini.js] ✅ Maestro Onaylandı:', maestro.sceneName, '|', maestro.baseHz+'Hz /', maestro.binauralHz+'Hz binaural /', maestro.textures.length, 'texture');
    return {statusCode:200, headers, body:JSON.stringify(maestro)};

  } catch(e) {
    console.error('[gemini.js] fetch hatası:', e.message);
    return {statusCode:200, headers, body:JSON.stringify(getFallback(userMood))};
  }
};
