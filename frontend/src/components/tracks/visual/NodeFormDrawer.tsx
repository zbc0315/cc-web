import type { Node } from './graph-types'
import { AskUserForm } from './forms/AskUserForm'
import { FaiForm } from './forms/FaiForm'
import { LetForm } from './forms/LetForm'
import { ReturnForm } from './forms/ReturnForm'

interface Props {
  node: Node | null
  candidates: string[]
  onChange: (patch: Partial<Node>) => void
  onClose: () => void
}

export function NodeFormDrawer({ node, candidates, onChange, onClose }: Props) {
  if (!node) return null
  return (
    <aside className="fixed right-0 top-0 bottom-0 w-96 bg-white border-l border-gray-300 shadow-xl overflow-y-auto z-30">
      <header className="flex items-center justify-between p-3 border-b border-gray-200 bg-gray-50">
        <span className="font-medium text-sm">编辑节点</span>
        <button type="button" onClick={onClose}
          className="text-gray-500 hover:text-gray-800 text-lg leading-none">×</button>
      </header>
      {node.type === 'ask_user' && <AskUserForm node={node} onChange={onChange as (p: Partial<typeof node>) => void} />}
      {node.type === 'fai' && <FaiForm node={node} candidates={candidates} onChange={onChange as (p: Partial<typeof node>) => void} />}
      {node.type === 'let' && <LetForm node={node} candidates={candidates} onChange={onChange as (p: Partial<typeof node>) => void} />}
      {node.type === 'return' && <ReturnForm node={node} candidates={candidates} onChange={onChange as (p: Partial<typeof node>) => void} />}
    </aside>
  )
}
