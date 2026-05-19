// frontend/src/components/tracks/flow/nodes/IfNode.tsx
// v-m：bg/border 加 dark: 双写；icon emoji 换 lucide GitBranch；handle 颜色用
// hsl(var(--chart-2/--destructive))（chart-2 已是绿系），text 用语义 token。
import { Handle, Position } from 'reactflow'
import type { NodeProps } from 'reactflow'
import { GitBranch } from 'lucide-react'
import type { IfNode as IfNodeData } from '../flow-types-v3'
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

export function IfNodeView({ id, data, selected }: NodeProps<IfNodeData>) {
  const rtState = useNodeRuntimeState(id)
  return (
    <div
      className={[
        'rounded-lg border-2 px-3 py-2 min-w-[240px]',
        'bg-sky-50 dark:bg-sky-950/40',
        selected
          ? 'border-primary shadow'
          : 'border-sky-300 dark:border-sky-800',
        runtimeBorderClass(rtState),
      ].join(' ')}
    >
      <Handle type="target" position={Position.Top} />
      <NodeHeader
        nodeId={id}
        icon={<GitBranch className="text-sky-600 dark:text-sky-400" />}
        label={data.label?.trim() || '逻辑判断'}
      />
      <div className="font-mono text-sm text-foreground/80">
        if ({data.conditionExpr || '<空条件>'})
      </div>
      {/* 双底部端口 true / false，左右排开；用 emerald-500 / red-500 作 brand color，
          dark 下 reactflow handle 自带轮廓不刺眼，保留 hex 即可。 */}
      <Handle
        type="source" position={Position.Bottom} id="true"
        style={{ left: '30%', background: '#10b981' }}
      />
      <Handle
        type="source" position={Position.Bottom} id="false"
        style={{ left: '70%', background: '#ef4444' }}
      />
      <div className="flex justify-between text-xs mt-1 px-2">
        <span className="text-emerald-600 dark:text-emerald-400">true</span>
        <span className="text-red-600 dark:text-red-400">false</span>
      </div>
    </div>
  )
}
