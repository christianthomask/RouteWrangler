import type { Metadata } from 'next';
import './globals.css';
import { PRODUCT_NAME, PRODUCT_DESCRIPTOR } from '@/design/brand';

export const metadata: Metadata = {
  title: PRODUCT_NAME,
  description: PRODUCT_DESCRIPTOR,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
