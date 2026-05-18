// frontend/src/components/tracks/flow/NodePalette.tsx
import { useGraphDispatch } from './GraphContext'
import { newNodeId, type NodeV3 } from './flow-types-v3'

type PaletteEntry = {
  type: NodeV3['type']
  icon: string
  label: string
}

const ENTRIES: PaletteEntry[] = [
  { type: 'user_input', icon: '💬', label: '用户输入' },
  { type: 'llm',        icon: '🤖', label: 'LLM 调用' },
  { type: 'if',         icon: '🔀', label: '逻辑判断' },
]

export function makeDefaultNode(
  type: NodeV3['type'],
  position: { x: number; y: number },
): NodeV3 {
  const id = newNodeId()
  switch (type) {
    case 'user_input':
      return { id, type: 'user_input', position, fields: [] }
    case 'llm':
      return {
        id, type: 'llm', position,
        promptTemplate: '',
        inputs: [],
        outputs: [],
      }
    case 'if':
      return { id, type: 'if', position, conditionExpr: '' }
    default:
      throw new Error(`unknown node type: ${type}`)
  }
}

export function NodePalette() {
  const dispatch = useGraphDispatch()
  return (
    <aside className="w-32 border-r bg-white p-2 flex flex-col gap-2">
      <div className="text-xs text-gray-500 px-1">拖入画布</div>
      {ENTRIES.map((e) => (
        <div
          key={e.type}
          draggable
          onDragStart={(ev) => {
            ev.dataTransfer.setData('application/x-ccweb-flow-node', e.type)
            ev.dataTransfer.effectAllowed = 'move'
          }}
          onClick={() => {
            const node = makeDefaultNode(e.type, { x: 200, y: 200 })
            dispatch({ type: 'add_node', node })
          }}
          className="cursor-grab rounded border bg-gray-50 hover:bg-blue-50 px-2 py-2 text-sm flex items-center gap-1"
        >
          <span>{e.icon}</span>
          <span>{e.label}</span>
        </div>
      ))}
    </aside>
  )
}
