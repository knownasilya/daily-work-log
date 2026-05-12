<script lang="ts">
  import type { EmojiRule } from '$lib/api/db';

  export type EmojiPickerPlacement =
    | { kind: 'below'; left: number; top: number }
    | { kind: 'above'; left: number; bottom: number };

  let {
    rules,
    currentEmojiId,
    placement,
    onSelect,
  }: {
    rules: EmojiRule[];
    currentEmojiId: string | null;
    placement: EmojiPickerPlacement;
    onSelect: (emojiId: string | null) => void;
  } = $props();

  let query = $state('');

  let filtered = $derived.by(() => {
    const q = query.trim().toLowerCase();
    if (!q) return rules;
    return rules.filter(
      (r) => r.text.toLowerCase().includes(q) || (r.label ?? '').toLowerCase().includes(q)
    );
  });

  function focusOnMount(node: HTMLInputElement) {
    node.focus();
  }
</script>

<div
  role="menu"
  tabindex="-1"
  class="fixed z-50 bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600 rounded shadow-lg py-1 min-w-[180px] max-w-[min(100vw-2rem,20rem)] flex flex-col"
  style:left="{placement.left}px"
  style:top={placement.kind === 'below' ? `${placement.top}px` : undefined}
  style:bottom={placement.kind === 'above' ? `${placement.bottom}px` : undefined}
  onclick={(e) => e.stopPropagation()}
  onkeydown={(e) => e.stopPropagation()}
>
  <div class="px-2 py-1 border-b border-gray-300 dark:border-gray-700 shrink-0">
    <input
      type="text"
      bind:value={query}
      use:focusOnMount
      placeholder="Search..."
      autocorrect="off"
      autocomplete="off"
      spellcheck="false"
      class="w-full text-sm px-2 py-1 border border-gray-300 dark:border-gray-600 rounded bg-white dark:bg-gray-800"
    />
  </div>
  <div class="max-h-40 overflow-y-auto">
    {#each filtered as rule (rule.id)}
      <button
        type="button"
        onclick={() => onSelect(rule.id)}
        class="w-full flex items-start gap-2 px-3 py-1.5 text-left text-sm hover:bg-gray-100 dark:hover:bg-gray-700"
      >
        <img
          src={rule.image}
          alt={rule.label?.trim() || rule.text}
          class="w-5 h-5 shrink-0 mt-0.5"
          draggable="false"
        />
        <span class="min-w-0 flex-1 flex flex-col gap-0.5">
          {#if rule.label?.trim()}
            <span class="truncate">{rule.label.trim()}</span>
            <span class="text-xs text-gray-500 dark:text-gray-400 truncate">:{rule.text}:</span>
          {:else}
            <span class="truncate">:{rule.text}:</span>
          {/if}
        </span>
      </button>
    {/each}
    {#if filtered.length === 0}
      <div class="px-3 py-1.5 text-sm text-gray-500 dark:text-gray-400">No matches</div>
    {/if}
  </div>
  {#if currentEmojiId}
    <button
      type="button"
      onclick={() => onSelect(null)}
      class="w-full px-3 py-1.5 text-left text-sm text-red-600 hover:bg-red-50 dark:hover:bg-red-900/30 border-t border-gray-300 dark:border-gray-700 shrink-0"
    >
      Remove
    </button>
  {/if}
</div>
