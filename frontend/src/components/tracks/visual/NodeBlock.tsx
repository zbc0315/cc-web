import { useDraggable, useDroppable } from '@dnd-kit/core'
import type { Literal, Node, TripleSlot, VarRef } from './graph-types'

interface Props {
  node: Node
  index: number
  selected: boolean
  onSelect: () => void
  onDuplicate: () => void
  onRemove: () => void
}

const TYPE_META: Record<Node['type'], { icon: string; label: string; color: string }> = {
  ask_user: { icon: '💬', label: '问用户', color: 'bg-pink-50 border-pink-300' },
  fai:      { icon: '🤖', label: 'AI 调用', color: 'bg-orange-50 border-orange-300' },
  let:      { icon: '📦', label: '命名变量', color: 'bg-gray-50 border-gray-300' },
  return:   { icon: '⬅️', label: '返回', color: 'bg-purple-50 border-purple-300' },
}

function valuePreview(v: VarRef | Literal | TripleSlot): string {
  if (v.kind === 'var') return '@' + v.path.join('.')
  if (v.kind === 'lit') return v.raw
  return '(triple)'
}

export function NodeBlock({ node, index, selected, onSelect, onDuplicate, onRemove }: Props) {
  const meta = TYPE_META[node.type]
  const { attributes, listeners, setNodeRef: setDragRef, isDragging } = useDraggable({
    id: `node:${node.id}`,
    data: { kind: 'reorder', sourceIndex: index, nodeId: node.id },
  })
  const { setNodeRef: setDropRef, isOver } = useDroppable({
    id: `drop-before:${node.id}`,
    data: { kind: 'drop-before', index },
  })

  let summary = ''
  if (node.type === 'ask_user') summary = `${node.outputVar} ← { ${node.fields.map((f) => f.key).join(', ')} }`
  else if (node.type === 'fai') summary = `${node.outputVar} ← ${node.faiName}(${node.inputs.length} args)`
  else if (node.type === 'let') summary = `${node.varName} = ${valuePreview(node.value)}`
  else if (node.type === 'return') summary = `return ${valuePreview(node.value)}`

  return (
    <div ref={setDropRef} className="relative">
      {isOver && <div className="absolute left-0 right-0 -top-1 h-0.5 bg-blue-500 z-10" />}
      <div
        ref={setDragRef}
        {...attributes}
        {...listeners}
        onClick={(e) => { e.stopPropagation(); onSelect() }}
        className={[
          'border rounded-lg p-3 cursor-pointer transition-all',
          meta.color,
          selected ? 'ring-2 ring-blue-500 shadow' : 'hover:shadow-sm',
          isDragging ? 'opacity-50' : '',
        ].join(' ')}
      >
        <div className="flex items-center gap-2 mb-1">
          <span className="text-xl">{meta.icon}</span>
          <span className="font-medium">{meta.label}</span>
          <div className="ml-auto flex gap-1">
            <button type="button" onClick={(e) => { e.stopPropagation(); onDuplicate() }}
              className="text-xs text-gray-500 hover:text-gray-800 px-1">复制</button>
            <button type="button" onClick={(e) => { e.stopPropagation(); onRemove() }}
              className="text-xs text-red-500 hover:text-red-700 px-1">删除</button>
          </div>
        </div>
        <div className="text-sm font-mono text-gray-700">{summary}</div>
      </div>
    </div>
  )
}
