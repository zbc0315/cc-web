// frontend/src/components/tracks/flow/nodes/NodeHeader.tsx
// v-m：icon 类型从 string emoji 改为 ReactNode（接 lucide icon JSX）；× 关闭按钮换
// lucide X；color tokens 用 muted-foreground / destructive。
import type { MouseEvent, PointerEvent, ReactNode } from 'react'
import { X } from 'lucide-react'
import { useGraphDispatch } from '../GraphContext'

interface Props {
  nodeId: string
  icon: ReactNode
  label: string
}

export function NodeHeader({ nodeId, icon, label }: Props) {
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
      <span className="text-base shrink-0 [&_svg]:h-4 [&_svg]:w-4">{icon}</span>
      <span className="font-medium flex-1 text-foreground truncate">{label}</span>
      <button
        type="button"
        className="nodrag inline-flex items-center justify-center h-5 w-5 rounded text-muted-foreground hover:text-destructive hover:bg-accent transition-colors"
        onClick={onDelete}
        onPointerDown={stopDrag}
        title="删除节点"
      >
        <X className="h-3 w-3" />
      </button>
    </div>
  )
}
