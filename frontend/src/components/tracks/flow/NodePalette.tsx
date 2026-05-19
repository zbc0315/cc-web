// frontend/src/components/tracks/flow/NodePalette.tsx
// v-m：emoji icon → lucide MessageSquare / Bot / GitBranch；色彩用语义 token + dark:。
import type { ComponentType, SVGProps } from 'react'
import { MessageSquare, Bot, GitBranch } from 'lucide-react'
import { useGraphDispatch } from './GraphContext'
import { newNodeId, type NodeV3 } from './flow-types-v3'

type LucideIcon = ComponentType<SVGProps<SVGSVGElement>>

type PaletteEntry = {
  type: NodeV3['type']
  Icon: LucideIcon
  label: string
  iconClass: string
}

const ENTRIES: PaletteEntry[] = [
  { type: 'user_input', Icon: MessageSquare, label: '用户输入', iconClass: 'text-pink-600 dark:text-pink-400' },
  { type: 'llm',        Icon: Bot,           label: 'LLM 调用', iconClass: 'text-orange-600 dark:text-orange-400' },
  { type: 'if',         Icon: GitBranch,     label: '逻辑判断', iconClass: 'text-sky-600 dark:text-sky-400' },
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
    <aside className="w-32 border-r border-border bg-background p-2 flex flex-col gap-2">
      <div className="text-xs text-muted-foreground px-1">拖入画布</div>
      {ENTRIES.map(({ type, Icon, label, iconClass }) => (
        <div
          key={type}
          draggable
          role="button"
          tabIndex={0}
          onDragStart={(ev) => {
            ev.dataTransfer.setData('application/x-ccweb-flow-node', type)
            ev.dataTransfer.effectAllowed = 'move'
          }}
          onClick={() => {
            const node = makeDefaultNode(type, { x: 200, y: 200 })
            dispatch({ type: 'add_node', node })
          }}
          onKeyDown={(ev) => {
            if (ev.key === 'Enter' || ev.key === ' ') {
              ev.preventDefault()
              const node = makeDefaultNode(type, { x: 200, y: 200 })
              dispatch({ type: 'add_node', node })
            }
          }}
          className="cursor-grab rounded-md border border-border bg-muted/40 hover:bg-accent px-2 py-2 text-sm flex items-center gap-1.5 transition-colors"
        >
          <Icon className={`h-3.5 w-3.5 shrink-0 ${iconClass}`} />
          <span className="text-foreground truncate">{label}</span>
        </div>
      ))}
    </aside>
  )
}
