// frontend/src/components/tracks/flow/nodes/LLMNode.tsx
import { Handle, Position } from 'reactflow'
import type { NodeProps } from 'reactflow'
import type { LLMNode as LLMNodeData } from '../flow-types-v3'
import { NodeHeader } from './NodeHeader'

export function LLMNodeView({ id, data, selected }: NodeProps<LLMNodeData>) {
  return (
    <div
      className={[
        'rounded-lg border-2 px-3 py-2 bg-orange-50 min-w-[280px] max-w-[360px]',
        selected ? 'border-blue-500 shadow' : 'border-orange-300',
      ].join(' ')}
    >
      <Handle type="target" position={Position.Top} />
      <NodeHeader nodeId={id} icon="🤖" label="LLM 调用" />
      <div className="font-mono text-xs text-gray-700">
        <div className="truncate">
          prompt: {data.promptTemplate.slice(0, 60)}{data.promptTemplate.length > 60 ? '…' : ''}
        </div>
        <div className="text-xs text-gray-500 mt-1">
          {data.inputs.length} 输入 → {data.outputs.length} 输出
        </div>
      </div>
      <Handle type="source" position={Position.Bottom} />
    </div>
  )
}
