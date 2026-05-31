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
  const [errorMsg, setErrorMsg] = React.useState(null);
  const [busy, setBusy] = React.useState(false);
  const idRef = React.useRef(null);
  const pwRef = React.useRef(null);
  const [showPw, setShowPw] = React.useState(false);

  // Submission flow:
  //   Admin tab  → cosmetic: store typed password as adminApiKey.
  //   User tab + Login    → POST /v1/auth/login. On 200 store returned api_key.
  //                         On 401/registry-unavailable fall back to cosmetic
  //                         (the user might have typed the raw API_KEY value).
  //   User tab + Register → POST /v1/auth/register. On 201 store returned key.
  //                         On error surface a clear message.
  const apiPost = async (path, body) => {
    const res = await fetch(`${window.location.origin}/v1${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    let payload = null;
    try { payload = await res.json(); } catch {}
    return { ok: res.ok, status: res.status, payload };
  };

  const cosmeticStore = (token) => {
    try {
      if (isAdmin) localStorage.setItem('adminApiKey', token);
      else         localStorage.setItem('apiKey', token);
    } catch {}
  };

  const handleSubmit = async (action = 'login', e) => {
    e?.preventDefault?.();
    setErrorMsg(null);
    if (busy) return;

    const id = idRef.current?.value?.trim() || '';
    const pw = pwRef.current?.value || '';
    if (!pw) { setErrorMsg('Password is required'); return; }

    // Admin tab — cosmetic flow only (no admin registration UX).
    if (isAdmin) {
      cosmeticStore(pw);
      onAuth?.('admin');
      return;
    }

    setBusy(true);
    try {
      if (action === 'register') {
        if (!id) { setErrorMsg('Email is required'); return; }
        const { ok, status, payload } = await apiPost('/auth/register', { email: id, password: pw });
        if (ok) {
          cosmeticStore(payload.api_key);
          try { localStorage.setItem('userEmail', payload.email); } catch {}
          onAuth?.('user');
          return;
        }
        if (status === 409) { setErrorMsg('Email already registered — try Login.'); return; }
        if (status === 503) { setErrorMsg('Registry unavailable (Redis down). Login with API_KEY directly.'); return; }
        setErrorMsg(payload?.detail?.message || `Register failed (${status})`);
        return;
      }

      // action === 'login'
      const { ok, status, payload } = await apiPost('/auth/login', { email: id || 'unknown@local', password: pw });
      if (ok) {
        cosmeticStore(payload.api_key);
        try { localStorage.setItem('userEmail', payload.email); } catch {}
        onAuth?.('user');
        return;
      }
      // Fall back to cosmetic if the typed password is actually the raw API_KEY value.
      if (status === 401 || status === 503) {
        cosmeticStore(pw);
        onAuth?.('user');
        return;
      }
      setErrorMsg(payload?.detail?.message || `Login failed (${status})`);
    } catch (err) {
      // Network failure — fall back to cosmetic so the demo still works offline.
      cosmeticStore(pw);
      onAuth?.('user');
    } finally {
      setBusy(false);
    }
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
            : 'Register a new account, or login. (Pasting your API_KEY value also works.)'}
        </p>

        <form className="login-form" onSubmit={(e) => handleSubmit('login', e)}>
          <div className="login-field">
            <input
              ref={idRef}
              key={isAdmin ? 'admin-id' : 'email'}
              type={isAdmin ? 'text' : 'email'}
              placeholder={isAdmin ? 'Admin ID' : 'Email'}
              autoComplete={isAdmin ? 'username' : 'email'}
            />
          </div>
          <div className="login-field" style={{ position: 'relative' }}>
            <input
              ref={pwRef}
              type={showPw ? 'text' : 'password'}
              placeholder={isAdmin ? 'ADMIN_API_KEY value' : 'Password'}
              autoComplete={isAdmin ? 'current-password' : 'new-password'}
              style={{ paddingRight: 46 }}
            />
            <button
              type="button"
              className="login-reveal"
              onClick={() => setShowPw((s) => !s)}
              aria-label={showPw ? 'Hide password' : 'Show password'}
              aria-pressed={showPw}
              title={showPw ? 'Hide' : 'Show'}
              style={{
                position: 'absolute', top: '50%', right: 7, transform: 'translateY(-50%)',
                width: 34, height: 34, display: 'flex', alignItems: 'center', justifyContent: 'center',
                padding: 0, border: 'none', background: 'transparent', cursor: 'pointer',
                borderRadius: 9, color: 'rgba(244,244,247,0.6)', zIndex: 2,
              }}
            >
              {showPw ? (
                <svg width="17" height="17" viewBox="0 0 18 18" fill="none" aria-hidden="true">
                  <path d="M2 2 L16 16" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
                  <path d="M7.4 7.5 a2.2 2.2 0 0 0 3.1 3.1 M4.3 4.8 C2.9 5.7 1.8 7 1 8.5 C2.6 11.7 5.5 13.5 9 13.5 C10.2 13.5 11.3 13.3 12.3 12.9 M14.1 11.5 C15.1 10.7 15.9 9.7 16.5 8.5 C14.9 5.3 12 3.5 9 3.5 C8.4 3.5 7.9 3.6 7.3 3.7" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              ) : (
                <svg width="17" height="17" viewBox="0 0 18 18" fill="none" aria-hidden="true">
                  <path d="M1 8.5 C2.6 5.3 5.5 3.5 9 3.5 C12.5 3.5 15.4 5.3 17 8.5 C15.4 11.7 12.5 13.5 9 13.5 C5.5 13.5 2.6 11.7 1 8.5 Z" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round" />
                  <circle cx="9" cy="8.5" r="2.4" stroke="currentColor" strokeWidth="1.4" />
                </svg>
              )}
            </button>
          </div>

          {errorMsg && (
            <div style={{
              marginTop: 8,
              padding: '8px 12px',
              borderRadius: 8,
              background: 'oklch(0.62 0.16 25 / 0.12)',
              border: '1px solid oklch(0.62 0.16 25 / 0.3)',
              color: 'oklch(0.85 0.13 25)',
              fontSize: 12.5,
            }}>{errorMsg}</div>
          )}

          {isAdmin ? (
            <button type="submit" className="login-submit primary" disabled={busy}>
              {busy ? 'Signing in…' : 'Admin Login'}
            </button>
          ) : (
            <div className="login-actions">
              <button type="submit" className="login-submit primary" disabled={busy}>
                {busy ? '…' : 'Login'}
              </button>
              <button type="button" className="login-submit ghost" disabled={busy}
                      onClick={(e) => handleSubmit('register', e)}>
                {busy ? '…' : 'Register'}
              </button>
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
      <a href="https://github.com/soor3j" target="_blank" rel="noopener noreferrer">GitHub</a>
    </div>
  </footer>
);

Object.assign(window, { ScrollLogin, LoginPanel, MinimalFooter });
