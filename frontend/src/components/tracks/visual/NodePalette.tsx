import { useDraggable } from '@dnd-kit/core'
import type { Node } from './graph-types'

const PALETTE: { type: Node['type']; icon: string; label: string }[] = [
  { type: 'ask_user', icon: '💬', label: '问用户' },
  { type: 'fai',      icon: '🤖', label: 'AI 调用' },
  { type: 'let',      icon: '📦', label: '命名变量' },
  { type: 'return',   icon: '⬅️', label: '返回' },
]

function PaletteItem({ type, icon, label }: { type: Node['type']; icon: string; label: string }) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: `palette:${type}`,
    data: { kind: 'create', nodeType: type },
  })
  return (
    <div
      ref={setNodeRef}
      {...attributes}
      {...listeners}
      className={[
        'flex items-center gap-2 p-2 rounded border border-gray-300 bg-white cursor-grab',
        'hover:border-blue-400 hover:shadow-sm transition-all select-none',
        isDragging ? 'opacity-50' : '',
      ].join(' ')}
    >
      <span className="text-xl">{icon}</span>
      <span className="text-sm">{label}</span>
    </div>
  )
}

export function NodePalette() {
  return (
    <aside className="fixed left-4 top-1/4 w-40 flex flex-col gap-2 z-20">
      <div className="text-xs uppercase text-gray-500 mb-1 px-1">节点</div>
      {PALETTE.map((p) => <PaletteItem key={p.type} {...p} />)}
    </aside>
  )
}
