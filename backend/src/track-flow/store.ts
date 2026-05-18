import * as fs from 'fs'
import * as path from 'path'

/**
 * Sanitize filename — same rules as backend/src/tracks/store.ts sanitizeTrackFilename,
 * but expects `.flow` suffix.
 *
 * Returns sanitized basename WITHOUT extension on success, null on invalid input.
 */
export function sanitizeFlowFilename(raw: string): string | null {
  if (typeof raw !== 'string') return null
  const stripped = raw.replace(/\.flow$/i, '')
  if (stripped.length === 0 || stripped.length > 100) return null
  if (!/^[a-zA-Z0-9_一-龥぀-ヿ-]+$/.test(stripped)) return null
  if (stripped.startsWith('.')) return null
  return stripped
}

function flowDir(projectFolder: string): string {
  return path.join(projectFolder, '.ccweb', 'tracks')
}

function flowPath(projectFolder: string, basename: string): string {
  return path.join(flowDir(projectFolder), `${basename}.flow`)
}

function trainJsonPath(projectFolder: string, basename: string): string {
  return path.join(flowDir(projectFolder), `${basename}.train.json`)
}

export interface FlowFileInfo {
  filename: string                       // <basename>.flow
  basename: string                       // <basename>
  size: number
  mtimeMs: number
}

export function listFlows(projectFolder: string): FlowFileInfo[] {
  const dir = flowDir(projectFolder)
  try {
    if (!fs.existsSync(dir)) return []
    const entries = fs.readdirSync(dir, { withFileTypes: true })
    return entries
      .filter((e) => e.isFile() && e.name.endsWith('.flow'))
      .map((e) => {
        const full = path.join(dir, e.name)
        const stat = fs.statSync(full)
        return {
          filename: e.name,
          basename: e.name.replace(/\.flow$/, ''),
          size: stat.size,
          mtimeMs: stat.mtimeMs,
        }
      })
      .sort((a, b) => b.mtimeMs - a.mtimeMs)
  } catch {
    return []
  }
}

export function loadFlow(projectFolder: string, basename: string): unknown | null {
  const p = flowPath(projectFolder, basename)
  try {
    if (!fs.existsSync(p)) return null
    const raw = fs.readFileSync(p, 'utf8')
    return JSON.parse(raw)
  } catch {
    return null
  }
}

export function loadTrainJson(projectFolder: string, basename: string): Record<string, unknown> | null {
  const p = trainJsonPath(projectFolder, basename)
  try {
    if (!fs.existsSync(p)) return null
    const raw = fs.readFileSync(p, 'utf8')
    const parsed = JSON.parse(raw)
    if (typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>
    }
    return null
  } catch {
    return null
  }
}

/** Atomic write: temp file + rename. */
function atomicWriteJson(target: string, value: unknown): boolean {
  const dir = path.dirname(target)
  try {
    fs.mkdirSync(dir, { recursive: true })
    const tmp = `${target}.tmp.${process.pid}.${Date.now()}`
    fs.writeFileSync(tmp, JSON.stringify(value, null, 2), 'utf8')
    fs.renameSync(tmp, target)
    return true
  } catch {
    return false
  }
}

export type SaveFlowResult = { ok: true } | { ok: false; reason: 'exists' | 'io' }

/** Save flow. `mode='create'` 要求文件不存在；upsert 直接覆盖。 */
export function saveFlow(
  projectFolder: string,
  basename: string,
  flow: unknown,
  mode: 'create' | 'upsert' = 'upsert',
): SaveFlowResult {
  const target = flowPath(projectFolder, basename)
  if (mode === 'create' && fs.existsSync(target)) {
    return { ok: false, reason: 'exists' }
  }
  const ok = atomicWriteJson(target, flow)
  return ok ? { ok: true } : { ok: false, reason: 'io' }
}

export function saveTrainJson(
  projectFolder: string,
  basename: string,
  trainJson: Record<string, unknown>,
): boolean {
  return atomicWriteJson(trainJsonPath(projectFolder, basename), trainJson)
}

export function deleteFlow(projectFolder: string, basename: string): boolean {
  try {
    const p = flowPath(projectFolder, basename)
    const tp = trainJsonPath(projectFolder, basename)
    if (fs.existsSync(p)) fs.unlinkSync(p)
    if (fs.existsSync(tp)) fs.unlinkSync(tp)
    return true
  } catch {
    return false
  }
}
