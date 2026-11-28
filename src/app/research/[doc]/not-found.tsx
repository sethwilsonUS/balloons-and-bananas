import { ArrowRight, BookOpen, Search } from 'lucide-react';
import RouteHeader from '@/components/RouteHeader';
import SiteFooter from '@/components/SiteFooter';
import { ARCHIVE_NAME } from '@/lib/site';

export default function ResearchDocumentNotFound() {
  return (
    <div className="archive-shell">
      <RouteHeader activeSection="research" />
      <main id="main" tabIndex={-1}>
        <section className="session-not-found" aria-labelledby="not-found-heading">
          <p className="eyebrow">404 · Document not found</p>
          <h1 id="not-found-heading">This research document could not be found</h1>
          <p className="section-intro">
            No research document in {ARCHIVE_NAME} matches this URL. Browse the research reading list, read about the collection’s methods, or search the sessions.
          </p>
          <div className="not-found-actions">
            <a className="button primary" href="/research">
              <BookOpen size={17} aria-hidden="true" />
              Research &amp; context
            </a>
            <a className="button secondary" href="/?section=sessions">
              <Search size={17} aria-hidden="true" />
              Search sessions
            </a>
            <a className="button secondary" href="/about">
              About &amp; methods
              <ArrowRight size={17} aria-hidden="true" />
            </a>
          </div>
        </section>
      </main>
      <SiteFooter />
    </div>
  );
}
