// LLM Inference Server — Admin Workspace
// Operator dashboard with tabs across the top. Most sections still use
// generated demo data — Phase 2 wires real endpoints (users registry,
// queue tracker, log capture).

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
  const t = useTicker(1300);
  const drift = (base, amp) => base + Math.round(Math.sin(t * 0.4 + amp) * amp);
  const cards = [
    { label: 'Requests / min', value: drift(1280, 80), trend: '+4.2%', spark: 'rpm' },
    { label: 'Active users',   value: drift(184, 12),  trend: '+2',    spark: 'au' },
    { label: 'Cache hit rate', value: `${drift(74, 4)}%`, trend: '+1.1pt', spark: 'cache' },
    { label: 'Tokens / second',value: drift(620, 40), trend: '+6.8%', spark: 'tps' },
    { label: 'Queue depth',    value: Math.max(0, drift(4, 4)),  trend: 'stable', spark: 'q' },
    { label: 'Error rate',     value: '0.04%', trend: '-0.01pt', spark: 'err' },
  ];
  return (
    <div className="adm-section">
      <div className="ws-view-head">
        <h2>Overview</h2>
        <p>Cluster-wide signal · refreshing every 10 seconds.</p>
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
            <span className="mono small">{drift(620, 40)} tps</span>
          </div>
          <div className="adm-bigchart">
            <BigSparkline seed={`tps-${t}`} stroke="rgba(242,242,245,0.85)" />
          </div>
        </div>
        <div className="adm-panel">
          <div className="adm-panel-head">
            <h3>Top tenants</h3>
            <span className="mono small">by tok/min</span>
          </div>
          <div className="adm-tenants">
            {[
              { name: 'acme-prod',    pct: 0.34, t: 8420 },
              { name: 'globex-eu',    pct: 0.22, t: 5448 },
              { name: 'initech-app',  pct: 0.16, t: 3963 },
              { name: 'umbrella-dev', pct: 0.11, t: 2724 },
              { name: 'soylent-batch',pct: 0.07, t: 1734 },
              { name: 'others',       pct: 0.10, t: 2477 },
            ].map((row) => (
              <div className="adm-tenant" key={row.name}>
                <div className="adm-tenant-name">{row.name}</div>
                <div className="adm-tenant-bar">
                  <div className="adm-tenant-fill" style={{ width: `${row.pct * 100}%` }} />
                </div>
                <div className="adm-tenant-val mono small">{fmtNum(row.t)}</div>
              </div>
            ))}
          </div>
        </div>
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

const USERS = [
  { name: 'Ada Lovelace',   email: 'ada@acme.com',    role: 'Admin',     keys: 4, last: 'now',     tenant: 'acme-prod' },
  { name: 'Grace Hopper',   email: 'grace@globex.io', role: 'Developer', keys: 2, last: '2m',      tenant: 'globex-eu' },
  { name: 'Linus Torvalds', email: 'linus@initech.app',role: 'Developer',keys: 3, last: '14m',     tenant: 'initech-app' },
  { name: 'Margaret Hamilton', email: 'mh@umbrella.dev', role: 'Operator', keys: 1, last: '1h',  tenant: 'umbrella-dev' },
  { name: 'Donald Knuth',   email: 'dk@soylent.dev',   role: 'Developer', keys: 2, last: '3h',     tenant: 'soylent-batch' },
  { name: 'Barbara Liskov', email: 'bl@research.com',  role: 'Read-only', keys: 0, last: 'Yesterday', tenant: 'research-ro' },
];

const UsersSection = () => (
  <div className="adm-section">
    <div className="ws-view-head">
      <h2>Users</h2>
      <p>{USERS.length} accounts across 6 tenants.</p>
    </div>
    <div className="ws-table">
      <div className="ws-tr head adm-users-row">
        <span>Name</span>
        <span>Tenant</span>
        <span>Role</span>
        <span>API keys</span>
        <span>Last active</span>
      </div>
      {USERS.map((u) => (
        <div className="ws-tr adm-users-row" key={u.email}>
          <span className="ws-tr-model">
            <strong>{u.name}</strong>
            <small className="mono">{u.email}</small>
          </span>
          <span className="mono">{u.tenant}</span>
          <span>
            <span className={`adm-role ${u.role.toLowerCase().replace(/[^a-z]/g, '')}`}>{u.role}</span>
          </span>
          <span className="mono">{u.keys}</span>
          <span className="mono small" style={{ color: 'rgba(242,242,245,0.5)' }}>{u.last}</span>
        </div>
      ))}
    </div>
  </div>
);

// --- Queue ---------------------------------------------------------

const QueueSection = () => {
  const t = useTicker(900);
  const workers = [
    { id: 'w-01', model: 'llama-3.1-70b', state: 'busy',  reqs: 14, util: 0.92 },
    { id: 'w-02', model: 'llama-3.1-70b', state: 'busy',  reqs: 12, util: 0.88 },
    { id: 'w-03', model: 'mistral-7b',    state: 'busy',  reqs: 22, util: 0.74 },
    { id: 'w-04', model: 'phi-3.5-mini',  state: 'idle',  reqs: 0,  util: 0.04 },
    { id: 'w-05', model: 'qwen-2.5-32b',  state: 'cold',  reqs: 0,  util: 0 },
  ];
  const waiting = Math.max(0, 4 + Math.round(Math.sin(t * 0.7) * 3));
  return (
    <div className="adm-section">
      <div className="ws-view-head">
        <h2>Queue</h2>
        <p>Priority queue across the inference fleet.</p>
      </div>
      <div className="adm-overview-grid three">
        <div className="adm-card">
          <div className="adm-card-label">Queue depth</div>
          <div className="adm-card-val">{waiting}</div>
          <Sparkline seed={`qd-${t}`} w={220} h={36} />
        </div>
        <div className="adm-card">
          <div className="adm-card-label">Active workers</div>
          <div className="adm-card-val">{workers.filter((w) => w.state === 'busy').length}<small style={{ color: 'rgba(242,242,245,0.4)' }}> / {workers.length}</small></div>
          <Sparkline seed={`aw-${t}`} w={220} h={36} />
        </div>
        <div className="adm-card">
          <div className="adm-card-label">Waiting · p95</div>
          <div className="adm-card-val">142<span className="unit">ms</span></div>
          <Sparkline seed={`wp-${t}`} w={220} h={36} />
        </div>
      </div>
      <div className="adm-panel" style={{ marginTop: 16 }}>
        <div className="adm-panel-head"><h3>Workers</h3><span className="mono small">fleet</span></div>
        <div className="ws-table no-border">
          <div className="ws-tr head adm-q-row">
            <span>Worker</span>
            <span>Model</span>
            <span>State</span>
            <span>In flight</span>
            <span>Utilization</span>
          </div>
          {workers.map((w) => (
            <div className="ws-tr adm-q-row" key={w.id}>
              <span className="mono">{w.id}</span>
              <span className="mono">{w.model}</span>
              <span>
                <span className={`adm-state ${w.state}`}>
                  <span className={`ws-dot ${w.state === 'busy' ? 'on' : w.state === 'idle' ? 'idle' : 'off'}`} />
                  {w.state}
                </span>
              </span>
              <span className="mono">{w.reqs}</span>
              <span>
                <div className="adm-util">
                  <div className="adm-util-fill" style={{ width: `${w.util * 100}%` }} />
                </div>
              </span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};

// --- Cache ---------------------------------------------------------

const CacheSection = () => {
  const t = useTicker(1500);
  return (
    <div className="adm-section">
      <div className="ws-view-head">
        <h2>Cache</h2>
        <p>Semantic + idempotency cache across the gateway.</p>
      </div>
      <div className="adm-overview-grid">
        <div className="adm-card">
          <div className="adm-card-label">Entries</div>
          <div className="adm-card-val">28,402</div>
          <Sparkline seed={`ce-${t}`} w={240} h={36} />
        </div>
        <div className="adm-card">
          <div className="adm-card-label">Hit rate</div>
          <div className="adm-card-val">{74 + Math.round(Math.sin(t * 0.4) * 3)}<span className="unit">%</span></div>
          <Sparkline seed={`ch-${t}`} w={240} h={36} />
        </div>
        <div className="adm-card">
          <div className="adm-card-label">TTL · avg</div>
          <div className="adm-card-val">14<span className="unit">min</span></div>
          <Sparkline seed={`ct-${t}`} w={240} h={36} />
        </div>
        <div className="adm-card">
          <div className="adm-card-label">Memory</div>
          <div className="adm-card-val">3.84<span className="unit">GB</span></div>
          <Sparkline seed={`cm-${t}`} w={240} h={36} />
        </div>
      </div>
      <div className="adm-cache-actions">
        <button className="ws-set-btn">Flush expired</button>
        <button className="ws-set-btn danger">Clear cache</button>
      </div>
    </div>
  );
};

// --- Logs ----------------------------------------------------------

const LOG_LINES = [
  { ts: '14:22:01.412', latency: 218, model: 'llama-3.1-70b', trace: '7a4f3d12c08b', status: 200, msg: 'chat.completions · stream' },
  { ts: '14:22:00.984', latency: 142, model: 'mistral-7b',    trace: 'b8e2cc1849aa', status: 200, msg: 'chat.completions · stream' },
  { ts: '14:21:59.221', latency: 312, model: 'llama-3.1-70b', trace: '90c3a721d7e0', status: 200, msg: 'embeddings' },
  { ts: '14:21:58.802', latency: 196, model: 'phi-3.5-mini',  trace: '11ddee4f0c1a', status: 200, msg: 'chat.completions' },
  { ts: '14:21:58.116', latency: 1240, model: 'llama-3.1-70b', trace: '2afe5b39a012', status: 408, msg: 'timeout · client cancelled' },
  { ts: '14:21:57.660', latency: 78, model: 'mistral-7b',    trace: 'cc7a921b15dd', status: 200, msg: 'chat.completions · cache hit' },
  { ts: '14:21:57.013', latency: 174, model: 'llama-3.1-70b', trace: '4b1ccaf09810', status: 200, msg: 'chat.completions · stream' },
  { ts: '14:21:56.488', latency: 0,   model: '—',             trace: '—',           status: 401, msg: 'auth · invalid bearer' },
  { ts: '14:21:55.901', latency: 207, model: 'llama-3.1-70b', trace: 'a1fe3c8855bb', status: 200, msg: 'chat.completions · stream' },
  { ts: '14:21:55.220', latency: 161, model: 'phi-3.5-mini',  trace: '6e10d9a72c44', status: 200, msg: 'chat.completions' },
  { ts: '14:21:54.770', latency: 184, model: 'mistral-7b',    trace: 'fa39db8011c3', status: 200, msg: 'embeddings · batch=8' },
  { ts: '14:21:54.211', latency: 246, model: 'llama-3.1-70b', trace: '38aacc12bb19', status: 200, msg: 'chat.completions · stream' },
];

const LogsSection = () => {
  const [filter, setFilter] = React.useState('all');
  const filtered = LOG_LINES.filter((l) => {
    if (filter === 'all') return true;
    if (filter === 'errors') return l.status >= 400;
    if (filter === '200') return l.status === 200;
    return true;
  });
  return (
    <div className="adm-section">
      <div className="adm-logs-head">
        <div>
          <h2>Logs</h2>
          <p>Live tail · stream paused</p>
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
        {filtered.map((l, i) => (
          <div className="adm-log-row" key={i}>
            <span className="mono small">{l.ts}</span>
            <span>
              <span className={`adm-status-pill s${Math.floor(l.status / 100)}xx`}>
                {l.status}
              </span>
            </span>
            <span className="mono">{l.latency ? `${l.latency}ms` : '—'}</span>
            <span className="mono">{l.model}</span>
            <span className="mono small" style={{ color: 'rgba(242,242,245,0.45)' }}>{l.trace}</span>
            <span style={{ color: 'rgba(242,242,245,0.65)' }}>{l.msg}</span>
          </div>
        ))}
      </div>
    </div>
  );
};

// --- Metrics (admin) -----------------------------------------------

const AdminMetricsSection = () => {
  const t = useTicker(1500);
  return (
    <div className="adm-section">
      <div className="ws-view-head">
        <h2>Metrics</h2>
        <p>Engine telemetry · last hour.</p>
      </div>
      <div className="adm-overview-row">
        <div className="adm-panel">
          <div className="adm-panel-head"><h3>Latency · p50 / p95 / p99</h3><span className="mono small">ms</span></div>
          <div className="adm-bigchart"><BigSparkline seed={`lat-${t}`} stroke="rgba(242,242,245,0.85)" /></div>
        </div>
        <div className="adm-panel">
          <div className="adm-panel-head"><h3>GPU utilization</h3><span className="mono small">67%</span></div>
          <div className="adm-bigchart"><BigSparkline seed={`gpu-${t}`} stroke="oklch(0.72 0.16 248)" /></div>
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
