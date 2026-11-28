/**
 * Hand-built simplified iconic 1980s compact-cassette SVG mark for The Seth Tapes:
 * clean rounded rectangular shell (~1.6:1 proportion), quiet top label band,
 * clear central tape window with two bold circular spools and open hub holes,
 * and the signature bottom trapezoidal head-bridge bulge with two minimal dots.
 *
 * Uses `currentColor` by default so forest-ink tokens adapt automatically across
 * light, dark, hover, and `forced-colors` modes with zero hardcoded light fills.
 * Omit `label` when paired beside visible brand text (decorative); supply
 * `label` whenever the mark stands alone without adjacent brand text.
 */

/**
 * Returns the intrinsic `<g>` artwork for the simplified iconic 1980s compact
 * cassette so it can be shared directly inside both DOM `<svg>` and `next/og`
 * Satori `<svg>` (which requires only intrinsic SVG elements as children of
 * `<svg>`).
 */
export function renderCassetteTapeArtwork({
  ink = 'currentColor',
  shellFill,
}: {
  ink?: string;
  shellFill?: string;
} = {}) {
  const resolvedInk = typeof ink === 'string' && ink.trim().length > 0 ? ink.trim() : 'currentColor';
  const trimmedShellFill = typeof shellFill === 'string' ? shellFill.trim() : '';
  const hasShellFill = trimmedShellFill.length > 0;

  return (
    <g
      fill="none"
      stroke={resolvedInk}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {/* Clean rounded rectangular 1980s compact-cassette shell (~1.6:1) */}
      <rect
        x="2"
        y="2"
        width="60"
        height="36"
        rx="4"
        fill={hasShellFill ? trimmedShellFill : resolvedInk}
        fillOpacity={hasShellFill ? undefined : '0.04'}
        strokeWidth="2.2"
      />

      {/* Quiet top label band */}
      <rect
        x="7"
        y="6"
        width="50"
        height="4"
        rx="1.5"
        fill={resolvedInk}
        fillOpacity="0.2"
        stroke="none"
      />

      {/* Clear central tape window */}
      <rect
        x="10.5"
        y="13.2"
        width="43"
        height="13.8"
        rx="3"
        fill={resolvedInk}
        fillOpacity="0.06"
        strokeWidth="1.9"
      />

      {/* Two bold circular tape spools with clear open hub holes */}
      <circle cx="21" cy="20.1" r="3.75" strokeWidth="2.2" />
      <circle cx="43" cy="20.1" r="3.75" strokeWidth="2.2" />

      {/* Signature bottom trapezoidal head-bridge bulge with two minimal dots */}
      <path
        d="M 15.5 38 L 19 30.4 H 45 L 48.5 38"
        fill={resolvedInk}
        fillOpacity="0.07"
        strokeWidth="2"
      />
      <circle cx="25.5" cy="34.2" r="1.4" fill={resolvedInk} stroke="none" />
      <circle cx="38.5" cy="34.2" r="1.4" fill={resolvedInk} stroke="none" />
    </g>
  );
}

export default function CassetteReelLogo({
  label,
  className,
}: {
  label?: string;
  className?: string;
}) {
  const trimmedLabel = typeof label === 'string' ? label.trim() : '';
  const standalone = trimmedLabel.length > 0;
  const classes = className ? `cassette-reel-logo ${className}` : 'cassette-reel-logo';

  return (
    <svg
      className={classes}
      viewBox="0 0 64 40"
      width="42"
      height="26"
      fill="none"
      focusable="false"
      role={standalone ? 'img' : undefined}
      aria-label={standalone ? trimmedLabel : undefined}
      aria-hidden={standalone ? undefined : true}
    >
      {renderCassetteTapeArtwork()}
    </svg>
  );
}
