<script lang="ts">
  export type MentionPickerPlacement =
    | { kind: 'below'; left: number; top: number }
    | { kind: 'above'; left: number; bottom: number };

  let {
    usernames,
    query,
    selectedIndex,
    placement,
    onSelect,
  }: {
    usernames: string[];
    query: string;
    selectedIndex: number;
    placement: MentionPickerPlacement;
    onSelect: (username: string) => void;
  } = $props();

  let listEl = $state<HTMLDivElement | null>(null);

  $effect(() => {
    selectedIndex;
    if (!listEl) return;
    const row = listEl.querySelector<HTMLElement>(`[data-mention-index="${selectedIndex}"]`);
    row?.scrollIntoView({ block: 'nearest' });
  });

  const showCreateRow = $derived(usernames.length === 0 && query.trim().length > 0);
</script>

<div
  role="menu"
  tabindex="-1"
  class="fixed z-50 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-600 rounded shadow-lg py-1 min-w-[160px] max-w-[min(100vw-2rem,16rem)] flex flex-col"
  style:left="{placement.left}px"
  style:top={placement.kind === 'below' ? `${placement.top}px` : undefined}
  style:bottom={placement.kind === 'above' ? `${placement.bottom}px` : undefined}
  onmousedown={(e) => e.preventDefault()}
>
  <div bind:this={listEl} class="max-h-48 overflow-y-auto">
    {#if showCreateRow}
      <button
        type="button"
        data-mention-index="0"
        onclick={() => onSelect(query.trim())}
        class="w-full text-left px-3 py-1.5 text-sm hover:bg-gray-100 dark:hover:bg-gray-700 {selectedIndex === 0 ? 'bg-gray-100 dark:bg-gray-700' : ''}"
      >
        <span class="text-gray-500 dark:text-gray-400">Add</span>
        <span class="text-blue-600 dark:text-blue-400 font-medium">@{query.trim()}</span>
      </button>
    {:else if usernames.length === 0}
      <div class="px-3 py-1.5 text-sm text-gray-500 dark:text-gray-400">Type to add a mention</div>
    {:else}
      {#each usernames as username, i (username)}
        <button
          type="button"
          data-mention-index={i}
          onclick={() => onSelect(username)}
          class="w-full text-left px-3 py-1.5 text-sm hover:bg-gray-100 dark:hover:bg-gray-700 {selectedIndex === i ? 'bg-gray-100 dark:bg-gray-700' : ''}"
        >
          <span class="text-blue-600 dark:text-blue-400 font-medium">@{username}</span>
        </button>
      {/each}
    {/if}
  </div>
</div>
