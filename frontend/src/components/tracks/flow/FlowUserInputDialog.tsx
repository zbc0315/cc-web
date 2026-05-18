import { useState } from 'react'
import * as Dialog from '@radix-ui/react-dialog'
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

  const submit = () => {
    onSubmit(values)
  }

  return (
    <Dialog.Root open={open} onOpenChange={(o) => { if (!o) onCancel() }}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 bg-black/40 z-[60]" />
        <Dialog.Content className="fixed left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 w-[480px] bg-white rounded-lg z-[60] p-6">
          <Dialog.Title className="text-lg font-semibold mb-4">需要您输入</Dialog.Title>
          <div className="space-y-3">
            {pending.fields.map((f) => {
              const decl = flow.variables.find((v) => v.key === f.varKey)
              const label = decl ? `${f.varKey}（${decl.description}）` : f.varKey
              const cur = (values[f.varKey] as string) ?? ''
              return (
                <div key={f.varKey}>
                  <label className="text-sm text-gray-600 block mb-1">{label}</label>
                  {f.uiHint === 'textarea' ? (
                    <textarea
                      value={cur}
                      onChange={(e) => setValues({ ...values, [f.varKey]: e.target.value })}
                      rows={4}
                      className="w-full px-2 py-1 rounded border text-sm font-mono"
                    />
                  ) : f.uiHint === 'enum' && f.variants ? (
                    <select
                      value={cur}
                      onChange={(e) => setValues({ ...values, [f.varKey]: e.target.value })}
                      className="w-full px-2 py-1 rounded border text-sm"
                    >
                      <option value="">（请选择）</option>
                      {f.variants.map((v) => (<option key={v} value={v}>{v}</option>))}
                    </select>
                  ) : f.uiHint === 'number' ? (
                    <input
                      type="number"
                      value={cur}
                      onChange={(e) => setValues({ ...values, [f.varKey]: Number(e.target.value) })}
                      className="w-full px-2 py-1 rounded border text-sm font-mono"
                    />
                  ) : f.uiHint === 'bool' ? (
                    <input
                      type="checkbox"
                      checked={!!values[f.varKey]}
                      onChange={(e) => setValues({ ...values, [f.varKey]: e.target.checked })}
                    />
                  ) : (
                    <input
                      type="text"
                      value={cur}
                      onChange={(e) => setValues({ ...values, [f.varKey]: e.target.value })}
                      className="w-full px-2 py-1 rounded border text-sm font-mono"
                    />
                  )}
                </div>
              )
            })}
          </div>
          <div className="mt-6 flex justify-end gap-2">
            <button onClick={onCancel} className="text-sm px-3 py-1 rounded border">取消运行</button>
            <button onClick={submit} className="text-sm px-3 py-1 rounded bg-blue-600 text-white">提交</button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
