'use client';

import { useEffect, useId, useRef, useState } from 'react';
import { Check, Share2, X } from 'lucide-react';
import { trackArchiveEvent } from '../lib/analytics';

/**
 * Page-level Share action for `/sessions/[id]`. Copies the canonical session
 * URL (`/sessions/<slug>`, without transient query params or obsolete hashes),
 * announces the result via a polite live region, and degrades to a manual copy
 * field when the Clipboard API is unavailable or denied.
 */
export default function SessionShareButton({ slug }: { slug: string }) {
  const inputId = useId();
  const [state, setState] = useState<'idle' | 'busy' | 'copied'>('idle');
  const [statusMessage, setStatusMessage] = useState('');
  const [manualCopy, setManualCopy] = useState<{ url: string; focusOnOpen: boolean } | null>(null);

  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const manualInputRef = useRef<HTMLInputElement | null>(null);
  const resetTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const requestIdRef = useRef(0);
  const clipboardQueueRef = useRef<Promise<void>>(Promise.resolve());
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      requestIdRef.current += 1;
      if (resetTimerRef.current) {
        clearTimeout(resetTimerRef.current);
        resetTimerRef.current = null;
      }
    };
  }, []);

  // Reset per-session share state when navigating between sessions.
  useEffect(() => {
    requestIdRef.current += 1;
    if (resetTimerRef.current) {
      clearTimeout(resetTimerRef.current);
      resetTimerRef.current = null;
    }
    setState('idle');
    setStatusMessage('');
    setManualCopy(null);
  }, [slug]);

  useEffect(() => {
    if (manualCopy?.focusOnOpen) {
      manualInputRef.current?.focus();
      manualInputRef.current?.select();
    }
  }, [manualCopy]);

  const handleShare = async () => {
    if (typeof window === 'undefined') return;
    const requestId = ++requestIdRef.current;
    const slugSnapshot = slug;
    if (resetTimerRef.current) {
      clearTimeout(resetTimerRef.current);
      resetTimerRef.current = null;
    }

    setState('busy');
    setManualCopy(null);
    setStatusMessage('');

    let url: string;
    try {
      url = new URL(`/sessions/${encodeURIComponent(slugSnapshot)}`, window.location.origin).toString();
    } catch {
      if (!mountedRef.current || requestIdRef.current !== requestId) return;
      setState('idle');
      setStatusMessage('Could not build a link for this session.');
      trackArchiveEvent('share_link', { outcome: 'error' });
      return;
    }

    const executeWrite = async (): Promise<'written' | 'superseded'> => {
      if (!mountedRef.current || requestIdRef.current !== requestId) {
        return 'superseded';
      }
      if (
        typeof navigator === 'undefined'
        || !navigator.clipboard
        || typeof navigator.clipboard.writeText !== 'function'
      ) {
        throw new Error('Clipboard unavailable');
      }
      await navigator.clipboard.writeText(url);
      return 'written';
    };

    const queuedWrite = clipboardQueueRef.current.then(executeWrite, executeWrite);
    clipboardQueueRef.current = queuedWrite.then(() => undefined, () => undefined);

    try {
      const outcome = await queuedWrite;
      if (outcome !== 'written' || !mountedRef.current || requestIdRef.current !== requestId) return;
      setState('copied');
      setStatusMessage(`Copied link to session ${slugSnapshot}.`);
      trackArchiveEvent('share_link', { outcome: 'copied' });
      resetTimerRef.current = setTimeout(() => {
        if (!mountedRef.current || requestIdRef.current !== requestId) return;
        setState('idle');
      }, 4000);
    } catch {
      if (!mountedRef.current || requestIdRef.current !== requestId) return;
      const focusOnOpen = typeof document !== 'undefined'
        && triggerRef.current !== null
        && document.activeElement === triggerRef.current;
      setState('idle');
      setManualCopy({ url, focusOnOpen });
      setStatusMessage(`Could not copy automatically. Select and copy the link to session ${slugSnapshot} below.`);
      trackArchiveEvent('share_link', { outcome: 'manual' });
    }
  };

  return (
    <div className="session-share">
      <button
        ref={triggerRef}
        type="button"
        className="text-button session-share-button"
        aria-disabled={state === 'busy' || undefined}
        onClick={() => {
          if (state === 'busy') return;
          void handleShare();
        }}
      >
        {state === 'copied' ? <Check size={15} aria-hidden="true" /> : <Share2 size={15} aria-hidden="true" />}
        <span>
          {state === 'busy' ? 'Copying…' : state === 'copied' ? 'Link copied' : 'Share'}
          {state !== 'busy' && <span className="sr-only"> link to session {slug}</span>}
        </span>
      </button>
      <span className="sr-only" role="status" aria-live="polite" aria-atomic="true">
        {statusMessage}
      </span>
      {statusMessage && !manualCopy && (
        <p className="small muted session-share-status" aria-hidden="true">
          {statusMessage}
        </p>
      )}
      {manualCopy && (
        <div className="session-share-manual">
          <label htmlFor={inputId}>Link to session {slug}</label>
          <div className="session-share-manual-row">
            <input ref={manualInputRef} id={inputId} value={manualCopy.url} readOnly />
            <button
              type="button"
              className="button secondary"
              onClick={() => {
                requestIdRef.current += 1;
                if (resetTimerRef.current) {
                  clearTimeout(resetTimerRef.current);
                  resetTimerRef.current = null;
                }
                setManualCopy(null);
                setStatusMessage('');
                if (triggerRef.current?.isConnected) {
                  triggerRef.current.focus();
                }
              }}
            >
              <X size={15} aria-hidden="true" />
              <span>Dismiss</span>
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
