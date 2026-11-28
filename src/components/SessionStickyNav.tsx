'use client';

import { useEffect, useRef, useState } from 'react';
import { ArrowLeft, ArrowRight } from 'lucide-react';
import {
  type AdjacentSessions,
  DEFAULT_BACK_TO_RESULTS_HREF,
  formatAdjacentAgeSummary,
  resolveBackToResultsUrl,
} from '../lib/session-reading';
import { CiteSessionButton } from './CiteControl';

export default function SessionStickyNav({
  initialBackHref = null,
  adjacent = { previous: null, next: null },
}: {
  initialBackHref?: string | null;
  adjacent?: AdjacentSessions;
}) {
  const navRef = useRef<HTMLElement>(null);
  const [backHref, setBackHref] = useState(initialBackHref ?? DEFAULT_BACK_TO_RESULTS_HREF);

  useEffect(() => {
    if (initialBackHref) {
      setBackHref(initialBackHref);
      return;
    }
    if (typeof document !== 'undefined' && document.referrer) {
      const fromReferrer = resolveBackToResultsUrl(document.referrer, window.location.origin);
      if (fromReferrer) {
        setBackHref(fromReferrer);
        return;
      }
    }
    setBackHref(DEFAULT_BACK_TO_RESULTS_HREF);
  }, [initialBackHref]);

  useEffect(() => {
    const element = navRef.current;
    const article = element?.closest<HTMLElement>('.session-page');
    if (!element || !article) return;

    const measure = () => {
      const height = Math.ceil(element.getBoundingClientRect().height);
      article.style.setProperty('--session-nav-height', `${height}px`);
    };

    measure();
    if (typeof ResizeObserver === 'undefined') {
      window.addEventListener('resize', measure);
      return () => {
        window.removeEventListener('resize', measure);
        article.style.removeProperty('--session-nav-height');
      };
    }

    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => {
      observer.disconnect();
      article.style.removeProperty('--session-nav-height');
    };
  }, []);

  const prevSummary = adjacent.previous ? formatAdjacentAgeSummary(adjacent.previous) : null;
  const nextSummary = adjacent.next ? formatAdjacentAgeSummary(adjacent.next) : null;

  return (
    <nav ref={navRef} className="session-sticky-nav" aria-label="In this session">
      <ul className="session-sticky-nav-list">
        <li><a href="#guide">Guide</a></li>
        <li><a href="#moments">Moments</a></li>
        <li><a href="#transcript">Transcript</a></li>
        <li><CiteSessionButton variant="sticky-nav" /></li>
        {adjacent.previous && prevSummary && (
          <li className="session-sticky-nav-step-item">
            <a
              className="session-sticky-nav-step"
              href={`/sessions/${encodeURIComponent(adjacent.previous.slug)}`}
            >
              <ArrowLeft size={14} aria-hidden="true" />
              <span>
                Previous
                <span className="sr-only">
                  {' '}session: {adjacent.previous.slug}, {prevSummary.text}
                </span>
              </span>
            </a>
          </li>
        )}
        {adjacent.next && nextSummary && (
          <li className="session-sticky-nav-step-item">
            <a
              className="session-sticky-nav-step"
              href={`/sessions/${encodeURIComponent(adjacent.next.slug)}`}
            >
              <span>
                Next
                <span className="sr-only">
                  {' '}session: {adjacent.next.slug}, {nextSummary.text}
                </span>
              </span>
              <ArrowRight size={14} aria-hidden="true" />
            </a>
          </li>
        )}
        <li className="session-sticky-nav-back-item">
          <a className="session-sticky-nav-back" href={backHref}>
            <ArrowLeft size={15} aria-hidden="true" />
            Back to results
          </a>
        </li>
      </ul>
    </nav>
  );
}
