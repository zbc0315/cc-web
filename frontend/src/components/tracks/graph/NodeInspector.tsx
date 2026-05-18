// frontend/src/components/tracks/graph/NodeInspector.tsx
import type {
  GraphV2, NodeV2, AskUserNode, AskUserField,
  FaiNode, FaiInput, FaiOutput,
} from './graph-types-v2'
import { useGraphDispatch } from './GraphContext'
import { IdentifierInput } from './IdentifierInput'

interface Props {
  graph: GraphV2
  selectedNodeId: string | null
}

export function NodeInspector({ graph, selectedNodeId }: Props) {
  const dispatch = useGraphDispatch()
  const node = graph.nodes.find((n) => n.id === selectedNodeId) ?? null

  if (!node) {
    return (
      <aside className="w-80 border-l bg-white p-4 text-sm text-gray-400">
        点节点编辑
      </aside>
    )
  }

  const patch = (p: Partial<NodeV2>) =>
    dispatch({ type: 'update_node', nodeId: node.id, patch: p })

  return (
    <aside className="w-80 border-l bg-white p-4 overflow-y-auto">
      <div className="text-xs text-gray-500 mb-2">节点 ID: {node.id}</div>
      {node.type === 'code' && (
        <div className="text-sm text-gray-600">
          代码节点的内容在画布上直接编辑（Monaco）。
        </div>
      )}
      {node.type === 'ask_user' && (
        <div className="space-y-3">
          <div>
            <label className="text-xs text-gray-500 block mb-1">outputVar</label>
            <IdentifierInput
              value={node.outputVar}
              onChange={(v) => patch({ outputVar: v })}
            />
          </div>
          <div>
            <label className="text-xs text-gray-500 block mb-1">字段</label>
            <AskUserFieldsEditor node={node} dispatch={dispatch} />
          </div>
        </div>
      )}
      {node.type === 'fai' && (
        <FaiInspectorForm node={node} dispatch={dispatch} />
      )}
      {node.type === 'return' && (
        <div>
          <label className="text-xs text-gray-500 block mb-1">返回表达式</label>
          <textarea
            value={node.valueExpr}
            onChange={(e) => patch({ valueExpr: e.target.value })}
            rows={4}
            className="w-full px-2 py-1 rounded border text-sm font-mono"
          />
        </div>
      )}
      <div className="mt-6 pt-3 border-t">
        <button
          type="button"
          onClick={() => {
            if (window.confirm(`确定删除节点 "${node.id}"？相关连线一起删除。`)) {
              dispatch({ type: 'remove_node', nodeId: node.id })
            }
          }}
          className="w-full px-3 py-1.5 rounded border border-red-300 text-red-600 hover:bg-red-50 text-sm"
        >
          删除节点
        </button>
      </div>
    </aside>
  )
}

// ── AskUser fields editor ───────────────────────────────────────────

function AskUserFieldsEditor({
  node,
  dispatch,
}: {
  node: AskUserNode
  dispatch: ReturnType<typeof useGraphDispatch>
}) {
  const addField = () => {
    const f: AskUserField = {
      id: `f_${Math.random().toString(36).slice(2, 8)}`,
      key: `field${node.fields.length + 1}`,
      label: '',
      type: 'text',
    }
    dispatch({ type: 'update_node', nodeId: node.id, patch: { fields: [...node.fields, f] } })
  }
  const updateField = (id: string, p: Partial<AskUserField>) =>
    dispatch({
      type: 'update_node',
      nodeId: node.id,
      patch: { fields: node.fields.map((f) => (f.id === id ? { ...f, ...p } : f)) },
    })
  const removeField = (id: string) =>
    dispatch({
      type: 'update_node',
      nodeId: node.id,
      patch: { fields: node.fields.filter((f) => f.id !== id) },
    })

  return (
    <div className="space-y-2">
      {node.fields.map((f) => (
        <div key={f.id} className="border rounded p-2 space-y-1 bg-gray-50">
          <div className="flex gap-1">
            <IdentifierInput value={f.key} onChange={(v) => updateField(f.id, { key: v })} placeholder="key" />
            <button onClick={() => removeField(f.id)} className="text-xs text-red-500 px-2">×</button>
          </div>
          <input
            type="text"
            value={f.label}
            placeholder="label"
            onChange={(e) => updateField(f.id, { label: e.target.value })}
            className="w-full px-2 py-1 rounded border text-sm"
          />
          <select
            value={f.type}
            onChange={(e) => updateField(f.id, { type: e.target.value as AskUserField['type'] })}
            className="w-full px-2 py-1 rounded border text-sm"
          >
            <option value="text">text</option>
            <option value="number">number</option>
            <option value="bool">bool</option>
            <option value="enum">enum</option>
          </select>
        </div>
      ))}
      <button onClick={addField} className="text-sm text-blue-600">+ 添加字段</button>
    </div>
  )
}

// ── Fai inspector form ──────────────────────────────────────────────

function FaiInspectorForm({
  node,
  dispatch,
}: {
  node: FaiNode
  dispatch: ReturnType<typeof useGraphDispatch>
}) {
  const patch = (p: Partial<FaiNode>) =>
    dispatch({ type: 'update_node', nodeId: node.id, patch: p })

  const addInput = () => {
    const i: FaiInput = {
      id: `i_${Math.random().toString(36).slice(2, 8)}`,
      argName: `arg${node.inputs.length + 1}`,
      argType: 'string',
      sourceExpr: '""',
    }
    patch({ inputs: [...node.inputs, i] })
  }
  const updateInput = (id: string, p: Partial<FaiInput>) =>
    patch({ inputs: node.inputs.map((i) => (i.id === id ? { ...i, ...p } : i)) })
  const removeInput = (id: string) =>
    patch({ inputs: node.inputs.filter((i) => i.id !== id) })

  const addOutput = () => {
    const o: FaiOutput = {
      id: `o_${Math.random().toString(36).slice(2, 8)}`,
      name: `out${node.outputs.length + 1}`,
      type: 'string',
    }
    patch({ outputs: [...node.outputs, o] })
  }
  const updateOutput = (id: string, p: Partial<FaiOutput>) =>
    patch({ outputs: node.outputs.map((o) => (o.id === id ? { ...o, ...p } : o)) })
  const removeOutput = (id: string) =>
    patch({ outputs: node.outputs.filter((o) => o.id !== id) })

  return (
    <div className="space-y-3">
      <div>
        <label className="text-xs text-gray-500 block mb-1">fai 名</label>
        <IdentifierInput value={node.faiName} onChange={(v) => patch({ faiName: v })} />
      </div>
      <div>
        <label className="text-xs text-gray-500 block mb-1">outputVar</label>
        <IdentifierInput value={node.outputVar} onChange={(v) => patch({ outputVar: v })} />
      </div>
      <div>
        <label className="text-xs text-gray-500 block mb-1">prompt 模板</label>
        <textarea
          value={node.promptTemplate}
          onChange={(e) => patch({ promptTemplate: e.target.value })}
          rows={3}
          className="w-full px-2 py-1 rounded border text-sm"
          placeholder="使用 ${var.path} 插值"
        />
      </div>
      <div>
        <label className="text-xs text-gray-500 block mb-1">inputs</label>
        <div className="space-y-2">
          {node.inputs.map((i) => (
            <div key={i.id} className="border rounded p-2 bg-gray-50 space-y-1">
              <div className="flex gap-1">
                <IdentifierInput value={i.argName} onChange={(v) => updateInput(i.id, { argName: v })} placeholder="argName" />
                <button onClick={() => removeInput(i.id)} className="text-xs text-red-500 px-2">×</button>
              </div>
              <select
                value={i.argType}
                onChange={(e) => updateInput(i.id, { argType: e.target.value as FaiInput['argType'] })}
                className="w-full px-2 py-1 rounded border text-sm"
              >
                <option value="string">string</option>
                <option value="number">number</option>
                <option value="bool">bool</option>
                <option value="prompt">prompt</option>
              </select>
              <input
                type="text"
                value={i.sourceExpr}
                placeholder='train-lang 表达式（如 r.text 或 "literal"）'
                onChange={(e) => updateInput(i.id, { sourceExpr: e.target.value })}
                className="w-full px-2 py-1 rounded border text-sm font-mono"
              />
            </div>
          ))}
          <button onClick={addInput} className="text-sm text-blue-600">+ 添加 input</button>
        </div>
      </div>
      <div>
        <label className="text-xs text-gray-500 block mb-1">outputs</label>
        <div className="space-y-2">
          {node.outputs.map((o) => (
            <div key={o.id} className="border rounded p-2 bg-gray-50 space-y-1">
              <div className="flex gap-1">
                <IdentifierInput value={o.name} onChange={(v) => updateOutput(o.id, { name: v })} placeholder="name" />
                <button onClick={() => removeOutput(o.id)} className="text-xs text-red-500 px-2">×</button>
              </div>
              <select
                value={o.type}
                onChange={(e) => updateOutput(o.id, { type: e.target.value as FaiOutput['type'] })}
                className="w-full px-2 py-1 rounded border text-sm"
              >
                <option value="string">string</option>
                <option value="number">number</option>
                <option value="int">int</option>
                <option value="bool">bool</option>
                <option value="array">array</option>
              </select>
            </div>
          ))}
          <button onClick={addOutput} className="text-sm text-blue-600">+ 添加 output</button>
        </div>
      </div>
    </div>
  )
}
