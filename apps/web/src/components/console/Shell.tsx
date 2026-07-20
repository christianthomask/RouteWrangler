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

/**
 * Supervisor console shell (DESIGN_BRIEF §4) — left rail + top bar. Role-guarded
 * (convenience; the API enforces roles server-side — BUILD_SPEC §6).
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
    <div style={{ display: 'grid', gridTemplateColumns: '220px 1fr', minHeight: '100vh' }}>
      <aside
        style={{
          borderRight: '1px solid var(--rw-border)',
          background: 'var(--rw-surface)',
          padding: 'var(--rw-space-4)',
          display: 'flex',
          flexDirection: 'column',
          gap: 'var(--rw-space-4)',
        }}
      >
        <Link href="/supervisor" style={{ display: 'flex', alignItems: 'center', gap: 8, textDecoration: 'none' }}>
          <BrandMark size={22} />
          <span style={{ fontWeight: 700, color: 'var(--rw-text)', letterSpacing: '-0.01em' }}>
            {PRODUCT_NAME}
          </span>
        </Link>

        <nav style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
          {NAV.map((item) => {
            const active =
              item.href === '/supervisor'
                ? pathname === '/supervisor'
                : pathname.startsWith(item.href);
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
            justifyContent: 'flex-end',
            gap: 'var(--rw-space-3)',
            padding: '0 var(--rw-space-6)',
          }}
        >
          {me && (
            <span style={{ fontSize: 'var(--rw-text-sm)', color: 'var(--rw-text-secondary)' }}>
              {me.displayName} <span className="rw-badge">{me.role}</span>
            </span>
          )}
          <button className="rw-button rw-button--ghost" onClick={onSignOut}>
            Sign out
          </button>
        </header>

        <main style={{ padding: 'var(--rw-space-6)', maxWidth: 1200, width: '100%', margin: '0 auto' }}>
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
    </div>
  );
}
