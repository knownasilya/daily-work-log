import { addMentionsIfMissing } from '$lib/api/db';

const NAME_CHAR = /[a-zA-Z0-9_.-]/;
const FIRST_NAME_CHAR = /[a-zA-Z0-9_]/;

/** Matches `@username` preceded by start-of-string or whitespace. Used for extraction + rendering. */
export const MENTION_RE = /(^|\s)@([a-zA-Z0-9_][a-zA-Z0-9_.-]*)/g;

export type MentionTrigger = { query: string; startIndex: number } | null;

/**
 * If the caret is currently inside a `@partial` token (with `@` preceded by start
 * or whitespace), returns the token info. Otherwise null. `startIndex` is the
 * position of the `@` character.
 */
export function detectMentionTrigger(value: string, caret: number): MentionTrigger {
  if (caret < 1 || caret > value.length) return null;
  for (let i = caret - 1; i >= 0; i--) {
    const ch = value[i];
    if (ch === '@') {
      const before = i === 0 ? '' : value[i - 1];
      if (i !== 0 && !/\s/.test(before)) return null;
      const query = value.slice(i + 1, caret);
      if (query.length > 0 && !FIRST_NAME_CHAR.test(query[0])) return null;
      for (const c of query) {
        if (!NAME_CHAR.test(c)) return null;
      }
      return { query, startIndex: i };
    }
    if (!NAME_CHAR.test(ch)) return null;
  }
  return null;
}

/** Replaces `@partial` (from startIndex up to caret) with `@username ` and returns new value + caret. */
export function insertMention(
  value: string,
  startIndex: number,
  caret: number,
  username: string
): { value: string; caret: number } {
  const before = value.slice(0, startIndex);
  const after = value.slice(caret);
  const needsSpace = after.length === 0 || !after.startsWith(' ');
  const insertion = `@${username}${needsSpace ? ' ' : ''}`;
  return {
    value: before + insertion + after,
    caret: before.length + insertion.length,
  };
}

/** Extracts all unique `@username` tokens from text. */
export function extractMentions(text: string): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const match of text.matchAll(MENTION_RE)) {
    const name = match[2];
    const key = name.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(name);
  }
  return out;
}

/** Persists any `@username` tokens from `text` that aren't already in the mention list. */
export async function syncMentionsFromText(text: string): Promise<boolean> {
  const found = extractMentions(text);
  if (found.length === 0) return false;
  return addMentionsIfMissing(found);
}
