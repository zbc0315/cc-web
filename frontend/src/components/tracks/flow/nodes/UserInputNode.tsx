// frontend/src/components/tracks/flow/nodes/UserInputNode.tsx
// v-m：bg/border 加 dark: 双写；icon emoji 换 lucide MessageSquare；text 用语义 token。
import { Handle, Position } from 'reactflow'
import type { NodeProps } from 'reactflow'
import { MessageSquare } from 'lucide-react'
import type { UserInputNode as UserInputNodeData } from '../flow-types-v3'
import { NodeHeader } from './NodeHeader'
import { useNodeRuntimeState } from '../GraphContext'
import type { NodeRuntimeState } from '../useFlowRun'

function runtimeBorderClass(state: NodeRuntimeState | null): string {
  if (state === 'active') return 'border-amber-500 ring-2 ring-amber-200 dark:ring-amber-900 animate-pulse'
  if (state === 'completed') return 'border-emerald-600 ring-1 ring-emerald-200 dark:ring-emerald-900'
  if (state === 'failed') return 'border-destructive ring-2 ring-red-200 dark:ring-red-900'
  if (state === 'skipped') return 'opacity-50 line-through'
  return ''
}

export function UserInputNodeView({ id, data, selected }: NodeProps<UserInputNodeData>) {
  const rtState = useNodeRuntimeState(id)
  return (
    <div
      className={[
        'rounded-lg border-2 px-3 py-2 min-w-[240px]',
        'bg-pink-50 dark:bg-pink-950/40',
        selected
          ? 'border-primary shadow'
          : 'border-pink-300 dark:border-pink-800',
        runtimeBorderClass(rtState),
      ].join(' ')}
    >
      <Handle type="target" position={Position.Top} />
      <NodeHeader
        nodeId={id}
        icon={<MessageSquare className="text-pink-600 dark:text-pink-400" />}
        label={data.label?.trim() || '用户输入'}
      />
      <div className="font-mono text-sm text-foreground/80">
        {data.fields.length === 0 ? (
          <div className="text-muted-foreground">(无字段)</div>
        ) : (
          data.fields.map((f, i) => (
            <div key={i} className="pl-1">
              {f.varKey}{' '}
              <span className="text-xs text-muted-foreground">({f.uiHint ?? 'text'})</span>
            </div>
          ))
        )}
      </div>
      <Handle type="source" position={Position.Bottom} />
    </div>
  )
}
