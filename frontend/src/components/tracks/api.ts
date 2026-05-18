// frontend/src/components/tracks/api.ts
import { getToken } from '@/lib/api'
import type { TrackFileInfo } from './types'

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
