// frontend/src/components/tracks/flow/NodeInspector.tsx
// v-m：原生 input/select/button → shadcn Input/Select/Button；window.confirm → useConfirm；
// 色彩用语义 token + dark: 双写。
import { Trash2, Plus, X } from 'lucide-react'
import { toast } from 'sonner'
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
import { useConfirm } from '@/components/ConfirmProvider'
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
  const confirm = useConfirm()
  const node = flow.nodes.find((n) => n.id === selectedNodeId) ?? null

  if (!node) {
    return (
      <aside className="w-96 border-l border-border bg-background p-4 text-sm text-muted-foreground">
        选中节点编辑字段
      </aside>
    )
  }

  return (
    <aside className="w-96 border-l border-border bg-background p-4 overflow-y-auto">
      <div className="text-xs text-muted-foreground mb-2">节点 ID: <span className="font-mono">{node.id}</span></div>
      <div className="text-xs text-muted-foreground mb-3">类型: {nodeTypeLabel(node.type)}</div>

      {/* v-i：用户可填的显示名，用于运行中悬浮 minimap card / 节点头部显示。
          codex C1：保存时 trim，全空白当未填（不持久化 label: "") */}
      <div className="mb-3 space-y-1.5">
        <Label className="text-xs text-muted-foreground">显示名（运行可视化用）</Label>
        <Input
          type="text"
          value={node.label ?? ''}
          onChange={(e) => {
            const trimmed = e.target.value.trim()
            dispatch({
              type: 'update_node',
              nodeId: node.id,
              patch: { label: trimmed === '' ? undefined : e.target.value },
            })
          }}
          placeholder={`默认: ${nodeTypeLabel(node.type)}`}
          className="h-8 text-sm"
        />
      </div>

      {node.type === 'user_input' && (
        <UserInputForm node={node} variables={flow.variables} dispatch={dispatch} />
      )}
      {node.type === 'llm' && (
        <LLMForm node={node} variables={flow.variables} dispatch={dispatch} />
      )}
      {node.type === 'if' && (
        <IfForm node={node} dispatch={dispatch} />
      )}

      <div className="mt-6 pt-3 border-t border-border">
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={async () => {
            const ok = await confirm({
              description: `确定删除节点 "${node.id}"？相关连线一起删除。`,
              confirmLabel: '删除',
              destructive: true,
            })
            if (ok) dispatch({ type: 'remove_node', nodeId: node.id })
          }}
          className="w-full text-destructive hover:text-destructive hover:bg-destructive/10 border-destructive/40"
        >
          <Trash2 className="h-3.5 w-3.5 mr-1" />
          删除节点
        </Button>
      </div>
    </aside>
  )
}

function nodeTypeLabel(t: NodeV3['type']): string {
  return t === 'user_input' ? '用户输入' : t === 'llm' ? 'LLM 调用' : '逻辑判断'
}

const UI_HINT_OPTIONS: UserInputField['uiHint'][] = ['text', 'textarea', 'number', 'bool', 'enum']

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
      toast.error('请先在左侧变量声明面板中添加变量')
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
      <Label className="text-xs text-muted-foreground">绑定变量</Label>
      {node.fields.length === 0 && (
        <div className="text-xs text-muted-foreground">（无字段）</div>
      )}
      {node.fields.map((f, i) => (
        <div key={i} className="border border-border rounded-md p-2 bg-muted/40 space-y-1.5">
          <div className="flex gap-1 items-center">
            <div className="flex-1">
              <Select
                value={f.varKey}
                onValueChange={(v) => updateField(i, { varKey: v })}
              >
                <SelectTrigger className="h-8 text-sm">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {variables.map((v) => (
                    <SelectItem key={v.key} value={v.key}>
                      <span className="font-mono">{v.key}</span>
                      {v.description && (
                        <span className="text-muted-foreground"> — {v.description}</span>
                      )}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              onClick={() => removeField(i)}
              title="移除字段"
              className="h-7 w-7 text-muted-foreground hover:text-destructive"
            >
              <X className="h-3 w-3" />
            </Button>
          </div>
          <Select
            value={f.uiHint ?? 'text'}
            onValueChange={(v) => updateField(i, { uiHint: v as UserInputField['uiHint'] })}
          >
            <SelectTrigger className="h-8 text-sm">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {UI_HINT_OPTIONS.map((h) => (
                <SelectItem key={h} value={h ?? 'text'}>{h}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      ))}
      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={addField}
        className="h-7 text-xs"
      >
        <Plus className="h-3 w-3 mr-1" />
        添加字段
      </Button>
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
      <div className="space-y-1.5">
        <Label className="text-xs text-muted-foreground">Prompt 模板</Label>
        <PromptTemplateEditor
          value={node.promptTemplate}
          variables={variables}
          onChange={updatePrompt}
          onCreateVariable={onCreateVariable}
          rows={6}
          placeholder="@{var} 引用输入，${var} 标记输出"
        />
      </div>
      <div className="text-xs text-muted-foreground">
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
      <Label className="text-xs text-muted-foreground">条件表达式</Label>
      <Input
        type="text"
        value={node.conditionExpr}
        onChange={(e) =>
          dispatch({ type: 'update_node', nodeId: node.id, patch: { conditionExpr: e.target.value } })
        }
        placeholder="例：has_error == true"
        className="h-8 text-sm font-mono"
      />
      <div className="text-xs text-muted-foreground">
        支持：变量名、字面量（null/true/false/数字/字符串）、比较运算（==、!=、&gt;、&lt;、&gt;=、&lt;=）、逻辑（&amp;&amp; ||）。求值在 M2b 实现。
      </div>
    </div>
  )
}
