/**
 * Hand-built SVG cassette-reel mark for The Seth Tapes: two vintage tape reels
 * joined by a strip of magnetic tape along the bottom path. Uses `currentColor`
 * so forest-ink tokens adapt automatically across light, dark, and forced-colors.
 *
 * Omit `label` when paired beside visible brand text (decorative); supply
 * `label` whenever the mark stands alone without adjacent brand text.
 */
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
      viewBox="0 0 40 23"
      width="38"
      height="22"
      fill="none"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      focusable="false"
      role={standalone ? 'img' : undefined}
      aria-label={standalone ? label.trim() : undefined}
      aria-hidden={standalone ? undefined : true}
    >
      {/* Left cassette reel: outer tape pack, spindle hub, and three vintage drive spokes */}
      <circle cx="9" cy="9.25" r="7.75" strokeWidth="1.75" />
      <circle cx="9" cy="9.25" r="2.65" strokeWidth="1.5" />
      <line x1="9" y1="6.6" x2="9" y2="3.5" strokeWidth="1.4" />
      <line x1="11.3" y1="10.58" x2="13.98" y2="12.13" strokeWidth="1.4" />
      <line x1="6.7" y1="10.58" x2="4.02" y2="12.13" strokeWidth="1.4" />

      {/* Right cassette reel */}
      <circle cx="31" cy="9.25" r="7.75" strokeWidth="1.75" />
      <circle cx="31" cy="9.25" r="2.65" strokeWidth="1.5" />
      <line x1="31" y1="11.9" x2="31" y2="15" strokeWidth="1.4" />
      <line x1="33.3" y1="7.92" x2="35.98" y2="6.37" strokeWidth="1.4" />
      <line x1="28.7" y1="7.92" x2="26.02" y2="6.37" strokeWidth="1.4" />

      {/* Connecting strip of magnetic tape along the bottom guide path */}
      <path d="M3.8 15 L9.6 20.25 H30.4 L36.2 15" strokeWidth="1.75" />
    </svg>
  );
}
