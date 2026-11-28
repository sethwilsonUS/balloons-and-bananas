import { ImageResponse } from 'next/og';
import { renderCassetteTapeArtwork } from '@/components/CassetteReelLogo';
import {
  ARCHIVE_NAME,
  ARCHIVE_SUBTITLE,
  resolveCanonicalSiteHost,
} from '@/lib/site';
import {
  loadOgFonts,
  OG_SANS_FAMILY,
  OG_SERIF_FAMILY,
} from './og-fonts';

export const alt = 'The Seth Tapes — A childhood-language archive from the Peters/Wilson corpus';
export const size = { width: 1200, height: 630 };
export const contentType = 'image/png';

// Matches `[data-theme='dark']` tokens in `src/app/globals.css`.
const DARK_PALETTE = {
  paper: '#181f1a',
  paperLight: '#222c24',
  ink: '#edf0e5',
  reading: '#d0dac8',
  muted: '#bcc6b6',
  forest: '#b5d8b8',
  rust: '#ffb393',
  line: '#475244',
} as const;

export default async function OpenGraphImage() {
  const fonts = await loadOgFonts();
  const hasSerif = fonts.some(font => font.name === OG_SERIF_FAMILY);
  const hasSans = fonts.some(font => font.name === OG_SANS_FAMILY);
  const siteHost = resolveCanonicalSiteHost();

  return new ImageResponse(
    (
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          backgroundColor: DARK_PALETTE.paper,
          padding: '84px 160px',
          fontFamily: hasSans ? OG_SANS_FAMILY : 'sans-serif',
        }}
      >
        <div
          style={{
            width: '840px',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'flex-start',
          }}
        >
          <svg
            xmlns="http://www.w3.org/2000/svg"
            width="112"
            height="70"
            viewBox="0 0 64 40"
            fill="none"
          >
            {renderCassetteTapeArtwork({
              ink: DARK_PALETTE.forest,
              shellFill: DARK_PALETTE.paperLight,
            })}
          </svg>

          <div
            style={{
              marginTop: '30px',
              fontFamily: hasSerif ? OG_SERIF_FAMILY : 'serif',
              fontSize: '94px',
              fontWeight: 500,
              lineHeight: 1.04,
              letterSpacing: '-0.025em',
              color: DARK_PALETTE.ink,
            }}
          >
            {ARCHIVE_NAME}
          </div>

          <div
            style={{
              marginTop: '18px',
              fontFamily: hasSans ? OG_SANS_FAMILY : 'sans-serif',
              fontSize: '32px',
              fontWeight: 400,
              lineHeight: 1.35,
              color: DARK_PALETTE.reading,
            }}
          >
            {ARCHIVE_SUBTITLE}
          </div>

          <div
            style={{
              marginTop: '44px',
              width: '100%',
              display: 'flex',
              alignItems: 'center',
            }}
          >
            <div
              style={{
                width: '68px',
                height: '3px',
                backgroundColor: DARK_PALETTE.rust,
              }}
            />
            <div
              style={{
                flex: 1,
                height: '1.5px',
                backgroundColor: DARK_PALETTE.line,
              }}
            />
          </div>

          <div
            style={{
              marginTop: '24px',
              fontFamily: hasSans ? OG_SANS_FAMILY : 'sans-serif',
              fontSize: '24px',
              fontWeight: 500,
              letterSpacing: '0.015em',
              color: DARK_PALETTE.muted,
            }}
          >
            {siteHost}
          </div>
        </div>
      </div>
    ),
    {
      ...size,
      fonts,
    },
  );
}
