/**
 * WorkflowDataWatcher — observe `<project>/.ccweb/workflow_data.json`
 * for `task_progress[taskIndex].finish === true` signals.
 *
 * Replaces (and inlines a more focused version of) the inline polling
 * loop in backend/src/flows/runner.ts:waitForTaskFinish. The track
 * subsystem needs the same primitive but decoupled from FlowRunner.
 *
 * Strategy:
 *   - fs.watch with 50ms debounce
 *   - on each event, read file + parse JSON
 *   - for any pending waiter whose taskIndex.finish is true → resolve
 *   - AbortSignal cancels the wait (returns 'cancelled')
 *   - timeoutMs caps the wait (returns 'timeout')
 *
 * The watcher does NOT write to workflow_data.json. Only the LLM (via
 * the PTY process the adapter injects into) is expected to write.
 */

import * as fs from 'fs'
import * as fsp from 'fs/promises'
import type { WorkflowData } from './types'

export type FinishOutcome =
  | { kind: 'ok'; finishedAt: number; data: WorkflowData }
  | { kind: 'timeout' }
  | { kind: 'cancelled' }
  | { kind: 'error'; message: string }

export interface WorkflowDataWatcher {
  /** Begin watching the file. Idempotent. */
  start(): void
  /** Stop watching + reject all pending waiters with cancelled. */
  stop(): void
  /**
   * Wait until workflow_data.task_progress[taskIndex].finish === true
   * for the given taskIndex, OR timeoutMs elapses, OR signal aborts.
   * Returns the post-finish WorkflowData snapshot on success.
   */
  waitForFinish(
    taskIndex: number,
    timeoutMs: number,
    signal?: AbortSignal,
  ): Promise<FinishOutcome>
  /** One-shot read of the file (used by tests + adapter). */
  read(): Promise<WorkflowData>
}

interface Waiter {
  taskIndex: number
  resolve: (o: FinishOutcome) => void
  timer: NodeJS.Timeout
  signalHandler?: () => void
  signal?: AbortSignal
}

const DEBOUNCE_MS = 50

export function createWorkflowDataWatcher(
  workflowDataPath: string,
): WorkflowDataWatcher {
  let watcher: fs.FSWatcher | null = null
  let debounceTimer: NodeJS.Timeout | null = null
  const waiters: Waiter[] = []

  async function readSafe(): Promise<WorkflowData | null> {
    try {
      const text = await fsp.readFile(workflowDataPath, 'utf8')
      return JSON.parse(text) as WorkflowData
    } catch {
      return null
    }
  }

  async function checkAll(): Promise<void> {
    const data = await readSafe()
    if (!data) return
    // Snapshot waiters list so resolving doesn't mutate during iteration
    const pending = waiters.slice()
    for (const w of pending) {
      const entry = data.task_progress?.[w.taskIndex]
      if (entry && entry.finish === true) {
        finalize(w, {
          kind: 'ok',
          finishedAt: entry.finishedAt ?? Date.now(),
          data,
        })
      }
    }
  }

  function finalize(w: Waiter, outcome: FinishOutcome): void {
    const idx = waiters.indexOf(w)
    if (idx >= 0) waiters.splice(idx, 1)
    clearTimeout(w.timer)
    if (w.signal && w.signalHandler) {
      w.signal.removeEventListener('abort', w.signalHandler)
    }
    w.resolve(outcome)
  }

  function scheduleCheck(): void {
    if (debounceTimer) return
    debounceTimer = setTimeout(() => {
      debounceTimer = null
      void checkAll()
    }, DEBOUNCE_MS)
  }

  return {
    start() {
      if (watcher) return
      try {
        watcher = fs.watch(workflowDataPath, { persistent: false }, () => {
          scheduleCheck()
        })
      } catch {
        // File may not exist yet; we'll still attempt to poll on-demand
        // when a waiter is added (see waitForFinish below).
      }
    },
    stop() {
      if (watcher) {
        watcher.close()
        watcher = null
      }
      if (debounceTimer) {
        clearTimeout(debounceTimer)
        debounceTimer = null
      }
      while (waiters.length > 0) {
        const w = waiters[0]!
        finalize(w, { kind: 'cancelled' })
      }
    },
    waitForFinish(taskIndex, timeoutMs, signal) {
      return new Promise<FinishOutcome>((resolve) => {
        const waiter: Waiter = {
          taskIndex,
          resolve,
          timer: setTimeout(() => finalize(waiter, { kind: 'timeout' }), timeoutMs),
          signal,
        }
        if (signal) {
          if (signal.aborted) {
            // already aborted before we even started
            resolve({ kind: 'cancelled' })
            clearTimeout(waiter.timer)
            return
          }
          waiter.signalHandler = () =>
            finalize(waiter, { kind: 'cancelled' })
          signal.addEventListener('abort', waiter.signalHandler, { once: true })
        }
        waiters.push(waiter)
        // Eager check in case the signal landed before the watcher started
        void checkAll()
      })
    },
    async read() {
      const data = await readSafe()
      if (!data) {
        throw new Error(`workflow_data.json not readable: ${workflowDataPath}`)
      }
      return data
    },
  }
}
