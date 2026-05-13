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
    updateDayNote,
    addDayEntry,
    updateDayEntryContent,
    updateDayEntryEmoji,
    deleteDayEntry,
    reorderDayEntries,
    completeFocusEntry,
    moveItemBetweenLists,
    getUpcomingDefaultEmojiSetting,
    getCompletedDefaultEmojiSetting,
    getIncompleteFocusDefaultEmojiSetting,
  } from '$lib/api/db';
  import { writeText as clipboardWriteText } from '@tauri-apps/plugin-clipboard-manager';
  import { formatDatePretty } from '$lib/utils';
  import { formatLineForSlack, tryAutoAssignEmoji } from '$lib/emoji';
  import { toYYYYMMDD } from '$lib/utils';
  import NavDrawer from '$lib/components/NavDrawer.svelte';
  import RichText from '$lib/components/RichText.svelte';
  import EmojiPicker from '$lib/components/EmojiPicker.svelte';
  import MentionPicker, { type MentionPickerPlacement } from '$lib/components/MentionPicker.svelte';
  import { detectMentionTrigger, insertMention, syncMentionsFromText } from '$lib/mention';

  let { data } = $props();

  let drawerOpen = $state(false);
  let emojiDropdownOpen = $state<number | null>(null);
  let entryMenuOpen = $state<number | null>(null);
  let focusMenuOpen = $state<number | null>(null);
  let upcomingMenuOpen = $state<number | null>(null);
  let copiedFeedback = $state(false);
  type EmojiDropdownPlacement =
    | { kind: 'below'; left: number; top: number }
    | { kind: 'above'; left: number; bottom: number };
  let emojiDropdownPos = $state<EmojiDropdownPlacement>({ kind: 'below', left: 0, top: 0 });
  let upcomingEmojiDropdownOpen = $state<number | null>(null);
  let upcomingEmojiDropdownPos = $state<EmojiDropdownPlacement>({ kind: 'below', left: 0, top: 0 });

  /** Opens above when there isn't room below; left-anchored either way. */
  function computeEmojiDropdownPosition(anchor: DOMRect): EmojiDropdownPlacement {
    const pad = 8;
    const gap = 4;
    const estH = 220; // search input + ~5 rows of rules
    const vh = window.innerHeight;
    if (anchor.bottom + gap + estH > vh - pad) {
      return { kind: 'above', left: anchor.left, bottom: vh - anchor.top + gap };
    }
    return { kind: 'below', left: anchor.left, top: anchor.bottom + gap };
  }
  type EntryMenuPlacement =
    | { kind: 'below'; right: number; top: number; maxWidthPx: number }
    | { kind: 'above'; right: number; bottom: number; maxWidthPx: number };

  let entryMenuPos = $state<EntryMenuPlacement>({
    kind: 'below',
    right: 0,
    top: 0,
    maxWidthPx: 280,
  });
  let focusMenuPos = $state<EntryMenuPlacement>({
    kind: 'below',
    right: 0,
    top: 0,
    maxWidthPx: 280,
  });
  let upcomingMenuPos = $state<EntryMenuPlacement>({
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
  let newFocus = $state('');
  let newUpcoming = $state('');
  let noteText = $state('');
  /** Pointer-based reorder (HTML5 DnD is unreliable in Tauri WKWebView). */
  const REORDER_THRESHOLD_PX = 8;
  type ListKind = 'task' | 'focus' | 'upcoming';
  type PendingPointer = { x: number; y: number; entityId: number; kind: ListKind; pointerId: number };
  let pendingPointer: PendingPointer | null = null;
  let reorderActive = $state(false);
  /** Where the dragged item came from (locked at pointerdown). */
  let reorderSourceKind = $state<ListKind | null>(null);
  let reorderSourceId = $state<number | null>(null);
  /** Where the dragged item would land (updates as the pointer moves over lists). */
  let reorderTargetKind = $state<ListKind | null>(null);
  /** Insert before this index in the target list (0..length); only visual until pointerup. */
  let reorderInsertSlot = $state<number | null>(null);
  let ignoreClickAfterDrag = false;

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
  let focusEntries = $derived(data.focusEntries);
  let upcomingEntries = $derived(data.upcomingEntries);
  let emojiRules = $derived(data.emojiRules);
  let mentions = $derived(data.mentions);

  type InputKind = 'task' | 'focus' | 'upcoming';
  let mentionInputState = $state<{
    kind: InputKind;
    el: HTMLInputElement;
    startIndex: number;
    query: string;
    selectedIndex: number;
    placement: MentionPickerPlacement;
  } | null>(null);

  const filteredMentionsForInput = $derived.by(() => {
    if (!mentionInputState) return [];
    const q = mentionInputState.query.toLowerCase();
    if (!q) return mentions;
    return mentions.filter((u) => u.toLowerCase().includes(q));
  });

  function computeMentionInputPlacement(el: HTMLElement): MentionPickerPlacement {
    const rect = el.getBoundingClientRect();
    const estH = 200;
    const spaceBelow = window.innerHeight - rect.bottom;
    if (spaceBelow >= estH || spaceBelow >= rect.top) {
      return { kind: 'below', left: rect.left, top: rect.bottom + 4 };
    }
    return { kind: 'above', left: rect.left, bottom: window.innerHeight - rect.top + 4 };
  }

  function refreshMentionInputState(kind: InputKind, el: HTMLInputElement) {
    const caret = el.selectionStart ?? 0;
    const trigger = detectMentionTrigger(el.value, caret);
    if (!trigger) {
      mentionInputState = null;
      return;
    }
    const prev = mentionInputState;
    mentionInputState = {
      kind,
      el,
      startIndex: trigger.startIndex,
      query: trigger.query,
      selectedIndex:
        prev && prev.kind === kind && prev.startIndex === trigger.startIndex ? prev.selectedIndex : 0,
      placement: computeMentionInputPlacement(el),
    };
  }

  function applyMentionToInput(username: string) {
    if (!mentionInputState) return;
    const { el, startIndex, kind } = mentionInputState;
    const caret = el.selectionStart ?? el.value.length;
    const result = insertMention(el.value, startIndex, caret, username);
    if (kind === 'task') newTask = result.value;
    else if (kind === 'focus') newFocus = result.value;
    else newUpcoming = result.value;
    mentionInputState = null;
    requestAnimationFrame(() => {
      el.focus();
      el.setSelectionRange(result.caret, result.caret);
    });
  }

  function handleMentionAwareKeydown(kind: InputKind, e: KeyboardEvent): boolean {
    if (!mentionInputState || mentionInputState.kind !== kind) return false;
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      const len = filteredMentionsForInput.length || 1;
      mentionInputState = {
        ...mentionInputState,
        selectedIndex: (mentionInputState.selectedIndex + 1) % len,
      };
      return true;
    }
    if (e.key === 'ArrowUp') {
      e.preventDefault();
      const len = filteredMentionsForInput.length || 1;
      mentionInputState = {
        ...mentionInputState,
        selectedIndex: (mentionInputState.selectedIndex - 1 + len) % len,
      };
      return true;
    }
    if (e.key === 'Escape') {
      e.preventDefault();
      mentionInputState = null;
      return true;
    }
    if (e.key === 'Enter' || e.key === 'Tab') {
      const username =
        filteredMentionsForInput.length > 0
          ? filteredMentionsForInput[mentionInputState.selectedIndex]
          : mentionInputState.query.trim();
      if (username) {
        e.preventDefault();
        applyMentionToInput(username);
        return true;
      }
      mentionInputState = null;
    }
    return false;
  }

  $effect(() => {
    noteText = data.dayRow?.note ?? '';
  });

  async function saveNote(value: string) {
    const trimmed = value.trim();
    await updateDayNote(data.date, trimmed ? trimmed : null);
    if (trimmed) await syncMentionsFromText(trimmed);
    await invalidateAll();
  }

  function listItemsFor(kind: ListKind) {
    if (kind === 'task') return tasks;
    if (kind === 'focus') return focusEntries;
    return upcomingEntries;
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

  function pointerEventToTarget(e: PointerEvent): { kind: ListKind; slot: number } | null {
    const hit = document.elementFromPoint(e.clientX, e.clientY) as HTMLElement | null;
    const row = hit?.closest('[data-row-list]') as HTMLElement | null;
    if (row) {
      const kind = row.dataset.rowList as ListKind | undefined;
      if (kind === 'task' || kind === 'focus' || kind === 'upcoming') {
        const id = Number(row.dataset.rowId);
        const items = listItemsFor(kind);
        const idx = items.findIndex((t) => t.id === id);
        if (idx >= 0) {
          const rect = row.getBoundingClientRect();
          const before = e.clientY < rect.top + rect.height / 2;
          return { kind, slot: before ? idx : idx + 1 };
        }
      }
    }
    const section = hit?.closest('[data-list-section]') as HTMLElement | null;
    if (section) {
      const kind = section.dataset.listSection as ListKind | undefined;
      if (kind === 'task' || kind === 'focus' || kind === 'upcoming') {
        return { kind, slot: listItemsFor(kind).length };
      }
    }
    return null;
  }

  function toggleEmojiDropdown(taskId: number, ev: MouseEvent) {
    if (emojiDropdownOpen === taskId) {
      emojiDropdownOpen = null;
    } else {
      dayHeaderMenuOpen = false;
      entryMenuOpen = null;
      const rect = (ev.currentTarget as HTMLElement).getBoundingClientRect();
      emojiDropdownPos = computeEmojiDropdownPosition(rect);
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
    if (ignoreClickAfterDrag) {
      ignoreClickAfterDrag = false;
      ev.preventDefault();
      ev.stopPropagation();
      return;
    }
    toggleEmojiDropdown(taskId, ev);
  }

  function resetReorderState() {
    pendingPointer = null;
    reorderActive = false;
    reorderSourceKind = null;
    reorderSourceId = null;
    reorderTargetKind = null;
    reorderInsertSlot = null;
  }

  function handleReorderPointerDown(entityId: number, kind: ListKind, e: PointerEvent) {
    if (e.button !== 0) return;
    pendingPointer = { x: e.clientX, y: e.clientY, entityId, kind, pointerId: e.pointerId };
  }

  function handleReorderPointerMove(el: HTMLElement, e: PointerEvent) {
    if (pendingPointer && e.pointerId !== pendingPointer.pointerId) return;

    if (pendingPointer && !reorderActive) {
      const dx = e.clientX - pendingPointer.x;
      const dy = e.clientY - pendingPointer.y;
      if (Math.hypot(dx, dy) < REORDER_THRESHOLD_PX) return;
      reorderActive = true;
      reorderSourceKind = pendingPointer.kind;
      reorderSourceId = pendingPointer.entityId;
      reorderTargetKind = pendingPointer.kind;
      reorderInsertSlot = null;
      el.setPointerCapture(e.pointerId);
    }

    if (!reorderActive) return;

    e.preventDefault();
    getSelection()?.removeAllRanges();
    const src = reorderSourceId;
    const srcKind = reorderSourceKind;
    if (src == null || srcKind == null) return;
    const target = pointerEventToTarget(e);
    if (!target) return;
    reorderTargetKind = target.kind;
    if (target.kind === srcKind) {
      const ids = listItemsFor(srcKind).map((t) => t.id);
      const next = orderIdsWithInsert(ids, src, target.slot);
      reorderInsertSlot = sameIdOrder(ids, next) ? null : target.slot;
    } else {
      reorderInsertSlot = target.slot;
    }
  }

  async function handleReorderPointerUp(el: HTMLElement, e: PointerEvent) {
    if (pendingPointer && e.pointerId !== pendingPointer.pointerId) return;

    if (reorderActive) {
      const src = reorderSourceId;
      const slot = reorderInsertSlot;
      const srcKind = reorderSourceKind;
      const tgtKind = reorderTargetKind;
      try {
        el.releasePointerCapture(e.pointerId);
      } catch {
        /* not capturing */
      }
      if (src != null && slot != null && srcKind != null && tgtKind != null) {
        if (srcKind === tgtKind) {
          const ids = listItemsFor(srcKind).map((t) => t.id);
          const next = orderIdsWithInsert(ids, src, slot);
          if (!sameIdOrder(ids, next)) {
            const persist =
              srcKind === 'task'
                ? reorderTasksForDate(data.date, next)
                : reorderDayEntries(data.date, srcKind, next);
            persist.then(() => invalidateAll());
            ignoreClickAfterDrag = true;
          }
        } else {
          let emojiForLog: string | null = null;
          if (tgtKind === 'task') {
            const srcItem = listItemsFor(srcKind).find((x) => x.id === src);
            const content = srcItem?.content ?? '';
            emojiForLog =
              tryAutoAssignEmoji(content, emojiRules) ?? (await getCompletedDefaultEmojiSetting());
          }
          const newId = await moveItemBetweenLists(data.date, srcKind, src, tgtKind, emojiForLog);
          const targetIds = listItemsFor(tgtKind).map((x) => x.id);
          const pos = Math.max(0, Math.min(slot, targetIds.length));
          targetIds.splice(pos, 0, newId);
          if (tgtKind === 'task') {
            await reorderTasksForDate(data.date, targetIds);
          } else {
            await reorderDayEntries(data.date, tgtKind, targetIds);
          }
          await invalidateAll();
          ignoreClickAfterDrag = true;
        }
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

  async function handleAddTask() {
    const content = newTask.trim();
    if (!content) return;
    const emojiId = tryAutoAssignEmoji(content, emojiRules);
    await addTask(data.date, content, emojiId);
    await syncMentionsFromText(content);
    newTask = '';
    await invalidateAll();
  }

  function handleKeydown(e: KeyboardEvent) {
    if (handleMentionAwareKeydown('task', e)) return;
    if (e.key === 'Enter') handleAddTask();
  }

  async function handleUpdateContent(id: number, content: string) {
    await updateTask(id, { content });
    if (content.trim()) await syncMentionsFromText(content);
    await invalidateAll();
  }

  function handleDelete(id: number) {
    entryMenuOpen = null;
    deleteTask(id).then(() => invalidateAll());
  }

  function handleTogglePinned(id: number, pinned: boolean) {
    entryMenuOpen = null;
    updateTask(id, { pinned }).then(() => invalidateAll());
  }

  async function handleAddFocus() {
    const content = newFocus.trim();
    if (!content) return;
    await addDayEntry(data.date, 'focus', content);
    await syncMentionsFromText(content);
    newFocus = '';
    await invalidateAll();
  }

  function handleFocusKeydown(e: KeyboardEvent) {
    if (handleMentionAwareKeydown('focus', e)) return;
    if (e.key === 'Enter') handleAddFocus();
  }

  async function handleAddUpcoming() {
    const content = newUpcoming.trim();
    if (!content) return;
    await addDayEntry(data.date, 'upcoming', content);
    await syncMentionsFromText(content);
    newUpcoming = '';
    await invalidateAll();
  }

  function handleUpcomingKeydown(e: KeyboardEvent) {
    if (handleMentionAwareKeydown('upcoming', e)) return;
    if (e.key === 'Enter') handleAddUpcoming();
  }

  async function handleUpdateDayEntry(id: number, content: string) {
    await updateDayEntryContent(id, content);
    if (content.trim()) await syncMentionsFromText(content);
    await invalidateAll();
  }

  function handleDeleteFocusEntry(id: number) {
    focusMenuOpen = null;
    deleteDayEntry(id).then(() => invalidateAll());
  }

  function handleDeleteUpcomingEntry(id: number) {
    upcomingMenuOpen = null;
    deleteDayEntry(id).then(() => invalidateAll());
  }

  async function handleCompleteFocus(id: number, content: string) {
    let emojiId = tryAutoAssignEmoji(content, emojiRules);
    if (!emojiId) emojiId = await getCompletedDefaultEmojiSetting();
    await completeFocusEntry(id, emojiId);
    await invalidateAll();
  }

  function onFocusCheckboxClick(id: number, content: string, ev: MouseEvent) {
    if (ignoreClickAfterDrag) {
      ignoreClickAfterDrag = false;
      ev.preventDefault();
      ev.stopPropagation();
      return;
    }
    handleCompleteFocus(id, content);
  }

  function toggleUpcomingEmojiDropdown(entryId: number, ev: MouseEvent) {
    if (upcomingEmojiDropdownOpen === entryId) {
      upcomingEmojiDropdownOpen = null;
    } else {
      dayHeaderMenuOpen = false;
      emojiDropdownOpen = null;
      entryMenuOpen = null;
      focusMenuOpen = null;
      upcomingMenuOpen = null;
      const rect = (ev.currentTarget as HTMLElement).getBoundingClientRect();
      upcomingEmojiDropdownPos = computeEmojiDropdownPosition(rect);
      upcomingEmojiDropdownOpen = entryId;
    }
  }

  function onUpcomingEmojiActivatorClick(entryId: number, ev: MouseEvent) {
    if (ignoreClickAfterDrag) {
      ignoreClickAfterDrag = false;
      ev.preventDefault();
      ev.stopPropagation();
      return;
    }
    toggleUpcomingEmojiDropdown(entryId, ev);
  }

  function selectUpcomingEmoji(entryId: number, emojiId: string | null) {
    updateDayEntryEmoji(entryId, emojiId).then(() => invalidateAll());
    upcomingEmojiDropdownOpen = null;
  }

  function toggleFocusMenu(entryId: number, ev: MouseEvent) {
    if (focusMenuOpen === entryId) {
      focusMenuOpen = null;
    } else {
      dayHeaderMenuOpen = false;
      emojiDropdownOpen = null;
      entryMenuOpen = null;
      upcomingMenuOpen = null;
      const rect = (ev.currentTarget as HTMLElement).getBoundingClientRect();
      focusMenuPos = computeEntryMenuPosition(rect);
      focusMenuOpen = entryId;
    }
  }

  function toggleUpcomingMenu(entryId: number, ev: MouseEvent) {
    if (upcomingMenuOpen === entryId) {
      upcomingMenuOpen = null;
    } else {
      dayHeaderMenuOpen = false;
      emojiDropdownOpen = null;
      entryMenuOpen = null;
      focusMenuOpen = null;
      const rect = (ev.currentTarget as HTMLElement).getBoundingClientRect();
      upcomingMenuPos = computeEntryMenuPosition(rect);
      upcomingMenuOpen = entryId;
    }
  }

  /** Manual emoji change: just set emoji_id, no pattern matching. */
  function handleEmojiDrop(entryId: number, emojiId: string | null) {
    setEntryEmoji(entryId, emojiId).then(() => invalidateAll());
  }

  async function copyToSlack() {
    const rules = emojiRules.length ? emojiRules : await getEmojiRules();
    const sections: string[] = [];
    if (tasks.length > 0) {
      sections.push(tasks.map((t) => formatLineForSlack(t, rules)).join('\n'));
    }
    if (focusEntries.length > 0 || upcomingEntries.length > 0) {
      const focusFallback =
        (await getIncompleteFocusDefaultEmojiSetting()) ??
        (await getUpcomingDefaultEmojiSetting());
      const carriedFocus = focusEntries.map((e) => ({ ...e, emoji_id: focusFallback }));
      const upcomingLines = [...carriedFocus, ...upcomingEntries]
        .map((e) => formatLineForSlack(e, rules))
        .join('\n');
      sections.push(`Upcoming:\n${upcomingLines}`);
    }
    const text = sections.join('\n\n');
    if (!text) return;
    await clipboardWriteText(text);
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
  <header class="flex items-center justify-between p-2 border-b border-gray-300 dark:border-gray-700 shrink-0">
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
        class="fixed z-50 bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600 rounded shadow-lg py-1 min-w-[160px] w-max text-left"
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
    <div class="pb-2" data-list-section="focus">
      <div class="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">Focus</div>
      <ul class="space-y-1 overflow-visible">
        {#if reorderActive && reorderTargetKind === 'focus' && focusEntries.length === 0 && reorderInsertSlot === 0}
          <li
            class="pointer-events-none relative h-0.5 rounded-full bg-blue-500 dark:bg-blue-400 shadow-sm"
            aria-hidden="true"
          ></li>
        {/if}
        {#each focusEntries as entry, i (entry.id)}
          <li
            data-row-list="focus"
            data-row-id={entry.id}
            class="flex items-start gap-2 group relative rounded overflow-visible {reorderSourceKind === 'focus' && reorderSourceId === entry.id
              ? 'opacity-50'
              : ''}"
          >
            {#if reorderActive && reorderTargetKind === 'focus' && reorderInsertSlot === i}
              <div
                class="pointer-events-none absolute left-0 right-0 top-0 z-10 h-0.5 -translate-y-1/2 rounded-full bg-blue-500 dark:bg-blue-400 shadow-sm"
                aria-hidden="true"
              ></div>
            {/if}
            {#if reorderActive && reorderTargetKind === 'focus' && reorderInsertSlot === focusEntries.length && i === focusEntries.length - 1}
              <div
                class="pointer-events-none absolute left-0 right-0 bottom-0 z-10 h-0.5 translate-y-1/2 rounded-full bg-blue-500 dark:bg-blue-400 shadow-sm"
                aria-hidden="true"
              ></div>
            {/if}
            <button
              type="button"
              onclick={(e) => onFocusCheckboxClick(entry.id, entry.content, e)}
              onpointerdown={(e) => handleReorderPointerDown(entry.id, 'focus', e)}
              onpointermove={(e) => handleReorderPointerMove(e.currentTarget as HTMLElement, e)}
              onpointerup={(e) => handleReorderPointerUp(e.currentTarget as HTMLElement, e)}
              onpointercancel={(e) => handleReorderPointerUp(e.currentTarget as HTMLElement, e)}
              aria-label="Complete focus entry; drag to reorder"
              class="appearance-none p-0 w-8 h-8 shrink-0 flex items-center justify-center rounded border border-gray-300 dark:border-gray-600 hover:border-blue-500 dark:hover:border-blue-400 bg-transparent cursor-grab active:cursor-grabbing touch-none select-none"
            ></button>
            <RichText
              value={entry.content}
              onSave={(val) => handleUpdateDayEntry(entry.id, val)}
              saveOn="enter"
              onEmptyBackspace={() => handleDeleteFocusEntry(entry.id)}
              wrapperClass="flex-1 min-w-0"
              {mentions}
              class="text-sm px-1 py-1 border-0 border-b border-transparent hover:border-gray-300 dark:hover:border-gray-600 focus:border-blue-500 focus:outline-none bg-transparent resize-none overflow-y-auto max-h-24 break-words pr-8"
            />
            <div class="absolute right-0 top-0 flex items-center gap-0.5">
              <button
                type="button"
                onclick={(e) => toggleFocusMenu(entry.id, e)}
                class="p-1 rounded text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 transition-opacity duration-150 {reorderActive || focusMenuOpen === entry.id
                  ? 'opacity-100 pointer-events-auto'
                  : 'opacity-0 pointer-events-none group-hover:opacity-100 group-hover:pointer-events-auto'}"
                aria-label="Focus entry options"
                aria-expanded={focusMenuOpen === entry.id}
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
            {#if focusMenuOpen === entry.id}
              <div
                role="menu"
                tabindex="-1"
                class="fixed z-50 bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600 rounded shadow-lg py-1 min-w-[160px] w-max text-left"
                style:right="{focusMenuPos.right}px"
                style:left="auto"
                style:top={focusMenuPos.kind === 'below' ? `${focusMenuPos.top}px` : undefined}
                style:bottom={focusMenuPos.kind === 'above' ? `${focusMenuPos.bottom}px` : undefined}
                style:max-width="{focusMenuPos.maxWidthPx}px"
                onclick={(e) => e.stopPropagation()}
                onkeydown={(e) => e.stopPropagation()}
              >
                <button
                  type="button"
                  role="menuitem"
                  onclick={() => handleDeleteFocusEntry(entry.id)}
                  class="w-full px-3 py-1.5 text-left text-sm text-red-600 hover:bg-red-50 dark:hover:bg-red-900/30"
                >
                  Delete
                </button>
              </div>
            {/if}
          </li>
        {/each}
      </ul>
      <div class="pt-1 flex gap-2">
        <input
          type="text"
          bind:value={newFocus}
          onkeydown={handleFocusKeydown}
          oninput={(e) => refreshMentionInputState('focus', e.currentTarget as HTMLInputElement)}
          onkeyup={(e) => refreshMentionInputState('focus', e.currentTarget as HTMLInputElement)}
          onclick={(e) => refreshMentionInputState('focus', e.currentTarget as HTMLInputElement)}
          onblur={() => { if (mentionInputState?.kind === 'focus') mentionInputState = null; }}
          placeholder="Add focus..."
          class="flex-1 min-w-0 text-sm px-2 py-1 border border-gray-300 dark:border-gray-600 rounded bg-white dark:bg-gray-800"
        />
      </div>
    </div>
    <div
      class="my-4 border-t border-gray-300 dark:border-gray-700"
      aria-hidden="true"
    ></div>
    <div class="pt-2" data-list-section="task">
      <div class="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">Log</div>
    <ul class="space-y-1 overflow-visible">
      {#if reorderActive && reorderTargetKind === 'task' && tasks.length === 0 && reorderInsertSlot === 0}
        <li
          class="pointer-events-none relative h-0.5 rounded-full bg-blue-500 dark:bg-blue-400 shadow-sm"
          aria-hidden="true"
        ></li>
      {/if}
      {#each tasks as task, i (task.id)}
        <li
          data-row-list="task"
          data-row-id={task.id}
          class="flex items-start gap-2 group relative rounded overflow-visible {reorderSourceKind === 'task' && reorderSourceId === task.id
            ? 'opacity-50'
            : ''}"
        >
          {#if reorderActive && reorderTargetKind === 'task' && reorderInsertSlot === i}
            <div
              class="pointer-events-none absolute left-0 right-0 top-0 z-10 h-0.5 -translate-y-1/2 rounded-full bg-blue-500 dark:bg-blue-400 shadow-sm"
              aria-hidden="true"
            ></div>
          {/if}
          {#if reorderActive && reorderTargetKind === 'task' && reorderInsertSlot === tasks.length && i === tasks.length - 1}
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
            class="emoji-drag-handle w-8 h-8 shrink-0 flex items-center justify-center border border-gray-300 dark:border-gray-600 rounded cursor-grab active:cursor-grabbing relative touch-none select-none"
            onclick={(e) => onEmojiActivatorClick(task.id, e)}
            onkeydown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                onEmojiActivatorClick(task.id, e as unknown as MouseEvent);
              }
            }}
            onpointerdown={(e) => handleReorderPointerDown(task.id, 'task', e)}
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
            <EmojiPicker
              rules={emojiRules}
              currentEmojiId={task.emoji_id}
              placement={emojiDropdownPos}
              onSelect={(id) => selectEmoji(task.id, id)}
            />
          {/if}
          <RichText
            value={task.content}
            onSave={(val) => handleUpdateContent(task.id, val)}
            saveOn="enter"
            onEmptyBackspace={() => handleDelete(task.id)}
            wrapperClass="flex-1 min-w-0"
            {mentions}
            class="text-sm px-1 py-1 border-0 border-b border-transparent hover:border-gray-300 dark:hover:border-gray-600 focus:border-blue-500 focus:outline-none bg-transparent resize-none overflow-y-auto max-h-24 break-words {task.pinned ? 'pr-14' : 'pr-8'}"
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
              class="fixed z-50 bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600 rounded shadow-lg py-1 min-w-[160px] w-max text-left"
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
      <div class="pt-1 flex gap-2">
        <input
          type="text"
          bind:value={newTask}
          onkeydown={handleKeydown}
          oninput={(e) => refreshMentionInputState('task', e.currentTarget as HTMLInputElement)}
          onkeyup={(e) => refreshMentionInputState('task', e.currentTarget as HTMLInputElement)}
          onclick={(e) => refreshMentionInputState('task', e.currentTarget as HTMLInputElement)}
          onblur={() => { if (mentionInputState?.kind === 'task') mentionInputState = null; }}
          placeholder="Add task..."
          class="flex-1 min-w-0 text-sm px-2 py-1 border border-gray-300 dark:border-gray-600 rounded bg-white dark:bg-gray-800"
        />
      </div>
    </div>
    <div
      class="my-4 border-t border-gray-300 dark:border-gray-700"
      aria-hidden="true"
    ></div>
    <div class="pt-2" data-list-section="upcoming">
      <div class="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">Upcoming</div>
      <ul class="space-y-1 overflow-visible">
        {#if reorderActive && reorderTargetKind === 'upcoming' && upcomingEntries.length === 0 && reorderInsertSlot === 0}
          <li
            class="pointer-events-none relative h-0.5 rounded-full bg-blue-500 dark:bg-blue-400 shadow-sm"
            aria-hidden="true"
          ></li>
        {/if}
        {#each upcomingEntries as entry, i (entry.id)}
          <li
            data-row-list="upcoming"
            data-row-id={entry.id}
            class="flex items-start gap-2 group relative rounded overflow-visible {reorderSourceKind === 'upcoming' && reorderSourceId === entry.id
              ? 'opacity-50'
              : ''}"
          >
            {#if reorderActive && reorderTargetKind === 'upcoming' && reorderInsertSlot === i}
              <div
                class="pointer-events-none absolute left-0 right-0 top-0 z-10 h-0.5 -translate-y-1/2 rounded-full bg-blue-500 dark:bg-blue-400 shadow-sm"
                aria-hidden="true"
              ></div>
            {/if}
            {#if reorderActive && reorderTargetKind === 'upcoming' && reorderInsertSlot === upcomingEntries.length && i === upcomingEntries.length - 1}
              <div
                class="pointer-events-none absolute left-0 right-0 bottom-0 z-10 h-0.5 translate-y-1/2 rounded-full bg-blue-500 dark:bg-blue-400 shadow-sm"
                aria-hidden="true"
              ></div>
            {/if}
            <div
              role="button"
              aria-label="Change emoji; drag to reorder"
              tabindex="0"
              class="emoji-drag-handle w-8 h-8 shrink-0 flex items-center justify-center border border-gray-300 dark:border-gray-600 rounded cursor-grab active:cursor-grabbing relative touch-none select-none"
              onclick={(e) => onUpcomingEmojiActivatorClick(entry.id, e)}
              onkeydown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  onUpcomingEmojiActivatorClick(entry.id, e as unknown as MouseEvent);
                }
              }}
              onpointerdown={(e) => handleReorderPointerDown(entry.id, 'upcoming', e)}
              onpointermove={(e) => handleReorderPointerMove(e.currentTarget as HTMLElement, e)}
              onpointerup={(e) => handleReorderPointerUp(e.currentTarget as HTMLElement, e)}
              onpointercancel={(e) => handleReorderPointerUp(e.currentTarget as HTMLElement, e)}
            >
              {#if entry.emoji_id}
                {#each emojiRules as rule (rule.id)}
                  {#if rule.id === entry.emoji_id}
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
            {#if upcomingEmojiDropdownOpen === entry.id}
              <EmojiPicker
                rules={emojiRules}
                currentEmojiId={entry.emoji_id}
                placement={upcomingEmojiDropdownPos}
                onSelect={(id) => selectUpcomingEmoji(entry.id, id)}
              />
            {/if}
            <RichText
              value={entry.content}
              onSave={(val) => handleUpdateDayEntry(entry.id, val)}
              saveOn="enter"
              onEmptyBackspace={() => handleDeleteUpcomingEntry(entry.id)}
              wrapperClass="flex-1 min-w-0"
              {mentions}
              class="text-sm px-1 py-1 border-0 border-b border-transparent hover:border-gray-300 dark:hover:border-gray-600 focus:border-blue-500 focus:outline-none bg-transparent resize-none overflow-y-auto max-h-24 break-words pr-8"
            />
            <div class="absolute right-0 top-0 flex items-center gap-0.5">
              <button
                type="button"
                onclick={(e) => toggleUpcomingMenu(entry.id, e)}
                class="p-1 rounded text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 transition-opacity duration-150 {reorderActive || upcomingMenuOpen === entry.id
                  ? 'opacity-100 pointer-events-auto'
                  : 'opacity-0 pointer-events-none group-hover:opacity-100 group-hover:pointer-events-auto'}"
                aria-label="Upcoming entry options"
                aria-expanded={upcomingMenuOpen === entry.id}
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
            {#if upcomingMenuOpen === entry.id}
              <div
                role="menu"
                tabindex="-1"
                class="fixed z-50 bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600 rounded shadow-lg py-1 min-w-[160px] w-max text-left"
                style:right="{upcomingMenuPos.right}px"
                style:left="auto"
                style:top={upcomingMenuPos.kind === 'below' ? `${upcomingMenuPos.top}px` : undefined}
                style:bottom={upcomingMenuPos.kind === 'above' ? `${upcomingMenuPos.bottom}px` : undefined}
                style:max-width="{upcomingMenuPos.maxWidthPx}px"
                onclick={(e) => e.stopPropagation()}
                onkeydown={(e) => e.stopPropagation()}
              >
                <button
                  type="button"
                  role="menuitem"
                  onclick={() => handleDeleteUpcomingEntry(entry.id)}
                  class="w-full px-3 py-1.5 text-left text-sm text-red-600 hover:bg-red-50 dark:hover:bg-red-900/30"
                >
                  Delete
                </button>
              </div>
            {/if}
          </li>
        {/each}
      </ul>
      <div class="pt-1 flex gap-2">
        <input
          type="text"
          bind:value={newUpcoming}
          onkeydown={handleUpcomingKeydown}
          oninput={(e) => refreshMentionInputState('upcoming', e.currentTarget as HTMLInputElement)}
          onkeyup={(e) => refreshMentionInputState('upcoming', e.currentTarget as HTMLInputElement)}
          onclick={(e) => refreshMentionInputState('upcoming', e.currentTarget as HTMLInputElement)}
          onblur={() => { if (mentionInputState?.kind === 'upcoming') mentionInputState = null; }}
          placeholder="Add upcoming..."
          class="flex-1 min-w-0 text-sm px-2 py-1 border border-gray-300 dark:border-gray-600 rounded bg-white dark:bg-gray-800"
        />
      </div>
    </div>
    <div
      class="my-4 border-t border-gray-300 dark:border-gray-700"
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
        {mentions}
        class="text-sm px-2 py-2 border border-gray-300 dark:border-gray-600 rounded bg-white dark:bg-gray-800 resize-none"
      />
    </div>
  </section>

  <footer class="p-2 border-t border-gray-300 dark:border-gray-700 shrink-0 flex items-center gap-2">
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
      disabled={tasks.length === 0 && upcomingEntries.length === 0 && focusEntries.length === 0}
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

{#if emojiDropdownOpen !== null || upcomingEmojiDropdownOpen !== null || entryMenuOpen !== null || focusMenuOpen !== null || upcomingMenuOpen !== null || dayHeaderMenuOpen}
  <button
    type="button"
    class="fixed inset-0 z-40"
    aria-label="Close menu"
    onclick={() => {
      emojiDropdownOpen = null;
      upcomingEmojiDropdownOpen = null;
      entryMenuOpen = null;
      focusMenuOpen = null;
      upcomingMenuOpen = null;
      dayHeaderMenuOpen = false;
    }}
  ></button>
{/if}

<NavDrawer open={drawerOpen} onclose={closeDrawer} />

{#if mentionInputState}
  <MentionPicker
    usernames={filteredMentionsForInput}
    query={mentionInputState.query}
    selectedIndex={mentionInputState.selectedIndex}
    placement={mentionInputState.placement}
    onSelect={applyMentionToInput}
  />
{/if}
