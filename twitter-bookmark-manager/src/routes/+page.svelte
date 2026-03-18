<script lang="ts">
  import {
    getBookmarks,
    getTags,
    getSearchQuery,
    getSearchResults,
    getIsLoading,
    performSearch,
    addTag,
    removeTag,
  } from '$lib/stores/app.svelte';
  import { highlightMatches } from '$lib/search/highlighter';
  import { page } from '$app/stores';

  let inputValue = $state('');
  let debounceTimer = $state<ReturnType<typeof setTimeout> | null>(null);
  let tagPickerOpenFor = $state<string | null>(null);
  let newTagInput = $state('');

  // Read tag filter from URL query params
  let lastTagParam = $state('');
  $effect(() => {
    const unsub = page.subscribe((p) => {
      const t = p.url.searchParams.get('tag') ?? '';
      // Only react when the tag param actually changes
      if (t !== lastTagParam) {
        lastTagParam = t;
        if (t) {
          inputValue = `tag:${t.includes(' ') ? `"${t}"` : t}`;
          performSearch(inputValue);
        }
      }
    });
    return unsub;
  });

  // Fix: clean up debounce timer on unmount
  $effect(() => {
    return () => {
      if (debounceTimer) clearTimeout(debounceTimer);
    };
  });

  function handleSearchInput(e: Event) {
    const target = e.target as HTMLInputElement;
    inputValue = target.value;

    if (debounceTimer) clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => {
      performSearch(inputValue);
    }, 200);
  }

  function clearSearch() {
    inputValue = '';
    performSearch('');
  }

  function toggleTagPicker(bookmarkId: string) {
    if (tagPickerOpenFor === bookmarkId) {
      tagPickerOpenFor = null;
      newTagInput = '';
    } else {
      tagPickerOpenFor = bookmarkId;
      newTagInput = '';
    }
  }

  async function handleToggleTag(bookmarkId: string, tag: string, hasTag: boolean) {
    if (hasTag) {
      await removeTag(bookmarkId, tag);
    } else {
      await addTag(bookmarkId, tag);
    }
  }

  async function handleAddNewTag(bookmarkId: string) {
    const tag = newTagInput.trim();
    if (!tag) return;
    await addTag(bookmarkId, tag);
    newTagInput = '';
  }

  function handleNewTagKeydown(e: KeyboardEvent, bookmarkId: string) {
    if (e.key === 'Enter') {
      e.preventDefault();
      handleAddNewTag(bookmarkId);
    }
  }

  function formatDate(iso: string): string {
    try {
      const date = new Date(iso);
      return date.toLocaleDateString('en-US', {
        month: 'short',
        day: 'numeric',
        year: 'numeric',
      });
    } catch {
      return iso;
    }
  }

  function getAvatarFallback(name: string): string {
    return name.charAt(0).toUpperCase() || '?';
  }

  // Fix Edge #7: precompute bookmark map to avoid O(n^2) find() per render
  function getBookmarkMap(): Map<string, typeof getBookmarks extends () => (infer T)[] ? T : never> {
    const map = new Map();
    for (const b of getBookmarks()) {
      map.set(b.id, b);
    }
    return map;
  }

  // Fix Edge #7/10: pagination instead of rendering all 10k results
  const PAGE_SIZE = 50;
  let visibleCount = $state(PAGE_SIZE);

  function loadMore() {
    visibleCount += PAGE_SIZE;
  }

  // Reset pagination when search changes
  $effect(() => {
    getSearchQuery(); // track dependency
    visibleCount = PAGE_SIZE;
  });
</script>

<div class="space-y-4">
  <!-- Search bar -->
  <div class="relative">
    <div class="absolute inset-y-0 left-0 flex items-center pl-4 pointer-events-none">
      <svg class="w-5 h-5 text-tw-text-secondary" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="2">
        <path stroke-linecap="round" stroke-linejoin="round" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"/>
      </svg>
    </div>
    <input
      type="text"
      class="input-field pl-12 pr-10"
      placeholder="Search bookmarks... (use tag:name to filter by tag)"
      value={inputValue}
      oninput={handleSearchInput}
      aria-label="Search bookmarks"
    />
    {#if inputValue}
      <button
        class="absolute inset-y-0 right-0 flex items-center pr-4 text-tw-text-secondary hover:text-tw-text cursor-pointer"
        onclick={clearSearch}
        aria-label="Clear search"
      >
        <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="2">
          <path stroke-linecap="round" stroke-linejoin="round" d="M6 18L18 6M6 6l12 12"/>
        </svg>
      </button>
    {/if}
  </div>

  <!-- Results count -->
  {#if !getIsLoading()}
    <div class="text-tw-text-secondary text-sm px-1">
      {getSearchResults().length} bookmark{getSearchResults().length !== 1 ? 's' : ''}
      {#if getSearchQuery()}
        for "{getSearchQuery()}"
      {/if}
    </div>
  {/if}

  <!-- Loading state -->
  {#if getIsLoading()}
    <div class="flex items-center justify-center py-16">
      <div class="animate-spin rounded-full h-8 w-8 border-2 border-tw-accent border-t-transparent"></div>
    </div>

  <!-- Empty state -->
  {:else if getBookmarks().length === 0}
    <div class="card text-center py-16 space-y-4">
      <div class="text-6xl mb-4">
        <svg class="w-16 h-16 mx-auto text-tw-text-secondary" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="1.5">
          <path stroke-linecap="round" stroke-linejoin="round" d="M5 5a2 2 0 012-2h10a2 2 0 012 2v16l-7-3.5L5 21V5z"/>
        </svg>
      </div>
      <h2 class="text-xl font-bold text-tw-text">No bookmarks yet</h2>
      <p class="text-tw-text-secondary max-w-md mx-auto">
        Import your Twitter/X bookmarks to get started. Go to
        <a href="/settings" class="text-tw-accent hover:underline">Settings</a>
        to import a JSON file from your Twitter data export.
      </p>
      <a href="/settings" class="btn-primary inline-block mt-4">
        Import Bookmarks
      </a>
    </div>

  <!-- No results for search -->
  {:else if getSearchResults().length === 0}
    <div class="card text-center py-12 space-y-3">
      <svg class="w-12 h-12 mx-auto text-tw-text-secondary" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="1.5">
        <path stroke-linecap="round" stroke-linejoin="round" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"/>
      </svg>
      <h2 class="text-lg font-bold text-tw-text">No results found</h2>
      <p class="text-tw-text-secondary">Try a different search term or remove some filters.</p>
    </div>

  <!-- Bookmark list -->
  {:else}
    {@const bookmarkMap = getBookmarkMap()}
    {@const allResults = getSearchResults()}
    {@const visibleResults = allResults.slice(0, visibleCount)}
    <div class="space-y-3">
      {#each visibleResults as result (result.id)}
        {@const bookmark = bookmarkMap.get(String(result.id)) ?? result}
        {@const terms = result.terms ?? []}
        <article class="card hover:border-tw-text-secondary/30 transition-colors duration-200">
          <div class="flex gap-3">
            <!-- Avatar -->
            <div class="flex-shrink-0">
              {#if bookmark.authorAvatar}
                <img
                  src={bookmark.authorAvatar}
                  alt={bookmark.authorName}
                  class="w-10 h-10 rounded-full bg-tw-border"
                  onerror={(e) => { (e.target as HTMLImageElement).style.display = 'none'; (e.target as HTMLImageElement).nextElementSibling?.classList.remove('hidden'); }}
                />
                <div class="hidden w-10 h-10 rounded-full bg-tw-accent flex items-center justify-center text-white font-bold text-sm">
                  {getAvatarFallback(bookmark.authorName)}
                </div>
              {:else}
                <div class="w-10 h-10 rounded-full bg-tw-accent flex items-center justify-center text-white font-bold text-sm">
                  {getAvatarFallback(bookmark.authorName)}
                </div>
              {/if}
            </div>

            <!-- Content -->
            <div class="flex-1 min-w-0">
              <!-- Author info -->
              <div class="flex items-center gap-1 flex-wrap">
                <span class="font-bold text-tw-text truncate">{bookmark.authorName}</span>
                <span class="text-tw-text-secondary text-sm truncate">@{bookmark.authorHandle}</span>
                <span class="text-tw-text-secondary text-sm">·</span>
                <span class="text-tw-text-secondary text-sm">{formatDate(bookmark.bookmarkedAt)}</span>
              </div>

              <!-- Tweet text with highlights -->
              <div class="mt-1 text-tw-text whitespace-pre-wrap break-words leading-relaxed">
                {@html highlightMatches(bookmark.text, terms)}
              </div>

              <!-- Media thumbnails -->
              {#if bookmark.mediaUrls && bookmark.mediaUrls.length > 0}
                <div class="mt-3 grid gap-2 {bookmark.mediaUrls.length === 1 ? 'grid-cols-1' : 'grid-cols-2'}">
                  {#each bookmark.mediaUrls as mediaUrl}
                    <img
                      src={mediaUrl}
                      alt="Tweet media"
                      class="rounded-xl border border-tw-border w-full h-32 object-cover"
                      loading="lazy"
                    />
                  {/each}
                </div>
              {/if}

              <!-- Tags -->
              {#if bookmark.tags && bookmark.tags.length > 0}
                <div class="mt-2 flex flex-wrap gap-1.5">
                  {#each bookmark.tags as tag}
                    <span class="tag-pill text-xs">{tag}</span>
                  {/each}
                </div>
              {/if}

              <!-- Actions row -->
              <div class="mt-3 flex items-center gap-3">
                <a
                  href={bookmark.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  class="text-tw-text-secondary hover:text-tw-accent text-sm flex items-center gap-1 transition-colors"
                >
                  <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="2">
                    <path stroke-linecap="round" stroke-linejoin="round" d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14"/>
                  </svg>
                  View on X
                </a>
                <button
                  class="text-tw-text-secondary hover:text-tw-accent text-sm flex items-center gap-1 transition-colors cursor-pointer"
                  onclick={() => toggleTagPicker(String(bookmark.id))}
                >
                  <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="2">
                    <path stroke-linecap="round" stroke-linejoin="round" d="M7 7h.01M7 3h5a1.99 1.99 0 011.414.586l7 7a2 2 0 010 2.828l-7 7a2 2 0 01-2.828 0l-7-7A1.99 1.99 0 013 12V7a4 4 0 014-4z"/>
                  </svg>
                  {tagPickerOpenFor === String(bookmark.id) ? 'Close' : 'Manage Tags'}
                </button>
              </div>

              <!-- Tag picker -->
              {#if tagPickerOpenFor === String(bookmark.id)}
                <div class="mt-3 p-3 bg-tw-bg border border-tw-border rounded-xl space-y-3">
                  <div class="text-sm font-medium text-tw-text-secondary">Select tags:</div>

                  {#if getTags().length > 0}
                    <div class="flex flex-wrap gap-2">
                      {#each getTags() as tag}
                        {@const hasTag = bookmark.tags?.includes(tag) ?? false}
                        <label class="flex items-center gap-1.5 cursor-pointer group">
                          <input
                            type="checkbox"
                            checked={hasTag}
                            onchange={() => handleToggleTag(String(bookmark.id), tag, hasTag)}
                            class="w-4 h-4 rounded border-tw-border bg-tw-bg text-tw-accent focus:ring-tw-accent focus:ring-offset-0 cursor-pointer accent-tw-accent"
                          />
                          <span class="text-sm text-tw-text group-hover:text-tw-accent transition-colors">{tag}</span>
                        </label>
                      {/each}
                    </div>
                  {:else}
                    <p class="text-sm text-tw-text-secondary">No tags yet. Create one below.</p>
                  {/if}

                  <div class="flex gap-2">
                    <input
                      type="text"
                      class="input-field text-sm py-1.5"
                      placeholder="New tag name..."
                      bind:value={newTagInput}
                      onkeydown={(e) => handleNewTagKeydown(e, String(bookmark.id))}
                      aria-label="New tag name"
                    />
                    <button
                      class="btn-primary text-sm py-1.5 px-3 whitespace-nowrap"
                      onclick={() => handleAddNewTag(String(bookmark.id))}
                      disabled={!newTagInput.trim()}
                    >
                      Add
                    </button>
                  </div>
                </div>
              {/if}
            </div>
          </div>
        </article>
      {/each}

      <!-- Load more button for pagination -->
      {#if visibleCount < allResults.length}
        <div class="text-center py-4">
          <button class="btn-outline" onclick={loadMore}>
            Load more ({allResults.length - visibleCount} remaining)
          </button>
        </div>
      {/if}
    </div>
  {/if}
</div>
