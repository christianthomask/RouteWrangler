import { PRODUCT_NAME } from '@/design/brand';

/**
 * The product mark: a water droplet with a meter "level" line — source water +
 * measurement, the two ideas at the heart of the product. Geometric and calm,
 * legible down to favicon size. Final name/mark pending sign-off (ADR-017).
 */
export function BrandMark({ size = 28 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden="true" role="img">
      <path
        d="M16 3.2c4.6 5.6 7.4 9.5 7.4 13.3a7.4 7.4 0 0 1-14.8 0c0-3.8 2.8-7.7 7.4-13.3z"
        fill="var(--rw-brand)"
      />
      {/* meter level line + tick — the measurement motif */}
      <path d="M9.6 17.4h12.8" stroke="var(--rw-brand-contrast)" strokeWidth="1.5" opacity="0.9" />
      <circle cx="16" cy="17.4" r="1.5" fill="var(--rw-brand-contrast)" />
    </svg>
  );
}

export function Brand({ size = 28 }: { size?: number }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
      <BrandMark size={size} />
      <span
        style={{
          fontWeight: 700,
          fontSize: size * 0.6,
          letterSpacing: '-0.015em',
          color: 'var(--rw-text)',
        }}
      >
        {PRODUCT_NAME}
      </span>
    </div>
  );
}
