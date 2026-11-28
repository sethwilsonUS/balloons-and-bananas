'use client';

import {
  createContext,
  type KeyboardEvent,
  type MouseEvent,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from 'react';
import { Check, Copy, Quote, X } from 'lucide-react';
import {
  buildSessionCitations,
  CITATION_FORMAT_LABELS,
  CITATION_FORMATS,
  CORPUS_DOI_ID,
  CORPUS_TALKBANK_PAGE_URL,
  formatLocalCalendarDateIso,
  type CitationFormat,
  type CitationSessionInput,
  type SessionCitations,
} from '../lib/citations';
import { transcriptOriginLabels } from './api';

type CiteTarget =
  | { kind: 'session' }
  | { kind: 'passage'; passageNumber: number };

interface SessionCiteContextValue {
  session: CitationSessionInput;
  openSessionCite: (trigger: HTMLElement | null) => void;
  openPassageCite: (passageNumber: number, trigger: HTMLElement | null) => void;
}

const SessionCiteContext = createContext<SessionCiteContextValue | null>(null);

export function useSessionCite(): SessionCiteContextValue | null {
  return useContext(SessionCiteContext);
}

/**
 * Shared format tabs (Chicago, APA, BibTeX) + copy control + polite live region
 * + manual-copy fallback. Reused in both the Cite dialog and `/about`'s
 * `<HowToCiteSection />`.
 */
export function CitationPanel({
  citations,
  targetKey,
  subjectPhrase,
}: {
  citations: SessionCitations;
  targetKey: string;
  subjectPhrase: string;
}) {
  const idPrefix = useId();
  const [activeFormat, setActiveFormat] = useState<CitationFormat>('chicago');
  const [copied, setCopied] = useState<{ targetKey: string; format: CitationFormat } | null>(null);
  const [manualCopy, setManualCopy] = useState<{
    targetKey: string;
    format: CitationFormat;
    text: string;
    focusOnOpen: boolean;
  } | null>(null);
  const [statusMessage, setStatusMessage] = useState('');

  const tabRefs = useRef<Record<CitationFormat, HTMLButtonElement | null>>({
    chicago: null,
    apa: null,
    bibtex: null,
  });
  const copyButtonRefs = useRef<Record<CitationFormat, HTMLButtonElement | null>>({
    chicago: null,
    apa: null,
    bibtex: null,
  });
  const manualTextareaRef = useRef<HTMLTextAreaElement | null>(null);
  const copyTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const copyRequestIdRef = useRef(0);
  const clipboardQueueRef = useRef<Promise<void>>(Promise.resolve());
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      copyRequestIdRef.current += 1;
      if (copyTimerRef.current) {
        clearTimeout(copyTimerRef.current);
        copyTimerRef.current = null;
      }
    };
  }, []);

  // Reset per-target state and cancel pending copy timers/completions on entity change.
  useEffect(() => {
    copyRequestIdRef.current += 1;
    if (copyTimerRef.current) {
      clearTimeout(copyTimerRef.current);
      copyTimerRef.current = null;
    }
    setCopied(null);
    setManualCopy(null);
    setStatusMessage('');
  }, [targetKey]);

  const showManualCopy = manualCopy !== null
    && manualCopy.targetKey === targetKey
    && manualCopy.format === activeFormat;

  useEffect(() => {
    if (showManualCopy && manualCopy?.focusOnOpen) {
      manualTextareaRef.current?.focus();
      manualTextareaRef.current?.select();
    }
  }, [showManualCopy, manualCopy]);

  const selectFormat = useCallback((nextFormat: CitationFormat, focusTab = false) => {
    if (nextFormat !== activeFormat) {
      copyRequestIdRef.current += 1;
      if (copyTimerRef.current) {
        clearTimeout(copyTimerRef.current);
        copyTimerRef.current = null;
      }
      setActiveFormat(nextFormat);
      setCopied(null);
      setManualCopy(null);
      setStatusMessage('');
    }
    if (focusTab) {
      tabRefs.current[nextFormat]?.focus();
    }
  }, [activeFormat]);

  const handleTabKeyDown = (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
    let nextIndex: number | null = null;
    if (event.key === 'ArrowRight' || event.key === 'ArrowDown') {
      nextIndex = (index + 1) % CITATION_FORMATS.length;
    } else if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') {
      nextIndex = (index - 1 + CITATION_FORMATS.length) % CITATION_FORMATS.length;
    } else if (event.key === 'Home') {
      nextIndex = 0;
    } else if (event.key === 'End') {
      nextIndex = CITATION_FORMATS.length - 1;
    }
    if (nextIndex === null) return;
    event.preventDefault();
    selectFormat(CITATION_FORMATS[nextIndex], true);
  };

  const copyCitation = async (formatSnapshot: CitationFormat) => {
    const requestId = ++copyRequestIdRef.current;
    const targetSnapshot = targetKey;
    const labelSnapshot = CITATION_FORMAT_LABELS[formatSnapshot];
    const textSnapshot = citations[formatSnapshot];

    setCopied(null);
    setManualCopy(null);
    setStatusMessage('');
    if (copyTimerRef.current) {
      clearTimeout(copyTimerRef.current);
      copyTimerRef.current = null;
    }

    // Serialize clipboard writes so overlapping copy requests never write an older
    // format after a newer format and leave the clipboard out of sync with the UI.
    const executeWrite = async (): Promise<'written' | 'superseded'> => {
      if (!mountedRef.current || copyRequestIdRef.current !== requestId) {
        return 'superseded';
      }
      if (
        typeof navigator === 'undefined'
        || !navigator.clipboard
        || typeof navigator.clipboard.writeText !== 'function'
      ) {
        throw new Error('Clipboard unavailable');
      }
      await navigator.clipboard.writeText(textSnapshot);
      return 'written';
    };

    const queuedWrite = clipboardQueueRef.current.then(executeWrite, executeWrite);
    clipboardQueueRef.current = queuedWrite.then(() => undefined, () => undefined);

    try {
      const outcome = await queuedWrite;
      if (outcome !== 'written' || !mountedRef.current || copyRequestIdRef.current !== requestId) return;

      setCopied({ targetKey: targetSnapshot, format: formatSnapshot });
      setStatusMessage(`Copied ${labelSnapshot} citation for ${subjectPhrase}.`);
      copyTimerRef.current = setTimeout(() => {
        if (!mountedRef.current || copyRequestIdRef.current !== requestId) return;
        setCopied(current => (
          current?.targetKey === targetSnapshot && current.format === formatSnapshot ? null : current
        ));
      }, 4000);
    } catch {
      if (!mountedRef.current || copyRequestIdRef.current !== requestId) return;
      const initiatingButton = copyButtonRefs.current[formatSnapshot];
      const focusOnOpen = typeof document !== 'undefined'
        && initiatingButton !== null
        && document.activeElement === initiatingButton;
      setCopied(null);
      setManualCopy({ targetKey: targetSnapshot, format: formatSnapshot, text: textSnapshot, focusOnOpen });
      setStatusMessage(`Could not copy automatically. Select and copy the ${labelSnapshot} citation below.`);
    }
  };

  return (
    <div className="cite-panel">
      <div className="cite-tablist" role="tablist" aria-label="Citation format">
        {CITATION_FORMATS.map((format, index) => {
          const selected = activeFormat === format;
          return (
            <button
              key={format}
              ref={node => { tabRefs.current[format] = node; }}
              type="button"
              role="tab"
              id={`${idPrefix}-tab-${format}`}
              aria-selected={selected}
              aria-controls={`${idPrefix}-panel-${format}`}
              tabIndex={selected ? 0 : -1}
              className="button secondary cite-tab"
              onClick={() => selectFormat(format)}
              onKeyDown={event => handleTabKeyDown(event, index)}
            >
              {CITATION_FORMAT_LABELS[format]}
            </button>
          );
        })}
      </div>

      {CITATION_FORMATS.map(format => {
        const isActive = activeFormat === format;
        const text = citations[format];
        const formatLabel = CITATION_FORMAT_LABELS[format];
        const isCopied = copied !== null && copied.targetKey === targetKey && copied.format === format;
        return (
          <div
            key={format}
            role="tabpanel"
            id={`${idPrefix}-panel-${format}`}
            aria-labelledby={`${idPrefix}-tab-${format}`}
            tabIndex={0}
            hidden={!isActive}
            className="cite-tabpanel"
          >
            {format === 'bibtex' ? (
              <pre className="cite-preview-code"><code>{text}</code></pre>
            ) : (
              <p className="cite-preview-text">{text}</p>
            )}

            <div className="cite-panel-actions">
              <button
                ref={node => { copyButtonRefs.current[format] = node; }}
                type="button"
                className="button primary cite-copy-button"
                onClick={() => void copyCitation(format)}
              >
                {isCopied ? <Check size={16} aria-hidden="true" /> : <Copy size={16} aria-hidden="true" />}
                <span>{isCopied ? `Copied ${formatLabel} citation` : `Copy ${formatLabel} citation`}</span>
              </button>
              {format === 'bibtex' && (
                <>
                  {' '}
                  <span className="small muted cite-bibtex-key">
                    Key: <code>{citations.bibtexKey}</code>
                  </span>
                </>
              )}
            </div>
          </div>
        );
      })}

      <p
        className="sr-only"
        role="status"
        aria-live="polite"
        aria-atomic="true"
      >
        {statusMessage}
      </p>
      {statusMessage && (
        <p className="small muted cite-live-status" aria-hidden="true">
          {statusMessage}
        </p>
      )}

      {showManualCopy && manualCopy && (
        <div className="cite-manual-copy">
          <label htmlFor={`${idPrefix}-manual`}>
            {CITATION_FORMAT_LABELS[manualCopy.format]} citation (select and copy)
          </label>
          <textarea
            ref={manualTextareaRef}
            id={`${idPrefix}-manual`}
            value={manualCopy.text}
            readOnly
            rows={manualCopy.format === 'bibtex' ? 10 : 4}
          />
          <button
            type="button"
            className="button secondary"
            onClick={() => {
              const returnTarget = copyButtonRefs.current[activeFormat];
              setManualCopy(null);
              if (returnTarget && returnTarget.isConnected) {
                returnTarget.focus();
              }
            }}
          >
            <X size={16} aria-hidden="true" />
            Dismiss
          </button>
        </div>
      )}
    </div>
  );
}

function CiteDialog({
  session,
  target,
  origin,
  accessDate,
  onClose,
}: {
  session: CitationSessionInput;
  target: CiteTarget;
  origin: string | null;
  accessDate: string;
  onClose: () => void;
}) {
  const dialogRef = useRef<HTMLDialogElement | null>(null);
  const headingRef = useRef<HTMLHeadingElement | null>(null);
  const closingRef = useRef(false);
  const headingId = useId();
  const descriptionId = useId();

  const passageNumber = target.kind === 'passage' ? target.passageNumber : null;
  const citations = useMemo(
    () => buildSessionCitations(session, { passageNumber, origin, accessDate }),
    [session, passageNumber, origin, accessDate],
  );

  const targetKey = passageNumber === null
    ? `${session.slug}::session`
    : `${session.slug}::p${passageNumber}`;
  const subjectPhrase = passageNumber === null
    ? `session ${session.slug}`
    : `session ${session.slug}, passage ${passageNumber}`;

  const closeDialog = useCallback(() => {
    if (closingRef.current) return;
    closingRef.current = true;
    const dialog = dialogRef.current;
    if (dialog?.open) {
      dialog.close();
    }
    onClose();
  }, [onClose]);

  useEffect(() => {
    closingRef.current = false;
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (!dialog.open) {
      if (typeof dialog.showModal === 'function') {
        dialog.showModal();
      } else {
        dialog.setAttribute('open', '');
      }
    }
    headingRef.current?.focus();
    // Do not call dialog.close() in mount-effect cleanup: in React Strict Mode,
    // a cleanup close queues a native `close` event after the second setup reopens
    // the dialog, which would immediately dismiss it. Real unmounts remove the
    // `<dialog>` element from the DOM and top layer automatically.
  }, []);

  const handleBackdropClick = (event: MouseEvent<HTMLDialogElement>) => {
    if (event.target === dialogRef.current) {
      closeDialog();
    }
  };

  return (
    <dialog
      ref={dialogRef}
      className="cite-dialog"
      aria-labelledby={headingId}
      aria-describedby={descriptionId}
      onCancel={event => {
        event.preventDefault();
        closeDialog();
      }}
      onClose={() => {
        if (closingRef.current || dialogRef.current?.open) {
          return;
        }
        onClose();
      }}
      onClick={handleBackdropClick}
    >
      <div className="cite-dialog-surface">
        <div className="cite-dialog-header">
          <h2 id={headingId} ref={headingRef} tabIndex={-1}>
            {passageNumber === null
              ? `Cite session ${session.slug}`
              : `Cite session ${session.slug}, passage ${passageNumber}`}
          </h2>
          <button
            type="button"
            className="button secondary cite-dialog-close"
            onClick={closeDialog}
          >
            <X size={16} aria-hidden="true" />
            <span>Close</span>
          </button>
        </div>

        <div id={descriptionId} className="cite-provenance">
          <div className="cite-provenance-badges">
            <span className={`origin-badge ${session.origin}`}>
              {transcriptOriginLabels[session.origin]}
            </span>
            {citations.isAiDraft && (
              <>
                <span className="sr-only">. </span>
                <span className="small muted">Machine transcription, unreviewed</span>
              </>
            )}
            {citations.ageIsInferred && citations.ageLabel && (
              <>
                <span className="sr-only">. </span>
                <span className="small muted">Age inferred from filename</span>
              </>
            )}
            <span className="sr-only">. </span>
          </div>
          <p className="small muted">
            Citations identify the source transcript and credit the Peters/Wilson corpus
            (TalkBank, DOI <code>{CORPUS_DOI_ID}</code>). AI-written guide text is never cited as speech.
            {citations.isAiDraft
              ? ' Because this transcript is an unreviewed machine draft, check the recording before treating wording as evidence.'
              : ''}
          </p>
        </div>

        <CitationPanel
          citations={citations}
          targetKey={targetKey}
          subjectPhrase={subjectPhrase}
        />

        <p className="small muted cite-corpus-note">
          TalkBank also asks publications using corpus data to cite Peters (1987) and/or Wilson &amp; Peters (1988).{' '}
          <a
            href={CORPUS_TALKBANK_PAGE_URL}
            target="_blank"
            rel="noopener noreferrer nofollow"
            referrerPolicy="no-referrer"
          >
            Corpus page on TalkBank
            <span className="sr-only"> (opens in a new tab)</span>
          </a>
        </p>
      </div>
    </dialog>
  );
}

/**
 * Provides one shared, lazily mounted accessible Cite dialog per session view
 * so catalog record, sticky nav, and hundreds of passages never duplicate DOM trees.
 */
export function SessionCiteProvider({
  session,
  initialOrigin = null,
  pinnedAccessDate,
  children,
}: {
  session: CitationSessionInput;
  initialOrigin?: string | null;
  pinnedAccessDate?: string;
  children: ReactNode;
}) {
  const [openState, setOpenState] = useState<{
    target: CiteTarget;
    origin: string | null;
    accessDate: string;
  } | null>(null);
  const triggerRef = useRef<HTMLElement | null>(null);

  // Close and clear trigger if the provider switches to a different session.
  useEffect(() => {
    setOpenState(null);
    triggerRef.current = null;
  }, [session.slug]);

  const openForTarget = useCallback((target: CiteTarget, trigger: HTMLElement | null) => {
    triggerRef.current = trigger;
    const resolvedOrigin = typeof window !== 'undefined' && window.location.origin
      ? window.location.origin
      : initialOrigin;
    const resolvedAccessDate = pinnedAccessDate ?? formatLocalCalendarDateIso();
    setOpenState({ target, origin: resolvedOrigin, accessDate: resolvedAccessDate });
  }, [initialOrigin, pinnedAccessDate]);

  const openSessionCite = useCallback((trigger: HTMLElement | null) => {
    openForTarget({ kind: 'session' }, trigger);
  }, [openForTarget]);

  const openPassageCite = useCallback((passageNumber: number, trigger: HTMLElement | null) => {
    openForTarget({ kind: 'passage', passageNumber }, trigger);
  }, [openForTarget]);

  const handleClose = useCallback(() => {
    setOpenState(null);
    const trigger = triggerRef.current;
    triggerRef.current = null;
    if (trigger && trigger.isConnected) {
      trigger.focus();
    }
  }, []);

  const contextValue = useMemo<SessionCiteContextValue>(
    () => ({ session, openSessionCite, openPassageCite }),
    [session, openSessionCite, openPassageCite],
  );

  return (
    <SessionCiteContext.Provider value={contextValue}>
      {children}
      {openState && (
        <CiteDialog
          session={session}
          target={openState.target}
          origin={openState.origin}
          accessDate={openState.accessDate}
          onClose={handleClose}
        />
      )}
    </SessionCiteContext.Provider>
  );
}

/** Cite trigger for the session catalog record or sticky "In this session" nav. */
export function CiteSessionButton({
  session,
  variant = 'catalog',
  initialOrigin = null,
  pinnedAccessDate,
}: {
  session?: CitationSessionInput;
  variant?: 'catalog' | 'sticky-nav';
  initialOrigin?: string | null;
  pinnedAccessDate?: string;
}) {
  const ctx = useSessionCite();
  const [standaloneState, setStandaloneState] = useState<{
    origin: string | null;
    accessDate: string;
  } | null>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    setStandaloneState(null);
    triggerRef.current = null;
  }, [session?.slug]);

  if (!ctx && !session) return null;

  const handleClick = (event: MouseEvent<HTMLButtonElement>) => {
    if (ctx) {
      ctx.openSessionCite(event.currentTarget);
      return;
    }
    triggerRef.current = event.currentTarget;
    const resolvedOrigin = typeof window !== 'undefined' && window.location.origin
      ? window.location.origin
      : initialOrigin;
    const resolvedAccessDate = pinnedAccessDate ?? formatLocalCalendarDateIso();
    setStandaloneState({ origin: resolvedOrigin, accessDate: resolvedAccessDate });
  };

  const handleStandaloneClose = () => {
    setStandaloneState(null);
    const trigger = triggerRef.current;
    triggerRef.current = null;
    if (trigger && trigger.isConnected) {
      trigger.focus();
    }
  };

  const button = variant === 'sticky-nav' ? (
    <button
      type="button"
      className="text-button session-sticky-nav-cite"
      aria-haspopup="dialog"
      onClick={handleClick}
    >
      <Quote size={14} aria-hidden="true" />
      <span>Cite<span className="sr-only"> this session</span></span>
    </button>
  ) : (
    <button
      type="button"
      className="text-button cite-catalog-button"
      aria-haspopup="dialog"
      onClick={handleClick}
    >
      <Quote size={15} aria-hidden="true" />
      <span>Cite this session</span>
    </button>
  );

  return (
    <>
      {button}
      {!ctx && session && standaloneState && (
        <CiteDialog
          session={session}
          target={{ kind: 'session' }}
          origin={standaloneState.origin}
          accessDate={standaloneState.accessDate}
          onClose={handleStandaloneClose}
        />
      )}
    </>
  );
}

/** Cite trigger rendered inside each numbered transcript passage's actions. */
export function CitePassageButton({ passageNumber }: { passageNumber: number }) {
  const ctx = useSessionCite();
  if (!ctx) return null;

  return (
    <button
      type="button"
      className="text-button passage-cite-button"
      aria-haspopup="dialog"
      aria-label={`Cite passage ${passageNumber}`}
      onClick={event => ctx.openPassageCite(passageNumber, event.currentTarget)}
    >
      <Quote size={14} aria-hidden="true" />
      <span>Cite</span>
    </button>
  );
}
