// frontend/src/components/tracks/flow/flow-validator.ts
import type { FlowV3 } from './flow-types-v3'
import { extractInputs, extractOutputs } from './prompt-placeholder-extractor'
import { parseIfExpr } from './if-expr-parser'

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
      // v-h: 空 fields 和 fields 重复 varKey 校验
      if (n.fields.length === 0) {
        errors.push({
          level: 'error',
          message: `用户输入节点 ${n.id} 至少需要 1 个字段（空列表会让运行时弹一个没字段的 dialog）`,
          nodeId: n.id,
        })
      }
      const seenFieldKeys = new Set<string>()
      for (const f of n.fields) {
        if (!seenKeys.has(f.varKey)) {
          errors.push({
            level: 'error',
            message: `用户输入节点 ${n.id} 字段引用未声明变量 "${f.varKey}"`,
            nodeId: n.id,
          })
        }
        if (seenFieldKeys.has(f.varKey)) {
          errors.push({
            level: 'error',
            message: `用户输入节点 ${n.id} 字段 "${f.varKey}" 重复（dialog 会渲染两个同 key 输入，后者覆盖前者）`,
            nodeId: n.id,
          })
        } else {
          seenFieldKeys.add(f.varKey)
        }
      }
    } else if (n.type === 'if') {
      // v-h: 用复制自 backend 的 parser 做完整语法校验（之前只做 identifier
      // 存在性，语法错的表达式如 `x ==` 能保存通过、runtime 才 throw → 整 run failed）。
      let syntaxOk = true
      try {
        parseIfExpr(n.conditionExpr)
      } catch (e) {
        syntaxOk = false
        errors.push({
          level: 'error',
          message: `if 节点 ${n.id} 条件表达式语法错误：${(e as Error).message}`,
          nodeId: n.id,
        })
      }
      // identifier 存在性校验：rename 变量后 conditionExpr 残留旧 key 在 runtime
      // 求值为 null，null == null → true，会让 if 分支静默走向与原意相反的支。
      // 即便语法错也仍跑 identifier 检查（让用户一次看到全部问题）。
      if (syntaxOk || syntaxOk === false) {  // 始终跑
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
  }

  // 3b. nodeId 唯一性（v-h）。reducer.add_node 不去重，外部导入 .flow 或并发
  // 编辑可能出现重复 id；运行时 `flow.nodes.find` 只命中第一个，后者永远不跑到。
  {
    const seenNodeIds = new Set<string>()
    for (const n of flow.nodes) {
      if (seenNodeIds.has(n.id)) {
        errors.push({
          level: 'error',
          message: `节点 id 重复："${n.id}"（运行时只会执行其中一个）`,
          nodeId: n.id,
        })
      } else {
        seenNodeIds.add(n.id)
      }
    }
  }

  // 3c. LLM promptTemplate 长度警告（v-h，不阻保存）。超长 prompt 配合 outputs
  // 系统指令段 → Ink TUI paste-folding 启发式难预测。
  for (const n of flow.nodes) {
    if (n.type === 'llm' && n.promptTemplate.length > 65536) {
      errors.push({
        level: 'warning',
        message: `LLM 节点 ${n.id} promptTemplate 较长（${(n.promptTemplate.length / 1024).toFixed(1)}KB），Ink TUI 大段 paste 行为不可预测`,
        nodeId: n.id,
      })
    }
  }

  // 4a. edge handle 出口唯一性：同 source + sourceHandle 不能连多个 target，否则
  // runtime pickNext 只走数组里第一个，剩下的静默忽略（用户视觉上画了两条线但
  // 只走一条）。校验在 edge 集合层面，比 reducer 内部去重更早暴露。
  {
    const outgoing = new Map<string, string[]>()  // `${source}::${handle}` → [target,...]
    for (const e of flow.edges) {
      const handle = e.sourceHandle ?? 'default'
      const k = `${e.source}::${handle}`
      const arr = outgoing.get(k) ?? []
      arr.push(e.target ?? '(end)')
      outgoing.set(k, arr)
    }
    for (const [k, targets] of outgoing) {
      if (targets.length > 1) {
        const [source, handle] = k.split('::')
        errors.push({
          level: 'error',
          message: `节点 ${source} 的 ${handle} 出口连了 ${targets.length} 条边（${targets.join(', ')}），运行时只会走第一条`,
          nodeId: source,
        })
      }
    }
  }

  // 4b. 结构：唯一入口 + 所有节点可达入口
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
