<script lang="ts">
  import { goto } from '$app/navigation';
  import { getDays, getLastDay, searchDaysByText, type DayWithTaskCount } from '$lib/api/db';
  import { formatDatePretty } from '$lib/utils';

  let days = $state<DayWithTaskCount[]>([]);
  let searchQuery = $state('');
  let loadSeq = 0;

  async function goHome() {
    const lastDay = await getLastDay();
    goto(lastDay ? `/day/${lastDay}` : '/', { replaceState: true });
  }

  $effect(() => {
    const q = searchQuery;
    const delay = q.trim() ? 200 : 0;
    const id = setTimeout(() => {
      const seq = ++loadSeq;
      void (async () => {
        const t = q.trim();
        if (!t) {
          const next = await getDays();
          if (seq === loadSeq) days = next;
          return;
        }
        const tLower = t.toLowerCase();
        const [dbResults, allDays] = await Promise.all([searchDaysByText(t), getDays()]);
        if (seq !== loadSeq) return;
        const ids = new Set(dbResults.map((d) => d.id));
        const prettyMatches = allDays.filter(
          (d) => !ids.has(d.id) && formatDatePretty(d.day).toLowerCase().includes(tLower)
        );
        const merged = [...dbResults, ...prettyMatches];
        merged.sort((a, b) => b.day.localeCompare(a.day));
        days = merged;
      })();
    }, delay);
    return () => clearTimeout(id);
  });
</script>

<div class="h-dvh flex flex-col bg-white dark:bg-gray-900">
  <main class="flex min-h-0 flex-1 flex-col overflow-y-auto">
    <div
      class="sticky top-0 z-10 shrink-0 border-b border-gray-300 bg-white dark:border-gray-700 dark:bg-gray-900"
    >
      <header class="flex items-center gap-2 p-2">
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
      <div class="px-2 pb-2">
        <label class="sr-only" for="history-search">Search days by log, focus, or note</label>
        <input
          id="history-search"
          type="search"
          bind:value={searchQuery}
          placeholder="Search logs, focus, notes…"
          autocomplete="off"
          autocorrect="off"
          spellcheck="false"
          class="w-full rounded border border-gray-300 bg-white px-2 py-1.5 text-sm text-gray-900 placeholder:text-gray-400 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100 dark:placeholder:text-gray-500"
        />
      </div>
    </div>

    <div class="p-2">
      {#if days.length === 0}
        <p class="text-sm text-gray-500 py-4">
          {searchQuery.trim() ? 'No days match your search.' : 'No days yet.'}
        </p>
      {:else}
        <ul class="space-y-1">
          {#each days as day (day.id)}
            <li>
              <button
                onclick={() => goto(`/day/${day.day}`)}
                class="w-full text-left py-2 px-3 text-sm hover:bg-gray-100 dark:hover:bg-gray-800 rounded flex justify-between items-center gap-2"
              >
                <span class="flex min-w-0 items-center gap-1.5">
                  <span class="truncate">{formatDatePretty(day.day)}</span>
                  {#if day.note?.trim()}
                    <span
                      class="inline-flex shrink-0 text-gray-400 dark:text-gray-500"
                      aria-label="Has note"
                      title="Has note"
                    >
                      <svg class="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path
                          stroke-linecap="round"
                          stroke-linejoin="round"
                          stroke-width="2"
                          d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"
                        />
                      </svg>
                    </span>
                  {/if}
                </span>
                <span class="shrink-0 text-gray-500 text-xs">{day.task_count} task{day.task_count === 1 ? '' : 's'}</span>
              </button>
            </li>
          {/each}
        </ul>
      {/if}
    </div>
  </main>
</div>
