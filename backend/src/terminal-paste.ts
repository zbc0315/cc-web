import { terminalManager } from './terminal-manager';
import { modLogger } from './logger';

const log = modLogger('terminal-paste');

/**
 * Wrap text in a bracketed-paste sequence + trailing CR for CLI submission.
 *
 * Strips ESC + CR from the body so user content / variable values can't
 * close paste mode prematurely or inject control sequences into the TUI.
 * LF / TAB preserved.
 */
export function buildPaste(text: string): string {
  const safe = text.replace(/[\x1b\r]/g, '');
  return `\x1b[200~${safe}\x1b[201~\r`;
}

const PASTE_SUBMIT_DELAY_MS = 200;
const PASTE_SUBMIT_RE = /^(\x1b\[200~[\s\S]*\x1b\[201~)(\r+)$/;

// Per-project serial queue: paste body then \r must not interleave across
// concurrent submits, and the 200ms delay must apply per project.
const pasteWriteQueues = new Map<string, Promise<void>>();
function enqueuePasteWrite(projectId: string, task: () => Promise<void>): void {
  const prev = pasteWriteQueues.get(projectId) ?? Promise.resolve();
  const next = prev.then(task).catch((err) => {
    log.warn(
      { projectId, err: err instanceof Error ? err.message : String(err), mod: 'paste' },
      'paste write task failed',
    );
  });
  pasteWriteQueues.set(projectId, next);
  void next.finally(() => {
    if (pasteWriteQueues.get(projectId) === next) pasteWriteQueues.delete(projectId);
  });
}

/**
 * Write a terminal_input payload to the PTY, splitting a bracketed-paste
 * body from its trailing submit CR with a short delay between them.
 *
 * Claude Ink TUI's paste heuristic folds any bracketed-paste body whose
 * closing `\r` arrives in the same PTY read chunk into a `[Pasted text
 * #N +M lines]` attachment that requires a SECOND Enter to submit.
 * Splitting body and `\r` across two PTY reads (with a 200ms gap) makes
 * Ink see the `\r` as an independent Enter keypress and submit reliably.
 *
 * Non-paste writes (keystrokes, focus events, slash commands, Ctrl+C)
 * pass through unchanged — they don't trigger Ink's paste heuristic and
 * shouldn't be queued behind a pending paste submit's delay.
 */
export function writeTerminalInputSplit(projectId: string, data: string): void {
  const m = data.match(PASTE_SUBMIT_RE);
  if (!m) {
    terminalManager.writeRaw(projectId, data);
    return;
  }
  const pasteBody = m[1];
  const submitCr = m[2];
  enqueuePasteWrite(projectId, async () => {
    // Capture PTY identity so a stop+start cycle inside the 200ms window
    // doesn't deliver this submit \r to a fresh PTY (would inject a stray
    // empty Enter into a new Claude session).
    const ptyRef = terminalManager.getTerminalRef(projectId);
    if (!ptyRef) {
      log.warn({ projectId, mod: 'paste' }, 'paste dropped — pty gone before body write');
      return;
    }
    terminalManager.writeRaw(projectId, pasteBody);
    await new Promise<void>((r) => setTimeout(r, PASTE_SUBMIT_DELAY_MS));
    if (terminalManager.getTerminalRef(projectId) !== ptyRef) {
      log.warn(
        { projectId, mod: 'paste' },
        'paste submit dropped — pty instance changed during delay',
      );
      return;
    }
    terminalManager.writeRaw(projectId, submitCr);
  });
}
