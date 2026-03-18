import type { AppState } from '../models/bookmark';
import * as local from './local';

// ---------------------------------------------------------------------------
// Sync status – reactive object consumers can poll or watch
// ---------------------------------------------------------------------------
export const syncStatus: {
  isSyncing: boolean;
  lastSyncedAt: string | null;
  error: string | null;
} = {
  isSyncing: false,
  lastSyncedAt: null,
  error: null,
};

// ---------------------------------------------------------------------------
// Internal state
// ---------------------------------------------------------------------------
const DRIVE_FILES_URL = 'https://www.googleapis.com/drive/v3/files';
const DRIVE_UPLOAD_URL = 'https://www.googleapis.com/upload/drive/v3/files';

const LS_TOKEN_KEY = 'gdrive_token';
const LS_EXPIRY_KEY = 'gdrive_token_expiry';

let storedClientId: string | null = null;
let autoSyncTimer: ReturnType<typeof setInterval> | null = null;

// ---------------------------------------------------------------------------
// Google OAuth 2.0 (implicit grant – client-side SPA)
// ---------------------------------------------------------------------------

/**
 * Store the Google OAuth client ID for later use.
 * Does NOT trigger any network call.
 */
export function initGoogleAuth(clientId: string): void {
  storedClientId = clientId;

  // If we landed back from the OAuth redirect, try to grab the token from the
  // URL hash right away.
  _parseTokenFromHash();
}

/**
 * Redirect the browser to Google's OAuth consent screen.
 * Uses the implicit grant flow (response_type=token).
 */
export function signIn(): void {
  if (!storedClientId) {
    throw new Error(
      'Google client ID not configured. Call initGoogleAuth(clientId) first.',
    );
  }

  const redirectUri = window.location.origin + window.location.pathname;

  // Fix QA #10: generate state param for CSRF protection
  const oauthState = crypto.randomUUID();
  sessionStorage.setItem('gdrive_oauth_state', oauthState);

  const params = new URLSearchParams({
    client_id: storedClientId,
    redirect_uri: redirectUri,
    response_type: 'token',
    scope: 'https://www.googleapis.com/auth/drive.appdata',
    include_granted_scopes: 'true',
    state: oauthState,
  });

  window.location.href = `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`;
}

/**
 * Clear the stored token and expiry, effectively signing out of Drive sync.
 */
export function signOut(): void {
  localStorage.removeItem(LS_TOKEN_KEY);
  localStorage.removeItem(LS_EXPIRY_KEY);
  stopAutoSync();
  // Fix QA #8: reset sync status on sign-out
  syncStatus.error = null;
  syncStatus.lastSyncedAt = null;
}

/**
 * Returns true when we hold an access token that has not yet expired.
 */
export function isSignedIn(): boolean {
  const token = localStorage.getItem(LS_TOKEN_KEY);
  const expiry = localStorage.getItem(LS_EXPIRY_KEY);
  if (!token || !expiry) return false;
  return Date.now() < Number(expiry);
}

/**
 * Return the current access token, or null if missing / expired.
 */
export function getAccessToken(): string | null {
  if (!isSignedIn()) return null;
  return localStorage.getItem(LS_TOKEN_KEY);
}

// ---------------------------------------------------------------------------
// Internal: parse token from URL hash after OAuth redirect
// ---------------------------------------------------------------------------
function _parseTokenFromHash(): void {
  const hash = window.location.hash;
  if (!hash || !hash.includes('access_token')) return;

  const params = new URLSearchParams(hash.substring(1)); // drop leading '#'

  // Fix QA #10: validate state parameter to prevent CSRF
  const returnedState = params.get('state');
  const expectedState = sessionStorage.getItem('gdrive_oauth_state');
  if (!returnedState || returnedState !== expectedState) {
    // State mismatch — possible CSRF attack, ignore this token
    window.history.replaceState(null, '', window.location.pathname + window.location.search);
    return;
  }
  sessionStorage.removeItem('gdrive_oauth_state');

  const accessToken = params.get('access_token');
  const expiresIn = params.get('expires_in'); // seconds

  if (accessToken && expiresIn) {
    const expiryMs = Date.now() + Number(expiresIn) * 1000;
    localStorage.setItem(LS_TOKEN_KEY, accessToken);
    localStorage.setItem(LS_EXPIRY_KEY, String(expiryMs));
  }

  // Clean the hash so the token doesn't linger in the URL / history
  window.history.replaceState(null, '', window.location.pathname + window.location.search);
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function _authHeaders(): HeadersInit {
  const token = getAccessToken();
  if (!token) throw new Error('Not signed in to Google Drive.');
  return { Authorization: `Bearer ${token}` };
}

/**
 * Wraps fetch and handles 401 (expired / revoked token).
 * Returns the Response on success, or throws on unrecoverable errors.
 */
async function _authedFetch(
  input: RequestInfo | URL,
  init?: RequestInit,
): Promise<Response> {
  const res = await fetch(input, {
    ...init,
    headers: {
      ...(init?.headers ?? {}),
      ..._authHeaders(),
    },
  });

  if (res.status === 401) {
    // Token expired or revoked – clear stored credentials
    signOut();
    throw new Error('Google Drive token expired. Please sign in again.');
  }

  return res;
}

// ---------------------------------------------------------------------------
// Google Drive file operations
// ---------------------------------------------------------------------------

/**
 * Search for `bookmarks.json` inside the hidden appDataFolder.
 * Returns the file ID if found, null otherwise.
 */
export async function findSyncFile(): Promise<string | null> {
  const params = new URLSearchParams({
    spaces: 'appDataFolder',
    q: "name='bookmarks.json'",
    fields: 'files(id,modifiedTime)',
  });

  const res = await _authedFetch(`${DRIVE_FILES_URL}?${params.toString()}`);

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Drive list failed (${res.status}): ${text}`);
  }

  const data = (await res.json()) as { files: { id: string; modifiedTime: string }[] };
  if (data.files && data.files.length > 0) {
    return data.files[0].id;
  }
  return null;
}

/**
 * Download the content of an existing sync file and parse it as AppState.
 */
export async function readSyncFile(fileId: string): Promise<AppState> {
  const res = await _authedFetch(`${DRIVE_FILES_URL}/${fileId}?alt=media`);

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Drive download failed (${res.status}): ${text}`);
  }

  // Fix QA #1: validate parsed JSON structure
  let data: unknown;
  try {
    data = await res.json();
  } catch {
    throw new Error('Remote sync file contains invalid JSON.');
  }

  if (
    typeof data !== 'object' ||
    data === null ||
    !Array.isArray((data as Record<string, unknown>).bookmarks)
  ) {
    throw new Error('Remote sync file has invalid structure (missing bookmarks array).');
  }

  const state = data as AppState;
  // Ensure tags is at least an empty array
  if (!Array.isArray(state.tags)) {
    state.tags = [];
  }
  return state;
}

/**
 * Create a new `bookmarks.json` in the appDataFolder via multipart upload.
 * Returns the newly-created file ID.
 */
export async function createSyncFile(state: AppState): Promise<string> {
  const metadata = {
    name: 'bookmarks.json',
    parents: ['appDataFolder'],
  };

  const boundary = '-----BMSyncBoundary';
  const body =
    `--${boundary}\r\n` +
    `Content-Type: application/json; charset=UTF-8\r\n\r\n` +
    `${JSON.stringify(metadata)}\r\n` +
    `--${boundary}\r\n` +
    `Content-Type: application/json\r\n\r\n` +
    `${JSON.stringify(state)}\r\n` +
    `--${boundary}--`;

  const res = await _authedFetch(
    `${DRIVE_UPLOAD_URL}?uploadType=multipart`,
    {
      method: 'POST',
      headers: {
        'Content-Type': `multipart/related; boundary=${boundary}`,
      },
      body,
    },
  );

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Drive create failed (${res.status}): ${text}`);
  }

  const data = (await res.json()) as { id: string };
  return data.id;
}

/**
 * Overwrite the content of an existing sync file with updated state.
 */
export async function updateSyncFile(
  fileId: string,
  state: AppState,
): Promise<void> {
  const res = await _authedFetch(
    `${DRIVE_UPLOAD_URL}/${fileId}?uploadType=media`,
    {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(state),
    },
  );

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Drive update failed (${res.status}): ${text}`);
  }
}

// ---------------------------------------------------------------------------
// High-level sync operations
// ---------------------------------------------------------------------------

/**
 * Push the current local state up to Google Drive.
 */
export async function syncToCloud(): Promise<void> {
  const state = await local.exportAll();
  const now = new Date().toISOString();
  state.lastSyncedAt = now;

  const fileId = await findSyncFile();
  if (fileId) {
    await updateSyncFile(fileId, state);
  } else {
    await createSyncFile(state);
  }

  await local.setLastSyncedAt(now);
  syncStatus.lastSyncedAt = now;
}

/**
 * Pull remote state from Google Drive and merge into local storage.
 */
export async function syncFromCloud(): Promise<void> {
  const fileId = await findSyncFile();
  if (!fileId) {
    // Nothing stored remotely yet – nothing to pull.
    return;
  }

  const remoteState = await readSyncFile(fileId);
  await local.importAll(remoteState);

  const now = new Date().toISOString();
  await local.setLastSyncedAt(now);
  syncStatus.lastSyncedAt = now;
}

/**
 * Full bidirectional sync:
 * 1. Download remote state
 * 2. Merge remote into local (importAll handles last-write-wins per bookmark)
 * 3. Export the merged local state
 * 4. Upload merged state back to the cloud
 *
 * After this both sides hold identical data.
 */
export async function fullSync(): Promise<void> {
  if (syncStatus.isSyncing) return;
  syncStatus.isSyncing = true;
  syncStatus.error = null;

  if (!isSignedIn()) {
    syncStatus.isSyncing = false;
    syncStatus.error = 'Not signed in to Google Drive.';
    return;
  }

  // Fix Edge #12: use Web Lock to prevent multi-tab concurrent syncs
  const doSync = async () => {
    try {
    // 1. Pull remote
    const fileId = await findSyncFile();
    if (fileId) {
      const remoteState = await readSyncFile(fileId);
      // 2. Merge remote into local
      await local.importAll(remoteState);
    }

    // Fix QA #3: re-check token before push to handle mid-sync expiry
    if (!isSignedIn()) {
      syncStatus.error = 'Token expired during sync. Local data was updated but remote was not. Sign in again to complete sync.';
      return;
    }

    // 3. Export merged local state
    const now = new Date().toISOString();
    const mergedState = await local.exportAll();
    mergedState.lastSyncedAt = now;

    // 4. Upload merged state
    if (fileId) {
      await updateSyncFile(fileId, mergedState);
    } else {
      await createSyncFile(mergedState);
    }

    await local.setLastSyncedAt(now);
    syncStatus.lastSyncedAt = now;
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    syncStatus.error = message;
    throw err;
  } finally {
    syncStatus.isSyncing = false;
  }
  };

  // Use Web Lock if available, otherwise fall back to in-memory guard only
  if (navigator.locks) {
    await navigator.locks.request('gdrive-sync', { ifAvailable: true }, async (lock) => {
      if (!lock) {
        syncStatus.isSyncing = false;
        return; // another tab holds the lock
      }
      await doSync();
    });
  } else {
    await doSync();
  }
}

// ---------------------------------------------------------------------------
// Auto-sync
// ---------------------------------------------------------------------------

/**
 * Start a recurring full sync on the given interval.
 * @param intervalMs  Milliseconds between syncs. Defaults to 30 000 (30 s).
 */
export function startAutoSync(intervalMs: number = 30_000): void {
  stopAutoSync(); // clear any existing timer first
  autoSyncTimer = setInterval(() => {
    fullSync().catch(() => {
      // Error is already captured in syncStatus.error – swallow here to
      // avoid unhandled-rejection noise in the console.
    });
  }, intervalMs);
}

/**
 * Stop the recurring auto-sync if one is running.
 */
export function stopAutoSync(): void {
  if (autoSyncTimer !== null) {
    clearInterval(autoSyncTimer);
    autoSyncTimer = null;
  }
}
