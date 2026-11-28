'use client';

import { useEffect, useRef, useState } from 'react';
import { Check, Share2, X } from 'lucide-react';
import { trackArchiveEvent } from '../lib/analytics';
import { ARCHIVE_NAME } from '../lib/site';
import ThemeControl from './ThemeControl';

function stripObsoleteAccessHash() {
  if (typeof window === 'undefined') return;
  const hash = window.location.hash;
  if (!hash || !/^#access=/i.test(hash)) return;
  const clean = new URL(window.location.href);
  clean.hash = '';
  window.history.replaceState(window.history.state, '', clean.pathname + clean.search);
}

export default function RouteHeader({
  activeSection,
  sessionCount,
  showShare = false,
  sharePath,
  shareTargetLabel = 'session',
}: {
  activeSection?: 'overview' | 'sessions' | 'search' | 'research' | 'about';
  sessionCount?: number;
  showShare?: boolean;
  sharePath?: string;
  shareTargetLabel?: string;
}) {
  const [shareState, setShareState] = useState<'idle' | 'busy' | 'copied' | 'manual' | 'error'>('idle');
  const [shareUrl, setShareUrl] = useState('');
  const shareInput = useRef<HTMLInputElement>(null);
  const shareRequestIdRef = useRef(0);

  useEffect(() => {
    stripObsoleteAccessHash();
    window.addEventListener('hashchange', stripObsoleteAccessHash);
    return () => {
      shareRequestIdRef.current += 1;
      window.removeEventListener('hashchange', stripObsoleteAccessHash);
    };
  }, []);

  useEffect(() => {
    shareRequestIdRef.current += 1;
    setShareState('idle');
    setShareUrl('');
  }, [sharePath]);

  useEffect(() => {
    if (shareState === 'manual') {
      shareInput.current?.focus();
      shareInput.current?.select();
    }
  }, [shareState]);

  const copyShareLink = async () => {
    const requestId = ++shareRequestIdRef.current;
    setShareState('busy');
    try {
      const targetPath = sharePath || (window.location.pathname + window.location.search);
      const text = new URL(targetPath, window.location.origin).toString();
      try {
        await navigator.clipboard.writeText(text);
        if (shareRequestIdRef.current !== requestId) return;
        setShareUrl(text);
        setShareState('copied');
        trackArchiveEvent('share_link', { outcome: 'copied' });
      } catch {
        if (shareRequestIdRef.current !== requestId) return;
        setShareUrl(text);
        setShareState('manual');
        trackArchiveEvent('share_link', { outcome: 'manual' });
      }
    } catch {
      if (shareRequestIdRef.current !== requestId) return;
      trackArchiveEvent('share_link', { outcome: 'error' });
      setShareState('error');
    }
  };

  return (
    <>
      <a className="skip-link" href="#main">Skip to main content</a>
      <header className="site-header">
        <div className="top-bar">
          <a className="brand-button" href="/" aria-label={`${ARCHIVE_NAME}, collection overview`}>
            <span className="collection-mark" aria-hidden="true"><span /><span /></span>
            <span>{ARCHIVE_NAME}</span>
          </a>
          <span className="unlisted-label">Unlisted archive</span>
          <ThemeControl />
          {showShare && (
            <button
              className="button share-button"
              type="button"
              disabled={shareState === 'busy'}
              onClick={() => void copyShareLink()}
            >
              {shareState === 'copied' ? <Check size={16} aria-hidden="true" /> : <Share2 size={16} aria-hidden="true" />}
              <span>{shareState === 'busy' ? 'Preparing…' : shareState === 'copied' ? 'Link copied' : 'Copy share link'}</span>
            </button>
          )}
        </div>
        {showShare && (
          <div className="share-feedback" role="status">
            {shareState === 'copied'
              ? `Link copied. Anyone can open this ${shareTargetLabel} at its URL.`
              : shareState === 'error'
                ? 'That action could not be completed. Please try again.'
                : ''}
          </div>
        )}
        {showShare && shareState === 'manual' && (
          <div className="manual-share">
            <label htmlFor="share-link">Copy this {shareTargetLabel} link</label>
            <div>
              <input ref={shareInput} id="share-link" value={shareUrl} readOnly />
              <button
                type="button"
                className="button secondary"
                onClick={() => { setShareState('idle'); setShareUrl(''); }}
              >
                <X size={16} aria-hidden="true" />Close
              </button>
            </div>
            <p className="small muted">Anyone can open this {shareTargetLabel} at its URL.</p>
          </div>
        )}
        <nav className="section-nav" aria-label="Collection sections">
          <a href="/" aria-current={activeSection === 'overview' ? 'page' : undefined}>Overview</a>
          <a href="/sessions" aria-current={activeSection === 'sessions' ? 'page' : undefined}>
            Sessions
            {typeof sessionCount === 'number' && (
              <>
                {' '}
                <span className="nav-count">{sessionCount.toLocaleString()}</span>
              </>
            )}
          </a>
          <a href="/search" aria-current={activeSection === 'search' ? 'page' : undefined}>Search</a>
          <a href="/research" aria-current={activeSection === 'research' ? 'page' : undefined}>Research &amp; context</a>
          <a href="/about" aria-current={activeSection === 'about' ? 'page' : undefined}>About &amp; methods</a>
        </nav>
      </header>
    </>
  );
}
