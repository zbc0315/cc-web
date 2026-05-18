// frontend/src/components/tracks/flow/flow-sidecar-io.ts
import type { FlowV3, VarDecl } from './flow-types-v3'

export interface DecodeResult {
  ok: boolean
  flow?: FlowV3
  reason?: string
}

export function decodeFlow(raw: unknown): DecodeResult {
  if (!raw || typeof raw !== 'object') return { ok: false, reason: 'not an object' }
  const o = raw as Record<string, unknown>
  if (o.version !== 3) return { ok: false, reason: `unsupported version: ${o.version}` }
  if (typeof o.trackName !== 'string') return { ok: false, reason: 'trackName missing' }
  if (typeof o.adapter !== 'string') return { ok: false, reason: 'adapter missing' }
  if (!Array.isArray(o.variables) || !Array.isArray(o.nodes) || !Array.isArray(o.edges)) {
    return { ok: false, reason: 'variables/nodes/edges must be arrays' }
  }
  return { ok: true, flow: o as unknown as FlowV3 }
}

export function deriveTrainJsonFromVariables(vars: VarDecl[]): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const v of vars) {
    out[v.key] = v.initialValue ?? null
  }
  return out
}

export interface CrossCheckResult {
  ok: boolean
  missingKeys: string[]   // declared in variables but absent from train.json
  extraKeys: string[]     // present in train.json but not declared
}

export function crossCheckTrainJson(
  flow: FlowV3,
  trainJson: Record<string, unknown>,
): CrossCheckResult {
  const varKeys = new Set(flow.variables.map((v) => v.key))
  const jsonKeys = new Set(Object.keys(trainJson))
  const missingKeys = [...varKeys].filter((k) => !jsonKeys.has(k))
  const extraKeys = [...jsonKeys].filter((k) => !varKeys.has(k))
  return { ok: missingKeys.length === 0 && extraKeys.length === 0, missingKeys, extraKeys }
}
