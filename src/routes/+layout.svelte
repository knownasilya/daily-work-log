<script lang="ts">
  import "../app.css";
  import { page } from '$app/stores';
  import { goto } from '$app/navigation';
  import { listen } from '@tauri-apps/api/event';
  import { onMount } from 'svelte';

  let { children } = $props();

  onMount(() => {
    let unlisten: (() => void) | undefined;
    void listen('tray-open', () => goto('/')).then((fn) => {
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
