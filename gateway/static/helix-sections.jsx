// LLM Inference Server — sections (Hero, Values, Architecture, Metrics)

const Nav = ({ dark, scrolled, onSignIn }) =>
<nav className={`nav ${scrolled ? 'scrolled' : ''} ${dark ? 'dark' : ''}`}>
    <div className="container nav-inner">
      <div className="brand">
        <span className="brand-mark"><BrandMark dark={dark} /></span>
        <span>LLM Inference Server</span>
      </div>
      {!dark && <a className="nav-cta" href="#auth" onClick={(e) => {e.preventDefault();onSignIn?.();}}>
        Sign in <Icon.Arrow size={12} />
      </a>}
      {dark && <a className="nav-cta" href="#top">
        Back to top <Icon.Arrow size={12} />
      </a>}
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
        Streaming responses, semantic caching, rate limiting, and full Prometheus observability,
        running entirely on your own machine.
      </p>
    </div>
  </section>;


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
  desc: 'Open-source C++ inference server compiled from source. Loads quantized GGUF weights into RAM. Streams tokens via SSE. Three engines run in parallel — Mistral, Phi, and Llama — each in its own container.',
  specs: [['Backend', 'llama.cpp · CPU'], ['Decoding', 'streaming · SSE'], ['Quant', 'INT4 · Q4_K_M']] },
{ id: 'model', label: 'Models', sub: 'GGUF · host mount', icon: <Icon.Network />,
  title: 'Multi-model fleet',
  desc: 'Three open-weight models — Mistral 7B, Phi-3.5 Mini, Llama 3.2 3B — all quantized to INT4 (Q4_K_M). Mounted read-only from the host. Switch instantly from the chat UI; each request routes to its own backend.',
  specs: [['Format', 'GGUF · Q4_K_M'], ['Total', '~8 GB · INT4'], ['Mount', 'host → /models:ro']] },
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
          <span className="eyebrow">Architecture</span>
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

Object.assign(window, { Nav, Hero, Architecture });