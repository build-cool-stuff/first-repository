import { openDB, type IDBPDatabase } from 'idb';
import type { Bookmark, AppState } from '../models/bookmark';

const DB_NAME = 'bookmark-manager';
const DB_VERSION = 1;
const BOOKMARKS_STORE = 'bookmarks';
const METADATA_STORE = 'metadata';

let dbInstance: IDBPDatabase | null = null;

export async function getDb(): Promise<IDBPDatabase> {
  if (dbInstance) return dbInstance;

  dbInstance = await openDB(DB_NAME, DB_VERSION, {
    upgrade(db) {
      // Create bookmarks store with indexes
      if (!db.objectStoreNames.contains(BOOKMARKS_STORE)) {
        const bookmarkStore = db.createObjectStore(BOOKMARKS_STORE, { keyPath: 'id' });
        bookmarkStore.createIndex('bookmarkedAt', 'bookmarkedAt');
        bookmarkStore.createIndex('authorHandle', 'authorHandle');
        bookmarkStore.createIndex('isRemoved', 'isRemoved');
      }

      // Create metadata store
      if (!db.objectStoreNames.contains(METADATA_STORE)) {
        db.createObjectStore(METADATA_STORE, { keyPath: 'key' });
      }
    },
  });

  return dbInstance;
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

export async function removeBookmark(id: string): Promise<void> {
  const db = await getDb();
  const bookmark = await db.get(BOOKMARKS_STORE, id) as Bookmark | undefined;
  if (!bookmark) return;

  const updated: Bookmark = {
    ...bookmark,
    isRemoved: true,
    lastModified: new Date().toISOString(),
  };
  await db.put(BOOKMARKS_STORE, updated);
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

  // Update bookmark
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

  // Update global tags list if new
  const tagsRecord = await tx.objectStore(METADATA_STORE).get('tags');
  const currentTags: string[] = tagsRecord ? (tagsRecord.value as string[]) : [];
  if (!currentTags.includes(tag)) {
    await tx.objectStore(METADATA_STORE).put({ key: 'tags', value: [...currentTags, tag] });
  }

  await tx.done;
}

export async function removeTagFromBookmark(bookmarkId: string, tag: string): Promise<void> {
  const db = await getDb();
  const bookmark = await db.get(BOOKMARKS_STORE, bookmarkId) as Bookmark | undefined;
  if (!bookmark) return;

  const updated: Bookmark = {
    ...bookmark,
    tags: bookmark.tags.filter((t) => t !== tag),
    lastModified: new Date().toISOString(),
  };
  await db.put(BOOKMARKS_STORE, updated);
}

export async function renameTag(oldName: string, newName: string): Promise<void> {
  const db = await getDb();
  const tx = db.transaction([BOOKMARKS_STORE, METADATA_STORE], 'readwrite');

  // Update all bookmarks that have this tag
  const allBookmarks = await tx.objectStore(BOOKMARKS_STORE).getAll() as Bookmark[];
  const now = new Date().toISOString();

  for (const bookmark of allBookmarks) {
    if (bookmark.tags.includes(oldName)) {
      const updated: Bookmark = {
        ...bookmark,
        tags: bookmark.tags.map((t) => (t === oldName ? newName : t)),
        lastModified: now,
      };
      await tx.objectStore(BOOKMARKS_STORE).put(updated);
    }
  }

  // Update global tags list
  const tagsRecord = await tx.objectStore(METADATA_STORE).get('tags');
  const currentTags: string[] = tagsRecord ? (tagsRecord.value as string[]) : [];
  const updatedTags = currentTags.map((t) => (t === oldName ? newName : t));
  // Deduplicate in case newName already existed
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

export async function exportAll(): Promise<AppState> {
  const db = await getDb();
  const bookmarks = await db.getAll(BOOKMARKS_STORE) as Bookmark[];
  const tags = await getAllTags();
  const lastSyncedAt = (await getLastSyncedAt()) || '';

  return {
    bookmarks,
    tags,
    lastSyncedAt,
    version: DB_VERSION,
  };
}

export async function importAll(state: AppState): Promise<void> {
  const db = await getDb();
  const tx = db.transaction([BOOKMARKS_STORE, METADATA_STORE], 'readwrite');

  // Smart merge bookmarks by id - newer lastModified wins
  for (const incoming of state.bookmarks) {
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

  // Merge tags - union of existing and incoming
  const tagsRecord = await tx.objectStore(METADATA_STORE).get('tags');
  const existingTags: string[] = tagsRecord ? (tagsRecord.value as string[]) : [];
  const mergedTags = [...new Set([...existingTags, ...state.tags])];
  await tx.objectStore(METADATA_STORE).put({ key: 'tags', value: mergedTags });

  // Update lastSyncedAt if incoming is newer
  if (state.lastSyncedAt) {
    const syncRecord = await tx.objectStore(METADATA_STORE).get('lastSyncedAt');
    const existingSync = syncRecord ? (syncRecord.value as string) : '';
    if (!existingSync || new Date(state.lastSyncedAt).getTime() >= new Date(existingSync).getTime()) {
      await tx.objectStore(METADATA_STORE).put({ key: 'lastSyncedAt', value: state.lastSyncedAt });
    }
  }

  await tx.done;
}
