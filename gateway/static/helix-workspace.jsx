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
  { id: 'phi-3.5-mini', name: 'Phi-3.5 Mini', tag: 'reasoning', ctx: 4096, backend: 'llama.cpp', quant: 'Q4_K_M', status: 'cold', size: '2.4 GB' },
  { id: 'llama-3.2-3b', name: 'Llama 3.2 3B', tag: 'chat', ctx: 4096, backend: 'llama.cpp', quant: 'Q4_K_M', status: 'cold', size: '2.0 GB' },
];

// Used as a friendly initial greeting only — real replies come from the engine.
const SAMPLE_REPLIES = [
  "I'm running locally on this machine. Ask me anything — your prompt never leaves the host.",
];

const SAMPLE_CHATS = [
  { id: 'c1', title: 'Streaming tokens & SSE', when: '2m', preview: 'How does Helix route a request…' },
  { id: 'c2', title: 'Cold-start vs warm pool', when: '1h', preview: 'Why is my 70B cold start…' },
  { id: 'c3', title: 'OpenAI compat checklist', when: 'Yesterday', preview: 'Does function calling work…' },
  { id: 'c4', title: 'AWQ vs FP8 tradeoff', when: 'Mon', preview: 'Quant pick for 70B chat…' },
  { id: 'c5', title: 'Quota & fair-share', when: 'Mar 14', preview: 'How is fairness enforced…' },
];

const SIDEBAR_ITEMS = [
  { id: 'chat', label: 'Chats', icon: Icon.Stream },
  { id: 'models', label: 'Models', icon: Icon.Chip },
  { id: 'metrics', label: 'Metrics', icon: Icon.Pulse },
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
          <span className="ws-brand-name">Inference</span>
          <span className="ws-divider" />
          <span className="ws-project">local · single-node</span>
        </div>
      </div>

      <div className="ws-topbar-center">
        <button
          className={`ws-model ${open ? 'open' : ''}`}
          onClick={() => setOpen((v) => !v)}
        >
          <span className="ws-model-dot" />
          <span className="ws-model-name">{model.name}</span>
          <span className="ws-model-meta">{model.backend} · {model.quant} · {model.ctx.toLocaleString()}</span>
          <Icon.Down size={12} />
        </button>
        {open && (
          <div className="ws-model-menu" onMouseLeave={() => setOpen(false)}>
            {MODELS.map((m) => (
              <button
                key={m.id}
                className={`ws-model-item ${m.id === model.id ? 'on' : ''}`}
                onClick={() => { setModel(m); setOpen(false); }}
              >
                <span className={`ws-model-dot ${m.status === 'loaded' ? 'on' : 'off'}`} />
                <div className="ws-model-item-meta">
                  <div className="ws-model-item-name">{m.name}</div>
                  <div className="ws-model-item-sub">{m.backend} · {m.quant} · ctx {m.ctx.toLocaleString()}</div>
                </div>
                <span className="ws-model-item-status">{m.status}</span>
              </button>
            ))}
          </div>
        )}
      </div>

      <div className="ws-topbar-right">
        <div className="ws-health">
          <span className={`ws-dot ${health.status === 'ok' ? 'on' : health.status === 'degraded' ? 'idle' : 'off'}`} />
          <span>Engine</span>
          <span className="ws-divider" />
          <span className="mono">
            {health.latencyMs != null ? <>{health.latencyMs}<small>ms</small></> : '—'}
          </span>
        </div>
        <button className="ws-avatar" onClick={onSignOut} title="Sign out">
          <span>A</span>
        </button>
      </div>
    </header>
  );
};

// --- Sidebar -------------------------------------------------------

const WsSidebar = ({ active, setActive }) => (
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
      <div className="ws-side-foot-row">
        <span className="ws-dot on" />
        <span>All systems healthy</span>
      </div>
      <div className="ws-side-foot-row mono small">v2.4.1 · a2c7d1</div>
    </div>
  </aside>
);

// --- Sparkline -----------------------------------------------------

const Sparkline = ({ seed = '', w = 86, h = 26, stroke = 'rgba(242,242,245,0.45)' }) => {
  const points = React.useMemo(() => {
    let s = 1;
    for (let i = 0; i < seed.length; i++) s = (s + seed.charCodeAt(i) * 31) % 100000;
    const out = [];
    for (let i = 0; i < 22; i++) {
      s = (s * 9301 + 49297) % 233280;
      out.push(s / 233280);
    }
    return out;
  }, [seed]);
  const path = points
    .map((p, i) => `${i === 0 ? 'M' : 'L'} ${(i / (points.length - 1)) * w} ${h - p * (h - 2) - 1}`)
    .join(' ');
  const last = points[points.length - 1];
  return (
    <svg width={w} height={h} className="ws-spark" viewBox={`0 0 ${w} ${h}`}>
      <path d={path} stroke={stroke} strokeWidth="1" fill="none" strokeLinecap="round" strokeLinejoin="round" />
      <circle cx={w} cy={h - last * (h - 2) - 1} r="1.6" fill={stroke} />
    </svg>
  );
};

// --- Metrics rail --------------------------------------------------

const useTicker = (interval = 1200) => {
  const [t, setT] = React.useState(0);
  React.useEffect(() => {
    const id = setInterval(() => setT((x) => x + 1), interval);
    return () => clearInterval(id);
  }, [interval]);
  return t;
};

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
          <Sparkline seed={`${m.label}-${summary?.uptime_sec || 0}-${i}`} />
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

const ChatView = ({ model, chatId, setChatId, onNewChat }) => {
  const [messages, setMessages] = React.useState([INITIAL_GREETING]);
  const [title, setTitle] = React.useState('New chat');
  const [prompt, setPrompt] = React.useState('');
  const [streaming, setStreaming] = React.useState(false);
  const [loadingChat, setLoadingChat] = React.useState(false);
  const [params, setParams] = React.useState({ temperature: 0.7, maxTokens: 512, streaming: true });
  const messagesRef = React.useRef(null);
  const abortRef = React.useRef(null);

  // Load a chat from the backend when chatId changes, or pick the most-recent
  // when chatId is null on first mount.
  React.useEffect(() => {
    let cancelled = false;
    const apiKey = getApiKey();
    if (!apiKey) return;
    (async () => {
      if (chatId == null) {
        // No specific chat selected — try to pick the most recent.
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
              <div className="ws-msg-avatar"><BrandMark dark size={14} /></div>
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
              <button className="ws-chip" title="Attach">
                <span className="mono">+</span> attach
              </button>
              <button className="ws-chip">
                temp <span className="mono">{params.temperature.toFixed(1)}</span>
              </button>
              <button className="ws-chip">
                max <span className="mono">{params.maxTokens}</span>
              </button>
              <button
                className={`ws-chip ${params.streaming ? 'on' : ''}`}
                onClick={() => setParams((p) => ({ ...p, streaming: !p.streaming }))}
              >
                streaming {params.streaming ? 'on' : 'off'}
              </button>
              <button className="ws-chip">
                ctx <span className="mono">{model.ctx.toLocaleString()}</span>
              </button>
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

// --- Models view ---------------------------------------------------

const ModelsView = () => {
  const [loaded, setLoaded] = React.useState([]);
  const [err, setErr] = React.useState(null);

  React.useEffect(() => {
    const apiKey = getApiKey();
    fetch(`${apiBase()}/models`, { headers: { Authorization: `Bearer ${apiKey}` } })
      .then((r) => r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`)))
      .then((j) => setLoaded((j?.data || []).map((m) => m.id)))
      .catch((e) => setErr(e.message));
  }, []);

  // Merge live status from /v1/models into the static config table.
  const rows = MODELS.map((m) => ({
    ...m,
    status: loaded.includes(m.id) ? 'loaded' : m.status,
  }));

  return (
    <section className="ws-view">
      <div className="ws-view-head">
        <h2>Models</h2>
        <p>
          {err
            ? <span style={{ color: 'oklch(0.78 0.16 25)' }}>Could not reach /v1/models: {err}</span>
            : 'Checkpoints configured for this stack. One is loaded at a time — controlled by MODEL_FILE in .env.'}
        </p>
      </div>
      <div className="ws-table">
        <div className="ws-tr head">
          <span>Model</span>
          <span>Backend</span>
          <span>Quant</span>
          <span>Context</span>
          <span>Size</span>
          <span>Status</span>
        </div>
        {rows.map((m) => (
          <div className="ws-tr" key={m.id}>
            <span className="ws-tr-model">
              <strong>{m.name}</strong>
              <small className="mono">{m.id}</small>
            </span>
            <span className="mono">{m.backend}</span>
            <span className="mono">{m.quant}</span>
            <span className="mono">{m.ctx.toLocaleString()}</span>
            <span className="mono">{m.size}</span>
            <span className={`ws-status-pill ${m.status}`}>
              <span className={`ws-dot ${m.status === 'loaded' ? 'on' : 'off'}`} />
              {m.status}
            </span>
          </div>
        ))}
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

const MetricsView = () => {
  const [summary, err] = useMetricsSummary(2000);
  const cards = [
    { label: 'Tokens / second',     value: summary?.tokens_per_sec ?? '—',                                  spark: 'tps' },
    { label: 'Time to first token', value: summary?.ttft_mean_ms ?? '—', unit: 'ms',                       spark: 'ttft' },
    { label: 'Requests / minute',   value: summary?.requests_per_min ?? '—',                                spark: 'rpm' },
    { label: 'Cache hit rate',      value: summary ? Math.round((summary.cache_hit_rate ?? 0) * 100) : '—', unit: '%', spark: 'cache' },
    { label: 'Total requests',      value: summary?.total_requests ?? '—',                                  spark: 'total' },
    { label: 'Errors',              value: summary?.errors ?? '—',                                          spark: 'err' },
  ];
  return (
    <section className="ws-view">
      <div className="ws-view-head">
        <h2>Metrics</h2>
        <p>
          {err
            ? <span style={{ color: 'oklch(0.78 0.16 25)' }}>Could not reach /v1/metrics/summary: {err}</span>
            : 'Live values from the FastAPI gateway, refreshed every 2 seconds.'}
        </p>
      </div>
      <div className="ws-metric-grid">
        {cards.map((c) => (
          <div className="ws-metric-card" key={c.label}>
            <div className="ws-metric-card-label">{c.label}</div>
            <div className="ws-metric-card-val">{c.value}{c.unit && <span className="unit">{c.unit}</span>}</div>
            <Sparkline seed={c.spark + (summary?.uptime_sec || 0)} w={220} h={48} />
          </div>
        ))}
      </div>
    </section>
  );
};

const SettingsView = () => {
  const [theme, setTheme] = React.useState('dark');
  const [defaultModel, setDefaultModel] = React.useState(MODELS[1].id);
  const [temp, setTemp] = React.useState(0.7);
  const [ctx, setCtx] = React.useState(8192);
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
              <button key={v} className={theme === v ? 'on' : ''} onClick={() => setTheme(v)}>{v}</button>
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
        <div className="ws-set-row">
          <div className="ws-set-meta">
            <div className="ws-set-label">API key</div>
            <div className="ws-set-desc">Rotate the active key for this environment.</div>
          </div>
          <button className="ws-set-btn">Rotate key</button>
        </div>
      </div>
    </section>
  );
};

// --- Composer ------------------------------------------------------

const UserWorkspace = ({ onSignOut, leaving }) => {
  const [model, setModel] = React.useState(MODELS[1]);
  const [active, setActive] = React.useState('chat');
  const [railCollapsed, setRailCollapsed] = React.useState(false);
  // Lifted: the currently-open conversation. ChatView reads/writes it; the
  // History tab can switch tabs and open a different chat.
  const [chatId, setChatId] = React.useState(null);
  const openChat = (id) => { setChatId(id); setActive('chat'); };
  const newChat = () => { setChatId(null); setActive('chat'); };

  return (
    <div className={`workspace user ${leaving ? 'leaving' : ''}`}>
      <WsTopBar model={model} setModel={setModel} onSignOut={onSignOut} />
      <div className="ws-body">
        <WsSidebar active={active} setActive={setActive} />
        <main className="ws-main">
          {active === 'chat' && (
            <ChatView model={model} chatId={chatId} setChatId={setChatId} onNewChat={newChat} />
          )}
          {active === 'models' && <ModelsView />}
          {active === 'metrics' && <MetricsView />}
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

Object.assign(window, { UserWorkspace, Sparkline, useTicker, MODELS });
