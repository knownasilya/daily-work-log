<script lang="ts">
  import autosize from 'svelte-autosize';
  import { renderText } from '$lib/richtext';
  import { openUrl } from '@tauri-apps/plugin-opener';

  interface Props {
    value: string;
    onSave: (value: string) => void;
    placeholder?: string;
    /** Layout/sizing classes for the outer wrapper (flex-1, min-w-0, w-full, etc.) */
    wrapperClass?: string;
    /** Visual classes applied to both the textarea and the rendered div (border, bg, padding, font-size, etc.) */
    class?: string;
    rows?: number;
    /** 'enter' = plain Enter saves (log entries); 'cmdenter' = Cmd/Ctrl+Enter saves (focus, notes) */
    saveOn?: 'enter' | 'cmdenter';
    /** Called when Backspace is pressed in an empty field (log entries) */
    onEmptyBackspace?: () => void;
    /** If true, uses ResizeObserver to re-measure autosize after layout changes */
    resync?: boolean;
    /** Changes to this key trigger a resize re-measure when resync=true */
    resyncKey?: string;
    id?: string;
  }

  let {
    value,
    onSave,
    placeholder = '',
    wrapperClass = '',
    class: cls = '',
    rows = 1,
    saveOn = 'cmdenter',
    onEmptyBackspace,
    resync = false,
    resyncKey = '',
    id,
  }: Props = $props();

  let editing = $state(false);
  let textareaEl = $state<HTMLTextAreaElement | null>(null);
  let dragStartOffset = $state<number | null>(null);

  function startEditing() {
    editing = true;
    requestAnimationFrame(() => textareaEl?.focus());
  }

  function handleBlur(e: FocusEvent) {
    editing = false;
    onSave((e.currentTarget as HTMLTextAreaElement).value);
  }

  function handleKeydown(e: KeyboardEvent) {
    const ta = e.currentTarget as HTMLTextAreaElement;
    if (saveOn === 'enter' && e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      ta.blur();
    }
    if (saveOn === 'cmdenter' && e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      ta.blur();
    }
    if (e.key === 'Backspace' && !ta.value) {
      e.preventDefault();
      onEmptyBackspace?.();
    }
  }

  /**
   * Walk the rendered div's DOM and count plain-text characters up to targetNode/targetOffset.
   * Text nodes contribute their length; <br> contributes 1 (\n); elements recurse.
   * Elements with `data-source-length` (rendered links) are opaque — they contribute
   * that length and aren't descended into, since their display text may be shorter
   * than the original source span (e.g. `[name](url)` displays just `name`).
   * For element targets, targetOffset is a child index.
   */
  function getPlainTextOffset(root: HTMLElement, targetNode: Node, targetOffset: number): number {
    let count = 0;

    function sourceLen(node: Node): number | null {
      if (node instanceof HTMLElement && node.dataset.sourceLength) {
        const n = Number(node.dataset.sourceLength);
        return Number.isFinite(n) ? n : null;
      }
      return null;
    }

    function countFull(node: Node) {
      if (node.nodeType === Node.TEXT_NODE) {
        count += (node as Text).length;
      } else if ((node as Element).tagName === 'BR') {
        count += 1;
      } else {
        const sl = sourceLen(node);
        if (sl !== null) {
          count += sl;
          return;
        }
        for (const child of node.childNodes) countFull(child);
      }
    }

    function walk(node: Node): boolean {
      if (node === targetNode) {
        if (node.nodeType === Node.TEXT_NODE) {
          count += targetOffset;
        } else {
          // Element node: targetOffset is a child index
          for (let i = 0; i < targetOffset; i++) countFull(node.childNodes[i]);
        }
        return true;
      }
      if (node.nodeType === Node.TEXT_NODE) {
        count += (node as Text).length;
        return false;
      }
      if ((node as Element).tagName === 'BR') {
        count += 1;
        return false;
      }
      const sl = sourceLen(node);
      if (sl !== null) {
        count += sl;
        return false;
      }
      for (const child of node.childNodes) {
        if (walk(child)) return true;
      }
      return false;
    }

    // targetNode may be the root itself (e.g. on triple-click or drag-to-boundary).
    // In that case targetOffset is a child index within root.
    if (targetNode === root) {
      for (let i = 0; i < targetOffset; i++) countFull(root.childNodes[i]);
      return count;
    }

    // Guard: ignore if the node is outside our root (shouldn't happen normally).
    if (!root.contains(targetNode)) return 0;

    for (const child of root.childNodes) {
      if (walk(child)) break;
    }
    return count;
  }

  function handleRenderedPointerDown(e: MouseEvent) {
    if ((e.target as HTMLElement).closest('a')) return;
    const div = e.currentTarget as HTMLElement;
    const range = document.caretRangeFromPoint?.(e.clientX, e.clientY);
    dragStartOffset = range ? getPlainTextOffset(div, range.startContainer, range.startOffset) : null;
  }

  function handleRenderedPointerUp(e: MouseEvent) {
    const url = (e.target as HTMLElement).closest('a')?.getAttribute('data-url');
    if (url) {
      e.preventDefault();
      openUrl(url);
      return;
    }

    const div = e.currentTarget as HTMLElement;
    const range = document.caretRangeFromPoint?.(e.clientX, e.clientY);
    const endOffset = range ? getPlainTextOffset(div, range.startContainer, range.startOffset) : null;

    let selStart: number | null = null;
    let selEnd: number | null = null;
    let selDir: 'forward' | 'backward' | undefined;

    if (dragStartOffset !== null && endOffset !== null && dragStartOffset !== endOffset) {
      selStart = Math.min(dragStartOffset, endOffset);
      selEnd   = Math.max(dragStartOffset, endOffset);
      selDir   = dragStartOffset <= endOffset ? 'forward' : 'backward';
    } else if (endOffset !== null) {
      selStart = selEnd = endOffset;
    }

    dragStartOffset = null;
    document.getSelection()?.removeAllRanges();

    editing = true;
    requestAnimationFrame(() => {
      if (textareaEl) {
        textareaEl.focus();
        if (selStart !== null && selEnd !== null) {
          textareaEl.setSelectionRange(selStart, selEnd, selDir);
        }
      }
    });
  }

  function handleRenderedKeydown(e: KeyboardEvent) {
    if (e.key === 'Enter' || e.key === ' ') startEditing();
  }

  // ResizeObserver-based autosize re-measure (mirrors the autosizeResync directive)
  function withResync(node: HTMLTextAreaElement) {
    autosize(node);
    const bump = () => autosize.update(node);
    const ro = new ResizeObserver(bump);
    ro.observe(node);
    requestAnimationFrame(() => requestAnimationFrame(bump));
    return {
      destroy() {
        ro.disconnect();
        autosize.destroy(node);
      },
    };
  }

  // Re-measure when resyncKey changes (value updated externally)
  $effect(() => {
    resyncKey;
    if (textareaEl) {
      requestAnimationFrame(() => autosize.update(textareaEl!));
    }
  });
</script>

<!--
  Both the textarea and the rendered div are always in the DOM, stacked in the
  same CSS grid cell. The grid height = max(textarea height, div height), so it
  never shifts when toggling between edit and view modes. opacity + pointer-events
  are used to show/hide instead of mounting/unmounting.
-->
<div class="grid {wrapperClass}">
  {#if resync}
    <textarea
      {id}
      bind:this={textareaEl}
      use:withResync
      value={value}
      {rows}
      {placeholder}
      onfocus={() => { editing = true; }}
      onblur={handleBlur}
      onkeydown={handleKeydown}
      tabindex={editing ? undefined : -1}
      aria-hidden={!editing}
      style="grid-area:1/1;{!editing ? 'opacity:0;pointer-events:none;' : ''}"
      class={cls}
    ></textarea>
  {:else}
    <textarea
      {id}
      bind:this={textareaEl}
      use:autosize
      value={value}
      {rows}
      {placeholder}
      onfocus={() => { editing = true; }}
      onblur={handleBlur}
      onkeydown={handleKeydown}
      tabindex={editing ? undefined : -1}
      aria-hidden={!editing}
      style="grid-area:1/1;{!editing ? 'opacity:0;pointer-events:none;' : ''}"
      class={cls}
    ></textarea>
  {/if}

  <!-- svelte-ignore a11y_interactive_supports_focus -->
  <div
    role="button"
    tabindex={editing ? -1 : 0}
    aria-hidden={editing}
    onmousedown={handleRenderedPointerDown}
    onmouseup={handleRenderedPointerUp}
    onkeydown={handleRenderedKeydown}
    style="grid-area:1/1;-webkit-user-select:text;user-select:text;{editing ? 'opacity:0;pointer-events:none;' : ''}"
    class={cls}
  >
    {#if value}
      {@html renderText(value)}
    {:else}
      <span class="text-gray-400 dark:text-gray-500 pointer-events-none">{placeholder}</span>
    {/if}
  </div>
</div>
