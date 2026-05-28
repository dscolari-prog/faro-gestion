const https = require('https');
const { createClient } = require('@supabase/supabase-js');

const SUPA_URL = 'https://kfhvpmmkztjdoaiblamq.supabase.co';
const SUPA_KEY = 'sb_publishable_ZAa27PLjlNtOYO77uIUIBQ_w7Y4P3Dk';

async function getAnthropicKey() {
  const sb = createClient(SUPA_URL, SUPA_KEY);
  const { data } = await sb.from('app_config').select('value').eq('key','anthropic_key').single();
  return data?.value;
}

function callAnthropic(apiKey, messages, system) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({
      model: 'claude-sonnet-4-5',
      max_tokens: 4096,
      system,
      messages
    });
    const options = {
      hostname: 'api.anthropic.com',
      path: '/v1/messages',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'Content-Length': Buffer.byteLength(body)
      }
    };
    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => resolve(JSON.parse(data)));
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  try {
    const { messages, context } = req.body;
    const apiKey = await getAnthropicKey();
    if (!apiKey) return res.status(500).json({ error: 'API key not configured' });
    const system = `Sos el asistente interno de RE/MAX FARO.\n${context || ''}\nRespondé siempre en español argentino.`;
    const result = await callAnthropic(apiKey, messages, system);
    if (result.error) return res.status(400).json({ error: result.error.message });
    return res.status(200).json({ reply: result.content[0].text, tokens: result.usage });
  } catch(e) {
    return res.status(500).json({ error: e.message });
  }
};
