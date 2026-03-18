function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function highlightMatches(text: string, terms: string[]): string {
  if (!terms || terms.length === 0) {
    return escapeHtml(text);
  }

  const escaped = escapeHtml(text);

  // Build a single regex matching any of the terms (case-insensitive)
  const validTerms = terms
    .filter((t) => t.length > 0)
    .map(escapeRegExp);

  if (validTerms.length === 0) {
    return escaped;
  }

  const pattern = new RegExp(`(${validTerms.join('|')})`, 'gi');

  return escaped.replace(pattern, '<mark>$1</mark>');
}
