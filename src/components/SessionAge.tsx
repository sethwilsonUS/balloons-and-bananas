import { formatAge, INFERRED_AGE_EXPLANATION_HREF } from '../lib/age';

/**
 * Display a session's age metadata, keeping source ages and filename-inferred
 * ages visually and semantically distinct. Inferred ages always carry a visible
 * italicized label linking to `/about#inferred-ages`.
 */
export default function SessionAge({ ages, inferredAge, showPrefix = true, showChatCode = false }: {
  ages: string[];
  inferredAge: string | null;
  showPrefix?: boolean;
  showChatCode?: boolean;
}) {
  const prefix = showPrefix ? 'Age ' : '';
  if (ages.length > 0) {
    const formatted = ages.map(formatAge).join(' / ');
    return (
      <span>
        {prefix}
        {formatted}
        {showChatCode && <span className="age-notation">{` (${ages.join(' / ')} · source age)`}</span>}
      </span>
    );
  }
  if (!inferredAge) return null;
  return (
    <span className="inferred-age">
      {prefix}
      {formatAge(inferredAge)}
      {showChatCode && <span className="age-notation">{` (${inferredAge})`}</span>}{' '}
      <a
        className="inferred-age-link"
        href={INFERRED_AGE_EXPLANATION_HREF}
      >
        <em>(inferred from filename)</em>
        <span className="sr-only"> — learn how ages are inferred</span>
      </a>
    </span>
  );
}
