// frontend/src/components/tracks/flow/nodes/LLMNode.tsx
import { Handle, Position } from 'reactflow'
import type { NodeProps } from 'reactflow'
import type { LLMNode as LLMNodeData } from '../flow-types-v3'
import { NodeHeader } from './NodeHeader'
import { useNodeRuntimeState } from '../GraphContext'
import type { NodeRuntimeState } from '../useFlowRun'

function runtimeBorderClass(state: NodeRuntimeState | null): string {
  if (state === 'active') return 'border-amber-500 ring-2 ring-amber-200 animate-pulse'
  if (state === 'completed') return 'border-green-600 ring-1 ring-green-200'
  if (state === 'failed') return 'border-red-600 ring-2 ring-red-200'
  if (state === 'skipped') return 'opacity-50 line-through'
  return ''
}

export function LLMNodeView({ id, data, selected }: NodeProps<LLMNodeData>) {
  const rtState = useNodeRuntimeState(id)
  return (
    <div
      className={[
        'rounded-lg border-2 px-3 py-2 bg-orange-50 min-w-[280px] max-w-[360px]',
        selected ? 'border-blue-500 shadow' : 'border-orange-300',
        runtimeBorderClass(rtState),
      ].join(' ')}
    >
      <Handle type="target" position={Position.Top} />
      <NodeHeader nodeId={id} icon="🤖" label={data.label?.trim() || 'LLM 调用'} />
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
