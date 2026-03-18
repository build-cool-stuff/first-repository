import MiniSearch, { type SearchResult } from 'minisearch';
import type { Bookmark } from '../models/bookmark';

interface ParsedQuery {
  text: string;
  tags: string[];
}

export class SearchEngine {
  private miniSearch: MiniSearch;

  constructor() {
    this.miniSearch = this.createInstance();
  }

  private createInstance(): MiniSearch {
    return new MiniSearch({
      fields: ['text', 'authorName', 'authorHandle', 'joinedTags'],
      // Only store id — full bookmark data is looked up via the bookmarkMap
      // This reduces MiniSearch memory by ~80% at scale
      storeFields: ['id'],
      searchOptions: {
        boost: { joinedTags: 3, text: 2, authorName: 1.5, authorHandle: 1 },
        fuzzy: 0.2,
        prefix: true,
      },
    });
  }

  buildIndex(bookmarks: Bookmark[]): void {
    this.miniSearch = this.createInstance();

    const docs = bookmarks.map((b) => ({
      ...b,
      joinedTags: b.tags.join(' '),
    }));

    if (docs.length > 0) {
      this.miniSearch.addAll(docs);
    }
  }

  search(query: string, bookmarks: Bookmark[]): SearchResult[] {
    const { text, tags } = this.parseQuery(query);

    // Fix Bug 5: empty search returns all bookmarks sorted by date
    if (text.trim().length === 0 && tags.length === 0) {
      return [...bookmarks]
        .sort(
          (a, b) =>
            new Date(b.bookmarkedAt).getTime() -
            new Date(a.bookmarkedAt).getTime()
        )
        .map((b) => ({
          ...b,
          id: b.id,
          score: 1,
          terms: [],
          queryTerms: [],
          match: {},
        })) as unknown as SearchResult[];
    }

    let filtered = bookmarks;

    if (tags.length > 0) {
      const tagSet = new Set(tags.map((t) => t.toLowerCase()));
      filtered = filtered.filter((b) =>
        [...tagSet].every((tag) =>
          b.tags.some((bt) => bt.toLowerCase() === tag)
        )
      );
    }

    if (text.trim().length === 0) {
      // Tag-only query: return all matching bookmarks sorted by bookmarkedAt desc
      // Fix Bug 6: spread to avoid mutating caller's array
      return [...filtered]
        .sort(
          (a, b) =>
            new Date(b.bookmarkedAt).getTime() -
            new Date(a.bookmarkedAt).getTime()
        )
        .map((b) => ({
          ...b,
          id: b.id,
          score: 1,
          terms: tags,
          queryTerms: tags,
          match: {},
        })) as unknown as SearchResult[];
    }

    // Fix Bug 2: instead of building a temp index, search the main index
    // and then filter results to only include bookmarks that passed tag filter
    if (tags.length > 0) {
      if (this.miniSearch.documentCount === 0) {
        return [];
      }
      const filteredIds = new Set(filtered.map((b) => b.id));
      const results = this.miniSearch.search(text);
      return results.filter((r) => filteredIds.has(String(r.id)));
    }

    // No tag filters, search the full index
    if (this.miniSearch.documentCount === 0) {
      return [];
    }

    return this.miniSearch.search(text);
  }

  // Fix Bug 3: handle duplicate IDs by discarding first
  addBookmark(bookmark: Bookmark): void {
    const doc = {
      ...bookmark,
      joinedTags: bookmark.tags.join(' '),
    };
    try {
      this.miniSearch.discard(bookmark.id);
    } catch {
      // Not in index yet, that's fine
    }
    this.miniSearch.add(doc);
  }

  removeBookmark(id: string): void {
    try {
      this.miniSearch.discard(id);
    } catch {
      // Bookmark may not exist in index; ignore
    }
  }

  private parseQuery(query: string): ParsedQuery {
    const tags: string[] = [];

    // Match tag:"multi word" or tag:singleword
    const tagPattern = /tag:"([^"]+)"|tag:(\S+)/gi;
    let match: RegExpExecArray | null;

    while ((match = tagPattern.exec(query)) !== null) {
      const tag = match[1] ?? match[2];
      if (tag) {
        tags.push(tag);
      }
    }

    const text = query.replace(/tag:"[^"]*"|tag:\S+/gi, '').trim();

    return { text, tags };
  }
}
