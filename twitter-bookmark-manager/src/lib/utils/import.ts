import type { Bookmark } from '../models/bookmark';
import { createBookmark } from '../models/bookmark';

interface TwitterArchiveTweet {
  tweet?: {
    id_str?: string;
    id?: string | number;
    full_text?: string;
    text?: string;
    created_at?: string;
    user?: {
      name?: string;
      screen_name?: string;
      profile_image_url_https?: string;
    };
    entities?: {
      media?: Array<{
        media_url_https?: string;
        media_url?: string;
      }>;
    };
  };
  // Some exports have the tweet data at the top level
  id_str?: string;
  id?: string | number;
  full_text?: string;
  text?: string;
  created_at?: string;
  user?: {
    name?: string;
    screen_name?: string;
    profile_image_url_https?: string;
  };
  entities?: {
    media?: Array<{
      media_url_https?: string;
      media_url?: string;
    }>;
  };
}

function isBookmark(obj: unknown): obj is Bookmark {
  if (typeof obj !== 'object' || obj === null) return false;
  const o = obj as Record<string, unknown>;
  return (
    typeof o.id === 'string' &&
    typeof o.text === 'string' &&
    typeof o.authorName === 'string' &&
    typeof o.authorHandle === 'string' &&
    typeof o.url === 'string' &&
    Array.isArray(o.tags)
  );
}

function parseTweetObject(entry: TwitterArchiveTweet): Bookmark | null {
  try {
    // Twitter archive wraps tweets in a { tweet: { ... } } wrapper sometimes
    const tweet = entry.tweet ?? entry;

    const id = String(tweet.id_str ?? tweet.id ?? '');
    if (!id) return null;

    const text = tweet.full_text ?? tweet.text ?? '';
    if (!text) return null;

    const authorName = tweet.user?.name ?? '';
    const authorHandle = tweet.user?.screen_name ?? '';
    const authorAvatar = tweet.user?.profile_image_url_https ?? '';

    let createdAt: string;
    if (tweet.created_at) {
      const parsed = new Date(tweet.created_at);
      createdAt = isNaN(parsed.getTime())
        ? new Date().toISOString()
        : parsed.toISOString();
    } else {
      createdAt = new Date().toISOString();
    }

    const mediaUrls: string[] = [];
    if (tweet.entities?.media && Array.isArray(tweet.entities.media)) {
      for (const m of tweet.entities.media) {
        const url = m.media_url_https ?? m.media_url;
        if (url) mediaUrls.push(url);
      }
    }

    const url = `https://x.com/${authorHandle}/status/${id}`;

    return createBookmark({
      id,
      text,
      authorName,
      authorHandle,
      authorAvatar,
      createdAt,
      mediaUrls,
      url,
    });
  } catch {
    return null;
  }
}

export function parseTwitterArchive(jsonString: string): Bookmark[] {
  let data: unknown;
  try {
    data = JSON.parse(jsonString);
  } catch {
    return [];
  }

  if (!Array.isArray(data)) {
    return [];
  }

  // Detect format: check the first valid element
  if (data.length === 0) return [];

  // Check if it's our own Bookmark format
  const first = data[0];
  if (isBookmark(first)) {
    // Fix Bug 15: reuse already-parsed data instead of double-parsing
    return deduplicateById(parseBookmarkArray(data));
  }

  // Otherwise treat as Twitter archive format
  const bookmarks: Bookmark[] = [];
  for (const entry of data) {
    const bookmark = parseTweetObject(entry as TwitterArchiveTweet);
    if (bookmark) {
      bookmarks.push(bookmark);
    }
  }

  // Fix Bug 18: deduplicate by ID
  return deduplicateById(bookmarks);
}

function deduplicateById(bookmarks: Bookmark[]): Bookmark[] {
  const seen = new Map<string, Bookmark>();
  for (const b of bookmarks) {
    seen.set(b.id, b);
  }
  return [...seen.values()];
}

function parseBookmarkArray(data: unknown[]): Bookmark[] {
  const bookmarks: Bookmark[] = [];
  for (const entry of data) {
    if (isBookmark(entry)) {
      const b = entry as Bookmark;
      bookmarks.push({
        id: b.id,
        text: b.text,
        authorName: b.authorName,
        authorHandle: b.authorHandle,
        authorAvatar: b.authorAvatar ?? '',
        createdAt: b.createdAt ?? new Date().toISOString(),
        bookmarkedAt: b.bookmarkedAt ?? new Date().toISOString(),
        mediaUrls: Array.isArray(b.mediaUrls) ? b.mediaUrls : [],
        tags: Array.isArray(b.tags) ? b.tags : [],
        url: b.url,
        isRemoved: b.isRemoved ?? false,
        lastModified: b.lastModified ?? new Date().toISOString(),
      });
    }
  }
  return bookmarks;
}

export function parseBookmarkExport(jsonString: string): Bookmark[] {
  let data: unknown;
  try {
    data = JSON.parse(jsonString);
  } catch {
    return [];
  }

  if (!Array.isArray(data)) {
    return [];
  }

  return deduplicateById(parseBookmarkArray(data));
}

export function exportToJson(bookmarks: Bookmark[]): string {
  return JSON.stringify(bookmarks, null, 2);
}
