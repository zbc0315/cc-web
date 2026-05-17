// frontend/src/components/tracks/graph/topo-codegen.ts
import type { EdgeV2, NodeV2 } from './graph-types-v2'

export interface TopoResult {
  ordered: NodeV2[]               // 拓扑序节点（顶层单链）
  errors: string[]
}

/**
 * Walk the top-level chain from entry to exit along default-handle edges.
 * M1 doesn't recurse into frames (no frame nodes yet).
 *
 * Returns ordered = entry → ... → terminal, or errors if multi-entry / orphans / cycles.
 */
export function topoOrderTopLevel(nodes: NodeV2[], edges: EdgeV2[]): TopoResult {
  const errors: string[] = []
  const topLevel = nodes.filter((n) => n.parentId === undefined)

  if (topLevel.length === 0) {
    errors.push('空 graph（无顶层节点）')
    return { ordered: [], errors }
  }

  // Build incoming-edge count for top-level nodes only
  const topLevelIds = new Set(topLevel.map((n) => n.id))
  const inDegree = new Map<string, number>()
  for (const n of topLevel) inDegree.set(n.id, 0)
  for (const e of edges) {
    if (topLevelIds.has(e.source) && topLevelIds.has(e.target)) {
      inDegree.set(e.target, (inDegree.get(e.target) ?? 0) + 1)
    }
  }

  // Detect fully isolated nodes (no edges touching them at all) first
  const connectedIds = new Set<string>()
  for (const e of edges) {
    if (topLevelIds.has(e.source)) connectedIds.add(e.source)
    if (topLevelIds.has(e.target)) connectedIds.add(e.target)
  }
  // A node is isolated if it has no edges AND there are other nodes
  const isolated = topLevel.length > 1
    ? topLevel.filter((n) => !connectedIds.has(n.id))
    : []
  if (isolated.length > 0) {
    errors.push(`孤立未连接节点：${isolated.map((n) => n.id).join(', ')}`)
    return { ordered: [], errors }
  }

  // Entry = top-level node with in-degree 0
  const entries = topLevel.filter((n) => (inDegree.get(n.id) ?? 0) === 0)
  if (entries.length === 0) {
    errors.push('无入口节点（图中存在环）')
    return { ordered: [], errors }
  }
  if (entries.length > 1) {
    errors.push(`多入口节点：${entries.map((n) => n.id).join(', ')}`)
    return { ordered: [], errors }
  }

  // Walk default-handle chain from entry
  const ordered: NodeV2[] = []
  const visited = new Set<string>()
  let cur: NodeV2 | null = entries[0]!
  while (cur !== null) {
    if (visited.has(cur.id)) {
      errors.push(`检测到环：${cur.id}`)
      return { ordered: [], errors }
    }
    visited.add(cur.id)
    ordered.push(cur)
    const outEdges = edges.filter(
      (e) =>
        e.source === cur!.id &&
        (e.sourceHandle === 'default' || e.sourceHandle === undefined) &&
        topLevelIds.has(e.target),
    )
    if (outEdges.length === 0) {
      cur = null
    } else if (outEdges.length === 1) {
      cur = topLevel.find((n) => n.id === outEdges[0]!.target) ?? null
    } else {
      errors.push(`节点 ${cur.id} 顶层出度 > 1（M1 不支持 fan-out，请用 IfFrame）`)
      return { ordered: [], errors }
    }
  }

  // Orphan check
  if (visited.size < topLevel.length) {
    const orphans = topLevel.filter((n) => !visited.has(n.id)).map((n) => n.id)
    errors.push(`孤立未连接节点：${orphans.join(', ')}`)
    return { ordered: [], errors }
  }

  return { ordered, errors: [] }
}
