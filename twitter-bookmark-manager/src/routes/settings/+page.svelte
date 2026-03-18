<script lang="ts">
  import {
    getBookmarks,
    getTags,
    importBookmarks,
    exportBookmarks,
    clearAllData,
  } from '$lib/stores/app.svelte';

  let isDragging = $state(false);
  let importStatus = $state<{ type: 'success' | 'error'; message: string } | null>(null);
  let importPreview = $state<{ count: number; jsonString: string } | null>(null);
  let isImporting = $state(false);
  let showClearConfirm = $state(false);
  let fileInput = $state<HTMLInputElement | null>(null);

  function handleDragOver(e: DragEvent) {
    e.preventDefault();
    isDragging = true;
  }

  function handleDragLeave(e: DragEvent) {
    e.preventDefault();
    isDragging = false;
  }

  async function handleDrop(e: DragEvent) {
    e.preventDefault();
    isDragging = false;

    const file = e.dataTransfer?.files[0];
    if (file) {
      await processFile(file);
    }
  }

  function handleFileSelect(e: Event) {
    const target = e.target as HTMLInputElement;
    const file = target.files?.[0];
    if (file) {
      processFile(file);
    }
  }

  async function processFile(file: File) {
    importStatus = null;
    importPreview = null;

    if (!file.name.endsWith('.json')) {
      importStatus = { type: 'error', message: 'Please select a JSON file.' };
      return;
    }

    try {
      const text = await file.text();
      // Quick parse to count entries
      const parsed = JSON.parse(text);
      if (!Array.isArray(parsed)) {
        importStatus = { type: 'error', message: 'JSON file must contain an array of bookmarks.' };
        return;
      }
      importPreview = { count: parsed.length, jsonString: text };
    } catch {
      importStatus = { type: 'error', message: 'Failed to read or parse the JSON file.' };
    }
  }

  async function confirmImport() {
    if (!importPreview) return;
    isImporting = true;
    importStatus = null;

    try {
      const imported = await importBookmarks(importPreview.jsonString);
      importStatus = {
        type: 'success',
        message: `Successfully imported ${imported} bookmark${imported !== 1 ? 's' : ''}.`,
      };
      importPreview = null;
    } catch (err) {
      importStatus = { type: 'error', message: 'Import failed. Please check your file format.' };
    } finally {
      isImporting = false;
    }
  }

  function cancelImport() {
    importPreview = null;
    importStatus = null;
  }

  function handleExport() {
    const json = exportBookmarks();
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `bookmarks-export-${new Date().toISOString().slice(0, 10)}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  async function handleClearAll() {
    await clearAllData();
    showClearConfirm = false;
    importStatus = { type: 'success', message: 'All data has been cleared.' };
  }
</script>

<div class="space-y-6">
  <h1 class="text-2xl font-bold text-tw-text">Settings</h1>

  <!-- Stats -->
  <div class="grid grid-cols-2 gap-3">
    <div class="card text-center">
      <div class="text-3xl font-bold text-tw-accent">{getBookmarks().length}</div>
      <div class="text-sm text-tw-text-secondary mt-1">Bookmarks</div>
    </div>
    <div class="card text-center">
      <div class="text-3xl font-bold text-tw-accent">{getTags().length}</div>
      <div class="text-sm text-tw-text-secondary mt-1">Tags</div>
    </div>
  </div>

  <!-- Import section -->
  <section class="card space-y-4">
    <h2 class="text-lg font-bold text-tw-text flex items-center gap-2">
      <svg class="w-5 h-5 text-tw-accent" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="2">
        <path stroke-linecap="round" stroke-linejoin="round" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12"/>
      </svg>
      Import Bookmarks
    </h2>
    <p class="text-sm text-tw-text-secondary">
      Import bookmarks from a Twitter/X data export (JSON) or a previously exported bookmarks file.
    </p>

    <!-- Drop zone -->
    <div
      class="border-2 border-dashed rounded-xl p-8 text-center transition-colors duration-200 {isDragging
        ? 'border-tw-accent bg-tw-accent/10'
        : 'border-tw-border hover:border-tw-text-secondary'}"
      ondragover={handleDragOver}
      ondragleave={handleDragLeave}
      ondrop={handleDrop}
      role="button"
      tabindex="0"
    >
      <svg class="w-10 h-10 mx-auto text-tw-text-secondary mb-3" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="1.5">
        <path stroke-linecap="round" stroke-linejoin="round" d="M9 13h6m-3-3v6m5 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"/>
      </svg>
      <p class="text-tw-text-secondary mb-3">
        Drag and drop a JSON file here, or
      </p>
      <button class="btn-primary" onclick={() => fileInput?.click()}>
        Choose File
      </button>
      <input
        bind:this={fileInput}
        type="file"
        accept=".json"
        class="hidden"
        onchange={handleFileSelect}
      />
    </div>

    <!-- Import preview -->
    {#if importPreview}
      <div class="bg-tw-bg border border-tw-border rounded-xl p-4 space-y-3">
        <p class="text-tw-text">
          Found <span class="font-bold text-tw-accent">{importPreview.count}</span> entries in file.
          Ready to import?
        </p>
        <div class="flex gap-3">
          <button class="btn-primary" onclick={confirmImport} disabled={isImporting}>
            {isImporting ? 'Importing...' : 'Confirm Import'}
          </button>
          <button class="btn-outline" onclick={cancelImport} disabled={isImporting}>
            Cancel
          </button>
        </div>
      </div>
    {/if}

    <!-- Status message -->
    {#if importStatus}
      <div class="rounded-xl p-3 text-sm {importStatus.type === 'success'
        ? 'bg-green-500/10 text-green-400 border border-green-500/30'
        : 'bg-tw-danger/10 text-tw-danger border border-tw-danger/30'}">
        {importStatus.message}
      </div>
    {/if}
  </section>

  <!-- Export section -->
  <section class="card space-y-4">
    <h2 class="text-lg font-bold text-tw-text flex items-center gap-2">
      <svg class="w-5 h-5 text-tw-accent" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="2">
        <path stroke-linecap="round" stroke-linejoin="round" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4"/>
      </svg>
      Export Bookmarks
    </h2>
    <p class="text-sm text-tw-text-secondary">
      Download all your bookmarks as a JSON file for backup or transfer.
    </p>
    <button
      class="btn-primary"
      onclick={handleExport}
      disabled={getBookmarks().length === 0}
    >
      Export {getBookmarks().length} Bookmark{getBookmarks().length !== 1 ? 's' : ''} as JSON
    </button>
  </section>

  <!-- Data management -->
  <section class="card space-y-4">
    <h2 class="text-lg font-bold text-tw-text flex items-center gap-2">
      <svg class="w-5 h-5 text-tw-danger" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="2">
        <path stroke-linecap="round" stroke-linejoin="round" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4.5c-.77-.833-2.694-.833-3.464 0L3.34 16.5c-.77.833.192 2.5 1.732 2.5z"/>
      </svg>
      Data Management
    </h2>
    <p class="text-sm text-tw-text-secondary">
      Permanently delete all bookmarks and tags. This action cannot be undone.
    </p>
    {#if showClearConfirm}
      <div class="bg-tw-danger/10 border border-tw-danger/30 rounded-xl p-4 space-y-3">
        <p class="text-tw-text font-medium">
          Are you sure? This will permanently delete all {getBookmarks().length} bookmarks and {getTags().length} tags.
        </p>
        <div class="flex gap-3">
          <button class="btn-danger" onclick={handleClearAll}>
            Yes, Clear Everything
          </button>
          <button class="btn-outline" onclick={() => (showClearConfirm = false)}>
            Cancel
          </button>
        </div>
      </div>
    {:else}
      <button class="btn-danger" onclick={() => (showClearConfirm = true)}>
        Clear All Data
      </button>
    {/if}
  </section>
</div>
