/**
 * Wrap `text` with bracketed-paste markers so Claude Code's Ink-based TUI
 * submits it as a paste + Enter instead of interpreting embedded `\r`s as
 * soft newlines.
 *
 * Background (see CLAUDE.md 历史教训 2026-04-19 "Ink TUI PTY 交互"):
 *   - Ink treats a PTY read of ~100+ bytes as a paste block; internal `\r`
 *     becomes a newline inside the input buffer, NOT a submit.
 *   - A trailing raw `\r` appended after a large body gets swallowed by
 *     that same paste heuristic and never fires the Enter keypress.
 *   - Emitting `\x1b[200~` (paste start) / `\x1b[201~` (paste end) tells
 *     Ink unambiguously "this region is a paste"; the `\r` placed AFTER
 *     `\x1b[201~` is a separate keystroke and triggers submit.
 *
 * Strips any stray `\x1b[20[01]~` the user may have typed so attacker-
 * controlled text can't close the paste mode early and escape into raw
 * keystrokes.
 */
export function bracketedPaste(text: string): string {
  const body = text.replace(/\x1b\[20[01]~/g, '').replace(/\n/g, '\r');
  return '\x1b[200~' + body + '\x1b[201~\r';
}
