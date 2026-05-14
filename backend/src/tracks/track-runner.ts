/**
 * TrackRunner — thin wrapper around train-lang's runFile that wires
 * the CcwebTrainAdapter + WorkflowDataWatcher + writeProtocolHint into
 * a single ergonomic API for the rest of the ccweb backend.
 *
 * Lifecycle:
 *   const runner = createTrackRunner({ ... deps ... })
 *   const result = await runner.run(absTrackPath)
 *   // result.ok / result.value / result.error
 *
 * Cancel mid-run: runner.cancel() → AbortController fires → train
 * short-circuits next fai dispatch + adapter reports FaiCancelled.
 *
 * train-lang is ESM and ccweb backend is CommonJS, so we use a
 * dynamic import (cached at first call). This is the standard
 * CJS→ESM interop pattern.
 *
 * 详见 ~/Obsidian/Base/cc-web/工作轨重构规划.md §9 T0。
 */

import {
  createCcwebTrainAdapter,
  buildCcwebWriteProtocolHint,
  type CcwebAdapterDeps,
} from './ccweb-train-adapter'
import type { WorkflowDataWatcher } from './workflow-data-watcher'
import type { TrackRunState } from './types'

export interface TrackRunnerDeps {
  projectId: string
  injector: CcwebAdapterDeps['injector']
  watcher: WorkflowDataWatcher
  /** Total fai attempts per call. Default 3. */
  maxFaiAttempts?: number
  /** Per-fai-call timeout (ms). Default 600_000. */
  defaultFaiTimeoutMs?: number
  /** Logger (pino). */
  logger?: CcwebAdapterDeps['logger']
  /** Optional extra trace listener for UI progress. */
  onState?: (state: TrackRunState) => void
}

export interface TrackRunResult {
  ok: boolean
  value: unknown
  error?: { errorType: string; message: string; code?: string }
}

interface TrainModule {
  runFile: (
    absPath: string,
    opts: TrainRunOptions,
  ) => Promise<TrainRunSourceResult>
  TrainException: new (...args: unknown[]) => Error & {
    errorType: string
    message: string
    code?: string
  }
}

interface TrainRunOptions {
  entry?: string
  args?: unknown[]
  adapter?: unknown
  maxFaiAttempts?: number
  defaultFaiTimeoutMs?: number
  writeProtocolHint?: string
  signal?: AbortSignal
}

interface TrainRunSourceResult {
  ok: boolean
  value: unknown
  error?: {
    errorType?: string
    message: string
    code?: string
  }
  lexErrors: ReadonlyArray<unknown>
  parseErrors: ReadonlyArray<unknown>
}

// `import('@train-lang/core')` would be transpiled to require() by
// ts-node with module=commonjs, which fails because train-lang ships
// ESM-only. We use Function() to defer the import expression past the
// TypeScript compiler so it stays as a native dynamic import.
const dynamicImport = new Function(
  'p',
  'return import(p)',
) as (p: string) => Promise<unknown>

let trainModulePromise: Promise<TrainModule> | null = null
async function loadTrain(): Promise<TrainModule> {
  if (!trainModulePromise) {
    trainModulePromise = dynamicImport(
      '@train-lang/core',
    ) as Promise<TrainModule>
  }
  return trainModulePromise
}

export interface TrackRunner {
  /** Run a .tr file. Resolves when the track terminates (success/fail/cancel). */
  run(absTrackPath: string, args?: unknown[]): Promise<TrackRunResult>
  /** Cancel an in-flight run. */
  cancel(): void
  /** Current state snapshot. */
  getState(): TrackRunState | null
}

export function createTrackRunner(deps: TrackRunnerDeps): TrackRunner {
  let state: TrackRunState | null = null
  let abortController: AbortController | null = null
  let taskIndexCounter = 0

  function updateState(patch: Partial<TrackRunState>): void {
    if (!state) return
    state = { ...state, ...patch }
    deps.onState?.(state)
  }

  return {
    async run(absTrackPath, args = []): Promise<TrackRunResult> {
      const train = await loadTrain()

      const runId = `track-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
      state = {
        runId,
        trackFilename: absTrackPath.split('/').pop() ?? absTrackPath,
        startedAt: Date.now(),
        status: 'running',
      }
      deps.onState?.(state)

      abortController = new AbortController()

      // Start watcher just before run begins
      deps.watcher.start()

      const adapter = createCcwebTrainAdapter({
        projectId: deps.projectId,
        runId,
        injector: deps.injector,
        watcher: deps.watcher,
        nextTaskIndex: () => {
          const i = taskIndexCounter++
          updateState({ currentTaskIndex: i })
          return i
        },
        logger: deps.logger,
      })

      try {
        const result = await train.runFile(absTrackPath, {
          args,
          adapter,
          maxFaiAttempts: deps.maxFaiAttempts ?? 3,
          defaultFaiTimeoutMs: deps.defaultFaiTimeoutMs ?? 600_000,
          writeProtocolHint: buildCcwebWriteProtocolHint(),
          signal: abortController.signal,
        })

        if (result.lexErrors.length > 0 || result.parseErrors.length > 0) {
          const message = `parse errors in ${absTrackPath} (${result.lexErrors.length + result.parseErrors.length})`
          updateState({
            status: 'failed',
            endedAt: Date.now(),
            error: { errorType: 'ParseError', message },
          })
          return { ok: false, value: null, error: { errorType: 'ParseError', message } }
        }

        if (!result.ok) {
          const exc = result.error
          const errObj = exc
            ? {
                errorType: exc.errorType ?? 'RuntimeError',
                message: exc.message,
                code: exc.code,
              }
            : { errorType: 'RuntimeError', message: 'unknown failure' }
          const finalStatus: TrackRunState['status'] =
            errObj.errorType === 'UserCancelError' ? 'cancelled' : 'failed'
          updateState({ status: finalStatus, endedAt: Date.now(), error: errObj })
          return { ok: false, value: null, error: errObj }
        }

        updateState({
          status: 'completed',
          endedAt: Date.now(),
          result: result.value,
        })
        return { ok: true, value: result.value }
      } finally {
        deps.watcher.stop()
        abortController = null
      }
    },

    cancel() {
      if (abortController) {
        abortController.abort()
        deps.logger?.info?.('[TrackRunner] cancel requested')
      }
    },

    getState() {
      return state
    },
  }
}
