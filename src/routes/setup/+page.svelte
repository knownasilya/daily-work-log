<script lang="ts">
  import { goto } from '$app/navigation';
  import { getStoredTheme, setTheme } from '$lib/theme';
  import {
    getEmojiRules,
    upsertEmojiRule,
    deleteEmojiRule,
    getLastDay,
    reorderEmojiRules,
    type EmojiRule,
  } from '$lib/api/db';
  import { parsePatterns, validatePattern as checkPatternSyntax } from '$lib/emoji';
  let rules = $state<EmojiRule[]>([]);
  let newRule = $state({ image: '', text: '', label: '', patterns: [''] });
  let regexError = $state<string | null>(null);
  let theme = $state<'system' | 'light' | 'dark'>(getStoredTheme());
  let imageInputEl = $state<HTMLInputElement | undefined>(undefined);
  let editImageInputEl = $state<HTMLInputElement | undefined>(undefined);

  let editingRuleId = $state<string | null>(null);
  let editRule = $state<{ image: string; text: string; label: string; patterns: string[] } | null>(
    null
  );

  /** Pointer-based reorder (same approach as day view; HTML5 DnD is unreliable in Tauri WKWebView). */
  const REORDER_THRESHOLD_PX = 8;
  type PendingPointer = { x: number; y: number; ruleId: string; pointerId: number };
  let pendingPointer: PendingPointer | null = null;
  let reorderActive = $state(false);
  let reorderSourceId = $state<string | null>(null);
  /** Insert before this index in `rules` (0..length); visual only until pointerup. */
  let reorderInsertSlot = $state<number | null>(null);

  $effect(() => {
    if (reorderActive) {
      document.documentElement.classList.add('dwl-reorder-dragging');
      const preventSelect = (ev: Event) => ev.preventDefault();
      document.addEventListener('selectstart', preventSelect, { capture: true });
      return () => {
        document.documentElement.classList.remove('dwl-reorder-dragging');
        document.removeEventListener('selectstart', preventSelect, { capture: true });
      };
    }
    document.documentElement.classList.remove('dwl-reorder-dragging');
  });

  function sameIdOrder(a: string[], b: string[]) {
    return a.length === b.length && a.every((v, i) => v === b[i]);
  }

  function orderIdsWithInsert(ids: string[], draggedId: string, insertSlot: number): string[] {
    const from = ids.indexOf(draggedId);
    if (from < 0) return ids;
    const next = [...ids];
    next.splice(from, 1);
    let pos = insertSlot;
    if (insertSlot > from) pos--;
    pos = Math.max(0, Math.min(pos, next.length));
    next.splice(pos, 0, draggedId);
    return next;
  }

  function pointerEventToInsertSlot(e: PointerEvent): number | null {
    const hit = document.elementFromPoint(e.clientX, e.clientY);
    const row = hit?.closest('[data-emoji-rule-row]') as HTMLElement | null;
    if (!row) return null;
    const id = row.dataset.ruleId;
    if (!id) return null;
    const idx = rules.findIndex((r) => r.id === id);
    if (idx < 0) return null;
    const rect = row.getBoundingClientRect();
    const before = e.clientY < rect.top + rect.height / 2;
    return before ? idx : idx + 1;
  }

  function resetReorderState() {
    pendingPointer = null;
    reorderActive = false;
    reorderSourceId = null;
    reorderInsertSlot = null;
  }

  function handleReorderPointerDown(ruleId: string, e: PointerEvent) {
    if (e.button !== 0) return;
    pendingPointer = { x: e.clientX, y: e.clientY, ruleId, pointerId: e.pointerId };
  }

  function handleReorderPointerMove(el: HTMLElement, e: PointerEvent) {
    if (pendingPointer && e.pointerId !== pendingPointer.pointerId) return;

    if (pendingPointer && !reorderActive) {
      const dx = e.clientX - pendingPointer.x;
      const dy = e.clientY - pendingPointer.y;
      if (Math.hypot(dx, dy) < REORDER_THRESHOLD_PX) return;
      reorderActive = true;
      reorderSourceId = pendingPointer.ruleId;
      reorderInsertSlot = null;
      el.setPointerCapture(e.pointerId);
    }

    if (!reorderActive) return;

    e.preventDefault();
    getSelection()?.removeAllRanges();
    const src = reorderSourceId;
    if (src == null) return;
    const rawSlot = pointerEventToInsertSlot(e);
    if (rawSlot == null) return;
    const ids = rules.map((r) => r.id);
    const next = orderIdsWithInsert(ids, src, rawSlot);
    if (sameIdOrder(ids, next)) {
      reorderInsertSlot = null;
    } else {
      reorderInsertSlot = rawSlot;
    }
  }

  function handleReorderPointerUp(el: HTMLElement, e: PointerEvent) {
    if (pendingPointer && e.pointerId !== pendingPointer.pointerId) return;

    if (reorderActive) {
      const src = reorderSourceId;
      const slot = reorderInsertSlot;
      if (src != null && slot != null) {
        const ids = rules.map((r) => r.id);
        const next = orderIdsWithInsert(ids, src, slot);
        if (!sameIdOrder(ids, next)) {
          reorderEmojiRules(next).then(() => {
            getEmojiRules().then((r) => (rules = r));
          });
        }
      }
      try {
        el.releasePointerCapture(e.pointerId);
      } catch {
        /* not capturing */
      }
    }
    resetReorderState();
  }

  function fileToDataUrl(file: File): Promise<string> {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result as string);
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
  }

  function applyPatternValidation(pattern: string): boolean {
    const r = checkPatternSyntax(pattern);
    regexError = r.regexError;
    return r.ok;
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
          const data = await fileToDataUrl(file);
          if (editingRuleId && editRule) {
            editRule = { ...editRule, image: data };
          } else {
            newRule.image = data;
          }
        }
        break;
      }
    }
  }

  async function handleFileSelect(e: Event) {
    const input = e.target as HTMLInputElement;
    const file = input.files?.[0];
    if (file?.type.startsWith('image/')) {
      const data = await fileToDataUrl(file);
      if (editingRuleId && editRule) {
        editRule = { ...editRule, image: data };
      } else {
        newRule.image = data;
      }
    }
    input.value = '';
  }

  const DEFAULT_IMAGE =
    'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg"><rect width="24" height="24" fill="%23ccc"/></svg>';

  function addRule() {
    const textTrimmed = newRule.text.trim();
    if (!textTrimmed || !textTrimmed.includes(':')) return;
    const validPatterns = newRule.patterns.map((p) => p.trim()).filter(Boolean);
    for (const p of validPatterns) {
      if (!applyPatternValidation(p)) return;
    }
    const patternStr =
      validPatterns.length > 0 ? JSON.stringify(validPatterns) : '.*';
    const id = crypto.randomUUID();
    const slackName = textTrimmed.replace(/^:+|:+$/g, ''); // strip leading/trailing colons
    const labelTrim = newRule.label.trim();
    upsertEmojiRule({
      id,
      image: newRule.image.trim() || DEFAULT_IMAGE,
      text: slackName,
      pattern: patternStr,
      sort_order: rules.length,
      label: labelTrim ? labelTrim : null,
    }).then(() => {
      getEmojiRules().then((r) => (rules = r));
      newRule = { image: '', text: '', label: '', patterns: [''] };
      regexError = null;
    });
  }

  function addPattern() {
    newRule.patterns = [...newRule.patterns, ''];
  }

  function removePattern(i: number) {
    if (newRule.patterns.length <= 1) return;
    newRule.patterns = newRule.patterns.filter((_, idx) => idx !== i);
  }

  function startEdit(rule: EmojiRule) {
    editingRuleId = rule.id;
    const patterns = parsePatterns(rule.pattern);
    editRule = {
      image: rule.image,
      text: `:${rule.text}:`,
      label: rule.label ?? '',
      patterns: patterns.length > 0 ? [...patterns] : [''],
    };
    regexError = null;
  }

  function cancelEdit() {
    editingRuleId = null;
    editRule = null;
    regexError = null;
  }

  function saveEdit() {
    if (!editingRuleId || !editRule) return;
    const textTrimmed = editRule.text.trim();
    if (!textTrimmed || !textTrimmed.includes(':')) return;
    const validPatterns = editRule.patterns.map((p) => p.trim()).filter(Boolean);
    for (const p of validPatterns) {
      if (!applyPatternValidation(p)) return;
    }
    const patternStr =
      validPatterns.length > 0 ? JSON.stringify(validPatterns) : '.*';
    const slackName = textTrimmed.replace(/^:+|:+$/g, '');
    const existing = rules.find((r) => r.id === editingRuleId);
    if (!existing) return;
    const labelTrim = editRule.label.trim();
    upsertEmojiRule({
      id: editingRuleId,
      image: editRule.image.trim() || DEFAULT_IMAGE,
      text: slackName,
      pattern: patternStr,
      sort_order: existing.sort_order,
      label: labelTrim ? labelTrim : null,
    }).then(() => {
      getEmojiRules().then((r) => (rules = r));
      cancelEdit();
    });
  }

  function addPatternEdit() {
    if (!editRule) return;
    editRule = { ...editRule, patterns: [...editRule.patterns, ''] };
  }

  function removePatternEdit(i: number) {
    if (!editRule || editRule.patterns.length <= 1) return;
    editRule = {
      ...editRule,
      patterns: editRule.patterns.filter((_, idx) => idx !== i),
    };
  }

  function deleteRule(id: string) {
    if (editingRuleId === id) cancelEdit();
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
        {#each ['system', 'light', 'dark'] as const as option}
          <button
            type="button"
            onclick={() => {
              setTheme(option);
              theme = option;
            }}
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
        <input
          type="text"
          bind:value={newRule.label}
          placeholder="Label (optional, shown in picker)"
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
                oninput={() => applyPatternValidation(newRule.patterns[i])}
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
        {#if regexError && editingRuleId === null}
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
        <div>
          <h2 class="text-xs font-medium text-gray-600 dark:text-gray-400">Emoji rules</h2>
          <p class="text-xs text-gray-500 dark:text-gray-400 mt-1">
            Order is used when auto-assigning an emoji for new tasks: the first rule wins.
          </p>
        </div>
        <ul class="space-y-3">
        {#each rules as rule, ruleIndex (rule.id)}
          <li
            class="border border-gray-200 dark:border-gray-700 rounded p-3 relative overflow-visible {reorderSourceId === rule.id
              ? 'opacity-50'
              : ''}"
            data-rule-id={rule.id}
            data-emoji-rule-row={editingRuleId !== rule.id ? true : undefined}
          >
            {#if reorderActive && reorderInsertSlot === ruleIndex}
              <div
                class="pointer-events-none absolute left-0 right-0 top-0 z-10 h-0.5 -translate-y-1/2 rounded-full bg-blue-500 dark:bg-blue-400 shadow-sm"
                aria-hidden="true"
              ></div>
            {/if}
            {#if reorderActive && reorderInsertSlot === rules.length && ruleIndex === rules.length - 1}
              <div
                class="pointer-events-none absolute left-0 right-0 bottom-0 z-10 h-0.5 translate-y-1/2 rounded-full bg-blue-500 dark:bg-blue-400 shadow-sm"
                aria-hidden="true"
              ></div>
            {/if}
            {#if editingRuleId === rule.id && editRule}
              <div class="space-y-3">
                <div
                  class="border border-gray-200 dark:border-gray-700 rounded p-2 flex items-center gap-2 min-h-12"
                  role="group"
                >
                  {#if editRule.image}
                    <img src={editRule.image} alt="Preview" class="w-8 h-8 object-contain shrink-0" />
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
                    bind:this={editImageInputEl}
                    onchange={handleFileSelect}
                  />
                  <button
                    type="button"
                    onclick={() => editImageInputEl?.click()}
                    class="text-sm px-2 py-1 border border-gray-200 dark:border-gray-600 rounded shrink-0 hover:bg-gray-100 dark:hover:bg-gray-800"
                  >
                    {editRule.image ? 'Replace' : 'Upload'}
                  </button>
                </div>
                <input
                  type="text"
                  value={editRule.image.startsWith('data:') ? '' : editRule.image}
                  oninput={(e) => {
                    const v = (e.target as HTMLInputElement).value;
                    editRule = editRule ? { ...editRule, image: v } : null;
                  }}
                  placeholder="Or paste image URL"
                  class="w-full text-sm px-2 py-1 border border-gray-200 dark:border-gray-600 rounded bg-white dark:bg-gray-800"
                />
                <input
                  type="text"
                  value={editRule.text}
                  oninput={(e) => {
                    const v = (e.target as HTMLInputElement).value;
                    editRule = editRule ? { ...editRule, text: v } : null;
                  }}
                  placeholder="Slack name (e.g. :rocket:)"
                  autocorrect="off"
                  autocomplete="off"
                  spellcheck="false"
                  class="w-full text-sm px-2 py-1 border border-gray-200 dark:border-gray-600 rounded bg-white dark:bg-gray-800"
                />
                <input
                  type="text"
                  value={editRule.label}
                  oninput={(e) => {
                    const v = (e.target as HTMLInputElement).value;
                    editRule = editRule ? { ...editRule, label: v } : null;
                  }}
                  placeholder="Label (optional, shown in picker)"
                  autocorrect="off"
                  autocomplete="off"
                  spellcheck="false"
                  class="w-full text-sm px-2 py-1 border border-gray-200 dark:border-gray-600 rounded bg-white dark:bg-gray-800"
                />
                <div class="space-y-2">
                  {#each editRule.patterns as _, i}
                    <div class="flex gap-1">
                      <input
                        type="text"
                        value={editRule.patterns[i]}
                        oninput={(e) => {
                          const v = (e.target as HTMLInputElement).value;
                          if (!editRule) return;
                          const next = [...editRule.patterns];
                          next[i] = v;
                          editRule = { ...editRule, patterns: next };
                          applyPatternValidation(v);
                        }}
                        placeholder="Plain text or /regex/"
                        autocorrect="off"
                        autocomplete="off"
                        spellcheck="false"
                        class="flex-1 min-w-0 text-sm px-2 py-1 border border-gray-200 dark:border-gray-600 rounded bg-white dark:bg-gray-800"
                      />
                      {#if editRule.patterns.length > 1}
                        <button
                          type="button"
                          onclick={() => removePatternEdit(i)}
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
                    onclick={addPatternEdit}
                    class="text-sm text-blue-600 dark:text-blue-400 hover:underline"
                  >
                    + Add pattern
                  </button>
                </div>
                {#if regexError && editingRuleId === rule.id}
                  <p class="text-xs text-red-600">{regexError}</p>
                {/if}
                <div class="flex gap-2">
                  <button
                    type="button"
                    onclick={saveEdit}
                    disabled={!editRule.text.trim().includes(':')}
                    class="flex-1 py-2 text-sm rounded disabled:opacity-50 disabled:cursor-not-allowed bg-blue-600 text-white hover:bg-blue-700"
                  >
                    Save
                  </button>
                  <button
                    type="button"
                    onclick={cancelEdit}
                    class="py-2 px-3 text-sm rounded border border-gray-200 dark:border-gray-600 hover:bg-gray-100 dark:hover:bg-gray-800"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            {:else}
              <div class="flex items-center gap-2">
                <div
                  role="button"
                  tabindex="0"
                  aria-label="Drag to reorder"
                  class="emoji-drag-handle w-8 h-8 shrink-0 flex items-center justify-center border border-gray-200 dark:border-gray-600 rounded cursor-grab active:cursor-grabbing relative touch-none select-none"
                  onpointerdown={(e) => handleReorderPointerDown(rule.id, e)}
                  onpointermove={(e) => handleReorderPointerMove(e.currentTarget as HTMLElement, e)}
                  onpointerup={(e) => handleReorderPointerUp(e.currentTarget as HTMLElement, e)}
                  onpointercancel={(e) => handleReorderPointerUp(e.currentTarget as HTMLElement, e)}
                >
                  <img
                    src={rule.image}
                    alt={rule.text}
                    class="emoji-slot-img w-5 h-5 object-contain pointer-events-none select-none"
                    draggable="false"
                  />
                </div>
                <div class="min-w-0 flex-1">
                  <div class="text-sm font-medium">:{rule.text}:</div>
                  <div class="text-xs text-gray-500 truncate">
                    {parsePatterns(rule.pattern).join(' | ') || '.*'}
                  </div>
                </div>
                <button
                  type="button"
                  onclick={() => startEdit(rule)}
                  class="p-1 text-blue-600 hover:bg-blue-50 dark:hover:bg-blue-900/30 rounded shrink-0"
                  aria-label="Edit"
                >
                  <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" />
                  </svg>
                </button>
                <button
                  type="button"
                  onclick={() => deleteRule(rule.id)}
                  class="p-1 text-red-600 hover:bg-red-50 dark:hover:bg-red-900/30 rounded shrink-0"
                  aria-label="Delete"
                >
                  <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                  </svg>
                </button>
              </div>
            {/if}
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
