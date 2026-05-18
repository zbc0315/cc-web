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
    } else if (n.type === 'if') {
      // 不做完整语法校验（保留给 backend if-expr-parser），但必须做 identifier
      // 存在性校验：rename 变量后 conditionExpr 残留旧 key 在 runtime 求值为 null，
      // null == null → true，会让 if 分支静默走向与原意相反的支。
      for (const k of extractConditionIdentifiers(n.conditionExpr)) {
        if (!seenKeys.has(k)) {
          errors.push({
            level: 'error',
            message: `if 节点 ${n.id} 条件引用未声明变量 "${k}"`,
            nodeId: n.id,
          })
        }
      }
    }
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

/**
 * 提取 conditionExpr 里所有用户变量名 identifier（排除 true/false/null）。
 * 跳过字符串字面量内的字符，避免 `"area"` 里的 area 被误判为变量引用。
 * 不做完整语法校验 —— 仅用于"保存时 identifier 必须已声明"这一安全闸门。
 * 与 backend if-expr-parser 的合法语法严格对齐：变量名 = [a-zA-Z_][a-zA-Z0-9_]*。
 */
function extractConditionIdentifiers(src: string): string[] {
  const idents = new Set<string>()
  const RESERVED = new Set(['true', 'false', 'null'])
  let i = 0
  while (i < src.length) {
    const c = src[i]!
    if (c === '"') {
      const end = src.indexOf('"', i + 1)
      if (end === -1) break  // 未闭合字符串：backend parser 会 throw，validator 不抢 parse 错的活
      i = end + 1
      continue
    }
    if (/[a-zA-Z_]/.test(c)) {
      let j = i
      while (j < src.length && /[a-zA-Z0-9_]/.test(src[j]!)) j++
      const word = src.slice(i, j)
      if (!RESERVED.has(word)) idents.add(word)
      i = j
      continue
    }
    i++
  }
  return [...idents]
}
