<script lang="ts">
  import { goto } from '$app/navigation';
  import { ensureDay, getLastDay } from '$lib/api/db';

  let { data } = $props();

  $effect(() => {
    getLastDay().then((lastDay) => {
      if (lastDay) {
        goto(`/day/${lastDay}`, { replaceState: true });
      }
    }).catch(() => {
      // Tauri not available (e.g. browser dev) - stay on onboarding
    });
  });

  function startWorking() {
    ensureDay(data.today).catch(() => {
      // ignore; route load will ensure day row
    });
    goto(`/day/${data.today}`);
  }
</script>

<main class="min-h-screen flex flex-col items-center justify-center p-4 box-border bg-white dark:bg-gray-900">
  <div class="text-center max-w-[220px]">
    <h1 class="text-lg font-semibold mb-2 text-gray-900 dark:text-gray-100">Daily Work Log</h1>
    <p class="text-sm text-gray-600 dark:text-gray-400 mb-4">Log your work. Post on Slack.</p>
    <button
      onclick={startWorking}
      class="w-full py-2 px-4 bg-blue-600 text-white text-sm font-medium rounded hover:bg-blue-700"
    >
      Start working
    </button>
    <a
      href="/setup"
      class="block mt-3 text-sm text-blue-600 dark:text-blue-400 hover:underline"
    >
      Configure emojis
    </a>
  </div>
</main>
