/**
 * Chat-history backup: mirror CLI-native session files (e.g. `~/.claude/
 * projects/<enc>/*.jsonl`, `~/.codex/sessions/YYYY/MM/DD/*.jsonl`, Gemini's
 * `*.json`, etc.) into `<projectFolder>/.ccweb/sessions/<cliTool>/` so that
 * whole-project rsync / tar of the project folder captures the chat log
 * alongside source code.  READ PATH IS UNCHANGED — the daemon still reads
 * chat-history from the CLI-native location (see session-manager.ts).  This
 * module is write-only and out-of-band with the hot path.
 *
 * Mirror semantics: a source file deleted upstream is deleted downstream on
 * the next pass.  Only touches files **inside** the per-tool subdir
 * (`.ccweb/sessions/<cliTool>/`); other files under `.ccweb/` (project.json,
 * shortcuts.json, other tools' stale subdirs) are never enumerated.
 */

import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import { getAdapter } from './adapters';
import { getProjects, ccwebDir } from './config';
import type { Project, CliTool } from './types';
import { modLogger } from './logger';

const log = modLogger('backup');

const BACKUP_SUBDIR = 'sessions';
const META_FILE = 'backup-meta.json';
const POLL_INTERVAL_MS = 5 * 60_000;

export interface BackupMeta {
  lastBackupAt: number;
  lastError?: string;
}

export interface BackupFileInfo {
  name: string;
  mtime: number;
  bytes: number;
}

export interface BackupStatus {
  supported: boolean;
  cliTool: CliTool;
  backupDir: string;
  files: BackupFileInfo[];
  meta: BackupMeta | null;
}

function backupRoot(project: Project): string {
  return path.join(ccwebDir(project.folderPath), BACKUP_SUBDIR);
}

function perToolDir(project: Project): string {
  return path.join(backupRoot(project), project.cliTool);
}

function metaPath(project: Project): string {
  return path.join(backupRoot(project), META_FILE);
}

function readMeta(project: Project): BackupMeta | null {
  try {
    const raw = fs.readFileSync(metaPath(project), 'utf-8');
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
    const m = parsed as BackupMeta;
    if (typeof m.lastBackupAt !== 'number') return null;
    return m;
  } catch {
    return null;
  }
}

function writeMeta(project: Project, meta: BackupMeta): void {
  try {
    fs.mkdirSync(backupRoot(project), { recursive: true });
    const tmp = `${metaPath(project)}.tmp-${process.pid}-${crypto.randomBytes(3).toString('hex')}`;
    fs.writeFileSync(tmp, JSON.stringify(meta, null, 2));
    fs.renameSync(tmp, metaPath(project));
  } catch (err) {
    log.warn({ err, project: project.id }, 'failed to write backup meta');
  }
}

function atomicCopy(src: string, dst: string): void {
  const dstDir = path.dirname(dst);
  fs.mkdirSync(dstDir, { recursive: true });
  const tmp = `${dst}.tmp-${process.pid}-${crypto.randomBytes(3).toString('hex')}`;
  fs.copyFileSync(src, tmp);
  fs.renameSync(tmp, dst);
  // Preserve source mtime so future mtime comparisons work correctly.
  try {
    const st = fs.statSync(src);
    fs.utimesSync(dst, st.atime, st.mtime);
  } catch {
    // non-fatal
  }
}

function listSourceFiles(project: Project): string[] {
  const adapter = getAdapter(project.cliTool);
  if (typeof adapter.getSessionFilesForProject === 'function') {
    try {
      return adapter.getSessionFilesForProject(project.folderPath);
    } catch (err) {
      log.warn({ err, project: project.id }, 'adapter.getSessionFilesForProject threw');
      return [];
    }
  }
  const dir = adapter.getSessionDir(project.folderPath);
  if (!dir || !fs.existsSync(dir)) return [];
  const ext = typeof adapter.getSessionFileExtension === 'function'
    ? adapter.getSessionFileExtension()
    : '.jsonl';
  try {
    return fs.readdirSync(dir)
      .filter((f) => f.endsWith(ext))
      .map((f) => path.join(dir, f));
  } catch (err) {
    log.warn({ err, dir, project: project.id }, 'readdir session dir failed');
    return [];
  }
}

export interface BackupResult {
  projectId: string;
  copied: number;
  deleted: number;
  skipped: number;
  errors: string[];
}

/**
 * Mirror the CLI-native session files of `project` into
 * `<folder>/.ccweb/sessions/<cliTool>/`.  Idempotent: files whose size+mtime
 * match the source are skipped; downstream files with no matching source are
 * deleted.
 */
export function backupProjectSessions(project: Project): BackupResult {
  const result: BackupResult = { projectId: project.id, copied: 0, deleted: 0, skipped: 0, errors: [] };

  // `terminal` cliTool has no chat; nothing to back up.
  if (project.cliTool === 'terminal') return result;

  const sources = listSourceFiles(project);
  const dstDir = perToolDir(project);

  // Ensure parent exists even if we'll have zero files (so UI shows empty state
  // consistently and future writes don't race mkdir).
  try { fs.mkdirSync(dstDir, { recursive: true }); } catch (err) {
    result.errors.push(`mkdir ${dstDir}: ${(err as Error).message}`);
    log.warn({ err, project: project.id, dstDir }, 'mkdir backup dir failed — skipping');
    return result;
  }

  // Build src basename → {srcPath, mtime, size} map. Basename collisions across
  // source dirs are theoretical; Claude/Codex/Gemini all use UUID-ish names.
  const srcMap = new Map<string, { srcPath: string; mtime: number; size: number }>();
  for (const src of sources) {
    try {
      const st = fs.statSync(src);
      if (!st.isFile()) continue;
      srcMap.set(path.basename(src), { srcPath: src, mtime: st.mtimeMs, size: st.size });
    } catch {
      // source vanished mid-scan
    }
  }

  // Enumerate downstream
  let dstEntries: string[] = [];
  try {
    dstEntries = fs.readdirSync(dstDir);
  } catch {
    dstEntries = [];
  }

  // Delete stale downstream files (in source → not in source = delete).
  for (const entry of dstEntries) {
    // Ignore subdirs (shouldn't exist but paranoid) and our own tmp/meta artifacts.
    if (entry.includes('.tmp-')) continue;
    const dstPath = path.join(dstDir, entry);
    try {
      const st = fs.statSync(dstPath);
      if (!st.isFile()) continue;
      if (!srcMap.has(entry)) {
        fs.unlinkSync(dstPath);
        result.deleted++;
      }
    } catch (err) {
      result.errors.push(`stat/unlink ${entry}: ${(err as Error).message}`);
    }
  }

  // Copy new / changed files.
  for (const [name, info] of srcMap) {
    const dst = path.join(dstDir, name);
    try {
      const dstSt = fs.existsSync(dst) ? fs.statSync(dst) : null;
      if (dstSt && dstSt.size === info.size && Math.abs(dstSt.mtimeMs - info.mtime) < 1) {
        result.skipped++;
        continue;
      }
      atomicCopy(info.srcPath, dst);
      result.copied++;
    } catch (err) {
      result.errors.push(`copy ${name}: ${(err as Error).message}`);
      log.warn({ err, name, project: project.id }, 'copy failed');
    }
  }

  writeMeta(project, {
    lastBackupAt: Date.now(),
    ...(result.errors.length > 0 ? { lastError: result.errors[0] } : {}),
  });

  if (result.copied > 0 || result.deleted > 0) {
    log.info(
      { project: project.id, cliTool: project.cliTool, ...result },
      'backed up project chat sessions',
    );
  }
  return result;
}

/**
 * Status for the UI panel: list the files currently present in the backup
 * dir + last backup timestamp. Zero I/O into source dir.
 */
export function getBackupStatus(project: Project): BackupStatus {
  const supported = project.cliTool !== 'terminal';
  const backupDir = perToolDir(project);
  const meta = readMeta(project);
  const files: BackupFileInfo[] = [];
  if (supported) {
    try {
      const entries = fs.readdirSync(backupDir);
      for (const e of entries) {
        if (e.includes('.tmp-')) continue;
        try {
          const st = fs.statSync(path.join(backupDir, e));
          if (!st.isFile()) continue;
          files.push({ name: e, mtime: st.mtimeMs, bytes: st.size });
        } catch {
          // skip
        }
      }
      files.sort((a, b) => b.mtime - a.mtime);
    } catch {
      // backup dir doesn't exist yet — empty list is correct
    }
  }
  return { supported, cliTool: project.cliTool, backupDir, files, meta };
}

/** Run backup across every project. Non-throwing: per-project failures are logged. */
export function backupAllProjects(): BackupResult[] {
  const results: BackupResult[] = [];
  const projects = getProjects();
  for (const p of projects) {
    try {
      results.push(backupProjectSessions(p));
    } catch (err) {
      log.error({ err, project: p.id }, 'backupProjectSessions threw unexpectedly');
    }
  }
  return results;
}

let schedulerInterval: NodeJS.Timeout | null = null;

export function startBackupScheduler(): void {
  if (schedulerInterval) return;
  log.info({ intervalMs: POLL_INTERVAL_MS }, 'starting chat-backup scheduler');
  // Prime once immediately so new projects get baseline coverage without
  // waiting the full interval.
  setImmediate(() => {
    try { backupAllProjects(); } catch (err) { log.error({ err }, 'initial backupAllProjects threw'); }
  });
  schedulerInterval = setInterval(() => {
    try { backupAllProjects(); } catch (err) { log.error({ err }, 'scheduled backupAllProjects threw'); }
  }, POLL_INTERVAL_MS);
}

export function stopBackupScheduler(): void {
  if (!schedulerInterval) return;
  clearInterval(schedulerInterval);
  schedulerInterval = null;
  log.info('stopped chat-backup scheduler');
}
