// frontend/src/components/tracks/graph/nodes/FaiNode.tsx
import { Handle, Position } from 'reactflow'
import type { NodeProps } from 'reactflow'
import type { FaiNode as FaiNodeData } from '../graph-types-v2'

export function FaiNodeView({ data, selected }: NodeProps<FaiNodeData>) {
  return (
    <div
      className={[
        'rounded-lg border-2 px-3 py-2 bg-orange-50 min-w-[260px]',
        selected ? 'border-blue-500 shadow' : 'border-orange-300',
      ].join(' ')}
    >
      <Handle type="target" position={Position.Top} />
      <div className="flex items-center gap-2 mb-1">
        <span className="text-lg">🤖</span>
        <span className="font-medium">AI 调用</span>
      </div>
      <div className="font-mono text-sm text-gray-700">
        <div>{data.outputVar} ← {data.faiName}(...)</div>
        <div className="text-xs text-gray-500 truncate mt-1">
          prompt: {data.promptTemplate.slice(0, 40)}{data.promptTemplate.length > 40 ? '…' : ''}
        </div>
        <div className="text-xs text-gray-500">
          {data.inputs.length} inputs → {data.outputs.length} outputs
        </div>
      </div>
      <Handle type="source" position={Position.Bottom} />
    </div>
  )
}
