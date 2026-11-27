import type { CSSProperties } from 'react';
import { Check } from 'lucide-react';
import { balancedColumnCount, compactGridSpans } from '../lib/results-view';

// These shortcuts label existing exact topic filters; they never alter source text.
export const positiveThemes = [
  { label: 'Curiosity', topic: 'Learning and questions' },
  { label: 'Humor', topic: 'Humor and sound play' },
  { label: 'Imagination', topic: 'Play and imagination' },
  { label: 'Connection', topic: 'Affection and comfort' },
  { label: 'Independence', topic: 'Help and independence' },
  { label: 'Music & stories', topic: 'Music and stories' },
  { label: 'Exploring', topic: 'Outings and nature' },
  { label: 'Vision & discovery', topic: 'Vision and access' },
] as const;

export function ThemeShortcuts({ topics, selectedTopic, onSelect }: {
  topics: Array<{ name: string; count: number }>;
  selectedTopic?: string;
  onSelect: (topic: string) => void;
}) {
  const available = positiveThemes.filter(theme => topics.some(topic => topic.name === theme.topic));
  if (!available.length) return null;
  const columns = balancedColumnCount(available.length, 4);
  const compactSpans = compactGridSpans(available.length);
  const gridStyle = {
    '--theme-cols': String(columns),
  } as CSSProperties;
  return <div className="theme-shortcuts" role="group" aria-label="Explore by theme" style={gridStyle}>
    {available.map((theme, index) => <button key={theme.topic} type="button" className="button secondary theme-shortcut"
      style={{ '--compact-span': String(compactSpans[index]) } as CSSProperties}
      aria-pressed={selectedTopic === undefined ? undefined : selectedTopic === theme.topic}
      onClick={() => onSelect(theme.topic)}>
      {selectedTopic === theme.topic && <Check size={15} aria-hidden="true" />}
      {theme.label}
    </button>)}
  </div>;
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
