/**
 * TrackRunnerRegistry — per-project TrackRunner accounting.
 *
 * Singleton owned by backend/src/index.ts. Wraps creation of a runner
 * (with the project's PTY injector + workflow_data path) and exposes
 * lifecycle calls used by the HTTP route handlers.
 *
 * One project can have at most one in-flight track run; starting a
 * new one while another is running rejects with 'busy'.
 */

import * as path from 'path'

import { createTrackRunner, type TrackRunner } from './track-runner'
import { createWorkflowDataWatcher } from './workflow-data-watcher'
import { createAskUserBridge, type AskUserBridge, type AskUserFieldSpec } from './ask-user-bridge'
import type { TrackRunState, TrackRunStatus } from './types'

export interface TrackRegistryDeps {
  /** Look up the absolute project folder path by projectId. */
  getProjectFolder: (projectId: string) => string | null
  /** Inject text into the project's active CLI PTY. */
  injectIntoPty: (projectId: string, text: string) => Promise<void> | void
  /** Push a JSON message to all WS clients subscribed to this project. */
  broadcast: (projectId: string, message: Record<string, unknown>) => void
  /** Pino-compatible logger. */
  logger?: {
    debug?: PinoLogFn
    info?: PinoLogFn
    warn?: PinoLogFn
    error?: PinoLogFn
  }
}

// Match pino's two real-world call shapes: `(msg, ...interp)` and
// `(obj, msg)`. The latter is the structured form — keeping it typed
// here so callers can pass an object without TS misclassifying it as
// an interpolation arg (which pino would then silently drop).
interface PinoLogFn {
  (obj: object, msg?: string): void
  (msg: string, ...args: unknown[]): void
}

interface ProjectEntry {
  runner: TrackRunner
  bridge: AskUserBridge
  lastState: TrackRunState | null
  trackFilename: string
  /**
   * Synchronous in-flight gate. Set true at the start of registry.start()
   * BEFORE any await, cleared in the run's .then(). Prevents a second
   * start() between the first start()'s await loadTrain() and runner.run()
   * from racing past the `lastState?.status === 'running'` check.
   */
  inFlight: boolean
  /** runId stamped synchronously at start() so the route gets a real id. */
  runId: string
}

export interface TrackRegistry {
  /** Start a track run. */
  start(
    projectId: string,
    absTrackPath: string,
    trackFilename: string,
    args?: unknown[],
  ): Promise<{ ok: true; runId: string } | { ok: false; reason: string }>

  /** Cancel the in-flight run for a project. */
  abort(projectId: string): boolean

  /** Submit user input for a pending ask_user request. */
  submitInput(
    projectId: string,
    requestId: string,
    data: Record<string, unknown>,
  ): { ok: boolean; message?: string }

  /** Get the latest state for a project (running or last finished). */
  getState(projectId: string): TrackRunState | null

  /** True if a run is in flight (status === running or paused). */
  isRunning(projectId: string): boolean

  /** Get the pending ask_user request if any. */
  getPendingAskUser(projectId: string): {
    runId: string
    requestId: string
    fields: AskUserFieldSpec[]
  } | null
}

export function createTrackRegistry(deps: TrackRegistryDeps): TrackRegistry {
  const projects = new Map<string, ProjectEntry>()

  function emit(projectId: string, kind: string, payload: Record<string, unknown>): void {
    deps.broadcast(projectId, { type: kind, ...payload })
  }

  return {
    async start(projectId, absTrackPath, trackFilename, args = []) {
      // Synchronous in-flight gate — set BEFORE any await to close the
      // race window between two concurrent start() calls.
      const existing = projects.get(projectId)
      if (existing && (existing.inFlight || existing.lastState?.status === 'running')) {
        return { ok: false, reason: 'a track is already running for this project' }
      }

      const projectFolder = deps.getProjectFolder(projectId)
      if (!projectFolder) {
        return { ok: false, reason: 'project not found' }
      }

      const runId = `track-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`

      const workflowDataPath = path.join(projectFolder, '.ccweb', 'workflow_data.json')
      const watcher = createWorkflowDataWatcher(workflowDataPath)
      const bridge = createAskUserBridge((event) => {
        emit(projectId, 'track_ask_user', event as unknown as Record<string, unknown>)
      })

      const runner = createTrackRunner({
        projectId,
        injector: (text) => deps.injectIntoPty(projectId, text),
        watcher,
        logger: deps.logger,
        askUserBridge: bridge,
        // Pin the runner's runId to the one registry hands out, so
        // bridge.pending keys, registry.entry.runId, the runId returned
        // to the route, and state.runId all match. Pre-fix mismatch
        // made getPendingAskUser/submitInput/cancelAllForRun no-ops
        // since they looked up the wrong key.
        runId,
        onState: (state) => {
          // Ignore late callbacks from a previous run — only the run
          // whose runId matches the entry's current runId is allowed
          // to overwrite lastState. (Defense against runner finishing
          // after the entry has been replaced.)
          const e = projects.get(projectId)
          if (!e || e.runId !== runId) return
          e.lastState = state
          emit(projectId, 'track_status_change', {
            state: state as unknown as Record<string, unknown>,
          })
        },
      })

      const entry: ProjectEntry = {
        runner,
        bridge,
        lastState: null,
        trackFilename,
        inFlight: true,
        runId,
      }
      projects.set(projectId, entry)

      // Fire and forget — the run resolves later; route returns immediately.
      //
      // The .catch is defense-in-depth: track-runner converts its own
      // exceptions to TrackRunResult, so .then's callback handles every
      // expected outcome. But if track-runner ever throws (host bug, OOM,
      // future refactor), there's no .catch to break a rejected promise
      // chain — it escapes to logger.ts's unhandledRejection handler
      // which process.exit(1)s the entire daemon. The .catch keeps that
      // class of bug from killing ccweb.
      void runner
        .run(absTrackPath, args)
        .then((result) => {
          const e = projects.get(projectId)
          if (e && e.runId === runId) {
            e.inFlight = false
          }
          deps.logger?.info?.(
            { projectId, runId, ok: result.ok, error: result.error },
            '[TrackRegistry] run finished',
          )
          emit(projectId, 'track_run_complete', {
            ok: result.ok,
            value: result.value,
            error: result.error,
          })
        })
        .catch((err: unknown) => {
          const message = err instanceof Error ? err.message : String(err)
          deps.logger?.error?.(
            { projectId, runId, err: message },
            '[TrackRegistry] run threw — converted to failed event',
          )
          // Synthesize a terminal state so isRunning() returns false and
          // the frontend's track_status_change consumers see a definite
          // end-of-run, not a stuck 'running'. Without this, runner-level
          // bugs that future-broke runner's NEVER-THROW contract would
          // leave the project stuck (entry.lastState would stay null/running).
          const e = projects.get(projectId)
          const failedState: TrackRunState = {
            runId,
            trackFilename: e?.trackFilename ?? '',
            startedAt: e?.lastState?.startedAt ?? Date.now(),
            status: 'failed',
            endedAt: Date.now(),
            error: { errorType: 'RunnerThrew', message },
          }
          if (e && e.runId === runId) {
            e.inFlight = false
            e.lastState = failedState
          }
          emit(projectId, 'track_status_change', {
            state: failedState as unknown as Record<string, unknown>,
          })
          emit(projectId, 'track_run_complete', {
            ok: false,
            value: null,
            error: { errorType: 'RunnerThrew', message },
          })
        })

      return { ok: true, runId }
    },

    abort(projectId) {
      const entry = projects.get(projectId)
      if (!entry) return false
      entry.runner.cancel()
      entry.bridge.cancelAllForRun(entry.runId, 'aborted')
      return true
    },

    submitInput(projectId, requestId, data) {
      const entry = projects.get(projectId)
      if (!entry) return { ok: false, message: 'no track running for project' }
      // Pass values straight through — bridge.submitInput does per-field
      // type validation (text/number/bool/enum).
      return entry.bridge.submitInput(entry.runId, requestId, data as Record<string, never>)
    },

    getState(projectId) {
      return projects.get(projectId)?.lastState ?? null
    },

    isRunning(projectId) {
      const entry = projects.get(projectId)
      if (!entry) return false
      // Window 1: inFlight true during start() pre-state phase.
      // Window 2: lastState.status running/paused after first onState fires.
      if (entry.inFlight) return true
      const running: TrackRunStatus[] = ['running', 'paused']
      return entry.lastState ? running.includes(entry.lastState.status) : false
    },

    getPendingAskUser(projectId) {
      const entry = projects.get(projectId)
      if (!entry) return null
      return entry.bridge.getPending(entry.runId)
    },
  }
}
