import * as fs from 'fs';
import * as path from 'path';
import { listMemoryPrompts, toggleMemoryPrompt } from './memory-prompts';
import { modLogger } from './logger';
import type { CliTool } from './types';

/**
 * Memory watcher — keeps CLAUDE.md / AGENTS.md in sync with edits to
 * `<folderPath>/.ccweb/memory/*.md` files. Wired to TerminalManager
 * lifecycle so a watcher exists exactly when a project's terminal is up.
 *
 * Trigger semantics:
 *  - File modified, currently inserted → refresh block (idempotent)
 *  - File modified, not inserted       → no-op (no auto-insert of new files)
 *  - File deleted, was inserted        → remove block
 *  - File deleted, not inserted        → no-op
 *
 * Event handler is lstat-driven (not eventType-driven) because the LLM tools
 * (writeFileSync) and editor save patterns (write-tmp + rename) produce
 * different fs.watch event types — but both converge on a deterministic
 * post-write state we can read.
 */

const log = modLogger('memory-watcher');

// Short enough that an LLM same-turn `Write memory → Read CLAUDE.md` reads
// fresh content; long enough to coalesce the 5-10ms double-fire some
// editors produce on save (macOS FSEvents).
const DEBOUNCE_MS = 50;

interface ProjectWatcher {
  watcher: fs.FSWatcher;
  folderPath: string;
  cliTool: CliTool | undefined;
  timers: Map<string, NodeJS.Timeout>;
}

const watchers = new Map<string, ProjectWatcher>();

function memoryDir(folderPath: string): string {
  return path.join(folderPath, '.ccweb', 'memory');
}

export function startMemoryWatcher(
  projectId: string,
  folderPath: string,
  cliTool?: CliTool,
): void {
  // Idempotent — auto-restart cycle re-enters startTerminal for the same
  // project; we don't want to stack watchers on the same dir.
  if (watchers.has(projectId)) return;

  const dir = memoryDir(folderPath);
  if (!fs.existsSync(dir)) {
    log.debug({ projectId, dir }, 'memory dir missing — skip watcher');
    return;
  }

  let watcher: fs.FSWatcher;
  try {
    watcher = fs.watch(dir, { persistent: false }, (_event, filename) => {
      if (!filename || typeof filename !== 'string') return;
      if (!filename.endsWith('.md')) return;

      const state = watchers.get(projectId);
      if (!state) return;

      const existing = state.timers.get(filename);
      if (existing) clearTimeout(existing);
      state.timers.set(
        filename,
        setTimeout(() => {
          state.timers.delete(filename);
          handleMemoryEvent(projectId, filename);
        }, DEBOUNCE_MS),
      );
    });
  } catch (err) {
    log.warn({ err, projectId, dir }, 'memory watcher attach failed');
    return;
  }

  watcher.on('error', (err) => {
    log.warn({ err, projectId }, 'memory watcher errored');
  });

  watchers.set(projectId, { watcher, folderPath, cliTool, timers: new Map() });
  log.info({ projectId, dir }, 'memory watcher attached');
}

export function stopMemoryWatcher(projectId: string): void {
  const state = watchers.get(projectId);
  if (!state) return;
  for (const t of state.timers.values()) clearTimeout(t);
  state.timers.clear();
  try {
    state.watcher.close();
  } catch {
    /* ignore */
  }
  watchers.delete(projectId);
  log.debug({ projectId }, 'memory watcher detached');
}

function handleMemoryEvent(projectId: string, filename: string): void {
  const state = watchers.get(projectId);
  if (!state) return;
  const { folderPath, cliTool } = state;
  const filePath = path.join(memoryDir(folderPath), filename);

  let stat: fs.Stats | undefined;
  try {
    stat = fs.lstatSync(filePath);
  } catch {
    stat = undefined;
  }

  if (!stat) {
    // File missing: remove block (idempotent for not-present case).
    try {
      const result = toggleMemoryPrompt(folderPath, filename, 'remove', cliTool);
      if (result.changed) {
        log.info({ projectId, filename }, 'memory file removed → block removed');
      }
    } catch (err) {
      log.warn({ err, projectId, filename }, 'memory remove failed');
    }
    return;
  }

  // Symlink guard mirrors memory-prompts.ts:88,152 — never resolve a memory
  // symlink, even via the watcher path.
  if (!stat.isFile()) return;

  // File exists → refresh ONLY if currently inserted. Newly created files
  // require explicit user opt-in via SettingsPage toggle.
  try {
    const list = listMemoryPrompts(folderPath, cliTool);
    const item = list.items.find((i) => i.filename === filename);
    if (!item?.inserted) return;
    const result = toggleMemoryPrompt(folderPath, filename, 'insert', cliTool);
    if (result.changed) {
      log.info({ projectId, filename }, 'memory file changed → block refreshed');
    }
  } catch (err) {
    log.warn({ err, projectId, filename }, 'memory refresh failed');
  }
}
