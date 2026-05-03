// Load .env file manually — tsx does not auto-load it
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
try {
  const envFile = readFileSync(resolve(process.cwd(), '.env'), 'utf-8');
  for (const line of envFile.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eqIdx = trimmed.indexOf('=');
    if (eqIdx === -1) continue;
    const key = trimmed.slice(0, eqIdx).trim();
    const val = trimmed.slice(eqIdx + 1).trim();
    if (key && !(key in process.env)) process.env[key] = val;
  }
} catch { /* no .env file — rely on host environment */ }

import express, { Request, Response } from 'express';
import path from 'path';
import multer from 'multer';
import cors from 'cors';

interface MulterRequest extends Request {
  file?: Express.Multer.File;
}

const MISTRAL_API_KEY = process.env.MISTRAL_API_KEY;

const app = express();
app.use(cors());
app.use(express.json({ limit: '10mb' }));
const upload = multer({ storage: multer.memoryStorage() });

// Health check
app.get('/api/health', (_req: Request, res: Response) => {
  res.json({ status: 'ok', mistralConfigured: !!MISTRAL_API_KEY });
});

// Mistral Pixtral image analysis
async function analyzeImageWithMistral(imageBuffer: Buffer, imageMime: string, userContext: string): Promise<string> {
  if (!MISTRAL_API_KEY) throw new Error('MISTRAL_API_KEY is not configured on the server.');

  const b64 = imageBuffer.toString('base64');
  const dataUrl = `data:${imageMime};base64,${b64}`;

  const prompt = `You are a scam detection assistant. Analyze this image carefully and extract:
1. All visible text (exact words, numbers, URLs, email addresses)
2. Any logos, brand names, or company names
3. Urgency indicators (countdown timers, limited time offers, act now etc.)
4. Requests for personal info, passwords, seed phrases, or money transfers
5. Suspicious links or domains
6. Type of content (email, SMS, website, app screen, etc.)
${userContext ? `User context: ${userContext}` : ''}
Be thorough — your description will be used by an AI scam detector to reach consensus.`;

  const res = await fetch('https://api.mistral.ai/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${MISTRAL_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: 'pixtral-12b-2409',
      messages: [
        {
          role: 'user',
          content: [
            { type: 'text', text: prompt },
            { type: 'image_url', image_url: { url: dataUrl } },
          ],
        },
      ],
      max_tokens: 1024,
    }),
  });

  if (!res.ok) {
    const err = await res.text();
    if (res.status === 429) {
      throw Object.assign(new Error('Mistral monthly free limit reached. Try again next month or upgrade at console.mistral.ai'), { kind: 'quota' });
    }
    throw new Error(`Mistral API error (${res.status}): ${err}`);
  }

  const data = await res.json();
  const text = data.choices?.[0]?.message?.content;
  if (!text) throw new Error('Mistral returned an empty response.');
  console.log(`[analyze] Mistral success — ${text.length} chars`);
  return text;
}

// /api/analyze endpoint
app.post('/api/analyze', upload.single('image'), async (req: MulterRequest, res: Response) => {
  try {
    if (!MISTRAL_API_KEY) {
      return res.status(500).json({ error: 'MISTRAL_API_KEY is not configured. Add it to your .env file.' });
    }
    if (!req.file) {
      return res.status(400).json({ error: 'No image file provided.' });
    }
    const userContext: string = req.body?.prompt || '';
    const text = await analyzeImageWithMistral(req.file.buffer, req.file.mimetype, userContext);
    res.json({ text });
  } catch (error: any) {
    console.error('Image analysis error:', error.message);
    res.status(error.kind === 'quota' ? 429 : 500).json({
      error: error.message || 'Failed to analyze image.',
      kind: error.kind || 'general',
    });
  }
});

// RPC Ping Proxy
app.post('/api/ping-rpc', async (req: Request, res: Response) => {
  try {
    const { rpcUrl } = req.body;
    if (!rpcUrl) return res.status(400).json({ error: 'Missing rpcUrl' });
    const response = await fetch(rpcUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', method: 'net_version', params: [], id: 1 }),
      signal: AbortSignal.timeout(10000),
    } as RequestInit);
    if (response.ok) {
      const data = await response.json();
      res.json({ ok: true, data });
    } else {
      const text = await response.text();
      res.json({ ok: false, status: response.status, error: text });
    }
  } catch (error: any) {
    res.json({ ok: false, error: error.message });
  }
});

// Local dev server
if (process.env.NODE_ENV !== 'production') {
  const distPath = path.join(process.cwd(), 'dist');
  app.use(express.static(distPath));
  const PORT = process.env.PORT || 3000;
  app.listen(PORT, () => {
    console.log(`API server running on http://localhost:${PORT}`);
    console.log(`Mistral configured: ${!!MISTRAL_API_KEY}`);
  });
}

export default app;
