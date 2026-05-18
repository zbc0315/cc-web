import * as fs from 'fs'
import * as path from 'path'
import { copyToProjectCwd, reloadFromProjectCwd, cleanupProjectCwd, filterByWhitelist } from './train-json-sync'

export type Injector = (text: string) => void | Promise<void>

export interface DispatchOptions {
  projectFolder: string                    // CLI cwd
  injector: Injector                       // 把 prompt 写到项目 PTY
  prompt: string                           // 转译后的完整 prompt
  beforeSnapshot: Record<string, unknown>  // 调用前的 train.json snapshot
  outputs: string[]                        // 期望 LLM 修改的字段集合
  whitelist: string[]                      // variables[*].key（用于过滤）
  signal: AbortSignal                      // 用户取消
  timeoutMs?: number                       // 默认 600_000 (10 min)
}

export type DispatchResult =
  | { kind: 'success'; newSnapshot: Record<string, unknown>; varsDiff: { key: string; old: unknown; new: unknown }[] }
  | { kind: 'failed'; reason: string }
  | { kind: 'cancelled' }

/**
 * Dispatch one LLM call:
 *   1. Atomic-write snapshot to cwd train.json + workflow_data.json
 *   2. Inject prompt into project PTY
 *   3. Poll train.json mtime — wait until LLM writes (or timeout/cancel)
 *   4. Reload train.json (with flush wait + retry) → filter by whitelist
 *   5. Diff vs beforeSnapshot; if any output is NOT changed → failed
 *   6. Cleanup cwd files
 */
export async function dispatchLlmCall(opts: DispatchOptions): Promise<DispatchResult> {
  const cwd = opts.projectFolder
  const trainJsonPath = path.join(cwd, 'train.json')
  const timeoutMs = opts.timeoutMs ?? 600_000

  // 1. Write snapshot
  copyToProjectCwd(cwd, filterByWhitelist(opts.beforeSnapshot, opts.whitelist))

  // 记录 initial mtime（snapshot 刚写完）
  let initialMtimeMs = 0
  try {
    initialMtimeMs = fs.statSync(trainJsonPath).mtimeMs
  } catch {
    initialMtimeMs = Date.now()
  }

  try {
    // 2. Inject prompt
    await opts.injector(opts.prompt)

    // 3. Poll for mtime change
    const startedAt = Date.now()
    const pollInterval = 500
    while (true) {
      if (opts.signal.aborted) {
        cleanupProjectCwd(cwd)
        return { kind: 'cancelled' }
      }
      if (Date.now() - startedAt > timeoutMs) {
        cleanupProjectCwd(cwd)
        return { kind: 'failed', reason: `LLM 调用超时（${timeoutMs}ms 内未修改 train.json）` }
      }
      let mtimeMs = initialMtimeMs
      try {
        mtimeMs = fs.statSync(trainJsonPath).mtimeMs
      } catch {
        /* file deleted during call? continue polling */
      }
      if (mtimeMs > initialMtimeMs + 1) {
        // 跳出 polling，进入 reload
        break
      }
      await sleep(pollInterval)
    }

    // 4. Reload（含 200/500ms 等待 + 重试）
    const reload = await reloadFromProjectCwd(cwd)
    if (!reload.ok || !reload.data) {
      cleanupProjectCwd(cwd)
      return { kind: 'failed', reason: `train.json reload 失败：${reload.error ?? 'unknown'}` }
    }

    // 5. Diff + outputs check
    const newSnapshotFiltered = filterByWhitelist(reload.data, opts.whitelist)
    const varsDiff: { key: string; old: unknown; new: unknown }[] = []
    for (const k of Object.keys(newSnapshotFiltered)) {
      const oldV = opts.beforeSnapshot[k] ?? null
      const newV = newSnapshotFiltered[k]
      if (!sameValue(oldV, newV)) {
        varsDiff.push({ key: k, old: oldV, new: newV })
      }
    }

    // outputs 中每个字段必须出现在 varsDiff（spec §6.2 step 5）
    const changedKeys = new Set(varsDiff.map((d) => d.key))
    const missingOutputs = opts.outputs.filter((k) => !changedKeys.has(k))
    if (missingOutputs.length > 0) {
      cleanupProjectCwd(cwd)
      return {
        kind: 'failed',
        reason: `LLM 未按要求修改字段：${missingOutputs.join(', ')}`,
      }
    }

    cleanupProjectCwd(cwd)
    return { kind: 'success', newSnapshot: newSnapshotFiltered, varsDiff }
  } catch (e) {
    cleanupProjectCwd(cwd)
    if (opts.signal.aborted) return { kind: 'cancelled' }
    return { kind: 'failed', reason: `dispatch 异常：${(e as Error).message}` }
  }
}

function sameValue(a: unknown, b: unknown): boolean {
  if (a === b) return true
  if (typeof a !== typeof b) return false
  if (typeof a === 'object') {
    try { return JSON.stringify(a) === JSON.stringify(b) } catch { return false }
  }
  return false
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}
