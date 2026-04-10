const URL_RE = /https?:\/\/[^\s<>"']+/g;

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * Renders plain text with clickable URLs. Newlines become <br>.
 * Safe against XSS — non-URL text is HTML-escaped before injection.
 */
export function renderText(text: string): string {
  let result = '';
  let lastIndex = 0;

  for (const match of text.matchAll(URL_RE)) {
    const url = match[0];
    const start = match.index!;
    // Escape the plain-text segment before this URL
    result += escapeHtml(text.slice(lastIndex, start));
    // Encode the URL for safe use in an attribute (only encode quotes/angle brackets)
    const safeUrl = url.replace(/"/g, '%22').replace(/</g, '%3C').replace(/>/g, '%3E');
    result += `<a href="#" data-url="${safeUrl}" class="text-blue-500 dark:text-blue-400 underline underline-offset-2 hover:text-blue-700 dark:hover:text-blue-300 break-all">${escapeHtml(url)}</a>`;
    lastIndex = start + url.length;
  }

  result += escapeHtml(text.slice(lastIndex));
  return result.replace(/\n/g, '<br>');
}
