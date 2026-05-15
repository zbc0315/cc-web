import { useState } from 'react'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { toast } from 'sonner'
import { useConfirm } from '@/components/ConfirmProvider'
import { submitTrackInput, abortTrack } from './api'
import type { AskUserRequest } from './types'

interface Props {
  projectId: string
  open: boolean
  request: AskUserRequest
  onSubmitted: () => void
}

/**
 * Modal for the __ccweb_ask_user(...) builtin's pending form.
 *
 * Field types match `AskUserFieldSpec`:
 *   - text   → <Input type=text>
 *   - number → <Input type=number>
 *   - bool   → checkbox (renders true/false)
 *   - enum   → <Select> over variants
 *
 * Modal — only submit closes. ESC + outside-click prevented to avoid
 * accidental cancellation of an in-progress track. Use the abort
 * button in TrackStatusBar to cancel the run instead.
 */
export function TrackUserInputDialog({
  projectId,
  open,
  request,
  onSubmitted,
}: Props) {
  const confirm = useConfirm()
  const [values, setValues] = useState<Record<string, unknown>>(() => {
    const initial: Record<string, unknown> = {}
    for (const f of request.fields) {
      switch (f.type) {
        case 'bool':
          initial[f.key] = false
          break
        case 'number':
          initial[f.key] = 0
          break
        case 'enum':
          initial[f.key] = f.variants?.[0] ?? ''
          break
        default:
          initial[f.key] = ''
      }
    }
    return initial
  })
  const [submitting, setSubmitting] = useState(false)

  const setField = (key: string, v: unknown) => {
    setValues((prev) => ({ ...prev, [key]: v }))
  }

  const handleSubmit = async () => {
    setSubmitting(true)
    try {
      await submitTrackInput(projectId, request.requestId, values)
      onSubmitted()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '提交失败')
    } finally {
      setSubmitting(false)
    }
  }

  const handleAbortRun = async () => {
    const ok = await confirm({
      description: '中止整个工作轨运行？正在等待的 LLM 调用会被取消。',
      confirmLabel: '中止',
      destructive: true,
    })
    if (!ok) return
    try {
      await abortTrack(projectId)
      toast.success('已请求中止')
      // The dialog will close once the next useTrackState poll sees
      // pendingAskUser=null (server rejects the pending bridge request).
      onSubmitted()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '中止失败')
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={() => {
        /* modal — only submit closes */
      }}
    >
      <DialogContent
        className="max-w-lg"
        onPointerDownOutside={(e) => e.preventDefault()}
        onEscapeKeyDown={(e) => e.preventDefault()}
      >
        <DialogHeader>
          <DialogTitle>工作轨需要输入</DialogTitle>
        </DialogHeader>

        <div className="space-y-3">
          {request.fields.map((f) => (
            <div key={f.key} className="space-y-1.5">
              <Label className="text-xs text-muted-foreground">
                {f.label} <span className="opacity-60 font-mono">({f.key})</span>
              </Label>

              {f.type === 'text' && (
                <Input
                  value={(values[f.key] as string) ?? ''}
                  placeholder={f.placeholder}
                  onChange={(e) => setField(f.key, e.target.value)}
                />
              )}

              {f.type === 'number' && (
                <Input
                  type="number"
                  value={String(values[f.key] ?? '')}
                  placeholder={f.placeholder}
                  onChange={(e) => {
                    const n = Number(e.target.value)
                    setField(f.key, Number.isNaN(n) ? '' : n)
                  }}
                />
              )}

              {f.type === 'bool' && (
                <div className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={!!values[f.key]}
                    onChange={(e) => setField(f.key, e.target.checked)}
                    className="h-4 w-4"
                  />
                  <span className="text-sm">
                    {values[f.key] ? '是' : '否'}
                  </span>
                </div>
              )}

              {f.type === 'enum' && (
                <Select
                  value={(values[f.key] as string) ?? ''}
                  onValueChange={(v) => setField(f.key, v)}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="选择..." />
                  </SelectTrigger>
                  <SelectContent>
                    {(f.variants ?? []).map((v) => (
                      <SelectItem key={v} value={v}>
                        {v}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            </div>
          ))}
        </div>

        <div className="flex justify-between items-center gap-2 pt-2">
          <Button
            onClick={handleAbortRun}
            variant="ghost"
            size="sm"
            disabled={submitting}
            className="text-muted-foreground hover:text-destructive"
          >
            中止运行
          </Button>
          <Button onClick={handleSubmit} disabled={submitting} size="sm">
            {submitting ? '提交中…' : '提交'}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
