/**
 * Content script for Twitter/X bookmark interception.
 * Injected at document_start to intercept fetch and XHR before the page uses them.
 * Captures auth tokens and bookmark data from Twitter's internal API calls.
 */

// --- Inject into the page context via a script element ---
// Content scripts run in an isolated world; we need to intercept fetch/XHR
// in the page's own JS context, then relay messages back via window.postMessage.

const injectedScript = document.createElement('script');
injectedScript.textContent = `(${function pageContextInterceptor() {
  // ========== Fetch interception ==========
  const originalFetch = window.fetch;
  window.fetch = async function (...args) {
    const response = await originalFetch.apply(this, args);

    const url = typeof args[0] === 'string' ? args[0] : args[0]?.url;
    if (!url) return response;

    // Capture bookmark timeline data
    if (url.includes('/graphql/') && url.includes('Bookmarks') && !url.includes('Create') && !url.includes('Delete')) {
      try {
        const cloned = response.clone();
        const data = await cloned.json();
        window.postMessage({ source: 'tbm-interceptor', type: 'BOOKMARKS_DATA', data, url }, '*');
      } catch (e) { /* ignore parse errors */ }

      // Also capture the queryId and features from the URL for later direct fetching
      try {
        const urlObj = new URL(url);
        const pathParts = urlObj.pathname.split('/');
        const graphqlIdx = pathParts.indexOf('graphql');
        if (graphqlIdx !== -1 && pathParts[graphqlIdx + 1]) {
          const queryId = pathParts[graphqlIdx + 1];
          const featuresParam = urlObj.searchParams.get('features');
          const features = featuresParam ? JSON.parse(featuresParam) : null;
          window.postMessage({
            source: 'tbm-interceptor',
            type: 'BOOKMARKS_QUERY_INFO',
            queryId,
            features,
          }, '*');
        }
      } catch (e) { /* ignore */ }
    }

    // Capture auth tokens from request headers
    if (url.includes('x.com/i/api') || url.includes('twitter.com/i/api')) {
      const headers = args[1]?.headers;
      if (headers) {
        const authInfo = {};
        // Headers can be a plain object, Headers instance, or array of pairs
        if (headers instanceof Headers) {
          if (headers.has('x-csrf-token')) authInfo.csrfToken = headers.get('x-csrf-token');
          if (headers.has('authorization')) authInfo.bearerToken = headers.get('authorization');
        } else if (typeof headers === 'object' && !Array.isArray(headers)) {
          if (headers['x-csrf-token']) authInfo.csrfToken = headers['x-csrf-token'];
          if (headers['authorization']) authInfo.bearerToken = headers['authorization'];
        }
        if (Object.keys(authInfo).length > 0) {
          window.postMessage({ source: 'tbm-interceptor', type: 'AUTH_TOKENS', tokens: authInfo }, '*');
        }
      }
    }

    // Detect bookmark/unbookmark actions
    if (url.includes('/graphql/') && (url.includes('CreateBookmark') || url.includes('DeleteBookmark'))) {
      window.postMessage({
        source: 'tbm-interceptor',
        type: 'BOOKMARK_ACTION',
        url,
        action: url.includes('Create') ? 'add' : 'remove',
      }, '*');
    }

    return response;
  };

  // ========== XMLHttpRequest interception ==========
  const originalXHROpen = XMLHttpRequest.prototype.open;
  const originalXHRSend = XMLHttpRequest.prototype.send;
  const originalXHRSetHeader = XMLHttpRequest.prototype.setRequestHeader;

  XMLHttpRequest.prototype.open = function (method, url, ...rest) {
    this._tbmUrl = url;
    this._tbmHeaders = {};
    return originalXHROpen.call(this, method, url, ...rest);
  };

  XMLHttpRequest.prototype.setRequestHeader = function (name, value) {
    if (this._tbmHeaders) {
      this._tbmHeaders[name.toLowerCase()] = value;
    }
    return originalXHRSetHeader.call(this, name, value);
  };

  XMLHttpRequest.prototype.send = function (...args) {
    const url = this._tbmUrl;
    const headers = this._tbmHeaders;

    // Capture auth tokens
    if (url && (url.includes('x.com/i/api') || url.includes('twitter.com/i/api'))) {
      const authInfo = {};
      if (headers['x-csrf-token']) authInfo.csrfToken = headers['x-csrf-token'];
      if (headers['authorization']) authInfo.bearerToken = headers['authorization'];
      if (Object.keys(authInfo).length > 0) {
        window.postMessage({ source: 'tbm-interceptor', type: 'AUTH_TOKENS', tokens: authInfo }, '*');
      }
    }

    // Listen for bookmark data in XHR responses
    if (url && url.includes('/graphql/') && url.includes('Bookmarks')) {
      this.addEventListener('load', function () {
        try {
          const data = JSON.parse(this.responseText);
          window.postMessage({ source: 'tbm-interceptor', type: 'BOOKMARKS_DATA', data, url }, '*');
        } catch (e) { /* ignore */ }
      });
    }

    return originalXHRSend.apply(this, args);
  };
}.toString()})();`;

// Inject as early as possible
(document.head || document.documentElement).appendChild(injectedScript);
injectedScript.remove();

// ========== Listen for messages from the injected page-context script ==========
window.addEventListener('message', (event) => {
  if (event.source !== window) return;
  if (!event.data || event.data.source !== 'tbm-interceptor') return;

  // Forward to background script
  chrome.runtime.sendMessage(event.data).catch(() => {
    // Background script may not be ready yet; ignore
  });
});

// ========== Extract csrf token from cookies ==========
function extractCsrfFromCookies() {
  try {
    const cookies = document.cookie.split(';');
    for (const cookie of cookies) {
      const [name, ...valueParts] = cookie.trim().split('=');
      if (name === 'ct0') {
        const csrfToken = valueParts.join('=');
        if (csrfToken) {
          chrome.runtime.sendMessage({
            source: 'tbm-interceptor',
            type: 'AUTH_TOKENS',
            tokens: { csrfToken },
          }).catch(() => {});
        }
        break;
      }
    }
  } catch (e) { /* ignore */ }
}

// Extract csrf token once the page is loaded, and periodically
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', extractCsrfFromCookies);
} else {
  extractCsrfFromCookies();
}
setInterval(extractCsrfFromCookies, 30000);
