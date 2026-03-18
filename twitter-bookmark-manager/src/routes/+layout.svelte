<script lang="ts">
  import '../app.css';
  import { page } from '$app/stores';
  import { loadBookmarks } from '$lib/stores/app.svelte';
  import { onMount } from 'svelte';

  let { children } = $props();

  let currentPath = $state('/');

  $effect(() => {
    const unsub = page.subscribe((p) => {
      currentPath = p.url.pathname;
    });
    return unsub;
  });

  onMount(() => {
    loadBookmarks();
  });

  function isActive(path: string): boolean {
    if (path === '/') return currentPath === '/';
    return currentPath.startsWith(path);
  }
</script>

<div class="min-h-screen bg-tw-bg flex flex-col">
  <!-- Desktop top nav -->
  <header class="hidden md:block border-b border-tw-border bg-tw-surface/80 backdrop-blur-md sticky top-0 z-50">
    <div class="max-w-3xl mx-auto flex items-center justify-between px-4 h-14">
      <a href="/" class="text-xl font-bold text-tw-text flex items-center gap-2">
        <svg class="w-6 h-6 text-tw-accent" fill="currentColor" viewBox="0 0 24 24">
          <path d="M5 2H19C20.1 2 21 2.9 21 4V16C21 17.1 20.1 18 19 18H7L3 22V4C3 2.9 3.9 2 5 2ZM5 4V17.17L6.17 16H19V4H5ZM7 7H17V9H7V7ZM7 11H14V13H7V11Z"/>
        </svg>
        Bookmarks
      </a>
      <nav class="flex items-center gap-1">
        <a href="/" class="nav-link {isActive('/') ? 'nav-link-active' : ''}">
          <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="2">
            <path stroke-linecap="round" stroke-linejoin="round" d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-4 0a1 1 0 01-1-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 01-1 1"/>
          </svg>
          Home
        </a>
        <a href="/tags" class="nav-link {isActive('/tags') ? 'nav-link-active' : ''}">
          <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="2">
            <path stroke-linecap="round" stroke-linejoin="round" d="M7 7h.01M7 3h5a1.99 1.99 0 011.414.586l7 7a2 2 0 010 2.828l-7 7a2 2 0 01-2.828 0l-7-7A1.99 1.99 0 013 12V7a4 4 0 014-4z"/>
          </svg>
          Tags
        </a>
        <a href="/settings" class="nav-link {isActive('/settings') ? 'nav-link-active' : ''}">
          <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="2">
            <path stroke-linecap="round" stroke-linejoin="round" d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.066 2.573c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.573 1.066c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.066-2.573c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z"/>
            <path stroke-linecap="round" stroke-linejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"/>
          </svg>
          Settings
        </a>
      </nav>
    </div>
  </header>

  <!-- Main content -->
  <main class="flex-1 pb-20 md:pb-4">
    <div class="max-w-3xl mx-auto px-4 py-4">
      {@render children()}
    </div>
  </main>

  <!-- Mobile bottom tab bar -->
  <nav class="md:hidden fixed bottom-0 left-0 right-0 bg-tw-surface/95 backdrop-blur-md border-t border-tw-border z-50">
    <div class="flex items-center justify-around h-16">
      <a href="/" class="flex flex-col items-center gap-1 px-3 py-2 {isActive('/') ? 'text-tw-accent' : 'text-tw-text-secondary'}">
        <svg class="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="2">
          <path stroke-linecap="round" stroke-linejoin="round" d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-4 0a1 1 0 01-1-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 01-1 1"/>
        </svg>
        <span class="text-xs font-medium">Home</span>
      </a>
      <a href="/tags" class="flex flex-col items-center gap-1 px-3 py-2 {isActive('/tags') ? 'text-tw-accent' : 'text-tw-text-secondary'}">
        <svg class="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="2">
          <path stroke-linecap="round" stroke-linejoin="round" d="M7 7h.01M7 3h5a1.99 1.99 0 011.414.586l7 7a2 2 0 010 2.828l-7 7a2 2 0 01-2.828 0l-7-7A1.99 1.99 0 013 12V7a4 4 0 014-4z"/>
        </svg>
        <span class="text-xs font-medium">Tags</span>
      </a>
      <a href="/settings" class="flex flex-col items-center gap-1 px-3 py-2 {isActive('/settings') ? 'text-tw-accent' : 'text-tw-text-secondary'}">
        <svg class="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="2">
          <path stroke-linecap="round" stroke-linejoin="round" d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.066 2.573c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.573 1.066c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.066-2.573c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z"/>
            <path stroke-linecap="round" stroke-linejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"/>
        </svg>
        <span class="text-xs font-medium">Settings</span>
      </a>
    </div>
  </nav>
</div>
