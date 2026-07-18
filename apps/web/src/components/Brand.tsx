/**
 * The product mark. Final name + mark come from Design Sprint 0; this is a
 * clean placeholder wordmark so the login and shells are branded, not blank.
 */
export function Brand({ size = 28 }: { size?: number }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
      <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden="true">
        <path
          d="M16 3c5 6 8 10 8 14a8 8 0 1 1-16 0c0-4 3-8 8-14z"
          fill="var(--rw-accent)"
        />
        <path d="M12 19c1.6 1.6 6.4 1.6 8 0" stroke="white" strokeWidth="1.6" fill="none" />
      </svg>
      <span style={{ fontWeight: 700, fontSize: size * 0.62, letterSpacing: '-0.01em' }}>
        RouteWrangler
      </span>
    </div>
  );
}
