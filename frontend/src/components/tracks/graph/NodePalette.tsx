// frontend/src/components/tracks/graph/NodePalette.tsx
import { useGraphDispatch } from './GraphContext'
import { newNodeId, type NodeV2 } from './graph-types-v2'

type PaletteEntry = {
  type: NodeV2['type']
  icon: string
  label: string
}

const ENTRIES: PaletteEntry[] = [
  { type: 'code',     icon: '📝', label: '代码' },
  { type: 'ask_user', icon: '💬', label: '问用户' },
  { type: 'fai',      icon: '🤖', label: 'AI 调用' },
  { type: 'return',   icon: '⬅️', label: '返回' },
]

export function makeDefaultNode(type: NodeV2['type'], position: { x: number; y: number }): NodeV2 {
  const id = newNodeId()
  switch (type) {
    case 'code':
      return { id, type: 'code', position, code: 'let x = 1' }
    case 'ask_user':
      return { id, type: 'ask_user', position, outputVar: 'input', fields: [] }
    case 'fai':
      return {
        id, type: 'fai', position,
        faiName: 'analyze', outputVar: 'r',
        inputs: [], outputs: [], promptTemplate: '',
      }
    case 'return':
      return { id, type: 'return', position, valueExpr: '"done"' }
    default: {
      const _exhaustive: never = type
      throw new Error(`unknown node type: ${_exhaustive}`)
    }
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
            ev.dataTransfer.setData('application/x-ccweb-graph-node', e.type)
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
