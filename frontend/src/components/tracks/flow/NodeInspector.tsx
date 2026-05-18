// frontend/src/components/tracks/flow/NodeInspector.tsx
import type { FlowV3, NodeV3, UserInputNode, UserInputField, LLMNode, IfNode, VarDecl } from './flow-types-v3'
import { useGraphDispatch } from './GraphContext'
import { PromptTemplateEditor } from './PromptTemplateEditor'
import { extractInputs, extractOutputs } from './prompt-placeholder-extractor'

interface Props {
  flow: FlowV3
  selectedNodeId: string | null
}

export function NodeInspector({ flow, selectedNodeId }: Props) {
  const dispatch = useGraphDispatch()
  const node = flow.nodes.find((n) => n.id === selectedNodeId) ?? null

  if (!node) {
    return (
      <aside className="w-96 border-l bg-white p-4 text-sm text-gray-400">
        选中节点编辑字段
      </aside>
    )
  }

  return (
    <aside className="w-96 border-l bg-white p-4 overflow-y-auto">
      <div className="text-xs text-gray-500 mb-2">节点 ID: {node.id}</div>
      <div className="text-xs text-gray-500 mb-3">类型: {nodeTypeLabel(node.type)}</div>

      {node.type === 'user_input' && (
        <UserInputForm node={node} variables={flow.variables} dispatch={dispatch} />
      )}
      {node.type === 'llm' && (
        <LLMForm node={node} variables={flow.variables} dispatch={dispatch} />
      )}
      {node.type === 'if' && (
        <IfForm node={node} dispatch={dispatch} />
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

function nodeTypeLabel(t: NodeV3['type']): string {
  return t === 'user_input' ? '用户输入' : t === 'llm' ? 'LLM 调用' : '逻辑判断'
}

// ── User input form ─────────────────────────────────────────

function UserInputForm({
  node,
  variables,
  dispatch,
}: {
  node: UserInputNode
  variables: VarDecl[]
  dispatch: ReturnType<typeof useGraphDispatch>
}) {
  const patch = (p: Partial<UserInputNode>) =>
    dispatch({ type: 'update_node', nodeId: node.id, patch: p })

  const addField = () => {
    if (variables.length === 0) {
      alert('请先在左侧变量声明面板中添加变量')
      return
    }
    const f: UserInputField = { varKey: variables[0]!.key, uiHint: 'text' }
    patch({ fields: [...node.fields, f] })
  }
  const updateField = (idx: number, p: Partial<UserInputField>) =>
    patch({ fields: node.fields.map((f, i) => (i === idx ? { ...f, ...p } : f)) })
  const removeField = (idx: number) =>
    patch({ fields: node.fields.filter((_, i) => i !== idx) })

  return (
    <div className="space-y-3">
      <label className="text-xs text-gray-500 block">绑定变量</label>
      {node.fields.length === 0 && (
        <div className="text-xs text-gray-400">（无字段）</div>
      )}
      {node.fields.map((f, i) => (
        <div key={i} className="border rounded p-2 bg-gray-50 space-y-1">
          <div className="flex gap-1">
            <select
              value={f.varKey}
              onChange={(e) => updateField(i, { varKey: e.target.value })}
              className="flex-1 px-2 py-1 rounded border text-sm"
            >
              {variables.map((v) => (
                <option key={v.key} value={v.key}>{v.key} — {v.description}</option>
              ))}
            </select>
            <button onClick={() => removeField(i)} className="text-xs text-red-500 px-2">×</button>
          </div>
          <select
            value={f.uiHint ?? 'text'}
            onChange={(e) => updateField(i, { uiHint: e.target.value as UserInputField['uiHint'] })}
            className="w-full px-2 py-1 rounded border text-sm"
          >
            <option value="text">text</option>
            <option value="textarea">textarea</option>
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

// ── LLM form ────────────────────────────────────────────────

function LLMForm({
  node,
  variables,
  dispatch,
}: {
  node: LLMNode
  variables: VarDecl[]
  dispatch: ReturnType<typeof useGraphDispatch>
}) {
  const patch = (p: Partial<LLMNode>) =>
    dispatch({ type: 'update_node', nodeId: node.id, patch: p })

  const updatePrompt = (newTpl: string) => {
    patch({
      promptTemplate: newTpl,
      inputs: extractInputs(newTpl),
      outputs: extractOutputs(newTpl),
    })
  }

  const onCreateVariable = (newKey: string) => {
    dispatch({ type: 'add_variable', variable: { key: newKey, description: '', initialValue: null } })
  }

  return (
    <div className="space-y-3">
      <div>
        <label className="text-xs text-gray-500 block mb-1">Prompt 模板</label>
        <PromptTemplateEditor
          value={node.promptTemplate}
          variables={variables}
          onChange={updatePrompt}
          onCreateVariable={onCreateVariable}
          rows={6}
          placeholder="@{var} 引用输入，${var} 标记输出"
        />
      </div>
      <div className="text-xs text-gray-500">
        自动推导：{node.inputs.length} 输入（{node.inputs.join(', ') || '—'}）/ {node.outputs.length} 输出（{node.outputs.join(', ') || '—'}）
      </div>
    </div>
  )
}

// ── If form ─────────────────────────────────────────────────

function IfForm({
  node,
  dispatch,
}: {
  node: IfNode
  dispatch: ReturnType<typeof useGraphDispatch>
}) {
  return (
    <div className="space-y-3">
      <label className="text-xs text-gray-500 block">条件表达式</label>
      <input
        type="text"
        value={node.conditionExpr}
        onChange={(e) =>
          dispatch({ type: 'update_node', nodeId: node.id, patch: { conditionExpr: e.target.value } })
        }
        placeholder="例：has_error == true"
        className="w-full px-2 py-1 rounded border text-sm font-mono"
      />
      <div className="text-xs text-gray-400">
        支持：变量名、字面量（null/true/false/数字/字符串）、比较运算（==、!=、&gt;、&lt;、&gt;=、&lt;=）、逻辑（&amp;&amp; ||）。求值在 M2b 实现。
      </div>
    </div>
  )
}
