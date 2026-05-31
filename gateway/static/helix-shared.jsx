// LLM Inference Server — shared components & icons

const BrandMark = ({ size = 56, dark = false }) => (
  <img src="icon2.png" width={size} height={size} style={{ objectFit: 'contain', display: 'block', transform: 'scale(1.8)', transformOrigin: 'center' }} alt="logo" />
);

const Icon = {
  Arrow: ({ size = 14 }) => (
    <svg width={size} height={size} viewBox="0 0 14 14" fill="none">
      <path d="M3 7h8m0 0L7.5 3.5M11 7l-3.5 3.5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  ),
  Down: ({ size = 12 }) => (
    <svg width={size} height={size} viewBox="0 0 12 12" fill="none">
      <path d="M3 5l3 3 3-3" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  ),
User: ({ size = 18 }) => (
    <svg width={size} height={size} viewBox="0 0 18 18" fill="none">
      <circle cx="9" cy="6.5" r="3" stroke="currentColor" strokeWidth="1.4" />
      <path d="M2.5 15.5 C 3.5 12.5, 6 11, 9 11 C 12 11, 14.5 12.5, 15.5 15.5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
    </svg>
  ),
  Close: ({ size = 14 }) => (
    <svg width={size} height={size} viewBox="0 0 14 14" fill="none">
      <path d="M3 3 L11 11 M11 3 L3 11" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  ),
  Lock: ({ size = 16 }) => (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none">
      <rect x="3" y="7" width="10" height="7" rx="1.6" stroke="currentColor" strokeWidth="1.4" />
      <path d="M5 7 V5 C 5 3.3, 6.3 2, 8 2 C 9.7 2, 11 3.3, 11 5 V7" stroke="currentColor" strokeWidth="1.4" />
    </svg>
  ),
  Pulse: ({ size = 16 }) => (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none">
      <path d="M1.5 8 H4 L5.5 4 L8 12 L10 6 L11.5 8 H14.5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  ),
  Network: ({ size = 16 }) => (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none">
      <circle cx="8" cy="3" r="1.6" stroke="currentColor" strokeWidth="1.3" />
      <circle cx="3" cy="13" r="1.6" stroke="currentColor" strokeWidth="1.3" />
      <circle cx="13" cy="13" r="1.6" stroke="currentColor" strokeWidth="1.3" />
      <path d="M8 4.6 L3.8 11.5 M8 4.6 L12.2 11.5 M4.6 13 H11.4" stroke="currentColor" strokeWidth="1.3" />
    </svg>
  ),
  Chip: ({ size = 16 }) => (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none">
      <rect x="3.5" y="3.5" width="9" height="9" rx="1.4" stroke="currentColor" strokeWidth="1.3" />
      <rect x="6" y="6" width="4" height="4" rx="0.5" stroke="currentColor" strokeWidth="1.3" />
      <path d="M2 6 H3.5 M2 10 H3.5 M12.5 6 H14 M12.5 10 H14 M6 2 V3.5 M10 2 V3.5 M6 12.5 V14 M10 12.5 V14" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
    </svg>
  ),
  Stream: ({ size = 16 }) => (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none">
      <path d="M2 5 H10 M2 8 H14 M2 11 H8" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
    </svg>
  ),
  Queue: ({ size = 16 }) => (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none">
      <rect x="2" y="6" width="3" height="4" rx="0.6" stroke="currentColor" strokeWidth="1.3" />
      <rect x="6.5" y="6" width="3" height="4" rx="0.6" stroke="currentColor" strokeWidth="1.3" />
      <rect x="11" y="6" width="3" height="4" rx="0.6" stroke="currentColor" strokeWidth="1.3" />
    </svg>
  ),
  Globe: ({ size = 16 }) => (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none">
      <circle cx="8" cy="8" r="6" stroke="currentColor" strokeWidth="1.3" />
      <ellipse cx="8" cy="8" rx="2.4" ry="6" stroke="currentColor" strokeWidth="1.3" />
      <path d="M2 8 H14" stroke="currentColor" strokeWidth="1.3" />
    </svg>
  ),
};

// Hook: reveal on scroll
function useReveal(opts = {}) {
  const ref = React.useRef(null);
  const [shown, setShown] = React.useState(false);
  React.useEffect(() => {
    if (!ref.current || shown) return;
    const obs = new IntersectionObserver(
      (entries) => {
        entries.forEach((e) => {
          if (e.isIntersecting) {
            setShown(true);
            obs.disconnect();
          }
        });
      },
      { threshold: opts.threshold ?? 0.18, rootMargin: opts.rootMargin ?? '0px 0px -10% 0px' }
    );
    obs.observe(ref.current);
    return () => obs.disconnect();
  }, [shown]);
  return [ref, shown];
}

Object.assign(window, { BrandMark, Icon, useReveal });
