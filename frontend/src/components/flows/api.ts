import { getToken } from '@/lib/api';
import type { FlowDef, FlowState } from './types';

async function req<T>(method: string, path: string, body?: unknown): Promise<T> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  const token = getToken();
  if (token) headers['Authorization'] = `Bearer ${token}`;
  const res = await fetch(path, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    let msg = `HTTP ${res.status}`;
    try {
      const j = (await res.json()) as { error?: string };
      if (j.error) msg = j.error;
    } catch { /* ignore */ }
    throw new Error(msg);
  }
  return res.json() as Promise<T>;
}

export function listFlows(projectId: string): Promise<{ files: string[] }> {
  return req('GET', `/api/projects/${projectId}/flows`);
}

export function getFlow(projectId: string, filename: string): Promise<FlowDef> {
  return req('GET', `/api/projects/${projectId}/flows/file/${encodeURIComponent(filename)}`);
}

export function saveFlow(projectId: string, filename: string, def: FlowDef): Promise<{ ok: boolean }> {
  return req('PUT', `/api/projects/${projectId}/flows/file/${encodeURIComponent(filename)}`, def);
}

export function deleteFlow(projectId: string, filename: string): Promise<{ ok: boolean }> {
  return req('DELETE', `/api/projects/${projectId}/flows/file/${encodeURIComponent(filename)}`);
}

export type FlowSource = 'project' | 'global';

export function runFlow(
  projectId: string,
  filename: string,
  source: FlowSource = 'project',
): Promise<{ ok: boolean; state?: FlowState }> {
  return req('POST', `/api/projects/${projectId}/flows/run`, { filename, source });
}

// ── Per-user global flows ──────────────────────────────────────────────────
// Stored at ~/.ccweb/users/<username>/flows/. Reusable templates that, when
// run, bind to a project's folderPath/PTY/projectId.

export function listGlobalFlows(): Promise<{ files: string[] }> {
  return req('GET', `/api/global/flows`);
}

export function getGlobalFlow(filename: string): Promise<FlowDef> {
  return req('GET', `/api/global/flows/file/${encodeURIComponent(filename)}`);
}

export function saveGlobalFlow(filename: string, def: FlowDef): Promise<{ ok: boolean }> {
  return req('PUT', `/api/global/flows/file/${encodeURIComponent(filename)}`, def);
}

export function deleteGlobalFlow(filename: string): Promise<{ ok: boolean }> {
  return req('DELETE', `/api/global/flows/file/${encodeURIComponent(filename)}`);
}

export function abortFlow(projectId: string): Promise<{ ok: boolean }> {
  return req('POST', `/api/projects/${projectId}/flows/abort`);
}

export function resumeFlow(projectId: string): Promise<{ ok: boolean }> {
  return req('POST', `/api/projects/${projectId}/flows/resume`);
}

export function submitFlowInput(projectId: string, data: Record<string, string>): Promise<{ ok: boolean }> {
  return req('POST', `/api/projects/${projectId}/flows/input`, { data });
}

export function getFlowState(projectId: string): Promise<{ running: boolean; state: FlowState | null }> {
  return req('GET', `/api/projects/${projectId}/flows/state`);
}
