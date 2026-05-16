// frontend/src/components/tracks/visual/reducer.ts
import type { Node, TrackGraph } from './graph-types'
import { newNodeId, newItemId } from './default-nodes'

/** Patch type for `update`: allows any Node field except the `type` discriminant. */
type NodePatch = Node extends infer T ? T extends Node ? Partial<Omit<T, 'type'>> : never : never

export type Action =
  | { type: 'add'; node: Node; index: number }
  | { type: 'remove'; index: number }
  | { type: 'move'; from: number; to: number }
  | { type: 'duplicate'; index: number }
  | { type: 'update'; index: number; patch: NodePatch }

function nameOf(n: Node): string | null {
  if (n.type === 'ask_user') return n.outputVar
  if (n.type === 'fai') return n.outputVar
  if (n.type === 'let') return n.varName
  return null
}

function setName(n: Node, name: string): Node {
  if (n.type === 'ask_user') return { ...n, outputVar: name }
  if (n.type === 'fai') return { ...n, outputVar: name }
  if (n.type === 'let') return { ...n, varName: name }
  return n
}

/**
 * M1 reducer: operates on the flat body array only. M2 will generalize to
 * NodePath traversal for nested containers (if/for).
 */
export function reduce(graph: TrackGraph, action: Action): TrackGraph {
  switch (action.type) {
    case 'add': {
      const safeIndex = Math.max(0, Math.min(action.index, graph.body.length))
      const body = [...graph.body]
      body.splice(safeIndex, 0, action.node)
      return { ...graph, body }
    }
    case 'remove': {
      const body = graph.body.filter((_, i) => i !== action.index)
      return { ...graph, body }
    }
    case 'move': {
      const body = [...graph.body]
      const [moved] = body.splice(action.from, 1)
      if (!moved) return graph
      body.splice(action.to, 0, moved)
      return { ...graph, body }
    }
    case 'duplicate': {
      const source = graph.body[action.index]
      if (!source) return graph
      let clone: Node = JSON.parse(JSON.stringify(source))
      clone.id = newNodeId()
      // Regenerate item ids inside the clone
      if (clone.type === 'ask_user') clone.fields = clone.fields.map((f) => ({ ...f, id: newItemId() }))
      if (clone.type === 'fai') {
        clone.inputs = clone.inputs.map((i) => ({ ...i, id: newItemId() }))
        clone.outputs = clone.outputs.map((o) => ({ ...o, id: newItemId() }))
      }
      // Auto-unique the declared name to prevent codegen collisions
      const origName = nameOf(clone)
      if (origName) {
        const existing = new Set(graph.body.map(nameOf).filter((n): n is string => n !== null))
        let candidate = origName
        let n = 2
        while (existing.has(candidate)) {
          candidate = `${origName}_${n++}`
        }
        if (candidate !== origName) clone = setName(clone, candidate)
      }
      const body = [...graph.body]
      body.splice(action.index + 1, 0, clone)
      return { ...graph, body }
    }
    case 'update': {
      const body = graph.body.map((n, i) =>
        i === action.index ? ({ ...n, ...action.patch } as Node) : n,
      )
      return { ...graph, body }
    }
  }
}

export function makeEmptyGraph(trackName: string): TrackGraph {
  return { version: 1, trackName, body: [] }
}
