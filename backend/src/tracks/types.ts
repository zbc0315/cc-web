/**
 * ccweb "工作轨" (Track) — types.
 *
 * Track 是 ccweb 重构后的工作流，源码是 .tr 文件，执行引擎是 train-lang
 * (@tom2012/train-core)。本文件定义 ccweb 侧的辅助类型（pipe between
 * train-lang and ccweb's PTY infrastructure）。
 *
 * 详见 ~/Obsidian/Base/cc-web/工作轨重构规划.md §3-§5。
 */

/**
 * workflow_data.json schema (v2，与 backend/src/flows/types.ts 保持一致).
 * Track 沿用同一文件 + 同一协议，只是 train-lang 写入语义化的 outputs
 * 到 variables，task_progress 标记 finish。
 */
export interface WorkflowData {
  constants: Record<string, unknown>
  variables: Record<string, unknown>
  task_progress: TaskProgressEntry[]
}

export interface TaskProgressEntry {
  nodeId: number
  name: string
  finish: boolean
  startedAt: number
  finishedAt?: number
}

/**
 * Per-call accounting state held by TrackRunner. `taskIndex` is a
 * monotonically increasing counter scoped to a single track run; it
 * indexes into workflow_data.task_progress[].
 */
export interface TrackCallState {
  taskIndex: number
  faiName: string
  startedAt: number
  finishedAt?: number
}

export type TrackRunStatus =
  | 'idle'
  | 'running'
  | 'paused' // waiting for ask_user
  | 'completed'
  | 'failed'
  | 'cancelled'

export interface TrackRunState {
  runId: string
  trackFilename: string
  startedAt: number
  endedAt?: number
  status: TrackRunStatus
  /** Latest fai call index dispatched (for UI progress display). */
  currentTaskIndex?: number
  /** Final return value when status === completed. */
  result?: unknown
  /** Error message when status === failed. */
  error?: { errorType: string; message: string; code?: string }
}

/** Identity of a running adapter call — used by watcher.waitForFinish. */
export interface AdapterCallContext {
  /** Project + run ids for log/trace correlation. */
  projectId: string
  runId: string
  /** Index into workflow_data.task_progress[] for this call. */
  taskIndex: number
  /** Fai function name (for prompt header + log). */
  fnName: string
}
