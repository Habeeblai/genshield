import { useState, useEffect, useRef, useCallback } from 'react';
import { createClient, createAccount } from 'genlayer-js';
import { studionet, testnetAsimov } from 'genlayer-js/chains';
import { motion, AnimatePresence } from 'motion/react';
import {
  ShieldAlert, ShieldCheck, ShieldQuestion, AlertTriangle,
  Link2, FileText, ImageIcon, Loader2, Settings, RefreshCw,
  Upload, X, Zap, Terminal, ChevronDown
} from 'lucide-react';

// ─── Types ────────────────────────────────────────────────────────────────────
interface ScanResult {
  classification: 'SCAM' | 'SUSPICIOUS' | 'SAFE';
  reasoning: string;
  confidence: number;
}

type ErrorKind = 'quota' | 'network' | 'contract' | 'parse' | 'general';
interface AppError {
  kind: ErrorKind;
  title: string;
  message: string;
  hint?: string;
}

// ─── Config ───────────────────────────────────────────────────────────────────
// These are read from environment variables set in Vercel.
// Locally, create a .env file from .env.example and fill in the values.
const DEFAULT_RPC_URL     = import.meta.env.VITE_GENLAYER_RPC_URL || 'https://studio.genlayer.com/api';
const DEFAULT_CONTRACT    = import.meta.env.VITE_CONTRACT_ADDRESS  || '';

// Pick the right pre-built chain object based on the RPC URL
function getChain(rpcUrl: string) {
  if (rpcUrl.includes('testnet')) return testnetAsimov;
  return studionet; // default — covers studio.genlayer.com
}

// ─── Helpers ──────────────────────────────────────────────────────────────────
function statusColor(cl: string) {
  if (cl === 'SCAM')       return { border: '#ff2d55', bg: 'rgba(255,45,85,0.08)',  text: '#ff2d55' };
  if (cl === 'SUSPICIOUS') return { border: '#ff9f0a', bg: 'rgba(255,159,10,0.08)', text: '#ff9f0a' };
  return                          { border: '#00ff88', bg: 'rgba(0,255,136,0.08)',  text: '#00ff88' };
}

// ─── Component ────────────────────────────────────────────────────────────────
export default function App() {
  const [tab,              setTab]              = useState<'text' | 'link' | 'image'>('text');
  const [inputText,        setInputText]        = useState('');
  const [inputLink,        setInputLink]        = useState('');
  const [inputDesc,        setInputDesc]        = useState('');
  const [imageData,        setImageData]        = useState<{ base64: string; mimeType: string } | null>(null);
  const [imagePreview,     setImagePreview]     = useState<string | null>(null);
  const [isScanning,       setIsScanning]       = useState(false);
  const [scanStep,         setScanStep]         = useState('');
  const [result,           setResult]           = useState<ScanResult | null>(null);
  const [error,            setError]            = useState<AppError | null>(null);
  const [client,           setClient]           = useState<any>(null);
  const [rpcStatus,        setRpcStatus]        = useState<'checking' | 'connected' | 'failed'>('checking');
  const [showSettings,     setShowSettings]     = useState(false);
  const [rpcUrl,           setRpcUrl]           = useState(DEFAULT_RPC_URL);
  const [contractAddress,  setContractAddress]  = useState(DEFAULT_CONTRACT);
  const [rpcInput,         setRpcInput]         = useState(DEFAULT_RPC_URL);
  const [contractInput,    setContractInput]    = useState(DEFAULT_CONTRACT);
  const [log,              setLog]              = useState<string[]>([]);
  const fileRef = useRef<HTMLInputElement>(null);

  const addLog = (msg: string) => setLog(prev => [`[${new Date().toLocaleTimeString()}] ${msg}`, ...prev].slice(0, 20));

  // ── Init client ─────────────────────────────────────────────────────────────
  const initClient = useCallback(async (rpc: string) => {
    setRpcStatus('checking');
    setError(null);
    addLog(`Connecting to ${rpc}…`);
    try {
      const chain   = getChain(rpc);
      const newClient = createClient({ chain, endpoint: rpc, account: createAccount() });
      setClient(newClient);

      // Verify the API proxy is reachable (any HTTP response = server is up)
      // We don't fail hard here — the actual contract call will confirm connectivity
      try {
        const res  = await fetch('/api/ping-rpc', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ rpcUrl: rpc }),
        });
        await res.json();
        setRpcStatus('connected');
        addLog(`RPC reachable ✓ (${rpc})`);
      } catch {
        setRpcStatus('failed');
        addLog(`API proxy unreachable — is the backend running on port 3000?`);
        setError({ kind: 'network', title: 'API Server Offline', message: 'The local API server is not running.', hint: 'Open a terminal in your project folder and run: npm run dev' });
      }
    } catch (err: any) {
      setRpcStatus('failed');
      addLog(`Init error: ${err.message}`);
      setError({ kind: 'network', title: 'Connection Failed', message: 'Could not connect to GenLayer.', hint: 'Check the RPC URL in Settings.' });
    }
  }, []);

  useEffect(() => {
    // Restore saved settings from localStorage
    const savedRpc      = localStorage.getItem('gl_rpc')  || DEFAULT_RPC_URL;
    const savedContract = localStorage.getItem('gl_addr') || DEFAULT_CONTRACT;
    setRpcUrl(savedRpc);
    setContractAddress(savedContract);
    setRpcInput(savedRpc);
    setContractInput(savedContract);
    initClient(savedRpc);
  }, []);

  // ── Image upload ─────────────────────────────────────────────────────────────
  const handleImage = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!file.type.startsWith('image/')) { setError({ kind: 'general', title: 'Invalid File', message: 'Please upload a PNG, JPG, or WEBP image.' }); return; }
    const reader = new FileReader();
    reader.onload = ev => {
      const b64 = (ev.target?.result as string).split(',')[1];
      setImageData({ base64: b64, mimeType: file.type });
      setImagePreview(ev.target?.result as string);
      setError(null);
    };
    reader.readAsDataURL(file);
  };

  // ── AI image description ──────────────────────────────────────────────────
  const describeImage = async (): Promise<string> => {
    if (!imageData) return inputDesc;
    setScanStep('Mistral AI: reading image…');
    addLog('Sending image to Mistral Pixtral for analysis…');

    const form = new FormData();
    // Pass optional user context as prompt — Mistral builds its own detection prompt
    if (inputDesc) form.append('prompt', inputDesc);
    const bytes = atob(imageData.base64);
    const arr   = new Uint8Array(bytes.length);
    for (let i = 0; i < bytes.length; i++) arr[i] = bytes.charCodeAt(i);
    form.append('image', new Blob([arr], { type: imageData.mimeType }), 'upload.png');

    const res  = await fetch('/api/analyze', { method: 'POST', body: form });
    const data = await res.json();

    if (!res.ok) {
      const errMsg: string = data.error || 'Image analysis failed';
      const kind: string   = data.kind  || 'general';
      throw Object.assign(new Error(errMsg), { kind });
    }

    addLog('Image analyzed by Mistral Pixtral ✓');
    return data.text;
  };

  // ── Scan ─────────────────────────────────────────────────────────────────────
  const handleScan = async () => {
    if (!client)          { setError({ kind: 'network', title: 'Not Connected', message: 'GenLayer client is not ready yet.', hint: 'Wait a moment or check the RPC URL in Settings.' }); return; }
    if (!contractAddress) { setError({ kind: 'general', title: 'No Contract Address', message: 'The ScamDetector contract address is not configured.', hint: 'Open Settings and paste your deployed contract address.' }); setShowSettings(true); return; }
    setIsScanning(true);
    setError(null);
    setResult(null);
    addLog('Starting scan…');

    try {
      let fn  = '';
      let arg = '';

      if (tab === 'text') {
        if (!inputText.trim()) throw new Error('Paste a message to scan.');
        fn  = 'check_text';
        arg = inputText;
      } else if (tab === 'link') {
        if (!inputLink.trim()) throw new Error('Enter a URL to scan.');
        fn  = 'check_link';
        arg = inputLink;
      } else {
        if (!imageData && !inputDesc.trim()) throw new Error('Upload an image or describe what you saw.');
        fn  = 'check_image';
        arg = imageData ? await describeImage() : inputDesc;
      }

      setScanStep('Sending to GenLayer validators…');
      addLog(`Calling ${fn}() on contract ${contractAddress.slice(0,10)}… arg length: ${arg.length}`);

      // Re-create client fresh before each contract call to avoid stale state
      // (especially important for image tab which has a long Gemini pre-step)
      const { createClient: mkClient, createAccount: mkAccount } = await import('genlayer-js');
      const { studionet: snet, testnetAsimov: tnet } = await import('genlayer-js/chains');
      const freshChain = rpcUrl.includes('testnet') ? tnet : snet;
      const freshClient = mkClient({ chain: freshChain, endpoint: rpcUrl, account: mkAccount() });

      // Contract methods use @gl.public.write — submit as a transaction
      const txHash = await freshClient.writeContract({
        address:      contractAddress as `0x${string}`,
        functionName: fn,
        args:         [arg],
        value:        0n,
      });

      addLog(`Tx: ${String(txHash).slice(0, 18)}… waiting for consensus…`);
      setScanStep('Waiting for validator consensus…');

      const { TransactionStatus } = await import('genlayer-js/types');
      const receipt = await freshClient.waitForTransactionReceipt({
        hash:     txHash,
        status:   TransactionStatus.FINALIZED,
        retries:  60,
        interval: 3000,
      });

      // Extract result from the correct path in the GenLayer receipt structure:
      // receipt.consensus_data.leader_receipt[0].result.payload.readable
      // The value is a double-escaped JSON string, so we parse twice.
      const leaderReceipt = receipt?.consensus_data?.leader_receipt?.[0];
      const readable = leaderReceipt?.result?.payload?.readable;

      if (!readable) {
        addLog('DEBUG: ' + JSON.stringify(receipt).slice(0, 300));
        throw new Error('Could not extract result from receipt. Check browser console (F12).');
      }

      // Parse once: removes outer quotes and unescape -> gives us a JSON string
      // Parse twice: converts that JSON string into the actual object
      let parsed: ScanResult;
      try {
        const firstParse = typeof readable === 'string' ? JSON.parse(readable) : readable;
        parsed = typeof firstParse === 'string' ? JSON.parse(firstParse) : firstParse as ScanResult;
      } catch (parseErr) {
        console.error('[GenShield] Parse error:', parseErr, 'raw readable:', readable);
        throw new Error('Failed to parse contract result. Check browser console.');
      }

      setResult(parsed);
      addLog('Verdict: ' + parsed.classification + ' (' + parsed.confidence + '% confidence)');
    } catch (err: any) {
      const raw: string = err.message || 'Unexpected error.';
      // Log full error to console AND the in-app log so we can see it
      console.error('[GenShield] Full error:', err);
      addLog('ERR type=' + (err?.constructor?.name || 'unknown') + ' msg=' + raw.slice(0, 200));

      // Quota / rate limit error
      if (err.kind === 'quota' || raw.includes('429') || raw.includes('quota') || raw.includes('Too Many Requests')) {
        setError({
          kind: 'quota',
          title: "Monthly Image Scan Limit Reached",
          message: "The Mistral AI vision service has hit its monthly free-tier limit. The platform is working perfectly — this resets on the 1st of next month.",
          hint: "Use the Message or URL tabs in the meantime, or upgrade at console.mistral.ai for unlimited scans."
        });
      }
      // Receipt extraction failed
      else if (raw.includes('Could not extract result') || raw.includes('Failed to parse')) {
        setError({
          kind: 'parse',
          title: 'Result Parsing Error',
          message: 'The contract returned a result but it could not be read correctly.',
          hint: 'This is a temporary issue. Try scanning again.'
        });
      }
      // Contract / GenVM crash
      else if (raw.includes('GenVM') || raw.includes('contract')) {
        setError({
          kind: 'contract',
          title: 'Contract Error',
          message: 'The smart contract encountered an issue.',
          hint: 'Verify the contract address in Settings matches the network you deployed to.'
        });
      }
      // Generic network error
      else if (raw.includes('fetch') || raw.includes('network') || raw.includes('ECONNREFUSED')) {
        setError({
          kind: 'network',
          title: 'Network Error',
          message: 'Could not reach the GenLayer network.',
          hint: 'Check your RPC URL in Settings.'
        });
      }
      // Fallback
      else {
        setError({
          kind: 'general',
          title: 'Scan Failed',
          message: raw.length > 120 ? raw.slice(0, 120) + '…' : raw,
        });
      }
    } finally {
      setIsScanning(false);
      setScanStep('');
    }
  };

  const saveSettings = () => {
    localStorage.setItem('gl_rpc',  rpcInput);
    localStorage.setItem('gl_addr', contractInput);
    setRpcUrl(rpcInput);
    setContractAddress(contractInput);
    setShowSettings(false);
    initClient(rpcInput);
  };

  const sc = result ? statusColor(result.classification) : null;

  // ── Render ───────────────────────────────────────────────────────────────────
  return (
    <div className="min-h-screen flex flex-col" style={{ fontFamily: 'var(--font-display)' }}>

      {/* ── Header ── */}
      <header className="flex items-center justify-between px-6 py-4 border-b border-white/10">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 flex items-center justify-center" style={{ border: '1px solid #00ff88', boxShadow: '0 0 12px rgba(0,255,136,0.4)' }}>
            <Zap className="w-4 h-4" style={{ color: '#00ff88' }} />
          </div>
          <div>
            <div className="font-bold text-base tracking-widest uppercase animate-flicker" style={{ letterSpacing: '0.2em' }}>GenShield</div>
            <div className="text-xs opacity-40" style={{ fontFamily: 'var(--font-mono)', letterSpacing: '0.1em' }}>AI SCAM DETECTOR v1.0</div>
          </div>
        </div>
        <div className="flex items-center gap-4">
          {/* RPC status */}
          <div className="flex items-center gap-2">
            <div className={`w-2 h-2 rounded-full ${
              rpcStatus === 'connected' ? 'animate-pulse-glow' : ''
            }`} style={{
              background: rpcStatus === 'connected' ? '#00ff88' : rpcStatus === 'failed' ? '#ff2d55' : '#888',
              boxShadow:  rpcStatus === 'connected' ? '0 0 8px #00ff88' : 'none'
            }} />
            <span className="text-xs hidden sm:block" style={{ fontFamily: 'var(--font-mono)', color: rpcStatus === 'connected' ? '#00ff88' : rpcStatus === 'failed' ? '#ff2d55' : '#888' }}>
              {rpcStatus === 'connected' ? 'CONNECTED' : rpcStatus === 'failed' ? 'DISCONNECTED' : 'CONNECTING…'}
            </span>
          </div>
          <button onClick={() => setShowSettings(true)} className="p-2 opacity-60 hover:opacity-100 transition-opacity" style={{ border: '1px solid rgba(255,255,255,0.1)' }}>
            <Settings className="w-4 h-4" />
          </button>
        </div>
      </header>

      {/* ── Main ── */}
      <main className="flex-1 grid grid-cols-1 lg:grid-cols-2 gap-0">

        {/* LEFT: Input */}
        <div className="flex flex-col p-6 lg:p-10 gap-6 border-r border-white/10">

          {/* Tab selector */}
          <div className="grid grid-cols-3 gap-2">
            {([
              { id: 'text',  icon: FileText,  label: 'Message' },
              { id: 'link',  icon: Link2,     label: 'URL' },
              { id: 'image', icon: ImageIcon, label: 'Image' },
            ] as const).map(({ id, icon: Icon, label }) => (
              <button key={id} onClick={() => { setTab(id); setError(null); setResult(null); }}
                className="flex flex-col items-center gap-2 py-4 transition-all"
                style={{
                  border:  `1px solid ${tab === id ? '#00ff88' : 'rgba(255,255,255,0.08)'}`,
                  background: tab === id ? 'rgba(0,255,136,0.06)' : 'transparent',
                  boxShadow:  tab === id ? '0 0 16px rgba(0,255,136,0.15)' : 'none',
                }}
              >
                <Icon className="w-5 h-5" style={{ color: tab === id ? '#00ff88' : '#666' }} />
                <span className="text-xs font-bold tracking-widest uppercase" style={{ color: tab === id ? '#00ff88' : '#666' }}>{label}</span>
              </button>
            ))}
          </div>

          {/* Input area */}
          <div className="flex-1 flex flex-col gap-3">
            <div className="text-xs font-bold tracking-widest uppercase opacity-40" style={{ fontFamily: 'var(--font-mono)' }}>
              {tab === 'text' ? '// PASTE SUSPICIOUS MESSAGE' : tab === 'link' ? '// ENTER URL TO INSPECT' : '// UPLOAD SCREENSHOT'}
            </div>

            <AnimatePresence mode="wait">
              {tab === 'text' && (
                <motion.textarea key="text" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
                  className="flex-1 min-h-[200px] p-5 resize-none text-sm leading-relaxed bg-transparent outline-none"
                  style={{ border: '1px solid rgba(255,255,255,0.08)', background: 'rgba(255,255,255,0.02)', color: '#e8e8f0', fontFamily: 'var(--font-mono)', fontSize: '13px' }}
                  placeholder="Paste a suspicious DM, email, or message here…"
                  value={inputText} onChange={e => setInputText(e.target.value)}
                />
              )}

              {tab === 'link' && (
                <motion.div key="link" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="flex flex-col gap-3">
                  <input type="url" className="w-full p-5 bg-transparent outline-none"
                    style={{ border: '1px solid rgba(255,255,255,0.08)', background: 'rgba(255,255,255,0.02)', color: '#e8e8f0', fontFamily: 'var(--font-mono)', fontSize: '13px' }}
                    placeholder="https://suspicious-site.com"
                    value={inputLink} onChange={e => setInputLink(e.target.value)}
                  />
                  <p className="text-xs opacity-40" style={{ fontFamily: 'var(--font-mono)' }}>// Analyzes domain structure, look-alike patterns, and phishing signals via AI consensus</p>
                </motion.div>
              )}

              {tab === 'image' && (
                <motion.div key="image" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="flex flex-col gap-3">
                  <div
                    onClick={() => fileRef.current?.click()}
                    className="relative flex flex-col items-center justify-center min-h-[160px] cursor-pointer transition-all"
                    style={{ border: `1px dashed ${imagePreview ? '#00ff88' : 'rgba(255,255,255,0.15)'}`, background: 'rgba(255,255,255,0.02)' }}
                  >
                    <input type="file" ref={fileRef} onChange={handleImage} className="hidden" accept="image/*" />
                    {imagePreview ? (
                      <>
                        <img src={imagePreview} alt="Preview" className="absolute inset-0 w-full h-full object-contain p-4 opacity-30" />
                        <div className="relative z-10 flex flex-col items-center gap-2">
                          <div className="px-3 py-1 text-xs font-bold tracking-widest" style={{ border: '1px solid #00ff88', color: '#00ff88', fontFamily: 'var(--font-mono)' }}>IMAGE LOADED</div>
                        </div>
                        <button onClick={e => { e.stopPropagation(); setImageData(null); setImagePreview(null); }}
                          className="absolute top-3 right-3 p-1" style={{ border: '1px solid rgba(255,255,255,0.2)', background: 'rgba(0,0,0,0.6)' }}>
                          <X className="w-3 h-3" />
                        </button>
                      </>
                    ) : (
                      <>
                        <Upload className="w-8 h-8 mb-3 opacity-30" />
                        <p className="text-xs font-bold tracking-widest uppercase opacity-40">Click to upload screenshot</p>
                        <p className="text-xs opacity-20 mt-1" style={{ fontFamily: 'var(--font-mono)' }}>PNG, JPG, WEBP — max 10MB</p>
                      </>
                    )}
                  </div>
                  <textarea className="p-4 resize-none h-20 bg-transparent outline-none text-sm"
                    style={{ border: '1px solid rgba(255,255,255,0.08)', background: 'rgba(255,255,255,0.02)', color: '#e8e8f0', fontFamily: 'var(--font-mono)', fontSize: '12px' }}
                    placeholder="// Optional: describe context about the image…"
                    value={inputDesc} onChange={e => setInputDesc(e.target.value)}
                  />
                  <p className="text-xs opacity-40" style={{ fontFamily: 'var(--font-mono)', color: '#00ff88' }}>// Gemini AI will read the image, then GenLayer validators reach consensus</p>
                </motion.div>
              )}
            </AnimatePresence>
          </div>

          {/* Scan button */}
          <button onClick={handleScan} disabled={isScanning}
            className="w-full py-4 font-bold tracking-widest uppercase text-sm transition-all disabled:opacity-30 disabled:cursor-not-allowed"
            style={{
              border:     '1px solid #00ff88',
              background: isScanning ? 'rgba(0,255,136,0.1)' : 'rgba(0,255,136,0.08)',
              color:      '#00ff88',
              boxShadow:  isScanning ? '0 0 24px rgba(0,255,136,0.3)' : '0 0 8px rgba(0,255,136,0.1)',
              fontFamily: 'var(--font-mono)',
              letterSpacing: '0.2em',
            }}
          >
            {isScanning ? (
              <span className="flex items-center justify-center gap-3">
                <Loader2 className="w-4 h-4 animate-spin" />
                {scanStep || 'PROCESSING…'}
              </span>
            ) : (
              '⟩ RUN DEEP SCAN'
            )}
          </button>

          {/* Error */}
          <AnimatePresence>
            {error && (
              <motion.div initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}>
                {error.kind === 'quota' ? (
                  /* Quota error — friendly, non-alarming */
                  <div className="p-5 flex flex-col gap-3"
                    style={{ border: '1px solid rgba(0,255,136,0.2)', background: 'rgba(0,255,136,0.04)' }}>
                    <div className="flex items-center gap-3">
                      <div className="w-8 h-8 flex items-center justify-center shrink-0"
                        style={{ border: '1px solid rgba(0,255,136,0.4)', color: '#00ff88' }}>
                        <ShieldCheck className="w-4 h-4" />
                      </div>
                      <div>
                        <div className="text-sm font-bold" style={{ color: '#00ff88' }}>{error.title}</div>
                        <div className="text-xs opacity-50 mt-0.5" style={{ fontFamily: 'var(--font-mono)', color: '#00ff88' }}>PLATFORM STATUS: OPERATIONAL</div>
                      </div>
                    </div>
                    <p className="text-xs leading-relaxed opacity-70">{error.message}</p>
                    {error.hint && (
                      <p className="text-xs leading-relaxed px-3 py-2"
                        style={{ background: 'rgba(0,255,136,0.06)', border: '1px solid rgba(0,255,136,0.1)', fontFamily: 'var(--font-mono)', color: '#00ff88', opacity: 0.7 }}>
                        // {error.hint}
                      </p>
                    )}
                  </div>
                ) : (
                  /* All other errors — standard warning style */
                  <div className="p-4 flex flex-col gap-2"
                    style={{ border: '1px solid rgba(255,45,85,0.3)', background: 'rgba(255,45,85,0.06)' }}>
                    <div className="flex items-center gap-2">
                      <AlertTriangle className="w-4 h-4 shrink-0" style={{ color: '#ff2d55' }} />
                      <span className="text-sm font-bold" style={{ color: '#ff2d55' }}>{error.title}</span>
                    </div>
                    <p className="text-xs leading-relaxed opacity-70" style={{ fontFamily: 'var(--font-mono)' }}>{error.message}</p>
                    {error.hint && (
                      <p className="text-xs opacity-50 mt-1" style={{ fontFamily: 'var(--font-mono)', color: '#ff2d55' }}>// {error.hint}</p>
                    )}
                  </div>
                )}
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        {/* RIGHT: Result + Log */}
        <div className="flex flex-col">

          {/* Result panel */}
          <div className="flex-1 flex flex-col items-center justify-center p-6 lg:p-10 min-h-[320px]">
            <AnimatePresence mode="wait">
              {!result ? (
                <motion.div key="empty" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
                  className="flex flex-col items-center gap-4 text-center opacity-20">
                  <ShieldQuestion className="w-16 h-16" />
                  <p className="text-xs tracking-widest uppercase" style={{ fontFamily: 'var(--font-mono)' }}>Awaiting scan target</p>
                </motion.div>
              ) : (
                <motion.div key="result" initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }}
                  className="w-full flex flex-col gap-6 animate-slide-up">

                  {/* Big verdict */}
                  <div className="flex flex-col items-center gap-4 py-6" style={{ border: `1px solid ${sc!.border}`, background: sc!.bg, boxShadow: `0 0 40px ${sc!.border}20` }}>
                    <div className="w-16 h-16 flex items-center justify-center" style={{ border: `2px solid ${sc!.text}`, boxShadow: `0 0 20px ${sc!.text}40` }}>
                      {result.classification === 'SCAM'       ? <ShieldAlert   className="w-8 h-8" style={{ color: sc!.text }} /> :
                       result.classification === 'SUSPICIOUS' ? <AlertTriangle className="w-8 h-8" style={{ color: sc!.text }} /> :
                                                                <ShieldCheck   className="w-8 h-8" style={{ color: sc!.text }} />}
                    </div>
                    <div className="text-5xl font-black tracking-tighter" style={{ color: sc!.text, textShadow: `0 0 30px ${sc!.text}` }}>
                      {result.classification === 'SCAM' ? 'SCAM' : result.classification === 'SUSPICIOUS' ? 'WARNING' : 'SAFE'}
                    </div>
                    <div className="text-xs font-bold tracking-widest" style={{ fontFamily: 'var(--font-mono)', color: sc!.text, opacity: 0.7 }}>
                      CONFIDENCE: {result.confidence}%
                    </div>
                    {/* Confidence bar */}
                    <div className="w-full max-w-xs h-1 bg-white/10">
                      <motion.div className="h-full" style={{ background: sc!.text }} initial={{ width: 0 }} animate={{ width: `${result.confidence}%` }} transition={{ duration: 0.8, ease: 'easeOut' }} />
                    </div>
                  </div>

                  {/* Reasoning */}
                  <div className="p-5" style={{ border: '1px solid rgba(255,255,255,0.08)', background: 'rgba(255,255,255,0.02)' }}>
                    <div className="text-xs font-bold tracking-widest uppercase mb-3 opacity-40" style={{ fontFamily: 'var(--font-mono)' }}>// REASONING</div>
                    <p className="text-sm leading-relaxed opacity-80">{result.reasoning}</p>
                  </div>

                  {/* Scan again */}
                  <button onClick={() => { setResult(null); }} className="text-xs opacity-40 hover:opacity-80 transition-opacity text-center" style={{ fontFamily: 'var(--font-mono)' }}>
                    [ clear result and scan again ]
                  </button>
                </motion.div>
              )}
            </AnimatePresence>
          </div>

          {/* Log panel */}
          <div className="border-t border-white/10 p-4" style={{ background: 'rgba(0,0,0,0.4)' }}>
            <div className="flex items-center gap-2 mb-3 opacity-40">
              <Terminal className="w-3 h-3" />
              <span className="text-xs font-bold tracking-widest" style={{ fontFamily: 'var(--font-mono)' }}>CONSOLE</span>
            </div>
            <div className="space-y-1 max-h-28 overflow-y-auto">
              {log.length === 0
                ? <p className="text-xs opacity-20" style={{ fontFamily: 'var(--font-mono)' }}>Waiting for activity…</p>
                : log.map((l, i) => (
                    <p key={i} className="text-xs opacity-50 leading-relaxed" style={{ fontFamily: 'var(--font-mono)' }}>{l}</p>
                  ))
              }
            </div>
          </div>
        </div>
      </main>

      {/* ── Settings Modal ── */}
      <AnimatePresence>
        {showSettings && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-center justify-center p-6"
            style={{ background: 'rgba(0,0,0,0.85)', backdropFilter: 'blur(8px)' }}
            onClick={e => e.target === e.currentTarget && setShowSettings(false)}
          >
            <motion.div initial={{ scale: 0.95, y: 20 }} animate={{ scale: 1, y: 0 }} exit={{ scale: 0.95, y: 20 }}
              className="w-full max-w-lg p-8 flex flex-col gap-6"
              style={{ background: '#0f0f1a', border: '1px solid rgba(255,255,255,0.12)' }}
            >
              <div className="flex items-center justify-between">
                <div>
                  <div className="font-black text-xl tracking-tight">Node Settings</div>
                  <div className="text-xs opacity-40 mt-1" style={{ fontFamily: 'var(--font-mono)' }}>// Configure GenLayer connection</div>
                </div>
                <button onClick={() => setShowSettings(false)} className="p-2 opacity-40 hover:opacity-100 transition-opacity">
                  <X className="w-5 h-5" />
                </button>
              </div>

              {/* RPC URL */}
              <div className="flex flex-col gap-2">
                <div className="flex items-center justify-between">
                  <label className="text-xs font-bold tracking-widest uppercase opacity-60" style={{ fontFamily: 'var(--font-mono)' }}>RPC Endpoint</label>
                  <div className="flex items-center gap-2">
                    <div className="w-1.5 h-1.5 rounded-full" style={{ background: rpcStatus === 'connected' ? '#00ff88' : rpcStatus === 'failed' ? '#ff2d55' : '#888' }} />
                    <span className="text-xs opacity-50" style={{ fontFamily: 'var(--font-mono)' }}>
                      {rpcStatus === 'connected' ? 'active' : rpcStatus === 'failed' ? 'offline' : 'checking…'}
                    </span>
                  </div>
                </div>
                <input type="text" value={rpcInput} onChange={e => setRpcInput(e.target.value)}
                  className="w-full p-4 bg-transparent outline-none text-sm"
                  style={{ border: '1px solid rgba(255,255,255,0.12)', fontFamily: 'var(--font-mono)', color: '#e8e8f0' }}
                  placeholder="https://studio.genlayer.com/api"
                />
                <div className="text-xs opacity-30 leading-relaxed" style={{ fontFamily: 'var(--font-mono)' }}>
                  Studionet: https://studio.genlayer.com/api<br />
                  Testnet:   https://rpc.testnet.genlayer.com
                </div>
              </div>

              {/* Contract address */}
              <div className="flex flex-col gap-2">
                <label className="text-xs font-bold tracking-widest uppercase opacity-60" style={{ fontFamily: 'var(--font-mono)' }}>ScamDetector Contract Address</label>
                <input type="text" value={contractInput} onChange={e => setContractInput(e.target.value)}
                  className="w-full p-4 bg-transparent outline-none text-sm"
                  style={{ border: '1px solid rgba(255,255,255,0.12)', fontFamily: 'var(--font-mono)', color: '#e8e8f0' }}
                  placeholder="0x…"
                />
                <div className="text-xs opacity-30" style={{ fontFamily: 'var(--font-mono)' }}>
                  Deploy ScamDetector.py on GenLayer Studio and paste the address here.
                </div>
              </div>

              {/* Info box */}
              <div className="p-4 text-xs leading-relaxed" style={{ border: '1px solid rgba(0,255,136,0.2)', background: 'rgba(0,255,136,0.04)', color: '#00ff88', fontFamily: 'var(--font-mono)' }}>
                <div className="font-bold mb-2">// HOW TO DEPLOY YOUR CONTRACT</div>
                <ol className="opacity-70 space-y-1 list-decimal list-inside">
                  <li>Go to studio.genlayer.com</li>
                  <li>Upload ScamDetector.py and click Deploy</li>
                  <li>Copy the deployed contract address</li>
                  <li>Paste it above and save</li>
                </ol>
                <div className="mt-3 opacity-50">
                  For Vercel: set VITE_GENLAYER_RPC_URL and VITE_CONTRACT_ADDRESS in your project's Environment Variables, then redeploy.
                </div>
              </div>

              <button onClick={saveSettings}
                className="w-full py-4 font-bold tracking-widest uppercase text-sm flex items-center justify-center gap-2 transition-all"
                style={{ border: '1px solid #00ff88', background: 'rgba(0,255,136,0.08)', color: '#00ff88', fontFamily: 'var(--font-mono)', letterSpacing: '0.2em' }}
              >
                <RefreshCw className="w-4 h-4" />
                Save & Reconnect
              </button>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ── Footer ── */}
      <footer className="px-6 py-4 border-t border-white/10 flex items-center justify-between">
        <span className="text-xs opacity-20" style={{ fontFamily: 'var(--font-mono)' }}>GENSHIELD // POWERED BY GENLAYER INTELLIGENT CONTRACTS</span>
        <span className="text-xs opacity-20" style={{ fontFamily: 'var(--font-mono)' }}>CONSENSUS-BASED FRAUD DETECTION</span>
      </footer>
    </div>
  );
}
