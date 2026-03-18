import type { Bookmark } from '../models/bookmark';
import { SearchEngine } from '../search/index';
import * as storage from '../storage/local';
import { parseTwitterArchive, exportToJson } from '../utils/import';
import type { SearchResult } from 'minisearch';

const searchEngine = new SearchEngine();

let bookmarks = $state<Bookmark[]>([]);
let tags = $state<string[]>([]);
let searchQuery = $state('');
let searchResults = $state<SearchResult[]>([]);
let isLoading = $state(false);

export function getBookmarks(): Bookmark[] {
  return bookmarks;
}

export function getTags(): string[] {
  return tags;
}

export function getSearchQuery(): string {
  return searchQuery;
}

export function getSearchResults(): SearchResult[] {
  return searchResults;
}

export function getIsLoading(): boolean {
  return isLoading;
}

export async function loadBookmarks(): Promise<void> {
  isLoading = true;
  try {
    bookmarks = await storage.getAllBookmarks();
    tags = await storage.getAllTags();
    searchEngine.buildIndex(bookmarks);
    // Initialize search results with all bookmarks
    searchResults = searchEngine.search(searchQuery, bookmarks);
  } finally {
    isLoading = false;
  }
}

export async function addTag(bookmarkId: string, tag: string): Promise<void> {
  await storage.addTagToBookmark(bookmarkId, tag);
  // Update local state
  bookmarks = bookmarks.map((b) =>
    b.id === bookmarkId && !b.tags.includes(tag)
      ? { ...b, tags: [...b.tags, tag] }
      : b
  );
  if (!tags.includes(tag)) {
    tags = [...tags, tag];
  }
  // Rebuild search index with updated bookmarks
  searchEngine.buildIndex(bookmarks);
  searchResults = searchEngine.search(searchQuery, bookmarks);
}

export async function removeTag(bookmarkId: string, tag: string): Promise<void> {
  await storage.removeTagFromBookmark(bookmarkId, tag);
  bookmarks = bookmarks.map((b) =>
    b.id === bookmarkId
      ? { ...b, tags: b.tags.filter((t) => t !== tag) }
      : b
  );
  searchEngine.buildIndex(bookmarks);
  searchResults = searchEngine.search(searchQuery, bookmarks);
}

export async function renameTag(oldName: string, newName: string): Promise<void> {
  if (oldName === newName || !newName.trim()) return;
  await storage.renameTag(oldName, newName);
  bookmarks = bookmarks.map((b) => {
    if (b.tags.includes(oldName)) {
      const renamedTags = b.tags.map((t) => (t === oldName ? newName : t));
      return { ...b, tags: [...new Set(renamedTags)] };
    }
    return b;
  });
  tags = [...new Set(tags.map((t) => (t === oldName ? newName : t)))];
  searchEngine.buildIndex(bookmarks);
  searchResults = searchEngine.search(searchQuery, bookmarks);
}

export async function deleteTag(tag: string): Promise<void> {
  // Batch update: build updated bookmarks and save in one transaction
  const updatedBookmarks = bookmarks
    .filter((b) => b.tags.includes(tag))
    .map((b) => ({ ...b, tags: b.tags.filter((t) => t !== tag), lastModified: new Date().toISOString() }));
  if (updatedBookmarks.length > 0) {
    await storage.saveBookmarks(updatedBookmarks);
  }
  const updatedTags = tags.filter((t) => t !== tag);
  await storage.saveTags(updatedTags);

  // Update local state
  bookmarks = bookmarks.map((b) =>
    b.tags.includes(tag)
      ? { ...b, tags: b.tags.filter((t) => t !== tag) }
      : b
  );
  tags = updatedTags;
  searchEngine.buildIndex(bookmarks);
  searchResults = searchEngine.search(searchQuery, bookmarks);
}

export async function importBookmarks(jsonString: string): Promise<number> {
  const parsed = parseTwitterArchive(jsonString);
  if (parsed.length === 0) return 0;

  // Collect tags from imported bookmarks
  const importedTags: string[] = [];
  for (const b of parsed) {
    for (const t of b.tags) {
      if (!importedTags.includes(t)) importedTags.push(t);
    }
  }

  // Use importAll for smart merge (newer lastModified wins, tags union)
  await storage.importAll({
    bookmarks: parsed,
    tags: importedTags,
    lastSyncedAt: '',
    version: 1,
  });

  await loadBookmarks();
  return parsed.length;
}

export function exportBookmarks(): string {
  return exportToJson(bookmarks);
}

export function performSearch(query: string): void {
  searchQuery = query;
  searchResults = searchEngine.search(query, bookmarks);
}

export async function clearAllData(): Promise<void> {
  await storage.clearAll();
  bookmarks = [];
  tags = [];
  searchQuery = '';
  searchResults = [];
  searchEngine.buildIndex([]);
}
