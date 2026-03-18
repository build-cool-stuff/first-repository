export interface Bookmark {
  id: string;              // tweet ID
  text: string;            // tweet text content
  authorName: string;      // display name
  authorHandle: string;    // @handle
  authorAvatar: string;    // profile image URL
  createdAt: string;       // ISO timestamp of tweet
  bookmarkedAt: string;    // ISO timestamp when bookmarked
  mediaUrls: string[];     // image/video URLs
  tags: string[];          // user-assigned tags
  url: string;             // link to tweet on x.com
  isRemoved: boolean;      // true if user un-bookmarked
  lastModified: string;    // ISO timestamp for sync conflict resolution
}

export interface AppState {
  bookmarks: Bookmark[];
  tags: string[];          // all known tags for autocomplete
  lastSyncedAt: string;    // ISO timestamp
  version: number;         // schema version for migrations
}

export function createBookmark(
  partial: Partial<Bookmark> & Pick<Bookmark, 'id' | 'text' | 'authorName' | 'authorHandle' | 'url'>
): Bookmark {
  const now = new Date().toISOString();
  return {
    authorAvatar: '',
    createdAt: now,
    bookmarkedAt: now,
    mediaUrls: [],
    tags: [],
    isRemoved: false,
    lastModified: now,
    ...partial,
  };
}
