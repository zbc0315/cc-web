# Track Flow Engine v3 — M2（Runtime + LLM 集成 + Prompt 转译 + if 引擎）Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让 v3 工作轨**真正能跑**：实现 state-machine runtime + Prompt 自动转译 + if 受限表达式引擎 + train.json 原子同步 + LLM 调用（PTY 注入 + 文件监听）+ WS 事件 + 三道防线（节点 iter / 总 LLM 调用 / 总时长）+ 变量变更审计 log + daemon 重启清理 + 用户输入运行时弹窗 + 节点状态可视化。M2 完成后用户给 v3 spec §2 那个 "research-loop" 工作轨创建+保存+运行能跑到 end。

**Architecture:** v3 runtime 在 `backend/src/track-flow/`，state machine 单步驱动：从 entry 节点开始，按节点类型分发执行 → user_input 节点 emit WS 等前端提交 → llm 节点经 prompt-translator 转译后 fork 当前 PTY 注入 prompt，监听 `.ccweb/<basename>.train.json` 变更等 LLM 写完 → if 节点用受限 expr-evaluator 求值 → 沿边走到下一节点。runtime 不依赖 train-lang DSL / fai 概念 / LLMAdapter 抽象——直接用 terminal-manager PTY 注入 + ccweb 自己的 train.json watcher。前端通过新 `useFlowRun` hook 订阅 WS 状态，`FlowRunPanel` 显示变量值实时刷新 + 节点状态边框 + iter 计数 + 三道防线 quota。

**Tech Stack:** TypeScript / Express / WebSocket（复用 `broadcastJson`）/ Node fs（原子写 tmp+rename）/ chokidar（文件监听复用现有 mechanism 或自实现 polling）/ vitest 1.6 / React 18 / reactflow 11.11

---

## 前置数据（M2 关键决策摘录）

### A. 不复用 ccweb-train-adapter / workflow-data-watcher 的原因

- ccweb-train-adapter 为 train-lang fai 调用设计，writeProtocolHint 教 LLM 写 `variables.<name>` 和 `task_progress.push({...finish:true})` —— v3 train.json 是**扁平键值**（spec §5.3：`{ area: "逆合成", ref_fp: "...", has_error: null }`），不含 task_progress 概念
- workflow-data-watcher 监听 `.ccweb/workflow_data.json`，路径与 v3 `.ccweb/tracks/<basename>.train.json` 不同
- v3 runtime 自己写 prompt-translator + llm-dispatcher，protocol 更直接

**保留复用**：
- terminal-manager（项目级 PTY 管理）— 通过现有 `terminalManager.injectText(projectId, text)` API 注入 prompt
- backend/src/index.ts 的 `broadcastJson(projectId, message)` — WS 事件广播

### B. M2 范围（spec §16 M2a + M2b 合并）

**含**：
- prompt-translator (spec §7)
- if-expr parser + evaluator (spec §5.4，含 null 安全语义)
- train-json-sync（原子写 + flush 等待 + 白名单过滤）
- llm-dispatcher（prompt 注入 + 等待 train.json 变化）
- flow-runtime state machine (spec §9)
- run-registry（多 run 注册表 + 锁 + 409 拒绝）
- 三道防线（节点 iter / 总 LLM 调用 / 总时长，spec §9.5）
- 变量变更审计 log (spec §8.4)
- daemon 重启清理 (spec §9.6)
- WS 事件（spec §10）
- 路由扩展：POST run / POST cancel / POST user_input / GET runs/active
- 前端 useFlowRun hook + FlowRunPanel + 节点状态边框 + user_input 运行时弹窗

**不含**（M3 / M4）：
- 子流程 / 并行 / 节点 retry policy / 超时（spec §18）
- if expr `.length` / 字段访问扩展（M1 仅基础语法）
- M4：verify-flow-v3 E2E + 浏览器手测 + 发版（推迟到本 plan 最后 Task 集中跑 + 发 v-19-a）

### C. 关键文件清单

**新建 backend** (`backend/src/track-flow/`)：

```
prompt-translator.ts          spec §7 转译规则 + 系统指令段
if-expr-parser.ts             spec §5.4 受限语法 parser
if-expr-evaluator.ts          求值（含 null 安全）
train-json-sync.ts            原子写 + reload 等待 + 白名单过滤
flow-train-watcher.ts         监听 .ccweb/tracks/<basename>.train.json 变更
llm-dispatcher.ts             prompt 注入 + 等待写入
audit-log.ts                  .flow.runs/<runId>.log.jsonl 审计
run-registry.ts               run 注册表 + 锁 + 三道防线 + daemon 重启清理
runtime.ts                    state machine
```

**新建 backend 测试**：

```
backend/src/track-flow/__tests__/prompt-translator.test.ts
backend/src/track-flow/__tests__/if-expr-parser.test.ts
backend/src/track-flow/__tests__/if-expr-evaluator.test.ts
backend/src/track-flow/__tests__/train-json-sync.test.ts
backend/src/track-flow/__tests__/run-registry.test.ts
backend/src/track-flow/__tests__/verify-flow-v3.ts   E2E smoke（tsx + mock injector）
```

**修改 backend**：

```
backend/src/routes/track-flows.ts      加 POST run / POST cancel / POST user_input / GET runs/active
backend/src/index.ts                   import + 启动时调 cleanupStaleCwdFiles
backend/src/track-flow/index.ts        加新模块 exports
```

**新建 frontend**：

```
frontend/src/components/tracks/flow/useFlowRun.ts           WS 事件订阅 hook
frontend/src/components/tracks/flow/FlowRunPanel.tsx        运行时面板（变量值 + 节点状态 + quota）
frontend/src/components/tracks/flow/FlowUserInputDialog.tsx  user_input 节点运行时弹窗
```

**修改 frontend**：

```
frontend/src/components/tracks/flow/FlowToolbar.tsx        加运行/取消按钮 + saveError 显示
frontend/src/components/tracks/flow/nodes/UserInputNode.tsx  支持 runtime 状态边框（黄 pulse / 绿 ✓ / 红 ✗ / 灰划线）
frontend/src/components/tracks/flow/nodes/LLMNode.tsx       同上
frontend/src/components/tracks/flow/nodes/IfNode.tsx        同上
frontend/src/components/tracks/flow/TrackFlowEditor.tsx     集成 useFlowRun + FlowRunPanel
frontend/src/components/tracks/api.ts                       加 runFlow / cancelFlow / submitUserInput
```

---

## Task 1：prompt-translator + TDD

**Files:**
- Create: `backend/src/track-flow/prompt-translator.ts`
- Create: `backend/src/track-flow/__tests__/prompt-translator.test.ts`

按 spec §7 / §7.2 / §7.3 实现转译：`@{key}` / `${key}` → `key(description)='value'` / 修改变量指令，末尾加系统指令段。

- [ ] **Step 1：写失败测试**

```typescript
// backend/src/track-flow/__tests__/prompt-translator.test.ts
import { describe, it, expect } from 'vitest'
import { translatePrompt } from '../prompt-translator'

interface VarDecl {
  key: string
  description: string
  initialValue: unknown
}

describe('translatePrompt', () => {
  const vars: VarDecl[] = [
    { key: 'area', description: '研究领域', initialValue: null },
    { key: 'ref_fp', description: '文献存储 bibtex 格式文件的路径', initialValue: null },
    { key: 'has_error', description: '文献存在错误', initialValue: null },
  ]

  it('替换 @{key} 为 key(description)=\'value\'', () => {
    const r = translatePrompt('请调研@{area}', vars, { area: '逆合成' }, [])
    expect(r).toContain("area(研究领域)='逆合成'")
  })

  it('null 值显示为 null（不带引号）', () => {
    const r = translatePrompt('@{area}', vars, { area: null }, [])
    expect(r).toContain('area(研究领域)=null')
  })

  it('替换 ${key} 为修改变量指令', () => {
    const r = translatePrompt('修改 ${has_error}', vars, { has_error: null }, ['has_error'])
    expect(r).toContain('修改变量 has_error(文献存在错误;记录路径为 train.json 中的 key:has_error)=null 为...')
  })

  it('outputs 非空时追加系统指令段', () => {
    const r = translatePrompt('做点啥 ${has_error}', vars, { has_error: null }, ['has_error'])
    expect(r).toContain('【系统指令】')
    expect(r).toContain('train.json')
    expect(r).toContain('has_error')
  })

  it('outputs 为空时不追加系统指令段', () => {
    const r = translatePrompt('单纯咨询 @{area}', vars, { area: '逆合成' }, [])
    expect(r).not.toContain('【系统指令】')
  })

  it('未声明的 key 保留字面（不替换）', () => {
    const r = translatePrompt('@{未知}', vars, {}, [])
    expect(r).toContain('@{未知}')
  })

  it('完整研究循环 prompt（spec 例子）', () => {
    const tpl = '请检查@{ref_fp}中的论文，相关性 @{area}，结果 ${has_error}'
    const r = translatePrompt(tpl, vars, { area: '逆合成', ref_fp: './test.bibtex', has_error: null }, ['has_error'])
    expect(r).toContain("ref_fp(文献存储 bibtex 格式文件的路径)='./test.bibtex'")
    expect(r).toContain("area(研究领域)='逆合成'")
    expect(r).toContain('修改变量 has_error(文献存在错误;')
    expect(r).toContain('【系统指令】')
  })

  it('数字值不加引号', () => {
    const r = translatePrompt('@{n}', [{ key: 'n', description: '次数', initialValue: 0 }], { n: 42 }, [])
    expect(r).toContain('n(次数)=42')
    expect(r).not.toContain("n(次数)='42'")
  })

  it('boolean 值', () => {
    const r = translatePrompt('@{f}', [{ key: 'f', description: '标志', initialValue: false }], { f: true }, [])
    expect(r).toContain('f(标志)=true')
  })

  it('object/array 值用 JSON.stringify', () => {
    const r = translatePrompt('@{x}', [{ key: 'x', description: '数据', initialValue: null }], { x: { a: 1 } }, [])
    expect(r).toContain('x(数据)=\'{"a":1}\'')
  })
})
```

- [ ] **Step 2：跑失败**

```bash
cd /Users/tom/Projects/cc-web/backend
npx vitest run src/track-flow/__tests__/prompt-translator.test.ts
```

预期：模块不存在，FAIL。注意：backend 现在无 vitest，可能要装。检查：

```bash
grep -E "vitest|@vitest" /Users/tom/Projects/cc-web/backend/package.json
```

如果没装，加：

```bash
cd /Users/tom/Projects/cc-web/backend
npm install --include=dev --save-dev vitest@^1 @vitest/ui@^1
```

并在 `backend/package.json` scripts 加：

```json
"test:flow": "vitest run src/track-flow",
"test": "vitest"
```

- [ ] **Step 3：实现 prompt-translator.ts**

```typescript
// backend/src/track-flow/prompt-translator.ts

export interface VarDecl {
  key: string
  description: string
  initialValue: unknown
}

/**
 * Format a value for embedding inside a translated prompt.
 *  - null/undefined → `null`
 *  - string → `'<value>'`（用单引号，转义内部 \' 和 \\）
 *  - number / bool → 字面量无引号
 *  - object/array → JSON.stringify 后用单引号包
 */
function formatValue(v: unknown): string {
  if (v === null || v === undefined) return 'null'
  if (typeof v === 'string') return `'${v.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`
  if (typeof v === 'number' || typeof v === 'boolean') return String(v)
  return `'${JSON.stringify(v).replace(/'/g, "\\'")}'`
}

/**
 * Translate a prompt template by replacing @{key} (input) and ${key}
 * (output) placeholders with descriptive metadata, then optionally append
 * a system instruction section telling the LLM to modify train.json.
 *
 * spec §7：
 *  - @{key} → `key(description)='<value>'`
 *  - ${key} → `修改变量 key(description;记录路径为 train.json 中的 key:key)=<value> 为...`
 *  - 末尾系统指令段（仅 outputs 非空时）：
 *      【系统指令】
 *      本工作轨的全局变量记录在当前目录的 train.json 文件中。
 *      本节点完成时，请用 Edit/Write 工具修改 train.json 文件，
 *      更新以下字段：<outputs join ", ">
 *      （其他字段不要改）。完成修改后告知"已写入"。
 *
 * Unknown keys (not in `variables`) are preserved literally to aid debugging.
 */
export function translatePrompt(
  template: string,
  variables: VarDecl[],
  snapshot: Record<string, unknown>,
  outputs: string[],
): string {
  const byKey = new Map<string, VarDecl>(variables.map((v) => [v.key, v]))

  let result = template.replace(/@\{(\w+)\}/g, (_m, key: string) => {
    const decl = byKey.get(key)
    if (!decl) return `@{${key}}`
    return `${key}(${decl.description})=${formatValue(snapshot[key] ?? null)}`
  })

  result = result.replace(/\$\{(\w+)\}/g, (_m, key: string) => {
    const decl = byKey.get(key)
    if (!decl) return `\${${key}}`
    return `修改变量 ${key}(${decl.description};记录路径为 train.json 中的 key:${key})=${formatValue(snapshot[key] ?? null)} 为...`
  })

  if (outputs.length > 0) {
    result += '\n\n' + buildSystemInstruction(outputs)
  }
  return result
}

function buildSystemInstruction(outputs: string[]): string {
  return [
    '【系统指令】',
    '本工作轨的全局变量记录在当前目录的 train.json 文件中。',
    '本节点完成时，请用 Edit/Write 工具修改 train.json 文件，',
    `更新以下字段：${outputs.join(', ')}`,
    '（其他字段不要改）。完成修改后告知"已写入"。',
  ].join('\n')
}
```

- [ ] **Step 4：跑测试通过**

```bash
npx vitest run src/track-flow/__tests__/prompt-translator.test.ts
```

预期：10/10 PASS。

- [ ] **Step 5：Commit**

```bash
cd /Users/tom/Projects/cc-web
git add backend/src/track-flow/prompt-translator.ts \
  backend/src/track-flow/__tests__/prompt-translator.test.ts \
  backend/package.json backend/package-lock.json
git commit -m "feat(track-flow): prompt-translator — @/\$ → metadata + system instruction"
```

**commit 无 Claude 署名**。

---

## Task 2：if-expr-parser + TDD

**Files:**
- Create: `backend/src/track-flow/if-expr-parser.ts`
- Create: `backend/src/track-flow/__tests__/if-expr-parser.test.ts`

按 spec §5.4 受限语法实现 parser。返回 AST。

- [ ] **Step 1：写失败测试**

```typescript
// backend/src/track-flow/__tests__/if-expr-parser.test.ts
import { describe, it, expect } from 'vitest'
import { parseIfExpr } from '../if-expr-parser'

describe('parseIfExpr', () => {
  it('字面量 true', () => {
    const ast = parseIfExpr('true')
    expect(ast).toEqual({ kind: 'literal', value: true })
  })

  it('字面量 false / null', () => {
    expect(parseIfExpr('false')).toEqual({ kind: 'literal', value: false })
    expect(parseIfExpr('null')).toEqual({ kind: 'literal', value: null })
  })

  it('字面量整数', () => {
    expect(parseIfExpr('42')).toEqual({ kind: 'literal', value: 42 })
  })

  it('字面量负数', () => {
    expect(parseIfExpr('-3')).toEqual({ kind: 'literal', value: -3 })
  })

  it('字面量字符串', () => {
    expect(parseIfExpr('"hello"')).toEqual({ kind: 'literal', value: 'hello' })
  })

  it('变量引用', () => {
    expect(parseIfExpr('has_error')).toEqual({ kind: 'var', name: 'has_error' })
  })

  it('等号比较', () => {
    const ast = parseIfExpr('has_error == true')
    expect(ast).toEqual({
      kind: 'compare', op: '==',
      left: { kind: 'var', name: 'has_error' },
      right: { kind: 'literal', value: true },
    })
  })

  it('大于', () => {
    const ast = parseIfExpr('count > 5')
    expect(ast).toEqual({
      kind: 'compare', op: '>',
      left: { kind: 'var', name: 'count' },
      right: { kind: 'literal', value: 5 },
    })
  })

  it('AND 短路', () => {
    const ast = parseIfExpr('a && b')
    expect(ast).toEqual({
      kind: 'and',
      left: { kind: 'var', name: 'a' },
      right: { kind: 'var', name: 'b' },
    })
  })

  it('OR 短路', () => {
    const ast = parseIfExpr('a || b')
    expect(ast).toEqual({
      kind: 'or',
      left: { kind: 'var', name: 'a' },
      right: { kind: 'var', name: 'b' },
    })
  })

  it('括号优先级', () => {
    const ast = parseIfExpr('(a == 1) && (b > 2)')
    expect(ast.kind).toBe('and')
  })

  it('AND 优先级高于 OR（左结合）', () => {
    // 实际：a || b && c 解析为 a || (b && c) 才更符合标准；但 spec §5.4 简化为左结合从左到右
    // M1: && 和 || 同优先级，左结合。a && b || c = ((a && b) || c)
    const ast = parseIfExpr('a && b || c')
    expect(ast.kind).toBe('or')
  })

  it('非法 token 抛错', () => {
    expect(() => parseIfExpr('a + b')).toThrow()  // 不支持算术
    expect(() => parseIfExpr('foo(1)')).toThrow() // 不支持函数调用
    expect(() => parseIfExpr('a.b')).toThrow()    // 不支持字段访问
    expect(() => parseIfExpr('')).toThrow()
    expect(() => parseIfExpr('==')).toThrow()
  })
})
```

- [ ] **Step 2：跑失败**

- [ ] **Step 3：实现 if-expr-parser.ts**

```typescript
// backend/src/track-flow/if-expr-parser.ts

/**
 * Restricted expression language for IfNode.conditionExpr (spec §5.4).
 *
 *   expr     := term (('&&'|'||') term)*       — left-associative, same priority
 *   term     := atom (('=='|'!='|'>'|'<'|'>='|'<=') atom)?
 *   atom     := varName | literal | '(' expr ')'
 *   literal  := number | string | 'true' | 'false' | 'null'
 *   varName  := [a-zA-Z_][a-zA-Z0-9_]*
 *
 * No function calls, no arithmetic, no field access — kept tiny so it can
 * be evaluated safely without eval().
 */

export type IfExprAst =
  | { kind: 'literal'; value: number | string | boolean | null }
  | { kind: 'var'; name: string }
  | { kind: 'compare'; op: '=='|'!='|'>'|'<'|'>='|'<='; left: IfExprAst; right: IfExprAst }
  | { kind: 'and'; left: IfExprAst; right: IfExprAst }
  | { kind: 'or'; left: IfExprAst; right: IfExprAst }

type Token =
  | { kind: 'num'; value: number }
  | { kind: 'str'; value: string }
  | { kind: 'kw'; value: 'true' | 'false' | 'null' }
  | { kind: 'ident'; value: string }
  | { kind: 'op'; value: '==' | '!=' | '>' | '<' | '>=' | '<=' | '&&' | '||' }
  | { kind: 'punc'; value: '(' | ')' }

function tokenize(src: string): Token[] {
  const tokens: Token[] = []
  let i = 0
  while (i < src.length) {
    const c = src[i]!
    if (/\s/.test(c)) { i++; continue }
    // 字符串
    if (c === '"') {
      const end = src.indexOf('"', i + 1)
      if (end === -1) throw new Error(`unterminated string at position ${i}`)
      tokens.push({ kind: 'str', value: src.slice(i + 1, end) })
      i = end + 1
      continue
    }
    // 数字（含可选 -）
    if (/[0-9]/.test(c) || (c === '-' && /[0-9]/.test(src[i + 1] ?? ''))) {
      let j = i + (c === '-' ? 1 : 0)
      while (j < src.length && /[0-9.]/.test(src[j]!)) j++
      const numStr = src.slice(i, j)
      const num = Number(numStr)
      if (Number.isNaN(num)) throw new Error(`invalid number "${numStr}"`)
      tokens.push({ kind: 'num', value: num })
      i = j
      continue
    }
    // 标识符 / 关键字
    if (/[a-zA-Z_]/.test(c)) {
      let j = i
      while (j < src.length && /[a-zA-Z0-9_]/.test(src[j]!)) j++
      const word = src.slice(i, j)
      if (word === 'true' || word === 'false' || word === 'null') {
        tokens.push({ kind: 'kw', value: word })
      } else {
        tokens.push({ kind: 'ident', value: word })
      }
      i = j
      continue
    }
    // 运算符
    const two = src.slice(i, i + 2)
    if (['==', '!=', '>=', '<=', '&&', '||'].includes(two)) {
      tokens.push({ kind: 'op', value: two as '==' })
      i += 2
      continue
    }
    if (c === '>' || c === '<') {
      tokens.push({ kind: 'op', value: c })
      i += 1
      continue
    }
    if (c === '(' || c === ')') {
      tokens.push({ kind: 'punc', value: c })
      i += 1
      continue
    }
    throw new Error(`unexpected character '${c}' at position ${i}`)
  }
  return tokens
}

class Parser {
  private pos = 0
  constructor(private tokens: Token[]) {}

  parseExpr(): IfExprAst {
    let left = this.parseTerm()
    while (this.peek('op', '&&') || this.peek('op', '||')) {
      const op = (this.tokens[this.pos] as { value: string }).value as '&&' | '||'
      this.pos++
      const right = this.parseTerm()
      left = op === '&&'
        ? { kind: 'and', left, right }
        : { kind: 'or', left, right }
    }
    return left
  }

  private parseTerm(): IfExprAst {
    const left = this.parseAtom()
    const op = this.peekOp(['==', '!=', '>', '<', '>=', '<='])
    if (op) {
      this.pos++
      const right = this.parseAtom()
      return { kind: 'compare', op, left, right }
    }
    return left
  }

  private parseAtom(): IfExprAst {
    const t = this.tokens[this.pos]
    if (!t) throw new Error('unexpected end of input')
    if (t.kind === 'num') { this.pos++; return { kind: 'literal', value: t.value } }
    if (t.kind === 'str') { this.pos++; return { kind: 'literal', value: t.value } }
    if (t.kind === 'kw') {
      this.pos++
      const v = t.value === 'true' ? true : t.value === 'false' ? false : null
      return { kind: 'literal', value: v }
    }
    if (t.kind === 'ident') { this.pos++; return { kind: 'var', name: t.value } }
    if (t.kind === 'punc' && t.value === '(') {
      this.pos++
      const inner = this.parseExpr()
      const close = this.tokens[this.pos]
      if (!close || close.kind !== 'punc' || close.value !== ')') {
        throw new Error('missing closing paren')
      }
      this.pos++
      return inner
    }
    throw new Error(`unexpected token ${JSON.stringify(t)}`)
  }

  private peek(kind: Token['kind'], value?: string): boolean {
    const t = this.tokens[this.pos]
    if (!t) return false
    if (t.kind !== kind) return false
    if (value !== undefined && (t as { value: string }).value !== value) return false
    return true
  }

  private peekOp(ops: string[]): '==' | '!=' | '>' | '<' | '>=' | '<=' | null {
    const t = this.tokens[this.pos]
    if (!t || t.kind !== 'op') return null
    if (!ops.includes(t.value)) return null
    return t.value as '==' | '!=' | '>' | '<' | '>=' | '<='
  }

  ensureFullyConsumed(): void {
    if (this.pos < this.tokens.length) {
      throw new Error(`extra tokens after parse: ${JSON.stringify(this.tokens[this.pos])}`)
    }
  }
}

export function parseIfExpr(src: string): IfExprAst {
  const tokens = tokenize(src)
  if (tokens.length === 0) throw new Error('empty expression')
  const parser = new Parser(tokens)
  const ast = parser.parseExpr()
  parser.ensureFullyConsumed()
  return ast
}
```

- [ ] **Step 4：跑测试通过**

```bash
npx vitest run src/track-flow/__tests__/if-expr-parser.test.ts
```

预期：13/13 PASS。

- [ ] **Step 5：Commit**

```bash
git add backend/src/track-flow/if-expr-parser.ts \
  backend/src/track-flow/__tests__/if-expr-parser.test.ts
git commit -m "feat(track-flow): if-expr-parser — restricted DSL (literals/vars/compare/&&||)"
```

---

## Task 3：if-expr-evaluator + null 安全语义 + TDD

**Files:**
- Create: `backend/src/track-flow/if-expr-evaluator.ts`
- Create: `backend/src/track-flow/__tests__/if-expr-evaluator.test.ts`

按 spec §5.4 null 安全语义实现求值。

- [ ] **Step 1：写失败测试**

```typescript
// backend/src/track-flow/__tests__/if-expr-evaluator.test.ts
import { describe, it, expect } from 'vitest'
import { evaluateIfExpr } from '../if-expr-evaluator'
import { parseIfExpr } from '../if-expr-parser'

function evalStr(src: string, scope: Record<string, unknown>): boolean {
  return evaluateIfExpr(parseIfExpr(src), scope)
}

describe('evaluateIfExpr', () => {
  it('字面量 true / false', () => {
    expect(evalStr('true', {})).toBe(true)
    expect(evalStr('false', {})).toBe(false)
  })

  it('变量为 true', () => {
    expect(evalStr('x', { x: true })).toBe(true)
    expect(evalStr('x', { x: false })).toBe(false)
  })

  it('未定义变量当 null 处理', () => {
    expect(evalStr('x == null', {})).toBe(true)
    expect(evalStr('x == true', {})).toBe(false)
  })

  it('null 安全比较：x == null / null == null', () => {
    expect(evalStr('x == null', { x: null })).toBe(true)
    expect(evalStr('x != null', { x: 5 })).toBe(true)
  })

  it('null 与非 null 比较返 false（不抛错）', () => {
    expect(evalStr('x == true', { x: null })).toBe(false)
    expect(evalStr('x > 5', { x: null })).toBe(false)
    expect(evalStr('x < 5', { x: null })).toBe(false)
  })

  it('类型不匹配返 false（不抛错）', () => {
    expect(evalStr('"abc" > 5', {})).toBe(false)
    expect(evalStr('true == 1', {})).toBe(false)
  })

  it('数字比较', () => {
    expect(evalStr('x > 5', { x: 10 })).toBe(true)
    expect(evalStr('x > 5', { x: 3 })).toBe(false)
    expect(evalStr('x >= 5', { x: 5 })).toBe(true)
    expect(evalStr('x <= 5', { x: 5 })).toBe(true)
  })

  it('字符串相等', () => {
    expect(evalStr('s == "hello"', { s: 'hello' })).toBe(true)
    expect(evalStr('s == "world"', { s: 'hello' })).toBe(false)
  })

  it('AND 短路', () => {
    expect(evalStr('true && true', {})).toBe(true)
    expect(evalStr('true && false', {})).toBe(false)
    expect(evalStr('false && true', {})).toBe(false)
  })

  it('null && x → false（null 视为 falsy）', () => {
    expect(evalStr('x && true', { x: null })).toBe(false)
  })

  it('OR 短路 + null || x', () => {
    expect(evalStr('false || true', {})).toBe(true)
    // spec §5.4: null || x → 视 null 为 falsy，返 x（如果 x truthy 才返 true）
    expect(evalStr('x || true', { x: null })).toBe(true)
    expect(evalStr('x || false', { x: null })).toBe(false)
  })

  it('用户例子：has_error == true（null 时返 false 走 else 分支）', () => {
    expect(evalStr('has_error == true', { has_error: null })).toBe(false)
    expect(evalStr('has_error == true', { has_error: true })).toBe(true)
    expect(evalStr('has_error == true', { has_error: false })).toBe(false)
  })
})
```

- [ ] **Step 2：跑失败**

- [ ] **Step 3：实现 if-expr-evaluator.ts**

```typescript
// backend/src/track-flow/if-expr-evaluator.ts
import type { IfExprAst } from './if-expr-parser'

/**
 * Evaluate an IfExprAst against a runtime scope (train.json snapshot).
 * Returns boolean. Designed to NEVER throw — spec §5.4 null-safe semantics:
 *
 *  - `x == null` / `null == x` / `x != null` / `null != x` → strict === / !==
 *  - 其他与 null 比较（如 `x == 5` 当 x=null）→ false（不报错）
 *  - 关系算子两边任一为 null → false
 *  - 类型不匹配（如 `"abc" > 5`）→ false
 *  - && / || 短路：null 视为 falsy
 *  - 未定义变量 = null
 */
export function evaluateIfExpr(ast: IfExprAst, scope: Record<string, unknown>): boolean {
  return !!evaluateValue(ast, scope)
}

/** Returns the raw value of the expression (used internally for short-circuit). */
function evaluateValue(ast: IfExprAst, scope: Record<string, unknown>): unknown {
  if (ast.kind === 'literal') return ast.value
  if (ast.kind === 'var') return scope[ast.name] ?? null
  if (ast.kind === 'and') {
    const lv = evaluateValue(ast.left, scope)
    if (!isTruthy(lv)) return false
    const rv = evaluateValue(ast.right, scope)
    return isTruthy(rv)
  }
  if (ast.kind === 'or') {
    const lv = evaluateValue(ast.left, scope)
    if (isTruthy(lv)) return true
    const rv = evaluateValue(ast.right, scope)
    return isTruthy(rv)
  }
  // compare
  const left = evaluateValue(ast.left, scope)
  const right = evaluateValue(ast.right, scope)
  const op = ast.op

  // null-safe equality
  if (op === '==') return left === right
  if (op === '!=') return left !== right

  // relational ops: 任一边为 null → false
  if (left === null || right === null) return false

  // 类型匹配才比较
  if (typeof left === 'number' && typeof right === 'number') {
    if (op === '>') return left > right
    if (op === '<') return left < right
    if (op === '>=') return left >= right
    if (op === '<=') return left <= right
  }
  // 字符串：仅 == / != 处理过；> / < 不支持 → false
  return false
}

function isTruthy(v: unknown): boolean {
  if (v === null || v === undefined) return false
  if (v === false || v === 0 || v === '') return false
  return true
}
```

- [ ] **Step 4：跑测试通过**

```bash
npx vitest run src/track-flow/__tests__/if-expr-evaluator.test.ts
```

预期：12/12 PASS。

- [ ] **Step 5：Commit**

```bash
git add backend/src/track-flow/if-expr-evaluator.ts \
  backend/src/track-flow/__tests__/if-expr-evaluator.test.ts
git commit -m "feat(track-flow): if-expr-evaluator — null-safe semantics (no throws)"
```

---

## Task 4：train-json-sync（原子写 + flush 等待 + 白名单过滤）+ TDD

**Files:**
- Create: `backend/src/track-flow/train-json-sync.ts`
- Create: `backend/src/track-flow/__tests__/train-json-sync.test.ts`

按 spec §8.2 原子写策略 + 200ms/500ms 两次等待 + 白名单过滤。

- [ ] **Step 1：写失败测试**

```typescript
// backend/src/track-flow/__tests__/train-json-sync.test.ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import {
  copyToProjectCwd, reloadFromProjectCwd, cleanupProjectCwd,
  filterByWhitelist,
} from '../train-json-sync'

let testDir: string
beforeEach(() => {
  testDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sync-test-'))
})
afterEach(() => {
  fs.rmSync(testDir, { recursive: true, force: true })
})

describe('train-json-sync', () => {
  it('copyToProjectCwd 原子写 train.json + workflow_data.json', () => {
    const snapshot = { a: 1, b: 'hello' }
    const ok = copyToProjectCwd(testDir, snapshot)
    expect(ok).toBe(true)
    const trainJson = JSON.parse(fs.readFileSync(path.join(testDir, 'train.json'), 'utf8'))
    const wfd = JSON.parse(fs.readFileSync(path.join(testDir, 'workflow_data.json'), 'utf8'))
    expect(trainJson).toEqual(snapshot)
    expect(wfd).toEqual(snapshot)
  })

  it('reloadFromProjectCwd 读现有 train.json', async () => {
    fs.writeFileSync(path.join(testDir, 'train.json'), JSON.stringify({ x: 42 }), 'utf8')
    const r = await reloadFromProjectCwd(testDir)
    expect(r.ok).toBe(true)
    expect(r.data).toEqual({ x: 42 })
  })

  it('reloadFromProjectCwd 找不到文件返 ok=false', async () => {
    const r = await reloadFromProjectCwd(testDir)
    expect(r.ok).toBe(false)
  })

  it('reloadFromProjectCwd 非法 JSON：重试一次后报错', async () => {
    fs.writeFileSync(path.join(testDir, 'train.json'), 'not json', 'utf8')
    const r = await reloadFromProjectCwd(testDir)
    expect(r.ok).toBe(false)
    expect(r.error).toMatch(/JSON|parse/)
  })

  it('cleanupProjectCwd 删除 train.json + workflow_data.json', () => {
    fs.writeFileSync(path.join(testDir, 'train.json'), '{}', 'utf8')
    fs.writeFileSync(path.join(testDir, 'workflow_data.json'), '{}', 'utf8')
    cleanupProjectCwd(testDir)
    expect(fs.existsSync(path.join(testDir, 'train.json'))).toBe(false)
    expect(fs.existsSync(path.join(testDir, 'workflow_data.json'))).toBe(false)
  })

  it('cleanupProjectCwd 文件不存在不报错', () => {
    expect(() => cleanupProjectCwd(testDir)).not.toThrow()
  })

  it('filterByWhitelist 仅保留声明 key', () => {
    const r = filterByWhitelist({ a: 1, b: 2, ghost: 3 }, ['a', 'b'])
    expect(r).toEqual({ a: 1, b: 2 })
  })

  it('filterByWhitelist 缺字段填 null', () => {
    const r = filterByWhitelist({ a: 1 }, ['a', 'b'])
    expect(r).toEqual({ a: 1, b: null })
  })
})
```

- [ ] **Step 2：跑失败**

- [ ] **Step 3：实现 train-json-sync.ts**

```typescript
// backend/src/track-flow/train-json-sync.ts
import * as fs from 'fs'
import * as path from 'path'

const TRAIN_JSON_NAME = 'train.json'
const WORKFLOW_DATA_NAME = 'workflow_data.json'  // legacy alias for adapter compat

/**
 * Atomic write: write to .tmp.<pid>.<ts> then rename to target.
 * Returns true on success, false on any IO error.
 */
function atomicWriteJson(target: string, value: unknown): boolean {
  try {
    fs.mkdirSync(path.dirname(target), { recursive: true })
    const tmp = `${target}.tmp.${process.pid}.${Date.now()}`
    fs.writeFileSync(tmp, JSON.stringify(value, null, 2), 'utf8')
    fs.renameSync(tmp, target)
    return true
  } catch {
    return false
  }
}

/**
 * Copy a snapshot to the project cwd as both `train.json` (v3 canonical)
 * and `workflow_data.json` (legacy alias for adapter compat).
 */
export function copyToProjectCwd(
  projectFolder: string,
  snapshot: Record<string, unknown>,
): boolean {
  const ok1 = atomicWriteJson(path.join(projectFolder, TRAIN_JSON_NAME), snapshot)
  const ok2 = atomicWriteJson(path.join(projectFolder, WORKFLOW_DATA_NAME), snapshot)
  return ok1 && ok2
}

export interface ReloadResult {
  ok: boolean
  data?: Record<string, unknown>
  error?: string
}

/**
 * Reload train.json after LLM call. Wait 200ms for OS buffer flush, then
 * try parsing. On failure (e.g. half-written file), wait another 500ms
 * and retry once.
 *
 * spec §8.2.
 */
export async function reloadFromProjectCwd(projectFolder: string): Promise<ReloadResult> {
  const target = path.join(projectFolder, TRAIN_JSON_NAME)
  await sleep(200)
  const attempt = tryReadJson(target)
  if (attempt.ok) return attempt
  await sleep(500)
  return tryReadJson(target)
}

function tryReadJson(target: string): ReloadResult {
  try {
    if (!fs.existsSync(target)) return { ok: false, error: 'train.json not found' }
    const raw = fs.readFileSync(target, 'utf8')
    const parsed = JSON.parse(raw)
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
      return { ok: false, error: 'train.json must be an object' }
    }
    return { ok: true, data: parsed as Record<string, unknown> }
  } catch (e) {
    return { ok: false, error: `JSON parse failed: ${(e as Error).message}` }
  }
}

/**
 * Delete cwd train.json + workflow_data.json. Idempotent.
 */
export function cleanupProjectCwd(projectFolder: string): void {
  for (const name of [TRAIN_JSON_NAME, WORKFLOW_DATA_NAME]) {
    try {
      fs.unlinkSync(path.join(projectFolder, name))
    } catch {
      /* ignore */
    }
  }
}

/**
 * Filter a possibly LLM-mutated train.json content by the declared
 * whitelist of variable keys. Missing keys are filled with null.
 * Extra (non-whitelist) keys are discarded.
 *
 * spec §6.2 step 7 / §8.2.
 */
export function filterByWhitelist(
  data: Record<string, unknown>,
  whitelist: string[],
): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const key of whitelist) {
    out[key] = key in data ? data[key] : null
  }
  return out
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}
```

- [ ] **Step 4：跑测试通过**

```bash
npx vitest run src/track-flow/__tests__/train-json-sync.test.ts
```

预期：8/8 PASS。注意：test 中 reload 路径会真 sleep 200/500ms，整个 test 跑时长 1-2s 是正常的。

- [ ] **Step 5：Commit**

```bash
git add backend/src/track-flow/train-json-sync.ts \
  backend/src/track-flow/__tests__/train-json-sync.test.ts
git commit -m "feat(track-flow): train-json-sync — atomic write + flush wait + whitelist filter"
```

---

## Task 5：audit-log + run-registry + 三道防线

**Files:**
- Create: `backend/src/track-flow/audit-log.ts`
- Create: `backend/src/track-flow/run-registry.ts`
- Create: `backend/src/track-flow/__tests__/run-registry.test.ts`

run-registry 含：注册表 / 锁 / 409 拒绝 / 三道防线 / daemon 启动清理（spec §8.3 / §9.5 / §9.6 / §8.4）

- [ ] **Step 1：实现 audit-log.ts**

```typescript
// backend/src/track-flow/audit-log.ts
import * as fs from 'fs'
import * as path from 'path'

/**
 * Append a JSONL line to `.ccweb/tracks/<basename>.flow.runs/<runId>.log.jsonl`.
 * Each line records a runtime event (spec §8.4).
 *
 * Events: node_active / node_completed / node_failed / node_skipped /
 *         user_input / cancelled / done / var_changed.
 */
export interface AuditEvent {
  ts: number                              // unix ms
  type: string
  nodeId?: string
  iter?: number
  varsDiff?: { key: string; old: unknown; new: unknown }[]
  message?: string
  extra?: Record<string, unknown>
}

function logDir(projectFolder: string, basename: string): string {
  return path.join(projectFolder, '.ccweb', 'tracks', `${basename}.flow.runs`)
}

function logPath(projectFolder: string, basename: string, runId: string): string {
  return path.join(logDir(projectFolder, basename), `${runId}.log.jsonl`)
}

export function appendAudit(
  projectFolder: string,
  basename: string,
  runId: string,
  event: AuditEvent,
): void {
  try {
    const dir = logDir(projectFolder, basename)
    fs.mkdirSync(dir, { recursive: true })
    const line = JSON.stringify(event) + '\n'
    fs.appendFileSync(logPath(projectFolder, basename, runId), line, 'utf8')
  } catch {
    /* swallow — audit is best-effort */
  }
}
```

- [ ] **Step 2：实现 run-registry.ts**

```typescript
// backend/src/track-flow/run-registry.ts
import { cleanupProjectCwd } from './train-json-sync'

export type RunStatus = 'pending' | 'running' | 'waiting_user_input' | 'completed' | 'failed' | 'cancelled'

export interface RunQuota {
  maxIterPerNode: number       // default 50
  maxLlmCalls: number          // default 100
  maxRunDurationMs: number     // default 2h
}

export interface RunInfo {
  runId: string
  projectId: string
  basename: string
  status: RunStatus
  startedAt: number            // unix ms
  quota: RunQuota
  iterCounts: Map<string, number>
  llmCallsCount: number
  cancelAbortController: AbortController
  error?: { nodeId?: string; message: string }
  pendingUserInput?: { nodeId: string; fields: { varKey: string; description: string; uiHint?: string }[] }
}

const DEFAULT_QUOTA: RunQuota = {
  maxIterPerNode: 50,
  maxLlmCalls: 100,
  maxRunDurationMs: 2 * 60 * 60 * 1000,
}

/**
 * In-memory registry of active flow runs.
 *
 * Lock semantics（spec §8.3）：同一 (projectId, basename) 同时只允许 1 个 active run。
 * 重复 register 抛 FLOW_ALREADY_RUNNING（路由层映射为 409）。
 */
export class FlowRunRegistry {
  private byRunId = new Map<string, RunInfo>()
  private activeByPath = new Map<string, string>()  // `${projectId}::${basename}` → runId

  start(opts: {
    runId: string
    projectId: string
    basename: string
    quotaOverride?: Partial<RunQuota>
  }): RunInfo {
    const key = pathKey(opts.projectId, opts.basename)
    const existing = this.activeByPath.get(key)
    if (existing) {
      const err = new Error(`FLOW_ALREADY_RUNNING`)
      ;(err as Error & { existingRunId?: string }).existingRunId = existing
      throw err
    }
    const info: RunInfo = {
      runId: opts.runId,
      projectId: opts.projectId,
      basename: opts.basename,
      status: 'pending',
      startedAt: Date.now(),
      quota: { ...DEFAULT_QUOTA, ...(opts.quotaOverride ?? {}) },
      iterCounts: new Map(),
      llmCallsCount: 0,
      cancelAbortController: new AbortController(),
    }
    this.byRunId.set(opts.runId, info)
    this.activeByPath.set(key, opts.runId)
    return info
  }

  get(runId: string): RunInfo | undefined {
    return this.byRunId.get(runId)
  }

  findActive(projectId: string, basename: string): RunInfo | undefined {
    const key = pathKey(projectId, basename)
    const runId = this.activeByPath.get(key)
    return runId ? this.byRunId.get(runId) : undefined
  }

  listActive(projectId: string): RunInfo[] {
    return [...this.byRunId.values()].filter((r) =>
      r.projectId === projectId &&
      (r.status === 'pending' || r.status === 'running' || r.status === 'waiting_user_input'),
    )
  }

  /**
   * Check & increment quotas. Returns null if all pass, or error message if exceeded.
   * 调用方在每节点循环开始前调一次。
   */
  checkQuotaForNode(runId: string, nodeId: string): string | null {
    const info = this.byRunId.get(runId)
    if (!info) return 'run not found'
    const newIter = (info.iterCounts.get(nodeId) ?? 0) + 1
    if (newIter > info.quota.maxIterPerNode) {
      return `node ${nodeId} exceeded maxIterPerNode (${info.quota.maxIterPerNode})`
    }
    info.iterCounts.set(nodeId, newIter)
    if (Date.now() - info.startedAt > info.quota.maxRunDurationMs) {
      return `run exceeded maxRunDurationMs (${info.quota.maxRunDurationMs}ms)`
    }
    return null
  }

  checkQuotaBeforeLlmCall(runId: string): string | null {
    const info = this.byRunId.get(runId)
    if (!info) return 'run not found'
    if (info.llmCallsCount + 1 > info.quota.maxLlmCalls) {
      return `run exceeded maxLlmCalls (${info.quota.maxLlmCalls})`
    }
    info.llmCallsCount += 1
    return null
  }

  /** Return remaining quotas for WS payload (spec §9.5 last bullet). */
  remainingQuota(runId: string, currentNodeId?: string): {
    iterRemaining?: number
    llmCallsRemaining: number
    durationRemainingMs: number
  } {
    const info = this.byRunId.get(runId)
    if (!info) return { llmCallsRemaining: 0, durationRemainingMs: 0 }
    const iterRemaining = currentNodeId !== undefined
      ? Math.max(0, info.quota.maxIterPerNode - (info.iterCounts.get(currentNodeId) ?? 0))
      : undefined
    return {
      iterRemaining,
      llmCallsRemaining: Math.max(0, info.quota.maxLlmCalls - info.llmCallsCount),
      durationRemainingMs: Math.max(0, info.quota.maxRunDurationMs - (Date.now() - info.startedAt)),
    }
  }

  updateStatus(runId: string, status: RunStatus, error?: RunInfo['error']): void {
    const info = this.byRunId.get(runId)
    if (!info) return
    info.status = status
    if (error) info.error = error
    if (status === 'completed' || status === 'failed' || status === 'cancelled') {
      this.activeByPath.delete(pathKey(info.projectId, info.basename))
    }
  }

  setPendingUserInput(runId: string, payload: RunInfo['pendingUserInput']): void {
    const info = this.byRunId.get(runId)
    if (info) info.pendingUserInput = payload
  }

  clearPendingUserInput(runId: string): void {
    const info = this.byRunId.get(runId)
    if (info) info.pendingUserInput = undefined
  }

  cancel(runId: string): boolean {
    const info = this.byRunId.get(runId)
    if (!info) return false
    info.cancelAbortController.abort()
    this.updateStatus(runId, 'cancelled')
    return true
  }
}

function pathKey(projectId: string, basename: string): string {
  return `${projectId}::${basename}`
}

/**
 * Singleton registry instance used by routes / runtime.
 */
export const flowRunRegistry = new FlowRunRegistry()

/**
 * Cleanup stale cwd train.json / workflow_data.json on daemon startup.
 * spec §9.6：daemon 重启检测到 cwd 文件存在视为"上次 run 异常中断"，删除。
 *
 * Pass a list of project folders to clean.
 */
export function cleanupStaleCwdFiles(projectFolders: string[]): void {
  for (const folder of projectFolders) {
    cleanupProjectCwd(folder)
  }
}
```

- [ ] **Step 3：写测试**

```typescript
// backend/src/track-flow/__tests__/run-registry.test.ts
import { describe, it, expect, beforeEach } from 'vitest'
import { FlowRunRegistry } from '../run-registry'

let r: FlowRunRegistry
beforeEach(() => { r = new FlowRunRegistry() })

describe('FlowRunRegistry', () => {
  it('start + get', () => {
    const info = r.start({ runId: 'run1', projectId: 'p1', basename: 'flow1' })
    expect(info.runId).toBe('run1')
    expect(r.get('run1')).toBe(info)
  })

  it('同 (project, basename) 重复 start → 抛 FLOW_ALREADY_RUNNING', () => {
    r.start({ runId: 'run1', projectId: 'p1', basename: 'flow1' })
    expect(() => r.start({ runId: 'run2', projectId: 'p1', basename: 'flow1' })).toThrow(/FLOW_ALREADY_RUNNING/)
  })

  it('不同 basename 可并发', () => {
    r.start({ runId: 'run1', projectId: 'p1', basename: 'flow1' })
    r.start({ runId: 'run2', projectId: 'p1', basename: 'flow2' })
    expect(r.listActive('p1')).toHaveLength(2)
  })

  it('cancel 释放 lock + 允许重启', () => {
    r.start({ runId: 'run1', projectId: 'p1', basename: 'flow1' })
    r.cancel('run1')
    r.start({ runId: 'run2', projectId: 'p1', basename: 'flow1' })  // 不抛
    expect(r.get('run2')).toBeDefined()
  })

  it('checkQuotaForNode 自增 + 超限报错', () => {
    r.start({ runId: 'run1', projectId: 'p1', basename: 'flow1', quotaOverride: { maxIterPerNode: 2 } })
    expect(r.checkQuotaForNode('run1', 'n_a')).toBe(null)
    expect(r.checkQuotaForNode('run1', 'n_a')).toBe(null)
    expect(r.checkQuotaForNode('run1', 'n_a')).toMatch(/maxIterPerNode/)
  })

  it('checkQuotaBeforeLlmCall 自增 + 超限', () => {
    r.start({ runId: 'run1', projectId: 'p1', basename: 'flow1', quotaOverride: { maxLlmCalls: 2 } })
    expect(r.checkQuotaBeforeLlmCall('run1')).toBe(null)
    expect(r.checkQuotaBeforeLlmCall('run1')).toBe(null)
    expect(r.checkQuotaBeforeLlmCall('run1')).toMatch(/maxLlmCalls/)
  })

  it('remainingQuota', () => {
    r.start({ runId: 'run1', projectId: 'p1', basename: 'flow1', quotaOverride: { maxIterPerNode: 5, maxLlmCalls: 10 } })
    r.checkQuotaForNode('run1', 'n_a')
    r.checkQuotaBeforeLlmCall('run1')
    const q = r.remainingQuota('run1', 'n_a')
    expect(q.iterRemaining).toBe(4)
    expect(q.llmCallsRemaining).toBe(9)
  })

  it('updateStatus completed → 释放 lock', () => {
    r.start({ runId: 'run1', projectId: 'p1', basename: 'flow1' })
    r.updateStatus('run1', 'completed')
    r.start({ runId: 'run2', projectId: 'p1', basename: 'flow1' })  // 不抛
  })
})
```

- [ ] **Step 4：跑测试通过**

```bash
npx vitest run src/track-flow/__tests__/run-registry.test.ts
```

预期：8/8 PASS。

- [ ] **Step 5：Commit**

```bash
git add backend/src/track-flow/audit-log.ts \
  backend/src/track-flow/run-registry.ts \
  backend/src/track-flow/__tests__/run-registry.test.ts
git commit -m "feat(track-flow): run-registry + audit-log — locks + 3-barrier quota + spec §8.4"
```

---

## Task 6：llm-dispatcher（PTY 注入 + 文件监听）

**Files:**
- Create: `backend/src/track-flow/llm-dispatcher.ts`

llm-dispatcher 负责：把转译后 prompt 通过 terminal-manager 注入到项目 PTY 中，启动 chokidar / 自定义 polling watcher 监听项目 cwd 的 `train.json` 文件变更，等 LLM 写完后返回 reload 结果（不阻塞超时则上抛）。

**简化思路（M2 范围）**：
- 不依赖 chokidar（避免新增 dependency）
- 用 `fs.watchFile` polling（每 500ms）—— Node 内置 + 轻量
- 监听 cwd `train.json` mtime 变化；timeout 默认 600s（10 分钟）

- [ ] **Step 1：实现 llm-dispatcher.ts**

```typescript
// backend/src/track-flow/llm-dispatcher.ts
import * as fs from 'fs'
import * as path from 'path'
import { copyToProjectCwd, reloadFromProjectCwd, cleanupProjectCwd, filterByWhitelist } from './train-json-sync'

export type Injector = (text: string) => void | Promise<void>

export interface DispatchOptions {
  projectFolder: string                    // CLI cwd
  injector: Injector                       // 把 prompt 写到项目 PTY
  prompt: string                           // 转译后的完整 prompt
  beforeSnapshot: Record<string, unknown>  // 调用前的 train.json snapshot
  outputs: string[]                        // 期望 LLM 修改的字段集合
  whitelist: string[]                      // variables[*].key（用于过滤）
  signal: AbortSignal                      // 用户取消
  timeoutMs?: number                       // 默认 600_000 (10 min)
}

export type DispatchResult =
  | { kind: 'success'; newSnapshot: Record<string, unknown>; varsDiff: { key: string; old: unknown; new: unknown }[] }
  | { kind: 'failed'; reason: string }
  | { kind: 'cancelled' }

/**
 * Dispatch one LLM call:
 *   1. Atomic-write snapshot to cwd train.json + workflow_data.json
 *   2. Inject prompt into project PTY
 *   3. Poll train.json mtime — wait until LLM writes (or timeout/cancel)
 *   4. Reload train.json (with flush wait + retry) → filter by whitelist
 *   5. Diff vs beforeSnapshot; if any output is NOT changed → failed
 *   6. Cleanup cwd files
 */
export async function dispatchLlmCall(opts: DispatchOptions): Promise<DispatchResult> {
  const cwd = opts.projectFolder
  const trainJsonPath = path.join(cwd, 'train.json')
  const timeoutMs = opts.timeoutMs ?? 600_000

  // 1. Write snapshot
  copyToProjectCwd(cwd, filterByWhitelist(opts.beforeSnapshot, opts.whitelist))

  // 记录 initial mtime（snapshot 刚写完）
  let initialMtimeMs = 0
  try {
    initialMtimeMs = fs.statSync(trainJsonPath).mtimeMs
  } catch {
    initialMtimeMs = Date.now()
  }

  try {
    // 2. Inject prompt
    await opts.injector(opts.prompt)

    // 3. Poll for mtime change
    const startedAt = Date.now()
    const pollInterval = 500
    while (true) {
      if (opts.signal.aborted) {
        cleanupProjectCwd(cwd)
        return { kind: 'cancelled' }
      }
      if (Date.now() - startedAt > timeoutMs) {
        cleanupProjectCwd(cwd)
        return { kind: 'failed', reason: `LLM 调用超时（${timeoutMs}ms 内未修改 train.json）` }
      }
      let mtimeMs = initialMtimeMs
      try {
        mtimeMs = fs.statSync(trainJsonPath).mtimeMs
      } catch {
        /* file deleted during call? continue polling */
      }
      if (mtimeMs > initialMtimeMs + 1) {
        // 跳出 polling，进入 reload
        break
      }
      await sleep(pollInterval)
    }

    // 4. Reload（含 200/500ms 等待 + 重试）
    const reload = await reloadFromProjectCwd(cwd)
    if (!reload.ok || !reload.data) {
      cleanupProjectCwd(cwd)
      return { kind: 'failed', reason: `train.json reload 失败：${reload.error ?? 'unknown'}` }
    }

    // 5. Diff + outputs check
    const newSnapshotFiltered = filterByWhitelist(reload.data, opts.whitelist)
    const varsDiff: { key: string; old: unknown; new: unknown }[] = []
    for (const k of Object.keys(newSnapshotFiltered)) {
      const oldV = opts.beforeSnapshot[k] ?? null
      const newV = newSnapshotFiltered[k]
      if (!sameValue(oldV, newV)) {
        varsDiff.push({ key: k, old: oldV, new: newV })
      }
    }

    // outputs 中每个字段必须出现在 varsDiff（spec §6.2 step 5）
    const changedKeys = new Set(varsDiff.map((d) => d.key))
    const missingOutputs = opts.outputs.filter((k) => !changedKeys.has(k))
    if (missingOutputs.length > 0) {
      cleanupProjectCwd(cwd)
      return {
        kind: 'failed',
        reason: `LLM 未按要求修改字段：${missingOutputs.join(', ')}`,
      }
    }

    cleanupProjectCwd(cwd)
    return { kind: 'success', newSnapshot: newSnapshotFiltered, varsDiff }
  } catch (e) {
    cleanupProjectCwd(cwd)
    if (opts.signal.aborted) return { kind: 'cancelled' }
    return { kind: 'failed', reason: `dispatch 异常：${(e as Error).message}` }
  }
}

function sameValue(a: unknown, b: unknown): boolean {
  if (a === b) return true
  if (typeof a !== typeof b) return false
  if (typeof a === 'object') {
    try { return JSON.stringify(a) === JSON.stringify(b) } catch { return false }
  }
  return false
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}
```

- [ ] **Step 2：backend tsc 通过**

```bash
cd /Users/tom/Projects/cc-web/backend
npx tsc --noEmit
```

- [ ] **Step 3：Commit**

```bash
git add backend/src/track-flow/llm-dispatcher.ts
git commit -m "feat(track-flow): llm-dispatcher — inject prompt + watch train.json mtime"
```

---

## Task 7：runtime state machine

**Files:**
- Create: `backend/src/track-flow/runtime.ts`

按 spec §9 实现 state machine。runtime 是 backend 核心，调度三类节点，emit WS 事件。

- [ ] **Step 1：实现 runtime.ts**

```typescript
// backend/src/track-flow/runtime.ts
import { translatePrompt, type VarDecl } from './prompt-translator'
import { parseIfExpr } from './if-expr-parser'
import { evaluateIfExpr } from './if-expr-evaluator'
import { dispatchLlmCall, type Injector } from './llm-dispatcher'
import { appendAudit } from './audit-log'
import { flowRunRegistry, type RunInfo } from './run-registry'

// ── 简化版 FlowV3 类型（避免引入 frontend types）────────────────────────

export interface FlowV3 {
  version: 3
  trackName: string
  adapter: 'claude-code' | 'codex' | 'qwen' | 'gemini'
  variables: VarDecl[]
  nodes: NodeV3[]
  edges: EdgeV3[]
}

export type NodeV3 = UserInputNode | LLMNode | IfNode

export interface NodeBase {
  id: string
  position: { x: number; y: number }
}

export interface UserInputNode extends NodeBase {
  type: 'user_input'
  fields: { varKey: string; uiHint?: string; variants?: string[] }[]
}

export interface LLMNode extends NodeBase {
  type: 'llm'
  promptTemplate: string
  inputs: string[]
  outputs: string[]
}

export interface IfNode extends NodeBase {
  type: 'if'
  conditionExpr: string
}

export interface EdgeV3 {
  id: string
  source: string
  sourceHandle?: 'default' | 'true' | 'false'
  target: string | null
}

// ── Runtime 接口 ───────────────────────────────────────────────────────

export interface RuntimeDeps {
  projectFolder: string         // CLI cwd
  basename: string              // flow 文件 basename
  runId: string
  injector: Injector            // terminal-manager 注入器
  broadcast: (event: string, payload: Record<string, unknown>) => void
}

export interface UserInputPromise {
  resolve: (values: Record<string, unknown>) => void
  reject: (err: Error) => void
}

const pendingUserInput = new Map<string, UserInputPromise>()  // runId → promise

/**
 * Submit user input from frontend. Resolves the runtime's await.
 */
export function submitUserInputForRun(runId: string, values: Record<string, unknown>): boolean {
  const p = pendingUserInput.get(runId)
  if (!p) return false
  pendingUserInput.delete(runId)
  p.resolve(values)
  return true
}

/**
 * Find entry node：no incoming edge.
 */
function findEntryNode(flow: FlowV3): NodeV3 | null {
  const incoming = new Set<string>()
  for (const e of flow.edges) {
    if (e.target !== null) incoming.add(e.target)
  }
  for (const n of flow.nodes) {
    if (!incoming.has(n.id)) return n
  }
  return null
}

/**
 * Pick next node id (or null for end) given current node + which sourceHandle was taken.
 */
function pickNext(flow: FlowV3, nodeId: string, sourceHandle: 'default' | 'true' | 'false'): string | null {
  for (const e of flow.edges) {
    if (e.source === nodeId && (e.sourceHandle ?? 'default') === sourceHandle) {
      return e.target  // 可能 null
    }
  }
  return null
}

// ── 主驱动函数 ──────────────────────────────────────────────────────────

export async function runFlow(
  flow: FlowV3,
  initialSnapshot: Record<string, unknown>,
  deps: RuntimeDeps,
): Promise<void> {
  const info = flowRunRegistry.get(deps.runId)
  if (!info) throw new Error('runId not in registry')

  let snapshot: Record<string, unknown> = { ...initialSnapshot }
  let currentNodeId: string | null = findEntryNode(flow)?.id ?? null
  flowRunRegistry.updateStatus(deps.runId, 'running')
  emit('flow_started', deps, { initialVars: snapshot })

  while (currentNodeId !== null && info.status !== 'cancelled') {
    const node = flow.nodes.find((n) => n.id === currentNodeId)
    if (!node) {
      finish('failed', deps, info, `节点 ${currentNodeId} 在 flow 中找不到`)
      return
    }

    // 三道防线
    const quotaErr = flowRunRegistry.checkQuotaForNode(deps.runId, node.id)
    if (quotaErr) {
      finish('failed', deps, info, quotaErr, node.id)
      return
    }

    const iter = (info.iterCounts.get(node.id) ?? 1)
    emit('flow_node_active', deps, { nodeId: node.id, iter, quota: flowRunRegistry.remainingQuota(deps.runId, node.id) })
    appendAudit(deps.projectFolder, deps.basename, deps.runId, {
      ts: Date.now(), type: 'node_active', nodeId: node.id, iter,
    })

    let nextSourceHandle: 'default' | 'true' | 'false' = 'default'
    let stepError: string | null = null

    if (node.type === 'user_input') {
      const r = await executeUserInputNode(node, snapshot, deps)
      if (r.kind === 'cancelled') {
        finish('cancelled', deps, info, undefined, node.id)
        return
      }
      snapshot = { ...snapshot, ...r.values }
      for (const k of Object.keys(r.values)) {
        emit('flow_var_changed', deps, { key: k, value: r.values[k] })
      }
    } else if (node.type === 'llm') {
      const llmQuotaErr = flowRunRegistry.checkQuotaBeforeLlmCall(deps.runId)
      if (llmQuotaErr) {
        finish('failed', deps, info, llmQuotaErr, node.id)
        return
      }
      const translated = translatePrompt(node.promptTemplate, flow.variables, snapshot, node.outputs)
      const r = await dispatchLlmCall({
        projectFolder: deps.projectFolder,
        injector: deps.injector,
        prompt: translated,
        beforeSnapshot: snapshot,
        outputs: node.outputs,
        whitelist: flow.variables.map((v) => v.key),
        signal: info.cancelAbortController.signal,
      })
      if (r.kind === 'cancelled') {
        finish('cancelled', deps, info, undefined, node.id)
        return
      }
      if (r.kind === 'failed') {
        stepError = r.reason
      } else {
        snapshot = r.newSnapshot
        for (const d of r.varsDiff) {
          emit('flow_var_changed', deps, { key: d.key, value: d.new })
        }
      }
    } else if (node.type === 'if') {
      try {
        const ast = parseIfExpr(node.conditionExpr)
        const result = evaluateIfExpr(ast, snapshot)
        nextSourceHandle = result ? 'true' : 'false'
      } catch (e) {
        stepError = `if expr parse 失败：${(e as Error).message}`
      }
    }

    if (stepError) {
      finish('failed', deps, info, stepError, node.id)
      return
    }

    emit('flow_node_completed', deps, { nodeId: node.id, iter })
    appendAudit(deps.projectFolder, deps.basename, deps.runId, {
      ts: Date.now(), type: 'node_completed', nodeId: node.id, iter,
    })

    currentNodeId = pickNext(flow, node.id, nextSourceHandle)
  }

  if (info.status === 'cancelled') {
    return  // already emitted in cancel handler
  }
  finish('completed', deps, info)
}

// ── 节点执行子函数 ─────────────────────────────────────────────────────

async function executeUserInputNode(
  node: UserInputNode,
  snapshot: Record<string, unknown>,
  deps: RuntimeDeps,
): Promise<{ kind: 'ok'; values: Record<string, unknown> } | { kind: 'cancelled' }> {
  const fields = node.fields.map((f) => ({
    varKey: f.varKey,
    description: '',     // backend 不知道 description（在 flow.variables 里）—— 让前端用 varKey 自己查
    uiHint: f.uiHint,
    variants: f.variants,
  }))
  flowRunRegistry.setPendingUserInput(deps.runId, { nodeId: node.id, fields })
  flowRunRegistry.updateStatus(deps.runId, 'waiting_user_input')
  emit('flow_user_input_required', deps, { nodeId: node.id, fields })

  const info = flowRunRegistry.get(deps.runId)!
  return new Promise((resolve) => {
    pendingUserInput.set(deps.runId, {
      resolve: (values) => {
        flowRunRegistry.clearPendingUserInput(deps.runId)
        flowRunRegistry.updateStatus(deps.runId, 'running')
        resolve({ kind: 'ok', values })
      },
      reject: () => resolve({ kind: 'cancelled' }),
    })
    info.cancelAbortController.signal.addEventListener('abort', () => {
      const p = pendingUserInput.get(deps.runId)
      if (p) {
        pendingUserInput.delete(deps.runId)
        resolve({ kind: 'cancelled' })
      }
    })
  })
}

// ── helpers ────────────────────────────────────────────────────────────

function emit(event: string, deps: RuntimeDeps, payload: Record<string, unknown>): void {
  deps.broadcast(event, { runId: deps.runId, ...payload })
}

function finish(
  status: 'completed' | 'failed' | 'cancelled',
  deps: RuntimeDeps,
  info: RunInfo,
  errorMessage?: string,
  nodeId?: string,
): void {
  if (status === 'failed') {
    flowRunRegistry.updateStatus(deps.runId, 'failed', {
      nodeId,
      message: errorMessage ?? 'unknown',
    })
    emit('flow_node_failed', deps, { nodeId, reason: errorMessage })
    appendAudit(deps.projectFolder, deps.basename, deps.runId, {
      ts: Date.now(), type: 'node_failed', nodeId, message: errorMessage,
    })
    emit('flow_error', deps, { message: errorMessage })
  } else if (status === 'cancelled') {
    flowRunRegistry.updateStatus(deps.runId, 'cancelled')
    appendAudit(deps.projectFolder, deps.basename, deps.runId, {
      ts: Date.now(), type: 'cancelled', nodeId,
    })
    emit('flow_cancelled', deps, {})
  } else {
    flowRunRegistry.updateStatus(deps.runId, 'completed')
    appendAudit(deps.projectFolder, deps.basename, deps.runId, {
      ts: Date.now(), type: 'done',
    })
    emit('flow_done', deps, { finalVars: info ? undefined : undefined })  // M2 简化
  }
}
```

- [ ] **Step 2：backend tsc 通过**

```bash
cd /Users/tom/Projects/cc-web/backend
npx tsc --noEmit
```

- [ ] **Step 3：Commit**

```bash
git add backend/src/track-flow/runtime.ts
git commit -m "feat(track-flow): runtime state machine — user_input / llm / if dispatch + WS events"
```

---

## Task 8：track-flow/index.ts 扩展 + routes/track-flows.ts 加 run/cancel/user_input 端点

**Files:**
- Modify: `backend/src/track-flow/index.ts` — 加新 exports
- Modify: `backend/src/routes/track-flows.ts` — 加 POST run / POST cancel / POST user_input / GET runs/active

- [ ] **Step 1：扩展 index.ts**

读 `backend/src/track-flow/index.ts` 现有内容（应只 `export * from './store'`），加：

```typescript
export * from './store'
export * from './prompt-translator'
export * from './if-expr-parser'
export * from './if-expr-evaluator'
export * from './train-json-sync'
export * from './run-registry'
export * from './llm-dispatcher'
export * from './audit-log'
export * from './runtime'
```

- [ ] **Step 2：扩展 routes/track-flows.ts**

读现有 `backend/src/routes/track-flows.ts`。在 buildTrackFlowsRouter 内现有 4 个 handler 后追加：

```typescript
import { flowRunRegistry, runFlow, submitUserInputForRun } from '../track-flow'
import { deriveInjector } from './_flow-injector'   // 见 Step 3
import { newRunId } from '../track-flow/run-id'     // 见 Step 4

// POST /api/projects/:projectId/track-flows/:filename/run — body { quotaOverride? }
router.post(
  '/:projectId/track-flows/file/:filename/run',
  requireProjectOwner('projectId'),
  async (req: AuthRequest, res: Response): Promise<void> => {
    const project = getProject(req.params.projectId)
    if (!project) { res.status(404).json({ error: 'Project not found' }); return }
    const basename = sanitizeFlowFilename(req.params.filename)
    if (!basename) { res.status(400).json({ error: 'invalid filename' }); return }
    const flowRaw = loadFlow(project.folderPath, basename)
    if (!flowRaw || typeof flowRaw !== 'object') {
      res.status(404).json({ error: 'flow not found' }); return
    }
    const flow = flowRaw as Parameters<typeof runFlow>[0]
    const trainJson = loadTrainJson(project.folderPath, basename) ?? {}

    const runId = newRunId()
    try {
      flowRunRegistry.start({
        runId, projectId: project.id, basename,
        quotaOverride: req.body?.quotaOverride,
      })
    } catch (e) {
      const err = e as Error & { existingRunId?: string }
      if (err.message === 'FLOW_ALREADY_RUNNING') {
        res.status(409).json({
          code: 'FLOW_ALREADY_RUNNING',
          runId: err.existingRunId,
          error: '该工作轨已有运行中的实例',
        })
        return
      }
      throw e
    }

    res.json({ runId })

    // 后台启动 runFlow（不阻塞 HTTP 响应）
    const injector = deriveInjector(project.id)
    void runFlow(flow, trainJson, {
      projectFolder: project.folderPath,
      basename,
      runId,
      injector,
      broadcast: (event, payload) => {
        // broadcastJsonNonReadOnly is defined in backend/src/index.ts；
        // we need to import or pass it through.  See Step 5 for wiring.
        deriveBroadcast(req.params.projectId)(event, payload)
      },
    }).catch((e) => {
      log.error({ runId, err: (e as Error).message }, 'runFlow threw')
    })
  },
)

// POST /api/projects/:projectId/track-flows/:filename/cancel — body { runId? }
router.post(
  '/:projectId/track-flows/file/:filename/cancel',
  requireProjectOwner('projectId'),
  (req: AuthRequest, res: Response): void => {
    const project = getProject(req.params.projectId)
    if (!project) { res.status(404).json({ error: 'Project not found' }); return }
    const basename = sanitizeFlowFilename(req.params.filename)
    if (!basename) { res.status(400).json({ error: 'invalid filename' }); return }
    const runId = req.body?.runId
    if (typeof runId === 'string') {
      const ok = flowRunRegistry.cancel(runId)
      res.json({ ok })
      return
    }
    // 没传 runId → 取消该 flow 的 active run
    const active = flowRunRegistry.findActive(project.id, basename)
    if (!active) { res.json({ ok: false, message: 'no active run' }); return }
    flowRunRegistry.cancel(active.runId)
    res.json({ ok: true, runId: active.runId })
  },
)

// POST /api/projects/:projectId/track-flows/:filename/user_input — body { runId, values }
router.post(
  '/:projectId/track-flows/file/:filename/user_input',
  requireProjectOwner('projectId'),
  (req: AuthRequest, res: Response): void => {
    const runId = req.body?.runId
    const values = req.body?.values
    if (typeof runId !== 'string' || typeof values !== 'object' || values === null) {
      res.status(400).json({ error: 'runId/values required' }); return
    }
    const ok = submitUserInputForRun(runId, values)
    res.json({ ok })
  },
)

// GET /api/projects/:projectId/track-flows/runs/active
router.get(
  '/:projectId/track-flows/runs/active',
  requireProjectOwner('projectId'),
  (req: AuthRequest, res: Response): void => {
    const list = flowRunRegistry.listActive(req.params.projectId)
    res.json({
      runs: list.map((r) => ({
        runId: r.runId,
        basename: r.basename,
        status: r.status,
        startedAt: r.startedAt,
        pendingUserInput: r.pendingUserInput,
      })),
    })
  },
)
```

- [ ] **Step 3：实现 `backend/src/routes/_flow-injector.ts` 注入器适配**

```typescript
// backend/src/routes/_flow-injector.ts
import { terminalManager } from '../terminal-manager-singleton'   // 见 Step 4

export function deriveInjector(projectId: string): (text: string) => Promise<void> {
  return async (text: string) => {
    terminalManager.injectText(projectId, text)
  }
}

export function deriveBroadcast(projectId: string): (event: string, payload: Record<string, unknown>) => void {
  return (event, payload) => {
    // 期望 backend/src/index.ts export broadcastJsonNonReadOnly(projectId, msg)
    // M2 简化：把 event/payload 包成 { type: event, ...payload } 调 broadcastJson
    const { broadcastFlowEvent } = require('../track-flow-ws')
    broadcastFlowEvent(projectId, event, payload)
  }
}
```

注意：此 file 引用 `terminalManager` singleton 和 `broadcastFlowEvent` —— Step 4 / Step 5 准备。

- [ ] **Step 4：实现 newRunId + terminal-manager 单例 + flow-ws broadcast**

a) `backend/src/track-flow/run-id.ts`：

```typescript
// backend/src/track-flow/run-id.ts
export function newRunId(): string {
  return `run_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
}
```

b) `backend/src/terminal-manager-singleton.ts`：

读现有 `backend/src/index.ts` 找到现有 `terminalManager` 实例化位置。M2 简化：直接 `export { terminalManager } from './index'` 是循环依赖。新建 singleton：

```typescript
// backend/src/terminal-manager-singleton.ts
import type { TerminalManager } from './terminal-manager'
let _tm: TerminalManager | null = null
export function setTerminalManager(tm: TerminalManager): void {
  _tm = tm
}
export const terminalManager = {
  injectText(projectId: string, text: string): void {
    if (!_tm) throw new Error('terminal manager not initialized')
    // terminal-manager 实际 API 可能是 inject / write / send
    // 看 backend/src/terminal-manager.ts，按真实方法名调
    ;(_tm as unknown as { inject?: (id: string, text: string) => void }).inject?.(projectId, text)
  },
}
```

**注意**：subagent 实施时**必须 read `backend/src/terminal-manager.ts`**确认真实的注入方法签名（可能叫 `inject` / `write` / `pasteText` / `sendInput` 等），把上面 `as unknown as` 的 cast 改为真实接口。如果接口不存在 → BLOCKED，让 controller 处理。

c) `backend/src/track-flow-ws.ts`：

```typescript
// backend/src/track-flow-ws.ts
let _broadcast: ((projectId: string, msg: Record<string, unknown>) => void) | null = null
export function setBroadcast(fn: typeof _broadcast): void {
  _broadcast = fn
}
export function broadcastFlowEvent(
  projectId: string,
  event: string,
  payload: Record<string, unknown>,
): void {
  if (!_broadcast) return
  _broadcast(projectId, { type: event, ...payload })
}
```

- [ ] **Step 5：wire backend/src/index.ts**

读 `backend/src/index.ts` 找：
- terminalManager 实例化位置 → 调 `setTerminalManager(terminalManager)`
- broadcastJsonNonReadOnly 函数定义 → 调 `setBroadcast(broadcastJsonNonReadOnly)`
- 启动时调一次 `cleanupStaleCwdFiles(allProjectFolders)`（spec §9.6）

具体调用位置由实施者按现有 index.ts 结构定。

- [ ] **Step 6：backend tsc + build 通过**

```bash
cd /Users/tom/Projects/cc-web/backend
npx tsc --noEmit
npm run build 2>&1 | tail -5
```

- [ ] **Step 7：Commit**

```bash
git add backend/src/track-flow/index.ts backend/src/track-flow/run-id.ts \
  backend/src/routes/track-flows.ts backend/src/routes/_flow-injector.ts \
  backend/src/terminal-manager-singleton.ts backend/src/track-flow-ws.ts \
  backend/src/index.ts
git commit -m "feat(track-flow): backend wire — run/cancel/user_input routes + ws + injector"
```

---

## Task 9：frontend api.ts 加 runFlow / cancelFlow / submitUserInput / listActiveRuns

**Files:**
- Modify: `frontend/src/components/tracks/api.ts`

- [ ] **Step 1：在 api.ts 加 v3 runtime endpoints**

```typescript
// 在 api.ts 末尾追加

export function runFlow(
  projectId: string,
  filename: string,
  quotaOverride?: { maxIterPerNode?: number; maxLlmCalls?: number; maxRunDurationMs?: number },
): Promise<{ runId: string }> {
  return req(
    'POST',
    `/api/projects/${projectId}/track-flows/file/${encodeURIComponent(filename)}/run`,
    quotaOverride ? { quotaOverride } : {},
  )
}

export function cancelFlow(
  projectId: string,
  filename: string,
  runId?: string,
): Promise<{ ok: boolean; runId?: string; message?: string }> {
  return req(
    'POST',
    `/api/projects/${projectId}/track-flows/file/${encodeURIComponent(filename)}/cancel`,
    runId ? { runId } : {},
  )
}

export function submitUserInput(
  projectId: string,
  filename: string,
  runId: string,
  values: Record<string, unknown>,
): Promise<{ ok: boolean }> {
  return req(
    'POST',
    `/api/projects/${projectId}/track-flows/file/${encodeURIComponent(filename)}/user_input`,
    { runId, values },
  )
}

export interface ActiveRunInfo {
  runId: string
  basename: string
  status: string
  startedAt: number
  pendingUserInput?: { nodeId: string; fields: { varKey: string; uiHint?: string; variants?: string[] }[] }
}

export function listActiveFlowRuns(projectId: string): Promise<{ runs: ActiveRunInfo[] }> {
  return req('GET', `/api/projects/${projectId}/track-flows/runs/active`)
}
```

- [ ] **Step 2：frontend tsc 通过**

- [ ] **Step 3：Commit**

```bash
git add frontend/src/components/tracks/api.ts
git commit -m "feat(track-flow): frontend api — runFlow/cancelFlow/submitUserInput/listActiveFlowRuns"
```

---

## Task 10：frontend useFlowRun hook（WS 订阅）

**Files:**
- Create: `frontend/src/components/tracks/flow/useFlowRun.ts`

订阅项目 WS，过滤 `flow_*` 事件，维护 runId / 节点状态 / 变量值 / 错误 / quota。

- [ ] **Step 1：实现 useFlowRun.ts**

```typescript
// frontend/src/components/tracks/flow/useFlowRun.ts
import { useState, useEffect, useRef, useCallback } from 'react'

export type NodeRuntimeState = 'idle' | 'active' | 'completed' | 'failed' | 'skipped'

export interface FlowRunState {
  runId: string | null
  status: 'idle' | 'running' | 'waiting_user_input' | 'completed' | 'failed' | 'cancelled'
  nodeStates: Map<string, NodeRuntimeState>
  vars: Record<string, unknown>
  error: string | null
  currentNodeId: string | null
  pendingUserInput: { nodeId: string; fields: { varKey: string; uiHint?: string; variants?: string[] }[] } | null
  quota: { iterRemaining?: number; llmCallsRemaining: number; durationRemainingMs: number } | null
}

const initialState: FlowRunState = {
  runId: null,
  status: 'idle',
  nodeStates: new Map(),
  vars: {},
  error: null,
  currentNodeId: null,
  pendingUserInput: null,
  quota: null,
}

interface Props {
  projectId: string
  /** 项目级 WS 单例（由 ProjectPage 提供） */
  projectWs: WebSocket | null
}

export function useFlowRun({ projectWs }: Props) {
  const [state, setState] = useState<FlowRunState>(initialState)
  const runIdRef = useRef<string | null>(null)

  const reset = useCallback(() => {
    runIdRef.current = null
    setState(initialState)
  }, [])

  const attachRunId = useCallback((runId: string) => {
    runIdRef.current = runId
    setState((s) => ({ ...s, runId, status: 'running', nodeStates: new Map(), vars: {}, error: null }))
  }, [])

  useEffect(() => {
    if (!projectWs) return
    const onMessage = (ev: MessageEvent) => {
      let msg: { type?: string; runId?: string; [k: string]: unknown }
      try {
        msg = JSON.parse(typeof ev.data === 'string' ? ev.data : '')
      } catch {
        return
      }
      if (!msg.type?.startsWith('flow_')) return
      if (runIdRef.current && msg.runId && msg.runId !== runIdRef.current) return  // 别的 run 事件忽略

      setState((s) => applyEvent(s, msg))
    }
    projectWs.addEventListener('message', onMessage)
    return () => projectWs.removeEventListener('message', onMessage)
  }, [projectWs])

  return { state, attachRunId, reset }
}

function applyEvent(s: FlowRunState, msg: { type?: string; [k: string]: unknown }): FlowRunState {
  const type = msg.type
  if (type === 'flow_started') {
    return { ...s, status: 'running', vars: (msg.initialVars as Record<string, unknown>) ?? {} }
  }
  if (type === 'flow_node_active') {
    const newStates = new Map(s.nodeStates)
    newStates.set(msg.nodeId as string, 'active')
    return {
      ...s,
      currentNodeId: msg.nodeId as string,
      nodeStates: newStates,
      quota: (msg.quota as FlowRunState['quota']) ?? s.quota,
    }
  }
  if (type === 'flow_node_completed') {
    const newStates = new Map(s.nodeStates)
    newStates.set(msg.nodeId as string, 'completed')
    return { ...s, nodeStates: newStates }
  }
  if (type === 'flow_node_failed') {
    const newStates = new Map(s.nodeStates)
    if (msg.nodeId) newStates.set(msg.nodeId as string, 'failed')
    return { ...s, status: 'failed', nodeStates: newStates, error: (msg.reason as string) ?? null }
  }
  if (type === 'flow_var_changed') {
    return { ...s, vars: { ...s.vars, [msg.key as string]: msg.value } }
  }
  if (type === 'flow_user_input_required') {
    return {
      ...s,
      status: 'waiting_user_input',
      pendingUserInput: {
        nodeId: msg.nodeId as string,
        fields: msg.fields as { varKey: string; uiHint?: string; variants?: string[] }[],
      },
    }
  }
  if (type === 'flow_done') {
    return { ...s, status: 'completed', currentNodeId: null }
  }
  if (type === 'flow_cancelled') {
    return { ...s, status: 'cancelled' }
  }
  if (type === 'flow_error') {
    return { ...s, status: 'failed', error: (msg.message as string) ?? 'unknown' }
  }
  return s
}
```

- [ ] **Step 2：tsc 通过**

- [ ] **Step 3：Commit**

```bash
git add frontend/src/components/tracks/flow/useFlowRun.ts
git commit -m "feat(track-flow): useFlowRun hook — subscribe WS, track run state/vars/nodes"
```

---

## Task 11：FlowUserInputDialog 运行时弹窗

**Files:**
- Create: `frontend/src/components/tracks/flow/FlowUserInputDialog.tsx`

按 spec §6.1 / §10 `flow_user_input_required` 事件 → 弹表单 → 用户填 → submitUserInput → resolve。

- [ ] **Step 1：实现 FlowUserInputDialog.tsx**

```typescript
// frontend/src/components/tracks/flow/FlowUserInputDialog.tsx
import { useState } from 'react'
import * as Dialog from '@radix-ui/react-dialog'
import type { FlowV3 } from './flow-types-v3'

interface Props {
  open: boolean
  flow: FlowV3
  pending: { nodeId: string; fields: { varKey: string; uiHint?: string; variants?: string[] }[] }
  onSubmit: (values: Record<string, unknown>) => void
  onCancel: () => void
}

export function FlowUserInputDialog({ open, flow, pending, onSubmit, onCancel }: Props) {
  const [values, setValues] = useState<Record<string, unknown>>({})

  const submit = () => {
    onSubmit(values)
  }

  return (
    <Dialog.Root open={open} onOpenChange={(o) => { if (!o) onCancel() }}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 bg-black/40 z-[60]" />
        <Dialog.Content className="fixed left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 w-[480px] bg-white rounded-lg z-[60] p-6">
          <Dialog.Title className="text-lg font-semibold mb-4">需要您输入</Dialog.Title>
          <div className="space-y-3">
            {pending.fields.map((f) => {
              const decl = flow.variables.find((v) => v.key === f.varKey)
              const label = decl ? `${f.varKey}（${decl.description}）` : f.varKey
              const cur = (values[f.varKey] as string) ?? ''
              return (
                <div key={f.varKey}>
                  <label className="text-sm text-gray-600 block mb-1">{label}</label>
                  {f.uiHint === 'textarea' ? (
                    <textarea
                      value={cur}
                      onChange={(e) => setValues({ ...values, [f.varKey]: e.target.value })}
                      rows={4}
                      className="w-full px-2 py-1 rounded border text-sm font-mono"
                    />
                  ) : f.uiHint === 'enum' && f.variants ? (
                    <select
                      value={cur}
                      onChange={(e) => setValues({ ...values, [f.varKey]: e.target.value })}
                      className="w-full px-2 py-1 rounded border text-sm"
                    >
                      <option value="">（请选择）</option>
                      {f.variants.map((v) => (<option key={v} value={v}>{v}</option>))}
                    </select>
                  ) : f.uiHint === 'number' ? (
                    <input
                      type="number"
                      value={cur}
                      onChange={(e) => setValues({ ...values, [f.varKey]: Number(e.target.value) })}
                      className="w-full px-2 py-1 rounded border text-sm font-mono"
                    />
                  ) : f.uiHint === 'bool' ? (
                    <input
                      type="checkbox"
                      checked={!!values[f.varKey]}
                      onChange={(e) => setValues({ ...values, [f.varKey]: e.target.checked })}
                    />
                  ) : (
                    <input
                      type="text"
                      value={cur}
                      onChange={(e) => setValues({ ...values, [f.varKey]: e.target.value })}
                      className="w-full px-2 py-1 rounded border text-sm font-mono"
                    />
                  )}
                </div>
              )
            })}
          </div>
          <div className="mt-6 flex justify-end gap-2">
            <button onClick={onCancel} className="text-sm px-3 py-1 rounded border">取消运行</button>
            <button onClick={submit} className="text-sm px-3 py-1 rounded bg-blue-600 text-white">提交</button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
```

- [ ] **Step 2：tsc 通过**

- [ ] **Step 3：Commit**

```bash
git add frontend/src/components/tracks/flow/FlowUserInputDialog.tsx
git commit -m "feat(track-flow): FlowUserInputDialog — runtime user_input form"
```

---

## Task 12：FlowRunPanel — 运行时面板（变量值 + quota）

**Files:**
- Create: `frontend/src/components/tracks/flow/FlowRunPanel.tsx`

- [ ] **Step 1：实现 FlowRunPanel.tsx**

```typescript
// frontend/src/components/tracks/flow/FlowRunPanel.tsx
import type { FlowRunState } from './useFlowRun'
import type { FlowV3 } from './flow-types-v3'

interface Props {
  flow: FlowV3
  run: FlowRunState
}

export function FlowRunPanel({ flow, run }: Props) {
  if (run.status === 'idle') return null

  return (
    <div className="border-t bg-gray-50 px-3 py-2 text-xs space-y-1 max-h-64 overflow-y-auto">
      <div className="flex items-center gap-2">
        <span className="font-medium">运行状态:</span>
        <span className={statusColor(run.status)}>{statusLabel(run.status)}</span>
        {run.runId && <span className="text-gray-400 font-mono">{run.runId}</span>}
        {run.currentNodeId && <span>当前: {run.currentNodeId}</span>}
      </div>
      {run.quota && (
        <div className="flex gap-4 text-gray-600">
          {run.quota.iterRemaining !== undefined && <span>节点剩余迭代: {run.quota.iterRemaining}</span>}
          <span>LLM 调用剩余: {run.quota.llmCallsRemaining}</span>
          <span>运行剩余: {Math.floor(run.quota.durationRemainingMs / 1000)}s</span>
        </div>
      )}
      {run.error && (
        <div className="text-red-600">错误: {run.error}</div>
      )}
      <div className="mt-2">
        <div className="text-gray-500 mb-1">变量值实时:</div>
        <div className="font-mono space-y-0.5">
          {flow.variables.map((v) => (
            <div key={v.key} className="flex gap-2">
              <span className="text-blue-700">{v.key}</span>
              <span className="text-gray-400">({v.description})</span>
              <span>= {formatVal(run.vars[v.key] ?? null)}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

function statusLabel(s: FlowRunState['status']): string {
  switch (s) {
    case 'running': return '运行中'
    case 'waiting_user_input': return '等待用户输入'
    case 'completed': return '完成'
    case 'failed': return '失败'
    case 'cancelled': return '已取消'
    default: return s
  }
}

function statusColor(s: FlowRunState['status']): string {
  switch (s) {
    case 'running': return 'text-blue-600'
    case 'waiting_user_input': return 'text-amber-600'
    case 'completed': return 'text-green-600'
    case 'failed': return 'text-red-600'
    case 'cancelled': return 'text-gray-500'
    default: return 'text-gray-600'
  }
}

function formatVal(v: unknown): string {
  if (v === null || v === undefined) return 'null'
  if (typeof v === 'string') return JSON.stringify(v)
  if (typeof v === 'number' || typeof v === 'boolean') return String(v)
  return JSON.stringify(v)
}
```

- [ ] **Step 2：tsc 通过**

- [ ] **Step 3：Commit**

```bash
git add frontend/src/components/tracks/flow/FlowRunPanel.tsx
git commit -m "feat(track-flow): FlowRunPanel — runtime state + vars + quota live"
```

---

## Task 13：节点状态边框（runtime 反馈）

**Files:**
- Modify: `frontend/src/components/tracks/flow/nodes/UserInputNode.tsx`
- Modify: `frontend/src/components/tracks/flow/nodes/LLMNode.tsx`
- Modify: `frontend/src/components/tracks/flow/nodes/IfNode.tsx`
- Modify: `frontend/src/components/tracks/flow/GraphContext.tsx`（加 runtime state to context）

让节点根据 runtime state 显示不同边框（黄 pulse active / 绿 ✓ completed / 红 ✗ failed / 灰划线 skipped）。

- [ ] **Step 1：扩展 GraphContext.tsx**

```typescript
// frontend/src/components/tracks/flow/GraphContext.tsx
import { createContext, useContext, type ReactNode } from 'react'
import type { Action } from './flow-reducer'
import type { NodeRuntimeState } from './useFlowRun'

interface GraphCtx {
  dispatch: (a: Action) => void
  nodeStates?: Map<string, NodeRuntimeState>  // 可选 — 编辑期是 undefined
}

const Ctx = createContext<GraphCtx | null>(null)

export function GraphProvider({ value, children }: { value: GraphCtx; children: ReactNode }) {
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

export function useGraphDispatch() {
  const c = useContext(Ctx)
  if (!c) throw new Error('useGraphDispatch outside GraphProvider')
  return c.dispatch
}

export function useNodeRuntimeState(nodeId: string): NodeRuntimeState | null {
  const c = useContext(Ctx)
  if (!c?.nodeStates) return null
  return c.nodeStates.get(nodeId) ?? null
}
```

- [ ] **Step 2：给 3 个节点视图加 runtime 边框**

修改 `nodes/UserInputNode.tsx` / `LLMNode.tsx` / `IfNode.tsx`：在 className 拼接处加一个 helper：

```typescript
import { useNodeRuntimeState } from '../GraphContext'

function runtimeBorderClass(state: ReturnType<typeof useNodeRuntimeState>): string {
  if (state === 'active') return 'border-amber-500 ring-2 ring-amber-200 animate-pulse'
  if (state === 'completed') return 'border-green-600 ring-1 ring-green-200'
  if (state === 'failed') return 'border-red-600 ring-2 ring-red-200'
  if (state === 'skipped') return 'opacity-50 line-through'
  return ''
}
```

在每节点 className 中加：

```typescript
const rtState = useNodeRuntimeState(id)
const rtBorder = runtimeBorderClass(rtState)
// ...
className={[
  '...原有 class...',
  selected ? 'border-blue-500 shadow' : '...原默认...',
  rtBorder,
].join(' ')}
```

- [ ] **Step 3：tsc 通过**

- [ ] **Step 4：Commit**

```bash
git add frontend/src/components/tracks/flow/GraphContext.tsx \
  frontend/src/components/tracks/flow/nodes/UserInputNode.tsx \
  frontend/src/components/tracks/flow/nodes/LLMNode.tsx \
  frontend/src/components/tracks/flow/nodes/IfNode.tsx
git commit -m "feat(track-flow): node views — runtime state border (active/completed/failed/skipped)"
```

---

## Task 14：FlowToolbar 加运行/取消按钮 + TrackFlowEditor 集成 useFlowRun + FlowRunPanel + FlowUserInputDialog

**Files:**
- Modify: `frontend/src/components/tracks/flow/FlowToolbar.tsx`
- Modify: `frontend/src/components/tracks/flow/TrackFlowEditor.tsx`

- [ ] **Step 1：扩展 FlowToolbar.tsx**

加运行 / 取消按钮，调 `runFlow` / `cancelFlow` API：

```typescript
// FlowToolbar.tsx 内部增加 props
interface Props {
  flow: FlowV3
  projectId: string
  filename: string
  dirty: boolean
  runStatus: 'idle' | 'running' | 'waiting_user_input' | 'completed' | 'failed' | 'cancelled'
  onSaved: () => void
  onClose: () => void
  onRunStarted: (runId: string) => void
  onCancelled: () => void
}

// 在 toolbar 内部加：
// （保存按钮旁）
{runStatus === 'idle' || runStatus === 'completed' || runStatus === 'failed' || runStatus === 'cancelled' ? (
  <button
    onClick={async () => {
      if (dirty) {
        alert('请先保存')
        return
      }
      try {
        const { runId } = await runFlow(projectId, filename)
        onRunStarted(runId)
      } catch (e) {
        const err = e as Error & { code?: string }
        alert(`运行失败：${err.message}`)
      }
    }}
    className="text-sm px-3 py-1 rounded bg-green-600 text-white hover:bg-green-700"
  >▶ 运行</button>
) : (
  <button
    onClick={async () => {
      await cancelFlow(projectId, filename)
      onCancelled()
    }}
    className="text-sm px-3 py-1 rounded bg-red-600 text-white hover:bg-red-700"
  >■ 取消</button>
)}
```

记得 `import { runFlow, cancelFlow } from '../api'`。

- [ ] **Step 2：扩展 TrackFlowEditor.tsx**

集成 `useFlowRun` + 在 GraphProvider 注入 `nodeStates` + render `FlowRunPanel` + `FlowUserInputDialog`：

```typescript
// TrackFlowEditor.tsx 增量改造（注意保留 M1 加载逻辑 / dirty close confirm 等）
import { useFlowRun } from './useFlowRun'
import { FlowRunPanel } from './FlowRunPanel'
import { FlowUserInputDialog } from './FlowUserInputDialog'
import { submitUserInput } from '../api'
import { useProjectWs } from '../../../hooks/useProjectWs'   // 假设有这个 hook；若没，read 现有 useTrackState 或 ChatOverlay 找 ws 源

// 在 component 内：
const { state: runState, attachRunId, reset: resetRun } = useFlowRun({ projectId, projectWs })

const onRunStarted = (runId: string) => attachRunId(runId)
const onCancelled = () => { /* nothing — WS will emit flow_cancelled */ }

const handleSubmitUserInput = async (values: Record<string, unknown>) => {
  if (!runState.runId) return
  await submitUserInput(projectId, filename, runState.runId, values)
}

const handleCancelUserInput = async () => {
  if (!runState.runId) return
  await cancelFlow(projectId, filename, runState.runId)
  resetRun()
}

// 在 GraphProvider 注入 nodeStates
<GraphProvider value={{ dispatch, nodeStates: runState.nodeStates }}>
  ...
</GraphProvider>

// 在主区域底部加 FlowRunPanel
<FlowRunPanel flow={flow} run={runState} />

// 用 portal 渲染 user input dialog
{runState.pendingUserInput && (
  <FlowUserInputDialog
    open
    flow={flow}
    pending={runState.pendingUserInput}
    onSubmit={handleSubmitUserInput}
    onCancel={handleCancelUserInput}
  />
)}

// 把 onRunStarted 传给 FlowToolbar
<FlowToolbar
  ...
  runStatus={runState.status === 'idle' ? 'idle' : runState.status}
  onRunStarted={onRunStarted}
  onCancelled={onCancelled}
/>
```

**重要**：`useProjectWs` hook 实际名可能不存在。subagent 必须**read `frontend/src/pages/ProjectPage.tsx` 或 `useTrackState.ts`**确认项目 WS 单例在哪暴露。M1 已有 `useTrackState.ts`（v2 时期），可能含 WS 引用。如果实在没有现成 hook → BLOCKED，让 controller 补一个 useProjectWs 抽象。

- [ ] **Step 3：tsc 通过 + frontend build 通过**

```bash
cd /Users/tom/Projects/cc-web/frontend
npx tsc --noEmit
npm run build 2>&1 | tail -5
```

- [ ] **Step 4：Commit**

```bash
git add frontend/src/components/tracks/flow/FlowToolbar.tsx \
  frontend/src/components/tracks/flow/TrackFlowEditor.tsx
git commit -m "feat(track-flow): TrackFlowEditor — integrate useFlowRun + run/cancel + user_input dialog"
```

---

## Task 15：verify-flow-v3 E2E smoke

**Files:**
- Create: `backend/src/track-flow/__tests__/verify-flow-v3.ts`

按 spec §15.3 + 用户原始研究循环例子构造 FlowV3 → runtime 跑通到 done。**用 mock injector**（不真起 PTY），mock injector 收到 prompt 后**直接写**预设的 train.json 模拟 LLM 回写。

- [ ] **Step 1：实现 verify-flow-v3.ts**

```typescript
// backend/src/track-flow/__tests__/verify-flow-v3.ts
/**
 * E2E smoke: build FlowV3 → runtime → run to completion or known failure.
 *
 * Uses a mock injector that simulates LLM behavior by writing predetermined
 * values into train.json after prompt injection. Covers the spec §2 example:
 *
 *   user_input → llm(research) → llm(check) → if has_error → loop / end
 */
import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import { runFlow, type FlowV3 } from '../runtime'
import { flowRunRegistry } from '../run-registry'
import { copyToProjectCwd } from '../train-json-sync'
import { submitUserInputForRun } from '../runtime'

interface CheckResult { name: string; ok: boolean; detail?: string }
const results: CheckResult[] = []
function check(name: string, ok: boolean, detail?: string) {
  results.push({ name, ok, detail })
  console.log(`${ok ? '✓' : '✗'} ${name}${detail ? `  — ${detail}` : ''}`)
}

async function main() {
  const testDir = fs.mkdtempSync(path.join(os.tmpdir(), 'verify-flow-v3-'))

  // 模拟"LLM 回写序列"：检查节点的 has_error 第一次返 true（触发循环回去），第二次返 false（退出）
  let checkCallCount = 0
  const mockInjector = async (prompt: string) => {
    // 等 5ms 模拟"LLM 处理时间"
    await new Promise((r) => setTimeout(r, 5))
    // 读当前 cwd train.json
    const trainJsonPath = path.join(testDir, 'train.json')
    const current = JSON.parse(fs.readFileSync(trainJsonPath, 'utf8'))
    if (prompt.includes('请调研')) {
      // research 节点：写 ref_fp
      current.ref_fp = './test.bibtex'
    } else if (prompt.includes('请检查')) {
      // check 节点：第 1 次 has_error=true（loop），第 2 次 has_error=false（end）
      checkCallCount += 1
      current.has_error = checkCallCount === 1 ? true : false
    }
    // 原子写
    fs.writeFileSync(trainJsonPath + '.tmp', JSON.stringify(current))
    fs.renameSync(trainJsonPath + '.tmp', trainJsonPath)
  }

  // 构造研究循环 flow
  const flow: FlowV3 = {
    version: 3,
    trackName: 'research-loop',
    adapter: 'claude-code',
    variables: [
      { key: 'area', description: '研究领域', initialValue: null },
      { key: 'ref_fp', description: '文献存储 bibtex 格式文件的路径', initialValue: null },
      { key: 'has_error', description: '文献存在错误', initialValue: null },
    ],
    nodes: [
      { id: 'n_input', type: 'user_input', position: { x: 0, y: 0 }, fields: [{ varKey: 'area', uiHint: 'text' }] },
      { id: 'n_research', type: 'llm', position: { x: 0, y: 100 },
        promptTemplate: '请调研@{area}的科研论文，结果填写到${ref_fp}中',
        inputs: ['area'], outputs: ['ref_fp'] },
      { id: 'n_check', type: 'llm', position: { x: 0, y: 200 },
        promptTemplate: '请检查@{ref_fp}中的论文，相关性@{area}，结果${has_error}',
        inputs: ['area', 'ref_fp'], outputs: ['has_error'] },
      { id: 'n_if', type: 'if', position: { x: 0, y: 300 }, conditionExpr: 'has_error == true' },
    ],
    edges: [
      { id: 'e1', source: 'n_input', target: 'n_research' },
      { id: 'e2', source: 'n_research', target: 'n_check' },
      { id: 'e3', source: 'n_check', target: 'n_if' },
      { id: 'e4', source: 'n_if', sourceHandle: 'true', target: 'n_check' },   // retry
      { id: 'e5', source: 'n_if', sourceHandle: 'false', target: null },        // end
    ],
  }

  // 准备 run
  const runId = 'verify_run_1'
  const events: { type: string; payload: Record<string, unknown> }[] = []
  flowRunRegistry.start({ runId, projectId: 'p_verify', basename: 'research-loop' })

  // 模拟 user 提交 area=逆合成（异步）
  setTimeout(() => {
    submitUserInputForRun(runId, { area: '逆合成' })
  }, 100)

  await runFlow(flow, {}, {
    projectFolder: testDir,
    basename: 'research-loop',
    runId,
    injector: mockInjector,
    broadcast: (event, payload) => events.push({ type: event, payload }),
  })

  // 断言
  const info = flowRunRegistry.get(runId)
  check('run completed', info?.status === 'completed', `status=${info?.status}`)
  check('check called 2 times (loop once)', checkCallCount === 2, `count=${checkCallCount}`)
  check('flow_node_active emitted >= 4 times', events.filter((e) => e.type === 'flow_node_active').length >= 4)
  check('flow_done emitted', events.some((e) => e.type === 'flow_done'))
  check('has_error final = false', events.filter((e) => e.type === 'flow_var_changed' && e.payload.key === 'has_error').slice(-1)[0]?.payload.value === false)

  // 清理
  fs.rmSync(testDir, { recursive: true, force: true })

  const fails = results.filter((r) => !r.ok)
  console.log(`\n${results.length - fails.length}/${results.length} checks passed`)
  if (fails.length > 0) {
    console.log('FAILED:')
    fails.forEach((r) => console.log(`  ✗ ${r.name}${r.detail ? ` — ${r.detail}` : ''}`))
    process.exit(1)
  }
}

main().catch((e) => {
  console.error('verify failed with exception:', e)
  process.exit(1)
})
```

- [ ] **Step 2：在 backend/package.json 加 verify script**

```json
"verify:flow-v3": "tsx src/track-flow/__tests__/verify-flow-v3.ts"
```

注意 backend 默认用 ts-node，但 verify-flow-v3 也可以用 tsx（frontend 装的 tsx 可以全局调，或者 backend 复用 ts-node）。若 backend 没装 tsx，用 ts-node：

```json
"verify:flow-v3": "ts-node src/track-flow/__tests__/verify-flow-v3.ts"
```

- [ ] **Step 3：跑 verify**

```bash
cd /Users/tom/Projects/cc-web/backend
npm run verify:flow-v3
```

预期：5/5 checks pass。

- [ ] **Step 4：Commit**

```bash
git add backend/src/track-flow/__tests__/verify-flow-v3.ts \
  backend/package.json
git commit -m "test(track-flow): verify-flow-v3 E2E smoke — research-loop with mock injector"
```

---

## Task 16：bump v-19-a + commit + push + 等用户 publish

**Files:**
- Modify: `package.json` / `README.md` / `CLAUDE.md`

- [ ] **Step 1：全量验证**

```bash
cd /Users/tom/Projects/cc-web/frontend
npx vitest run 2>&1 | tail -10                          # M1 33 tests
npx tsc --noEmit
npm run build 2>&1 | tail -3

cd /Users/tom/Projects/cc-web/backend
npx vitest run 2>&1 | tail -10                          # M2 ~50 tests（5 文件）
npx tsc --noEmit
npm run build 2>&1 | tail -3
npm run verify:flow-v3 2>&1 | tail -8
```

预期：frontend 33 tests pass / backend ~50 tests pass / verify-flow-v3 5/5 pass / 两边 build OK。

- [ ] **Step 2：bump 版本号**

```bash
date "+%Y.%-m.%-d"
```

如今天 2026-05-18 → 新版 `2026.5.18-e`；如 2026-05-19+ → `2026.5.19-a`。

修改 3 文件：
- `package.json` `version`
- `README.md` `**Current version**: v<NEW>` 行
- `CLAUDE.md` `**当前版本**: v<NEW>` 行

- [ ] **Step 3：Commit + push**

```bash
cd /Users/tom/Projects/cc-web
git add package.json README.md CLAUDE.md \
  docs/superpowers/plans/2026-05-18-track-v3-M2-runtime.md
git commit -m "release: v<NEW> — track-flow v3 M2 runtime（首版能跑通研究循环）

v3 工作轨首次能端到端运行：

后端 runtime：
- prompt-translator（@/\$ 转译 + 系统指令段）
- if-expr parser/evaluator（受限 DSL + null 安全语义）
- train-json-sync（原子写 + flush 等待 + 白名单过滤）
- llm-dispatcher（PTY 注入 + 文件 mtime 监听）
- runtime state machine（user_input/llm/if 节点）
- run-registry（锁 + 409 拒绝 + 三道防线：节点 iter / LLM calls / duration）
- audit-log（.flow.runs/<runId>.log.jsonl）
- daemon 启动清理 cwd train.json
- WS 事件：flow_started / node_active / node_completed / node_failed / var_changed / user_input_required / done / cancelled

后端 routes：
- POST /track-flows/file/:filename/run（含 409 FLOW_ALREADY_RUNNING）
- POST cancel
- POST user_input
- GET runs/active

前端：
- useFlowRun WS 订阅 hook
- FlowRunPanel（变量值实时刷新 + 节点状态 + quota 实时）
- FlowUserInputDialog（运行时弹表单）
- 节点状态边框（黄 pulse / 绿 ✓ / 红 ✗ / 灰划线）
- FlowToolbar 加运行/取消按钮

测试：backend 50+ tests / verify-flow-v3 E2E 5/5（mock injector 模拟研究循环 retry 一次后 end）

实施 plan：docs/superpowers/plans/2026-05-18-track-v3-M2-runtime.md

下一步：M3 浏览器手测打磨 + M4 发版 v-19-a"
git push origin main
```

- [ ] **Step 4：等 controller 授权 npm publish**

**Subagent 不自行 publish**。报告 commit sha + push 状态后停止。

## Self-Review

**Spec coverage** (spec §5-§10 runtime 全部 + §14.3 运行时错误)：
- §5.4 受限 if 语法 ✓ T2/T3
- §6.1 user_input runtime 行为 ✓ T7 (executeUserInputNode) + T11 (Dialog)
- §6.2 LLM runtime + outputs 必改 + 白名单 ✓ T6/T7
- §6.3 if 节点求值 ✓ T3/T7
- §6.4 隐式 end ✓ T7 (pickNext 返 null = 终止)
- §7 Prompt 转译 ✓ T1
- §8.2 train.json 原子写 + flush + 白名单 ✓ T4
- §8.3 同轨锁 + 409 ✓ T5 (FlowRunRegistry)
- §8.4 变量变更审计 log ✓ T5 (audit-log)
- §9.1-§9.5 state machine + 三道防线 ✓ T5/T7
- §9.6 daemon 重启清理 ✓ T5 (cleanupStaleCwdFiles) + T8 (wire)
- §9.7 取消 ✓ T5/T8
- §10 WS 事件 ✓ T7/T8 (broadcast wire)
- §14.3 运行时错误 ✓ T6/T7

**M2 不含**（M3 / M4 范围）：
- 浏览器手测（M3）
- 完整运行可视化打磨（M3）
- verify-flow-v3 更多 cases / Playwright（M4）
- v-19-a 真实发版（M4）

**Placeholder scan**：
- Task 8 Step 3 "terminalManager.injectText" cast — 实施者必须 read terminal-manager.ts 确认真实方法名。如果不存在 → BLOCKED。
- Task 14 useProjectWs hook — 实施者必须 read ProjectPage / useTrackState 找现有 WS 抽象。如果没现成 → BLOCKED + controller 补 hook。
- 无 TBD / implement later。

**Type consistency**：
- VarDecl 在 prompt-translator / runtime 重复定义但 shape 一致（backend 不直接 import frontend types）
- FlowV3 / NodeV3 / EdgeV3 在 runtime.ts 重复定义（spec §5.2 + frontend flow-types-v3.ts 同 shape）
- RunInfo / RunQuota 在 run-registry 唯一定义
- WS event 名字（flow_started / flow_node_active 等）在 backend runtime emit + frontend useFlowRun applyEvent 严格一致

**已知风险**：
- terminal-manager.injectText / inject 真实方法名 — Task 8 Step 4 必须 read 现有代码确认
- useProjectWs hook 是否存在 — Task 14 Step 2 必须 read 确认
- llm-dispatcher 600s 超时 + 文件 mtime polling 可能漏掉"LLM 写完后又改"的二次写（M3 可优化用 chokidar）
- runFlow 错误传播：dispatch 异常时 finish('failed') 不调 broadcast finish 的 catch 是否会 leak run — 实施 + verify-flow-v3 跑通后再看
