import type { Metadata } from 'next';
import { ClerkProvider } from '@clerk/nextjs';
import './globals.css';
import { PRODUCT_NAME, PRODUCT_DESCRIPTOR } from '@/design/brand';
import { clerkConfigured } from '@/lib/config';
import { ClerkTokenBridge } from '@/components/auth/ClerkTokenBridge';

export const metadata: Metadata = {
  title: PRODUCT_NAME,
  description: PRODUCT_DESCRIPTOR,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  // Clerk wraps the app only once a publishable key is configured (deployed
  // environments). Locally, the dev-bypass login runs with no provider at all
  // (ADR-012, ADR-015) — so Clerk hooks are only ever mounted under the guard.
  return (
    <html lang="en">
      <body>
        {clerkConfigured ? (
          <ClerkProvider>
            <ClerkTokenBridge />
            {children}
          </ClerkProvider>
        ) : (
          children
        )}
      </body>
    </html>
  );
}
