// frontend/src/components/tracks/graph/scope-v2.ts
import type { GraphV2, NodeV2 } from './graph-types-v2'

/**
 * Names declared by a single node (visible to its downstream).
 * For CodeNode we use a simple `let <name>` regex; M1 doesn't claim
 * full train-lang parse — Phase 2 LSP integration will replace this.
 */
export function namesDeclaredBy(n: NodeV2): string[] {
  if (n.type === 'ask_user') return [n.outputVar]
  if (n.type === 'fai') return [n.outputVar]
  if (n.type === 'code') {
    const re = /\blet\s+([a-zA-Z_][a-zA-Z0-9_]*)/g
    const out: string[] = []
    let m: RegExpExecArray | null
    while ((m = re.exec(n.code)) !== null) {
      if (m[1]) out.push(m[1])
    }
    return out
  }
  return []
}

/**
 * Walk upstream from target node along default-handle edges in the
 * top-level chain. Collect all declared names on the path.
 *
 * M1: top-level chain only. M2 will add frame-aware scope.
 */
export function visibleVarsAt(graph: GraphV2, targetNodeId: string): string[] {
  const byId = new Map(graph.nodes.map((n) => [n.id, n] as const))
  const visited = new Set<string>()
  const collected: string[] = []

  function walkUpstream(nodeId: string): void {
    if (visited.has(nodeId)) return
    visited.add(nodeId)
    const incoming = graph.edges.filter((e) => e.target === nodeId)
    for (const e of incoming) {
      const up = byId.get(e.source)
      if (!up) continue
      walkUpstream(up.id)
      collected.push(...namesDeclaredBy(up))
    }
  }

  walkUpstream(targetNodeId)
  // Dedup preserving order
  const seen = new Set<string>()
  return collected.filter((name) => (seen.has(name) ? false : (seen.add(name), true)))
}
