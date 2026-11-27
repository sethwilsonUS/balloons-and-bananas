import type { Metadata } from 'next';
import ThemeBootstrap from '@/components/ThemeBootstrap';
import { ARCHIVE_NAME, ARCHIVE_SUBTITLE } from '@/lib/site';
import './globals.css';

export const metadata: Metadata = {
  title: ARCHIVE_NAME,
  description: `${ARCHIVE_SUBTITLE}.`,
  robots: { index: false, follow: false, noarchive: true, nosnippet: true, noimageindex: true },
  referrer: 'no-referrer',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return <html lang="en" suppressHydrationWarning><head><ThemeBootstrap /></head><body>{children}</body></html>;
}
