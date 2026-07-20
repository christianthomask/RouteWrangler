'use client';

import { useEffect, useState } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import Link from 'next/link';
import type { MeResponse } from '@routewrangler/contracts';
import { BrandMark } from '@/components/Brand';
import { fetchMe, ApiError } from '@/lib/api';
import { signOut, isSignedIn } from '@/lib/session';
import { SyncIndicator } from './SyncIndicator';

const NAV = [
  { href: '/field', label: 'Today' },
  { href: '/field/tasks', label: 'Rereads' },
];

/**
 * Field reader shell (mobile-first PWA). The sync indicator is always visible
 * (DESIGN_BRIEF §4). Staff are redirected to the console.
 */
export function FieldShell({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const [me, setMe] = useState<MeResponse | null>(null);

  useEffect(() => {
    if (!isSignedIn()) {
      router.replace('/login');
      return;
    }
    fetchMe()
      .then((res) => {
        if (res.role !== 'reader') {
          router.replace('/supervisor');
          return;
        }
        setMe(res);
      })
      .catch((err) => {
        if (err instanceof ApiError && (err.status === 401 || err.status === 403)) router.replace('/login');
      });
  }, [router]);

  return (
    <div style={{ minHeight: '100vh', paddingBottom: 72 }}>
      <header
        style={{
          position: 'sticky',
          top: 0,
          zIndex: 20,
          height: 52,
          background: 'var(--rw-surface)',
          borderBottom: '1px solid var(--rw-border)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '0 var(--rw-space-4)',
        }}
      >
        <Link href="/field" style={{ display: 'flex', alignItems: 'center', gap: 8, textDecoration: 'none' }}>
          <BrandMark size={20} />
          {me && <span style={{ fontSize: 'var(--rw-text-sm)', color: 'var(--rw-text-secondary)' }}>{me.displayName.split(' ')[0]}</span>}
        </Link>
        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--rw-space-2)' }}>
          <SyncIndicator />
          <button
            onClick={() => {
              signOut();
              router.push('/login');
            }}
            style={{ background: 'transparent', border: 'none', color: 'var(--rw-text-muted)', fontSize: 'var(--rw-text-xs)', cursor: 'pointer' }}
          >
            Sign out
          </button>
        </div>
      </header>

      <main style={{ padding: 'var(--rw-space-4)', maxWidth: 640, margin: '0 auto' }}>
        {me ? children : <p style={{ color: 'var(--rw-text-muted)' }}>Loading…</p>}
      </main>

      <nav className="rw-fieldnav">
        {NAV.map((item) => {
          const active = item.href === '/field' ? pathname === '/field' : pathname.startsWith(item.href);
          return (
            <Link key={item.href} href={item.href} data-active={active}>
              {item.label}
            </Link>
          );
        })}
      </nav>
    </div>
  );
}
