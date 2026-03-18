/**
 * Popup script for Twitter/X Bookmark Manager extension.
 * Handles UI interactions, sync triggering, and data export.
 */

const bookmarkCountEl = document.getElementById('bookmark-count');
const lastSyncedEl = document.getElementById('last-synced');
const statusMessageEl = document.getElementById('status-message');
const progressBarEl = document.getElementById('progress-bar');
const progressFillEl = document.getElementById('progress-fill');
const syncBtn = document.getElementById('sync-btn');
const exportBtn = document.getElementById('export-btn');
const authWarningEl = document.getElementById('auth-warning');

let pollInterval = null;

// ========== Format relative time ==========
function timeAgo(isoString) {
  if (!isoString) return 'Never';
  const date = new Date(isoString);
  const now = new Date();
  const diffMs = now - date;
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMs / 3600000);
  const diffDays = Math.floor(diffMs / 86400000);

  if (diffMins < 1) return 'Just now';
  if (diffMins < 60) return `${diffMins}m ago`;
  if (diffHours < 24) return `${diffHours}h ago`;
  return `${diffDays}d ago`;
}

// ========== Update UI with current status ==========
function updateUI(data) {
  const { syncStatus, bookmarkCount, lastSyncedAt } = data;

  bookmarkCountEl.textContent = bookmarkCount.toLocaleString();

  if (lastSyncedAt) {
    lastSyncedEl.textContent = `Last synced: ${timeAgo(lastSyncedAt)}`;
  } else {
    lastSyncedEl.textContent = 'Not synced yet';
  }

  if (syncStatus.inProgress) {
    syncBtn.disabled = true;
    syncBtn.textContent = 'Syncing...';
    progressBarEl.classList.add('active');

    if (syncStatus.total > 0) {
      progressBarEl.classList.remove('indeterminate');
      const pct = Math.min(100, (syncStatus.progress / Math.max(syncStatus.total, 1)) * 100);
      progressFillEl.style.width = `${pct}%`;
    } else {
      progressBarEl.classList.add('indeterminate');
    }

    statusMessageEl.textContent = syncStatus.message;
    statusMessageEl.classList.remove('error');
  } else {
    syncBtn.disabled = false;
    syncBtn.textContent = 'Sync Now';
    progressBarEl.classList.remove('active', 'indeterminate');

    if (syncStatus.lastError) {
      statusMessageEl.textContent = syncStatus.lastError;
      statusMessageEl.classList.add('error');
    } else if (syncStatus.message && syncStatus.message !== 'Idle') {
      statusMessageEl.textContent = syncStatus.message;
      statusMessageEl.classList.remove('error');
    } else {
      statusMessageEl.textContent = '';
    }
  }
}

// ========== Check auth status ==========
function checkAuth() {
  chrome.storage.local.get(['authTokens'], (result) => {
    const tokens = result.authTokens || {};
    if (!tokens.bearerToken || !tokens.csrfToken) {
      authWarningEl.classList.add('visible');
    } else {
      authWarningEl.classList.remove('visible');
    }
  });
}

// ========== Poll for status updates ==========
function startPolling() {
  if (pollInterval) return;
  pollInterval = setInterval(fetchStatus, 1000);
}

function stopPolling() {
  if (pollInterval) {
    clearInterval(pollInterval);
    pollInterval = null;
  }
}

function fetchStatus() {
  chrome.runtime.sendMessage({ type: 'GET_STATUS' }, (response) => {
    if (chrome.runtime.lastError) {
      console.error('[TBM Popup] Error:', chrome.runtime.lastError.message);
      return;
    }
    if (response) {
      updateUI(response);
      if (!response.syncStatus.inProgress) {
        stopPolling();
      }
    }
  });
}

// ========== Sync Now button ==========
syncBtn.addEventListener('click', () => {
  syncBtn.disabled = true;
  syncBtn.textContent = 'Syncing...';
  statusMessageEl.textContent = 'Starting sync...';
  statusMessageEl.classList.remove('error');
  progressBarEl.classList.add('active', 'indeterminate');

  startPolling();

  chrome.runtime.sendMessage({ type: 'TRIGGER_SYNC' }, (response) => {
    if (chrome.runtime.lastError) {
      statusMessageEl.textContent = chrome.runtime.lastError.message;
      statusMessageEl.classList.add('error');
      syncBtn.disabled = false;
      syncBtn.textContent = 'Sync Now';
      progressBarEl.classList.remove('active', 'indeterminate');
      stopPolling();
      return;
    }

    // Final status update
    fetchStatus();
  });
});

// ========== Sync to App button (export) ==========
exportBtn.addEventListener('click', () => {
  exportBtn.disabled = true;
  exportBtn.textContent = 'Exporting...';

  chrome.runtime.sendMessage({ type: 'EXPORT_BOOKMARKS' }, (response) => {
    if (chrome.runtime.lastError) {
      statusMessageEl.textContent = 'Export failed: ' + chrome.runtime.lastError.message;
      statusMessageEl.classList.add('error');
      exportBtn.disabled = false;
      exportBtn.textContent = 'Sync to App';
      return;
    }

    const jsonString = JSON.stringify(response, null, 2);

    // Try clipboard first, fall back to file download
    navigator.clipboard.writeText(jsonString).then(() => {
      statusMessageEl.textContent = `Copied ${response.bookmarks.length} bookmarks to clipboard as JSON`;
      statusMessageEl.classList.remove('error');
      exportBtn.disabled = false;
      exportBtn.textContent = 'Sync to App';
    }).catch(() => {
      // Clipboard failed, use download
      const blob = new Blob([jsonString], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `bookmarks-export-${new Date().toISOString().slice(0, 10)}.json`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);

      statusMessageEl.textContent = `Downloaded ${response.bookmarks.length} bookmarks as JSON`;
      statusMessageEl.classList.remove('error');
      exportBtn.disabled = false;
      exportBtn.textContent = 'Sync to App';
    });
  });
});

// ========== Initialize ==========
checkAuth();
fetchStatus();

// Set app link URL from storage (configurable, defaults to localhost for dev)
const appLinkEl = document.getElementById('app-link');
chrome.storage.local.get(['appUrl'], (result) => {
  appLinkEl.href = result.appUrl || 'http://localhost:5173';
});
