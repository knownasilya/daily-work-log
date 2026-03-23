<script lang="ts">
  import { goto } from '$app/navigation';
  import { getStoredTheme, setTheme } from '$lib/theme';
  import {
    getEmojiRules,
    upsertEmojiRule,
    deleteEmojiRule,
    getLastDay,
  } from '$lib/api/db';
  import { parsePatterns } from '$lib/emoji';
  let rules = $state<{ id: string; image: string; text: string; pattern: string; sort_order: number }[]>([]);
  let newRule = $state({ image: '', text: '', patterns: [''] });
  let regexError = $state<string | null>(null);
  let theme = $state<'system' | 'light' | 'dark'>(getStoredTheme());
  let imageInputEl: HTMLInputElement;

  function fileToDataUrl(file: File): Promise<string> {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result as string);
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
  }

  async function handlePaste(e: ClipboardEvent) {
    const items = e.clipboardData?.items;
    if (!items) return;
    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      if (item.type.startsWith('image/')) {
        e.preventDefault();
        const file = item.getAsFile();
        if (file) {
          newRule.image = await fileToDataUrl(file);
        }
        break;
      }
    }
  }

  async function handleFileSelect(e: Event) {
    const input = e.target as HTMLInputElement;
    const file = input.files?.[0];
    if (file?.type.startsWith('image/')) {
      newRule.image = await fileToDataUrl(file);
    }
    input.value = '';
  }

  function validatePattern(pattern: string): boolean {
    const trimmed = pattern.trim();
    if (!trimmed) return true; // empty = match all
    const regexMatch = /^\/(.*)\/$/.exec(trimmed);
    if (regexMatch) {
      try {
        new RegExp(regexMatch[1]);
        regexError = null;
        return true;
      } catch (e) {
        regexError = e instanceof Error ? e.message : 'Invalid regex';
        return false;
      }
    }
    regexError = null;
    return true; // plain text always valid
  }

  const DEFAULT_IMAGE =
    'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg"><rect width="24" height="24" fill="%23ccc"/></svg>';

  function addRule() {
    const textTrimmed = newRule.text.trim();
    if (!textTrimmed || !textTrimmed.includes(':')) return;
    const validPatterns = newRule.patterns.map((p) => p.trim()).filter(Boolean);
    for (const p of validPatterns) {
      if (!validatePattern(p)) return;
    }
    const patternStr =
      validPatterns.length > 0 ? JSON.stringify(validPatterns) : '.*';
    const id = crypto.randomUUID();
    const slackName = textTrimmed.replace(/^:+|:+$/g, ''); // strip leading/trailing colons
    upsertEmojiRule({
      id,
      image: newRule.image.trim() || DEFAULT_IMAGE,
      text: slackName,
      pattern: patternStr,
      sort_order: rules.length,
    }).then(() => {
      getEmojiRules().then((r) => (rules = r));
      newRule = { image: '', text: '', patterns: [''] };
    });
  }

  function addPattern() {
    newRule.patterns = [...newRule.patterns, ''];
  }

  function removePattern(i: number) {
    if (newRule.patterns.length <= 1) return;
    newRule.patterns = newRule.patterns.filter((_, idx) => idx !== i);
  }

  function deleteRule(id: string) {
    deleteEmojiRule(id).then(() => {
      rules = rules.filter((r) => r.id !== id);
    });
  }

  async function goHome() {
    const lastDay = await getLastDay();
    goto(lastDay ? `/day/${lastDay}` : '/', { replaceState: true });
  }

  $effect(() => {
    getEmojiRules().then((r) => (rules = r));
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
    <h1 class="text-sm font-medium">Settings</h1>
  </header>

  <main class="flex-1 overflow-auto p-4" onpaste={handlePaste}>
    <div class="space-y-8">
      <section class="space-y-2">
        <h2 class="text-xs font-medium text-gray-600 dark:text-gray-400">Appearance</h2>
        <div class="flex gap-2 p-3 border dark:border-gray-700 rounded">
        {#each ['system', 'light', 'dark'] as option}
          <button
            type="button"
            onclick={() => { setTheme(option as 'system' | 'light' | 'dark'); theme = option; }}
            class="flex-1 py-1.5 px-2 text-sm rounded {theme === option
              ? 'bg-blue-600 text-white dark:bg-blue-500'
              : 'bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-700'}"
          >
            {option === 'system' ? 'System' : option === 'light' ? 'Light' : 'Dark'}
          </button>
        {/each}
        </div>
      </section>

      <section class="space-y-3">
        <h2 class="text-xs font-medium text-gray-600 dark:text-gray-400">Add emoji rule</h2>
        <div class="space-y-3">
        <div
          class="border border-gray-200 dark:border-gray-700 rounded p-2 flex items-center gap-2 min-h-12"
          role="group"
        >
          {#if newRule.image}
            <img src={newRule.image} alt="Preview" class="w-8 h-8 object-contain shrink-0" />
            <div class="flex-1 min-w-0">
              <p class="text-xs text-gray-500 truncate">Image set. Paste or upload to replace.</p>
            </div>
          {:else}
            <div class="flex-1 text-sm text-gray-500">
              Paste image (Ctrl+V) or
            </div>
          {/if}
          <input
            type="file"
            accept="image/*"
            class="hidden"
            bind:this={imageInputEl}
            onchange={handleFileSelect}
          />
          <button
            type="button"
            onclick={() => imageInputEl?.click()}
            class="text-sm px-2 py-1 border border-gray-200 dark:border-gray-600 rounded shrink-0 hover:bg-gray-100 dark:hover:bg-gray-800"
          >
            {newRule.image ? 'Replace' : 'Upload'}
          </button>
        </div>
        <input
          type="text"
          value={newRule.image.startsWith('data:') ? '' : newRule.image}
          oninput={(e) => {
            const v = (e.target as HTMLInputElement).value;
            newRule.image = v;
          }}
          placeholder="Or paste image URL"
          class="w-full text-sm px-2 py-1 border border-gray-200 dark:border-gray-600 rounded bg-white dark:bg-gray-800"
        />
        <input
          type="text"
          bind:value={newRule.text}
          placeholder="Slack name (e.g. :rocket:)"
          autocorrect="off"
          autocomplete="off"
          spellcheck="false"
          class="w-full text-sm px-2 py-1 border border-gray-200 dark:border-gray-600 rounded bg-white dark:bg-gray-800"
        />
        <div class="space-y-2">
          {#each newRule.patterns as _, i}
            <div class="flex gap-1">
              <input
                type="text"
                bind:value={newRule.patterns[i]}
                oninput={() => newRule.patterns[i] && validatePattern(newRule.patterns[i])}
                placeholder="Plain text or /regex/"
                autocorrect="off"
                autocomplete="off"
                spellcheck="false"
                class="flex-1 min-w-0 text-sm px-2 py-1 border border-gray-200 dark:border-gray-600 rounded bg-white dark:bg-gray-800"
              />
              {#if newRule.patterns.length > 1}
                <button
                  type="button"
                  onclick={() => removePattern(i)}
                  class="p-1 text-gray-400 dark:text-gray-500 hover:text-red-600 dark:hover:text-red-400 shrink-0"
                  aria-label="Remove pattern"
                >
                  <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              {/if}
            </div>
          {/each}
          <button
            type="button"
            onclick={addPattern}
            class="text-sm text-blue-600 dark:text-blue-400 hover:underline"
          >
            + Add pattern
          </button>
        </div>
        <p class="text-xs text-gray-500">Plain text = substring match. Use /pattern/ for regex. Multiple patterns = OR.</p>
        {#if regexError}
          <p class="text-xs text-red-600">{regexError}</p>
        {/if}
        <button
          onclick={addRule}
          disabled={!newRule.text.trim().includes(':')}
          class="w-full py-2 text-sm rounded disabled:opacity-50 disabled:cursor-not-allowed bg-blue-600 text-white hover:bg-blue-700 disabled:hover:bg-blue-600"
        >
          Add
        </button>
        </div>
      </section>

      <section class="space-y-3">
        <h2 class="text-xs font-medium text-gray-600 dark:text-gray-400">Emoji rules</h2>
        <ul class="space-y-3">
        {#each rules as rule (rule.id)}
          <li class="flex items-center gap-2 p-3 border border-gray-200 dark:border-gray-700 rounded">
            <img
              src={rule.image}
              alt={rule.text}
              class="w-8 h-8 object-contain shrink-0"
            />
            <div class="min-w-0 flex-1">
              <div class="text-sm font-medium">:{rule.text}:</div>
              <div class="text-xs text-gray-500 truncate">
                {parsePatterns(rule.pattern).join(' | ') || '.*'}
              </div>
            </div>
            <button
              onclick={() => deleteRule(rule.id)}
              class="p-1 text-red-600 hover:bg-red-50 dark:hover:bg-red-900/30 rounded shrink-0"
              aria-label="Delete"
            >
              <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
              </svg>
            </button>
          </li>
        {/each}
      </ul>
      {#if rules.length === 0}
        <p class="text-sm text-gray-500">No emoji rules. Add one above.</p>
      {/if}
      </section>
    </div>
  </main>
</div>

