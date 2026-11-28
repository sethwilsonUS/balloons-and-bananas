import type { CSSProperties } from 'react';
import { balancedColumnCount, compactGridSpans } from '../lib/results-view';
import { positiveThemes } from '../lib/topics';

export { positiveThemes };

export function ThemeShortcutLinks({ topics }: {
  topics: Array<{ name: string; count: number }>;
}) {
  const available = positiveThemes.filter(theme => topics.some(topic => topic.name === theme.topic));
  if (!available.length) return null;
  const columns = balancedColumnCount(available.length, 4);
  const compactSpans = compactGridSpans(available.length);
  const gridStyle = {
    '--theme-cols': String(columns),
  } as CSSProperties;
  return <nav className="theme-shortcuts" aria-label="Browse by theme" style={gridStyle}>
    {available.map((theme, index) => <a key={theme.topic} href={`/search?topic=${encodeURIComponent(theme.topic)}`} className="button secondary theme-shortcut"
      style={{ '--compact-span': String(compactSpans[index]) } as CSSProperties}>
      {theme.label}
    </a>)}
  </nav>;
}

export function TopicLabels({ topics, compact = false }: { topics: string[]; compact?: boolean }) {
  const labels = positiveThemes.filter(theme => topics.includes(theme.topic));
  if (!labels.length) return null;
  const visible = compact ? labels.slice(0, 4) : labels;
  return <ul className={`topic-list${compact ? ' compact-topics' : ''}`} aria-label="Themes">
    {visible.map(theme => <li key={theme.topic}>{theme.label}</li>)}
    {compact && labels.length > visible.length && <li>+{labels.length - visible.length} more</li>}
  </ul>;
}
