# Twitter Bookmark Manager - Implementation Plan

## Overview
A standalone web app (mobile + desktop) for organizing Twitter/X bookmarks with tags and fuzzy search, synced via cloud storage JSON files.

---

## Critical Decision: How to Get Bookmark Data

The Twitter/X API **requires a paid tier ($100/month Basic)** for bookmark access. Free tier is practically unusable. Three options:

### Option A: Companion Browser Extension (Recommended)
- A lightweight Chrome/Firefox extension that **intercepts bookmark data from twitter.com** as you browse (like Twillot does)
- Extension scrapes bookmark page and pushes data to the web app via shared JSON file
- **No API cost**, no rate limits, gets full tweet data
- Extension is thin - just a data collector. All search/tagging happens in the web app
- Reference: [Twillot](https://github.com/twillot-app/twillot) does exactly this

### Option B: Manual Import
- User exports bookmarks via Twitter's data export (Settings > Your Account > Download Archive)
- User uploads the JSON/CSV to the web app
- Zero cost, but stale data - must re-export periodically

### Option C: Pay for API Access ($100/month)
- Direct Twitter API v2 with OAuth 2.0 PKCE
- GET `/2/users/:id/bookmarks` - 180 requests/15 min, max 800 bookmarks per call
- Cleanest architecture but expensive for a personal tool

**Recommendation**: Option A (companion extension) for desktop + Option B (manual import) as fallback for mobile. This gives live-ish data on desktop and a workable mobile story at zero cost.

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

### Phase 3: Companion Browser Extension
1. Manifest V3 Chrome extension (content script on x.com)
2. Detect bookmarks page, scrape tweet data from DOM
3. "Save to Bookmark Manager" button injected on each tweet
4. Push scraped data to web app via:
   - Shared IndexedDB (same origin via iframe), OR
   - Google Drive sync (extension also writes to Drive)
5. Firefox port (WebExtension API is ~95% compatible)

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
| Twitter changes DOM structure | Extension breaks | Use data attributes / API network interception instead of DOM selectors |
| Google Drive API rate limits | Sync delays | Debounce writes, batch changes, cache aggressively |
| 10k bookmarks slow on mobile | Poor UX | Virtual scrolling (svelte-virtual-list), lazy render |
| Twitter archive format changes | Import breaks | Version-detect archive format, graceful fallback |
| User loses Google access | Data loss | Local IndexedDB always has full copy, manual JSON export available |
