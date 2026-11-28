import { ArrowRight, Search } from 'lucide-react';
import RouteHeader from '@/components/RouteHeader';
import SiteFooter from '@/components/SiteFooter';
import { ARCHIVE_NAME } from '@/lib/site';

export default function SessionNotFound() {
  return (
    <div className="archive-shell">
      <RouteHeader activeSection="sessions" />
      <main id="main" tabIndex={-1}>
        <section className="session-not-found" aria-labelledby="not-found-heading">
          <p className="eyebrow">404 · Session not found</p>
          <h1 id="not-found-heading">This session could not be found</h1>
          <p className="section-intro">
            No session in {ARCHIVE_NAME} matches this URL. Check the session ID, or search the collection to find the session you need.
          </p>
          <div className="not-found-actions">
            <a className="button primary" href="/search">
              <Search size={17} aria-hidden="true" />
              Search sessions
            </a>
            <a className="button secondary" href="/">
              Collection overview
              <ArrowRight size={17} aria-hidden="true" />
            </a>
          </div>
        </section>
      </main>
      <SiteFooter />
    </div>
  );
}
