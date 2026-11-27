/**
 * Display a CHAT age without changing the stored value or inventing precision.
 * CHAT writes years;months.days. Explicit zero fields stay visible; omitted
 * fields stay omitted. Unrecognized values remain available verbatim.
 */
export function formatAge(age: string): string {
  const match = /^(\d+);(?:(\d{1,2})(?:\.(\d{1,2})?)?)?$/.exec(age.trim());
  if (!match) return age;
  const years = Number(match[1]);
  const months = match[2] === undefined ? undefined : Number(match[2]);
  const days = match[3] === undefined ? undefined : Number(match[3]);
  if (!Number.isSafeInteger(years) || (months !== undefined && months > 11) || (days !== undefined && days > 31)) return age;
  const label = (value: number, unit: string) => `${value} ${unit}${value === 1 ? '' : 's'}`;
  return [label(years, 'year'), ...(months === undefined ? [] : [label(months, 'month')]), ...(days === undefined ? [] : [label(days, 'day')])].join(', ');
}
