// frontend/src/components/tracks/graph/nodes/ReturnNode.tsx
import { Handle, Position } from 'reactflow'
import type { NodeProps } from 'reactflow'
import type { ReturnNode as ReturnNodeData } from '../graph-types-v2'
import { NodeHeader } from './NodeHeader'

export function ReturnNodeView({ id, data, selected }: NodeProps<ReturnNodeData>) {
  return (
    <div
      className={[
        'rounded-lg border-2 px-3 py-2 bg-purple-50 min-w-[180px]',
        selected ? 'border-blue-500 shadow' : 'border-purple-300',
      ].join(' ')}
    >
      <Handle type="target" position={Position.Top} />
      <NodeHeader nodeId={id} icon="↩" label="返回" />
      <div className="font-mono text-sm text-gray-700 truncate">
        return {data.valueExpr || '<empty>'}
      </div>
    </div>
  )
}
