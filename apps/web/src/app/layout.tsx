import type { Metadata } from 'next';
import './globals.css';
import { PRODUCT_NAME, PRODUCT_DESCRIPTOR } from '@/design/brand';
import { neonAuthConfigured } from '@/lib/config';
import { NeonTokenBridge } from '@/components/auth/NeonTokenBridge';

export const metadata: Metadata = {
  title: PRODUCT_NAME,
  description: PRODUCT_DESCRIPTOR,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  // No provider component to wrap the tree in: the Neon Auth React client holds
  // its session in its own store, so the bridge is just a sibling that keeps the
  // API token fresh. It mounts only once an auth URL is configured — locally the
  // dev-bypass login runs with no IdP at all (ADR-012, ADR-015, ADR-027).
  return (
    <html lang="en">
      <body>
        {neonAuthConfigured && <NeonTokenBridge />}
        {children}
      </body>
    </html>
  );
}
