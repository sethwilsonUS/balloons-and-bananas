import type { Metadata } from 'next';
import AccessHashBootstrap from '@/components/AccessHashBootstrap';
import AccessHashGuard from '@/components/AccessHashGuard';
import ThemeBootstrap from '@/components/ThemeBootstrap';
import { ARCHIVE_NAME, ARCHIVE_SUBTITLE, resolveMetadataBase } from '@/lib/site';
import './globals.css';

export const metadata: Metadata = {
  metadataBase: resolveMetadataBase(),
  title: ARCHIVE_NAME,
  description: `${ARCHIVE_SUBTITLE}.`,
  openGraph: {
    type: 'website',
    siteName: ARCHIVE_NAME,
    title: ARCHIVE_NAME,
    description: `${ARCHIVE_SUBTITLE}.`,
  },
  twitter: {
    card: 'summary_large_image',
  },
  robots: { index: false, follow: false, noarchive: true, nosnippet: true, noimageindex: true },
  referrer: 'no-referrer',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <ThemeBootstrap />
        <AccessHashBootstrap />
      </head>
      <body>
        <AccessHashGuard />
        {children}
      </body>
    </html>
  );
}
