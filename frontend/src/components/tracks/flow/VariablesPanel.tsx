// frontend/src/components/tracks/flow/VariablesPanel.tsx
// v-m：原生 button + window.confirm 全换 shadcn Button + useConfirm；语义 token + dark:。
import { Plus, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { useConfirm } from '@/components/ConfirmProvider'
import type { VarDecl, FlowV3 } from './flow-types-v3'
import { useGraphDispatch } from './GraphContext'
import { IdentifierInput } from './IdentifierInput'

interface Props {
  flow: FlowV3
}

export function VariablesPanel({ flow }: Props) {
  const dispatch = useGraphDispatch()

  const addVariable = () => {
    const key = `var${flow.variables.length + 1}`
    const v: VarDecl = { key, description: '', initialValue: null }
    dispatch({ type: 'add_variable', variable: v })
  }

  return (
    <aside className="w-72 border-r border-border bg-background p-3 overflow-y-auto">
      <div className="flex items-center justify-between mb-2">
        <div className="text-sm font-medium text-foreground">变量声明</div>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={addVariable}
          className="h-7 px-2 text-xs"
        >
          <Plus className="h-3 w-3 mr-1" />
          新增
        </Button>
      </div>
      {flow.variables.length === 0 && (
        <div className="text-xs text-muted-foreground">（无变量）</div>
      )}
      <div className="space-y-2">
        {flow.variables.map((v, i) => (
          // 用 index 作 React key 而非 v.key：rename 走 update_variable 时 v.key
          // 字符串会变，若把它作为 key 会触发整行 unmount→remount，input 丢焦点。
          // 当前 UI 没有 reorder，删一项后续 row 接管前面 DOM 只影响 IdentifierInput
          // 的 touched 状态（受控 value 仍然正确）。
          <VariableRow key={i} variable={v} dispatch={dispatch} />
        ))}
      </div>
    </aside>
  )
}

function VariableRow({
  variable,
  dispatch,
}: {
  variable: VarDecl
  dispatch: ReturnType<typeof useGraphDispatch>
}) {
  const confirm = useConfirm()
  const update = (patch: Partial<VarDecl>) => {
    dispatch({ type: 'update_variable', key: variable.key, patch })
  }
  const remove = async () => {
    const ok = await confirm({
      description: `删除变量 "${variable.key}"？`,
      confirmLabel: '删除',
      destructive: true,
    })
    if (ok) dispatch({ type: 'remove_variable', key: variable.key })
  }

  const renderValue = (v: unknown): string => {
    if (v === null || v === undefined) return ''
    if (typeof v === 'string') return v
    return JSON.stringify(v)
  }
  const parseValue = (raw: string): unknown => {
    if (raw === '' || raw === 'null') return null
    if (raw === 'true') return true
    if (raw === 'false') return false
    const num = Number(raw)
    if (!Number.isNaN(num) && /^[0-9.+-]+$/.test(raw)) return num
    return raw
  }

  return (
    <div className="border border-border rounded-md p-2 bg-muted/40 space-y-1">
      <div className="flex gap-1 items-start">
        <div className="flex-1">
          <IdentifierInput
            value={variable.key}
            onChange={(newKey) => {
              if (newKey === variable.key) return
              dispatch({ type: 'update_variable', key: variable.key, patch: { key: newKey } })
            }}
            placeholder="变量名"
          />
        </div>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          onClick={() => void remove()}
          title="删除"
          className="h-6 w-6 text-muted-foreground hover:text-destructive"
        >
          <X className="h-3 w-3" />
        </Button>
      </div>
      <Input
        type="text"
        value={variable.description}
        onChange={(e) => update({ description: e.target.value })}
        placeholder="变量描述（含义）"
        className="h-8 text-sm"
      />
      <Input
        type="text"
        value={renderValue(variable.initialValue)}
        onChange={(e) => update({ initialValue: parseValue(e.target.value) })}
        placeholder="初始值（可空）"
        className="h-8 text-sm font-mono"
      />
    </div>
  )
}
