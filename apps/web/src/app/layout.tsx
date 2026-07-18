import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'RouteWrangler',
  description: 'Source-agnostic Meter Data Management for contract water-meter reading.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
