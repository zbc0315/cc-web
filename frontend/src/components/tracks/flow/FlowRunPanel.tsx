// frontend/src/components/tracks/flow/FlowRunPanel.tsx
import type { FlowRunState } from './useFlowRun'
import type { FlowV3 } from './flow-types-v3'

interface Props {
  flow: FlowV3
  run: FlowRunState
}

export function FlowRunPanel({ flow, run }: Props) {
  if (run.status === 'idle') return null

  return (
    <div className="border-t bg-gray-50 px-3 py-2 text-xs space-y-1 max-h-64 overflow-y-auto">
      <div className="flex items-center gap-2">
        <span className="font-medium">运行状态:</span>
        <span className={statusColor(run.status)}>{statusLabel(run.status)}</span>
        {run.runId && <span className="text-gray-400 font-mono">{run.runId}</span>}
        {run.currentNodeId && <span>当前: {run.currentNodeId}</span>}
      </div>
      {run.quota && (
        <div className="flex gap-4 text-gray-600">
          {run.quota.iterRemaining !== undefined && <span>节点剩余迭代: {run.quota.iterRemaining}</span>}
          <span>LLM 调用剩余: {run.quota.llmCallsRemaining}</span>
          <span>运行剩余: {Math.floor(run.quota.durationRemainingMs / 1000)}s</span>
        </div>
      )}
      {run.error && (
        <div className="text-red-600">错误: {run.error}</div>
      )}
      <div className="mt-2">
        <div className="text-gray-500 mb-1">变量值实时:</div>
        <div className="font-mono space-y-0.5">
          {flow.variables.map((v) => (
            <div key={v.key} className="flex gap-2">
              <span className="text-blue-700">{v.key}</span>
              <span className="text-gray-400">({v.description})</span>
              <span>= {formatVal(run.vars[v.key] ?? null)}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

function statusLabel(s: FlowRunState['status']): string {
  switch (s) {
    case 'running': return '运行中'
    case 'waiting_user_input': return '等待用户输入'
    case 'completed': return '完成'
    case 'failed': return '失败'
    case 'cancelled': return '已取消'
    default: return s
  }
}

function statusColor(s: FlowRunState['status']): string {
  switch (s) {
    case 'running': return 'text-blue-600'
    case 'waiting_user_input': return 'text-amber-600'
    case 'completed': return 'text-green-600'
    case 'failed': return 'text-red-600'
    case 'cancelled': return 'text-gray-500'
    default: return 'text-gray-600'
  }
}

function formatVal(v: unknown): string {
  if (v === null || v === undefined) return 'null'
  if (typeof v === 'string') return JSON.stringify(v)
  if (typeof v === 'number' || typeof v === 'boolean') return String(v)
  return JSON.stringify(v)
}
