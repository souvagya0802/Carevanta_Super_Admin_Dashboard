import type { Metadata, Viewport } from 'next';
import './globals.css';
import { AppProviders } from '@/lib/providers';

export const metadata: Metadata = {
  title: { default: 'Carevanta Admin', template: '%s · Carevanta Admin' },
  description: 'Carevanta platform administration',
  robots: { index: false, follow: false },
  icons: { icon: '/icon-192.png', apple: '/icon-192.png' },
};

export const viewport: Viewport = { width: 'device-width', initialScale: 1 };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-full">
        <AppProviders>{children}</AppProviders>
      </body>
    </html>
  );
}
