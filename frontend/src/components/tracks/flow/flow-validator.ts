// frontend/src/components/tracks/flow/flow-validator.ts
import type { FlowV3 } from './flow-types-v3'
import { extractInputs, extractOutputs } from './prompt-placeholder-extractor'

const IDENT_RE = /^[a-zA-Z_][a-zA-Z0-9_]*$/
const VALID_ADAPTERS = new Set(['claude-code', 'codex', 'qwen', 'gemini'])

export interface ValidationError {
  level: 'error' | 'warning'
  message: string
  nodeId?: string
  variableKey?: string
}

export interface ValidationResult {
  ok: boolean
  errors: ValidationError[]
}

export function validateFlow(flow: FlowV3): ValidationResult {
  const errors: ValidationError[] = []

  // 1. adapter
  if (!VALID_ADAPTERS.has(flow.adapter)) {
    errors.push({ level: 'error', message: `非法 adapter: ${flow.adapter}` })
  }

  // 2. 变量：合法 identifier + 无重名
  const seenKeys = new Set<string>()
  for (const v of flow.variables) {
    if (!IDENT_RE.test(v.key)) {
      errors.push({
        level: 'error',
        message: `变量 key "${v.key}" 不是合法 identifier`,
        variableKey: v.key,
      })
    }
    if (seenKeys.has(v.key)) {
      errors.push({
        level: 'error',
        message: `变量 key "${v.key}" 重名（duplicate）`,
        variableKey: v.key,
      })
    } else {
      seenKeys.add(v.key)
    }
  }

  // 3. 节点引用变量
  for (const n of flow.nodes) {
    if (n.type === 'llm') {
      const inKeys = extractInputs(n.promptTemplate)
      const outKeys = extractOutputs(n.promptTemplate)
      for (const k of [...inKeys, ...outKeys]) {
        if (!seenKeys.has(k)) {
          errors.push({
            level: 'error',
            message: `LLM 节点 ${n.id} 引用未声明变量 "${k}"`,
            nodeId: n.id,
          })
        }
      }
    } else if (n.type === 'user_input') {
      for (const f of n.fields) {
        if (!seenKeys.has(f.varKey)) {
          errors.push({
            level: 'error',
            message: `用户输入节点 ${n.id} 字段引用未声明变量 "${f.varKey}"`,
            nodeId: n.id,
          })
        }
      }
    }
    // if 节点的 conditionExpr 暂不校验（M2b 用 if-expr-parser）
  }

  // 4. 结构：唯一入口 + 所有节点可达入口
  if (flow.nodes.length === 0) {
    errors.push({ level: 'error', message: '空 flow（无任何节点 / 缺入口）' })
  } else {
    const incomingCount = new Map<string, number>()
    for (const n of flow.nodes) incomingCount.set(n.id, 0)
    for (const e of flow.edges) {
      if (e.target !== null) {
        incomingCount.set(e.target, (incomingCount.get(e.target) ?? 0) + 1)
      }
    }
    const entries = flow.nodes.filter((n) => (incomingCount.get(n.id) ?? 0) === 0)
    if (entries.length === 0) {
      errors.push({ level: 'error', message: '无入口节点（图中存在环且无 in-degree=0 节点）' })
    } else if (entries.length > 1) {
      errors.push({
        level: 'error',
        message: `多入口节点（不允许）：${entries.map((n) => n.id).join(', ')}`,
      })
    }
  }

  return { ok: errors.filter((e) => e.level === 'error').length === 0, errors }
}
