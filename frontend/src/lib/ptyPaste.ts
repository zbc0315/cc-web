/**
 * Wrap `text` for Claude Code's Ink TUI so it submits the message instead of
 * leaving it stuck in the input box.
 *
 * Single-line text → raw `text + \r`. Ink treats a SINGLE-line bracketed
 * paste as an "attachment" that requires a second Enter to submit — the
 * trailing `\r` after `\x1b[201~` is absorbed as "accept paste" rather than
 * "submit". Sending the chars as normal typed input + one final CR avoids
 * the attachment heuristic and submits cleanly (confirmed via ws-diag logs
 * in v2026.4.24-e: a 95-byte single-line paste with balanced markers and
 * trailing CR sat in the TUI input until the user pressed Enter manually).
 *
 * Multi-line text → bracketed paste. Ink accepts a multi-line paste + CR as
 * a submit in one shot, and preserves internal newlines as soft breaks
 * inside the submitted message body (confirmed in probe6: 97-line "更新记
 * 忆" markdown submits immediately).
 *
 * Strips any stray `\x1b[20[01]~` in the input so attacker-controlled text
 * can't close paste mode early and escape into raw keystrokes.
 */
export function bracketedPaste(text: string): string {
  const sanitized = text.replace(/\x1b\[20[01]~/g, '');
  if (!/[\r\n]/.test(sanitized)) {
    return sanitized + '\r';
  }
  return '\x1b[200~' + sanitized.replace(/\n/g, '\r') + '\x1b[201~\r';
}
