<script lang="ts">
  import { goto } from '$app/navigation';
  import { getDistinctDates, getDateTaskCount, getLastDay } from '$lib/api/db';
  import { formatDatePretty } from '$lib/utils';

  let dates = $state<{ date: string; count: number }[]>([]);

  async function goHome() {
    const lastDay = await getLastDay();
    goto(lastDay ? `/day/${lastDay}` : '/', { replaceState: true });
  }

  $effect(() => {
    getDistinctDates().then((d) => {
      Promise.all(
        d.map((date) =>
          getDateTaskCount(date).then((count) => ({ date, count }))
        )
      ).then((results) => {
        dates = results;
      });
    });
  });
</script>

<div class="min-h-screen flex flex-col bg-white dark:bg-gray-900">
  <header class="flex items-center gap-2 p-2 border-b border-gray-200 dark:border-gray-700 shrink-0">
    <button
      type="button"
      onclick={goHome}
      class="p-1"
      aria-label="Home"
    >
      <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6" />
      </svg>
    </button>
    <h1 class="text-sm font-medium">Previous days</h1>
  </header>

  <main class="flex-1 overflow-auto p-2">
    {#if dates.length === 0}
      <p class="text-sm text-gray-500 py-4">No days yet.</p>
    {:else}
      <ul class="space-y-1">
        {#each dates as { date, count } (date)}
          <li>
            <button
              onclick={() => goto(`/day/${date}`)}
              class="w-full text-left py-2 px-3 text-sm hover:bg-gray-100 dark:hover:bg-gray-800 rounded flex justify-between items-center"
            >
              <span>{formatDatePretty(date)}</span>
              <span class="text-gray-500 text-xs">{count} task{count === 1 ? '' : 's'}</span>
            </button>
          </li>
        {/each}
      </ul>
    {/if}
  </main>
</div>
