// frontend/src/components/tracks/flow/nodes/UserInputNode.tsx
import { Handle, Position } from 'reactflow'
import type { NodeProps } from 'reactflow'
import type { UserInputNode as UserInputNodeData } from '../flow-types-v3'
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

export function UserInputNodeView({ id, data, selected }: NodeProps<UserInputNodeData>) {
  const rtState = useNodeRuntimeState(id)
  return (
    <div
      className={[
        'rounded-lg border-2 px-3 py-2 bg-pink-50 min-w-[240px]',
        selected ? 'border-blue-500 shadow' : 'border-pink-300',
        runtimeBorderClass(rtState),
      ].join(' ')}
    >
      <Handle type="target" position={Position.Top} />
      <NodeHeader nodeId={id} icon="💬" label="用户输入" />
      <div className="font-mono text-sm text-gray-700">
        {data.fields.length === 0 ? (
          <div className="text-gray-400">(无字段)</div>
        ) : (
          data.fields.map((f, i) => (
            <div key={i} className="pl-1">{f.varKey} <span className="text-xs text-gray-400">({f.uiHint ?? 'text'})</span></div>
          ))
        )}
      </div>
      <Handle type="source" position={Position.Bottom} />
    </div>
  )
}
