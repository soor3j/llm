// LLM Inference Server — Scroll-emerged login experience
// As the user scrolls past the architecture section, a fixed overlay
// progressively darkens and blurs the page behind it while a single
// login panel materializes (opacity 0→1, translateY 80→0, scale 0.97→1,
// blur 10→0). The login feels like it emerges FROM the page — not as a
// modal, popup, or new route.

const clamp = (v, lo = 0, hi = 1) => Math.max(lo, Math.min(hi, v));
// Smooth ease-out for scroll-driven interpolation
const easeOut = (t) => 1 - Math.pow(1 - t, 3);

function useScrollProgress(ref) {
  const [p, setP] = React.useState(0);
  React.useEffect(() => {
    const calc = () => {
      const el = ref.current;
      if (!el) return;
      const r = el.getBoundingClientRect();
      const total = Math.max(1, el.offsetHeight - window.innerHeight);
      const passed = -r.top;
      setP(clamp(passed / total));
    };
    calc();
    window.addEventListener('scroll', calc, { passive: true });
    window.addEventListener('resize', calc);
    return () => {
      window.removeEventListener('scroll', calc);
      window.removeEventListener('resize', calc);
    };
  }, [ref]);
  return p;
}

const LoginPanel = ({ progress, onAuth }) => {
  // progress 0..1 over the whole emerge zone, but the panel reveals
  // during the first ~70% (locks in place after).
  const reveal = easeOut(clamp(progress / 0.7));
  const opacity = reveal;
  const y = (1 - reveal) * 80;
  const scale = 0.97 + 0.03 * reveal;
  const blur = (1 - reveal) * 10;

  const [mode, setMode] = React.useState('user'); // 'user' | 'admin'
  const isAdmin = mode === 'admin';
  const idRef = React.useRef(null);
  const pwRef = React.useRef(null);

  // Cosmetic login: store the typed password as the Bearer token.
  // Backend expects a static API_KEY env var, so whatever the user types
  // becomes the Authorization: Bearer <token> for subsequent requests.
  const handleSubmit = (e) => {
    e?.preventDefault?.();
    const key = pwRef.current?.value || '';
    try {
      if (isAdmin) localStorage.setItem('adminApiKey', key);
      else         localStorage.setItem('apiKey', key);
    } catch {}
    onAuth?.(mode);
  };

  return (
    <div
      className={`login-panel ${isAdmin ? 'admin' : ''}`}
      style={{
        opacity,
        transform: `translate3d(0, ${y}px, 0) scale(${scale})`,
        filter: `blur(${blur}px)`,
        pointerEvents: reveal > 0.9 ? 'auto' : 'none',
      }}
      aria-hidden={reveal < 0.5}
    >
      <div className="login-headline" style={{ opacity: easeOut(clamp((progress - 0.05) / 0.4)) }}>
        Access
      </div>

      <div className="login-card">
        <div className="login-toggle" role="tablist" aria-label="Account type">
          <span
            className="login-toggle-thumb"
            style={{ transform: isAdmin ? 'translateX(100%)' : 'translateX(0)' }}
          />
          <button
            role="tab"
            aria-selected={!isAdmin}
            className={`login-toggle-btn ${!isAdmin ? 'on' : ''}`}
            onClick={() => setMode('user')}
          >
            User
          </button>
          <button
            role="tab"
            aria-selected={isAdmin}
            className={`login-toggle-btn ${isAdmin ? 'on' : ''}`}
            onClick={() => setMode('admin')}
          >
            Admin
          </button>
        </div>

        <p className="login-desc">
          {isAdmin
            ? 'Paste your ADMIN_API_KEY (or API_KEY if unset)'
            : 'Paste your API_KEY value to authenticate'}
        </p>

        <form className="login-form" onSubmit={handleSubmit}>
          <div className="login-field">
            <input
              ref={idRef}
              key={isAdmin ? 'admin-id' : 'email'}
              type={isAdmin ? 'text' : 'email'}
              placeholder={isAdmin ? 'Admin ID' : 'Email'}
              autoComplete={isAdmin ? 'username' : 'email'}
            />
          </div>
          <div className="login-field">
            <input
              ref={pwRef}
              type="password"
              placeholder={isAdmin ? 'ADMIN_API_KEY from .env' : 'API_KEY from .env'}
              autoComplete="current-password"
            />
          </div>

          {isAdmin ? (
            <button type="submit" className="login-submit primary">
              Admin Login
            </button>
          ) : (
            <div className="login-actions">
              <button type="submit" className="login-submit primary">Login</button>
              <button type="button" className="login-submit ghost" onClick={handleSubmit}>Register</button>
            </div>
          )}
        </form>
      </div>
    </div>
  );
};

const ScrollLogin = ({ onProgressChange, onAuth }) => {
  const zoneRef = React.useRef(null);
  const progress = useScrollProgress(zoneRef);

  React.useEffect(() => {
    onProgressChange?.(progress);
  }, [progress, onProgressChange]);

  // Overlay reveals over the first portion, locks in for the rest
  const overlayP = easeOut(clamp(progress / 0.7));

  return (
    <div ref={zoneRef} className="emerge-zone" aria-label="Continue">
      <div
        className="emerge-overlay"
        style={{
          opacity: progress > 0.01 ? 1 : 0,
          background: `rgba(7, 7, 10, ${0.92 * overlayP})`,
          backdropFilter: `blur(${overlayP * 16}px) saturate(${1 - 0.25 * overlayP})`,
          WebkitBackdropFilter: `blur(${overlayP * 16}px)`,
          pointerEvents: overlayP > 0.4 ? 'auto' : 'none',
        }}
      >
        {/* faint depth grid that appears as the overlay deepens */}
        <div
          className="emerge-grid"
          style={{ opacity: overlayP * 0.5 }}
        />
        {/* subtle accent horizon */}
        <div
          className="emerge-horizon"
          style={{ opacity: overlayP }}
        />
        <LoginPanel progress={progress} onAuth={onAuth} />
      </div>
    </div>
  );
};

const MinimalFooter = () => (
  <footer className="minimal-footer">
    <div className="container minimal-footer-inner">
      <a href="#">GitHub</a>
      <span className="dot-sep" aria-hidden="true">·</span>
      <a href="#">Docs</a>
      <span className="dot-sep" aria-hidden="true">·</span>
      <a href="#">API Reference</a>
    </div>
  </footer>
);

Object.assign(window, { ScrollLogin, LoginPanel, MinimalFooter });
