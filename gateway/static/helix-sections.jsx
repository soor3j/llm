// LLM Inference Server — sections (Hero, Values, Architecture, Metrics)

const Nav = ({ dark, scrolled, onSignIn }) =>
<nav className={`nav ${scrolled ? 'scrolled' : ''} ${dark ? 'dark' : ''}`}>
    <div className="container nav-inner">
      <a href="#top" className="brand">
        <span className="brand-mark"><BrandMark dark={dark} /></span>
        <span>Inference</span>
        <span className="mono" style={{ fontSize: 11, color: 'var(--muted-2)', marginLeft: 6, letterSpacing: '0.08em' }}>/ LOCAL</span>
      </a>
      <div className="nav-links">
        <a className="nav-link" href="#product">Product</a>
        <a className="nav-link" href="#architecture">Architecture</a>
      </div>
      <a className="nav-cta" href="#auth" onClick={(e) => {e.preventDefault();onSignIn?.();}}>
        Sign in <Icon.Arrow size={12} />
      </a>
    </div>
  </nav>;


const Hero = () =>
<section className="hero" id="top">
    <div className="hero-bg">
      <div className="mesh">
        <div className="blob b1" />
        <div className="blob b2" />
        <div className="blob b3" />
      </div>
      <div className="grid-overlay" />
    </div>
    <div className="container hero-content">
      <h1 className="h-hero">
        <span className="line"><span>Private AI infrastructure.</span></span>
        <span className="line"><span><em>Run intelligence. Keep your data.</em></span></span>
      </h1>
      <p className="hero-sub">
        A self-hosted, OpenAI-compatible inference server built on llama.cpp and Mistral 7B.
        Streaming responses, semantic caching, rate limiting, and full Prometheus observability —
        running entirely on your own machine.
      </p>
      <div className="hero-ctas">
        <a className="btn btn-primary" href="#auth">Get started <span className="btn-arrow"><Icon.Arrow /></span></a>
        <a className="btn btn-outline" href="#architecture">View architecture</a>
      </div>
      <div className="hero-meta">
        <div className="item"><span className="key">$</span><span>docker compose up</span></div>
        <div className="item"><span className="key">↳</span><span>Mistral 7B · INT4 · CPU</span></div>
        <div className="item"><span className="key">●</span><span>100% local · no telemetry · MIT</span></div>
      </div>
    </div>
  </section>;


const ValueViz = ({ kind }) => {
  if (kind === 'lock') {
    return (
      <div className="viz viz-lock">
        {[40, 70, 90, 60, 80, 50, 95, 65, 75, 55].map((h, i) =>
        <div key={i} className={`pill ${i === 3 ? 'active' : ''}`} style={{ height: `${h}%` }} />
        )}
      </div>);

  }
  if (kind === 'code') {
    return (
      <div className="viz viz-code">
        <div className="l"><span className="k">POST</span> /v1/chat/completions</div>
        <div className="l">{'{'}</div>
        <div className="l">&nbsp;&nbsp;"model": <span className="s">"helix-llama-70b"</span>,</div>
        <div className="l">&nbsp;&nbsp;"stream": <span className="s">true</span></div>
        <div className="l">{'}'}</div>
      </div>);

  }
  if (kind === 'bars') {
    return (
      <div className="viz viz-bars">
        {[28, 45, 35, 62, 48, 70, 55, 82, 60, 75, 90, 68, 55, 78, 95, 65, 50, 72].map((h, i) =>
        <div key={i} className="b" style={{ height: `${h}%`, animationDelay: `${i * 0.08}s` }} />
        )}
      </div>);

  }
  if (kind === 'stream') {
    return (
      <div className="viz viz-stream">
        <div className="row" />
        <div className="row" />
        <div className="row" />
      </div>);

  }
  return null;
};

const ValueCards = () => {
  const cards = [
  { num: '01', viz: 'lock', title: 'Private by default',
    body: 'Everything runs on your machine. Prompts never leave the host — no API calls, no telemetry, no third-party services in the data path.' },
  { num: '02', viz: 'code', title: 'OpenAI-compatible API',
    body: 'A drop-in /v1/chat/completions endpoint. Swap the base URL and your existing OpenAI SDKs, tools, and agents work unchanged.' },
  { num: '03', viz: 'bars', title: 'Full observability',
    body: 'Prometheus metrics for every request — TTFT, tokens/sec, cache hit rate, error rate. Auto-provisioned Grafana dashboard at port 3000.' },
  { num: '04', viz: 'stream', title: 'Semantic caching',
    body: 'Cosine-similarity cache over sentence embeddings. Paraphrased questions return instantly without re-running the model. 20–60× speedup on cache hits.' }];


  const [ref, shown] = useReveal({ threshold: 0.1 });
  return (
    <section className="section-pad" id="product" ref={ref}>
      <div className="container">
        <div className="section-head">
          <span className="eyebrow">02 — Capabilities</span>
          <h2 className="h-section">Everything you need to ship.<br />
            <span style={{ color: 'var(--muted)' }}>Nothing you don't.</span>
          </h2>
          <p className="h-sub" style={{ marginTop: 8 }}>
            A focused surface area for serving LLMs in production — without the operational drag of stitching it together yourself.
          </p>
        </div>
        <div className="values">
          {cards.map((c, i) =>
          <article
            key={c.num}
            className={`value-card ${shown ? 'in' : ''}`}
            style={{ animationDelay: `${i * 120}ms` }}>
            
              <span className="num">{c.num}</span>
              <ValueViz kind={c.viz} />
              <div>
                <h3>{c.title}</h3>
                <p>{c.body}</p>
              </div>
            </article>
          )}
        </div>
      </div>
    </section>);

};

const ARCH_NODES = [
{ id: 'client', label: 'Client', sub: 'SDK · curl · any HTTP', icon: <Icon.User />,
  title: 'OpenAI-compatible client',
  desc: 'Use the OpenAI Python or TypeScript SDK — just point base_url at http://localhost:8000/v1. Or hit /v1/chat/completions with curl. The wire format is identical.',
  specs: [['Protocol', 'HTTP · SSE'], ['Auth', 'Bearer token'], ['SDKs', 'OpenAI py · ts']] },
{ id: 'gateway', label: 'FastAPI Gateway', sub: 'Async · port 8000', icon: <Icon.Globe />,
  title: 'FastAPI gateway',
  desc: 'Async FastAPI front-door. Bearer-token auth with constant-time comparison. Sliding-window rate limiting in Redis. Routes to llama.cpp on a cache miss.',
  specs: [['Auth', 'secrets.compare_digest'], ['Rate limit', 'sliding window · Redis'], ['Cache', 'semantic · cosine']] },
{ id: 'cache', label: 'Semantic Cache', sub: 'Redis · embeddings', icon: <Icon.Queue />,
  title: 'Semantic cache',
  desc: 'Sentence-transformer embeddings (all-MiniLM-L6-v2, 384-dim) indexed in Redis. Cosine similarity ≥ 0.95 returns the cached response — paraphrases hit, unrelated prompts miss.',
  specs: [['Embedding', 'all-MiniLM-L6-v2'], ['Threshold', 'cosine ≥ 0.95'], ['Store', 'Redis · TTL 1h']] },
{ id: 'engine', label: 'llama.cpp engine', sub: 'CPU · port 8001', icon: <Icon.Chip />,
  title: 'llama.cpp engine',
  desc: 'Open-source C++ inference server compiled from source. Loads quantized GGUF weights into RAM. Streams tokens via SSE. Phase 2 swaps in vLLM for GPU throughput.',
  specs: [['Backend', 'llama.cpp · CPU'], ['Decoding', 'streaming · SSE'], ['Quant', 'INT4 · Q4_K_M']] },
{ id: 'model', label: 'Model', sub: 'GGUF · host mount', icon: <Icon.Network />,
  title: 'Mistral 7B Instruct',
  desc: '7-billion-parameter open model, quantized to INT4 with Q4_K_M. 4.1 GB on disk; ~5 GB resident. Mounted read-only from the host so image stays small and swappable.',
  specs: [['Format', 'GGUF · Q4_K_M'], ['Size', '4.1 GB · INT4'], ['Mount', 'host → /models:ro']] },
{ id: 'response', label: 'Observability', sub: 'Prometheus · Grafana', icon: <Icon.Pulse />,
  title: 'Metrics + dashboards',
  desc: 'Nine Prometheus metrics — TTFT histograms, tokens/sec, cache hits/misses, errors by type. Auto-provisioned Grafana dashboard with 6 live panels.',
  specs: [['Metrics', 'Prometheus · /metrics'], ['Dashboard', 'Grafana · port 3000'], ['Retention', '7 days']] }];


const Architecture = () => {
  const [active, setActive] = React.useState(3);
  const [ref, shown] = useReveal({ threshold: 0.12 });
  const node = ARCH_NODES[active];
  return (
    <section className="section-pad" id="architecture" ref={ref} style={{ background: 'var(--bg)' }}>
      <div className="container">
        <div className="section-head">
          <span className="eyebrow">03 — Architecture</span>
          <h2 className={`h-section reveal ${shown ? 'in' : ''}`}>
            A clear path from request to token.
          </h2>
          <p className={`h-sub reveal ${shown ? 'in' : ''}`} style={{ marginTop: 8, transitionDelay: '80ms' }}>
            Every layer is observable, replaceable, and tuned for the hardware you actually have.
          </p>
        </div>
        <div className="arch-wrap">
          <div className="arch-grid">
            <div className="arch-stack">
              {ARCH_NODES.map((n, i) =>
              <div
                key={n.id}
                className={`arch-node ${active === i ? 'active' : ''}`}
                onMouseEnter={() => setActive(i)}
                onClick={() => setActive(i)}>
                
                  <span className="idx">0{i + 1}</span>
                  <span className="icon">{n.icon}</span>
                  <div className="meta">
                    <div className="label">{n.label}</div>
                    <div className="sub">{n.sub}</div>
                  </div>
                  <Icon.Arrow size={12} />
                </div>
              )}
            </div>
            <div className="arch-detail" key={node.id}
            style={{ animation: 'fadeUp 480ms var(--ease-out)' }}>
              <span className="tag">Layer · 0{active + 1}</span>
              <h4>{node.title}</h4>
              <p className="desc">{node.desc}</p>
              <div className="specs">
                {node.specs.map(([k, v]) =>
                <div className="row" key={k}>
                    <span className="k">{k}</span>
                    <span className="v">{v}</span>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>);

};

Object.assign(window, { Nav, Hero, ValueCards, Architecture });