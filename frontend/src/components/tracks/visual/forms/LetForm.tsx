import type { LetNode } from '../graph-types'
import { VarRefInput } from '../VarRefInput'

interface Props {
  node: LetNode
  candidates: string[]
  onChange: (patch: Partial<LetNode>) => void
}

export function LetForm({ node, candidates, onChange }: Props) {
  const v = node.value
  if (v.kind === 'triple') {
    return (
      <div className="p-4 text-sm text-red-600">
        M1 不支持 TripleSlot 值。请等 M2 三格拼装器实装。
      </div>
    )
  }
  return (
    <div className="p-4 flex flex-col gap-3 text-sm">
      <label className="flex items-center gap-2">
        <span className="text-gray-600 w-16">变量名:</span>
        <input value={node.varName} onChange={(e) => onChange({ varName: e.target.value })}
          className="px-2 py-0.5 rounded border border-gray-300 font-mono flex-1" />
      </label>
      <label className="flex items-center gap-2">
        <span className="text-gray-600 w-16">值:</span>
        <VarRefInput value={v} candidates={candidates}
          placeholder='@变量 或字面量（如 "hello" / 42 / true）'
          onChange={(nv) => onChange({ value: nv })} />
      </label>
      <div className="text-xs text-gray-500">
        提示：M1 暂不支持 a + b 这种表达式。需要时先用 fai 节点中转，或等 M2 三格拼装器。
      </div>
    </div>
  )
}
