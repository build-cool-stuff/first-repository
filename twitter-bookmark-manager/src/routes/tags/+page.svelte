<script lang="ts">
  import {
    getBookmarks,
    getTags,
    renameTag,
    deleteTag,
  } from '$lib/stores/app.svelte';
  import { goto } from '$app/navigation';

  let editingTag = $state<string | null>(null);
  let editValue = $state('');
  let deletingTag = $state<string | null>(null);

  // Compute tag counts
  function getTagCounts(): Map<string, number> {
    const counts = new Map<string, number>();
    const allBookmarks = getBookmarks();
    for (const tag of getTags()) {
      counts.set(tag, 0);
    }
    for (const bookmark of allBookmarks) {
      for (const tag of bookmark.tags) {
        counts.set(tag, (counts.get(tag) ?? 0) + 1);
      }
    }
    return counts;
  }

  // Deterministic color for a tag based on its hash
  const tagColors = [
    'bg-blue-500/20 text-blue-400',
    'bg-green-500/20 text-green-400',
    'bg-purple-500/20 text-purple-400',
    'bg-yellow-500/20 text-yellow-400',
    'bg-pink-500/20 text-pink-400',
    'bg-cyan-500/20 text-cyan-400',
    'bg-orange-500/20 text-orange-400',
    'bg-red-500/20 text-red-400',
    'bg-indigo-500/20 text-indigo-400',
    'bg-teal-500/20 text-teal-400',
  ];

  function getTagColor(tag: string): string {
    let hash = 0;
    for (let i = 0; i < tag.length; i++) {
      hash = ((hash << 5) - hash + tag.charCodeAt(i)) | 0;
    }
    return tagColors[Math.abs(hash) % tagColors.length];
  }

  function startEditing(tag: string) {
    editingTag = tag;
    editValue = tag;
  }

  function cancelEditing() {
    editingTag = null;
    editValue = '';
  }

  async function saveRename() {
    if (!editingTag || !editValue.trim()) return;
    if (editValue.trim() !== editingTag) {
      await renameTag(editingTag, editValue.trim());
    }
    editingTag = null;
    editValue = '';
  }

  function handleRenameKeydown(e: KeyboardEvent) {
    if (e.key === 'Enter') {
      e.preventDefault();
      saveRename();
    } else if (e.key === 'Escape') {
      cancelEditing();
    }
  }

  function confirmDelete(tag: string) {
    deletingTag = tag;
  }

  function cancelDelete() {
    deletingTag = null;
  }

  async function executeDelete() {
    if (!deletingTag) return;
    await deleteTag(deletingTag);
    deletingTag = null;
  }

  function filterByTag(tag: string) {
    goto(`/?tag=${encodeURIComponent(tag)}`);
  }
</script>

<div class="space-y-4">
  <h1 class="text-2xl font-bold text-tw-text">Tags</h1>

  {#if getTags().length === 0}
    <div class="card text-center py-12 space-y-3">
      <svg class="w-12 h-12 mx-auto text-tw-text-secondary" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="1.5">
        <path stroke-linecap="round" stroke-linejoin="round" d="M7 7h.01M7 3h5a1.99 1.99 0 011.414.586l7 7a2 2 0 010 2.828l-7 7a2 2 0 01-2.828 0l-7-7A1.99 1.99 0 013 12V7a4 4 0 014-4z"/>
      </svg>
      <h2 class="text-lg font-bold text-tw-text">No tags yet</h2>
      <p class="text-tw-text-secondary">Add tags to your bookmarks from the home page to organize them.</p>
    </div>
  {:else}
    {@const tagCounts = getTagCounts()}
    <div class="space-y-2">
      {#each getTags() as tag (tag)}
        <div class="card flex items-center justify-between gap-3">
          <div class="flex items-center gap-3 flex-1 min-w-0">
            {#if editingTag === tag}
              <input
                type="text"
                class="input-field text-sm py-1.5 rounded-lg"
                bind:value={editValue}
                onkeydown={handleRenameKeydown}
                autofocus
              />
            {:else}
              <button
                class="flex items-center gap-2 min-w-0 cursor-pointer group"
                onclick={() => filterByTag(tag)}
              >
                <span class="px-3 py-1 rounded-full text-sm font-medium {getTagColor(tag)}">
                  {tag}
                </span>
                <span class="text-tw-text-secondary text-sm">
                  {tagCounts.get(tag) ?? 0} bookmark{(tagCounts.get(tag) ?? 0) !== 1 ? 's' : ''}
                </span>
                <svg class="w-4 h-4 text-tw-text-secondary opacity-0 group-hover:opacity-100 transition-opacity" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="2">
                  <path stroke-linecap="round" stroke-linejoin="round" d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14"/>
                </svg>
              </button>
            {/if}
          </div>

          <div class="flex items-center gap-2 flex-shrink-0">
            {#if editingTag === tag}
              <button class="btn-primary text-sm py-1.5 px-3" onclick={saveRename}>
                Save
              </button>
              <button class="btn-outline text-sm py-1.5 px-3" onclick={cancelEditing}>
                Cancel
              </button>
            {:else}
              <button
                class="text-tw-text-secondary hover:text-tw-text transition-colors cursor-pointer p-1.5"
                onclick={() => startEditing(tag)}
                title="Rename tag"
              >
                <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="2">
                  <path stroke-linecap="round" stroke-linejoin="round" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z"/>
                </svg>
              </button>
              <button
                class="text-tw-text-secondary hover:text-tw-danger transition-colors cursor-pointer p-1.5"
                onclick={() => confirmDelete(tag)}
                title="Delete tag"
              >
                <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="2">
                  <path stroke-linecap="round" stroke-linejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"/>
                </svg>
              </button>
            {/if}
          </div>
        </div>
      {/each}
    </div>
  {/if}
</div>

<!-- Delete confirmation modal -->
{#if deletingTag}
  <div class="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4">
    <div class="card max-w-sm w-full space-y-4">
      <h3 class="text-lg font-bold text-tw-text">Delete Tag</h3>
      <p class="text-tw-text-secondary">
        Are you sure you want to delete the tag "<span class="text-tw-text font-medium">{deletingTag}</span>"?
        This will remove it from all bookmarks.
      </p>
      <div class="flex justify-end gap-3">
        <button class="btn-outline" onclick={cancelDelete}>Cancel</button>
        <button class="btn-danger" onclick={executeDelete}>Delete</button>
      </div>
    </div>
  </div>
{/if}
