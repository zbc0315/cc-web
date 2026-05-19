// frontend/src/components/tracks/flow/nodes/LLMNode.tsx
// v-m：bg/border 加 dark: 双写；icon emoji 换 lucide Bot；text 用语义 token。
import { Handle, Position } from 'reactflow'
import type { NodeProps } from 'reactflow'
import { Bot } from 'lucide-react'
import type { LLMNode as LLMNodeData } from '../flow-types-v3'
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

export function LLMNodeView({ id, data, selected }: NodeProps<LLMNodeData>) {
  const rtState = useNodeRuntimeState(id)
  return (
    <div
      className={[
        'rounded-lg border-2 px-3 py-2 min-w-[280px] max-w-[360px]',
        'bg-orange-50 dark:bg-orange-950/40',
        selected
          ? 'border-primary shadow'
          : 'border-orange-300 dark:border-orange-800',
        runtimeBorderClass(rtState),
      ].join(' ')}
    >
      <Handle type="target" position={Position.Top} />
      <NodeHeader
        nodeId={id}
        icon={<Bot className="text-orange-600 dark:text-orange-400" />}
        label={data.label?.trim() || 'LLM 调用'}
      />
      <div className="font-mono text-xs text-foreground/80">
        <div className="truncate">
          prompt: {data.promptTemplate.slice(0, 60)}{data.promptTemplate.length > 60 ? '…' : ''}
        </div>
        <div className="text-xs text-muted-foreground mt-1">
          {data.inputs.length} 输入 → {data.outputs.length} 输出
        </div>
      </div>
      <Handle type="source" position={Position.Bottom} />
    </div>
  )
}
