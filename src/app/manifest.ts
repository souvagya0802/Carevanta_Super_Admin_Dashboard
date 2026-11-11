import type { MetadataRoute } from 'next';

/**
 * Web app manifest: lets the platform team install the dashboard from the browser
 * (Android, iOS Add to Home Screen, desktop) as "Carevanta Admin", so it never gets
 * confused with the patient app ("Carevanta") or the provider portal ("Carevanta Provider").
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'Carevanta Admin',
    short_name: 'Carevanta Admin',
    description: 'Carevanta platform administration: providers, verification, bookings, finance and support.',
    start_url: '/?source=pwa',
    scope: '/',
    display: 'standalone',
    background_color: '#f5f6f8',
    theme_color: '#0a0a0a',
    lang: 'en-IN',
    categories: ['medical', 'business', 'productivity'],
    icons: [
      { src: '/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
      { src: '/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
      { src: '/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ],
  };
}
