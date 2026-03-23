<script lang="ts">
  let { open = false, onclose } = $props();
</script>

{#if open}
  <div
    class="fixed inset-0 z-50 flex"
    role="dialog"
    aria-modal="true"
  >
    <nav
      class="w-48 shrink-0 bg-white dark:bg-gray-800 shadow-lg p-4 flex flex-col gap-2"
    >
      <div class="flex justify-between items-center mb-2">
        <span class="font-medium text-sm text-gray-900 dark:text-gray-100">Menu</span>
        <button
          type="button"
          onclick={onclose}
          class="p-1"
          aria-label="Close"
        >
          <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      </div>
      <a
        href="/history"
        class="block w-full text-left py-2 px-3 text-sm text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 rounded"
        onclick={onclose}
      >
        Previous days
      </a>
      <a
        href="/setup"
        class="block w-full text-left py-2 px-3 text-sm text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 rounded"
        onclick={onclose}
      >
        Settings
      </a>
    </nav>
    <button
      type="button"
      class="flex-1 bg-black/30"
      onclick={onclose}
      aria-label="Close menu"
    ></button>
  </div>
{/if}
