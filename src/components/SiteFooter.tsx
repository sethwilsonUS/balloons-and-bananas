import { ARCHIVE_NAME } from '../lib/site';
import CassetteReelLogo from './CassetteReelLogo';

export default function SiteFooter() {
  return (
    <footer className="site-footer">
      <div>
        <CassetteReelLogo className="footer-logo" />
        <p>
          {ARCHIVE_NAME}<br />
          <span>An unlisted public archive. Anyone with the link can visit.</span><br />
          <span>Usage analytics exclude search and transcript text.</span>
        </p>
      </div>
      <nav className="footer-links" aria-label="Archive references">
        <a href="/research">Research &amp; context</a>
        <a href="/about">About &amp; methods</a>
      </nav>
    </footer>
  );
}
