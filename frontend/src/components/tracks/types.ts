/**
 * Track types — frontend mirror of backend/src/tracks/types.ts.
 *
 * Keep field names in sync with backend. Diff against
 * `backend/src/tracks/types.ts` when changing either side.
 */

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
  currentTaskIndex?: number
  result?: unknown
  error?: { errorType: string; message: string; code?: string }
}

export interface TrackFileInfo {
  filename: string
  size: number
  mtime: number
}

// ── ask_user (matches backend AskUserFieldSpec / AskUserRequest) ──────────

export type AskUserFieldType = 'text' | 'enum' | 'number' | 'bool'

export interface AskUserFieldSpec {
  key: string
  label: string
  type: AskUserFieldType
  variants?: string[] // for type === 'enum'
  placeholder?: string
  required?: boolean
}

export interface AskUserRequest {
  runId: string
  requestId: string
  fields: AskUserFieldSpec[]
}

// ── WS push message shapes ───────────────────────────────────────────────

export interface WsTrackStatusChange {
  type: 'track_status_change'
  state: TrackRunState
}

export interface WsTrackAskUser {
  type: 'track_ask_user'
  kind: 'track_ask_user' // doubled for backend symmetry
  runId: string
  requestId: string
  fields: AskUserFieldSpec[]
}

export interface WsTrackRunComplete {
  type: 'track_run_complete'
  ok: boolean
  value: unknown
  error?: { errorType: string; message: string; code?: string }
}

export type WsTrackMessage =
  | WsTrackStatusChange
  | WsTrackAskUser
  | WsTrackRunComplete
