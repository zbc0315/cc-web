import { Button } from '@/components/ui/button'
import { X, CheckCircle2, AlertCircle, Loader2 } from 'lucide-react'
import { toast } from 'sonner'
import { abortTrack } from './api'
import type { TrackRunState } from './types'

interface Props {
  projectId: string
  state: TrackRunState | null
  running: boolean
  onRefresh: () => void
}

/** Compact status pill displayed in ProjectHeader when a track is active. */
export function TrackStatusBar({ projectId, state, running, onRefresh }: Props) {
  if (!state) return null

  const handleAbort = async () => {
    try {
      await abortTrack(projectId)
      toast.success('已请求中止')
      onRefresh()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '中止失败')
    }
  }

  let icon = <Loader2 className="h-3 w-3 animate-spin" />
  let color = 'text-blue-600 dark:text-blue-400'
  let label = '运行中'

  switch (state.status) {
    case 'running':
      icon = <Loader2 className="h-3 w-3 animate-spin" />
      color = 'text-blue-600 dark:text-blue-400'
      label = '运行中'
      break
    case 'paused':
      icon = <Loader2 className="h-3 w-3" />
      color = 'text-amber-600 dark:text-amber-400'
      label = '等待输入'
      break
    case 'completed':
      icon = <CheckCircle2 className="h-3 w-3" />
      color = 'text-emerald-600 dark:text-emerald-400'
      label = '已完成'
      break
    case 'failed':
      icon = <AlertCircle className="h-3 w-3" />
      color = 'text-red-600 dark:text-red-400'
      label = '失败'
      break
    case 'cancelled':
      icon = <AlertCircle className="h-3 w-3" />
      color = 'text-muted-foreground'
      label = '已取消'
      break
    default:
      icon = <Loader2 className="h-3 w-3" />
  }

  return (
    <div className="flex items-center gap-2 text-xs">
      <span className={`flex items-center gap-1 ${color}`}>
        {icon}
        <span className="font-medium">{label}</span>
      </span>
      <span className="text-muted-foreground font-mono truncate max-w-[200px]">
        {state.trackFilename}
      </span>
      {state.currentTaskIndex !== undefined && (
        <span className="text-muted-foreground">#{state.currentTaskIndex}</span>
      )}
      {running && (
        <Button
          size="sm"
          variant="ghost"
          onClick={handleAbort}
          title="中止"
          className="h-6 w-6 p-0"
        >
          <X className="h-3 w-3" />
        </Button>
      )}
      {state.status === 'failed' && state.error && (
        <span
          className="text-red-600 dark:text-red-400 truncate max-w-[300px] font-mono"
          title={`${state.error.errorType}${
            state.error.code ? ` [${state.error.code}]` : ''
          }: ${state.error.message}`}
        >
          {state.error.code ? `[${state.error.code}] ` : ''}
          {state.error.message}
        </span>
      )}
    </div>
  )
}
