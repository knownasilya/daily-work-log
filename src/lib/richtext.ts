// Matches [name](url) markdown links first, then bare http(s) URLs.
// Bare URLs exclude ')' so a pasted [n](url) without a markdown match still doesn't grab the trailing paren.
const LINK_RE = /\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)|(https?:\/\/[^\s<>"')]+)/g;

const LINK_CLASS =
  'text-blue-500 dark:text-blue-400 underline underline-offset-2 hover:text-blue-700 dark:hover:text-blue-300 break-all';

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
 * Renders plain text with clickable URLs. Supports `[name](url)` markdown links
 * (only `name` is shown) and bare http(s) URLs. Newlines become <br>.
 * Safe against XSS — non-URL text is HTML-escaped before injection.
 *
 * Anchor elements carry `data-source-length` = length of the original source
 * span, so the offset walker in RichText.svelte can treat them as opaque when
 * mapping click positions back to the raw string.
 */
export function renderText(text: string): string {
  let result = '';
  let lastIndex = 0;

  for (const match of text.matchAll(LINK_RE)) {
    const start = match.index!;
    const source = match[0];
    result += escapeHtml(text.slice(lastIndex, start));

    const mdName = match[1];
    const mdUrl = match[2];
    const url = mdUrl ?? match[3];
    const display = mdName ?? url;
    const safeUrl = encodeUrlAttr(url);

    result += `<a href="#" data-url="${safeUrl}" data-source-length="${source.length}" class="${LINK_CLASS}">${escapeHtml(display)}</a>`;
    lastIndex = start + source.length;
  }

  result += escapeHtml(text.slice(lastIndex));
  return result.replace(/\n/g, '<br>');
}
