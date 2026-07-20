'use client';

import { useEffect, useState } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import Link from 'next/link';
import type { MeResponse } from '@routewrangler/contracts';
import { BrandMark } from '@/components/Brand';
import { PRODUCT_NAME } from '@/design/brand';
import { fetchMe, ApiError } from '@/lib/api';
import { signOut, isSignedIn } from '@/lib/session';

const NAV = [
  { href: '/supervisor', label: 'Dashboard' },
  { href: '/supervisor/exceptions', label: 'Exceptions' },
];

function isActive(pathname: string, href: string): boolean {
  return href === '/supervisor' ? pathname === '/supervisor' : pathname.startsWith(href);
}

/**
 * Supervisor console shell (ADR-018 — mobile-first). Desktop gets a left rail;
 * on phones the nav becomes a fixed bottom tab bar (supervisors work from the
 * field). Role-guarded (the API enforces roles server-side — BUILD_SPEC §6).
 */
export function Shell({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const [me, setMe] = useState<MeResponse | null>(null);
  const [denied, setDenied] = useState(false);

  useEffect(() => {
    if (!isSignedIn()) {
      router.replace('/login');
      return;
    }
    fetchMe()
      .then((res) => {
        if (res.role === 'reader') {
          router.replace('/field');
          return;
        }
        setMe(res);
      })
      .catch((err) => {
        if (err instanceof ApiError && (err.status === 401 || err.status === 403)) {
          router.replace('/login');
        } else {
          setDenied(true);
        }
      });
  }, [router]);

  function onSignOut() {
    signOut();
    router.push('/login');
  }

  return (
    <div className="rw-shell">
      <aside className="rw-rail">
        <Link href="/supervisor" style={{ display: 'flex', alignItems: 'center', gap: 8, textDecoration: 'none' }}>
          <BrandMark size={22} />
          <span style={{ fontWeight: 700, color: 'var(--rw-text)', letterSpacing: '-0.01em' }}>{PRODUCT_NAME}</span>
        </Link>
        <nav style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
          {NAV.map((item) => {
            const active = isActive(pathname, item.href);
            return (
              <Link
                key={item.href}
                href={item.href}
                style={{
                  padding: '0.45rem 0.65rem',
                  borderRadius: 'var(--rw-radius-sm)',
                  fontSize: 'var(--rw-text-sm)',
                  fontWeight: 'var(--rw-weight-medium)',
                  textDecoration: 'none',
                  color: active ? 'var(--rw-brand)' : 'var(--rw-text-secondary)',
                  background: active ? 'var(--rw-brand-soft)' : 'transparent',
                }}
              >
                {item.label}
              </Link>
            );
          })}
        </nav>
      </aside>

      <div style={{ display: 'flex', flexDirection: 'column', minWidth: 0 }}>
        <header
          style={{
            height: 52,
            borderBottom: '1px solid var(--rw-border)',
            background: 'var(--rw-surface)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 'var(--rw-space-3)',
            padding: '0 var(--rw-space-4)',
            position: 'sticky',
            top: 0,
            zIndex: 20,
          }}
        >
          {/* brand shows in the header on mobile (rail is hidden) */}
          <Link href="/supervisor" className="rw-brand-mobile" style={{ display: 'flex', alignItems: 'center', gap: 8, textDecoration: 'none' }}>
            <BrandMark size={20} />
            <span style={{ fontWeight: 700, color: 'var(--rw-text)' }}>{PRODUCT_NAME}</span>
          </Link>
          <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--rw-space-3)', marginLeft: 'auto' }}>
            {me && (
              <span style={{ fontSize: 'var(--rw-text-sm)', color: 'var(--rw-text-secondary)' }}>
                <span className="rw-hide-sm">{me.displayName} </span>
                <span className="rw-badge">{me.role}</span>
              </span>
            )}
            <button className="rw-button rw-button--ghost" onClick={onSignOut}>
              Sign out
            </button>
          </div>
        </header>

        <main className="rw-main">
          {denied ? (
            <div className="rw-card">
              <p style={{ color: 'var(--rw-danger)', margin: 0 }}>Could not reach the API.</p>
              <p style={{ color: 'var(--rw-text-muted)', fontSize: 'var(--rw-text-sm)' }}>
                Is it running on {process.env.NEXT_PUBLIC_API_BASE_URL ?? 'http://localhost:3001'}?
              </p>
            </div>
          ) : me ? (
            children
          ) : (
            <p style={{ color: 'var(--rw-text-muted)' }}>Loading…</p>
          )}
        </main>
      </div>

      <nav className="rw-bottomnav">
        {NAV.map((item) => (
          <Link key={item.href} href={item.href} data-active={isActive(pathname, item.href)}>
            {item.label}
          </Link>
        ))}
      </nav>
    </div>
  );
}
