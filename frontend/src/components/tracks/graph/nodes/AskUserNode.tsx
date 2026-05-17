// frontend/src/components/tracks/graph/nodes/AskUserNode.tsx
import { Handle, Position } from 'reactflow'
import type { NodeProps } from 'reactflow'
import type { AskUserNode as AskUserNodeData } from '../graph-types-v2'

export function AskUserNodeView({ data, selected }: NodeProps<AskUserNodeData>) {
  return (
    <div
      className={[
        'rounded-lg border-2 px-3 py-2 bg-pink-50 min-w-[240px]',
        selected ? 'border-blue-500 shadow' : 'border-pink-300',
      ].join(' ')}
    >
      <Handle type="target" position={Position.Top} />
      <div className="flex items-center gap-2 mb-1">
        <span className="text-lg">💬</span>
        <span className="font-medium">问用户</span>
      </div>
      <div className="font-mono text-sm text-gray-700">
        <div>{data.outputVar || '<未命名>'} ← {'{'}</div>
        {data.fields.length === 0 ? (
          <div className="text-gray-400 pl-2">(无字段)</div>
        ) : (
          data.fields.map((f) => (
            <div key={f.id} className="pl-2">{f.key}: {f.type}</div>
          ))
        )}
        <div>{'}'}</div>
      </div>
      <Handle type="source" position={Position.Bottom} />
    </div>
  )
}
