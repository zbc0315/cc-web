// frontend/src/components/tracks/flow/flow-types-v3.ts

/**
 * Variable declaration (in FlowV3.variables[]).
 * spec §5.2: M1 三字段（key / description / initialValue），无 type 字段。
 */
export interface VarDecl {
  key: string                      // 变量名（train.json 字段名，valid identifier）
  description: string              // 变量描述（含义，中文/任意自然语言）
  initialValue: unknown            // 变量值（可为空，默认 null）
}

// ── Nodes ──────────────────────────────────────────────────

export type NodeV3 = UserInputNode | LLMNode | IfNode

export interface NodeBase {
  id: string                       // n_xxxxxx (stable, codegen 用)
  type: 'user_input' | 'llm' | 'if'
  position: { x: number; y: number }
  label?: string                   // 用户填写的显示名（v-i 起）；空时 fallback 到 id
}

export interface UserInputNode extends NodeBase {
  type: 'user_input'
  fields: UserInputField[]
}

export interface UserInputField {
  varKey: string                   // 引用 variables[*].key
  uiHint?: 'text' | 'textarea' | 'number' | 'bool' | 'enum'
  variants?: string[]              // when uiHint === 'enum'
}

export interface LLMNode extends NodeBase {
  type: 'llm'
  promptTemplate: string           // 含 @{key} / ${key} 占位
  inputs: string[]                 // 自动推导自 promptTemplate 中 @{key}（保存时缓存）
  outputs: string[]                // 自动推导自 promptTemplate 中 ${key}（保存时缓存）
}

export interface IfNode extends NodeBase {
  type: 'if'
  conditionExpr: string            // 受限表达式（spec §5.4，M1 仅存储字符串，校验/求值 M2b 做）
}

// ── Edges ──────────────────────────────────────────────────

export interface EdgeV3 {
  id: string
  source: string                   // 起始 node id
  sourceHandle?: 'default' | 'true' | 'false'   // if 节点用 'true'/'false'
  target: string | null            // null 表示连到隐式 end
  endLabel?: string                // 当 target=null 时的 UI 标签
}

// ── Flow ────────────────────────────────────────────────────

export type AdapterKind = 'claude-code' | 'codex' | 'qwen' | 'gemini'

export interface FlowV3 {
  version: 3
  trackName: string
  adapter: AdapterKind
  variables: VarDecl[]
  nodes: NodeV3[]
  edges: EdgeV3[]
}

// ── ID generation ──────────────────────────────────────────

/** Generate stable short id with crypto.randomUUID fallback (LAN HTTP 非 secure context). */
function randomShortId(prefix: string): string {
  const rand =
    typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
      ? crypto.randomUUID().replace(/-/g, '').slice(0, 6)
      : Math.random().toString(36).slice(2, 8)
  return `${prefix}_${rand}`
}

export function newNodeId(): string {
  return randomShortId('n')
}

export function newEdgeId(): string {
  return randomShortId('e')
}

// ── Initial / factory ──────────────────────────────────────

export function emptyFlow(trackName: string, adapter: AdapterKind = 'claude-code'): FlowV3 {
  return {
    version: 3,
    trackName,
    adapter,
    variables: [],
    nodes: [],
    edges: [],
  }
}
