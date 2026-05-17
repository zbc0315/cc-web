// frontend/src/components/tracks/graph/reducer-v2.ts
import type { GraphV2, NodeV2 } from './graph-types-v2'
import { newEdgeId } from './graph-types-v2'

export type Action =
  | { type: 'add_node'; node: NodeV2 }
  | { type: 'remove_node'; nodeId: string }
  | { type: 'update_node'; nodeId: string; patch: Partial<NodeV2> }
  | { type: 'move_node'; nodeId: string; position: { x: number; y: number } }
  | { type: 'add_edge'; source: string; target: string }
  | { type: 'remove_edge'; edgeId: string }
  | { type: 'set_track_name'; name: string }
  | { type: 'replace'; graph: GraphV2 }

export function initialGraph(trackName: string): GraphV2 {
  return { version: 2, trackName, nodes: [], edges: [] }
}

export function reducer(state: GraphV2, action: Action): GraphV2 {
  switch (action.type) {
    case 'add_node':
      return { ...state, nodes: [...state.nodes, action.node] }

    case 'remove_node':
      return {
        ...state,
        nodes: state.nodes.filter((n) => n.id !== action.nodeId),
        edges: state.edges.filter(
          (e) => e.source !== action.nodeId && e.target !== action.nodeId,
        ),
      }

    case 'update_node':
      return {
        ...state,
        nodes: state.nodes.map((n) =>
          n.id === action.nodeId ? ({ ...n, ...action.patch } as NodeV2) : n,
        ),
      }

    case 'move_node':
      return {
        ...state,
        nodes: state.nodes.map((n) =>
          n.id === action.nodeId ? { ...n, position: action.position } : n,
        ),
      }

    case 'add_edge': {
      const dup = state.edges.some(
        (e) => e.source === action.source && e.target === action.target,
      )
      if (dup) return state
      return {
        ...state,
        edges: [
          ...state.edges,
          {
            id: newEdgeId(),
            source: action.source,
            target: action.target,
            sourceHandle: 'default' as const,
          },
        ],
      }
    }

    case 'remove_edge':
      return { ...state, edges: state.edges.filter((e) => e.id !== action.edgeId) }

    case 'set_track_name':
      return { ...state, trackName: action.name }

    case 'replace':
      return action.graph

    default:
      return state
  }
}
