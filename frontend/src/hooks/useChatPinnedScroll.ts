import { useCallback, useEffect, useLayoutEffect, useRef } from 'react';

/**
 * Unified auto-scroll (pin-to-bottom) behavior for chat scroll containers.
 *
 * Behavior:
 *   - Starts pinned = true so the consumer opens at the bottom of history
 *   - Scroll listener flips pin based on distance from bottom (<80px = pinned)
 *   - 80ms after any programmatic scroll, scroll events are ignored to prevent
 *     self-triggered un-pinning during streaming content growth (browser scroll
 *     anchoring can fire transient "near >= 80" events)
 *   - `useLayoutEffect` on `deps` snaps to bottom when pinned
 *   - ResizeObserver on the content element handles async height growth
 *     (markdown reflow, late-loading images)
 *
 * Usage:
 *   const scrollRef = useRef<HTMLDivElement>(null);
 *   const contentRef = useRef<HTMLDivElement>(null);
 *   const { pinnedRef, scrollToBottom } = useChatPinnedScroll(
 *     scrollRef, contentRef, [messages, activeBubble]
 *   );
 *   // Consumers can do `pinnedRef.current = true` before user sends to force snap.
 */
export function useChatPinnedScroll(
  viewportRef: React.RefObject<HTMLElement>,
  contentRef: React.RefObject<HTMLElement>,
  deps: ReadonlyArray<unknown>,
) {
  const pinnedRef = useRef(true);
  const lastProgrammaticScrollAtRef = useRef(0);

  const scrollToBottom = useCallback(() => {
    const el = viewportRef.current;
    if (!el) return;
    lastProgrammaticScrollAtRef.current = performance.now();
    el.scrollTop = el.scrollHeight;
  }, [viewportRef]);

  // Track user scroll to maintain pinnedRef
  useEffect(() => {
    const el = viewportRef.current;
    if (!el) return;
    const onScroll = () => {
      if (performance.now() - lastProgrammaticScrollAtRef.current < 80) return;
      const near = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
      pinnedRef.current = near;
    };
    el.addEventListener('scroll', onScroll, { passive: true });
    return () => el.removeEventListener('scroll', onScroll);
  }, [viewportRef]);

  // Snap on dependency changes when pinned
  useLayoutEffect(() => {
    if (pinnedRef.current) scrollToBottom();
    // deps is deliberately passed through — consumer controls what triggers snap
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scrollToBottom, ...deps]);

  // Observe content growth (async markdown layout, late images) while pinned
  useEffect(() => {
    const contentEl = contentRef.current;
    if (!contentEl) return;
    const ro = new ResizeObserver(() => {
      if (pinnedRef.current) scrollToBottom();
    });
    ro.observe(contentEl);
    return () => ro.disconnect();
  }, [contentRef, scrollToBottom]);

  return { pinnedRef, scrollToBottom };
}
