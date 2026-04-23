import { useCallback, useRef } from 'react';

interface Options {
  /** Milliseconds the touch must stay down before firing. Default 500. */
  duration?: number;
  /** Pixels of movement allowed before the long-press is cancelled — past
   *  this threshold the user is scrolling, not holding. Default 10. */
  moveTolerance?: number;
}

interface LongPressHandlers {
  onTouchStart: (e: React.TouchEvent) => void;
  onTouchMove: (e: React.TouchEvent) => void;
  onTouchEnd: (e: React.TouchEvent) => void;
  onTouchCancel: (e: React.TouchEvent) => void;
}

export interface UseLongPressReturn {
  /**
   * Returns a spread of touch event handlers for a specific target. The
   * callback receives the pointer coords (clientX/Y at touch start), which
   * the consumer typically uses to place a context menu at the touch
   * location.
   *
   * Because hooks can't be called inside `.map()`, the hook exposes `bind`
   * — call the hook once at component scope and spread `bind(cb)` on each
   * repeated element.
   */
  bind: (onLongPress: (x: number, y: number) => void) => LongPressHandlers;
  /**
   * Mutable ref set to `true` right after a long-press fires. Browsers
   * still dispatch a `click` event when the finger lifts after a
   * long-press, which — without this guard — would trigger whatever the
   * element's onClick does (e.g. opening a file preview, toggling a dir).
   * Consumers must check this in their onClick and `.current = false`
   * after observing to re-arm for the next tap.
   */
  wasTriggered: React.MutableRefObject<boolean>;
}

/**
 * Touchscreen long-press → arbitrary callback. Intended for porting right-
 * click context menus (desktop `onContextMenu`) to mobile without adding a
 * dedicated kebab-menu button. Pairs with the existing `onContextMenu`
 * handler — both can live on the same element, each handling their own
 * input modality.
 */
export function useLongPress(options: Options = {}): UseLongPressReturn {
  const duration = options.duration ?? 500;
  const tolerance = options.moveTolerance ?? 10;
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const startRef = useRef<{ x: number; y: number } | null>(null);
  const wasTriggered = useRef(false);

  const cancel = useCallback(() => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    startRef.current = null;
  }, []);

  const bind = useCallback(
    (onLongPress: (x: number, y: number) => void): LongPressHandlers => ({
      onTouchStart: (e) => {
        if (e.touches.length !== 1) return;
        const t = e.touches[0];
        startRef.current = { x: t.clientX, y: t.clientY };
        wasTriggered.current = false;
        if (timerRef.current) clearTimeout(timerRef.current);
        timerRef.current = setTimeout(() => {
          wasTriggered.current = true;
          // Haptic nudge so the user knows the menu is about to appear —
          // supported on Android/Chrome; iOS Safari silently no-ops.
          if (typeof navigator !== 'undefined' && 'vibrate' in navigator) {
            try { navigator.vibrate(15); } catch { /* some browsers block without user gesture */ }
          }
          onLongPress(t.clientX, t.clientY);
        }, duration);
      },
      onTouchMove: (e) => {
        if (!startRef.current || !timerRef.current) return;
        const t = e.touches[0];
        const dx = t.clientX - startRef.current.x;
        const dy = t.clientY - startRef.current.y;
        if (Math.hypot(dx, dy) > tolerance) cancel();
      },
      onTouchEnd: cancel,
      onTouchCancel: cancel,
    }),
    [duration, tolerance, cancel],
  );

  return { bind, wasTriggered };
}
