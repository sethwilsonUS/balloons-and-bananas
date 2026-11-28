import type { NextConfig } from 'next';
import { withBotId } from 'botid/next/config';

const robots = 'noindex, nofollow, noarchive, nosnippet, noimageindex';
const csp = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline'" + (process.env.NODE_ENV === 'development' ? " 'unsafe-eval'" : ''),
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data:",
  "font-src 'self'",
  "connect-src 'self' https://*.private.blob.vercel-storage.com",
  "media-src 'self' https://*.private.blob.vercel-storage.com blob:",
  "frame-src 'none'",
  "frame-ancestors 'none'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
].join('; ');

const privateNoStoreHeaders = [
  { key: 'Cache-Control', value: 'private, no-store, max-age=0' },
  { key: 'CDN-Cache-Control', value: 'no-store' },
  { key: 'Vercel-CDN-Cache-Control', value: 'no-store' },
];

const config: NextConfig = {
  poweredByHeader: false,
  productionBrowserSourceMaps: false,
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          { key: 'X-Robots-Tag', value: robots },
          { key: 'Referrer-Policy', value: 'no-referrer' },
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'X-Frame-Options', value: 'DENY' },
          { key: 'Content-Security-Policy', value: csp },
          { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=(), browsing-topics=()' },
        ],
      },
      {
        source: '/sessions/:path*',
        headers: privateNoStoreHeaders,
      },
      {
        source: '/research',
        headers: privateNoStoreHeaders,
      },
      {
        source: '/research/:path*',
        headers: privateNoStoreHeaders,
      },
      {
        source: '/about',
        headers: privateNoStoreHeaders,
      },
      {
        source: '/search',
        headers: privateNoStoreHeaders,
      },
      {
        source: '/search/:path*',
        headers: privateNoStoreHeaders,
      },
    ];
  },
};
export default withBotId(config);
