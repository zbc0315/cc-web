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
    try {
      const j = (await res.json()) as { error?: string }
      if (j.error) msg = j.error
    } catch {
      /* ignore */
    }
    throw new Error(msg)
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
): Promise<{ ok: boolean }> {
  return req(
    'PUT',
    `/api/projects/${projectId}/track-flows/file/${encodeURIComponent(filename)}`,
    trainJson !== undefined ? { flow, trainJson } : { flow },
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
