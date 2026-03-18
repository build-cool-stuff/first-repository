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

  // Fix Bug 8: escape terms for HTML entities before matching against escaped text
  const validTerms = terms
    .filter((t) => t.length > 0)
    .map((t) => escapeRegExp(escapeHtml(t)));

  if (validTerms.length === 0) {
    return escapeHtml(text);
  }

  const escaped = escapeHtml(text);

  // Fix Bug 12: sort terms by length descending so longer matches take priority
  validTerms.sort((a, b) => b.length - a.length);

  const pattern = new RegExp(`(${validTerms.join('|')})`, 'gi');

  return escaped.replace(pattern, '<mark>$1</mark>');
}
