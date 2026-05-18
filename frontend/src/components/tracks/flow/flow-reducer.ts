// frontend/src/components/tracks/flow/flow-reducer.ts
import {
  AdapterKind, EdgeV3, FlowV3, NodeV3, VarDecl,
  emptyFlow, newEdgeId,
} from './flow-types-v3'

export type Action =
  | { type: 'add_variable'; variable: VarDecl }
  | { type: 'remove_variable'; key: string }
  | { type: 'update_variable'; key: string; patch: Partial<VarDecl> }
  | { type: 'add_node'; node: NodeV3 }
  | { type: 'remove_node'; nodeId: string }
  | { type: 'update_node'; nodeId: string; patch: Partial<NodeV3> }
  | { type: 'move_node'; nodeId: string; position: { x: number; y: number } }
  | { type: 'add_edge'; source: string; sourceHandle?: 'default' | 'true' | 'false'; target: string | null }
  | { type: 'remove_edge'; edgeId: string }
  | { type: 'set_track_name'; name: string }
  | { type: 'set_adapter'; adapter: AdapterKind }
  | { type: 'replace'; flow: FlowV3 }

export function initialFlow(trackName: string, adapter: AdapterKind = 'claude-code'): FlowV3 {
  return emptyFlow(trackName, adapter)
}

export function reducer(state: FlowV3, action: Action): FlowV3 {
  switch (action.type) {
    case 'add_variable':
      if (state.variables.some((v) => v.key === action.variable.key)) return state  // duplicate key ignored
      return { ...state, variables: [...state.variables, action.variable] }
    case 'remove_variable':
      return { ...state, variables: state.variables.filter((v) => v.key !== action.key) }
    case 'update_variable':
      return {
        ...state,
        variables: state.variables.map((v) =>
          v.key === action.key ? { ...v, ...action.patch } : v,
        ),
      }
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
          n.id === action.nodeId ? ({ ...n, ...action.patch } as NodeV3) : n,
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
      const handle = action.sourceHandle ?? 'default'
      const dup = state.edges.some(
        (e) =>
          e.source === action.source &&
          (e.sourceHandle ?? 'default') === handle &&
          e.target === action.target,
      )
      if (dup) return state
      const edge: EdgeV3 = {
        id: newEdgeId(),
        source: action.source,
        sourceHandle: handle,
        target: action.target,
      }
      return { ...state, edges: [...state.edges, edge] }
    }
    case 'remove_edge':
      return { ...state, edges: state.edges.filter((e) => e.id !== action.edgeId) }
    case 'set_track_name':
      return { ...state, trackName: action.name }
    case 'set_adapter':
      return { ...state, adapter: action.adapter }
    case 'replace':
      return action.flow
    default:
      return state
  }
}
