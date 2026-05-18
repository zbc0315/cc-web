import * as fs from 'fs'
import * as path from 'path'

const TRAIN_JSON_NAME = 'train.json'
const WORKFLOW_DATA_NAME = 'workflow_data.json'  // legacy alias for adapter compat

/**
 * Atomic write: write to .tmp.<pid>.<ts> then rename to target.
 * Returns true on success, false on any IO error.
 */
function atomicWriteJson(target: string, value: unknown): boolean {
  try {
    fs.mkdirSync(path.dirname(target), { recursive: true })
    const tmp = `${target}.tmp.${process.pid}.${Date.now()}`
    fs.writeFileSync(tmp, JSON.stringify(value, null, 2), 'utf8')
    fs.renameSync(tmp, target)
    return true
  } catch {
    return false
  }
}

/**
 * Copy a snapshot to the project cwd as both `train.json` (v3 canonical)
 * and `workflow_data.json` (legacy alias for adapter compat).
 */
export function copyToProjectCwd(
  projectFolder: string,
  snapshot: Record<string, unknown>,
): boolean {
  const ok1 = atomicWriteJson(path.join(projectFolder, TRAIN_JSON_NAME), snapshot)
  const ok2 = atomicWriteJson(path.join(projectFolder, WORKFLOW_DATA_NAME), snapshot)
  return ok1 && ok2
}

export interface ReloadResult {
  ok: boolean
  data?: Record<string, unknown>
  error?: string
}

/**
 * Reload train.json after LLM call. Wait 200ms for OS buffer flush, then
 * try parsing. On failure (e.g. half-written file), wait another 500ms
 * and retry once.
 *
 * spec §8.2.
 */
export async function reloadFromProjectCwd(projectFolder: string): Promise<ReloadResult> {
  const target = path.join(projectFolder, TRAIN_JSON_NAME)
  await sleep(200)
  const attempt = tryReadJson(target)
  if (attempt.ok) return attempt
  await sleep(500)
  return tryReadJson(target)
}

function tryReadJson(target: string): ReloadResult {
  try {
    if (!fs.existsSync(target)) return { ok: false, error: 'train.json not found' }
    const raw = fs.readFileSync(target, 'utf8')
    const parsed = JSON.parse(raw)
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
      return { ok: false, error: 'train.json must be an object' }
    }
    return { ok: true, data: parsed as Record<string, unknown> }
  } catch (e) {
    return { ok: false, error: `JSON parse failed: ${(e as Error).message}` }
  }
}

/**
 * Delete cwd train.json + workflow_data.json. Idempotent.
 */
export function cleanupProjectCwd(projectFolder: string): void {
  for (const name of [TRAIN_JSON_NAME, WORKFLOW_DATA_NAME]) {
    try {
      fs.unlinkSync(path.join(projectFolder, name))
    } catch {
      /* ignore */
    }
  }
}

/**
 * Filter a possibly LLM-mutated train.json content by the declared
 * whitelist of variable keys. Missing keys are filled with null.
 * Extra (non-whitelist) keys are discarded.
 *
 * spec §6.2 step 7 / §8.2.
 */
export function filterByWhitelist(
  data: Record<string, unknown>,
  whitelist: string[],
): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const key of whitelist) {
    out[key] = key in data ? data[key] : null
  }
  return out
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}
