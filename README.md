# GenShield — AI Scam Detector

Detect scams, phishing links, and suspicious messages using on-chain AI consensus via **GenLayer Intelligent Contracts**.

---

## How it works

1. User submits a message, URL, or image
2. If image: Gemini AI describes the visual content
3. The description is sent to `ScamDetector.py` on GenLayer
4. Multiple AI validators reach consensus on: `SCAM` / `SUSPICIOUS` / `SAFE`
5. Result is displayed with confidence score and reasoning

---

## Local Development

### 1. Clone and install
```bash
git clone https://github.com/YOUR_USERNAME/genshield.git
cd genshield
npm install
```

### 2. Set up environment variables
```bash
cp .env.example .env
```
Edit `.env`:
```
GEMINI_API_KEY=your_google_gemini_key
VITE_GENLAYER_RPC_URL=https://studio.genlayer.com/api
VITE_CONTRACT_ADDRESS=0xYOUR_DEPLOYED_CONTRACT_ADDRESS
```

### 3. Deploy the contract on GenLayer Studio
1. Go to **https://studio.genlayer.com**
2. Create a new contract and paste the contents of `contracts/ScamDetector.py`
3. Click **Deploy**
4. Copy the contract address and paste it into `.env` as `VITE_CONTRACT_ADDRESS`

### 4. Run locally
```bash
# Terminal 1: API server
npm run dev

# Vite proxies /api → localhost:3000 automatically
```
Visit http://localhost:5173

---

## Deploy to Vercel

### 1. Push to GitHub
```bash
git init
git add .
git commit -m "initial commit"
git remote add origin https://github.com/YOUR_USERNAME/genshield.git
git push -u origin main
```

### 2. Import on Vercel
1. Go to **https://vercel.com/new**
2. Import your GitHub repository
3. Framework: **Vite** (auto-detected)
4. Add Environment Variables:

| Variable | Value |
|---|---|
| `GEMINI_API_KEY` | your Gemini API key |
| `VITE_GENLAYER_RPC_URL` | `https://studio.genlayer.com/api` |
| `VITE_CONTRACT_ADDRESS` | `0xYOUR_CONTRACT_ADDRESS` |

5. Click **Deploy**

> ⚠️ `VITE_*` variables must be set **before** the build runs. If you add them after deploying, trigger a redeploy from the Vercel dashboard.

---

## Tech Stack

- **Frontend**: React 19 + TypeScript + Vite + Tailwind CSS v4
- **Smart Contract**: GenLayer Intelligent Contract (Python)
- **AI Vision**: Google Gemini 1.5 Flash
- **On-chain Consensus**: GenLayer validators
- **Hosting**: Vercel (frontend + API serverless functions)
