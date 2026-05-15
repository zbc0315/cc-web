import { getToken } from '@/lib/api'
import type { TrackRunState, TrackFileInfo, AskUserRequest } from './types'

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

// ── Project tracks CRUD ──────────────────────────────────────────────────

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

export function saveTrack(
  projectId: string,
  filename: string,
  source: string,
): Promise<{ ok: boolean }> {
  return req(
    'PUT',
    `/api/projects/${projectId}/tracks/file/${encodeURIComponent(filename)}`,
    { source },
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

// ── Runtime ──────────────────────────────────────────────────────────────

export type TrackSource = 'project' | 'global'

export function runTrack(
  projectId: string,
  filename: string,
  source: TrackSource = 'project',
  args: unknown[] = [],
): Promise<{ ok: boolean; runId?: string }> {
  return req('POST', `/api/projects/${projectId}/tracks/run`, {
    filename,
    source,
    args,
  })
}

export function abortTrack(projectId: string): Promise<{ ok: boolean }> {
  return req('POST', `/api/projects/${projectId}/tracks/abort`)
}

export function submitTrackInput(
  projectId: string,
  requestId: string,
  data: Record<string, unknown>,
): Promise<{ ok: boolean }> {
  return req('POST', `/api/projects/${projectId}/tracks/input`, {
    requestId,
    data,
  })
}

export function getTrackState(
  projectId: string,
): Promise<{
  running: boolean
  state: TrackRunState | null
  pendingAskUser: AskUserRequest | null
}> {
  return req('GET', `/api/projects/${projectId}/tracks/state`)
}

// ── Per-user global tracks ───────────────────────────────────────────────

export function listGlobalTracks(): Promise<{ files: TrackFileInfo[] }> {
  return req('GET', `/api/global/tracks`)
}

export function getGlobalTrack(
  filename: string,
): Promise<{ filename: string; source: string }> {
  return req('GET', `/api/global/tracks/file/${encodeURIComponent(filename)}`)
}

export function saveGlobalTrack(
  filename: string,
  source: string,
): Promise<{ ok: boolean }> {
  return req('PUT', `/api/global/tracks/file/${encodeURIComponent(filename)}`, {
    source,
  })
}

export function deleteGlobalTrack(
  filename: string,
): Promise<{ ok: boolean }> {
  return req(
    'DELETE',
    `/api/global/tracks/file/${encodeURIComponent(filename)}`,
  )
}
