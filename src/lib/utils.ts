export function toYYYYMMDD(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export function formatDatePretty(dateStr: string): string {
  const d = new Date(dateStr + 'T12:00:00');
  return new Intl.DateTimeFormat('en-US', {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    year: 'numeric',
  }).format(d);
}

/**
 * Splits selected markdown into one entry per non-blank line, stripping a leading
 * list marker (`-`, `*`, `+`, or `1.` / `1)`) and any indentation. Lines without a
 * marker are still included (trimmed); blank lines are dropped.
 */
export function parseMarkdownListItems(text: string): string[] {
  return text
    .split('\n')
    .map((line) => line.replace(/^\s*(?:[-*+]|\d+[.)])\s+/, '').trim())
    .filter((line) => line.length > 0);
}

export function isValidDateStr(s: string): boolean {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (!match) return false;
  const [, y, m, d] = match;
  const date = new Date(parseInt(y, 10), parseInt(m, 10) - 1, parseInt(d, 10));
  return (
    date.getFullYear() === parseInt(y, 10) &&
    date.getMonth() === parseInt(m, 10) - 1 &&
    date.getDate() === parseInt(d, 10)
  );
}
