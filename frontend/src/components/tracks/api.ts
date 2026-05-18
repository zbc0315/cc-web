// frontend/src/components/tracks/api.ts
import { getToken } from '@/lib/api'
import type { TrackFileInfo } from './types'
import type { FlowV3 } from './flow/flow-types-v3'

async function req<T>(method: string, path: string, body?: unknown): Promise<T> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  const token = getToken()
  if (token) headers['Authorization'] = `Bearer ${token}`
  const res = await fetch(path, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  })
  if (!res.ok) {
    let msg = `HTTP ${res.status}`
    let detail: unknown = undefined
    try {
      detail = await res.json()
      const e = detail as { error?: string }
      if (e?.error) msg = e.error
    } catch {
      /* ignore */
    }
    // 透出 status + 原始 body：调用方需要看 409 FLOW_ALREADY_RUNNING 里的
    // existingRunId 去 attach 已有 run，否则 autoRun 路径会卡死显示"运行失败"。
    const err = new Error(msg) as Error & { status?: number; detail?: unknown }
    err.status = res.status
    err.detail = detail
    throw err
  }
  return res.json() as Promise<T>
}

// ── Project tracks (read-only after M0; v3 flows API lands in M1) ────────

export function listTracks(projectId: string): Promise<{ files: TrackFileInfo[] }> {
  return req('GET', `/api/projects/${projectId}/tracks`)
}

export function getTrack(
  projectId: string,
  filename: string,
): Promise<{ filename: string; source: string }> {
  return req(
    'GET',
    `/api/projects/${projectId}/tracks/file/${encodeURIComponent(filename)}`,
  )
}

export function deleteTrack(
  projectId: string,
  filename: string,
): Promise<{ ok: boolean }> {
  return req(
    'DELETE',
    `/api/projects/${projectId}/tracks/file/${encodeURIComponent(filename)}`,
  )
}

// ── Track flows v3（spec §12.3） ─────────────────────────────────────────

export interface FlowFileInfo {
  filename: string
  basename: string
  size: number
  mtimeMs: number
}

export function listFlows(projectId: string): Promise<{ files: FlowFileInfo[] }> {
  return req('GET', `/api/projects/${projectId}/track-flows`)
}

export function getFlow(
  projectId: string,
  filename: string,
): Promise<{ filename: string; flow: FlowV3; trainJson: Record<string, unknown> | null }> {
  return req(
    'GET',
    `/api/projects/${projectId}/track-flows/file/${encodeURIComponent(filename)}`,
  )
}

export function saveFlow(
  projectId: string,
  filename: string,
  flow: FlowV3,
  trainJson?: Record<string, unknown>,
  opts?: { createOnly?: boolean },
): Promise<{ ok: boolean }> {
  // createOnly=true 时 backend 在 filename 已存在 → 409 FLOW_FILE_EXISTS，
  // 避免新建工作轨流程静默覆盖已有 flow（caller catch e.detail.code 判断）。
  const body: Record<string, unknown> = { flow }
  if (trainJson !== undefined) body.trainJson = trainJson
  if (opts?.createOnly) body.createOnly = true
  return req(
    'PUT',
    `/api/projects/${projectId}/track-flows/file/${encodeURIComponent(filename)}`,
    body,
  )
}

export function deleteFlow(
  projectId: string,
  filename: string,
): Promise<{ ok: boolean }> {
  return req(
    'DELETE',
    `/api/projects/${projectId}/track-flows/file/${encodeURIComponent(filename)}`,
  )
}

// ── Track flows v3 runtime ───────────────────────────────────────────────

export function runFlow(
  projectId: string,
  filename: string,
  quotaOverride?: { maxIterPerNode?: number; maxLlmCalls?: number; maxRunDurationMs?: number },
): Promise<{ runId: string }> {
  return req(
    'POST',
    `/api/projects/${projectId}/track-flows/file/${encodeURIComponent(filename)}/run`,
    quotaOverride ? { quotaOverride } : {},
  )
}

export function cancelFlow(
  projectId: string,
  filename: string,
  runId?: string,
): Promise<{ ok: boolean; runId?: string; message?: string }> {
  return req(
    'POST',
    `/api/projects/${projectId}/track-flows/file/${encodeURIComponent(filename)}/cancel`,
    runId ? { runId } : {},
  )
}

export interface FlowRunStateRehydrate {
  runId: string
  basename: string
  status: 'pending' | 'running' | 'waiting_user_input' | 'completed' | 'failed' | 'cancelled'
  startedAt: number
  snapshot: Record<string, unknown>
  currentNodeId: string | null
  nodeStates: Record<string, 'active' | 'completed' | 'failed' | 'skipped'>
  pendingUserInput?: { nodeId: string; fields: { varKey: string; uiHint?: string; variants?: string[] }[] }
  error?: { nodeId?: string; message: string }
  quota: { iterRemaining?: number; llmCallsRemaining: number; durationRemainingMs: number }
}

export function getRunState(
  projectId: string,
  runId: string,
): Promise<FlowRunStateRehydrate> {
  return req('GET', `/api/projects/${projectId}/track-flows/runs/${encodeURIComponent(runId)}/state`)
}

export function submitUserInput(
  projectId: string,
  filename: string,
  runId: string,
  values: Record<string, unknown>,
): Promise<{ ok: boolean }> {
  return req(
    'POST',
    `/api/projects/${projectId}/track-flows/file/${encodeURIComponent(filename)}/user_input`,
    { runId, values },
  )
}

export interface ActiveRunInfo {
  runId: string
  basename: string
  status: string
  startedAt: number
  pendingUserInput?: { nodeId: string; fields: { varKey: string; uiHint?: string; variants?: string[] }[] }
}

export function listActiveFlowRuns(projectId: string): Promise<{ runs: ActiveRunInfo[] }> {
  return req('GET', `/api/projects/${projectId}/track-flows/runs/active`)
}
