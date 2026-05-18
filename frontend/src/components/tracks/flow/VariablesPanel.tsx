// frontend/src/components/tracks/flow/VariablesPanel.tsx
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
    <aside className="w-72 border-r bg-white p-3 overflow-y-auto">
      <div className="flex items-center justify-between mb-2">
        <div className="text-sm font-medium">变量声明</div>
        <button
          type="button"
          onClick={addVariable}
          className="text-xs px-2 py-0.5 rounded border hover:bg-blue-50"
        >
          + 新增
        </button>
      </div>
      {flow.variables.length === 0 && (
        <div className="text-xs text-gray-400">（无变量）</div>
      )}
      <div className="space-y-2">
        {flow.variables.map((v) => (
          <VariableRow key={v.key} variable={v} dispatch={dispatch} />
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
  const update = (patch: Partial<VarDecl>) => {
    dispatch({ type: 'update_variable', key: variable.key, patch })
  }
  const remove = () => {
    if (window.confirm(`删除变量 "${variable.key}"？`)) {
      dispatch({ type: 'remove_variable', key: variable.key })
    }
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
    <div className="border rounded p-2 bg-gray-50 space-y-1">
      <div className="flex gap-1 items-start">
        <div className="flex-1">
          <IdentifierInput
            value={variable.key}
            onChange={(newKey) => {
              if (newKey === variable.key) return
              dispatch({ type: 'remove_variable', key: variable.key })
              dispatch({ type: 'add_variable', variable: { ...variable, key: newKey } })
            }}
            placeholder="变量名"
          />
        </div>
        <button
          type="button"
          onClick={remove}
          className="text-xs text-red-500 hover:text-red-700 px-1"
          title="删除"
        >
          ×
        </button>
      </div>
      <input
        type="text"
        value={variable.description}
        onChange={(e) => update({ description: e.target.value })}
        placeholder="变量描述（含义）"
        className="w-full px-2 py-1 rounded border text-sm"
      />
      <input
        type="text"
        value={renderValue(variable.initialValue)}
        onChange={(e) => update({ initialValue: parseValue(e.target.value) })}
        placeholder="初始值（可空）"
        className="w-full px-2 py-1 rounded border text-sm font-mono"
      />
    </div>
  )
}
