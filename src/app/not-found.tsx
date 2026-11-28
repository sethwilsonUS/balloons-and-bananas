import { ArrowRight, BookOpen, Search } from 'lucide-react';
import RouteHeader from '@/components/RouteHeader';
import SiteFooter from '@/components/SiteFooter';
import { ARCHIVE_NAME } from '@/lib/site';

export default function NotFound() {
  return (
    <div className="archive-shell">
      <RouteHeader />
      <main id="main" tabIndex={-1} className="reading-layout">
        <section className="not-found-page reading-column" aria-labelledby="not-found-heading">
          <p className="eyebrow">404 · Not found</p>
          <h1 id="not-found-heading">This archive link could not be found</h1>
          <p className="section-intro">
            No session, research document, or page in {ARCHIVE_NAME} matches this URL; search the collection or browse the research reading list.
          </p>
          <div className="not-found-actions">
            <a className="button primary" href="/search">
              <Search size={17} aria-hidden="true" />
              Search the archive
            </a>
            <a className="button secondary" href="/research">
              <BookOpen size={17} aria-hidden="true" />
              Research &amp; context
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
