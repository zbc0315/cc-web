// frontend/src/components/tracks/graph/nodes/NodeHeader.tsx
import type { MouseEvent, PointerEvent } from 'react'
import { useGraphDispatch } from '../GraphContext'

interface Props {
  nodeId: string
  icon: string
  label: string
  /** Optional accent color for the × button on hover (matches node theme). */
  hoverColor?: string
}

/**
 * Shared node card header: icon + label + delete (×) button.
 *
 * The × button uses `nodrag` className so ReactFlow doesn't start a drag
 * when the user clicks it. It also stops pointer/click propagation so the
 * underlying node doesn't get selected before the click fires.
 */
export function NodeHeader({ nodeId, icon, label, hoverColor = 'hover:text-red-600' }: Props) {
  const dispatch = useGraphDispatch()

  const onDelete = (e: MouseEvent) => {
    e.stopPropagation()
    dispatch({ type: 'remove_node', nodeId })
  }

  const stopDrag = (e: PointerEvent) => {
    e.stopPropagation()
  }

  return (
    <div className="flex items-center gap-2 mb-1">
      <span className="text-lg">{icon}</span>
      <span className="font-medium flex-1">{label}</span>
      <button
        type="button"
        className={`nodrag text-gray-400 ${hoverColor} px-1 text-base leading-none`}
        onClick={onDelete}
        onPointerDown={stopDrag}
        title="删除节点"
      >
        ×
      </button>
    </div>
  )
}
