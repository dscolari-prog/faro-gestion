const https = require('https');
const { createClient } = require('@supabase/supabase-js');

const SUPA_URL = 'https://kfhvpmmkztjdoaiblamq.supabase.co';
const SUPA_KEY = 'sb_publishable_ZAa27PLjlNtOYO77uIUIBQ_w7Y4P3Dk';
const GITHUB_TOKEN = process.env.GITHUB_TOKEN;
const GITHUB_OWNER = 'dscolari-prog';
const GITHUB_REPO = 'faro-gestion';
const GITHUB_FILE = 'index.html';

async function getAnthropicKey() {
  const sb = createClient(SUPA_URL, SUPA_KEY);
  const { data } = await sb.from('app_config').select('value').eq('key','anthropic_key').single();
  return data?.value;
}

function githubRequest(method, path, body) {
  return new Promise((resolve, reject) => {
    const bodyStr = body ? JSON.stringify(body) : '';
    const options = {
      hostname: 'api.github.com',
      path,
      method,
      headers: {
        'Authorization': `token ${GITHUB_TOKEN}`,
        'User-Agent': 'faro-gestion-bot',
        'Accept': 'application/vnd.github.v3+json',
        'Content-Type': 'application/json',
        ...(bodyStr ? { 'Content-Length': Buffer.byteLength(bodyStr) } : {})
      }
    };
    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try { resolve({ status: res.statusCode, data: JSON.parse(data) }); }
        catch(e) { resolve({ status: res.statusCode, data }); }
      });
    });
    req.on('error', reject);
    if (bodyStr) req.write(bodyStr);
    req.end();
  });
}

function callAnthropic(apiKey, messages, system) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({
      model: 'claude-sonnet-4-5',
      max_tokens: 8192,
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
    const { action, description, messages, context } = req.body;
    const apiKey = await getAnthropicKey();
    if (!apiKey) return res.status(500).json({ error: 'API key not configured' });

    if (action === 'chat') {
      const system = `Sos el asistente interno de RE/MAX FARO.\n${context || ''}\nRespondé en español argentino.`;
      const result = await callAnthropic(apiKey, messages, system);
      if (result.error) return res.status(400).json({ error: result.error.message });
      return res.status(200).json({ reply: result.content[0].text });
    }

    if (action === 'modify') {
      if (!GITHUB_TOKEN) return res.status(500).json({ error: 'GITHUB_TOKEN no configurado en Vercel' });

      const fileRes = await githubRequest('GET', `/repos/${GITHUB_OWNER}/${GITHUB_REPO}/contents/${GITHUB_FILE}`);
      if (fileRes.status !== 200) return res.status(500).json({ error: 'No se pudo obtener el archivo de GitHub' });

      const fileSha = fileRes.data.sha;
      const currentContent = Buffer.from(fileRes.data.content, 'base64').toString('utf-8');

      const modifySystem = `Sos un experto en JavaScript y HTML. Modificá el código de esta aplicación web.
Respondé ÚNICAMENTE con el código HTML completo modificado, sin explicaciones, sin markdown, sin backticks.
El código debe ser válido y funcional. Mantenés toda la funcionalidad existente.`;

      const modifyMessages = [{
        role: 'user',
        content: `Cambio solicitado: ${description}\n\nCódigo actual:\n${currentContent.slice(0, 50000)}\n\n[resto del archivo omitido]\n\nDevolvé SOLO el HTML completo modificado.`
      }];

      const modResult = await callAnthropic(apiKey, modifyMessages, modifySystem);
      if (modResult.error) return res.status(400).json({ error: modResult.error.message });

      const newContent = modResult.content[0].text;

      if (!newContent.includes('<!DOCTYPE') && !newContent.includes('<html')) {
        return res.status(400).json({ error: 'La IA no generó HTML válido', preview: newContent.slice(0, 200) });
      }

      const encoded = Buffer.from(newContent).toString('base64');
      const pushRes = await githubRequest('PUT', `/repos/${GITHUB_OWNER}/${GITHUB_REPO}/contents/${GITHUB_FILE}`, {
        message: `IA: ${description.slice(0, 72)}`,
        content: encoded,
        sha: fileSha
      });

      if (pushRes.status !== 200 && pushRes.status !== 201) {
        return res.status(500).json({ error: 'Error al guardar en GitHub', details: pushRes.data });
      }

      return res.status(200).json({
        success: true,
        message: `Cambio aplicado: "${description}". Vercel redesplegará en 2 minutos.`,
        commit: pushRes.data.commit?.sha?.slice(0, 7)
      });
    }

    return res.status(400).json({ error: 'Acción no reconocida' });

  } catch(e) {
    return res.status(500).json({ error: e.message });
  }
};
