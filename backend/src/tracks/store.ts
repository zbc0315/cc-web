/**
 * Track storage — read/write .tr files under <project>/.ccweb/tracks/.
 *
 * Mirrors backend/src/flows/store.ts but for .tr source files instead
 * of FlowDef JSON. Each track is a plain UTF-8 text file (train-lang
 * source). No schema validation here — parse errors surface from
 * train-lang when the track is run.
 */

import * as fs from 'fs'
import * as path from 'path'
import * as os from 'os'

const TRACK_EXT = '.tr'
const TRACKS_DIRNAME = 'tracks'

export interface TrackFileInfo {
  filename: string
  size: number
  mtime: number
}

/**
 * sanitize a user-provided filename: forbid path separators, ensure
 * .tr extension. Returns null if input is unsafe.
 */
export function sanitizeTrackFilename(input: unknown): string | null {
  if (typeof input !== 'string') return null
  const trimmed = input.trim()
  if (!trimmed) return null
  // No path separators or relative parents
  if (/[\\/]/.test(trimmed) || trimmed.includes('..')) return null
  // No control bytes
  if (/[\x00-\x1f]/.test(trimmed)) return null
  // Ensure .tr extension
  const withExt = trimmed.endsWith(TRACK_EXT) ? trimmed : trimmed + TRACK_EXT
  if (withExt.length > 200) return null
  return withExt
}

function tracksDir(projectFolder: string): string {
  return path.join(projectFolder, '.ccweb', TRACKS_DIRNAME)
}

function trackPath(projectFolder: string, filename: string): string {
  return path.join(tracksDir(projectFolder), filename)
}

export function listTracks(projectFolder: string): TrackFileInfo[] {
  const dir = tracksDir(projectFolder)
  if (!fs.existsSync(dir)) return []
  const entries = fs.readdirSync(dir, { withFileTypes: true })
  const out: TrackFileInfo[] = []
  for (const e of entries) {
    if (!e.isFile() || !e.name.endsWith(TRACK_EXT)) continue
    const full = path.join(dir, e.name)
    try {
      const st = fs.statSync(full)
      out.push({ filename: e.name, size: st.size, mtime: st.mtimeMs })
    } catch {
      // skip unreadable
    }
  }
  return out.sort((a, b) => a.filename.localeCompare(b.filename))
}

/**
 * Read a track. Refuses to follow symlinks — if the on-disk entry is a
 * symlink, returns null. This prevents an attacker with write access to
 * `.ccweb/tracks/` from planting `attack.tr -> /etc/passwd` and reading
 * arbitrary files via the GET endpoint. Symmetric guard in saveTrack
 * (rejects writing to a path whose existing target is a symlink).
 */
export function loadTrack(
  projectFolder: string,
  filename: string,
): string | null {
  const p = trackPath(projectFolder, filename)
  try {
    const st = fs.lstatSync(p)
    if (!st.isFile()) return null
  } catch {
    return null
  }
  try {
    return fs.readFileSync(p, 'utf8')
  } catch {
    return null
  }
}

export function saveTrack(
  projectFolder: string,
  filename: string,
  source: string,
): boolean {
  const dir = tracksDir(projectFolder)
  try {
    fs.mkdirSync(dir, { recursive: true })
    const p = trackPath(projectFolder, filename)
    // Reject if the target already exists and is a symlink — same
    // guard as loadTrack. Without this, an attacker who can write the
    // symlink could redirect saves to arbitrary FS locations.
    try {
      const st = fs.lstatSync(p)
      if (st.isSymbolicLink()) return false
    } catch {
      // ENOENT — fine, we'll create a new file
    }
    const tmp = p + '.tmp-' + process.pid
    fs.writeFileSync(tmp, source, 'utf8')
    fs.renameSync(tmp, p)
    return true
  } catch {
    return false
  }
}

export function deleteTrack(projectFolder: string, filename: string): boolean {
  const p = trackPath(projectFolder, filename)
  if (!fs.existsSync(p)) return false
  try {
    fs.unlinkSync(p)
    return true
  } catch {
    return false
  }
}

/** Absolute path used by TrackRunner when starting a run. */
export function resolveTrackPath(
  projectFolder: string,
  filename: string,
): string {
  return trackPath(projectFolder, filename)
}

// ── Global tracks (per-user templates) ──────────────────────────────────

function globalTracksDir(username: string): string {
  return path.join(os.homedir(), '.ccweb', 'users', username, TRACKS_DIRNAME)
}

function globalTrackPath(username: string, filename: string): string {
  return path.join(globalTracksDir(username), filename)
}

export function listGlobalTracks(username: string): TrackFileInfo[] {
  const dir = globalTracksDir(username)
  if (!fs.existsSync(dir)) return []
  const entries = fs.readdirSync(dir, { withFileTypes: true })
  const out: TrackFileInfo[] = []
  for (const e of entries) {
    if (!e.isFile() || !e.name.endsWith(TRACK_EXT)) continue
    const full = path.join(dir, e.name)
    try {
      const st = fs.statSync(full)
      out.push({ filename: e.name, size: st.size, mtime: st.mtimeMs })
    } catch {
      // skip
    }
  }
  return out.sort((a, b) => a.filename.localeCompare(b.filename))
}

export function loadGlobalTrack(
  username: string,
  filename: string,
): string | null {
  const p = globalTrackPath(username, filename)
  try {
    const st = fs.lstatSync(p)
    if (!st.isFile()) return null
  } catch {
    return null
  }
  try {
    return fs.readFileSync(p, 'utf8')
  } catch {
    return null
  }
}

export function saveGlobalTrack(
  username: string,
  filename: string,
  source: string,
): boolean {
  const dir = globalTracksDir(username)
  try {
    fs.mkdirSync(dir, { recursive: true })
    const p = globalTrackPath(username, filename)
    try {
      const st = fs.lstatSync(p)
      if (st.isSymbolicLink()) return false
    } catch {
      // ENOENT — fine
    }
    const tmp = p + '.tmp-' + process.pid
    fs.writeFileSync(tmp, source, 'utf8')
    fs.renameSync(tmp, p)
    return true
  } catch {
    return false
  }
}

export function deleteGlobalTrack(username: string, filename: string): boolean {
  const p = globalTrackPath(username, filename)
  if (!fs.existsSync(p)) return false
  try {
    fs.unlinkSync(p)
    return true
  } catch {
    return false
  }
}

export function resolveGlobalTrackPath(
  username: string,
  filename: string,
): string {
  return globalTrackPath(username, filename)
}
