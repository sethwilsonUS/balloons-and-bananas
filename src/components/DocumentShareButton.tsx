'use client';

import { useEffect, useId, useRef, useState } from 'react';
import { Check, Share2, X } from 'lucide-react';
import { trackArchiveEvent } from '../lib/analytics';

type ShareStatus = 'idle' | 'busy' | 'copied' | 'manual' | 'error';

export default function DocumentShareButton({
  documentId,
  sharePath,
}: {
  documentId: string;
  sharePath: string;
}) {
  const inputId = useId();
  const [status, setStatus] = useState<ShareStatus>('idle');
  const [shareUrl, setShareUrl] = useState('');
  const [announcement, setAnnouncement] = useState('');
  const [focusManualOnOpen, setFocusManualOnOpen] = useState(false);

  const buttonRef = useRef<HTMLButtonElement | null>(null);
  const manualInputRef = useRef<HTMLInputElement | null>(null);
  const requestIdRef = useRef(0);
  const resetTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
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

  useEffect(() => {
    requestIdRef.current += 1;
    if (resetTimerRef.current) {
      clearTimeout(resetTimerRef.current);
      resetTimerRef.current = null;
    }
    setStatus('idle');
    setShareUrl('');
    setAnnouncement('');
    setFocusManualOnOpen(false);
  }, [documentId, sharePath]);

  useEffect(() => {
    if (
      status === 'manual'
      && focusManualOnOpen
      && typeof document !== 'undefined'
      && buttonRef.current !== null
      && document.activeElement === buttonRef.current
    ) {
      manualInputRef.current?.focus();
      manualInputRef.current?.select();
    }
  }, [status, focusManualOnOpen, shareUrl]);

  const clearResetTimer = () => {
    if (resetTimerRef.current) {
      clearTimeout(resetTimerRef.current);
      resetTimerRef.current = null;
    }
  };

  const handleShare = async () => {
    const requestId = ++requestIdRef.current;
    clearResetTimer();
    setStatus('busy');
    setAnnouncement('');
    setFocusManualOnOpen(false);

    let resolvedUrl: string;
    try {
      const targetPath = sharePath || (window.location.pathname + window.location.search);
      resolvedUrl = new URL(targetPath, window.location.origin).toString();
    } catch {
      if (!mountedRef.current || requestIdRef.current !== requestId) return;
      setStatus('error');
      setAnnouncement('Could not prepare the document link. Please try again.');
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
      await navigator.clipboard.writeText(resolvedUrl);
      return 'written';
    };

    const queuedWrite = clipboardQueueRef.current.then(executeWrite, executeWrite);
    clipboardQueueRef.current = queuedWrite.then(() => undefined, () => undefined);

    try {
      const outcome = await queuedWrite;
      if (outcome !== 'written' || !mountedRef.current || requestIdRef.current !== requestId) return;
      setShareUrl(resolvedUrl);
      setStatus('copied');
      setAnnouncement('Link copied. Anyone with the link can open this document.');
      trackArchiveEvent('share_link', { outcome: 'copied' });
      resetTimerRef.current = setTimeout(() => {
        if (!mountedRef.current || requestIdRef.current !== requestId) return;
        setStatus(current => (current === 'copied' ? 'idle' : current));
      }, 4000);
    } catch {
      if (!mountedRef.current || requestIdRef.current !== requestId) return;
      const shouldFocus = typeof document !== 'undefined'
        && buttonRef.current !== null
        && document.activeElement === buttonRef.current;
      setShareUrl(resolvedUrl);
      setFocusManualOnOpen(shouldFocus);
      setStatus('manual');
      setAnnouncement('Could not copy automatically. Select and copy the document link below.');
      trackArchiveEvent('share_link', { outcome: 'manual' });
    }
  };

  const handleDismissManual = () => {
    requestIdRef.current += 1;
    clearResetTimer();
    setStatus('idle');
    setShareUrl('');
    setAnnouncement('');
    setFocusManualOnOpen(false);
    if (buttonRef.current?.isConnected) {
      buttonRef.current.focus();
    }
  };

  const buttonLabel = status === 'busy'
    ? 'Preparing…'
    : status === 'copied'
      ? 'Link copied'
      : 'Share';

  return (
    <div className="document-share">
      <button
        ref={buttonRef}
        type="button"
        className="button secondary document-share-button"
        aria-busy={status === 'busy' || undefined}
        onClick={() => void handleShare()}
      >
        {status === 'copied' ? <Check size={16} aria-hidden="true" /> : <Share2 size={16} aria-hidden="true" />}
        <span>{buttonLabel}</span>
      </button>

      <p className="sr-only" role="status" aria-live="polite" aria-atomic="true">
        {announcement}
      </p>
      {announcement && (
        <p className="small muted document-share-status" aria-hidden="true">
          {announcement}
        </p>
      )}

      {status === 'manual' && (
        <div className="document-share-manual">
          <label htmlFor={inputId}>Copy this document link</label>
          <div className="document-share-manual-row">
            <input ref={manualInputRef} id={inputId} value={shareUrl} readOnly />
            <button
              type="button"
              className="button secondary"
              onClick={handleDismissManual}
            >
              <X size={16} aria-hidden="true" />
              <span>Dismiss</span>
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
