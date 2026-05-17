// frontend/src/components/tracks/graph/graph-types-v2.ts

export interface GraphV2 {
  version: 2
  trackName: string
  nodes: NodeV2[]
  edges: EdgeV2[]
}

export type NodeV2 = CodeNode | AskUserNode | FaiNode | ReturnNode
// M2 will add: | IfFrameNode | LoopFrameNode

export interface NodeBase {
  id: string                            // n_xxxxxx, stable, codegen 用
  position: { x: number; y: number }
  parentId?: string                     // M2: 属于某 frame 时填
  parentSlot?: 'then' | 'else' | 'body' // M2
}

export interface CodeNode extends NodeBase {
  type: 'code'
  code: string                          // 自由 train-lang 源码段
}

export interface AskUserNode extends NodeBase {
  type: 'ask_user'
  outputVar: string
  fields: AskUserField[]
}

export interface AskUserField {
  id: string
  key: string
  label: string
  type: 'text' | 'number' | 'bool' | 'enum'
  variants?: string[]
  required?: boolean
}

export interface FaiNode extends NodeBase {
  type: 'fai'
  faiName: string
  outputVar: string
  inputs: FaiInput[]
  outputs: FaiOutput[]
  promptTemplate: string                // 纯字符串，含 ${var.path}
}

export interface FaiInput {
  id: string
  argName: string
  argType: 'string' | 'number' | 'bool' | 'prompt'
  sourceExpr: string                    // 用户写 train-lang 表达式
}

export interface FaiOutput {
  id: string
  name: string
  type: 'string' | 'number' | 'bool' | 'int' | 'array'
  innerType?: 'string' | 'number' | 'bool' | 'int'
  constraints?: { min?: number; max?: number; maxLen?: number }
}

export interface ReturnNode extends NodeBase {
  type: 'return'
  valueExpr: string                     // 纯字符串表达式
}

export interface EdgeV2 {
  id: string
  source: string                        // 起始 node id
  sourceHandle?: 'default'              // M1 仅 default；保留字段供未来扩展
  target: string                        // 目标 node id
}

/** Generate stable node id with crypto.randomUUID fallback (v-15-c lesson #7). */
export function newNodeId(): string {
  const rand =
    typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
      ? crypto.randomUUID().replace(/-/g, '').slice(0, 6)
      : Math.random().toString(36).slice(2, 8)
  return `n_${rand}`
}

export function newEdgeId(): string {
  return `e_${Math.random().toString(36).slice(2, 8)}`
}
