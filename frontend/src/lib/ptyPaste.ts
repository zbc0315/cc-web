/**
 * Wrap `text` with bracketed-paste markers + trailing CR.
 *
 * The single `\r` at the end is NOT actually the submit — the backend's
 * `writeTerminalInputSplit` strips it off and writes it to the PTY ~200ms
 * AFTER the paste body. Claude Ink folds any paste whose closing `\r`
 * arrives in the same PTY read into a `[Pasted text #N +M lines]`
 * attachment that requires a second Enter; splitting the writes lets Ink
 * see the `\r` as an independent Enter keypress and submit reliably.
 *
 * Keep the `\r` at the end of the payload (not dropped at the frontend)
 * so callers that bypass the split path — e.g. the ProjectPage
 * overlay-closed fallback on older backends — still submit; the backend
 * split is additive, not a contract.
 *
 * Strips any stray `\x1b[20[01]~` in the input so attacker-controlled
 * text can't close paste mode early and escape into raw keystrokes.
 */
export function bracketedPaste(text: string): string {
  const body = text.replace(/\x1b\[20[01]~/g, '').replace(/\n/g, '\r');
  return '\x1b[200~' + body + '\x1b[201~\r';
}
