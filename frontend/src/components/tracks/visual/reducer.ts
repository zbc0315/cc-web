// frontend/src/components/tracks/visual/reducer.ts
import type { Node, TrackGraph } from './graph-types'

export type Action =
  | { type: 'add'; node: Node; index: number }
  | { type: 'remove'; index: number }
  | { type: 'move'; from: number; to: number }
  | { type: 'duplicate'; index: number }
  | { type: 'update'; index: number; patch: Partial<Node> }

/**
 * M1 reducer: operates on the flat body array only. M2 will generalize to
 * NodePath traversal for nested containers (if/for).
 */
export function reduce(graph: TrackGraph, action: Action): TrackGraph {
  switch (action.type) {
    case 'add': {
      const body = [...graph.body]
      body.splice(action.index, 0, action.node)
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
      const clone: Node = JSON.parse(JSON.stringify(source))
      clone.id = 'n_' + Math.random().toString(36).slice(2, 10)
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
