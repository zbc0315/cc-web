// frontend/src/components/tracks/flow/FlowCanvas.tsx
import { useMemo, useCallback, useRef, type DragEvent } from 'react'
import ReactFlow, {
  Background, Controls, MiniMap,
  useReactFlow,
  type Node, type Edge, type Connection,
  type NodeChange, type EdgeChange,
} from 'reactflow'
import 'reactflow/dist/style.css'
import type { FlowV3, NodeV3 } from './flow-types-v3'
import type { Action } from './flow-reducer'
import { makeDefaultNode } from './NodePalette'
import { UserInputNodeView } from './nodes/UserInputNode'
import { LLMNodeView } from './nodes/LLMNode'
import { IfNodeView } from './nodes/IfNode'
import { DeletableEdge } from './edges/DeletableEdge'

interface Props {
  flow: FlowV3
  dispatch: (a: Action) => void
  selectedNodeId: string | null
  onSelect: (id: string | null) => void
}

const NODE_TYPES = {
  user_input: UserInputNodeView,
  llm: LLMNodeView,
  if: IfNodeView,
}

const EDGE_TYPES = {
  deletable: DeletableEdge,
}

const DEFAULT_EDGE_OPTIONS = { type: 'deletable' as const }

/**
 * Compute display index (#1, #2, ...) via BFS from entry node(s).
 * Entry = no-incoming-edge node. Returns Map<nodeId, displayIndex>.
 */
function computeDisplayIndices(flow: FlowV3): Map<string, number> {
  const result = new Map<string, number>()
  if (flow.nodes.length === 0) return result

  const incomingCount = new Map<string, number>()
  for (const n of flow.nodes) incomingCount.set(n.id, 0)
  for (const e of flow.edges) {
    if (e.target !== null) {
      incomingCount.set(e.target, (incomingCount.get(e.target) ?? 0) + 1)
    }
  }

  const entries = flow.nodes.filter((n) => (incomingCount.get(n.id) ?? 0) === 0)
  const visited = new Set<string>()
  const queue = entries.map((n) => n.id)
  let i = 1

  while (queue.length > 0) {
    const id = queue.shift()!
    if (visited.has(id)) continue
    visited.add(id)
    result.set(id, i++)
    const outEdges = flow.edges.filter((e) => e.source === id && e.target !== null)
    for (const e of outEdges) {
      if (e.target && !visited.has(e.target)) queue.push(e.target)
    }
  }

  // Isolated nodes not reachable from any entry (disconnected subgraphs)
  for (const n of flow.nodes) {
    if (!visited.has(n.id)) result.set(n.id, i++)
  }

  return result
}

export function FlowCanvas({ flow, dispatch, selectedNodeId, onSelect }: Props) {
  const canvasRef = useRef<HTMLDivElement>(null)
  const rf = useReactFlow()

  const indices = useMemo(() => computeDisplayIndices(flow), [flow])

  const rfNodes: Node[] = useMemo(
    () =>
      flow.nodes.map((n) => ({
        id: n.id,
        type: n.type,
        position: n.position,
        data: n,
        selected: n.id === selectedNodeId,
      })),
    [flow.nodes, selectedNodeId],
  )

  const rfEdges: Edge[] = useMemo(
    () =>
      flow.edges
        .filter((e) => e.target !== null)
        .map((e) => ({
          id: e.id,
          source: e.source,
          target: e.target as string,
          sourceHandle: e.sourceHandle === 'default' ? null : (e.sourceHandle ?? null),
          type: 'deletable',
        })),
    [flow.edges],
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
      if (!c.source || !c.target) return
      const handle: 'default' | 'true' | 'false' =
        c.sourceHandle === 'true' || c.sourceHandle === 'false'
          ? c.sourceHandle
          : 'default'
      dispatch({
        type: 'add_edge',
        source: c.source,
        sourceHandle: handle,
        target: c.target,
      })
    },
    [dispatch],
  )

  const onDragOver = (ev: DragEvent<HTMLDivElement>) => {
    ev.preventDefault()
    ev.dataTransfer.dropEffect = 'move'
  }

  const onDrop = (ev: DragEvent<HTMLDivElement>) => {
    ev.preventDefault()
    const type = ev.dataTransfer.getData('application/x-ccweb-flow-node') as NodeV3['type']
    if (!type) return
    const flowPos = rf.screenToFlowPosition({ x: ev.clientX, y: ev.clientY })
    const node = makeDefaultNode(type, flowPos)
    dispatch({ type: 'add_node', node })
  }

  return (
    <div ref={canvasRef} className="flex-1 h-full relative" onDragOver={onDragOver} onDrop={onDrop}>
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
      {/* 拓扑编号 overlay：每节点左上角显示 #N */}
      <div className="absolute inset-0 pointer-events-none">
        {flow.nodes.map((n) => {
          const idx = indices.get(n.id)
          if (idx === undefined) return null
          const pos = rf.flowToScreenPosition({ x: n.position.x, y: n.position.y })
          if (!pos) return null
          return (
            <div
              key={`label-${n.id}`}
              className="absolute text-xs text-muted-foreground font-mono bg-background/80 px-1 rounded"
              style={{ left: pos.x - 4, top: pos.y - 16 }}
            >
              #{idx}
            </div>
          )
        })}
      </div>
    </div>
  )
}
