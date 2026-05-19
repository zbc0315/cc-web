import { useState } from 'react'
import { ChevronLeft, Play, Square, Save } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import type { FlowV3 } from './flow-types-v3'
import { validateFlow } from './flow-validator'
import { deriveTrainJsonFromVariables } from './flow-sidecar-io'
import { saveFlow as apiSaveFlow } from '../api'
import type { FlowRunState } from './useFlowRun'

interface Props {
  flow: FlowV3
  projectId: string
  filename: string
  dirty: boolean
  runStatus: FlowRunState['status']
  onSaved: () => void
  onClose: () => void
}

// v-l：▶/■ 按钮不再自己调 API。运行启动 / 取消都 dispatch CustomEvent，由
// ProjectPage 顶层 driver 统一处理（编辑器外的列表 ▶ 入口也走同样事件）。
// v-m：原生 button 全换 shadcn Button + lucide icon + 语义 token。
export function FlowToolbar({ flow, projectId, filename, dirty, runStatus, onSaved, onClose }: Props) {
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)

  const handleSave = async () => {
    setSaveError(null)
    const v = validateFlow(flow)
    if (!v.ok) {
      setSaveError(`无法保存：${v.errors.map((e) => e.message).join('; ')}`)
      return
    }
    setSaving(true)
    try {
      const trainJson = deriveTrainJsonFromVariables(flow.variables)
      await apiSaveFlow(projectId, filename, flow, trainJson)
      onSaved()
    } catch (e) {
      setSaveError(`保存失败：${(e as Error).message}`)
    } finally {
      setSaving(false)
    }
  }

  const handleRun = () => {
    if (dirty) { toast.error('请先保存'); return }
    window.dispatchEvent(new CustomEvent('ccweb:flow-run-request', { detail: { filename } }))
  }
  const handleCancel = () => {
    window.dispatchEvent(new CustomEvent('ccweb:flow-cancel-request'))
  }

  const canRun = runStatus === 'idle' || runStatus === 'completed' || runStatus === 'failed' || runStatus === 'cancelled'

  return (
    <header className="border-b border-border bg-background px-3 py-2 flex items-center gap-2">
      <Button
        type="button"
        variant="ghost"
        size="icon"
        className="h-7 w-7"
        onClick={onClose}
        title="关闭编辑器"
      >
        <ChevronLeft className="h-4 w-4" />
      </Button>
      <div className="font-mono text-sm text-foreground truncate">{filename}</div>
      {dirty && (
        <span
          className="h-1.5 w-1.5 rounded-full bg-amber-500 dark:bg-amber-400"
          title="未保存的修改"
        />
      )}
      <div className="flex-1" />
      <Button
        type="button"
        size="sm"
        onClick={handleSave}
        disabled={saving}
      >
        <Save className="h-3.5 w-3.5 mr-1" />
        {saving ? '保存中…' : '保存'}
      </Button>
      {canRun ? (
        <Button
          type="button"
          size="sm"
          onClick={handleRun}
          disabled={dirty}
          title={dirty ? '请先保存' : '运行工作轨'}
          className="bg-emerald-600 text-white hover:bg-emerald-700 dark:bg-emerald-600 dark:hover:bg-emerald-500"
        >
          <Play className="h-3.5 w-3.5 mr-1 fill-current" />
          运行
        </Button>
      ) : (
        <Button
          type="button"
          variant="destructive"
          size="sm"
          onClick={handleCancel}
        >
          <Square className="h-3.5 w-3.5 mr-1 fill-current" />
          取消
        </Button>
      )}
      {saveError && (
        <div className="text-xs text-destructive ml-2 max-w-md truncate" title={saveError}>{saveError}</div>
      )}
    </header>
  )
}
