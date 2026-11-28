/**
 * Curated theme labels mapping onto exact catalog topic names.
 * Shared between server metadata validation, client URL parsing, and theme UI.
 */
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

const POSITIVE_THEME_SET = new Set<string>(positiveThemes.map(theme => theme.topic));

export function isSelectableThemeTopic(value: string): boolean {
  return POSITIVE_THEME_SET.has(value);
}

/** Return the subset of catalog topics that appear in the curated Theme selector. */
export function selectableTopicSet(topics: ReadonlyArray<{ name: string }>): Set<string> {
  const allowed = new Set<string>();
  for (const item of topics) {
    if (POSITIVE_THEME_SET.has(item.name)) {
      allowed.add(item.name);
    }
  }
  return allowed;
}
