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
import { GoogleGenerativeAI } from '@google/generative-ai';
import multer from 'multer';
import cors from 'cors';

interface MulterRequest extends Request {
  file?: Express.Multer.File;
}

const apiKey = process.env.GEMINI_API_KEY;
const genAI  = apiKey ? new GoogleGenerativeAI(apiKey) : null;

const app = express();
app.use(cors());
app.use(express.json({ limit: '10mb' }));

const upload = multer({ storage: multer.memoryStorage() });

// ── Health check ──────────────────────────────────────────────────────────────
app.get('/api/health', (_req: Request, res: Response) => {
  res.json({ status: 'ok', geminiConfigured: !!apiKey });
});

// ── AI Analysis (text + image) ────────────────────────────────────────────────
app.post('/api/analyze', upload.single('image'), async (req: MulterRequest, res: Response) => {
  try {
    if (!genAI) {
      return res.status(500).json({ error: 'GEMINI_API_KEY is not configured on the server.' });
    }

    const { prompt, type } = req.body;
    const model = genAI.getGenerativeModel({ model: 'gemini-2.0-flash-lite' });

    let result;
    if (type === 'image' && req.file) {
      result = await model.generateContent([
        prompt,
        {
          inlineData: {
            data:     req.file.buffer.toString('base64'),
            mimeType: req.file.mimetype,
          },
        },
      ]);
    } else {
      result = await model.generateContent(prompt);
    }

    const text = (await result.response).text();
    res.json({ text });
  } catch (error: any) {
    console.error('AI analysis error:', error);
    res.status(500).json({ error: error.message || 'Failed to analyze content' });
  }
});

// ── RPC Ping Proxy ─────────────────────────────────────────────────────────────
// Browsers can't always reach GenLayer directly due to CORS.
// This server-side proxy forwards the ping and returns the result.
app.post('/api/ping-rpc', async (req: Request, res: Response) => {
  try {
    const { rpcUrl } = req.body;
    if (!rpcUrl) return res.status(400).json({ error: 'Missing rpcUrl' });

    const response = await fetch(rpcUrl, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ jsonrpc: '2.0', method: 'gen_getContractSchema', params: [], id: 1 }),
      signal:  AbortSignal.timeout(10000),
    } as RequestInit);

    if (response.ok) {
      const data = await response.json();
      res.json({ ok: true, data });
    } else {
      const text = await response.text();
      res.json({ ok: false, status: response.status, error: text });
    }
  } catch (error: any) {
    console.error('[ping-rpc] error:', error.message);
    res.json({ ok: false, error: error.message });
  }
});

// ── Static files (local dev only — Vercel handles this via vercel.json) ───────
if (process.env.NODE_ENV !== 'production') {
  // In local dev, Vite handles the frontend. This block exists only so you can
  // run `tsx api/index.ts` for API testing without Vite.
  const distPath = path.join(process.cwd(), 'dist');
  app.use(express.static(distPath));

  const PORT = process.env.PORT || 3000;
  app.listen(PORT, () => {
    console.log(`API server running on http://localhost:${PORT}`);
  });
}

// Vercel reads this as the serverless function handler
export default app;
