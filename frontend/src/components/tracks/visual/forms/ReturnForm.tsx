import type { ReturnNode } from '../graph-types'
import { VarRefInput } from '../VarRefInput'

interface Props {
  node: ReturnNode
  candidates: string[]
  onChange: (patch: Partial<ReturnNode>) => void
}

export function ReturnForm({ node, candidates, onChange }: Props) {
  const v = node.value
  if (v.kind === 'triple') {
    return (
      <div className="p-4 text-sm text-red-600">
        M1 不支持 TripleSlot 值。等 M2 三格拼装器。
      </div>
    )
  }
  return (
    <div className="p-4 flex flex-col gap-3 text-sm">
      <label className="flex items-center gap-2">
        <span className="text-gray-600 w-16">返回值:</span>
        <VarRefInput value={v} candidates={candidates}
          placeholder='@变量 或字面量（如 { foo: 1 } / "hello" / null）'
          onChange={(nv) => onChange({ value: nv })} />
      </label>
    </div>
  )
}
