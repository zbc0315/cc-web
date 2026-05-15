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
    debug?: (msg: string, ...args: unknown[]) => void
    info?: (msg: string, ...args: unknown[]) => void
    warn?: (msg: string, ...args: unknown[]) => void
    error?: (msg: string, ...args: unknown[]) => void
  }
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
      void runner.run(absTrackPath, args).then((result) => {
        const e = projects.get(projectId)
        if (e && e.runId === runId) {
          e.inFlight = false
        }
        deps.logger?.info?.('[TrackRegistry] run finished', {
          projectId,
          runId,
          ok: result.ok,
          error: result.error,
        })
        emit(projectId, 'track_run_complete', {
          ok: result.ok,
          value: result.value,
          error: result.error,
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
