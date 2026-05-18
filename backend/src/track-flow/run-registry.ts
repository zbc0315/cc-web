import { cleanupProjectCwd } from './train-json-sync'

export type RunStatus = 'pending' | 'running' | 'waiting_user_input' | 'completed' | 'failed' | 'cancelled'

export interface RunQuota {
  maxIterPerNode: number       // default 50
  maxLlmCalls: number          // default 100
  maxRunDurationMs: number     // default 2h
}

export interface RunInfo {
  runId: string
  projectId: string
  basename: string
  status: RunStatus
  startedAt: number            // unix ms
  quota: RunQuota
  iterCounts: Map<string, number>
  llmCallsCount: number
  cancelAbortController: AbortController
  error?: { nodeId?: string; message: string }
  pendingUserInput?: { nodeId: string; fields: { varKey: string; description: string; uiHint?: string }[] }
}

const DEFAULT_QUOTA: RunQuota = {
  maxIterPerNode: 50,
  maxLlmCalls: 100,
  maxRunDurationMs: 2 * 60 * 60 * 1000,
}

/**
 * In-memory registry of active flow runs.
 *
 * Lock semantics（spec §8.3）：同一 (projectId, basename) 同时只允许 1 个 active run。
 * 重复 register 抛 FLOW_ALREADY_RUNNING（路由层映射为 409）。
 */
export class FlowRunRegistry {
  private byRunId = new Map<string, RunInfo>()
  private activeByPath = new Map<string, string>()  // `${projectId}::${basename}` → runId

  start(opts: {
    runId: string
    projectId: string
    basename: string
    quotaOverride?: Partial<RunQuota>
  }): RunInfo {
    const key = pathKey(opts.projectId, opts.basename)
    const existing = this.activeByPath.get(key)
    if (existing) {
      const err = new Error(`FLOW_ALREADY_RUNNING`)
      ;(err as Error & { existingRunId?: string }).existingRunId = existing
      throw err
    }
    const info: RunInfo = {
      runId: opts.runId,
      projectId: opts.projectId,
      basename: opts.basename,
      status: 'pending',
      startedAt: Date.now(),
      quota: { ...DEFAULT_QUOTA, ...(opts.quotaOverride ?? {}) },
      iterCounts: new Map(),
      llmCallsCount: 0,
      cancelAbortController: new AbortController(),
    }
    this.byRunId.set(opts.runId, info)
    this.activeByPath.set(key, opts.runId)
    return info
  }

  get(runId: string): RunInfo | undefined {
    return this.byRunId.get(runId)
  }

  findActive(projectId: string, basename: string): RunInfo | undefined {
    const key = pathKey(projectId, basename)
    const runId = this.activeByPath.get(key)
    return runId ? this.byRunId.get(runId) : undefined
  }

  listActive(projectId: string): RunInfo[] {
    return [...this.byRunId.values()].filter((r) =>
      r.projectId === projectId &&
      (r.status === 'pending' || r.status === 'running' || r.status === 'waiting_user_input'),
    )
  }

  /**
   * Check & increment quotas. Returns null if all pass, or error message if exceeded.
   * 调用方在每节点循环开始前调一次。
   */
  checkQuotaForNode(runId: string, nodeId: string): string | null {
    const info = this.byRunId.get(runId)
    if (!info) return 'run not found'
    const newIter = (info.iterCounts.get(nodeId) ?? 0) + 1
    if (newIter > info.quota.maxIterPerNode) {
      return `node ${nodeId} exceeded maxIterPerNode (${info.quota.maxIterPerNode})`
    }
    info.iterCounts.set(nodeId, newIter)
    if (Date.now() - info.startedAt > info.quota.maxRunDurationMs) {
      return `run exceeded maxRunDurationMs (${info.quota.maxRunDurationMs}ms)`
    }
    return null
  }

  checkQuotaBeforeLlmCall(runId: string): string | null {
    const info = this.byRunId.get(runId)
    if (!info) return 'run not found'
    if (info.llmCallsCount + 1 > info.quota.maxLlmCalls) {
      return `run exceeded maxLlmCalls (${info.quota.maxLlmCalls})`
    }
    info.llmCallsCount += 1
    return null
  }

  /** Return remaining quotas for WS payload (spec §9.5 last bullet). */
  remainingQuota(runId: string, currentNodeId?: string): {
    iterRemaining?: number
    llmCallsRemaining: number
    durationRemainingMs: number
  } {
    const info = this.byRunId.get(runId)
    if (!info) return { llmCallsRemaining: 0, durationRemainingMs: 0 }
    const iterRemaining = currentNodeId !== undefined
      ? Math.max(0, info.quota.maxIterPerNode - (info.iterCounts.get(currentNodeId) ?? 0))
      : undefined
    return {
      iterRemaining,
      llmCallsRemaining: Math.max(0, info.quota.maxLlmCalls - info.llmCallsCount),
      durationRemainingMs: Math.max(0, info.quota.maxRunDurationMs - (Date.now() - info.startedAt)),
    }
  }

  updateStatus(runId: string, status: RunStatus, error?: RunInfo['error']): void {
    const info = this.byRunId.get(runId)
    if (!info) return
    info.status = status
    if (error) info.error = error
    if (status === 'completed' || status === 'failed' || status === 'cancelled') {
      this.activeByPath.delete(pathKey(info.projectId, info.basename))
    }
  }

  setPendingUserInput(runId: string, payload: RunInfo['pendingUserInput']): void {
    const info = this.byRunId.get(runId)
    if (info) info.pendingUserInput = payload
  }

  clearPendingUserInput(runId: string): void {
    const info = this.byRunId.get(runId)
    if (info) info.pendingUserInput = undefined
  }

  cancel(runId: string): boolean {
    const info = this.byRunId.get(runId)
    if (!info) return false
    info.cancelAbortController.abort()
    this.updateStatus(runId, 'cancelled')
    return true
  }
}

function pathKey(projectId: string, basename: string): string {
  return `${projectId}::${basename}`
}

/**
 * Singleton registry instance used by routes / runtime.
 */
export const flowRunRegistry = new FlowRunRegistry()

/**
 * Cleanup stale cwd train.json / workflow_data.json on daemon startup.
 * spec §9.6：daemon 重启检测到 cwd 文件存在视为"上次 run 异常中断"，删除。
 *
 * Pass a list of project folders to clean.
 */
export function cleanupStaleCwdFiles(projectFolders: string[]): void {
  for (const folder of projectFolders) {
    cleanupProjectCwd(folder)
  }
}
