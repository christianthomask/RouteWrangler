'use client';

import { useEffect, useState } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import Link from 'next/link';
import type { MeResponse, Role } from '@routewrangler/contracts';
import { BrandMark } from '@/components/Brand';
import { PRODUCT_NAME } from '@/design/brand';
import { HOME_BY_ROLE } from '@/design/tokens';
import { fetchMe, ApiError } from '@/lib/api';
import { signOut, isSignedIn } from '@/lib/session';

export interface NavItem {
  href: string;
  label: string;
}

const SUPERVISOR_NAV: NavItem[] = [
  { href: '/supervisor', label: 'Dashboard' },
  { href: '/supervisor/runs', label: 'Runs' },
  // Assigning work is a primary supervisor task, but the only route to it used
  // to be a button on the roster page.
  { href: '/supervisor/assign', label: 'Assign' },
  { href: '/supervisor/exceptions', label: 'Exceptions' },
  { href: '/supervisor/roster', label: 'Roster' },
  { href: '/supervisor/exports', label: 'Exports' },
];

/** The home link matches exactly; every other link matches its subtree. */
function isActive(pathname: string, href: string, home: string): boolean {
  return href === home ? pathname === home : pathname.startsWith(href);
}

/**
 * Console shell (ADR-018 — mobile-first). Desktop gets a left rail; on phones
 * the nav becomes a fixed bottom tab bar (supervisors work from the field).
 *
 * Parameterized by nav and permitted roles so the admin console reuses it rather
 * than cloning it. Defaults reproduce the supervisor console exactly, which is
 * what an unqualified `<Shell>` has always meant.
 *
 * Role-guarded here only for navigation; the API remains the authorization
 * boundary (BUILD_SPEC §6).
 */
export function Shell({
  children,
  nav = SUPERVISOR_NAV,
  home = '/supervisor',
  allow = ['supervisor', 'admin'],
}: {
  children: React.ReactNode;
  nav?: NavItem[];
  home?: string;
  allow?: Role[];
}) {
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
        if (!allow.includes(res.role)) {
          router.replace(HOME_BY_ROLE[res.role]);
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
    // Deliberately keyed on `router` alone: `allow` is a per-shell literal, and
    // including it would re-run this on every render (a new array each time).
  }, [router]);

  function onSignOut() {
    signOut();
    router.push('/login');
  }

  return (
    <div className="rw-shell">
      <aside className="rw-rail">
        <Link href={home} style={{ display: 'flex', alignItems: 'center', gap: 8, textDecoration: 'none' }}>
          <BrandMark size={22} />
          <span style={{ fontWeight: 700, color: 'var(--rw-text)', letterSpacing: '-0.01em' }}>{PRODUCT_NAME}</span>
        </Link>
        <nav style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
          {nav.map((item) => {
            const active = isActive(pathname, item.href, home);
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
          <Link href={home} className="rw-brand-mobile" style={{ display: 'flex', alignItems: 'center', gap: 8, textDecoration: 'none' }}>
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
        {nav.map((item) => (
          <Link key={item.href} href={item.href} data-active={isActive(pathname, item.href, home)}>
            {item.label}
          </Link>
        ))}
      </nav>
    </div>
  );
}
