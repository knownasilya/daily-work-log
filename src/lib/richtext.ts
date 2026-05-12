// Matches [name](url) markdown links, bare http(s) URLs, and @username mentions.
// Bare URLs exclude ')' so a pasted [n](url) without a markdown match still doesn't grab the trailing paren.
// Mentions require start-of-string or whitespace before `@` — captured so it's preserved in output.
const TOKEN_RE =
  /\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)|(https?:\/\/[^\s<>"')]+)|(^|\s)@([a-zA-Z0-9_][a-zA-Z0-9_.-]*)/g;

const LINK_CLASS =
  'text-blue-500 dark:text-blue-400 underline underline-offset-2 hover:text-blue-700 dark:hover:text-blue-300 break-all';

const MENTION_CLASS = 'text-blue-600 dark:text-blue-400 font-medium';

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function encodeUrlAttr(url: string): string {
  return url.replace(/"/g, '%22').replace(/</g, '%3C').replace(/>/g, '%3E');
}

/**
 * Renders plain text with clickable URLs and @mentions. Supports `[name](url)` markdown links
 * (only `name` is shown), bare http(s) URLs, and `@username` tokens. Newlines become <br>.
 * Safe against XSS — non-token text is HTML-escaped before injection.
 *
 * Anchor + mention spans carry `data-source-length` = length of the original source span,
 * so the offset walker in RichText.svelte can treat them as opaque when mapping click
 * positions back to the raw string.
 */
export function renderText(text: string): string {
  let result = '';
  let lastIndex = 0;

  for (const match of text.matchAll(TOKEN_RE)) {
    const start = match.index!;
    const source = match[0];
    result += escapeHtml(text.slice(lastIndex, start));

    const mdName = match[1];
    const mdUrl = match[2];
    const bareUrl = match[3];
    const leadingWs = match[4];
    const mentionName = match[5];

    if (mentionName !== undefined) {
      result += escapeHtml(leadingWs ?? '');
      const mentionSource = `@${mentionName}`;
      result += `<span data-source-length="${mentionSource.length}" class="${MENTION_CLASS}">@${escapeHtml(mentionName)}</span>`;
    } else {
      const url = mdUrl ?? bareUrl!;
      const display = mdName ?? url;
      const safeUrl = encodeUrlAttr(url);
      result += `<a href="#" data-url="${safeUrl}" data-source-length="${source.length}" class="${LINK_CLASS}">${escapeHtml(display)}</a>`;
    }
    lastIndex = start + source.length;
  }

  result += escapeHtml(text.slice(lastIndex));
  return result.replace(/\n/g, '<br>');
}
