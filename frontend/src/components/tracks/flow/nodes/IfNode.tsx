// frontend/src/components/tracks/flow/nodes/IfNode.tsx
import { Handle, Position } from 'reactflow'
import type { NodeProps } from 'reactflow'
import type { IfNode as IfNodeData } from '../flow-types-v3'
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

export function IfNodeView({ id, data, selected }: NodeProps<IfNodeData>) {
  const rtState = useNodeRuntimeState(id)
  return (
    <div
      className={[
        'rounded-lg border-2 px-3 py-2 bg-sky-50 min-w-[240px]',
        selected ? 'border-blue-500 shadow' : 'border-sky-300',
        runtimeBorderClass(rtState),
      ].join(' ')}
    >
      <Handle type="target" position={Position.Top} />
      <NodeHeader nodeId={id} icon="🔀" label="逻辑判断" />
      <div className="font-mono text-sm text-gray-700">
        if ({data.conditionExpr || '<空条件>'})
      </div>
      {/* 双底部端口 true / false，左右排开 */}
      <Handle
        type="source" position={Position.Bottom} id="true"
        style={{ left: '30%', background: '#10b981' }}
      />
      <Handle
        type="source" position={Position.Bottom} id="false"
        style={{ left: '70%', background: '#ef4444' }}
      />
      <div className="flex justify-between text-xs text-gray-400 mt-1 px-2">
        <span className="text-green-600">true</span>
        <span className="text-red-600">false</span>
      </div>
    </div>
  )
}
