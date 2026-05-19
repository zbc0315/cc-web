// frontend/src/components/tracks/flow/FlowUserInputDialog.tsx
//
// v-m：换 shadcn Dialog + Input/Textarea/Select/Label/Button 封装（替代直调
// @radix-ui/react-dialog + 原生 input/select/textarea），与 ccweb 其它对话框
// 写法统一；保留 z-[70] 让它浮于编辑器 Dialog（z-50）之上。
import { useEffect, useState } from 'react'
import {
  Dialog,
  DialogPortal,
  DialogOverlay,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog'
import * as DialogPrimitive from '@radix-ui/react-dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { cn } from '@/lib/utils'
import type { FlowV3 } from './flow-types-v3'

interface Props {
  open: boolean
  flow: FlowV3
  pending: { nodeId: string; fields: { varKey: string; uiHint?: string; variants?: string[] }[] }
  onSubmit: (values: Record<string, unknown>) => void
  onCancel: () => void
}

export function FlowUserInputDialog({ open, flow, pending, onSubmit, onCancel }: Props) {
  const [values, setValues] = useState<Record<string, unknown>>({})

  // codex P1：每次 dialog 打开或 pending.nodeId 变化时清空 values，避免上次输入残留。
  useEffect(() => {
    if (open) setValues({})
  }, [open, pending.nodeId])

  const submit = () => {
    onSubmit(values)
  }

  const setField = (k: string, v: unknown) =>
    setValues((prev) => ({ ...prev, [k]: v }))

  // codex P1：FlowUserInputDialog 可能浮在 TrackEditorDialog（z-50）之上，所以
  // overlay + content 都拔到 z-[70]；自管 Portal+Overlay 避开 DialogContent 内置
  // 的 z-50 overlay（否则会出现双层 overlay 把背景压得更暗）。
  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) onCancel() }}>
      <DialogPortal>
        <DialogOverlay className="z-[70]" />
        <DialogPrimitive.Content
          className={cn(
            'fixed left-[50%] top-[50%] z-[70] grid w-full max-w-lg translate-x-[-50%] translate-y-[-50%] gap-4 border bg-background p-6 shadow-lg duration-200',
            'data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95',
            'sm:rounded-xl',
          )}
        >
        <DialogHeader>
          <DialogTitle>需要您输入</DialogTitle>
        </DialogHeader>

        <div className="space-y-3">
          {pending.fields.map((f) => {
            const decl = flow.variables.find((v) => v.key === f.varKey)
            const labelText = decl ? `${f.varKey}（${decl.description}）` : f.varKey
            const cur = (values[f.varKey] as string) ?? ''
            return (
              <div key={f.varKey} className="space-y-1.5">
                <Label className="text-xs text-muted-foreground">{labelText}</Label>
                {f.uiHint === 'textarea' ? (
                  <Textarea
                    value={cur}
                    onChange={(e) => setField(f.varKey, e.target.value)}
                    rows={4}
                    className="font-mono"
                  />
                ) : f.uiHint === 'enum' && f.variants ? (
                  <Select
                    value={cur}
                    onValueChange={(v) => setField(f.varKey, v)}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="（请选择）" />
                    </SelectTrigger>
                    <SelectContent>
                      {f.variants.map((v) => (
                        <SelectItem key={v} value={v}>{v}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                ) : f.uiHint === 'number' ? (
                  <Input
                    type="number"
                    value={cur}
                    onChange={(e) => {
                      // codex P2：空字符串保留 ''，不强转 0；非空且能 parse 才存 number。
                      const raw = e.target.value
                      if (raw === '') {
                        setField(f.varKey, '')
                      } else {
                        const n = Number(raw)
                        setField(f.varKey, Number.isNaN(n) ? raw : n)
                      }
                    }}
                    className="font-mono"
                  />
                ) : f.uiHint === 'bool' ? (
                  <div className="flex items-center gap-2">
                    <input
                      id={`flow-input-${f.varKey}`}
                      type="checkbox"
                      checked={!!values[f.varKey]}
                      onChange={(e) => setField(f.varKey, e.target.checked)}
                      className="h-4 w-4 accent-primary"
                    />
                    <Label
                      htmlFor={`flow-input-${f.varKey}`}
                      className="text-sm font-normal"
                    >
                      {values[f.varKey] ? '是' : '否'}
                    </Label>
                  </div>
                ) : (
                  <Input
                    type="text"
                    value={cur}
                    onChange={(e) => setField(f.varKey, e.target.value)}
                    className="font-mono"
                  />
                )}
              </div>
            )
          })}
        </div>

        <DialogFooter>
          <Button variant="outline" size="sm" onClick={onCancel}>
            取消运行
          </Button>
          <Button size="sm" onClick={submit}>
            提交
          </Button>
        </DialogFooter>
        </DialogPrimitive.Content>
      </DialogPortal>
    </Dialog>
  )
}
