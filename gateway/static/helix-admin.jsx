// LLM Inference Server — Admin Workspace
// Operator dashboard with tabs across the top. Most sections still use
// generated demo data — Phase 2 wires real endpoints (users registry,
// queue tracker, log capture).

// Helpers for talking to /admin/* with the admin Bearer token.
const adminKey = () => {
  try { return localStorage.getItem('adminApiKey') || ''; } catch { return ''; }
};
const adminFetch = async (path, init = {}) => {
  const res = await fetch(`${window.location.origin}${path}`, {
    ...init,
    headers: {
      ...(init.headers || {}),
      Authorization: `Bearer ${adminKey()}`,
      ...(init.method && init.method !== 'GET' ? { 'Content-Type': 'application/json' } : {}),
    },
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
};

// Hook: poll an admin endpoint on an interval, return [data, error].
const useAdminPoll = (path, intervalMs = 2500) => {
  const [data, setData] = React.useState(null);
  const [err, setErr] = React.useState(null);
  React.useEffect(() => {
    let cancelled = false;
    const tick = async () => {
      try {
        const j = await adminFetch(path);
        if (!cancelled) { setData(j); setErr(null); }
      } catch (e) {
        if (!cancelled) setErr(e.message);
      }
    };
    tick();
    const id = setInterval(tick, intervalMs);
    return () => { cancelled = true; clearInterval(id); };
  }, [path, intervalMs]);
  return [data, err];
};

const ADMIN_SECTIONS = [
  { id: 'overview', label: 'Overview' },
  { id: 'users',    label: 'Users' },
  { id: 'metrics',  label: 'Metrics' },
  { id: 'queue',    label: 'Queue' },
  { id: 'cache',    label: 'Cache' },
  { id: 'logs',     label: 'Logs' },
  { id: 'models',   label: 'Models' },
  { id: 'settings', label: 'Settings' },
];

const fmtNum = (n) => n.toLocaleString();

// --- Top bar -------------------------------------------------------

const AdminTopBar = ({ active, setActive, onSignOut }) => (
  <header className="adm-topbar">
    <div className="adm-topbar-left">
      <div className="ws-brand">
        <BrandMark dark size={20} />
        <span className="ws-brand-name">Inference</span>
        <span className="ws-divider" />
        <span className="ws-project">
          <Icon.Shield size={12} />
          <span style={{ marginLeft: 6 }}>operator console</span>
        </span>
      </div>
    </div>
    <nav className="adm-tabs">
      {ADMIN_SECTIONS.map((s) => (
        <button
          key={s.id}
          className={`adm-tab ${active === s.id ? 'on' : ''}`}
          onClick={() => setActive(s.id)}
        >
          {s.label}
        </button>
      ))}
    </nav>
    <div className="adm-topbar-right">
      <div className="ws-health">
        <span className="ws-dot on" /> Engine healthy
      </div>
      <button className="ws-avatar admin" onClick={onSignOut} title="Sign out">
        <Icon.Shield size={13} />
      </button>
    </div>
  </header>
);

// --- Overview ------------------------------------------------------

const OverviewSection = () => {
  const [s, err] = useAdminPoll('/admin/metrics/summary', 2000);
  const fmt = (v, suffix = '') => (v == null ? '—' : `${v}${suffix}`);
  const cards = [
    { label: 'Requests / min',  value: fmt(s?.requests_per_min),                                      trend: `${s?.total_requests ?? 0} total`,  spark: 'rpm' },
    { label: 'In flight',        value: fmt(s?.in_flight),                                             trend: 'live',                              spark: 'au' },
    { label: 'Cache hit rate',   value: s ? `${Math.round((s.cache_hit_rate ?? 0) * 100)}%` : '—',     trend: `${s?.cache_hits ?? 0} / ${(s?.cache_hits ?? 0) + (s?.cache_misses ?? 0)}`, spark: 'cache' },
    { label: 'Tokens / second',  value: fmt(s?.tokens_per_sec),                                        trend: `${s?.tokens_total ?? 0} total`,     spark: 'tps' },
    { label: 'TTFT (mean)',      value: fmt(s?.ttft_mean_ms, 'ms'),                                    trend: 'mean',                              spark: 'ttft' },
    { label: 'Error rate',       value: s ? `${(s.error_rate * 100).toFixed(2)}%` : '—',               trend: `${s?.errors ?? 0} total`,           spark: 'err' },
  ];
  return (
    <div className="adm-section">
      <div className="ws-view-head">
        <h2>Overview</h2>
        <p>
          {err
            ? <span style={{ color: 'oklch(0.78 0.16 25)' }}>Could not reach /admin/metrics/summary: {err} — check ADMIN_API_KEY.</span>
            : 'Live values from the FastAPI gateway · refreshing every 2 seconds.'}
        </p>
      </div>
      <div className="adm-overview-grid">
        {cards.map((c, i) => (
          <div className="adm-card" key={c.label} style={{ animationDelay: `${i * 50}ms` }}>
            <div className="adm-card-label">{c.label}</div>
            <div className="adm-card-row">
              <div className="adm-card-val">{c.value}</div>
              <div className="adm-card-trend">{c.trend}</div>
            </div>
            <Sparkline seed={c.spark + t} w={240} h={42} stroke="rgba(242,242,245,0.5)" />
          </div>
        ))}
      </div>

      <div className="adm-overview-row">
        <div className="adm-panel">
          <div className="adm-panel-head">
            <h3>Tokens / second · last hour</h3>
            <span className="mono small">{s?.tokens_per_sec ?? '—'} tps</span>
          </div>
          <div className="adm-bigchart">
            <BigSparkline seed={`tps-${s?.uptime_sec || 0}`} stroke="rgba(242,242,245,0.85)" />
          </div>
        </div>
        <RecentActivityPanel />
      </div>
    </div>
  );
};

// Replaces the multi-tenant breakdown with a single-node activity feed
// driven by /admin/queue snapshots — what's actually happening on this box.
const RecentActivityPanel = () => {
  const [data, err] = useAdminPoll('/admin/queue', 2500);
  const inflight = data?.inflight || [];
  const recent = (data?.recent || []).slice().reverse();
  const fmtAge = (sec) => sec < 60 ? `${Math.round(sec)}s ago` : `${Math.round(sec / 60)}m ago`;
  return (
    <div className="adm-panel">
      <div className="adm-panel-head">
        <h3>Recent activity</h3>
        <span className="mono small">{data?.in_flight ?? 0} in flight</span>
      </div>
      {err && <div style={{ color: 'oklch(0.78 0.16 25)', fontSize: 12, marginBottom: 8 }}>{err}</div>}
      {inflight.length === 0 && recent.length === 0 && (
        <div style={{ color: 'rgba(242,242,245,0.45)', fontSize: 13 }}>No requests yet — send one from the workspace.</div>
      )}
      <div className="adm-tenants">
        {inflight.map((r) => (
          <div className="adm-tenant" key={`if-${r.trace_id}`}>
            <div className="adm-tenant-name mono small">{r.trace_id.slice(-8)}</div>
            <div className="adm-tenant-bar">
              <div className="adm-tenant-fill"
                style={{ width: `${Math.min(100, (r.elapsed_ms || 0) / 50)}%`,
                         background: 'oklch(0.78 0.13 80 / 0.6)' }} />
            </div>
            <div className="adm-tenant-val mono small">in flight · {r.elapsed_ms}ms</div>
          </div>
        ))}
        {recent.map((r) => (
          <div className="adm-tenant" key={`c-${r.trace_id}-${r.ended_at}`}>
            <div className="adm-tenant-name mono small">{r.trace_id.slice(-8)}</div>
            <div className="adm-tenant-bar">
              <div className="adm-tenant-fill"
                style={{ width: `${Math.min(100, (r.latency_ms || 0) / 50)}%` }} />
            </div>
            <div className="adm-tenant-val mono small">{r.latency_ms}ms · {r.status}</div>
          </div>
        ))}
      </div>
    </div>
  );
};

const BigSparkline = ({ seed, stroke }) => {
  const points = React.useMemo(() => {
    let s = 1;
    for (let i = 0; i < seed.length; i++) s = (s + seed.charCodeAt(i) * 31) % 100000;
    const out = [];
    for (let i = 0; i < 60; i++) {
      s = (s * 9301 + 49297) % 233280;
      out.push(s / 233280);
    }
    return out;
  }, [seed]);
  const w = 800; const h = 180;
  const step = w / (points.length - 1);
  const ys = points.map((p) => h - p * (h - 16) - 8);
  const linePath = points.map((p, i) => `${i === 0 ? 'M' : 'L'} ${i * step} ${ys[i]}`).join(' ');
  const fillPath = `${linePath} L ${w} ${h} L 0 ${h} Z`;
  return (
    <svg viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" className="adm-svg">
      <defs>
        <linearGradient id="bigfill" x1="0" x2="0" y1="0" y2="1">
          <stop offset="0%" stopColor="rgba(242,242,245,0.18)" />
          <stop offset="100%" stopColor="rgba(242,242,245,0)" />
        </linearGradient>
      </defs>
      <path d={fillPath} fill="url(#bigfill)" />
      <path d={linePath} stroke={stroke} strokeWidth="1.4" fill="none" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
};

// --- Users ---------------------------------------------------------

const UsersSection = () => {
  const [data, err] = useAdminPoll('/admin/users', 5000);
  const users = data?.users || [];
  const ageStr = (ts) => {
    if (!ts) return '—';
    const sec = Math.floor(Date.now() / 1000 - ts);
    if (sec < 60) return `${sec}s ago`;
    if (sec < 3600) return `${Math.floor(sec / 60)}m ago`;
    if (sec < 86400) return `${Math.floor(sec / 3600)}h ago`;
    return `${Math.floor(sec / 86400)}d ago`;
  };
  return (
    <div className="adm-section">
      <div className="ws-view-head">
        <h2>Users</h2>
        <p>
          {err
            ? <span style={{ color: 'oklch(0.78 0.16 25)' }}>Could not reach /admin/users: {err}</span>
            : `${users.length} registered account${users.length === 1 ? '' : 's'} on this server.`}
        </p>
      </div>
      {users.length === 0 && !err && (
        <div style={{ padding: '24px', textAlign: 'center', color: 'rgba(242,242,245,0.5)', fontSize: 14, border: '1px solid rgba(255,255,255,0.06)', borderRadius: 14 }}>
          No users registered yet. Register one from the login screen.
        </div>
      )}
      {users.length > 0 && (
        <div className="ws-table">
          <div className="ws-tr head adm-users-row">
            <span>Email</span>
            <span>API key</span>
            <span>Role</span>
            <span>Created</span>
            <span>Last active</span>
          </div>
          {users.map((u) => (
            <div className="ws-tr adm-users-row" key={u.email}>
              <span className="ws-tr-model">
                <strong>{u.email}</strong>
              </span>
              <span className="mono small">{u.api_key_masked}</span>
              <span>
                <span className={`adm-role ${u.role}`}>{u.role}</span>
              </span>
              <span className="mono small" style={{ color: 'rgba(242,242,245,0.5)' }}>{ageStr(u.created_at)}</span>
              <span className="mono small" style={{ color: 'rgba(242,242,245,0.5)' }}>{ageStr(u.last_active)}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

// --- Queue ---------------------------------------------------------

const QueueSection = () => {
  const [data, err] = useAdminPoll('/admin/queue', 1500);
  const inFlight = data?.in_flight ?? 0;
  const recent = data?.recent || [];
  const p50 = data?.latency_p50_ms;
  const p95 = data?.latency_p95_ms;
  // This stack runs a single llama.cpp engine — represent it as one worker
  // whose state reflects whether anything is currently being processed.
  const engineState = inFlight > 0 ? 'busy' : (recent.length > 0 ? 'idle' : 'cold');
  return (
    <div className="adm-section">
      <div className="ws-view-head">
        <h2>Queue</h2>
        <p>
          {err
            ? <span style={{ color: 'oklch(0.78 0.16 25)' }}>Could not reach /admin/queue: {err}</span>
            : 'Request queue and in-flight tracker for the single-node llama.cpp engine.'}
        </p>
      </div>
      <div className="adm-overview-grid three">
        <div className="adm-card">
          <div className="adm-card-label">In flight</div>
          <div className="adm-card-val">{inFlight}</div>
          <Sparkline seed={`if-${data?.completed_total || 0}`} w={220} h={36} />
        </div>
        <div className="adm-card">
          <div className="adm-card-label">Completed (recent)</div>
          <div className="adm-card-val">{recent.length}<small style={{ color: 'rgba(242,242,245,0.4)' }}> / 100</small></div>
          <Sparkline seed={`rc-${recent.length}`} w={220} h={36} />
        </div>
        <div className="adm-card">
          <div className="adm-card-label">Latency · p95</div>
          <div className="adm-card-val">{p95 ?? '—'}<span className="unit">{p95 != null ? 'ms' : ''}</span></div>
          <Sparkline seed={`p95-${p95 || 0}`} w={220} h={36} />
        </div>
      </div>
      <div className="adm-panel" style={{ marginTop: 16 }}>
        <div className="adm-panel-head"><h3>Engine</h3><span className="mono small">single-node</span></div>
        <div className="ws-table no-border">
          <div className="ws-tr head adm-q-row">
            <span>Worker</span>
            <span>Model</span>
            <span>State</span>
            <span>In flight</span>
            <span>Recent p50</span>
          </div>
          <div className="ws-tr adm-q-row">
            <span className="mono">llama-cpp-01</span>
            <span className="mono">mistral-7b</span>
            <span>
              <span className={`adm-state ${engineState}`}>
                <span className={`ws-dot ${engineState === 'busy' ? 'on' : engineState === 'idle' ? 'idle' : 'off'}`} />
                {engineState}
              </span>
            </span>
            <span className="mono">{inFlight}</span>
            <span className="mono">{p50 != null ? `${p50}ms` : '—'}</span>
          </div>
        </div>
      </div>
    </div>
  );
};

// --- Cache ---------------------------------------------------------

const CacheSection = () => {
  const [data, err] = useAdminPoll('/admin/cache/stats', 3000);
  const [msg, setMsg] = React.useState(null);
  const [busy, setBusy] = React.useState(false);

  const flush = async () => {
    if (busy) return;
    setBusy(true);
    setMsg(null);
    try {
      const j = await adminFetch('/admin/cache/flush', { method: 'POST' });
      setMsg(`Cleared ${j.cleared} entries.`);
    } catch (e) {
      setMsg(`Failed: ${e.message}`);
    } finally {
      setBusy(false);
    }
  };

  const fmtBytes = (b) => {
    if (b == null) return '—';
    if (b > 1e9) return `${(b / 1e9).toFixed(2)}<span class="unit">GB</span>`;
    if (b > 1e6) return `${(b / 1e6).toFixed(1)}<span class="unit">MB</span>`;
    if (b > 1e3) return `${(b / 1e3).toFixed(1)}<span class="unit">KB</span>`;
    return `${b}<span class="unit">B</span>`;
  };
  const hitRatePct = data ? Math.round((data.hit_rate ?? 0) * 100) : '—';

  return (
    <div className="adm-section">
      <div className="ws-view-head">
        <h2>Cache</h2>
        <p>
          {err
            ? <span style={{ color: 'oklch(0.78 0.16 25)' }}>Could not reach /admin/cache/stats: {err}</span>
            : 'Semantic cache backed by Redis. Cosine-similarity threshold 0.95, TTL 1h per entry.'}
        </p>
      </div>
      <div className="adm-overview-grid">
        <div className="adm-card">
          <div className="adm-card-label">Entries</div>
          <div className="adm-card-val">{data?.entries ?? '—'}</div>
          <Sparkline seed={`ce-${data?.entries || 0}`} w={240} h={36} />
        </div>
        <div className="adm-card">
          <div className="adm-card-label">Hit rate</div>
          <div className="adm-card-val">{hitRatePct}{data ? <span className="unit">%</span> : null}</div>
          <Sparkline seed={`ch-${data?.hits || 0}`} w={240} h={36} />
        </div>
        <div className="adm-card">
          <div className="adm-card-label">Hits / Misses</div>
          <div className="adm-card-val" style={{ fontSize: 24 }}>
            {data?.hits ?? '—'}<small style={{ color: 'rgba(242,242,245,0.4)' }}> / {data?.misses ?? '—'}</small>
          </div>
          <Sparkline seed={`hm-${data?.misses || 0}`} w={240} h={36} />
        </div>
        <div className="adm-card">
          <div className="adm-card-label">Redis memory</div>
          <div className="adm-card-val" dangerouslySetInnerHTML={{ __html: fmtBytes(data?.memory_bytes) }} />
          <Sparkline seed={`cm-${data?.memory_bytes || 0}`} w={240} h={36} />
        </div>
      </div>
      <div className="adm-cache-actions">
        <button className="ws-set-btn danger" onClick={flush} disabled={busy}>
          {busy ? 'Clearing…' : 'Clear cache'}
        </button>
        {msg && <span style={{ alignSelf: 'center', fontSize: 13, color: 'rgba(242,242,245,0.7)' }}>{msg}</span>}
      </div>
    </div>
  );
};

// --- Logs ----------------------------------------------------------

const LogsSection = () => {
  const [filter, setFilter] = React.useState('all');
  const [data, err] = useAdminPoll(`/admin/logs?filter=${filter}&limit=200`, 2000);
  const logs = data?.logs || [];

  const fmtTs = (epoch) => {
    if (!epoch) return '—';
    const d = new Date(epoch * 1000);
    const hh = String(d.getHours()).padStart(2, '0');
    const mm = String(d.getMinutes()).padStart(2, '0');
    const ss = String(d.getSeconds()).padStart(2, '0');
    const ms = String(d.getMilliseconds()).padStart(3, '0');
    return `${hh}:${mm}:${ss}.${ms}`;
  };

  return (
    <div className="adm-section">
      <div className="adm-logs-head">
        <div>
          <h2>Logs</h2>
          <p>
            {err
              ? <span style={{ color: 'oklch(0.78 0.16 25)' }}>Could not reach /admin/logs: {err}</span>
              : `Most recent ${logs.length} of ${data?.total ?? 0} captured requests · refreshes every 2s`}
          </p>
        </div>
        <div className="ws-segment">
          {['all', '200', 'errors'].map((v) => (
            <button key={v} className={filter === v ? 'on' : ''} onClick={() => setFilter(v)}>{v}</button>
          ))}
        </div>
      </div>
      <div className="adm-logs">
        <div className="adm-log-row head">
          <span>Timestamp</span>
          <span>Status</span>
          <span>Latency</span>
          <span>Model</span>
          <span>Trace</span>
          <span>Event</span>
        </div>
        {logs.length === 0 && !err && (
          <div style={{ padding: '32px 18px', color: 'rgba(242,242,245,0.45)', fontSize: 13, textAlign: 'center' }}>
            No requests captured yet — send a chat from the workspace.
          </div>
        )}
        {logs.map((l, i) => (
          <div className="adm-log-row" key={`${l.trace_id}-${i}`}>
            <span className="mono small">{fmtTs(l.ts)}</span>
            <span>
              <span className={`adm-status-pill s${Math.floor((l.status || 200) / 100)}xx`}>
                {l.status}
              </span>
            </span>
            <span className="mono">{l.latency_ms != null ? `${l.latency_ms}ms` : '—'}</span>
            <span className="mono">{l.model || '—'}</span>
            <span className="mono small" style={{ color: 'rgba(242,242,245,0.45)' }}>{l.trace_id ? l.trace_id.slice(-12) : '—'}</span>
            <span style={{ color: 'rgba(242,242,245,0.65)' }}>{l.message}</span>
          </div>
        ))}
      </div>
    </div>
  );
};

// --- Metrics (admin) -----------------------------------------------

const AdminMetricsSection = () => {
  const [s, err] = useAdminPoll('/admin/metrics/summary', 2000);
  return (
    <div className="adm-section">
      <div className="ws-view-head">
        <h2>Metrics</h2>
        <p>
          {err
            ? <span style={{ color: 'oklch(0.78 0.16 25)' }}>Could not reach /admin/metrics/summary: {err}</span>
            : 'Engine telemetry rolled up from Prometheus counters · refreshes every 2 seconds.'}
        </p>
      </div>
      <div className="adm-overview-grid three">
        <div className="adm-card">
          <div className="adm-card-label">TTFT (mean)</div>
          <div className="adm-card-val">{s?.ttft_mean_ms ?? '—'}<span className="unit">ms</span></div>
          <Sparkline seed={`ttft-${s?.uptime_sec || 0}`} w={240} h={36} />
        </div>
        <div className="adm-card">
          <div className="adm-card-label">Tokens / second</div>
          <div className="adm-card-val">{s?.tokens_per_sec ?? '—'}</div>
          <Sparkline seed={`tps-${s?.tokens_total || 0}`} w={240} h={36} />
        </div>
        <div className="adm-card">
          <div className="adm-card-label">Total tokens</div>
          <div className="adm-card-val">{s?.tokens_total ?? '—'}</div>
          <Sparkline seed={`tok-${s?.tokens_total || 0}`} w={240} h={36} />
        </div>
        <div className="adm-card">
          <div className="adm-card-label">Cache hit rate</div>
          <div className="adm-card-val">{s ? Math.round((s.cache_hit_rate ?? 0) * 100) : '—'}<span className="unit">%</span></div>
          <Sparkline seed={`ch-${s?.cache_hits || 0}`} w={240} h={36} />
        </div>
        <div className="adm-card">
          <div className="adm-card-label">Error rate</div>
          <div className="adm-card-val">{s ? (s.error_rate * 100).toFixed(2) : '—'}<span className="unit">%</span></div>
          <Sparkline seed={`er-${s?.errors || 0}`} w={240} h={36} />
        </div>
        <div className="adm-card">
          <div className="adm-card-label">Process memory</div>
          <div className="adm-card-val">{s?.memory_mb ?? '—'}<span className="unit">MB</span></div>
          <Sparkline seed={`mem-${s?.memory_mb || 0}`} w={240} h={36} />
        </div>
      </div>
      <div className="adm-overview-row" style={{ marginTop: 16 }}>
        <div className="adm-panel">
          <div className="adm-panel-head"><h3>Latency trend</h3><span className="mono small">{s?.ttft_mean_ms ?? '—'}ms mean</span></div>
          <div className="adm-bigchart"><BigSparkline seed={`lat-${s?.uptime_sec || 0}`} stroke="rgba(242,242,245,0.85)" /></div>
        </div>
        <div className="adm-panel">
          <div className="adm-panel-head"><h3>Throughput trend</h3><span className="mono small">{s?.tokens_per_sec ?? '—'} tps</span></div>
          <div className="adm-bigchart"><BigSparkline seed={`tps-${s?.tokens_total || 0}`} stroke="oklch(0.72 0.16 248)" /></div>
        </div>
      </div>
    </div>
  );
};

// --- Models (admin) ------------------------------------------------

const AdminModelsSection = () => (
  <div className="adm-section">
    <div className="ws-view-head">
      <h2>Models</h2>
      <p>Checkpoints registered with the model store.</p>
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
      {MODELS.map((m) => (
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
  </div>
);

// --- Settings ------------------------------------------------------

const AdminSettings = () => {
  const [audit, setAudit] = React.useState(true);
  const [retention, setRetention] = React.useState(30);
  return (
    <div className="adm-section">
      <div className="ws-view-head">
        <h2>Settings</h2>
        <p>Cluster-level defaults.</p>
      </div>
      <div className="ws-settings">
        <div className="ws-set-row">
          <div className="ws-set-meta">
            <div className="ws-set-label">Audit log</div>
            <div className="ws-set-desc">Persist every authenticated request and response trailer.</div>
          </div>
          <button className={`ws-toggle ${audit ? 'on' : ''}`} onClick={() => setAudit((v) => !v)}>
            <span className="ws-toggle-knob" />
          </button>
        </div>
        <div className="ws-set-row">
          <div className="ws-set-meta">
            <div className="ws-set-label">Log retention</div>
            <div className="ws-set-desc">Days of telemetry kept before rotation.</div>
          </div>
          <div className="ws-range">
            <input type="range" min="7" max="365" step="1" value={retention} onChange={(e) => setRetention(parseInt(e.target.value))} />
            <span className="mono small">{retention} days</span>
          </div>
        </div>
        <div className="ws-set-row">
          <div className="ws-set-meta">
            <div className="ws-set-label">Reload cluster config</div>
            <div className="ws-set-desc">Apply pending changes to all workers without restart.</div>
          </div>
          <button className="ws-set-btn">Reload</button>
        </div>
      </div>
    </div>
  );
};

// --- Composer ------------------------------------------------------

const AdminWorkspace = ({ onSignOut, leaving }) => {
  const [active, setActive] = React.useState('overview');
  return (
    <div className={`workspace admin ${leaving ? 'leaving' : ''}`}>
      <AdminTopBar active={active} setActive={setActive} onSignOut={onSignOut} />
      <main className="adm-main">
        {active === 'overview' && <OverviewSection />}
        {active === 'users' && <UsersSection />}
        {active === 'metrics' && <AdminMetricsSection />}
        {active === 'queue' && <QueueSection />}
        {active === 'cache' && <CacheSection />}
        {active === 'logs' && <LogsSection />}
        {active === 'models' && <AdminModelsSection />}
        {active === 'settings' && <AdminSettings />}
      </main>
    </div>
  );
};

Object.assign(window, { AdminWorkspace });
