import * as fs from 'fs'
import * as path from 'path'

/**
 * Append a JSONL line to `.ccweb/tracks/<basename>.flow.runs/<runId>.log.jsonl`.
 * Each line records a runtime event (spec §8.4).
 *
 * Events: node_active / node_completed / node_failed / node_skipped /
 *         user_input / cancelled / done / var_changed.
 */
export interface AuditEvent {
  ts: number                              // unix ms
  type: string
  nodeId?: string
  iter?: number
  varsDiff?: { key: string; old: unknown; new: unknown }[]
  message?: string
  extra?: Record<string, unknown>
}

function logDir(projectFolder: string, basename: string): string {
  return path.join(projectFolder, '.ccweb', 'tracks', `${basename}.flow.runs`)
}

function logPath(projectFolder: string, basename: string, runId: string): string {
  return path.join(logDir(projectFolder, basename), `${runId}.log.jsonl`)
}

export function appendAudit(
  projectFolder: string,
  basename: string,
  runId: string,
  event: AuditEvent,
): void {
  try {
    const dir = logDir(projectFolder, basename)
    fs.mkdirSync(dir, { recursive: true })
    const line = JSON.stringify(event) + '\n'
    fs.appendFileSync(logPath(projectFolder, basename, runId), line, 'utf8')
  } catch {
    /* swallow — audit is best-effort */
  }
}
