// frontend/src/components/tracks/visual/scope.ts
import type { TrackGraph } from './graph-types'

/**
 * A scope entry describes one declared name reachable from a given point.
 * `parts` describes "what fields can follow the @".
 */
export interface ScopeEntry {
  name: string                     // root name: 'r', 'input', 'x'
  source: 'ask_user' | 'fai' | 'let' | 'for-iter'
  parts: string[]                  // ['rating','comment']
}

/**
 * Visible variables at body index `at` (exclusive of node at `at` itself —
 * a node cannot reference its own outputVar). M1 flat-body version.
 */
export function scopeAt(graph: TrackGraph, at: number): ScopeEntry[] {
  const out: ScopeEntry[] = []
  for (let i = 0; i < at; i++) {
    const n = graph.body[i]
    if (!n) continue
    if (n.type === 'ask_user') {
      out.push({
        name: n.outputVar,
        source: 'ask_user',
        parts: n.fields.map((f) => f.key),
      })
    } else if (n.type === 'fai') {
      out.push({
        name: n.outputVar,
        source: 'fai',
        parts: n.outputs.map((o) => o.name),
      })
    } else if (n.type === 'let') {
      out.push({ name: n.varName, source: 'let', parts: [] })
    }
  }
  return out
}

/** Flatten scope into "r" + "r.rating" candidate strings for @ dropdown. */
export function scopeCandidates(graph: TrackGraph, at: number): string[] {
  const out: string[] = []
  for (const e of scopeAt(graph, at)) {
    out.push(e.name)
    for (const p of e.parts) out.push(`${e.name}.${p}`)
  }
  return out
}

export function isVarVisible(
  graph: TrackGraph,
  at: number,
  path: string[],
): boolean {
  if (path.length === 0) return false
  const candidates = scopeCandidates(graph, at)
  return candidates.includes(path.join('.'))
}
