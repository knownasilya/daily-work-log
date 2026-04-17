<script lang="ts">
  import { goto } from '$app/navigation';
  import {
    getLastDay,
    getWeekTotals,
    getWeeklyEmojiSummary,
    getWeeklyExcludedEmojisSetting,
    type WeekTotal,
    type WeeklyEmojiRow,
  } from '$lib/api/db';

  interface EmojiSummary {
    id: string;
    image: string;
    text: string;
    label: string;
    count: number;
  }

  interface WeekSummary {
    week: string;
    week_start: string;
    week_end: string;
    total_tasks: number;
    emojis: EmojiSummary[];
  }

  let weeks = $state<WeekSummary[]>([]);

  function mergeWeekData(totals: WeekTotal[], emojiRows: WeeklyEmojiRow[]): WeekSummary[] {
    const emojiByWeek = new Map<string, EmojiSummary[]>();
    for (const r of emojiRows) {
      if (!emojiByWeek.has(r.week)) emojiByWeek.set(r.week, []);
      emojiByWeek.get(r.week)!.push({
        id: r.emoji_id,
        image: r.emoji_image,
        text: r.emoji_text,
        label: r.emoji_label,
        count: r.count,
      });
    }
    return totals.map((t) => ({
      week: t.week,
      week_start: t.week_start,
      week_end: t.week_end,
      total_tasks: t.total_tasks,
      emojis: emojiByWeek.get(t.week) ?? [],
    }));
  }

  $effect(() => {
    void (async () => {
      const [emojiRows, totals, excludedIds] = await Promise.all([
        getWeeklyEmojiSummary(),
        getWeekTotals(),
        getWeeklyExcludedEmojisSetting(),
      ]);
      const excluded = new Set(excludedIds);
      const filtered = emojiRows.filter((r) => !excluded.has(r.emoji_id));
      weeks = mergeWeekData(totals, filtered);
    })();
  });

  async function goHome() {
    const lastDay = await getLastDay();
    goto(lastDay ? `/day/${lastDay}` : '/', { replaceState: true });
  }

  function formatShortDate(dateStr: string): string {
    const d = new Date(dateStr + 'T12:00:00');
    return new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric' }).format(d);
  }

  function formatWeekRange(week: WeekSummary): string {
    if (week.week_start === week.week_end) {
      const d = new Date(week.week_start + 'T12:00:00');
      return new Intl.DateTimeFormat('en-US', {
        month: 'short',
        day: 'numeric',
        year: 'numeric',
      }).format(d);
    }
    const startYear = week.week_start.slice(0, 4);
    const endYear = week.week_end.slice(0, 4);
    const endFull = new Date(week.week_end + 'T12:00:00');
    const endFormatted = new Intl.DateTimeFormat('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    }).format(endFull);
    if (startYear === endYear) {
      return `${formatShortDate(week.week_start)} – ${endFormatted}`;
    }
    const startFull = new Date(week.week_start + 'T12:00:00');
    const startFormatted = new Intl.DateTimeFormat('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    }).format(startFull);
    return `${startFormatted} – ${endFormatted}`;
  }
</script>

<div class="h-dvh flex flex-col bg-white dark:bg-gray-900">
  <main class="flex min-h-0 flex-1 flex-col overflow-y-auto">
    <div
      class="sticky top-0 z-10 shrink-0 border-b border-gray-200 bg-white dark:border-gray-700 dark:bg-gray-900"
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
        <h1 class="text-sm font-medium">Weekly summary</h1>
      </header>
    </div>

    <div class="p-2 space-y-3">
      {#if weeks.length === 0}
        <p class="text-sm text-gray-500 py-4">No weeks logged yet.</p>
      {:else}
        {#each weeks as week (week.week)}
          <div class="rounded-lg border border-gray-200 dark:border-gray-700 p-3">
            <div class="flex items-baseline justify-between gap-2 mb-2">
              <span class="text-sm font-medium text-gray-900 dark:text-gray-100">
                {formatWeekRange(week)}
              </span>
              <span class="text-xs text-gray-500 shrink-0">
                {week.total_tasks} task{week.total_tasks === 1 ? '' : 's'}
              </span>
            </div>
            {#if week.emojis.length > 0}
              <div class="flex flex-wrap gap-2">
                {#each week.emojis as emoji (emoji.id)}
                  <div
                    class="flex flex-col items-center rounded-lg bg-gray-100 dark:bg-gray-800 px-3 py-2 gap-1 min-w-14"
                  >
                    <div class="flex items-center gap-1.5">
                      <img src={emoji.image} alt={emoji.text} class="w-5 h-5 object-contain" />
                      <span class="text-base font-semibold text-gray-900 dark:text-gray-100 leading-none">{emoji.count}</span>
                    </div>
                    <span class="text-xs text-gray-500 dark:text-gray-400 text-center leading-tight">{emoji.label}</span>
                  </div>
                {/each}
              </div>
            {:else}
              <p class="text-xs text-gray-400 dark:text-gray-600">No labeled emoji tasks</p>
            {/if}
          </div>
        {/each}
      {/if}
    </div>
  </main>
</div>
