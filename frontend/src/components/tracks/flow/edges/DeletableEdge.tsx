// frontend/src/components/tracks/flow/edges/DeletableEdge.tsx
// v-m：删除按钮换 lucide X + 语义 token + dark: 友好；
import { useState, type MouseEvent } from 'react'
import { BaseEdge, EdgeLabelRenderer, getBezierPath, type EdgeProps } from 'reactflow'
import { X } from 'lucide-react'
import { useGraphDispatch } from '../GraphContext'

export function DeletableEdge(props: EdgeProps) {
  const { id, sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition, selected, style, markerEnd } = props
  const dispatch = useGraphDispatch()
  const [hovered, setHovered] = useState(false)

  const [edgePath, labelX, labelY] = getBezierPath({
    sourceX, sourceY, sourcePosition, targetX, targetY, targetPosition,
  })

  const onDelete = (e: MouseEvent) => {
    e.stopPropagation()
    dispatch({ type: 'remove_edge', edgeId: id })
  }

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
              className="inline-flex items-center justify-center rounded-full bg-background border border-border text-muted-foreground hover:text-destructive hover:border-destructive/60 w-5 h-5 shadow transition-colors"
              title="删除连线"
            >
              <X className="h-3 w-3" />
            </button>
          </div>
        )}
      </EdgeLabelRenderer>
    </>
  )
}
