// frontend/src/components/tracks/graph/sidecar-io.ts
import type { GraphV2 } from './graph-types-v2'
import { extractNidsFromSource } from './marker-v2'

export interface SidecarEnvelope {
  version: 2
  trackName: string
  nodes: GraphV2['nodes']
  edges: GraphV2['edges']
  savedAt: string        // ISO timestamp
  appVersion?: string    // ccweb version
}

export function encodeSidecar(graph: GraphV2, appVersion?: string): SidecarEnvelope {
  return {
    version: 2,
    trackName: graph.trackName,
    nodes: graph.nodes,
    edges: graph.edges,
    savedAt: new Date().toISOString(),
    appVersion,
  }
}

export interface DecodeResult {
  ok: boolean
  graph?: GraphV2
  reason?: string
}

export function decodeSidecar(raw: unknown): DecodeResult {
  if (!raw || typeof raw !== 'object') return { ok: false, reason: 'not an object' }
  const o = raw as Record<string, unknown>
  if (o.version !== 2) return { ok: false, reason: `unsupported version: ${o.version}` }
  if (typeof o.trackName !== 'string') return { ok: false, reason: 'trackName missing' }
  if (!Array.isArray(o.nodes) || !Array.isArray(o.edges)) {
    return { ok: false, reason: 'nodes/edges not arrays' }
  }
  return {
    ok: true,
    graph: {
      version: 2,
      trackName: o.trackName,
      nodes: o.nodes as GraphV2['nodes'],
      edges: o.edges as GraphV2['edges'],
    },
  }
}

export interface CrossCheckResult {
  ok: boolean
  missingNids: string[]  // in sidecar but not in .tr
  extraNids: string[]    // in .tr but not in sidecar
}

/**
 * Verify that sidecar node ids and .tr marker comments stay aligned.
 * On mismatch the editor surfaces the recovery dialog (spec §11.4).
 */
export function crossCheck(graph: GraphV2, source: string): CrossCheckResult {
  const sourceNids = extractNidsFromSource(source)
  const graphNids = new Set(graph.nodes.map((n) => n.id))
  const missingNids = [...graphNids].filter((id) => !sourceNids.has(id))
  const extraNids = [...sourceNids].filter((id) => !graphNids.has(id))
  return { ok: missingNids.length === 0 && extraNids.length === 0, missingNids, extraNids }
}
