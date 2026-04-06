<script lang="ts">
  import "../app.css";
  import { page } from '$app/stores';
  import { goto } from '$app/navigation';
  import { listen } from '@tauri-apps/api/event';
  import { onMount } from 'svelte';
  import { getAlwaysOnTopSetting } from '$lib/api/db';
  import { applyAlwaysOnTop } from '$lib/tauri-window';

  let { children } = $props();

  onMount(() => {
    void getAlwaysOnTopSetting().then((v) => applyAlwaysOnTop(v));

    let unlisten: (() => void) | undefined;
    void listen('tray-open', async () => {
      await goto('/');
      const v = await getAlwaysOnTopSetting();
      await applyAlwaysOnTop(v);
    }).then((fn) => {
      unlisten = fn;
    });
    return () => {
      unlisten?.();
    };
  });
</script>

{#key $page.url.pathname}
  <div class="min-h-screen bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100">
    {@render children?.()}
  </div>
{/key}
