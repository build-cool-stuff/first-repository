# Twitter Bookmark Manager - Implementation Plan

## Overview
A standalone web app (mobile + desktop) for organizing Twitter/X bookmarks with tags and fuzzy search, synced via cloud storage JSON files.

---

## How Bookmark Data Gets Collected (No API Cost)

The Twitter/X API requires $100/month for bookmark access. We bypass this entirely
with a **passive browser extension** that costs nothing.

### How It Works (Simple Version)

1. You install a small Chrome/Firefox extension
2. You use Twitter normally — browse your timeline, bookmark tweets, check your bookmarks page
3. Behind the scenes, Twitter's website is already loading your bookmark data as JSON
   from its own servers. The extension **listens to those network responses** and quietly
   saves a copy of each bookmark it sees
4. Saved bookmarks go into your browser's local storage (IndexedDB) immediately
5. Every few seconds, changes sync up to a hidden folder in your Google Drive
6. The web app (on any device) reads from that same Google Drive folder

**You never have to "do" anything** — just use Twitter like normal on desktop, and
the extension builds your searchable bookmark database in the background.

### Data Flow Diagram

```
  You browse x.com normally
         │
         ▼
  Twitter's servers send bookmark JSON to your browser (this happens anyway)
         │
         ▼
  Extension intercepts the response (via webRequest / fetch hook)
  Extracts: tweet text, author, media, timestamp, tweet ID
         │
         ▼
  Saves to IndexedDB (instant, local)
         │
         ▼
  Debounced sync to Google Drive appDataFolder (every 5-10 seconds)
         │
         ▼
  Web app on ANY device reads from Google Drive
  (phone, laptop, work computer — anywhere you sign into Google)
```

### What Triggers Data Collection?

| Action you take on Twitter        | What the extension captures                |
|-----------------------------------|--------------------------------------------|
| Open your Bookmarks page          | All visible bookmarks as you scroll        |
| Bookmark a new tweet (click icon) | That specific tweet immediately             |
| Tweet appears in your timeline    | Nothing (only captures bookmarked tweets)   |
| Remove a bookmark                 | Marks it as removed in local DB             |

### What About Mobile?

Browser extensions don't work on mobile browsers. Two fallbacks:

1. **Passive desktop sync**: Bookmark tweets on mobile, then next time you open
   Twitter on desktop, open your Bookmarks page briefly — the extension catches up
   and syncs everything to Google Drive. Your phone's web app then sees the new data.
2. **Manual import**: Drag-and-drop a Twitter data export (JSON) into the web app
   as a one-time bulk import.

### Reference Implementation
[Twillot](https://github.com/twillot-app/twillot) is an open-source project that
does exactly this network interception approach — proven to work.

---

## Architecture

```
┌─────────────────────────────────────────────────┐
│              Web App (PWA)                       │
│  ┌───────────┐  ┌──────────┐  ┌──────────────┐  │
│  │ Search UI │  │ Tag Mgmt │  │ Bookmark List │  │
│  └─────┬─────┘  └────┬─────┘  └──────┬───────┘  │
│        │              │               │          │
│  ┌─────▼──────────────▼───────────────▼───────┐  │
│  │          MiniSearch Index (in-memory)       │  │
│  │   BM25 ranking + fuzzy match + tag filter   │  │
│  └─────────────────┬──────────────────────────┘  │
│                    │                             │
│  ┌─────────────────▼──────────────────────────┐  │
│  │         IndexedDB (local cache)             │  │
│  │   bookmarks[], tags[], search index cache   │  │
│  └─────────────────┬──────────────────────────┘  │
│                    │                             │
│  ┌─────────────────▼──────────────────────────┐  │
│  │    Cloud Sync Layer (Google Drive API)       │  │
│  │    Read/write bookmarks.json to user's Drive │  │
│  └────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────┐
│    Companion Browser Extension (data collector)  │
│  ┌──────────────┐  ┌─────────────────────────┐  │
│  │Content Script│  │ Intercept bookmark data  │  │
│  │on x.com      │──▶ from DOM / network reqs  │  │
│  └──────────────┘  └───────────┬─────────────┘  │
│                                │                 │
│                    Push to IndexedDB / JSON file  │
└─────────────────────────────────────────────────┘
```

---

## Fuzzy Search Strategy

### Primary: MiniSearch
- **5.8KB gzipped** - tiny bundle
- **BM25-like ranking** - best relevance scoring in its class
- Multi-field search with per-field boosting
- Built-in fuzzy matching with configurable edit distance
- Handles 10k bookmarks easily in-memory
- MIT license, actively maintained, 556k weekly npm downloads

### Search Pipeline
```
User types query
       │
       ▼
  Debounce (200ms)
       │
       ▼
  Parse query: separate "tag:xyz" filters from free text
       │
       ▼
  Pre-filter by tags (fast Set lookup)
       │
       ▼
  MiniSearch fuzzy query on filtered set
  - Fields: tweet_text (boost: 2), author_name (boost: 1.5), tags (boost: 3)
  - Fuzzy: edit distance 1 for short terms, 2 for longer
  - Prefix search enabled for search-as-you-type
       │
       ▼
  Return ranked results with highlighted matches
```

### Why MiniSearch over alternatives
| Library    | Size    | Ranking | 10k perf | Why not                          |
|------------|---------|---------|----------|----------------------------------|
| MiniSearch | 5.8KB   | BM25    | Great    | **Our pick**                     |
| FlexSearch | ~6KB    | Custom  | Best     | No BM25, API is less intuitive   |
| Fuse.js    | ~15KB   | Custom  | Good     | Slower, no BM25                  |
| uFuzzy     | ~3KB    | Custom  | Great    | Limited multi-field support       |
| Lunr.js    | ~25KB   | TF-IDF  | Poor     | High memory, no true fuzzy        |

### Index Configuration
```typescript
import MiniSearch from 'minisearch'

const searchIndex = new MiniSearch({
  fields: ['text', 'authorName', 'authorHandle', 'tags'],
  storeFields: ['text', 'authorName', 'authorHandle', 'tags', 'createdAt', 'mediaUrls'],
  searchOptions: {
    boost: { tags: 3, text: 2, authorName: 1.5, authorHandle: 1 },
    fuzzy: 0.2,          // 20% of term length as max edit distance
    prefix: true,         // enable prefix matching for type-ahead
    combineWith: 'AND',   // all terms must match
  },
})
```

---

## Data Model

```typescript
interface Bookmark {
  id: string              // tweet ID
  text: string            // tweet text content
  authorName: string      // display name
  authorHandle: string    // @handle
  authorAvatar: string    // profile image URL
  createdAt: string       // ISO timestamp
  bookmarkedAt: string    // when user bookmarked it
  mediaUrls: string[]     // images/videos
  tags: string[]          // user-assigned tags
  url: string             // link to tweet
}

interface AppState {
  bookmarks: Bookmark[]
  tags: string[]          // all known tags for autocomplete
  lastSyncedAt: string    // ISO timestamp
  version: number         // schema version for migrations
}
```

---

## Storage & Sync

### Local: IndexedDB
- Primary local store via `idb` wrapper (tiny, promise-based)
- Stores full bookmark list + search index cache
- Survives browser restarts, multi-GB capacity

### Cloud: Google Drive API (AppData folder)
- Uses Google Drive's **hidden app data folder** (`appDataFolder` scope)
- User signs in with Google once, app gets its own sandboxed folder
- Reads/writes `bookmarks.json` - invisible to user in Drive UI
- **No Dropbox/iCloud needed** - just Google auth
- Sync strategy:
  1. On app open: fetch remote JSON, merge with local (last-write-wins per bookmark)
  2. On bookmark change: write to local immediately, debounced sync to Drive (5s)
  3. Conflict resolution: `bookmarkedAt` + `lastModified` timestamp comparison

### Why Google Drive AppData
- Free, no storage cost for small JSON files
- Works on mobile + desktop (just needs Google sign-in)
- No server to run
- User's data stays in their own Google account
- Simple REST API, well-documented

---

## Tech Stack

| Layer          | Choice          | Rationale                                    |
|----------------|-----------------|----------------------------------------------|
| Framework      | **SvelteKit**   | Tiny bundles, great DX, PWA-ready, SSG mode  |
| Language       | **TypeScript**  | Type safety for data model                   |
| Search         | **MiniSearch**  | 5.8KB, BM25, fuzzy, multi-field              |
| Styling        | **Tailwind CSS**| Utility-first, responsive, Twitter-like UI   |
| Local Storage  | **idb**         | Tiny IndexedDB wrapper                       |
| Cloud Sync     | **Google Drive API** | Free, no server, appDataFolder          |
| Extension      | **Manifest V3** | Chrome + Firefox compat                      |
| Hosting        | **Vercel/Netlify** | Free tier, static deploy                 |

### Why SvelteKit
- Smallest bundle size of major frameworks (critical for PWA)
- Built-in SSG mode = can deploy as static site
- Great mobile performance
- Twillot (closest existing project) uses Solid.js which is similar philosophy
- No preference expressed → optimize for bundle size + DX

---

## Implementation Phases

### Phase 1: Core Web App (MVP)
1. SvelteKit project setup with TypeScript + Tailwind
2. Data model and IndexedDB storage layer
3. Manual JSON import (drag-and-drop a Twitter archive export)
4. MiniSearch integration with fuzzy search across all fields
5. Tag management UI (add/remove/rename tags, multi-select tagging)
6. Bookmark list with search-as-you-type
7. Responsive layout (mobile-first, works on phone browsers)
8. PWA manifest + service worker for offline access

### Phase 2: Google Drive Sync
1. Google OAuth 2.0 sign-in (client-side only)
2. Read/write to Google Drive appDataFolder
3. Sync on open + debounced sync on changes
4. Conflict resolution (timestamp-based last-write-wins)
5. Sync status indicator in UI

### Phase 3: Companion Browser Extension (Data Collector)
1. Manifest V3 Chrome extension (background service worker + content script on x.com)
2. **Network interception**: hook into fetch/XMLHttpRequest to capture Twitter's
   internal API responses containing bookmark data (no DOM scraping needed)
3. Parse captured responses → extract bookmark fields → write to IndexedDB
4. Detect "bookmark added/removed" actions and capture in real-time
5. Sync captured bookmarks to Google Drive (reuses Phase 2 sync layer)
6. Optional: inject subtle "tagged" indicator on tweets you've tagged in the web app
7. Firefox port (WebExtension API is ~95% compatible)

### Phase 4: Polish
1. Dark mode (match Twitter's theme)
2. Bulk operations (tag multiple bookmarks at once)
3. Sort options (by date bookmarked, by author, by tag count)
4. Bookmark preview cards (show media inline)
5. Export to JSON/CSV
6. Keyboard shortcuts for power users

---

## File Structure
```
twitter-bookmark-manager/
├── src/
│   ├── lib/
│   │   ├── search/
│   │   │   ├── index.ts          # MiniSearch setup and query pipeline
│   │   │   └── highlighter.ts    # Match highlighting for results
│   │   ├── storage/
│   │   │   ├── local.ts          # IndexedDB operations via idb
│   │   │   └── sync.ts           # Google Drive read/write/merge
│   │   ├── models/
│   │   │   └── bookmark.ts       # TypeScript types + validation
│   │   └── utils/
│   │       └── import.ts         # Twitter archive JSON parser
│   ├── routes/
│   │   ├── +layout.svelte        # Shell: nav, search bar, sync status
│   │   ├── +page.svelte          # Main view: search + bookmark list
│   │   ├── tags/
│   │   │   └── +page.svelte      # Tag management view
│   │   └── settings/
│   │       └── +page.svelte      # Import, sync config, export
│   └── app.html
├── extension/                     # Phase 3
│   ├── manifest.json
│   ├── content.ts                 # x.com content script
│   └── background.ts             # Service worker
├── static/
│   └── manifest.json             # PWA manifest
├── svelte.config.js
├── tailwind.config.js
├── tsconfig.json
└── package.json
```

---

## Key Risks & Mitigations

| Risk | Impact | Mitigation |
|------|--------|------------|
| Twitter changes internal API format | Extension breaks | Version-detect response schema, alert user to update extension |
| Google Drive API rate limits | Sync delays | Debounce writes, batch changes, cache aggressively |
| 10k bookmarks slow on mobile | Poor UX | Virtual scrolling (svelte-virtual-list), lazy render |
| Twitter archive format changes | Import breaks | Version-detect archive format, graceful fallback |
| User loses Google access | Data loss | Local IndexedDB always has full copy, manual JSON export available |
