import type { Metadata, Viewport } from 'next';
import { FieldShell } from '@/components/field/FieldShell';
import { ServiceWorkerRegistrar } from '@/components/field/ServiceWorkerRegistrar';

export const metadata: Metadata = {
  title: 'Verameter Field',
  manifest: '/manifest.webmanifest',
  appleWebApp: { capable: true, statusBarStyle: 'default', title: 'Verameter' },
  icons: { apple: '/icons/apple-touch-icon.png' },
};

export const viewport: Viewport = {
  themeColor: '#0e7490',
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
};

export default function FieldLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <ServiceWorkerRegistrar />
      <FieldShell>{children}</FieldShell>
    </>
  );
}
