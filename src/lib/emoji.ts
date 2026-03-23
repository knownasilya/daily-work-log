import type { EmojiRule } from '$lib/api/db';

export function formatLineForSlack(
  entry: { content: string; emoji_id: string | null },
  rules: EmojiRule[]
): string {
  const rule = entry.emoji_id
    ? rules.find((r) => r.id === entry.emoji_id)
    : null;
  const prefix = rule ? `:${rule.text}: ` : '';
  return prefix + entry.content;
}

/** Parse pattern field: JSON array of strings, or legacy single pattern. */
export function parsePatterns(pattern: string): string[] {
  const trimmed = pattern.trim();
  if (!trimmed) return [];
  if (trimmed.startsWith('[')) {
    try {
      const arr = JSON.parse(trimmed) as unknown;
      return Array.isArray(arr) ? arr.filter((p): p is string => typeof p === 'string') : [trimmed];
    } catch {
      return [trimmed];
    }
  }
  return [trimmed];
}

/** Check if content matches pattern. Pattern can be plain text (substring, case-sensitive) or regex in /..../ format. */
export function patternMatches(content: string, pattern: string): boolean {
  const trimmed = pattern.trim();
  if (!trimmed) return false;

  // Regex format: /pattern/
  const regexMatch = /^\/(.*)\/$/.exec(trimmed);
  if (regexMatch) {
    try {
      return new RegExp(regexMatch[1]).test(content);
    } catch {
      return false;
    }
  }

  // Plain text: case-sensitive substring match
  return content.includes(trimmed);
}

/** Check if content matches any of the rule's patterns (OR logic). */
function ruleMatchesContent(content: string, rule: EmojiRule): boolean {
  const patterns = parsePatterns(rule.pattern);
  return patterns.some((p) => patternMatches(content, p));
}

export function tryAutoAssignEmoji(
  content: string,
  rules: EmojiRule[]
): string | null {
  for (const rule of rules) {
    if (ruleMatchesContent(content, rule)) {
      return rule.id;
    }
  }
  return null;
}
