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
import {
  createAskUserBuiltin,
  type AskUserBridge,
} from './ask-user-bridge'

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
  /**
   * Bridge for __ccweb_ask_user builtin. When provided, .tr code can
   * call __ccweb_ask_user({fields:[...]}) to suspend on user input.
   * Without a bridge, the builtin is not registered; calls fail with
   * "Undefined identifier '__ccweb_ask_user'".
   */
  askUserBridge?: AskUserBridge
  /**
   * Pre-allocated runId. The caller (registry) needs to know the runId
   * synchronously before run() awaits, so it can route submitInput /
   * getPendingAskUser to the right bridge entry. If omitted, runner
   * generates one. Used so registry.entry.runId === bridge pending key.
   */
  runId?: string
}

export interface TrackRunResult {
  ok: boolean
  value: unknown
  error?: { errorType: string; message: string; code?: string }
}

import type { TrainCoreModule as TrainModule } from './train-loader'

interface TrainRunOptions {
  entry?: string
  args?: unknown[]
  adapter?: unknown
  maxFaiAttempts?: number
  defaultFaiTimeoutMs?: number
  writeProtocolHint?: string
  signal?: AbortSignal
  extraBuiltins?: Map<string, unknown>
}

import { loadTrainCore } from './train-loader'

async function loadTrain(): Promise<TrainModule> {
  // Reuse the shared cache in train-loader.ts so multiple consumers
  // (TrackRunner, AskUserBuiltin factory, any future host extension)
  // get the same module instance — avoids ESM module-graph duplication
  // and removes the double-cache foot-gun.
  return loadTrainCore()
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

      const runId =
        deps.runId ?? `track-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
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

      // Build extraBuiltins map (currently: __ccweb_ask_user if bridge provided)
      const extraBuiltins = new Map<string, unknown>()
      if (deps.askUserBridge) {
        const askUserFn = await createAskUserBuiltin(
          deps.askUserBridge,
          runId,
          abortController.signal,
        )
        extraBuiltins.set('__ccweb_ask_user', askUserFn)
      }

      try {
        const result = await train.runFile(absTrackPath, {
          args,
          adapter,
          maxFaiAttempts: deps.maxFaiAttempts ?? 3,
          defaultFaiTimeoutMs: deps.defaultFaiTimeoutMs ?? 600_000,
          writeProtocolHint: buildCcwebWriteProtocolHint(),
          signal: abortController.signal,
          extraBuiltins,
        } satisfies TrainRunOptions)

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
      } catch (err) {
        // NEVER-THROW contract: runFile / builtin / adapter throws (incl.
        // ask_user reject during abort) MUST be converted into TrackRunResult.
        // Without this catch the throw escapes runner.run, registry.ts's
        // `void runner.run(...).then(...)` has no .catch, and the global
        // unhandledRejection handler (logger.ts) calls process.exit(1).
        // → entire ccweb daemon dies whenever a track with pending ask_user
        // is aborted. (Repro: v-15-f / v-15-g logs, 2026-05-16 07:35 / 07:36.)
        const aborted = abortController?.signal.aborted ?? false
        const e = err as { message?: string; code?: string; errorType?: string }
        const errObj = aborted
          ? {
              errorType: 'UserCancelError',
              message: e?.message ?? 'cancelled',
            }
          : {
              errorType: e?.errorType ?? 'RuntimeError',
              message: e?.message ?? String(err),
              code: e?.code,
            }
        const finalStatus: TrackRunState['status'] = aborted ? 'cancelled' : 'failed'
        updateState({ status: finalStatus, endedAt: Date.now(), error: errObj })
        return { ok: false, value: null, error: errObj }
      } finally {
        deps.watcher.stop()
        if (deps.askUserBridge && state) {
          // Drain any pending ask_user that the bridge still holds.
          deps.askUserBridge.cancelAllForRun(state.runId, 'run ended')
        }
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
