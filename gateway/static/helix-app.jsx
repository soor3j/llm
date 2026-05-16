// LLM Inference Server — Main App
function App() {
  const [scrolled, setScrolled] = React.useState(false);
  const [loginProgress, setLoginProgress] = React.useState(0);
  const [authed, setAuthed] = React.useState(null);   // 'user' | 'admin' | null
  const [leaving, setLeaving] = React.useState(false);

  React.useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 12);
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  // Nav flips to dark mode in lockstep with the emerge overlay.
  const darkNav = loginProgress > 0.35;

  const scrollToLogin = () => {
    const zone = document.querySelector('.emerge-zone');
    if (zone) {
      const target = zone.offsetTop + zone.offsetHeight - window.innerHeight * 0.4;
      window.scrollTo({ top: target, behavior: 'smooth' });
    }
  };

  const handleAuth = (kind) => {
    // Cinematic transition: keep the dark overlay in place; mount workspace
    // on top with its own entry animation (opacity 0→1, scale 0.98→1, blur 12→0).
    setAuthed(kind);
    // Lock body scroll while in workspace
    document.body.style.overflow = 'hidden';
  };

  const handleSignOut = () => {
    // Reverse the entry — fade workspace out, then unmount.
    setLeaving(true);
    // Forget the API keys so the next sign-in must re-enter them.
    try {
      localStorage.removeItem('apiKey');
      localStorage.removeItem('adminApiKey');
    } catch {}
    setTimeout(() => {
      setAuthed(null);
      setLeaving(false);
      document.body.style.overflow = '';
      // bring user back to top of marketing
      window.scrollTo({ top: 0, behavior: 'instant' in window ? 'instant' : 'auto' });
    }, 520);
  };

  return (
    <React.Fragment>
      <Nav dark={darkNav} scrolled={scrolled} onSignIn={scrollToLogin} />
      <Hero />
      <ValueCards />
      <Architecture />
      <ScrollLogin onProgressChange={setLoginProgress} onAuth={handleAuth} />
      <MinimalFooter />
      {authed === 'user' && <UserWorkspace onSignOut={handleSignOut} leaving={leaving} />}
      {authed === 'admin' && <AdminWorkspace onSignOut={handleSignOut} leaving={leaving} />}
    </React.Fragment>
  );
}

const root = ReactDOM.createRoot(document.getElementById('root'));
root.render(<App />);
