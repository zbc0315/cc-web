// frontend/src/components/tracks/graph/GraphCanvas.tsx
import { useMemo, useCallback, useRef, type DragEvent } from 'react'
import ReactFlow, {
  Background,
  Controls,
  MiniMap,
  useReactFlow,
} from 'reactflow'
import type {
  Node,
  Edge,
  Connection,
  NodeChange,
  EdgeChange,
} from 'reactflow'
import 'reactflow/dist/style.css'
import type { GraphV2, NodeV2 } from './graph-types-v2'
import type { Action } from './reducer-v2'
import { ReturnNodeView } from './nodes/ReturnNode'
import { CodeNodeView } from './nodes/CodeNode'
import { AskUserNodeView } from './nodes/AskUserNode'
import { FaiNodeView } from './nodes/FaiNode'
import { DeletableEdge } from './edges/DeletableEdge'
import { makeDefaultNode } from './NodePalette'

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

const EDGE_TYPES = {
  deletable: DeletableEdge,
}

// Default edge options: every new connection becomes a DeletableEdge so users
// can click the × at the midpoint to remove. Backspace/Delete still works as
// a fallback when the canvas (not Monaco) holds focus.
const DEFAULT_EDGE_OPTIONS = {
  type: 'deletable' as const,
}

export function GraphCanvas({ graph, dispatch, selectedNodeId, onSelect }: Props) {
  const canvasRef = useRef<HTMLDivElement>(null)
  // NOTE: useReactFlow() requires GraphCanvas to be mounted inside ReactFlowProvider
  // (wired up in Task 12 TrackGraphEditor)
  const flow = useReactFlow()

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
        type: 'deletable',
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

  const onDragOver = (ev: DragEvent<HTMLDivElement>) => {
    ev.preventDefault()
    ev.dataTransfer.dropEffect = 'move'
  }

  const onDrop = (ev: DragEvent<HTMLDivElement>) => {
    ev.preventDefault()
    const type = ev.dataTransfer.getData('application/x-ccweb-graph-node') as NodeV2['type']
    if (!type) return
    const flowPos = flow.screenToFlowPosition({ x: ev.clientX, y: ev.clientY })
    const node = makeDefaultNode(type, flowPos)
    dispatch({ type: 'add_node', node })
  }

  return (
    <div ref={canvasRef} className="flex-1 h-full" onDragOver={onDragOver} onDrop={onDrop}>
      <ReactFlow
        nodes={rfNodes}
        edges={rfEdges}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onConnect={onConnect}
        nodeTypes={NODE_TYPES}
        edgeTypes={EDGE_TYPES}
        defaultEdgeOptions={DEFAULT_EDGE_OPTIONS}
        deleteKeyCode={['Delete', 'Backspace']}
        fitView
      >
        <Background />
        <Controls />
        <MiniMap />
      </ReactFlow>
    </div>
  )
}
