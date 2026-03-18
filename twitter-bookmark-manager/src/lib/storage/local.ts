import { openDB, type IDBPDatabase } from 'idb';
import type { Bookmark, AppState } from '../models/bookmark';

const DB_NAME = 'bookmark-manager';
const DB_VERSION = 1;
const BOOKMARKS_STORE = 'bookmarks';
const METADATA_STORE = 'metadata';

// Fix QA #1: singleton promise pattern prevents concurrent initialization race
let dbPromise: Promise<IDBPDatabase> | null = null;

export function getDb(): Promise<IDBPDatabase> {
  if (!dbPromise) {
    dbPromise = openDB(DB_NAME, DB_VERSION, {
      upgrade(db) {
        if (!db.objectStoreNames.contains(BOOKMARKS_STORE)) {
          const bookmarkStore = db.createObjectStore(BOOKMARKS_STORE, { keyPath: 'id' });
          bookmarkStore.createIndex('bookmarkedAt', 'bookmarkedAt');
          bookmarkStore.createIndex('authorHandle', 'authorHandle');
          bookmarkStore.createIndex('isRemoved', 'isRemoved');
        }
        if (!db.objectStoreNames.contains(METADATA_STORE)) {
          db.createObjectStore(METADATA_STORE, { keyPath: 'key' });
        }
      },
    });
  }
  return dbPromise;
}

export async function getAllBookmarks(): Promise<Bookmark[]> {
  const db = await getDb();
  const all = await db.getAll(BOOKMARKS_STORE);
  return (all as Bookmark[])
    .filter((b) => !b.isRemoved)
    .sort((a, b) => new Date(b.bookmarkedAt).getTime() - new Date(a.bookmarkedAt).getTime());
}

export async function getBookmarkById(id: string): Promise<Bookmark | undefined> {
  const db = await getDb();
  return db.get(BOOKMARKS_STORE, id) as Promise<Bookmark | undefined>;
}

export async function saveBookmark(bookmark: Bookmark): Promise<void> {
  const db = await getDb();
  const updated: Bookmark = {
    ...bookmark,
    lastModified: new Date().toISOString(),
  };
  await db.put(BOOKMARKS_STORE, updated);
}

export async function saveBookmarks(bookmarks: Bookmark[]): Promise<void> {
  const db = await getDb();
  const tx = db.transaction(BOOKMARKS_STORE, 'readwrite');
  const now = new Date().toISOString();

  for (const bookmark of bookmarks) {
    const updated: Bookmark = {
      ...bookmark,
      lastModified: now,
    };
    await tx.store.put(updated);
  }

  await tx.done;
}

// Fix QA #7: wrap read-then-write in transaction
export async function removeBookmark(id: string): Promise<void> {
  const db = await getDb();
  const tx = db.transaction(BOOKMARKS_STORE, 'readwrite');
  const bookmark = await tx.store.get(id) as Bookmark | undefined;
  if (!bookmark) {
    await tx.done;
    return;
  }

  const updated: Bookmark = {
    ...bookmark,
    isRemoved: true,
    lastModified: new Date().toISOString(),
  };
  await tx.store.put(updated);
  await tx.done;
}

export async function deleteBookmark(id: string): Promise<void> {
  const db = await getDb();
  await db.delete(BOOKMARKS_STORE, id);
}

export async function getBookmarksByTag(tag: string): Promise<Bookmark[]> {
  const db = await getDb();
  const all = await db.getAll(BOOKMARKS_STORE);
  return (all as Bookmark[])
    .filter((b) => !b.isRemoved && b.tags.includes(tag))
    .sort((a, b) => new Date(b.bookmarkedAt).getTime() - new Date(a.bookmarkedAt).getTime());
}

export async function getAllTags(): Promise<string[]> {
  const db = await getDb();
  const record = await db.get(METADATA_STORE, 'tags');
  return record ? (record.value as string[]) : [];
}

export async function saveTags(tags: string[]): Promise<void> {
  const db = await getDb();
  await db.put(METADATA_STORE, { key: 'tags', value: tags });
}

export async function addTagToBookmark(bookmarkId: string, tag: string): Promise<void> {
  const db = await getDb();
  const tx = db.transaction([BOOKMARKS_STORE, METADATA_STORE], 'readwrite');

  const bookmark = await tx.objectStore(BOOKMARKS_STORE).get(bookmarkId) as Bookmark | undefined;
  if (!bookmark) {
    await tx.done;
    return;
  }

  if (!bookmark.tags.includes(tag)) {
    const updated: Bookmark = {
      ...bookmark,
      tags: [...bookmark.tags, tag],
      lastModified: new Date().toISOString(),
    };
    await tx.objectStore(BOOKMARKS_STORE).put(updated);
  }

  const tagsRecord = await tx.objectStore(METADATA_STORE).get('tags');
  const currentTags: string[] = tagsRecord ? (tagsRecord.value as string[]) : [];
  if (!currentTags.includes(tag)) {
    await tx.objectStore(METADATA_STORE).put({ key: 'tags', value: [...currentTags, tag] });
  }

  await tx.done;
}

// Fix QA #2: wrap in transaction to prevent read-write race
export async function removeTagFromBookmark(bookmarkId: string, tag: string): Promise<void> {
  const db = await getDb();
  const tx = db.transaction(BOOKMARKS_STORE, 'readwrite');
  const bookmark = await tx.store.get(bookmarkId) as Bookmark | undefined;
  if (!bookmark) {
    await tx.done;
    return;
  }

  const updated: Bookmark = {
    ...bookmark,
    tags: bookmark.tags.filter((t) => t !== tag),
    lastModified: new Date().toISOString(),
  };
  await tx.store.put(updated);
  await tx.done;
}

// Fix QA #8: deduplicate bookmark-level tags after rename
export async function renameTag(oldName: string, newName: string): Promise<void> {
  const db = await getDb();
  const tx = db.transaction([BOOKMARKS_STORE, METADATA_STORE], 'readwrite');

  const allBookmarks = await tx.objectStore(BOOKMARKS_STORE).getAll() as Bookmark[];
  const now = new Date().toISOString();

  for (const bookmark of allBookmarks) {
    if (bookmark.tags.includes(oldName)) {
      const renamedTags = bookmark.tags.map((t) => (t === oldName ? newName : t));
      const dedupedTags = [...new Set(renamedTags)];
      const updated: Bookmark = {
        ...bookmark,
        tags: dedupedTags,
        lastModified: now,
      };
      await tx.objectStore(BOOKMARKS_STORE).put(updated);
    }
  }

  const tagsRecord = await tx.objectStore(METADATA_STORE).get('tags');
  const currentTags: string[] = tagsRecord ? (tagsRecord.value as string[]) : [];
  const updatedTags = currentTags.map((t) => (t === oldName ? newName : t));
  const deduped = [...new Set(updatedTags)];
  await tx.objectStore(METADATA_STORE).put({ key: 'tags', value: deduped });

  await tx.done;
}

export async function getLastSyncedAt(): Promise<string | null> {
  const db = await getDb();
  const record = await db.get(METADATA_STORE, 'lastSyncedAt');
  return record ? (record.value as string) : null;
}

export async function setLastSyncedAt(timestamp: string): Promise<void> {
  const db = await getDb();
  await db.put(METADATA_STORE, { key: 'lastSyncedAt', value: timestamp });
}

// Fix QA #6: wrap export in single transaction for consistent snapshot
export async function exportAll(): Promise<AppState> {
  const db = await getDb();
  const tx = db.transaction([BOOKMARKS_STORE, METADATA_STORE], 'readonly');

  const bookmarks = await tx.objectStore(BOOKMARKS_STORE).getAll() as Bookmark[];
  const tagsRecord = await tx.objectStore(METADATA_STORE).get('tags');
  const tags: string[] = tagsRecord ? (tagsRecord.value as string[]) : [];
  const syncRecord = await tx.objectStore(METADATA_STORE).get('lastSyncedAt');
  const lastSyncedAt: string = syncRecord ? (syncRecord.value as string) : '';

  await tx.done;

  return {
    bookmarks,
    tags,
    lastSyncedAt,
    version: DB_VERSION,
  };
}

// Fix QA #9: validate incoming data before merge
function isValidBookmark(b: unknown): b is Bookmark {
  if (typeof b !== 'object' || b === null) return false;
  const obj = b as Record<string, unknown>;
  return (
    typeof obj.id === 'string' &&
    typeof obj.text === 'string' &&
    typeof obj.authorName === 'string' &&
    typeof obj.authorHandle === 'string' &&
    typeof obj.url === 'string' &&
    typeof obj.lastModified === 'string' &&
    !isNaN(new Date(obj.lastModified as string).getTime()) &&
    Array.isArray(obj.tags)
  );
}

export async function importAll(state: AppState): Promise<void> {
  const db = await getDb();
  const tx = db.transaction([BOOKMARKS_STORE, METADATA_STORE], 'readwrite');

  for (const incoming of state.bookmarks) {
    if (!isValidBookmark(incoming)) continue;

    const existing = await tx.objectStore(BOOKMARKS_STORE).get(incoming.id) as Bookmark | undefined;

    if (!existing) {
      await tx.objectStore(BOOKMARKS_STORE).put(incoming);
    } else {
      const existingTime = new Date(existing.lastModified).getTime();
      const incomingTime = new Date(incoming.lastModified).getTime();
      if (incomingTime >= existingTime) {
        await tx.objectStore(BOOKMARKS_STORE).put(incoming);
      }
    }
  }

  const tagsRecord = await tx.objectStore(METADATA_STORE).get('tags');
  const existingTags: string[] = tagsRecord ? (tagsRecord.value as string[]) : [];
  const validTags = (state.tags || []).filter((t) => typeof t === 'string');
  const mergedTags = [...new Set([...existingTags, ...validTags])];
  await tx.objectStore(METADATA_STORE).put({ key: 'tags', value: mergedTags });

  if (state.lastSyncedAt && !isNaN(new Date(state.lastSyncedAt).getTime())) {
    const syncRecord = await tx.objectStore(METADATA_STORE).get('lastSyncedAt');
    const existingSync = syncRecord ? (syncRecord.value as string) : '';
    if (!existingSync || new Date(state.lastSyncedAt).getTime() >= new Date(existingSync).getTime()) {
      await tx.objectStore(METADATA_STORE).put({ key: 'lastSyncedAt', value: state.lastSyncedAt });
    }
  }

  await tx.done;
}

// Fix Manager: add missing 18th function - clearAll for database reset
export async function clearAll(): Promise<void> {
  const db = await getDb();
  const tx = db.transaction([BOOKMARKS_STORE, METADATA_STORE], 'readwrite');
  await tx.objectStore(BOOKMARKS_STORE).clear();
  await tx.objectStore(METADATA_STORE).clear();
  await tx.done;
}
