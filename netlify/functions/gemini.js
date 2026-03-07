/* netlify/functions/gemini.js */

exports.handler = async function(event) {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return { statusCode: 500, body: JSON.stringify({ error: 'No API key', message: 'Your frequency has been designed.', freq: 432, beat: 7 }) };
  }

  let userMood = '';
  try {
    const body = JSON.parse(event.body);
    userMood = body.prompt || '';
  } catch(e) {}

  const prompt = `Sound therapy AI. User says: "${userMood}". Reply ONLY with JSON: {"message":"one sentence","freq":396,"beat":6}. freq options: 174,285,396,417,432,528,639,741,852`;

  /* gemini-2.0-flash-lite dene */
  const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash-lite:generateContent?key=${apiKey}`;

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: { temperature: 0.7, maxOutputTokens: 100 },
      }),
    });

    const data = await response.json();
    console.log('status:', response.status);
    console.log('data:', JSON.stringify(data).substring(0, 200));

    const text = data?.candidates?.[0]?.content?.parts?.[0]?.text || '';
    const clean = text.replace(/```json|```/g, '').trim();

    let result;
    try {
      result = JSON.parse(clean);
    } catch(e) {
      result = { message: clean.substring(0, 100) || 'Your frequency has been designed.', freq: 432, beat: 7 };
    }

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
      body: JSON.stringify(result),
    };

  } catch(e) {
    console.error('fetch error:', e.message);
    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: 'Your frequency has been designed.', freq: 432, beat: 7 }),
    };
  }
};
