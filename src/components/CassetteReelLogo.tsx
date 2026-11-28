/**
 * Hand-built SVG 1980s compact-cassette mark for The Seth Tapes: outer plastic
 * shell with rounded corners and four corner screws, chamfered archival paper
 * label with horizontal ruling, recessed central tape window showing asymmetric
 * magnetic-tape spools and two 6-spoke drive hubs, and the signature bottom
 * trapezoidal head bridge with capstan and guide-pin holes.
 *
 * Uses `currentColor` by default so forest-ink tokens adapt automatically across
 * light, dark, hover, and `forced-colors` modes with zero hardcoded light fills.
 * Omit `label` when paired beside visible brand text (decorative); supply
 * `label` whenever the mark stands alone without adjacent brand text.
 */

const LEFT_HUB_CX = 19.8;
const RIGHT_HUB_CX = 44.2;
const HUB_CY = 19.6;

/** Six evenly spaced radial hub drive spokes for an authentic compact cassette reel. */
function buildHubSpokes(cx: number, cy: number, startDeg: number) {
  const innerR = 1.9;
  const outerR = 4.05;
  return Array.from({ length: 6 }, (_, index) => {
    const rad = ((startDeg + index * 60) * Math.PI) / 180;
    const cos = Math.cos(rad);
    const sin = Math.sin(rad);
    return {
      key: `${cx}-${index}`,
      x1: Number((cx + innerR * cos).toFixed(2)),
      y1: Number((cy + innerR * sin).toFixed(2)),
      x2: Number((cx + outerR * cos).toFixed(2)),
      y2: Number((cy + outerR * sin).toFixed(2)),
    };
  });
}

const LEFT_HUB_SPOKES = buildHubSpokes(LEFT_HUB_CX, HUB_CY, 0);
const RIGHT_HUB_SPOKES = buildHubSpokes(RIGHT_HUB_CX, HUB_CY, 30);

const CORNER_SCREWS = [
  { key: 'tl', cx: 5.0, cy: 5.0 },
  { key: 'tr', cx: 59.0, cy: 5.0 },
  { key: 'bl', cx: 5.0, cy: 35.0 },
  { key: 'br', cx: 59.0, cy: 35.0 },
] as const;

/**
 * Returns the intrinsic `<g>` artwork for the 1980s compact cassette so it can
 * be shared directly inside both DOM `<svg>` and `next/og` Satori `<svg>`
 * (which requires only intrinsic SVG elements as children of `<svg>`).
 */
export function renderCassetteTapeArtwork({
  ink = 'currentColor',
  labelFill,
}: {
  ink?: string;
  labelFill?: string;
} = {}) {
  return (
    <g
      fill="none"
      stroke={ink}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {/* Outer 1980s compact-cassette shell with softly rounded corners */}
      <rect
        x="1.5"
        y="1.5"
        width="61"
        height="37"
        rx="3.2"
        fill={ink}
        fillOpacity="0.06"
        strokeWidth="2"
      />

      {/* Four corner housing screws */}
      {CORNER_SCREWS.map(screw => (
        <circle
          key={screw.key}
          cx={screw.cx}
          cy={screw.cy}
          r="1.05"
          fill={ink}
          stroke="none"
        />
      ))}

      {/* Classic chamfered top paper label panel with horizontal archival ruling */}
      <path
        d="M 10.6 4.8 H 53.4 L 56.2 7.6 V 26.8 Q 56.2 27.6 55.4 27.6 H 8.6 Q 7.8 27.6 7.8 26.8 V 7.6 Z"
        fill={labelFill ?? 'none'}
        strokeWidth="1.2"
        strokeOpacity="0.86"
      />
      <line x1="11.2" y1="8.3" x2="52.8" y2="8.3" strokeWidth="1.15" strokeOpacity="0.72" />
      <line x1="11.2" y1="11.1" x2="52.8" y2="11.1" strokeWidth="0.95" strokeOpacity="0.48" />

      {/* Recessed, tinted central tape window */}
      <rect
        x="12.2"
        y="13.8"
        width="39.6"
        height="11.6"
        rx="2.6"
        fill={ink}
        fillOpacity="0.1"
        stroke="none"
      />

      {/* Left (fuller) supply tape pack clipped cleanly to the window, hub cutout kept open */}
      <path
        d="M 14.8 13.8 H 26.15 A 8.6 8.6 0 0 1 26.15 25.4 H 14.8 A 2.6 2.6 0 0 1 12.2 22.8 V 16.4 A 2.6 2.6 0 0 1 14.8 13.8 Z M 24.1 19.6 A 4.3 4.3 0 1 0 15.5 19.6 A 4.3 4.3 0 1 0 24.1 19.6 Z"
        fill={ink}
        fillOpacity="0.24"
        fillRule="evenodd"
        stroke="none"
      />
      <path d="M 26.15 13.8 A 8.6 8.6 0 0 1 26.15 25.4" strokeWidth="1.05" strokeOpacity="0.78" />

      {/* Right (slimmer) take-up tape pack clipped cleanly to the window, hub cutout kept open */}
      <path
        d="M 41.05 13.8 H 47.35 A 6.6 6.6 0 0 1 47.35 25.4 H 41.05 A 6.6 6.6 0 0 1 41.05 13.8 Z M 48.5 19.6 A 4.3 4.3 0 1 0 39.9 19.6 A 4.3 4.3 0 1 0 48.5 19.6 Z"
        fill={ink}
        fillOpacity="0.24"
        fillRule="evenodd"
        stroke="none"
      />
      <path d="M 41.05 13.8 A 6.6 6.6 0 0 0 41.05 25.4" strokeWidth="1.05" strokeOpacity="0.72" />
      <path d="M 47.35 13.8 A 6.6 6.6 0 0 1 47.35 25.4" strokeWidth="1.05" strokeOpacity="0.72" />

      {/* Subtle tape-remaining index ticks in the open center viewing aperture */}
      <line x1="30.2" y1="14.6" x2="30.2" y2="16.1" strokeWidth="0.9" strokeOpacity="0.55" />
      <line x1="32.0" y1="14.4" x2="32.0" y2="16.4" strokeWidth="1.0" strokeOpacity="0.68" />
      <line x1="33.8" y1="14.6" x2="33.8" y2="16.1" strokeWidth="0.9" strokeOpacity="0.55" />

      {/* Tape window frame stroke */}
      <rect x="12.2" y="13.8" width="39.6" height="11.6" rx="2.6" strokeWidth="1.35" />

      {/* Left 6-spoke cassette hub reel */}
      <circle cx={LEFT_HUB_CX} cy={HUB_CY} r="4.3" strokeWidth="1.25" />
      <circle cx={LEFT_HUB_CX} cy={HUB_CY} r="1.85" strokeWidth="1.05" />
      {LEFT_HUB_SPOKES.map(spoke => (
        <line
          key={spoke.key}
          x1={spoke.x1}
          y1={spoke.y1}
          x2={spoke.x2}
          y2={spoke.y2}
          strokeWidth="1.0"
        />
      ))}

      {/* Right 6-spoke cassette hub reel (offset 30deg for mechanical realism) */}
      <circle cx={RIGHT_HUB_CX} cy={HUB_CY} r="4.3" strokeWidth="1.25" />
      <circle cx={RIGHT_HUB_CX} cy={HUB_CY} r="1.85" strokeWidth="1.05" />
      {RIGHT_HUB_SPOKES.map(spoke => (
        <line
          key={spoke.key}
          x1={spoke.x1}
          y1={spoke.y1}
          x2={spoke.x2}
          y2={spoke.y2}
          strokeWidth="1.0"
        />
      ))}

      {/* Bottom signature trapezoidal head-bridge bulge with capstan & guide-pin holes */}
      <path
        d="M 14.0 38.5 L 17.2 30.2 H 46.8 L 50.0 38.5"
        fill={ink}
        fillOpacity="0.1"
        strokeWidth="1.65"
      />
      <circle cx="22" cy="35" r="1.5" strokeWidth="1.2" />
      <circle cx="42" cy="35" r="1.5" strokeWidth="1.2" />
      <circle cx="28.2" cy="33.8" r="1.05" fill={ink} stroke="none" />
      <circle cx="35.8" cy="33.8" r="1.05" fill={ink} stroke="none" />
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
  const standalone = typeof label === 'string' && label.trim().length > 0;
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
      aria-label={standalone ? label.trim() : undefined}
      aria-hidden={standalone ? undefined : true}
    >
      {renderCassetteTapeArtwork()}
    </svg>
  );
}
