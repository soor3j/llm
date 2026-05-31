// LLM Inference Server — User Workspace
// Dark "secure environment" surface continuing from login.
// Token-by-token streaming from /v1/chat/completions SSE, sidebar nav,
// live metrics rail, top bar with model picker.

// Helpers shared with auth — read the Bearer token the user typed at login.
const getApiKey = () => {
  try { return localStorage.getItem('apiKey') || ''; } catch { return ''; }
};
const getAdminApiKey = () => {
  try { return localStorage.getItem('adminApiKey') || ''; } catch { return ''; }
};
const apiBase = () => `${window.location.origin}/v1`;

// Available GGUF models for this stack. Only one is actually loaded at a
// time — controlled by MODEL_FILE in .env. The others are listed as
// configurable swaps the operator can drop into the model directory.
const MODELS = [
  { id: 'mistral-7b', name: 'Mistral 7B Instruct', tag: 'instruct', ctx: 4096, backend: 'llama.cpp', quant: 'Q4_K_M', status: 'loaded', size: '4.1 GB' },
  { id: 'phi-3.5-mini', name: 'Phi-3.5 Mini', tag: 'reasoning', ctx: 4096, backend: 'llama.cpp', quant: 'Q4_K_M', status: 'loaded', size: '2.4 GB' },
  { id: 'llama-3.2-3b', name: 'Llama 3.2 3B', tag: 'chat', ctx: 4096, backend: 'llama.cpp', quant: 'Q4_K_M', status: 'loaded', size: '2.0 GB' },
];

// Used as a friendly initial greeting only — real replies come from the engine.
const SIDEBAR_ITEMS = [
  { id: 'chat', label: 'Chats', icon: Icon.Stream },
  { id: 'documents', label: 'Documents', icon: Icon.Globe },
  { id: 'api', label: 'API', icon: Icon.Network },
  { id: 'history', label: 'History', icon: Icon.Queue },
  { id: 'settings', label: 'Settings', icon: Icon.Lock },
];

// --- Top bar -------------------------------------------------------

// Hook: poll /health every 30s. Returns {status, modelLoaded, latencyMs}.
const useEngineHealth = () => {
  const [state, setState] = React.useState({ status: 'unknown', modelLoaded: false, latencyMs: null });
  React.useEffect(() => {
    let cancelled = false;
    const tick = async () => {
      const t0 = performance.now();
      try {
        const r = await fetch(`${window.location.origin}/health`);
        const j = await r.json();
        if (cancelled) return;
        setState({
          status: j?.status || 'unknown',
          modelLoaded: !!j?.model_loaded,
          latencyMs: Math.round(performance.now() - t0),
        });
      } catch {
        if (!cancelled) setState({ status: 'degraded', modelLoaded: false, latencyMs: null });
      }
    };
    tick();
    const id = setInterval(tick, 30000);
    return () => { cancelled = true; clearInterval(id); };
  }, []);
  return state;
};

const WsTopBar = ({ model, setModel, onSignOut }) => {
  const [open, setOpen] = React.useState(false);
  const health = useEngineHealth();
  return (
    <header className="ws-topbar">
      <div className="ws-topbar-left">
        <div className="ws-brand">
          <BrandMark dark size={20} />
          <span className="ws-brand-name">LLM Inference Server</span>
        </div>
      </div>


      <div className="ws-topbar-right">
        <button
          onClick={onSignOut}
          title="Sign out"
          style={{ background: 'transparent', border: 'none', padding: 0, cursor: 'pointer' }}
        >
          <img src="icon3.png" alt="logout" style={{ width: 26, height: 26, objectFit: 'contain', display: 'block' }} />
        </button>
      </div>
    </header>
  );
};

// --- Sidebar -------------------------------------------------------

// Real health probe — polls /health/full every 10s and shows actual status.
const useFleetHealth = () => {
  const [state, setState] = React.useState({ status: 'checking', degraded: [] });
  React.useEffect(() => {
    let cancelled = false;
    const tick = async () => {
      try {
        const res = await fetch('/health/full');
        const j = await res.json();
        if (!cancelled) setState({ status: j.status, degraded: j.degraded || [] });
      } catch {
        if (!cancelled) setState({ status: 'degraded', degraded: ['gateway'] });
      }
    };
    tick();
    const id = setInterval(tick, 10000);
    return () => { cancelled = true; clearInterval(id); };
  }, []);
  return state;
};

const WsSidebar = ({ active, setActive }) => {
  const health = useFleetHealth();
  const ok = health.status === 'ok';
  const checking = health.status === 'checking';
  return (
    <aside className="ws-sidebar">
      <nav className="ws-side-nav">
        {SIDEBAR_ITEMS.map((it) => {
          const Ico = it.icon;
          return (
            <button
              key={it.id}
              className={`ws-side-item ${active === it.id ? 'on' : ''}`}
              onClick={() => setActive(it.id)}
            >
              <span className="ws-side-ico"><Ico size={15} /></span>
              <span>{it.label}</span>
            </button>
          );
        })}
      </nav>
      <div className="ws-side-foot">
        <div className="ws-side-foot-row" title={health.degraded.length ? `Down: ${health.degraded.join(', ')}` : ''}>
          <span className={`ws-dot ${ok ? 'on' : checking ? 'idle' : 'off'}`} />
          <span>{checking ? 'Checking…' : ok ? 'All systems healthy' : `Degraded · ${health.degraded.length} down`}</span>
        </div>
        <div className="ws-side-foot-row mono small">v1.1</div>
      </div>
    </aside>
  );
};

// --- Metrics rail --------------------------------------------------

// Hook: poll /v1/metrics/summary every 2s while mounted.
const useMetricsSummary = (intervalMs = 2000) => {
  const [data, setData] = React.useState(null);
  const [err, setErr] = React.useState(null);
  React.useEffect(() => {
    let cancelled = false;
    const tick = async () => {
      try {
        const r = await fetch(`${apiBase()}/metrics/summary`, {
          headers: { Authorization: `Bearer ${getApiKey()}` },
        });
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        const j = await r.json();
        if (!cancelled) { setData(j); setErr(null); }
      } catch (e) {
        if (!cancelled) setErr(e.message);
      }
    };
    tick();
    const id = setInterval(tick, intervalMs);
    return () => { cancelled = true; clearInterval(id); };
  }, [intervalMs]);
  return [data, err];
};

const MetricsRail = ({ collapsed, onToggle }) => {
  const [summary] = useMetricsSummary(2000);
  const fmt = (v, fallback = '—') => (v == null ? fallback : v);
  const metrics = [
    { label: 'TTFT',        value: summary ? fmt(summary.ttft_mean_ms) : '—',          unit: 'ms' },
    { label: 'Tokens/sec',  value: summary ? fmt(summary.tokens_per_sec) : '—',         unit: '' },
    { label: 'Memory',      value: summary ? fmt(summary.memory_mb) : '—',              unit: 'MB' },
    { label: 'Queue depth', value: summary ? fmt(summary.in_flight) : '—',              unit: '' },
    { label: 'Cache hit',   value: summary ? Math.round((summary.cache_hit_rate ?? 0) * 100) : '—', unit: '%' },
    { label: 'Requests',    value: summary ? fmt(summary.total_requests) : '—',         unit: '' },
  ];
  if (collapsed) {
    return (
      <aside className="ws-rail collapsed">
        <button className="ws-rail-toggle" onClick={onToggle} title="Show metrics">
          <Icon.Pulse size={14} />
        </button>
      </aside>
    );
  }
  return (
    <aside className="ws-rail">
      <div className="ws-rail-head">
        <span className="eyebrow" style={{ color: 'rgba(242,242,245,0.4)' }}>Live</span>
        <button className="ws-rail-toggle" onClick={onToggle} title="Collapse">
          <Icon.Close size={11} />
        </button>
      </div>
      {metrics.map((m, i) => (
        <div className="ws-metric" key={m.label}>
          <div className="ws-metric-row">
            <div className="ws-metric-label">{m.label}</div>
            <div className="ws-metric-val">
              {m.value}
              {m.unit && <span className="unit">{m.unit}</span>}
            </div>
          </div>
        </div>
      ))}
      <div className="ws-rail-foot">
        <div className="ws-rail-foot-row">
          <span className="ws-dot on" /> Engine healthy
        </div>
        <div className="ws-rail-foot-row mono small">
          uptime · {summary?.uptime_sec ? `${Math.floor(summary.uptime_sec / 60)}m` : '—'}
        </div>
      </div>
    </aside>
  );
};

// --- Chat view -----------------------------------------------------

// Friendly opening — never persisted to the backend.
const INITIAL_GREETING = {
  role: 'assistant',
  content: 'Hi — the engine is online and the model is loaded. What would you like to ask?',
};

const ChatView = ({ model, setModel, chatId, setChatId, onNewChat, params, setParams }) => {
  const [messages, setMessages] = React.useState([INITIAL_GREETING]);
  const [title, setTitle] = React.useState('New chat');
  const [prompt, setPrompt] = React.useState('');
  const [streaming, setStreaming] = React.useState(false);
  const [loadingChat, setLoadingChat] = React.useState(false);
  const [showModelMenu, setShowModelMenu] = React.useState(false);
  const [showTempMenu, setShowTempMenu] = React.useState(false);
  const messagesRef = React.useRef(null);
  const abortRef = React.useRef(null);
  // Only the FIRST time the workspace mounts with no chatId do we auto-pick
  // the most recent conversation. After the user explicitly clicks "+ New",
  // chatId goes back to null and we must stay on the empty greeting instead
  // of yanking them back into the previous chat.
  const hasInitialized = React.useRef(false);

  // Load a chat from the backend when chatId changes.
  React.useEffect(() => {
    let cancelled = false;
    const apiKey = getApiKey();
    if (!apiKey) return;
    (async () => {
      if (chatId == null) {
        if (hasInitialized.current) {
          // User explicitly cleared — render the empty state, no auto-load.
          setMessages([INITIAL_GREETING]);
          setTitle('New chat');
          setLoadingChat(false);
          return;
        }
        hasInitialized.current = true;
        // First mount with no chat — pick the most recent for convenience.
        try {
          const r = await fetch(`${apiBase()}/chats`, {
            headers: { Authorization: `Bearer ${apiKey}` },
          });
          if (!r.ok) return;
          const j = await r.json();
          const first = j?.data?.[0];
          if (!cancelled && first) setChatId(first.id);
        } catch {}
        return;
      }
      hasInitialized.current = true;
      setLoadingChat(true);
      try {
        const r = await fetch(`${apiBase()}/chats/${chatId}`, {
          headers: { Authorization: `Bearer ${apiKey}` },
        });
        if (!r.ok) {
          // Stale id — drop it.
          if (!cancelled) {
            setChatId(null);
            setMessages([INITIAL_GREETING]);
            setTitle('New chat');
          }
          return;
        }
        const j = await r.json();
        if (!cancelled) {
          setTitle(j.title || 'New chat');
          setMessages(
            j.messages && j.messages.length > 0
              ? j.messages.map((m) => ({ role: m.role, content: m.content }))
              : [INITIAL_GREETING]
          );
        }
      } finally {
        if (!cancelled) setLoadingChat(false);
      }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chatId]);

  // Persist the full message list — creates the chat the first time, updates it after.
  const persist = async (finalMessages) => {
    const apiKey = getApiKey();
    if (!apiKey) return;
    const persistable = finalMessages.filter((m) => m.content && m !== INITIAL_GREETING);
    if (persistable.length === 0) return;
    try {
      if (chatId == null) {
        const r = await fetch(`${apiBase()}/chats`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
          body: JSON.stringify({ messages: persistable }),
        });
        if (r.ok) {
          const j = await r.json();
          setChatId(j.id);
          setTitle(j.title || 'New chat');
        }
      } else {
        const r = await fetch(`${apiBase()}/chats/${chatId}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
          body: JSON.stringify({ messages: persistable }),
        });
        if (r.ok) {
          const j = await r.json();
          if (j.title) setTitle(j.title);
        }
      }
    } catch {}
  };

  // Start a fresh conversation: abort in-flight stream, clear state, drop the chatId.
  const handleNewChat = () => {
    abortRef.current?.abort?.();
    setMessages([INITIAL_GREETING]);
    setTitle('New chat');
    setPrompt('');
    setStreaming(false);
    onNewChat?.();
  };

  const handleDelete = async () => {
    if (chatId == null) { handleNewChat(); return; }
    if (!confirm('Delete this conversation?')) return;
    const apiKey = getApiKey();
    try {
      await fetch(`${apiBase()}/chats/${chatId}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${apiKey}` },
      });
    } catch {}
    handleNewChat();
  };

  React.useEffect(() => {
    if (messagesRef.current) {
      messagesRef.current.scrollTop = messagesRef.current.scrollHeight;
    }
  }, [messages]);

  // Append a delta to the last (assistant) message.
  const appendToLast = (delta) => {
    setMessages((m) => {
      const out = m.slice();
      const last = out[out.length - 1];
      out[out.length - 1] = { ...last, content: (last.content || '') + delta };
      return out;
    });
  };

  // Stream from /v1/chat/completions using SSE. Parses `data: {...}` and `data: [DONE]`.
  const send = async () => {
    if (!prompt.trim() || streaming) return;
    const text = prompt.trim();
    const history = messages
      .filter((m) => m.content)
      .map((m) => ({ role: m.role, content: m.content }));
    const reqMessages = [...history, { role: 'user', content: text }];

    setMessages((m) => [...m, { role: 'user', content: text }, { role: 'assistant', content: '' }]);
    setPrompt('');
    setStreaming(true);

    const apiKey = getApiKey();
    if (!apiKey) {
      appendToLast("No API key set. Sign in again with your API_KEY value as the password.");
      setStreaming(false);
      return;
    }

    const controller = new AbortController();
    abortRef.current = controller;

    try {
      const res = await fetch(`${apiBase()}/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model: model.id,
          messages: reqMessages,
          stream: params.streaming,
          temperature: params.temperature,
          max_tokens: params.maxTokens,
          use_rag: params.useRag,
          rag_top_k: 4,
        }),
        signal: controller.signal,
      });

      if (!res.ok) {
        let detail = `HTTP ${res.status}`;
        try {
          const j = await res.json();
          detail = j?.error?.message || j?.detail || detail;
        } catch {}
        appendToLast(`Error: ${detail}`);
        setStreaming(false);
        return;
      }

      // Non-streaming path
      if (!params.streaming) {
        const j = await res.json();
        const content = j?.choices?.[0]?.message?.content || '';
        appendToLast(content);
        setStreaming(false);
        return;
      }

      // SSE path — read text stream and parse `data: ` lines
      const reader = res.body.getReader();
      const decoder = new TextDecoder('utf-8');
      let buffer = '';
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';
        for (const raw of lines) {
          const line = raw.trim();
          if (!line.startsWith('data:')) continue;
          const payload = line.slice(5).trim();
          if (payload === '[DONE]') continue;
          try {
            const chunk = JSON.parse(payload);
            const delta = chunk?.choices?.[0]?.delta?.content;
            if (delta) appendToLast(delta);
          } catch {}
        }
      }
    } catch (err) {
      if (err.name !== 'AbortError') {
        appendToLast(`\n[stream error: ${err.message}]`);
      }
    } finally {
      setStreaming(false);
      abortRef.current = null;
      // Snapshot the latest messages and save to backend.
      setMessages((m) => { persist(m); return m; });
    }
  };

  return (
    <section className="ws-chat">
      <div className="ws-chat-head">
        <div>
          <div className="ws-chat-title">{title}</div>
          <div className="ws-chat-sub mono small">
            {chatId ? `chat · ${chatId.slice(-8)}` : 'new chat'} · {model.name}
            {loadingChat && ' · loading…'}
          </div>
        </div>
        <div className="ws-chat-head-actions">
          <button className="ws-icon-btn" title="New chat" onClick={handleNewChat}>
            + New
          </button>
          <button className="ws-icon-btn" title="Delete chat" onClick={handleDelete}>
            <Icon.Close size={12} />
          </button>
        </div>
      </div>

      <div className="ws-messages" ref={messagesRef}>
        {messages.map((m, i) => (
          <div key={i} className={`ws-msg ${m.role}`}>
            {m.role === 'assistant' && (
              <div className="ws-msg-avatar" style={{ background: 'transparent', border: 'none' }}>
                <img src="favicon.png" alt="" style={{ width: 24, height: 24, objectFit: 'contain', display: 'block' }} />
              </div>
            )}
            <div className="ws-msg-body">
              {m.role === 'user' ? (
                <div className="ws-bubble user">{m.content}</div>
              ) : (
                <div className="ws-bubble assistant">
                  {m.content || <span className="ws-thinking">Generating<span className="ws-thinking-dots"><i /><i /><i /></span></span>}
                  {streaming && i === messages.length - 1 && m.content && <span className="ws-caret" />}
                </div>
              )}
            </div>
          </div>
        ))}
      </div>

      <div className="ws-input-wrap">
        <div className="ws-input-card">
          <textarea
            className="ws-input"
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            placeholder="Ask anything…"
            rows={1}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                send();
              }
            }}
          />
          <div className="ws-input-bar">
            <div className="ws-input-controls">
              <div style={{ position: 'relative' }}>
                <button
                  className="ws-chip"
                  onClick={() => setShowTempMenu(!showTempMenu)}
                >
                  temp <span className="mono">{params.temperature.toFixed(2)}</span>
                </button>
                {showTempMenu && (
                  <div style={{
                    position: 'absolute', bottom: '100%', left: 0, marginBottom: '4px',
                    background: '#1c1c1e', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '8px',
                    padding: '12px 14px', minWidth: '220px', zIndex: 100,
                    boxShadow: '0 8px 24px rgba(0,0,0,0.4)',
                    fontFamily: "'Geist', -apple-system, BlinkMacSystemFont, sans-serif"
                  }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '11px', color: '#a1a1a6', marginBottom: '6px' }}>
                      <span>Temperature</span>
                      <span className="mono" style={{ color: '#f2f2f5' }}>{params.temperature.toFixed(2)}</span>
                    </div>
                    <input
                      type="range"
                      min="0"
                      max="1"
                      step="0.05"
                      value={params.temperature}
                      onChange={(e) => setParams((p) => ({ ...p, temperature: parseFloat(e.target.value) }))}
                      style={{ width: '100%', accentColor: '#f2f2f5' }}
                    />
                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '10px', color: '#71717a', marginTop: '4px' }}>
                      <span>precise</span>
                      <span>creative</span>
                    </div>
                  </div>
                )}
              </div>
              <button
                className={`ws-chip ${params.streaming ? 'on' : ''}`}
                onClick={() => setParams((p) => ({ ...p, streaming: !p.streaming }))}
              >
                streaming {params.streaming ? 'on' : 'off'}
              </button>
              <button
                className={`ws-chip ${params.useRag ? 'on' : ''}`}
                onClick={() => setParams((p) => ({ ...p, useRag: !p.useRag }))}
                title="Pull from your uploaded documents"
              >
                use docs {params.useRag ? 'on' : 'off'}
              </button>
              <div style={{ position: 'relative' }}>
                <button
                  className="ws-chip"
                  style={{ display: 'flex', alignItems: 'center', gap: '6px', fontFamily: "'Geist', -apple-system, BlinkMacSystemFont, sans-serif" }}
                  onClick={() => setShowModelMenu(!showModelMenu)}
                >
                  {model.name}
                  <svg width="12" height="12" viewBox="0 0 12 12" fill="currentColor">
                    <path d="M2 4l4 4 4-4z" />
                  </svg>
                </button>
                {showModelMenu && (
                  <div style={{
                    position: 'absolute', bottom: '100%', left: 0, marginBottom: '4px',
                    background: '#1c1c1e', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '8px',
                    minWidth: '160px', zIndex: 100, boxShadow: '0 8px 24px rgba(0,0,0,0.4)'
                  }}>
                    {MODELS.map((m) => (
                      <button
                        key={m.id}
                        style={{
                          display: 'block', width: '100%', padding: '10px 12px', border: 'none',
                          background: m.id === model.id ? 'rgba(255,255,255,0.1)' : 'transparent',
                          color: m.id === model.id ? '#f2f2f5' : '#a1a1a6',
                          textAlign: 'left', cursor: 'pointer', fontSize: '13px',
                          borderBottom: m.id !== MODELS[MODELS.length-1].id ? '1px solid rgba(255,255,255,0.05)' : 'none',
                          fontWeight: m.id === model.id ? '500' : '400',
                          transition: 'all 120ms ease',
                          fontFamily: "'Geist', -apple-system, BlinkMacSystemFont, sans-serif"
                        }}
                        onMouseEnter={(e) => e.target.style.background = 'rgba(255,255,255,0.05)'}
                        onMouseLeave={(e) => e.target.style.background = m.id === model.id ? 'rgba(255,255,255,0.1)' : 'transparent'}
                        onClick={() => {
                          setModel(m);
                          setShowModelMenu(false);
                        }}
                      >
                        {m.name}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </div>
            <button
              className="ws-send"
              disabled={!prompt.trim() || streaming}
              onClick={send}
            >
              {streaming ? 'Streaming…' : 'Send'}
              {!streaming && <Icon.Arrow size={13} />}
            </button>
          </div>
        </div>
      </div>
    </section>
  );
};

// --- API view ------------------------------------------------------

const ApiView = () => {
  const [copied, setCopied] = React.useState(null);
  const copy = (key, val) => {
    navigator.clipboard?.writeText(val).catch(() => {});
    setCopied(key);
    setTimeout(() => setCopied((c) => (c === key ? null : c)), 1400);
  };
  const apiKey = getApiKey() || '(sign in to set)';
  const masked = apiKey.length > 8
    ? apiKey.slice(0, 4) + '•'.repeat(Math.max(0, apiKey.length - 8)) + apiKey.slice(-4)
    : apiKey;
  const baseUrl = `${window.location.origin}/v1`;
  const endpoints = [
    { method: 'POST', path: '/v1/chat/completions', desc: 'Generate chat completions (streaming or full).' },
    { method: 'GET',  path: '/v1/models', desc: 'List configured models and their loaded status.' },
    { method: 'POST', path: '/v1/cache/clear', desc: 'Clear the semantic cache (admin key required).' },
    { method: 'GET',  path: '/health', desc: 'Liveness probe — engine + model readiness.' },
    { method: 'GET',  path: '/metrics', desc: 'Prometheus-compatible metrics scrape target.' },
  ];
  return (
    <section className="ws-view">
      <div className="ws-view-head">
        <h2>API</h2>
        <p>Drop-in OpenAI-compatible endpoints. Bearer auth, SSE streaming, trace IDs in trailers.</p>
      </div>

      <div className="ws-api-row">
        <div className="ws-api-card">
          <div className="ws-api-label">Base URL</div>
          <div className="ws-api-value">
            <code className="mono">{baseUrl}</code>
            <button className="ws-icon-btn" onClick={() => copy('url', baseUrl)}>
              {copied === 'url' ? '✓' : 'Copy'}
            </button>
          </div>
        </div>
        <div className="ws-api-card">
          <div className="ws-api-label">API key · production</div>
          <div className="ws-api-value">
            <code className="mono">{masked}</code>
            <button className="ws-icon-btn" onClick={() => copy('key', apiKey)}>
              {copied === 'key' ? '✓' : 'Copy'}
            </button>
          </div>
        </div>
      </div>

      <div className="ws-endpoints">
        {endpoints.map((e) => (
          <div className="ws-endpoint" key={e.path}>
            <span className={`ws-method ${e.method.toLowerCase()}`}>{e.method}</span>
            <code className="mono ws-path">{e.path}</code>
            <span className="ws-endpoint-desc">{e.desc}</span>
          </div>
        ))}
      </div>

      <div className="ws-code-block">
        <div className="ws-code-head">
          <span className="mono small">curl</span>
          <button className="ws-icon-btn" onClick={() => copy('curl', 'curl example')}>
            {copied === 'curl' ? '✓' : 'Copy'}
          </button>
        </div>
        <pre className="mono">{`curl ${baseUrl}/chat/completions \\
  -H "Authorization: Bearer $API_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{
    "model": "mistral-7b",
    "stream": true,
    "messages": [{"role":"user","content":"Hello"}]
  }'`}</pre>
      </div>
    </section>
  );
};

// --- History / Metrics / Settings (minimal) ------------------------

// Format a unix timestamp as a relative "5m ago" / "2h ago" string.
const relTime = (ts) => {
  if (!ts) return '—';
  const diff = Math.max(0, Date.now() / 1000 - ts);
  if (diff < 60) return 'just now';
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return `${Math.floor(diff / 86400)}d ago`;
};

// --- Documents view (RAG upload + management) ----------------------

const DocumentsView = () => {
  const [docs, setDocs] = React.useState(null);
  const [err, setErr] = React.useState(null);
  const [reloadKey, setReloadKey] = React.useState(0);
  const [name, setName] = React.useState('');
  const [text, setText] = React.useState('');
  const [busy, setBusy] = React.useState(false);

  React.useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const apiKey = getApiKey();
        if (!apiKey) { setErr('not signed in'); return; }
        const r = await fetch(`${apiBase()}/documents`, {
          headers: { Authorization: `Bearer ${apiKey}` },
        });
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        const j = await r.json();
        if (!cancelled) { setDocs(j.data || []); setErr(null); }
      } catch (e) {
        if (!cancelled) setErr(e.message);
      }
    })();
    return () => { cancelled = true; };
  }, [reloadKey]);

  const upload = async () => {
    if (busy) return;
    const finalName = name.trim() || 'pasted-text.txt';
    if (!text.trim()) { setErr('paste some text first'); return; }
    setBusy(true);
    setErr(null);
    try {
      const apiKey = getApiKey();
      const r = await fetch(`${apiBase()}/documents`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
        body: JSON.stringify({ name: finalName, text }),
      });
      if (!r.ok) {
        const j = await r.json().catch(() => ({}));
        throw new Error(j?.detail?.message || `HTTP ${r.status}`);
      }
      setName(''); setText('');
      setReloadKey((k) => k + 1);
    } catch (e) {
      setErr(e.message);
    } finally {
      setBusy(false);
    }
  };

  // File-input: read .txt / .md as text. PDFs would need pypdf — out of scope here.
  const onFile = (e) => {
    const f = e.target.files?.[0];
    if (!f) return;
    if (!name) setName(f.name);
    const reader = new FileReader();
    reader.onload = () => setText(String(reader.result || ''));
    reader.readAsText(f);
  };

  const onDelete = async (id, e) => {
    e?.stopPropagation?.();
    if (!confirm('Delete this document?')) return;
    try {
      const apiKey = getApiKey();
      await fetch(`${apiBase()}/documents/${id}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${apiKey}` },
      });
      setReloadKey((k) => k + 1);
    } catch {}
  };

  return (
    <section className="ws-view">
      <div className="ws-view-head">
        <h2>Documents</h2>
        <p>
          Upload reference material, the chat can pull from it via retrieval-augmented
          generation (toggle <span className="mono">use docs</span> in the input bar).
          Plain-text and Markdown only.
        </p>
      </div>

      <div className="ws-api-card" style={{ marginBottom: 20 }}>
        <div className="ws-api-label">Upload</div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginTop: 8 }}>
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
            <input
              type="text"
              placeholder="document name (optional)"
              value={name}
              onChange={(e) => setName(e.target.value)}
              style={{
                flex: 1, minWidth: 200, height: 36, padding: '0 12px',
                background: 'rgba(255,255,255,0.04)',
                border: '1px solid rgba(255,255,255,0.08)',
                borderRadius: 9, color: '#F2F2F5',
                fontFamily: 'inherit', fontSize: 13,
              }}
            />
            <label className="ws-set-btn" style={{
              cursor: 'pointer', display: 'inline-flex', alignItems: 'center',
              justifyContent: 'center', height: 36, padding: '0 16px',
              whiteSpace: 'nowrap'
            }}>
              Pick file
              <input type="file" accept=".txt,.md,text/*" onChange={onFile} style={{ display: 'none' }} />
            </label>
          </div>
          <textarea
            placeholder="or paste text here…"
            value={text}
            onChange={(e) => setText(e.target.value)}
            rows={6}
            style={{
              width: '100%', padding: 12,
              background: 'rgba(255,255,255,0.04)',
              border: '1px solid rgba(255,255,255,0.08)',
              borderRadius: 9, color: '#F2F2F5',
              fontFamily: 'inherit', fontSize: 13, resize: 'vertical',
            }}
          />
          {err && (
            <div style={{ color: 'oklch(0.85 0.13 25)', fontSize: 12.5 }}>{err}</div>
          )}
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span className="mono small" style={{ color: 'rgba(242,242,245,0.45)' }}>
              {text ? `${text.length.toLocaleString()} chars · ~${Math.ceil(text.split(/\s+/).length / 350)} chunks` : 'no content yet'}
            </span>
            <button className="ws-set-btn" onClick={upload} disabled={busy || !text.trim()}>
              {busy ? 'Uploading…' : 'Upload'}
            </button>
          </div>
        </div>
      </div>

      <div className="ws-history">
        {docs === null && !err && (
          <div className="ws-history-row" style={{ color: 'rgba(242,242,245,0.4)' }}>Loading…</div>
        )}
        {docs && docs.length === 0 && (
          <div className="ws-history-row" style={{ color: 'rgba(242,242,245,0.45)' }}>
            No documents yet. Upload something above.
          </div>
        )}
        {(docs || []).map((d) => (
          <div className="ws-history-row" key={d.id}>
            <div className="ws-history-meta">
              <div className="ws-history-title">{d.name}</div>
              <div className="ws-history-preview mono small">
                {d.chunk_count} chunks · {Math.round(d.size_bytes / 1024)} KB · {d.content_type}
              </div>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
              <div className="mono small" style={{ color: 'rgba(242,242,245,0.4)' }}>
                {relTime(d.uploaded_at)}
              </div>
              <button className="ws-icon-btn" title="Delete" onClick={(e) => onDelete(d.id, e)}>
                <Icon.Close size={11} />
              </button>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
};

const HistoryView = ({ openChat }) => {
  const [chats, setChats] = React.useState(null);
  const [err, setErr] = React.useState(null);
  const [reloadKey, setReloadKey] = React.useState(0);

  React.useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const apiKey = getApiKey();
        if (!apiKey) { setErr('not signed in'); return; }
        const r = await fetch(`${apiBase()}/chats?limit=100`, {
          headers: { Authorization: `Bearer ${apiKey}` },
        });
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        const j = await r.json();
        if (!cancelled) { setChats(j.data || []); setErr(null); }
      } catch (e) {
        if (!cancelled) setErr(e.message);
      }
    })();
    return () => { cancelled = true; };
  }, [reloadKey]);

  const onDelete = async (id, e) => {
    e?.stopPropagation?.();
    if (!confirm('Delete this conversation?')) return;
    try {
      const apiKey = getApiKey();
      await fetch(`${apiBase()}/chats/${id}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${apiKey}` },
      });
      setReloadKey((k) => k + 1);
    } catch {}
  };

  return (
    <section className="ws-view">
      <div className="ws-view-head">
        <h2>History</h2>
        <p>
          {err
            ? <span style={{ color: 'oklch(0.78 0.16 25)' }}>Could not reach /v1/chats: {err}</span>
            : `Your conversations · saved in Redis · ${chats?.length ?? 0} total.`}
        </p>
      </div>
      <div className="ws-history">
        {chats === null && !err && (
          <div className="ws-history-row" style={{ color: 'rgba(242,242,245,0.4)' }}>Loading…</div>
        )}
        {chats && chats.length === 0 && (
          <div className="ws-history-row" style={{ color: 'rgba(242,242,245,0.45)' }}>
            No conversations yet. Send a message in the Chats tab and it'll appear here.
          </div>
        )}
        {(chats || []).map((c) => (
          <div
            className="ws-history-row"
            key={c.id}
            onClick={() => openChat?.(c.id)}
            style={{ cursor: 'pointer' }}
          >
            <div className="ws-history-meta">
              <div className="ws-history-title">{c.title}</div>
              <div className="ws-history-preview mono small">
                {c.message_count} messages · id {c.id.slice(-8)}
              </div>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
              <div className="mono small" style={{ color: 'rgba(242,242,245,0.4)' }}>
                {relTime(c.updated_at)}
              </div>
              <button
                className="ws-icon-btn"
                title="Delete"
                onClick={(e) => onDelete(c.id, e)}
              >
                <Icon.Close size={11} />
              </button>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
};

const SettingsView = () => {
  const [theme, setTheme] = React.useState(() => {
    try { return localStorage.getItem('wsTheme') || 'dark'; } catch { return 'dark'; }
  });
  const [defaultModel, setDefaultModel] = React.useState(MODELS[1].id);
  const [temp, setTemp] = React.useState(0.7);
  const [ctx, setCtx] = React.useState(8192);

  const applyTheme = (t) => {
    const resolved = t === 'system'
      ? (window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark')
      : t;
    document.documentElement.setAttribute('data-theme', resolved);
    try { localStorage.setItem('wsTheme', t); } catch {}
    setTheme(t);
  };

  // Apply on mount
  React.useEffect(() => { applyTheme(theme); }, []);
  return (
    <section className="ws-view">
      <div className="ws-view-head">
        <h2>Settings</h2>
        <p>Defaults for this environment. Saved per-user.</p>
      </div>
      <div className="ws-settings">
        <div className="ws-set-row">
          <div className="ws-set-meta">
            <div className="ws-set-label">Theme</div>
            <div className="ws-set-desc">Workspace appearance.</div>
          </div>
          <div className="ws-segment">
            {['dark', 'light', 'system'].map((v) => (
              <button key={v} className={theme === v ? 'on' : ''} onClick={() => applyTheme(v)}>{v}</button>
            ))}
          </div>
        </div>
        <div className="ws-set-row">
          <div className="ws-set-meta">
            <div className="ws-set-label">Default model</div>
            <div className="ws-set-desc">Used for new conversations.</div>
          </div>
          <select className="ws-select" value={defaultModel} onChange={(e) => setDefaultModel(e.target.value)}>
            {MODELS.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
          </select>
        </div>
        <div className="ws-set-row">
          <div className="ws-set-meta">
            <div className="ws-set-label">Default temperature</div>
            <div className="ws-set-desc">Higher values increase variability.</div>
          </div>
          <div className="ws-range">
            <input type="range" min="0" max="1" step="0.05" value={temp} onChange={(e) => setTemp(parseFloat(e.target.value))} />
            <span className="mono small">{temp.toFixed(2)}</span>
          </div>
        </div>
        <div className="ws-set-row">
          <div className="ws-set-meta">
            <div className="ws-set-label">Default context</div>
            <div className="ws-set-desc">Maximum prompt + response tokens.</div>
          </div>
          <select className="ws-select" value={ctx} onChange={(e) => setCtx(parseInt(e.target.value))}>
            {[2048, 4096, 8192, 16384, 32768, 131072].map((n) => <option key={n} value={n}>{n.toLocaleString()}</option>)}
          </select>
        </div>
        <ApiKeyRow />
      </div>
    </section>
  );
};

// Real API-key management — pulls /v1/auth/me to show the current account,
// /v1/auth/rotate-key to regenerate it. The new key replaces the one in
// localStorage so subsequent requests use it immediately.
const ApiKeyRow = () => {
  const [me, setMe] = React.useState(null);
  const [err, setErr] = React.useState(null);
  const [busy, setBusy] = React.useState(false);
  const [revealed, setRevealed] = React.useState(null); // newly-rotated key, shown once
  const [copied, setCopied] = React.useState(false);

  const fetchMe = async () => {
    const apiKey = getApiKey();
    if (!apiKey) { setErr('not signed in'); return; }
    try {
      const r = await fetch(`${apiBase()}/auth/me`, {
        headers: { Authorization: `Bearer ${apiKey}` },
      });
      if (r.status === 404) {
        // Static API_KEY env-var — no user account behind this token.
        setMe({ master: true });
        setErr(null);
        return;
      }
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const j = await r.json();
      setMe(j);
      setErr(null);
    } catch (e) {
      setErr(e.message);
    }
  };

  React.useEffect(() => { fetchMe(); }, []);

  const rotate = async () => {
    if (busy) return;
    if (!confirm('Rotate API key? Your current key will stop working immediately.')) return;
    setBusy(true);
    setRevealed(null);
    try {
      const apiKey = getApiKey();
      const r = await fetch(`${apiBase()}/auth/rotate-key`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${apiKey}` },
      });
      if (!r.ok) {
        const j = await r.json().catch(() => ({}));
        throw new Error(j?.detail?.message || `HTTP ${r.status}`);
      }
      const j = await r.json();
      try { localStorage.setItem('apiKey', j.api_key); } catch {}
      setRevealed(j.api_key);
      await fetchMe();
    } catch (e) {
      setErr(e.message);
    } finally {
      setBusy(false);
    }
  };

  const copy = (text) => {
    navigator.clipboard?.writeText(text).catch(() => {});
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  if (me?.master) {
    return (
      <div className="ws-set-row">
        <div className="ws-set-meta">
          <div className="ws-set-label">API key</div>
          <div className="ws-set-desc">You're signed in with the static API_KEY env var. Register an account to manage a personal key.</div>
        </div>
      </div>
    );
  }

  return (
    <>
      <div className="ws-set-row">
        <div className="ws-set-meta">
          <div className="ws-set-label">Account</div>
          <div className="ws-set-desc">
            {err
              ? <span style={{ color: 'oklch(0.78 0.16 25)' }}>{err}</span>
              : me ? `${me.email} · ${me.role} · since ${new Date(me.created_at * 1000).toLocaleDateString()}` : 'loading…'}
          </div>
        </div>
      </div>
      <div className="ws-set-row">
        <div className="ws-set-meta">
          <div className="ws-set-label">API key</div>
          <div className="ws-set-desc">
            <span className="mono">{revealed || me?.api_key_masked || '—'}</span>
            {revealed && (
              <span style={{ marginLeft: 8, color: 'oklch(0.78 0.13 80)' }}>
                · New key — copy now, it won't be shown again
              </span>
            )}
          </div>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          {revealed && (
            <button className="ws-set-btn" onClick={() => copy(revealed)}>
              {copied ? 'Copied' : 'Copy'}
            </button>
          )}
          <button className="ws-set-btn danger" onClick={rotate} disabled={busy}>
            {busy ? 'Rotating…' : 'Rotate key'}
          </button>
        </div>
      </div>
    </>
  );
};

// --- Composer ------------------------------------------------------

const DEFAULT_PARAMS = { temperature: 0.7, maxTokens: 512, streaming: true, useRag: false };

const UserWorkspace = ({ onSignOut, leaving }) => {
  const [model, setModel] = React.useState(MODELS[1]);
  const [active, setActive] = React.useState('chat');
  const [railCollapsed, setRailCollapsed] = React.useState(false);
  // Lifted: the currently-open conversation. ChatView reads/writes it; the
  // History tab can switch tabs and open a different chat.
  const [chatId, setChatId] = React.useState(null);
  // Lifted: per-chat params. Persist across tab switches; reset only on new chat.
  const [params, setParams] = React.useState(DEFAULT_PARAMS);
  const openChat = (id) => { setChatId(id); setActive('chat'); };
  const newChat = () => {
    setChatId(null);
    setActive('chat');
    setParams(DEFAULT_PARAMS);  // reset settings to defaults on new chat
  };

  return (
    <div className={`workspace user ${leaving ? 'leaving' : ''}`}>
      <WsTopBar model={model} setModel={setModel} onSignOut={onSignOut} />
      <div className="ws-body">
        <WsSidebar active={active} setActive={setActive} />
        <main className="ws-main">
          {active === 'chat' && (
            <ChatView model={model} setModel={setModel} chatId={chatId} setChatId={setChatId} onNewChat={newChat} params={params} setParams={setParams} />
          )}
          {active === 'documents' && <DocumentsView />}
          {active === 'api' && <ApiView />}
          {active === 'history' && <HistoryView openChat={openChat} />}
          {active === 'settings' && <SettingsView />}
        </main>
        {active === 'chat' && (
          <MetricsRail collapsed={railCollapsed} onToggle={() => setRailCollapsed((v) => !v)} />
        )}
      </div>
    </div>
  );
};

Object.assign(window, { UserWorkspace, MODELS });
