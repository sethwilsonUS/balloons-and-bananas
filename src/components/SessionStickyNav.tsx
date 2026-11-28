'use client';

import { useEffect, useRef, useState } from 'react';
import { ArrowLeft } from 'lucide-react';
import {
  DEFAULT_BACK_TO_RESULTS_HREF,
  resolveBackToResultsUrl,
} from '../lib/session-reading';

export default function SessionStickyNav({
  initialBackHref = DEFAULT_BACK_TO_RESULTS_HREF,
}: {
  initialBackHref?: string;
}) {
  const navRef = useRef<HTMLElement>(null);
  const [backHref, setBackHref] = useState(initialBackHref);

  useEffect(() => {
    setBackHref(initialBackHref);
    if (initialBackHref !== DEFAULT_BACK_TO_RESULTS_HREF) return;
    if (typeof document === 'undefined' || !document.referrer) return;
    const fromReferrer = resolveBackToResultsUrl(document.referrer, window.location.origin);
    if (fromReferrer) {
      setBackHref(fromReferrer);
    }
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

  return (
    <nav ref={navRef} className="session-sticky-nav" aria-label="In this session">
      <ul className="session-sticky-nav-list">
        <li><a href="#guide">Guide</a></li>
        <li><a href="#moments">Moments</a></li>
        <li><a href="#transcript">Transcript</a></li>
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
