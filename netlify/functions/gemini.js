/* netlify/functions/gemini.js — MSD Schema v2 */

const DEFAULT_MSD = {
  sceneName: 'Deep Calm',
  tempo: 58,
  frequencySuggestion: 432,
  layers: [
    { id: 'ambient-1', type: 'ambient', volume: 0.6 },
    { id: 'binaural-1', type: 'binaural', volume: 0.25 }
  ],
  breathPattern: { inhale: 4, hold: 4, exhale: 8 }
};

const FALLBACK_TABLE = {
  'Anxious' : { sceneName:'Calm Breath',    tempo:52, frequencySuggestion:396, layers:[{id:'ambient-1',type:'ambient',volume:0.55},{id:'binaural-1',type:'binaural',volume:0.25}], breathPattern:{inhale:4,hold:4,exhale:8} },
  'Stressed': { sceneName:'Deep Peace',     tempo:58, frequencySuggestion:432, layers:[{id:'ambient-1',type:'ambient',volume:0.6}, {id:'binaural-1',type:'binaural',volume:0.2}],  breathPattern:{inhale:4,hold:2,exhale:6} },
  'Tired'   : { sceneName:'Energy Renewal', tempo:65, frequencySuggestion:528, layers:[{id:'ambient-1',type:'ambient',volume:0.5}, {id:'tone-1',type:'tone',volume:0.3}],           breathPattern:{inhale:5,hold:2,exhale:5} },
  'Sad'     : { sceneName:'Light Breath',   tempo:55, frequencySuggestion:417, layers:[{id:'ambient-1',type:'ambient',volume:0.6}, {id:'binaural-1',type:'binaural',volume:0.3}],  breathPattern:{inhale:4,hold:2,exhale:7} },
  'Calm'    : { sceneName:'Focus Flow',     tempo:70, frequencySuggestion:40,  layers:[{id:'ambient-1',type:'ambient',volume:0.45},{id:'binaural-1',type:'binaural',volume:0.35}], breathPattern:{inhale:4,hold:4,exhale:4} },
  'Grateful': { sceneName:'Heart Resonance',tempo:60, frequencySuggestion:528, layers:[{id:'ambient-1',type:'ambient',volume:0.55},{id:'binaural-1',type:'binaural',volume:0.3}],  breathPattern:{inhale:5,hold:3,exhale:6} },
};

function getFallback(mood) {
  return FALLBACK_TABLE[mood] || DEFAULT_MSD;
}

function validateMSD(msd) {
  if (!msd || typeof msd !== 'object') return false;
  if (typeof msd.sceneName !== 'string') return false;
  if (typeof msd.tempo !== 'number' || msd.tempo < 40 || msd.tempo > 120) return false;
  if (typeof msd.frequencySuggestion !== 'number') return false;
  if (!Array.isArray(msd.layers) || msd.layers.length < 1) return false;
  if (!msd.breathPattern) return false;
  const bp = msd.breathPattern;
  if (typeof bp.inhale !== 'number' || typeof bp.exhale !== 'number') return false;
  return true;
}

exports.handler = async function(event) {
  const headers = {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
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
    console.warn('[gemini.js] GEMINI_API_KEY not set — returning fallback MSD');
    return { statusCode: 200, headers, body: JSON.stringify(getFallback('Calm')) };
  }

  let userMood = '', userInput = '';
  try {
    const body = JSON.parse(event.body || '{}');
    userMood  = body.mood   || body.prompt || '';
    userInput = body.input  || '';
  } catch(e) {
    console.error('[gemini.js] Body parse error:', e.message);
  }

  const systemPrompt = `You are Sanctuary AI Oracle, a sound therapy composer.
The user mood: "${userMood}"
The user note: "${userInput || 'Not specified'}"

Design a personalized sound environment. Reply ONLY with valid JSON matching this exact schema, no markdown, no explanation:

{
  "sceneName": "short evocative name",
  "tempo": 60,
  "frequencySuggestion": 432,
  "layers": [
    { "id": "ambient-1", "type": "ambient", "volume": 0.6 },
    { "id": "binaural-1", "type": "binaural", "volume": 0.25 }
  ],
  "breathPattern": {
    "inhale": 4,
    "hold": 4,
    "exhale": 8
  }
}

Rules:
- tempo: integer 40-120
- frequencySuggestion: one of 40,174,285,396,417,432,528,639,741,852
- volume: float 0.0-1.0
- layers: 1-4 items, type must be "ambient","binaural","tone"
- breathPattern values are integers (seconds)
- Output ONLY the JSON object`;

  const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`;

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: systemPrompt }] }],
        generationConfig: { temperature: 0.7, maxOutputTokens: 300 },
      }),
    });

    const data = await response.json();
    console.log('[gemini.js] status:', response.status);
    console.log('[gemini.js] raw:', JSON.stringify(data).substring(0, 300));

    if (!response.ok) {
      console.error('[gemini.js] API error:', response.status);
      return { statusCode: 200, headers, body: JSON.stringify(getFallback(userMood)) };
    }

    const text = data?.candidates?.[0]?.content?.parts?.[0]?.text || '';
    const clean = text.replace(/```json|```/gi, '').trim();

    let msd;
    try {
      msd = JSON.parse(clean);
    } catch(e) {
      console.error('[gemini.js] JSON parse error:', e.message, 'raw:', clean.substring(0,100));
      return { statusCode: 200, headers, body: JSON.stringify(getFallback(userMood)) };
    }

    if (!validateMSD(msd)) {
      console.warn('[gemini.js] Invalid MSD — fallback. Got:', JSON.stringify(msd).substring(0, 150));
      return { statusCode: 200, headers, body: JSON.stringify(getFallback(userMood)) };
    }

    console.log('[gemini.js] Valid MSD:', msd.sceneName, msd.frequencySuggestion + 'Hz');
    return { statusCode: 200, headers, body: JSON.stringify(msd) };

  } catch(e) {
    console.error('[gemini.js] fetch error:', e.message);
    return { statusCode: 200, headers, body: JSON.stringify(getFallback(userMood)) };
  }
};
