import { useCallback, KeyboardEvent } from 'react';

/**
 * Unified Enter-to-submit handler with IME (input method composition) guard.
 *
 * Without IME protection, Chinese/Japanese/Korean users' Enter key (used to
 * accept a candidate word) will fire handleSend mid-composition — sending
 * half-typed content. This hook suppresses Enter while a composition is active.
 *
 * `newlineOn`:
 *   - 'shift'  → Enter submits, Shift+Enter inserts newline
 *   - 'enter'  → Shift+Enter submits, Enter inserts newline (desktop legacy)
 */
export type NewlineMode = 'shift' | 'enter';

export function useEnterToSubmit(
  onSubmit: () => void,
  mode: NewlineMode = 'shift',
) {
  return useCallback(
    (e: KeyboardEvent<HTMLTextAreaElement | HTMLInputElement>) => {
      if (e.key !== 'Enter') return;
      // IME composition in progress — let the IME handle the key.
      // `keyCode === 229` covers older browsers that don't set isComposing.
      if (e.nativeEvent.isComposing || e.keyCode === 229) {
        return;
      }
      const submitOnPlainEnter = mode === 'shift';
      const shouldSubmit = submitOnPlainEnter ? !e.shiftKey : e.shiftKey;
      if (shouldSubmit) {
        e.preventDefault();
        onSubmit();
      }
    },
    [onSubmit, mode],
  );
}
