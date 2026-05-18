// frontend/src/components/tracks/graph/edges/DeletableEdge.tsx
import { useState, type MouseEvent } from 'react'
import {
  BaseEdge,
  EdgeLabelRenderer,
  getBezierPath,
  type EdgeProps,
} from 'reactflow'
import { useGraphDispatch } from '../GraphContext'

/**
 * Default edge type with a × button at the midpoint.
 * The button shows on edge hover or when the edge is selected.
 * Click × → dispatch remove_edge.
 */
export function DeletableEdge(props: EdgeProps) {
  const { id, sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition, selected, style, markerEnd } = props
  const dispatch = useGraphDispatch()
  const [hovered, setHovered] = useState(false)

  const [edgePath, labelX, labelY] = getBezierPath({
    sourceX,
    sourceY,
    sourcePosition,
    targetX,
    targetY,
    targetPosition,
  })

  const onDelete = (e: MouseEvent) => {
    e.stopPropagation()
    dispatch({ type: 'remove_edge', edgeId: id })
  }

  // Invisible wide hit-area path on top of the visible edge so hover is forgiving
  return (
    <>
      <BaseEdge id={id} path={edgePath} markerEnd={markerEnd} style={style} />
      <path
        d={edgePath}
        fill="none"
        stroke="transparent"
        strokeWidth={20}
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
        style={{ cursor: 'pointer' }}
      />
      <EdgeLabelRenderer>
        {(hovered || selected) && (
          <div
            style={{
              position: 'absolute',
              transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)`,
              pointerEvents: 'all',
            }}
            className="nodrag nopan"
            onMouseEnter={() => setHovered(true)}
            onMouseLeave={() => setHovered(false)}
          >
            <button
              type="button"
              onClick={onDelete}
              className="rounded-full bg-white border border-gray-300 text-gray-500 hover:text-red-600 hover:border-red-400 w-5 h-5 leading-none text-sm shadow"
              title="删除连线"
            >
              ×
            </button>
          </div>
        )}
      </EdgeLabelRenderer>
    </>
  )
}
