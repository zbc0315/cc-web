// frontend/src/components/tracks/graph/GraphCanvas.tsx
import { useMemo, useCallback } from 'react'
import ReactFlow, {
  Background,
  Controls,
  MiniMap,
} from 'reactflow'
import type {
  Node,
  Edge,
  Connection,
  NodeChange,
  EdgeChange,
} from 'reactflow'
import 'reactflow/dist/style.css'
import type { GraphV2 } from './graph-types-v2'
import type { Action } from './reducer-v2'
import { ReturnNodeView } from './nodes/ReturnNode'
import { CodeNodeView } from './nodes/CodeNode'
import { AskUserNodeView } from './nodes/AskUserNode'
import { FaiNodeView } from './nodes/FaiNode'

interface Props {
  graph: GraphV2
  dispatch: (a: Action) => void
  selectedNodeId: string | null
  onSelect: (id: string | null) => void
}

const NODE_TYPES = {
  return: ReturnNodeView,
  code: CodeNodeView,
  ask_user: AskUserNodeView,
  fai: FaiNodeView,
}

export function GraphCanvas({ graph, dispatch, selectedNodeId, onSelect }: Props) {
  const rfNodes: Node[] = useMemo(
    () =>
      graph.nodes.map((n) => ({
        id: n.id,
        type: n.type,
        position: n.position,
        data: n,
        selected: n.id === selectedNodeId,
      })),
    [graph.nodes, selectedNodeId],
  )

  const rfEdges: Edge[] = useMemo(
    () =>
      graph.edges.map((e) => ({
        id: e.id,
        source: e.source,
        target: e.target,
        sourceHandle: e.sourceHandle ?? null,
      })),
    [graph.edges],
  )

  const onNodesChange = useCallback(
    (changes: NodeChange[]) => {
      for (const c of changes) {
        if (c.type === 'position' && c.position) {
          dispatch({ type: 'move_node', nodeId: c.id, position: c.position })
        } else if (c.type === 'remove') {
          dispatch({ type: 'remove_node', nodeId: c.id })
        } else if (c.type === 'select') {
          if (c.selected) onSelect(c.id)
          else if (selectedNodeId === c.id) onSelect(null)
        }
      }
    },
    [dispatch, onSelect, selectedNodeId],
  )

  const onEdgesChange = useCallback(
    (changes: EdgeChange[]) => {
      for (const c of changes) {
        if (c.type === 'remove') {
          dispatch({ type: 'remove_edge', edgeId: c.id })
        }
      }
    },
    [dispatch],
  )

  const onConnect = useCallback(
    (c: Connection) => {
      if (c.source && c.target) {
        dispatch({ type: 'add_edge', source: c.source, target: c.target })
      }
    },
    [dispatch],
  )

  return (
    <div className="flex-1 h-full">
      <ReactFlow
        nodes={rfNodes}
        edges={rfEdges}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onConnect={onConnect}
        nodeTypes={NODE_TYPES}
        fitView
      >
        <Background />
        <Controls />
        <MiniMap />
      </ReactFlow>
    </div>
  )
}
