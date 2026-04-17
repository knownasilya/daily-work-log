<svelte:head>
  <title>{formatDatePretty(data.date)}</title>
</svelte:head>

<script lang="ts">
  import { goto } from '$app/navigation';
  import { invalidateAll } from '$app/navigation';
  import {
    addTask,
    updateTask,
    deleteTask,
    deleteDay,
    setEntryEmoji,
    getEmojiRules,
    getLastDay,
    getLatestDayBefore,
    reorderTasksForDate,
    updateDayFocus,
    updateDayNote,
  } from '$lib/api/db';
  import { formatDatePretty } from '$lib/utils';
  import { formatLineForSlack, tryAutoAssignEmoji } from '$lib/emoji';
  import { toYYYYMMDD } from '$lib/utils';
  import NavDrawer from '$lib/components/NavDrawer.svelte';
  import RichText from '$lib/components/RichText.svelte';

  let { data } = $props();

  let drawerOpen = $state(false);
  let emojiDropdownOpen = $state<number | null>(null);
  let entryMenuOpen = $state<number | null>(null);
  let copiedFeedback = $state(false);
  let emojiDropdownPos = $state({ top: 0, left: 0 });
  type EntryMenuPlacement =
    | { kind: 'below'; right: number; top: number; maxWidthPx: number }
    | { kind: 'above'; right: number; bottom: number; maxWidthPx: number };

  let entryMenuPos = $state<EntryMenuPlacement>({
    kind: 'below',
    right: 0,
    top: 0,
    maxWidthPx: 280,
  });
  let dayHeaderMenuOpen = $state(false);
  let dayHeaderMenuPos = $state<EntryMenuPlacement>({
    kind: 'below',
    right: 0,
    top: 0,
    maxWidthPx: 280,
  });
  let newTask = $state('');
  let focusText = $state('');
  let noteText = $state('');
  /** Pointer-based reorder (HTML5 DnD is unreliable in Tauri WKWebView). */
  const REORDER_THRESHOLD_PX = 8;
  type PendingPointer = { x: number; y: number; taskId: number; pointerId: number };
  let pendingPointer: PendingPointer | null = null;
  let reorderActive = $state(false);
  let reorderSourceId = $state<number | null>(null);
  /** Insert before this index in `tasks` (0..length); only visual until pointerup. */
  let reorderInsertSlot = $state<number | null>(null);
  let ignoreEmojiClick = false;

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


  let tasks = $derived(data.tasks);
  let emojiRules = $derived(data.emojiRules);
  $effect(() => {
    focusText = data.dayRow?.focus ?? '';
  });

  $effect(() => {
    noteText = data.dayRow?.note ?? '';
  });

  function saveFocus(value: string) {
    const trimmed = value.trim();
    updateDayFocus(data.date, trimmed ? trimmed : null).then(() => invalidateAll());
  }

  function saveNote(value: string) {
    const trimmed = value.trim();
    updateDayNote(data.date, trimmed ? trimmed : null).then(() => invalidateAll());
  }

  function sameIdOrder(a: number[], b: number[]) {
    return a.length === b.length && a.every((v, i) => v === b[i]);
  }

  /** `insertSlot` is an index in the current list: insert before that row, or `length` for end. */
  function orderIdsWithInsert(ids: number[], draggedId: number, insertSlot: number): number[] {
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
    const row = hit?.closest('[data-task-row]') as HTMLElement | null;
    if (!row) return null;
    const id = Number(row.dataset.taskId);
    const idx = tasks.findIndex((t) => t.id === id);
    if (idx < 0) return null;
    const rect = row.getBoundingClientRect();
    const before = e.clientY < rect.top + rect.height / 2;
    return before ? idx : idx + 1;
  }

  function toggleEmojiDropdown(taskId: number, ev: MouseEvent) {
    if (emojiDropdownOpen === taskId) {
      emojiDropdownOpen = null;
    } else {
      dayHeaderMenuOpen = false;
      entryMenuOpen = null;
      const rect = (ev.currentTarget as HTMLElement).getBoundingClientRect();
      emojiDropdownPos = { top: rect.bottom + 4, left: rect.left };
      emojiDropdownOpen = taskId;
    }
  }

  /**
   * Menu stays anchored: its right edge matches the kebab’s right edge (`right` in fixed layout).
   * Width is capped so the panel stays on-screen to the left; opens above the icon when there’s no room below.
   */
  function computeEntryMenuPosition(anchor: DOMRect): EntryMenuPlacement {
    const pad = 8;
    const gap = 4;
    const estH = 88;
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const right = vw - anchor.right;
    const maxWidthPx = Math.max(120, Math.min(anchor.right - pad, vw - 2 * pad, 224));

    const topBelow = anchor.bottom + gap;
    const openAbove = topBelow + estH > vh - pad;

    if (openAbove) {
      const bottom = vh - anchor.top + gap;
      return { kind: 'above', right, bottom, maxWidthPx };
    }
    return { kind: 'below', right, top: topBelow, maxWidthPx };
  }

  function toggleEntryMenu(taskId: number, ev: MouseEvent) {
    if (entryMenuOpen === taskId) {
      entryMenuOpen = null;
    } else {
      dayHeaderMenuOpen = false;
      emojiDropdownOpen = null;
      const rect = (ev.currentTarget as HTMLElement).getBoundingClientRect();
      entryMenuPos = computeEntryMenuPosition(rect);
      entryMenuOpen = taskId;
    }
  }

  function onEmojiActivatorClick(taskId: number, ev: MouseEvent) {
    if (ignoreEmojiClick) {
      ignoreEmojiClick = false;
      ev.preventDefault();
      ev.stopPropagation();
      return;
    }
    toggleEmojiDropdown(taskId, ev);
  }

  function resetReorderState() {
    pendingPointer = null;
    reorderActive = false;
    reorderSourceId = null;
    reorderInsertSlot = null;
  }

  function handleReorderPointerDown(taskId: number, e: PointerEvent) {
    if (e.button !== 0) return;
    pendingPointer = { x: e.clientX, y: e.clientY, taskId, pointerId: e.pointerId };
  }

  function handleReorderPointerMove(el: HTMLElement, e: PointerEvent) {
    if (pendingPointer && e.pointerId !== pendingPointer.pointerId) return;

    if (pendingPointer && !reorderActive) {
      const dx = e.clientX - pendingPointer.x;
      const dy = e.clientY - pendingPointer.y;
      if (Math.hypot(dx, dy) < REORDER_THRESHOLD_PX) return;
      reorderActive = true;
      reorderSourceId = pendingPointer.taskId;
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
    const ids = tasks.map((t) => t.id);
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
        const ids = tasks.map((t) => t.id);
        const next = orderIdsWithInsert(ids, src, slot);
        if (!sameIdOrder(ids, next)) {
          reorderTasksForDate(data.date, next).then(() => invalidateAll());
          ignoreEmojiClick = true;
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

  function handleEmojiSlotDragOver(e: DragEvent) {
    const dt = e.dataTransfer;
    if (!dt) return;
    if (Array.from(dt.types).includes('emoji-id')) {
      e.preventDefault();
      dt.dropEffect = 'copy';
    }
  }

  function handleEmojiSlotDrop(taskId: number, e: DragEvent) {
    e.preventDefault();
    const id = e.dataTransfer?.getData('emoji-id');
    if (id) handleEmojiDrop(taskId, id);
  }

  function selectEmoji(taskId: number, emojiId: string | null) {
    handleEmojiDrop(taskId, emojiId);
    emojiDropdownOpen = null;
  }

  function handleAddTask() {
    const content = newTask.trim();
    if (!content) return;
    const emojiId = tryAutoAssignEmoji(content, emojiRules);
    addTask(data.date, content, emojiId).then(() => {
      invalidateAll();
      newTask = '';
    });
  }

  function handleKeydown(e: KeyboardEvent) {
    if (e.key === 'Enter') handleAddTask();
  }

  function handleUpdateContent(id: number, content: string) {
    updateTask(id, { content }).then(() => invalidateAll());
  }

  function handleDelete(id: number) {
    entryMenuOpen = null;
    deleteTask(id).then(() => invalidateAll());
  }

  function handleTogglePinned(id: number, pinned: boolean) {
    entryMenuOpen = null;
    updateTask(id, { pinned }).then(() => invalidateAll());
  }

  /** Manual emoji change: just set emoji_id, no pattern matching. */
  function handleEmojiDrop(entryId: number, emojiId: string | null) {
    setEntryEmoji(entryId, emojiId).then(() => invalidateAll());
  }

  async function copyToSlack() {
    const rules = emojiRules.length ? emojiRules : await getEmojiRules();
    const lines = tasks.map((t) => formatLineForSlack(t, rules));
    const text = lines.join('\n');
    await navigator.clipboard.writeText(text);
    copiedFeedback = true;
    setTimeout(() => (copiedFeedback = false), 1500);
  }

  function openDrawer() {
    dayHeaderMenuOpen = false;
    drawerOpen = true;
  }

  function closeDrawer() {
    drawerOpen = false;
  }

  function toggleDayHeaderMenu(ev: MouseEvent) {
    if (dayHeaderMenuOpen) {
      dayHeaderMenuOpen = false;
    } else {
      emojiDropdownOpen = null;
      entryMenuOpen = null;
      const rect = (ev.currentTarget as HTMLElement).getBoundingClientRect();
      dayHeaderMenuPos = computeEntryMenuPosition(rect);
      dayHeaderMenuOpen = true;
    }
  }

  async function handleDeleteDay() {
    const message =
      'Delete this day? All focus, note, and log entries for this date will be removed permanently.';

    let confirmed = false;
    try {
      const { confirm: confirmDialog } = await import('@tauri-apps/plugin-dialog');
      confirmed = await confirmDialog(message, { title: 'Delete day', kind: 'warning' });
    } catch {
      confirmed = typeof window !== 'undefined' && window.confirm(message);
    }
    if (!confirmed) return;

    dayHeaderMenuOpen = false;

    const previousDay = await getLatestDayBefore(data.date);

    try {
      await deleteDay(data.date);
    } catch (e) {
      console.error(e);
      await invalidateAll();
      return;
    }

    if (previousDay) {
      await goto(`/day/${previousDay}`);
      return;
    }
    const last = await getLastDay();
    await goto(last ? `/day/${last}` : '/');
  }

</script>

<div class="h-screen flex flex-col overflow-hidden">
  <header class="flex items-center justify-between p-2 border-b border-gray-200 dark:border-gray-700 shrink-0">
    <div class="flex items-center gap-2 min-w-0">
      <button
        onclick={openDrawer}
        class="p-1 shrink-0"
        aria-label="Open menu"
      >
        <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 6h16M4 12h16M4 18h16" />
        </svg>
      </button>
      <h1 class="text-sm font-medium truncate">
        {formatDatePretty(data.date)}
      </h1>
    </div>
    <div class="flex items-center gap-2 shrink-0">
      {#if data.isLatestDay && !data.isToday}
        <button
          onclick={() => goto(`/day/${toYYYYMMDD(new Date())}`)}
          class="text-xs py-1 px-2 bg-blue-600 text-white rounded font-medium"
        >
          Start today
        </button>
      {/if}
      <button
        type="button"
        onclick={(e) => toggleDayHeaderMenu(e)}
        class="p-1 text-gray-500 hover:text-gray-800 dark:text-gray-400 dark:hover:text-gray-100 rounded"
        aria-label="Day options"
        aria-expanded={dayHeaderMenuOpen}
      >
        <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
          <path
            stroke-linecap="round"
            stroke-linejoin="round"
            stroke-width="2"
            d="M12 5v.01M12 12v.01M12 19v.01M12 6a1 1 0 110-2 1 1 0 010 2zm0 7a1 1 0 110-2 1 1 0 010 2zm0 7a1 1 0 110-2 1 1 0 010 2z"
          />
        </svg>
      </button>
    </div>
    {#if dayHeaderMenuOpen}
      <div
        role="menu"
        tabindex="-1"
        class="fixed z-50 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-600 rounded shadow-lg py-1 min-w-[160px] w-max text-left"
        style:right="{dayHeaderMenuPos.right}px"
        style:left="auto"
        style:top={dayHeaderMenuPos.kind === 'below' ? `${dayHeaderMenuPos.top}px` : undefined}
        style:bottom={dayHeaderMenuPos.kind === 'above' ? `${dayHeaderMenuPos.bottom}px` : undefined}
        style:max-width="{dayHeaderMenuPos.maxWidthPx}px"
        onclick={(e) => e.stopPropagation()}
        onkeydown={(e) => e.stopPropagation()}
      >
        <button
          type="button"
          role="menuitem"
          onclick={() => handleDeleteDay()}
          class="w-full px-3 py-1.5 text-left text-sm text-red-600 hover:bg-red-50 dark:hover:bg-red-900/30"
        >
          Delete day
        </button>
      </div>
    {/if}
  </header>

  <section
    class="flex-1 min-h-0 overflow-auto p-2"
  >
    <div class="pb-2">
      <label
        for={`day-focus-${data.date}`}
        class="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1"
        >Focus</label
      >
      <RichText
        id={`day-focus-${data.date}`}
        value={focusText}
        onSave={saveFocus}
        placeholder="Focus…"
        saveOn="cmdenter"
        resync={true}
        resyncKey={JSON.stringify([data.date, data.dayRow?.focus ?? ''])}
        wrapperClass="w-full"
        class="text-sm px-2 py-2 border border-gray-200 dark:border-gray-600 rounded bg-white dark:bg-gray-800 resize-none"
      />
    </div>
    <div
      class="mb-2 border-t border-gray-200 dark:border-gray-700"
      aria-hidden="true"
    ></div>
    <ul class="pt-2 space-y-1 overflow-visible">
      {#each tasks as task, i (task.id)}
        <li
          data-task-row
          data-task-id={task.id}
          class="flex items-start gap-2 group relative rounded overflow-visible {reorderSourceId === task.id
            ? 'opacity-50'
            : ''}"
        >
          {#if reorderActive && reorderInsertSlot === i}
            <div
              class="pointer-events-none absolute left-0 right-0 top-0 z-10 h-0.5 -translate-y-1/2 rounded-full bg-blue-500 dark:bg-blue-400 shadow-sm"
              aria-hidden="true"
            ></div>
          {/if}
          {#if reorderActive && reorderInsertSlot === tasks.length && i === tasks.length - 1}
            <div
              class="pointer-events-none absolute left-0 right-0 bottom-0 z-10 h-0.5 translate-y-1/2 rounded-full bg-blue-500 dark:bg-blue-400 shadow-sm"
              aria-hidden="true"
            ></div>
          {/if}
          <div
            data-emoji-slot
            role="button"
            aria-label="Change emoji; drag to reorder"
            tabindex="0"
            class="emoji-drag-handle w-8 h-8 shrink-0 flex items-center justify-center border border-gray-200 dark:border-gray-600 rounded cursor-grab active:cursor-grabbing relative touch-none select-none"
            onclick={(e) => onEmojiActivatorClick(task.id, e)}
            onkeydown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                onEmojiActivatorClick(task.id, e as unknown as MouseEvent);
              }
            }}
            onpointerdown={(e) => handleReorderPointerDown(task.id, e)}
            onpointermove={(e) => handleReorderPointerMove(e.currentTarget as HTMLElement, e)}
            onpointerup={(e) => handleReorderPointerUp(e.currentTarget as HTMLElement, e)}
            onpointercancel={(e) => handleReorderPointerUp(e.currentTarget as HTMLElement, e)}
            ondragover={handleEmojiSlotDragOver}
            ondrop={(e) => handleEmojiSlotDrop(task.id, e)}
          >
            {#if task.emoji_id}
              {#each emojiRules as rule (rule.id)}
                {#if rule.id === task.emoji_id}
                  <img
                    src={rule.image}
                    alt={rule.label?.trim() || rule.text}
                    class="emoji-slot-img w-5 h-5 pointer-events-none select-none"
                    draggable="false"
                  />
                {/if}
              {/each}
            {:else}
              <span class="text-gray-300 dark:text-gray-500 text-xs pointer-events-none select-none"
                >+</span
              >
            {/if}
          </div>
          {#if emojiDropdownOpen === task.id}
            <div
              role="menu"
              tabindex="-1"
              class="fixed z-50 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-600 rounded shadow-lg py-1 min-w-[180px] max-w-[min(100vw-2rem,20rem)] max-h-40 overflow-y-auto"
              style="top: {emojiDropdownPos.top}px; left: {emojiDropdownPos.left}px;"
              onclick={(e) => e.stopPropagation()}
              onkeydown={(e) => e.stopPropagation()}
            >
              {#each emojiRules as rule (rule.id)}
                <button
                  type="button"
                  onclick={() => selectEmoji(task.id, rule.id)}
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
                      <span class="text-xs text-gray-500 dark:text-gray-400 truncate"
                        >:{rule.text}:</span
                      >
                    {:else}
                      <span class="truncate">:{rule.text}:</span>
                    {/if}
                  </span>
                </button>
              {/each}
              {#if task.emoji_id}
                <button
                  type="button"
                  onclick={() => selectEmoji(task.id, null)}
                  class="w-full px-3 py-1.5 text-left text-sm text-red-600 hover:bg-red-50 dark:hover:bg-red-900/30"
                >
                  Remove
                </button>
              {/if}
            </div>
          {/if}
          <RichText
            value={task.content}
            onSave={(val) => handleUpdateContent(task.id, val)}
            saveOn="enter"
            onEmptyBackspace={() => handleDelete(task.id)}
            wrapperClass="flex-1 min-w-0"
            class="text-sm px-1 py-1 border-0 border-b border-transparent hover:border-gray-200 dark:hover:border-gray-600 focus:border-blue-500 focus:outline-none bg-transparent resize-none overflow-y-auto max-h-24 break-words {task.pinned ? 'pr-14' : 'pr-8'}"
          />
          <div class="absolute right-0 top-0 flex items-center gap-0.5">
            {#if task.pinned}
              <button
                type="button"
                onclick={() => handleTogglePinned(task.id, false)}
                class="p-1 text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300 shrink-0 rounded"
                aria-label="Unpin"
                title="Unpin"
              >
                <svg
                  class="w-4 h-4"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                  aria-hidden="true"
                >
                  <!-- Bulletin-board pushpin: domed cap + rim + needle, tilted like stuck in cork -->
                  <g
                    transform="rotate(-11 12 10.5)"
                    stroke-linecap="round"
                    stroke-linejoin="round"
                    stroke-width="2"
                  >
                    <ellipse cx="12" cy="7" rx="4.5" ry="3.5" fill="currentColor" fill-opacity="0.14" />
                    <path d="M9 10.5h6" />
                    <path d="M12 10.5V19.5" />
                  </g>
                </svg>
              </button>
            {/if}
            <button
              type="button"
              onclick={(e) => toggleEntryMenu(task.id, e)}
              class="p-1 rounded text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 transition-opacity duration-150 {reorderActive || entryMenuOpen === task.id
                ? 'opacity-100 pointer-events-auto'
                : 'opacity-0 pointer-events-none group-hover:opacity-100 group-hover:pointer-events-auto'}"
              aria-label="Task options"
              aria-expanded={entryMenuOpen === task.id}
            >
              <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                <path
                  stroke-linecap="round"
                  stroke-linejoin="round"
                  stroke-width="2"
                  d="M12 5v.01M12 12v.01M12 19v.01M12 6a1 1 0 110-2 1 1 0 010 2zm0 7a1 1 0 110-2 1 1 0 010 2zm0 7a1 1 0 110-2 1 1 0 010 2z"
                />
              </svg>
            </button>
          </div>
          {#if entryMenuOpen === task.id}
            <div
              role="menu"
              tabindex="-1"
              class="fixed z-50 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-600 rounded shadow-lg py-1 min-w-[160px] w-max text-left"
              style:right="{entryMenuPos.right}px"
              style:left="auto"
              style:top={entryMenuPos.kind === 'below' ? `${entryMenuPos.top}px` : undefined}
              style:bottom={entryMenuPos.kind === 'above' ? `${entryMenuPos.bottom}px` : undefined}
              style:max-width="{entryMenuPos.maxWidthPx}px"
              onclick={(e) => e.stopPropagation()}
              onkeydown={(e) => e.stopPropagation()}
            >
              <button
                type="button"
                role="menuitem"
                onclick={() => handleTogglePinned(task.id, !task.pinned)}
                class="w-full px-3 py-1.5 text-left text-sm hover:bg-gray-100 dark:hover:bg-gray-700"
              >
                {task.pinned ? 'Unpin' : 'Pin'}
              </button>
              <button
                type="button"
                role="menuitem"
                onclick={() => handleDelete(task.id)}
                class="w-full px-3 py-1.5 text-left text-sm text-red-600 hover:bg-red-50 dark:hover:bg-red-900/30"
              >
                Delete
              </button>
            </div>
          {/if}
        </li>
      {/each}
    </ul>
    <div
      class="pt-2 flex gap-2"
    >
      <input
        type="text"
        bind:value={newTask}
        onkeydown={handleKeydown}
        placeholder="Add task..."
            class="flex-1 min-w-0 text-sm px-2 py-1 border border-gray-200 dark:border-gray-600 rounded bg-white dark:bg-gray-800"
      />
    </div>
    <div
      class="mt-3 border-t border-gray-200 dark:border-gray-700"
      aria-hidden="true"
    ></div>
    <div class="pt-2">
      <label
        for={`day-note-${data.date}`}
        class="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1"
        >Note</label
      >
      <RichText
        id={`day-note-${data.date}`}
        value={noteText}
        onSave={saveNote}
        placeholder="Note…"
        saveOn="cmdenter"
        resync={true}
        resyncKey={JSON.stringify([data.date, data.dayRow?.note ?? ''])}
        wrapperClass="w-full"
        class="text-sm px-2 py-2 border border-gray-200 dark:border-gray-600 rounded bg-white dark:bg-gray-800 resize-none"
      />
    </div>
  </section>

  <footer class="p-2 border-t border-gray-200 dark:border-gray-700 shrink-0 flex items-center gap-2">
    <button
      type="button"
      onclick={() => data.prevDay && goto(`/day/${data.prevDay}`)}
      disabled={!data.prevDay}
      class="p-1.5 rounded text-gray-500 hover:text-gray-800 dark:text-gray-400 dark:hover:text-gray-100 disabled:opacity-30 disabled:pointer-events-none"
      aria-label="Previous day"
      title={data.prevDay ? formatDatePretty(data.prevDay) : 'No previous day'}
    >
      <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 19l-7-7 7-7" />
      </svg>
    </button>
    <button
      onclick={copyToSlack}
      disabled={tasks.length === 0}
      class="flex-1 mx-4 py-2 text-sm font-medium rounded transition-all duration-200 disabled:opacity-40 disabled:pointer-events-none {copiedFeedback
        ? 'bg-green-500 text-white scale-[1.02]'
        : 'bg-green-600 text-white hover:bg-green-700'}"
    >
      {#if copiedFeedback}
        <span class="inline-flex items-center gap-1.5">
          <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7" />
          </svg>
          Copied!
        </span>
      {:else}
        Copy tasks
      {/if}
    </button>
    <button
      type="button"
      onclick={() => data.nextDay && goto(`/day/${data.nextDay}`)}
      disabled={!data.nextDay}
      class="p-1.5 rounded text-gray-500 hover:text-gray-800 dark:text-gray-400 dark:hover:text-gray-100 disabled:opacity-30 disabled:pointer-events-none"
      aria-label="Next day"
      title={data.nextDay ? formatDatePretty(data.nextDay) : 'No next day'}
    >
      <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 5l7 7-7 7" />
      </svg>
    </button>
  </footer>
</div>

{#if emojiDropdownOpen !== null || entryMenuOpen !== null || dayHeaderMenuOpen}
  <button
    type="button"
    class="fixed inset-0 z-40"
    aria-label="Close menu"
    onclick={() => {
      emojiDropdownOpen = null;
      entryMenuOpen = null;
      dayHeaderMenuOpen = false;
    }}
  ></button>
{/if}

<NavDrawer open={drawerOpen} onclose={closeDrawer} />
