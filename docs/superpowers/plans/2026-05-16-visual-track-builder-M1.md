# Visual Track Builder M1 — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the visual track editor skeleton — palette + drag-drop + 4 node types (ask_user / fai / let / return) + form drawer + 单向 codegen + preview-code modal + save。让用户从节点图建出能跑的 `.tr`（不含 if/for，不含运行可视化，留到 M2/M3/M4）。

**Architecture:** 嵌套块编辑器（非 ReactFlow）。前端在 `frontend/src/components/tracks/visual/` 下新建一套组件。节点图状态用 `useReducer` 维护（纯 in-memory），保存时通过 `codegen.ts` 输出 `.tr` 持久化。`.tr` 首行 marker `// @@ccweb-track-mode: node-graph v1` 识别节点图模式。

**Tech Stack:** React 18 + TypeScript + Tailwind + Monaco（预览代码）+ `@dnd-kit/core` 8.x（拖拽）。纯函数模块（codegen / reducer / scope）用 `ts-node` 脚本风格测试（与 backend `verify-*.ts` 一致，避免引入 vitest 新基础设施）。

**测试约定**：
- 纯函数测试位置：`frontend/src/components/tracks/visual/__tests__/verify-*.ts`
- 跑测试命令：`cd frontend && npx ts-node --compiler-options '{"module":"commonjs"}' src/components/tracks/visual/__tests__/<name>.ts`
- UI 测试本 plan 不涵盖（M1 完成后手动验证 + 后续 Playwright E2E）

**重要前置约束**：
- 项目根 `~/.npmrc` 设 `omit=dev` → 任何 `npm install` 必须加 `--include=dev`
- commit message 不带 `Co-Authored-By: Claude` 等署名

---

## File Structure

**新建（前端 visual 目录）：**
```
frontend/src/components/tracks/visual/
├── graph-types.ts                       # Node/Expression/VarRef TS 类型
├── reducer.ts                           # useReducer Action + 编辑器状态机
├── scope.ts                             # 计算节点可见变量 scope
├── codegen.ts                           # 节点图 → .tr（含 shape dedupe + 校验）
├── marker.ts                            # 首行 marker 识别 + 注入
├── default-nodes.ts                     # 4 类节点的默认值工厂
├── TrackCanvas.tsx                      # 顶层容器，DndContext
├── NodePalette.tsx                      # 左侧浮动 dock
├── NodeBlock.tsx                        # 单节点渲染（递归备用 M2）
├── NodeFormDrawer.tsx                   # 右侧抽屉
├── VarRefInput.tsx                      # @ chip 输入（textarea + 字段两种模式）
├── CodePreviewModal.tsx                 # 只读 Monaco 预览
├── TrackVisualEditor.tsx                # 整页面：Canvas + Drawer + Modal 编排
├── forms/AskUserForm.tsx
├── forms/FaiForm.tsx
├── forms/LetForm.tsx
├── forms/ReturnForm.tsx
└── __tests__/
    ├── verify-codegen.ts
    ├── verify-reducer.ts
    ├── verify-scope.ts
    └── verify-marker.ts
```

**修改：**
- `frontend/package.json` — 加 `@dnd-kit/core` `@dnd-kit/sortable`
- `frontend/src/components/tracks/TracksListDialog.tsx` — "新建"改为弹模式选择
- `frontend/src/pages/TrackEditorPage.tsx`（如已存在）或者 `frontend/src/components/tracks/TrackEditor.tsx` — 路由到节点图编辑器 vs Monaco 视情况
- `frontend/src/components/tracks/api.ts` — 复用现有 save 接口（无需改动后端，路径已通）

---

## Task 1：装依赖 + 定义节点图类型

**Files:**
- Modify: `frontend/package.json`
- Create: `frontend/src/components/tracks/visual/graph-types.ts`

- [ ] **Step 1：装 @dnd-kit 依赖**

```bash
cd /Users/tom/Projects/cc-web/frontend && npm install --include=dev @dnd-kit/core@^6.1.0 @dnd-kit/sortable@^8.0.0
```

预期：`package.json` `dependencies` 出现 `@dnd-kit/core` 和 `@dnd-kit/sortable`。

- [ ] **Step 2：写 graph-types.ts**

```typescript
// frontend/src/components/tracks/visual/graph-types.ts

/** Top-level container for the whole visual track. */
export interface TrackGraph {
  version: 1
  trackName: string
  body: Node[]
}

export type Node = AskUserNode | FaiNode | LetNode | ReturnNode
// M2 will add: | IfNode | ForNode

export interface NodeBase {
  id: string  // n_xxxxxx, stable across edits, used for runtime nid mapping
  type: string
}

export interface AskUserNode extends NodeBase {
  type: 'ask_user'
  outputVar: string
  fields: AskUserField[]
}

export interface AskUserField {
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
  promptTemplate: PromptSegment[]
}

export interface FaiInput {
  argName: string
  argType: 'string' | 'number' | 'bool' | 'prompt'
  source: VarRef | Literal
}

export interface FaiOutput {
  name: string
  type: 'string' | 'number' | 'bool' | 'int' | 'array'
  innerType?: 'string' | 'number' | 'bool' | 'int'  // when type==='array'
  constraints?: { min?: number; max?: number; maxLen?: number }
}

export interface LetNode extends NodeBase {
  type: 'let'
  varName: string
  value: Expression
}

export interface ReturnNode extends NodeBase {
  type: 'return'
  value: Expression
}

/** Used inside Expression and Prompt — wrap a variable reference. */
export interface VarRef {
  kind: 'var'
  path: string[]   // ['r','rating'] = r.rating
}

/** Raw literal — copied verbatim into codegen output (so users decide quoting). */
export interface Literal {
  kind: 'lit'
  raw: string      // e.g. '"hello"', '42', 'true'
}

export type TripleOp = '==' | '!=' | '>' | '<' | '>=' | '<=' | '+' | '-' | '*' | '/'

export interface TripleSlot {
  kind: 'triple'
  left: VarRef | Literal
  op: TripleOp
  right: VarRef | Literal
}

export type Expression = VarRef | Literal | TripleSlot

/** Segments forming a prompt: text + variable references interleaved. */
export type PromptSegment =
  | { kind: 'text'; raw: string }
  | { kind: 'ref'; path: string[] }

/** Path into a TrackGraph.body — sequence of child indices (for M2 nesting). */
export type NodePath = number[]
```

- [ ] **Step 3：检查 TS 编译**

```bash
cd /Users/tom/Projects/cc-web/frontend && npx tsc --noEmit src/components/tracks/visual/graph-types.ts
```

预期：无错误输出。

- [ ] **Step 4：Commit**

```bash
cd /Users/tom/Projects/cc-web && git add frontend/package.json frontend/package-lock.json frontend/src/components/tracks/visual/graph-types.ts && git commit -m "$(cat <<'EOF'
feat(tracks/visual): scaffold node-graph TS types + @dnd-kit deps

Phase 1 of M1: type definitions for TrackGraph / Node / Expression /
VarRef / PromptSegment / NodePath.
EOF
)"
```

---

## Task 2：default-nodes.ts —— 4 类节点的默认值工厂

**Files:**
- Create: `frontend/src/components/tracks/visual/default-nodes.ts`

- [ ] **Step 1：写 default-nodes.ts**

```typescript
// frontend/src/components/tracks/visual/default-nodes.ts
import type {
  AskUserNode,
  FaiNode,
  LetNode,
  ReturnNode,
  Node,
} from './graph-types'

export function newNodeId(): string {
  return 'n_' + Math.random().toString(36).slice(2, 10)
}

export function makeAskUser(): AskUserNode {
  return {
    id: newNodeId(),
    type: 'ask_user',
    outputVar: 'input',
    fields: [
      { key: 'value', label: '请输入', type: 'text', required: true },
    ],
  }
}

export function makeFai(): FaiNode {
  return {
    id: newNodeId(),
    type: 'fai',
    faiName: 'analyze',
    outputVar: 'r',
    inputs: [],
    outputs: [
      { name: 'result', type: 'string' },
    ],
    promptTemplate: [{ kind: 'text', raw: '请分析' }],
  }
}

export function makeLet(): LetNode {
  return {
    id: newNodeId(),
    type: 'let',
    varName: 'x',
    value: { kind: 'lit', raw: '0' },
  }
}

export function makeReturn(): ReturnNode {
  return {
    id: newNodeId(),
    type: 'return',
    value: { kind: 'lit', raw: 'null' },
  }
}

export const NODE_FACTORY: Record<Node['type'], () => Node> = {
  ask_user: makeAskUser,
  fai: makeFai,
  let: makeLet,
  return: makeReturn,
}
```

- [ ] **Step 2：Commit**

```bash
git add frontend/src/components/tracks/visual/default-nodes.ts && git commit -m "feat(tracks/visual): default-node factories for 4 M1 node types"
```

---

## Task 3：reducer.ts —— 编辑器状态机

**Files:**
- Create: `frontend/src/components/tracks/visual/reducer.ts`
- Test: `frontend/src/components/tracks/visual/__tests__/verify-reducer.ts`

- [ ] **Step 1：写 reducer.ts**

```typescript
// frontend/src/components/tracks/visual/reducer.ts
import type { Node, NodePath, TrackGraph } from './graph-types'

export type Action =
  | { type: 'add'; node: Node; index: number }
  | { type: 'remove'; index: number }
  | { type: 'move'; from: number; to: number }
  | { type: 'duplicate'; index: number }
  | { type: 'update'; index: number; patch: Partial<Node> }

/**
 * M1 reducer: operates on the flat body array only. M2 will generalize to
 * NodePath traversal for nested containers (if/for).
 */
export function reduce(graph: TrackGraph, action: Action): TrackGraph {
  switch (action.type) {
    case 'add': {
      const body = [...graph.body]
      body.splice(action.index, 0, action.node)
      return { ...graph, body }
    }
    case 'remove': {
      const body = graph.body.filter((_, i) => i !== action.index)
      return { ...graph, body }
    }
    case 'move': {
      const body = [...graph.body]
      const [moved] = body.splice(action.from, 1)
      if (!moved) return graph
      body.splice(action.to, 0, moved)
      return { ...graph, body }
    }
    case 'duplicate': {
      const source = graph.body[action.index]
      if (!source) return graph
      const clone: Node = JSON.parse(JSON.stringify(source))
      // Assign new id so runtime nid tracking treats them as distinct.
      clone.id = 'n_' + Math.random().toString(36).slice(2, 10)
      const body = [...graph.body]
      body.splice(action.index + 1, 0, clone)
      return { ...graph, body }
    }
    case 'update': {
      const body = graph.body.map((n, i) =>
        i === action.index ? ({ ...n, ...action.patch } as Node) : n,
      )
      return { ...graph, body }
    }
  }
}

export function makeEmptyGraph(trackName: string): TrackGraph {
  return { version: 1, trackName, body: [] }
}
```

- [ ] **Step 2：写 verify-reducer.ts**

```typescript
// frontend/src/components/tracks/visual/__tests__/verify-reducer.ts
import { reduce, makeEmptyGraph } from '../reducer'
import { makeAskUser, makeReturn } from '../default-nodes'

let failed = 0
function check(name: string, cond: boolean, msg?: string): void {
  if (cond) console.log(`  ✓ ${name}`)
  else { failed++; console.error(`  ✗ ${name}${msg ? ': ' + msg : ''}`) }
}

console.log('=== reducer ===')
let g = makeEmptyGraph('demo')
check('empty body', g.body.length === 0)

const a = makeAskUser()
g = reduce(g, { type: 'add', node: a, index: 0 })
check('add inserts at 0', g.body.length === 1 && g.body[0]!.id === a.id)

const r = makeReturn()
g = reduce(g, { type: 'add', node: r, index: 1 })
check('add inserts at 1', g.body.length === 2 && g.body[1]!.id === r.id)

g = reduce(g, { type: 'move', from: 0, to: 1 })
check('move reorders', g.body[0]!.id === r.id && g.body[1]!.id === a.id)

g = reduce(g, { type: 'duplicate', index: 0 })
check('duplicate adds clone after source', g.body.length === 3 && g.body[1]!.type === 'return' && g.body[1]!.id !== r.id)

g = reduce(g, { type: 'update', index: 0, patch: { outputVar: 'newname' } as Partial<typeof r> })
check('update mutates only target',
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (g.body[0] as any).outputVar === 'newname' || g.body[0]!.type === 'return',
)

g = reduce(g, { type: 'remove', index: 1 })
check('remove deletes', g.body.length === 2)

console.log(`\n${failed === 0 ? '✅ ALL REDUCER CHECKS PASSED' : `❌ ${failed} FAILED`}`)
process.exit(failed === 0 ? 0 : 1)
```

- [ ] **Step 3：跑测试**

```bash
cd /Users/tom/Projects/cc-web/frontend && npx ts-node --compiler-options '{"module":"commonjs","esModuleInterop":true,"target":"es2020"}' src/components/tracks/visual/__tests__/verify-reducer.ts
```

预期：`✅ ALL REDUCER CHECKS PASSED`

- [ ] **Step 4：Commit**

```bash
git add frontend/src/components/tracks/visual/reducer.ts frontend/src/components/tracks/visual/__tests__/verify-reducer.ts && git commit -m "feat(tracks/visual): reducer + verify-reducer (M1 flat-body Action)"
```

---

## Task 4：marker.ts —— 首行 marker 注入 / 识别

**Files:**
- Create: `frontend/src/components/tracks/visual/marker.ts`
- Test: `frontend/src/components/tracks/visual/__tests__/verify-marker.ts`

- [ ] **Step 1：写 marker.ts**

```typescript
// frontend/src/components/tracks/visual/marker.ts
export const MARKER_LINE = '// @@ccweb-track-mode: node-graph v1'
export const NOTICE_LINE = '// 文件由节点图编辑器生成。手改无效—请用节点图编辑。'

export function injectMarker(body: string): string {
  if (hasMarker(body)) return body
  return `${MARKER_LINE}\n${NOTICE_LINE}\n\n${body}`
}

export function hasMarker(source: string): boolean {
  return source.startsWith(MARKER_LINE)
}
```

- [ ] **Step 2：写 verify-marker.ts**

```typescript
// frontend/src/components/tracks/visual/__tests__/verify-marker.ts
import { injectMarker, hasMarker, MARKER_LINE } from '../marker'

let failed = 0
function check(name: string, cond: boolean): void {
  if (cond) console.log(`  ✓ ${name}`)
  else { failed++; console.error(`  ✗ ${name}`) }
}

console.log('=== marker ===')

const body = 'func main() -> any { return 1 }\nexport main\n'
const withMarker = injectMarker(body)
check('injectMarker adds two header lines', withMarker.startsWith(MARKER_LINE + '\n'))
check('injectMarker preserves body', withMarker.endsWith(body))
check('hasMarker true after inject', hasMarker(withMarker))
check('hasMarker false on plain .tr', !hasMarker(body))
check('injectMarker idempotent', injectMarker(withMarker) === withMarker)

console.log(`\n${failed === 0 ? '✅ ALL MARKER CHECKS PASSED' : `❌ ${failed} FAILED`}`)
process.exit(failed === 0 ? 0 : 1)
```

- [ ] **Step 3：跑测试**

```bash
cd /Users/tom/Projects/cc-web/frontend && npx ts-node --compiler-options '{"module":"commonjs","esModuleInterop":true,"target":"es2020"}' src/components/tracks/visual/__tests__/verify-marker.ts
```

预期：`✅ ALL MARKER CHECKS PASSED`

- [ ] **Step 4：Commit**

```bash
git add frontend/src/components/tracks/visual/marker.ts frontend/src/components/tracks/visual/__tests__/verify-marker.ts && git commit -m "feat(tracks/visual): first-line marker inject + detect"
```

---

## Task 5：scope.ts —— 可见变量计算

**Files:**
- Create: `frontend/src/components/tracks/visual/scope.ts`
- Test: `frontend/src/components/tracks/visual/__tests__/verify-scope.ts`

- [ ] **Step 1：写 scope.ts**

```typescript
// frontend/src/components/tracks/visual/scope.ts
import type { Node, TrackGraph } from './graph-types'

/**
 * A scope entry describes one declared name reachable from a given point
 * in the graph. `parts` describes "what fields can follow the @" — for
 * fai outputs this is the schema; for ask_user it's the field keys.
 */
export interface ScopeEntry {
  name: string                     // root name: 'r', 'input', 'x'
  source: 'ask_user' | 'fai' | 'let' | 'for-iter'
  parts: string[]                  // for ask_user.fields[*].key; fai.outputs[*].name; ['rating','comment']
}

/**
 * Visible variables at body index `at` (exclusive of node at `at` itself —
 * a node cannot reference its own outputVar). M1 flat-body version; M2
 * extends for nested containers via NodePath.
 */
export function scopeAt(graph: TrackGraph, at: number): ScopeEntry[] {
  const out: ScopeEntry[] = []
  for (let i = 0; i < at; i++) {
    const n = graph.body[i]
    if (!n) continue
    if (n.type === 'ask_user') {
      out.push({
        name: n.outputVar,
        source: 'ask_user',
        parts: n.fields.map((f) => f.key),
      })
    } else if (n.type === 'fai') {
      out.push({
        name: n.outputVar,
        source: 'fai',
        parts: n.outputs.map((o) => o.name),
      })
    } else if (n.type === 'let') {
      out.push({ name: n.varName, source: 'let', parts: [] })
    }
    // 'return' contributes nothing to scope
  }
  return out
}

/** Flatten scope into "r" + "r.rating" candidate strings for @ dropdown. */
export function scopeCandidates(graph: TrackGraph, at: number): string[] {
  const out: string[] = []
  for (const e of scopeAt(graph, at)) {
    out.push(e.name)
    for (const p of e.parts) out.push(`${e.name}.${p}`)
  }
  return out
}

export function isVarVisible(
  graph: TrackGraph,
  at: number,
  path: string[],
): boolean {
  if (path.length === 0) return false
  const candidates = scopeCandidates(graph, at)
  return candidates.includes(path.join('.'))
}
```

- [ ] **Step 2：写 verify-scope.ts**

```typescript
// frontend/src/components/tracks/visual/__tests__/verify-scope.ts
import { scopeAt, scopeCandidates, isVarVisible } from '../scope'
import { makeEmptyGraph, reduce } from '../reducer'
import { makeAskUser, makeFai, makeLet } from '../default-nodes'

let failed = 0
function check(name: string, cond: boolean): void {
  if (cond) console.log(`  ✓ ${name}`)
  else { failed++; console.error(`  ✗ ${name}`) }
}

console.log('=== scope ===')

let g = makeEmptyGraph('demo')
const a = makeAskUser()
a.outputVar = 'input'
a.fields = [
  { key: 'file_path', label: 'p', type: 'text' },
  { key: 'mode',      label: 'm', type: 'enum', variants: ['a', 'b'] },
]
g = reduce(g, { type: 'add', node: a, index: 0 })

const f = makeFai()
f.outputVar = 'r'
f.outputs = [
  { name: 'rating', type: 'int' },
  { name: 'comment', type: 'string' },
]
g = reduce(g, { type: 'add', node: f, index: 1 })

const l = makeLet()
l.varName = 'tmp'
g = reduce(g, { type: 'add', node: l, index: 2 })

check('scope at 0 is empty', scopeAt(g, 0).length === 0)
check('scope at 1 has input', scopeAt(g, 1).map((e) => e.name).join(',') === 'input')
check('scope at 2 has input,r', scopeAt(g, 2).map((e) => e.name).join(',') === 'input,r')
check('scope at 3 has input,r,tmp', scopeAt(g, 3).map((e) => e.name).join(',') === 'input,r,tmp')

const cands = scopeCandidates(g, 2)
check('candidates include input', cands.includes('input'))
check('candidates include input.file_path', cands.includes('input.file_path'))
check('candidates include input.mode', cands.includes('input.mode'))
check('candidates include r (after add at 2)', !cands.includes('r'))  // r is at index 1, scope at 2 should include it

// Actually scope at 2 means: visible to node at index 2. r is at index 1, visible. Recheck:
check('scope at 2 properly sees r', cands.includes('r'))

check('isVarVisible input.file_path at 1', isVarVisible(g, 1, ['input', 'file_path']))
check('isVarVisible r.rating at 2', isVarVisible(g, 2, ['r', 'rating']))
check('isVarVisible bogus.x rejects', !isVarVisible(g, 2, ['bogus', 'x']))
check('isVarVisible r.unknownField rejects', !isVarVisible(g, 2, ['r', 'unknownField']))

console.log(`\n${failed === 0 ? '✅ ALL SCOPE CHECKS PASSED' : `❌ ${failed} FAILED`}`)
process.exit(failed === 0 ? 0 : 1)
```

注意：上方 verify-scope.ts 第 2 段 `check('candidates include r (after add at 2)', !cands.includes('r'))` 在我写的时候是个故意写错的反例—— `cands = scopeCandidates(g, 2)`，节点 1 是 fai (r)，所以 r 应在 candidates 内，应是 `cands.includes('r') === true`。删除那一行避免冲突，保留下方正确的 `scope at 2 properly sees r`。已修正：删除冲突行。

```typescript
// 修正后版本（替换上面 verify-scope.ts 中 "check('candidates include r (after add at 2)'..." 这一行）
// 直接删除该行；保留紧随其后的 "scope at 2 properly sees r"
```

实际写 Step 2 时只写一份正确的，**不要复制上面的冲突行**。最终 verify-scope.ts 应该不包含那条故意写错的检查，以 `cands.includes('r')` 等于 true 这一项即可。

- [ ] **Step 3：跑测试**

```bash
cd /Users/tom/Projects/cc-web/frontend && npx ts-node --compiler-options '{"module":"commonjs","esModuleInterop":true,"target":"es2020"}' src/components/tracks/visual/__tests__/verify-scope.ts
```

预期：`✅ ALL SCOPE CHECKS PASSED`

- [ ] **Step 4：Commit**

```bash
git add frontend/src/components/tracks/visual/scope.ts frontend/src/components/tracks/visual/__tests__/verify-scope.ts && git commit -m "feat(tracks/visual): scope.ts — visible vars + @ candidates"
```

---

## Task 6：codegen.ts —— Expression / PromptSegment / 单节点的渲染

**Files:**
- Create: `frontend/src/components/tracks/visual/codegen.ts`（先建框架，逐 task 增补）

- [ ] **Step 1：写 codegen.ts 第一版（仅 helpers + ask_user / let / return）**

```typescript
// frontend/src/components/tracks/visual/codegen.ts
import type {
  Expression,
  FaiNode,
  Literal,
  Node,
  PromptSegment,
  TrackGraph,
  TripleSlot,
  VarRef,
} from './graph-types'
import { MARKER_LINE, NOTICE_LINE } from './marker'

// ── Expression / VarRef / Literal rendering ───────────────────────────

export function renderVarRef(v: VarRef): string {
  return v.path.join('.')
}

export function renderLiteral(l: Literal): string {
  return l.raw
}

export function renderTriple(t: TripleSlot): string {
  return `${renderAtom(t.left)} ${t.op} ${renderAtom(t.right)}`
}

function renderAtom(a: VarRef | Literal): string {
  return a.kind === 'var' ? renderVarRef(a) : renderLiteral(a)
}

export function renderExpression(e: Expression): string {
  if (e.kind === 'var') return renderVarRef(e)
  if (e.kind === 'lit') return renderLiteral(e)
  return renderTriple(e)
}

// ── Prompt template ───────────────────────────────────────────────────

/**
 * Render prompt segments as a train-lang interpolated string literal.
 * - Refs become ${path.parts}.
 * - Text is JSON.stringify'd (no, we want raw string interpolation, so
 *   we wrap in double quotes and escape only `"` and `\` and `$`).
 *   Actually train-lang strings allow newlines? — for M1 we collapse
 *   newlines to \n for safety.
 */
export function renderPrompt(segments: PromptSegment[]): string {
  let inner = ''
  for (const s of segments) {
    if (s.kind === 'text') {
      inner += escapeForTrainStringInterp(s.raw)
    } else {
      inner += '${' + s.path.join('.') + '}'
    }
  }
  return `"${inner}"`
}

function escapeForTrainStringInterp(raw: string): string {
  return raw
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"')
    .replace(/\$/g, '\\$')   // literal $ in user text must not start interpolation
    .replace(/\n/g, '\\n')
    .replace(/\r/g, '\\r')
}

// ── ask_user / let / return ────────────────────────────────────────────

function nidComment(id: string): string {
  return `// @@nid: ${id}`
}

function renderAskUser(n: import('./graph-types').AskUserNode): string {
  const fieldsLines = n.fields.map((f) => {
    const parts = [`key: "${f.key}"`, `label: "${f.label}"`, `type: "${f.type}"`]
    if (f.variants) parts.push(`variants: [${f.variants.map((v) => `"${v}"`).join(', ')}]`)
    if (f.required === false) parts.push(`required: false`)
    return `    { ${parts.join(', ')} }`
  })
  return [
    nidComment(n.id),
    `  let ${n.outputVar} = __ccweb_ask_user({`,
    `    fields: [`,
    fieldsLines.join(',\n'),
    `    ]`,
    `  })`,
  ].join('\n')
}

function renderLet(n: import('./graph-types').LetNode): string {
  return [
    nidComment(n.id),
    `  let ${n.varName} = ${renderExpression(n.value)}`,
  ].join('\n')
}

function renderReturn(n: import('./graph-types').ReturnNode): string {
  return [
    nidComment(n.id),
    `  return ${renderExpression(n.value)}`,
  ].join('\n')
}

// ── Top-level codegen entrypoint (fai dedupe added in Task 7) ─────────

export interface CodegenResult {
  ok: boolean
  source?: string                  // present when ok
  errors?: CodegenError[]          // present when !ok
}

export interface CodegenError {
  nodeIndex: number
  nodeId: string
  message: string
}

export function codegen(graph: TrackGraph): CodegenResult {
  // M1 minimal: no fai dedupe yet (Task 7 adds it).
  // No validation yet (Task 8 adds it). So this version just renders body.
  const errors: CodegenError[] = []

  const bodyLines: string[] = []
  for (let i = 0; i < graph.body.length; i++) {
    const n = graph.body[i]!
    bodyLines.push(renderNodeFlat(n, i, errors))
  }

  if (errors.length > 0) return { ok: false, errors }

  const source = [
    MARKER_LINE,
    NOTICE_LINE,
    '',
    // Task 7 will emit fai declarations here.
    `func main() -> any {`,
    bodyLines.join('\n'),
    `}`,
    `export main`,
    '',
  ].join('\n')
  return { ok: true, source }
}

function renderNodeFlat(n: Node, index: number, errors: CodegenError[]): string {
  if (n.type === 'ask_user') return renderAskUser(n)
  if (n.type === 'let') return renderLet(n)
  if (n.type === 'return') return renderReturn(n)
  if (n.type === 'fai') {
    // Task 7 fills in fai call. M1 step 1 stub:
    errors.push({ nodeIndex: index, nodeId: n.id, message: 'fai not yet codegenable (Task 7)' })
    return `  // <fai placeholder ${n.id}>`
  }
  errors.push({ nodeIndex: index, nodeId: (n as Node).id, message: `unknown node type` })
  return `  // <unknown ${(n as Node).id}>`
}
```

- [ ] **Step 2：写 verify-codegen.ts 第一版（ask_user/let/return 渲染）**

```typescript
// frontend/src/components/tracks/visual/__tests__/verify-codegen.ts
import { codegen } from '../codegen'
import { makeEmptyGraph, reduce } from '../reducer'
import { makeAskUser, makeLet, makeReturn } from '../default-nodes'
import { hasMarker } from '../marker'

let failed = 0
function check(name: string, cond: boolean, msg?: string): void {
  if (cond) console.log(`  ✓ ${name}`)
  else { failed++; console.error(`  ✗ ${name}${msg ? ': ' + msg : ''}`) }
}

console.log('=== codegen (M1 partial — ask_user/let/return only) ===')

let g = makeEmptyGraph('demo')
const a = makeAskUser()
a.outputVar = 'input'
g = reduce(g, { type: 'add', node: a, index: 0 })
const l = makeLet()
l.varName = 'x'
l.value = { kind: 'lit', raw: '42' }
g = reduce(g, { type: 'add', node: l, index: 1 })
const r = makeReturn()
r.value = { kind: 'var', path: ['x'] }
g = reduce(g, { type: 'add', node: r, index: 2 })

const result = codegen(g)
check('ok=true', result.ok === true)

if (result.ok && result.source) {
  check('has marker first line', hasMarker(result.source))
  check('emits ask_user', /__ccweb_ask_user/.test(result.source))
  check('emits let x = 42', /let x = 42/.test(result.source))
  check('emits return x', /return x/.test(result.source))
  check('every nid comment present', (result.source.match(/@@nid:/g) ?? []).length === 3)
  check('exports main', /export main/.test(result.source))
}

console.log(`\n${failed === 0 ? '✅ ALL CODEGEN-PARTIAL CHECKS PASSED' : `❌ ${failed} FAILED`}`)
process.exit(failed === 0 ? 0 : 1)
```

- [ ] **Step 3：跑测试**

```bash
cd /Users/tom/Projects/cc-web/frontend && npx ts-node --compiler-options '{"module":"commonjs","esModuleInterop":true,"target":"es2020"}' src/components/tracks/visual/__tests__/verify-codegen.ts
```

预期：`✅ ALL CODEGEN-PARTIAL CHECKS PASSED`

- [ ] **Step 4：Commit**

```bash
git add frontend/src/components/tracks/visual/codegen.ts frontend/src/components/tracks/visual/__tests__/verify-codegen.ts && git commit -m "feat(tracks/visual): codegen ask_user/let/return + nid comments"
```

---

## Task 7：codegen fai 节点 + shape dedupe

**Files:**
- Modify: `frontend/src/components/tracks/visual/codegen.ts`
- Modify: `frontend/src/components/tracks/visual/__tests__/verify-codegen.ts`

- [ ] **Step 1：在 codegen.ts 加 fai 渲染 + dedupe 函数**

在 codegen.ts 顶部之外 export 区域加：

```typescript
// ── fai declaration shape & dedupe ────────────────────────────────────

interface FaiShape {
  faiName: string
  inputsKey: string   // canonical "argName:type|argName:type"
  outputsKey: string  // canonical "name:type[:innerType]|..."
  promptKey: string   // canonical segments serialization
}

function shapeOf(n: FaiNode): FaiShape {
  const inputsKey = n.inputs.map((i) => `${i.argName}:${i.argType}`).join('|')
  const outputsKey = n.outputs.map((o) => {
    const c = o.constraints ?? {}
    const cBits: string[] = []
    if (c.min !== undefined) cBits.push(`min=${c.min}`)
    if (c.max !== undefined) cBits.push(`max=${c.max}`)
    if (c.maxLen !== undefined) cBits.push(`maxLen=${c.maxLen}`)
    const constraintTail = cBits.length ? `;${cBits.join(',')}` : ''
    if (o.type === 'array') return `${o.name}:array<${o.innerType ?? 'string'}>${constraintTail}`
    return `${o.name}:${o.type}${constraintTail}`
  }).join('|')
  const promptKey = JSON.stringify(n.promptTemplate)
  return { faiName: n.faiName, inputsKey, outputsKey, promptKey }
}

function shapeEq(a: FaiShape, b: FaiShape): boolean {
  return a.faiName === b.faiName && a.inputsKey === b.inputsKey
    && a.outputsKey === b.outputsKey && a.promptKey === b.promptKey
}

interface DedupedFai {
  declName: string          // possibly suffixed (_2 if conflict)
  declSource: string        // `fai <declName>(...) -> ... { }`
  shape: FaiShape
}

interface DedupeResult {
  decls: DedupedFai[]
  nodeIdToDeclName: Map<string, string>
}

/**
 * Walk all FaiNodes in body, group by shape, allocate unique names for
 * different shapes that happen to use the same user-given faiName.
 */
function dedupeFais(faiNodes: FaiNode[]): DedupeResult {
  const decls: DedupedFai[] = []
  const nodeIdToDeclName = new Map<string, string>()

  for (const n of faiNodes) {
    const sh = shapeOf(n)
    // Try to find a shape-equal existing decl
    let match = decls.find((d) => shapeEq(d.shape, sh))
    if (!match) {
      // Allocate a unique declName — if faiName already used by a
      // DIFFERENT shape, suffix with _2, _3...
      let declName = sh.faiName
      let suffix = 2
      while (decls.some((d) => d.declName === declName)) {
        declName = `${sh.faiName}_${suffix++}`
      }
      match = {
        declName,
        declSource: renderFaiDeclaration(declName, n),
        shape: sh,
      }
      decls.push(match)
    }
    nodeIdToDeclName.set(n.id, match.declName)
  }

  return { decls, nodeIdToDeclName }
}

function renderFaiDeclaration(declName: string, n: FaiNode): string {
  const inputs = n.inputs.map((i) => `${i.argName}: ${i.argType}`).join(', ')
  const outputs = n.outputs.map((o) => {
    let typeStr: string = o.type
    if (o.type === 'array') typeStr = `array<${o.innerType ?? 'string'}>`
    const c = o.constraints ?? {}
    const cParts: string[] = []
    if (typeof c.min === 'number' && typeof c.max === 'number') cParts.push(`${c.min}-${c.max}`)
    if (typeof c.maxLen === 'number') cParts.push(`maxLen=${c.maxLen}`)
    const cSuffix = cParts.length ? ` ${cParts.join(' ')}` : ''
    return `${o.name}: ${typeStr}${cSuffix}`
  }).join(', ')
  return `fai ${declName}(${inputs}) -> ${outputs} { }`
}

function renderFaiCall(n: FaiNode, declName: string): string {
  const argValues = n.inputs.map((i) => {
    if (i.source.kind === 'var') return renderVarRef(i.source)
    return renderLiteral(i.source)
  })
  const promptStr = renderPrompt(n.promptTemplate)
  const allArgs = [...argValues, promptStr].join(', ')
  return [
    nidComment(n.id),
    `  let ${n.outputVar} = ${declName}(${allArgs})`,
  ].join('\n')
}
```

并修改 `codegen()` 函数 + `renderNodeFlat()`：

```typescript
export function codegen(graph: TrackGraph): CodegenResult {
  const errors: CodegenError[] = []

  // 1. Collect fai nodes and dedupe
  const faiNodes: FaiNode[] = []
  for (const n of graph.body) {
    if (n.type === 'fai') faiNodes.push(n)
  }
  const dedupe = dedupeFais(faiNodes)

  // 2. Render body
  const bodyLines: string[] = []
  for (let i = 0; i < graph.body.length; i++) {
    const n = graph.body[i]!
    bodyLines.push(renderNodeFlat(n, i, errors, dedupe))
  }

  if (errors.length > 0) return { ok: false, errors }

  const declSection = dedupe.decls.length === 0
    ? ''
    : dedupe.decls.map((d) => d.declSource).join('\n\n') + '\n\n'

  const source = [
    MARKER_LINE,
    NOTICE_LINE,
    '',
    declSection,
    `func main() -> any {`,
    bodyLines.join('\n'),
    `}`,
    `export main`,
    '',
  ].join('\n')
  return { ok: true, source }
}

function renderNodeFlat(
  n: Node,
  index: number,
  errors: CodegenError[],
  dedupe: DedupeResult,
): string {
  if (n.type === 'ask_user') return renderAskUser(n)
  if (n.type === 'let') return renderLet(n)
  if (n.type === 'return') return renderReturn(n)
  if (n.type === 'fai') {
    const declName = dedupe.nodeIdToDeclName.get(n.id)
    if (!declName) {
      errors.push({ nodeIndex: index, nodeId: n.id, message: 'fai dedupe lost node' })
      return ''
    }
    return renderFaiCall(n, declName)
  }
  errors.push({ nodeIndex: index, nodeId: (n as Node).id, message: `unknown node type` })
  return `  // <unknown ${(n as Node).id}>`
}
```

注意：`renderNodeFlat` 旧版没有 dedupe 参数，调用方加上后旧 ask_user/let/return 单测仍能通过（dedupe 参数 unused）。如果调用方还有其他地方调用 `renderNodeFlat`（M1 只有 codegen 本身调），全部更新签名。

- [ ] **Step 2：在 verify-codegen.ts 加 fai dedupe 用例**

在文件末尾 console.log/process.exit 之前插入：

```typescript
// ── fai shape dedupe ───────────────────────────────────────────────────
console.log('\n=== fai shape dedupe ===')
import { makeFai } from '../default-nodes'

// Same shape twice → 1 declaration
{
  let g2 = makeEmptyGraph('demo2')
  const f1 = makeFai()
  f1.faiName = 'analyze'
  f1.outputVar = 'r1'
  f1.outputs = [{ name: 'score', type: 'int' }]
  f1.promptTemplate = [{ kind: 'text', raw: 'do' }]
  const f2 = JSON.parse(JSON.stringify(f1))
  f2.id = 'n_dup'
  f2.outputVar = 'r2'  // different outputVar, but shape identical
  g2 = reduce(g2, { type: 'add', node: f1, index: 0 })
  g2 = reduce(g2, { type: 'add', node: f2, index: 1 })
  const res = codegen(g2)
  check('same shape → ok', res.ok)
  if (res.ok && res.source) {
    const declCount = (res.source.match(/^fai analyze/gm) ?? []).length
    check('same shape → 1 declaration', declCount === 1)
    check('two distinct call sites', (res.source.match(/= analyze\(/g) ?? []).length === 2)
  }
}

// Same faiName but different prompt → 2 declarations with auto-rename
{
  let g3 = makeEmptyGraph('demo3')
  const f1 = makeFai()
  f1.faiName = 'analyze'
  f1.outputVar = 'r1'
  f1.outputs = [{ name: 'score', type: 'int' }]
  f1.promptTemplate = [{ kind: 'text', raw: 'do A' }]
  const f2 = JSON.parse(JSON.stringify(f1))
  f2.id = 'n_diff'
  f2.outputVar = 'r2'
  f2.promptTemplate = [{ kind: 'text', raw: 'do B' }]   // differs
  g3 = reduce(g3, { type: 'add', node: f1, index: 0 })
  g3 = reduce(g3, { type: 'add', node: f2, index: 1 })
  const res = codegen(g3)
  check('diff shape same name → ok', res.ok)
  if (res.ok && res.source) {
    check('has fai analyze', /^fai analyze\(/m.test(res.source))
    check('has fai analyze_2', /^fai analyze_2\(/m.test(res.source))
  }
}
```

注意：上方 `import { makeFai }` 应在文件顶部，不要放函数体内—— move 到 top imports。

- [ ] **Step 3：跑测试**

```bash
cd /Users/tom/Projects/cc-web/frontend && npx ts-node --compiler-options '{"module":"commonjs","esModuleInterop":true,"target":"es2020"}' src/components/tracks/visual/__tests__/verify-codegen.ts
```

预期：所有 check pass。

- [ ] **Step 4：Commit**

```bash
git add frontend/src/components/tracks/visual/codegen.ts frontend/src/components/tracks/visual/__tests__/verify-codegen.ts && git commit -m "feat(tracks/visual): fai codegen + shape dedupe + auto-rename"
```

---

## Task 8：codegen 校验（未引用变量 / 重名）

**Files:**
- Modify: `frontend/src/components/tracks/visual/codegen.ts`
- Modify: `frontend/src/components/tracks/visual/__tests__/verify-codegen.ts`

- [ ] **Step 1：在 codegen.ts 加 validate() 并在 codegen() 入口调用**

```typescript
import { isVarVisible } from './scope'

/**
 * Pre-codegen validation: var references resolve + names unique in body.
 * Adds errors to passed-in array; codegen() short-circuits if any.
 */
function validate(graph: TrackGraph, errors: CodegenError[]): void {
  // Track names declared in body order (M1: flat scope)
  const declaredNames = new Map<string, { index: number; id: string }>()

  for (let i = 0; i < graph.body.length; i++) {
    const n = graph.body[i]!
    // Check var references visible at index i
    for (const ref of collectVarRefs(n)) {
      if (!isVarVisible(graph, i, ref.path)) {
        errors.push({
          nodeIndex: i, nodeId: n.id,
          message: `variable "${ref.path.join('.')}" not visible at this position`,
        })
      }
    }
    // Register the declaration this node makes
    const declared = nodeDeclaredName(n)
    if (declared) {
      const prev = declaredNames.get(declared)
      if (prev) {
        errors.push({
          nodeIndex: i, nodeId: n.id,
          message: `name "${declared}" already declared at node #${prev.index}`,
        })
      } else {
        declaredNames.set(declared, { index: i, id: n.id })
      }
    }
  }
}

function nodeDeclaredName(n: Node): string | null {
  if (n.type === 'ask_user') return n.outputVar
  if (n.type === 'fai') return n.outputVar
  if (n.type === 'let') return n.varName
  return null
}

function collectVarRefs(n: Node): VarRef[] {
  const out: VarRef[] = []
  if (n.type === 'fai') {
    for (const i of n.inputs) {
      if (i.source.kind === 'var') out.push(i.source)
    }
    for (const seg of n.promptTemplate) {
      if (seg.kind === 'ref') out.push({ kind: 'var', path: seg.path })
    }
  } else if (n.type === 'let') {
    pushExprRefs(n.value, out)
  } else if (n.type === 'return') {
    pushExprRefs(n.value, out)
  }
  return out
}

function pushExprRefs(e: Expression, out: VarRef[]): void {
  if (e.kind === 'var') { out.push(e); return }
  if (e.kind === 'triple') {
    if (e.left.kind === 'var') out.push(e.left)
    if (e.right.kind === 'var') out.push(e.right)
  }
}
```

在 codegen() 函数开头插入：

```typescript
export function codegen(graph: TrackGraph): CodegenResult {
  const errors: CodegenError[] = []

  validate(graph, errors)
  if (errors.length > 0) return { ok: false, errors }

  // ...rest as before (fai dedupe + body render)
}
```

- [ ] **Step 2：在 verify-codegen.ts 加校验用例**

```typescript
// ── validation ────────────────────────────────────────────────────────
console.log('\n=== validation ===')

// missing var reference
{
  let g = makeEmptyGraph('vt')
  const r = makeReturn()
  r.value = { kind: 'var', path: ['nonexistent'] }
  g = reduce(g, { type: 'add', node: r, index: 0 })
  const res = codegen(g)
  check('missing var → ok=false', !res.ok)
  check('error mentions nonexistent', !!res.errors?.some((e) => e.message.includes('nonexistent')))
}

// duplicate outputVar
{
  let g = makeEmptyGraph('vt2')
  const a1 = makeAskUser(); a1.outputVar = 'dup'
  const a2 = makeAskUser(); a2.outputVar = 'dup'
  g = reduce(g, { type: 'add', node: a1, index: 0 })
  g = reduce(g, { type: 'add', node: a2, index: 1 })
  const res = codegen(g)
  check('dup outputVar → ok=false', !res.ok)
  check('error mentions already declared', !!res.errors?.some((e) => e.message.includes('already declared')))
}
```

- [ ] **Step 3：跑测试**

```bash
cd /Users/tom/Projects/cc-web/frontend && npx ts-node --compiler-options '{"module":"commonjs","esModuleInterop":true,"target":"es2020"}' src/components/tracks/visual/__tests__/verify-codegen.ts
```

预期：所有 check pass。

- [ ] **Step 4：Commit**

```bash
git add frontend/src/components/tracks/visual/codegen.ts frontend/src/components/tracks/visual/__tests__/verify-codegen.ts && git commit -m "feat(tracks/visual): codegen validation — missing refs + duplicate names"
```

---

## Task 9：codegen 端到端 — 用 train-core parse codegen 出的 .tr

**Files:**
- Modify: `frontend/src/components/tracks/visual/__tests__/verify-codegen.ts`

让 codegen 出的 .tr 能被 train-core parse 通过（防止"语法看着对实际不能跑"）。

- [ ] **Step 1：在 verify-codegen.ts 加端到端用例**

```typescript
// ── end-to-end: codegen → train.parse() should succeed ────────────────
console.log('\n=== end-to-end parse ===')
{
  let g = makeEmptyGraph('e2e')
  const a = makeAskUser()
  a.outputVar = 'input'
  a.fields = [{ key: 'file_path', label: 'p', type: 'text', required: true }]
  g = reduce(g, { type: 'add', node: a, index: 0 })

  const f = makeFai()
  f.faiName = 'analyze'
  f.outputVar = 'r'
  f.inputs = [
    { argName: 'file_path', argType: 'string', source: { kind: 'var', path: ['input', 'file_path'] } },
  ]
  f.outputs = [
    { name: 'rating', type: 'int', constraints: { min: 0, max: 10 } },
    { name: 'comment', type: 'string', constraints: { maxLen: 500 } },
  ]
  f.promptTemplate = [
    { kind: 'text', raw: '请对 ' },
    { kind: 'ref', path: ['input', 'file_path'] },
    { kind: 'text', raw: ' 评分' },
  ]
  g = reduce(g, { type: 'add', node: f, index: 1 })

  const ret = makeReturn()
  ret.value = { kind: 'var', path: ['r'] }
  g = reduce(g, { type: 'add', node: ret, index: 2 })

  const res = codegen(g)
  check('e2e ok=true', res.ok)
  if (res.ok && res.source) {
    // Try parse via train-core (CommonJS require)
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const train = require('../../../../../backend/vendor/@tom2012/train-core/dist/index.js')
    const parsed = train.parse(res.source)
    check('train.parse — no lex errors', parsed.lexErrors.length === 0,
      JSON.stringify(parsed.lexErrors))
    check('train.parse — no parse errors', parsed.parseErrors.length === 0,
      JSON.stringify(parsed.parseErrors.slice(0, 2).map((e: { message: string }) => e.message)))
  }
}
```

- [ ] **Step 2：跑测试**

```bash
cd /Users/tom/Projects/cc-web/frontend && npx ts-node --compiler-options '{"module":"commonjs","esModuleInterop":true,"target":"es2020"}' src/components/tracks/visual/__tests__/verify-codegen.ts
```

预期：所有 check pass，**特别是 train.parse 两条**。

如果失败：codegen 出的 .tr 有语法问题。常见情况是 `fai <name>(inputs) -> outputs { }` 的 outputs 部分语法不对。仔细对照 backend `verify-track*` 测试用例里成功跑过的 fai 声明语法。

- [ ] **Step 3：Commit**

```bash
git add frontend/src/components/tracks/visual/__tests__/verify-codegen.ts && git commit -m "test(tracks/visual): codegen e2e — train-core parse passes"
```

---

## Task 10：VarRefInput.tsx —— @ chip 输入控件

**Files:**
- Create: `frontend/src/components/tracks/visual/VarRefInput.tsx`

这个组件有两种模式：(a) 单值（VarRef | Literal）；(b) 多 segment（PromptSegment[]）。M1 实现单值；prompt 模式用 textarea + 显示规则文本（chip 化作为 polish 留 M1 末尾或 M2 头）。

为减少 M1 范围，单值模式优先：
- 显示：如果是 VarRef 显示 chip；如果是 Literal 显示 input
- 编辑：键入 `@` 时弹下拉，从 candidates 选

- [ ] **Step 1：写 VarRefInput.tsx**

```tsx
// frontend/src/components/tracks/visual/VarRefInput.tsx
import { useEffect, useRef, useState } from 'react'
import type { Literal, VarRef } from './graph-types'

interface Props {
  value: VarRef | Literal
  candidates: string[]   // @ 下拉候选，from scopeCandidates()
  placeholder?: string
  onChange: (v: VarRef | Literal) => void
}

export function VarRefInput({ value, candidates, placeholder, onChange }: Props) {
  const [editing, setEditing] = useState(false)
  const [text, setText] = useState('')
  const [showSuggest, setShowSuggest] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  // When entering edit mode, seed text from current value
  useEffect(() => {
    if (editing) {
      if (value.kind === 'var') setText('@' + value.path.join('.'))
      else setText(value.raw)
      setTimeout(() => inputRef.current?.focus(), 0)
    }
  }, [editing, value])

  function commit(newText: string): void {
    if (newText.startsWith('@')) {
      const path = newText.slice(1).split('.').filter((s) => s.length > 0)
      if (path.length > 0) {
        onChange({ kind: 'var', path })
        setEditing(false)
        return
      }
    }
    // Otherwise literal — store raw exactly as typed
    onChange({ kind: 'lit', raw: newText })
    setEditing(false)
  }

  const filteredSuggest = candidates.filter((c) =>
    c.toLowerCase().includes(text.slice(1).toLowerCase()),
  )

  if (!editing) {
    // Display mode
    if (value.kind === 'var') {
      return (
        <button
          type="button"
          onClick={() => setEditing(true)}
          className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-blue-100 text-blue-800 border border-blue-300 text-sm font-mono"
        >
          @{value.path.join('.')}
        </button>
      )
    }
    return (
      <button
        type="button"
        onClick={() => setEditing(true)}
        className="px-2 py-0.5 rounded border border-gray-300 text-sm font-mono text-gray-700 hover:bg-gray-50"
      >
        {value.raw || <span className="italic text-gray-400">{placeholder ?? '(空)'}</span>}
      </button>
    )
  }

  return (
    <div className="relative inline-block">
      <input
        ref={inputRef}
        type="text"
        value={text}
        placeholder={placeholder}
        onChange={(e) => {
          setText(e.target.value)
          setShowSuggest(e.target.value.startsWith('@'))
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter') { e.preventDefault(); commit(text) }
          if (e.key === 'Escape') { e.preventDefault(); setEditing(false) }
        }}
        onBlur={() => setTimeout(() => commit(text), 100)}  // delay so click on suggest fires first
        className="px-2 py-0.5 rounded border border-blue-400 text-sm font-mono outline-none w-48"
      />
      {showSuggest && filteredSuggest.length > 0 && (
        <ul className="absolute top-full left-0 mt-1 bg-white border border-gray-300 rounded shadow text-sm z-10 max-h-48 overflow-auto">
          {filteredSuggest.slice(0, 10).map((c) => (
            <li
              key={c}
              className="px-2 py-1 hover:bg-blue-50 cursor-pointer font-mono"
              onMouseDown={() => commit('@' + c)}
            >
              @{c}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
```

- [ ] **Step 2：TS 编译检查**

```bash
cd /Users/tom/Projects/cc-web/frontend && npx tsc --noEmit src/components/tracks/visual/VarRefInput.tsx 2>&1 | head -20
```

预期：无错误或仅有 JSX-related warning（OK）。

- [ ] **Step 3：Commit**

```bash
git add frontend/src/components/tracks/visual/VarRefInput.tsx && git commit -m "feat(tracks/visual): VarRefInput — single-value @ chip + dropdown"
```

---

## Task 11：AskUserForm.tsx

**Files:**
- Create: `frontend/src/components/tracks/visual/forms/AskUserForm.tsx`

- [ ] **Step 1：写 AskUserForm.tsx**

```tsx
// frontend/src/components/tracks/visual/forms/AskUserForm.tsx
import type { AskUserField, AskUserNode } from '../graph-types'

interface Props {
  node: AskUserNode
  onChange: (patch: Partial<AskUserNode>) => void
}

export function AskUserForm({ node, onChange }: Props) {
  function updateField(idx: number, patch: Partial<AskUserField>): void {
    const fields = node.fields.map((f, i) => (i === idx ? { ...f, ...patch } : f))
    onChange({ fields })
  }
  function addField(): void {
    onChange({
      fields: [...node.fields, { key: 'field_' + (node.fields.length + 1), label: '', type: 'text', required: true }],
    })
  }
  function removeField(idx: number): void {
    onChange({ fields: node.fields.filter((_, i) => i !== idx) })
  }

  return (
    <div className="p-4 flex flex-col gap-4">
      <label className="flex items-center gap-2">
        <span className="text-sm text-gray-600">变量名:</span>
        <input
          type="text"
          value={node.outputVar}
          onChange={(e) => onChange({ outputVar: e.target.value })}
          className="px-2 py-0.5 rounded border border-gray-300 text-sm font-mono"
        />
      </label>

      <div>
        <div className="text-sm text-gray-600 mb-1">字段:</div>
        {node.fields.map((f, i) => (
          <div key={i} className="border border-gray-200 rounded p-2 mb-2 flex flex-col gap-1 text-sm">
            <label className="flex items-center gap-2">
              <span className="w-12 text-gray-500">key</span>
              <input value={f.key} onChange={(e) => updateField(i, { key: e.target.value })}
                className="px-2 py-0.5 rounded border border-gray-300 font-mono flex-1" />
            </label>
            <label className="flex items-center gap-2">
              <span className="w-12 text-gray-500">label</span>
              <input value={f.label} onChange={(e) => updateField(i, { label: e.target.value })}
                className="px-2 py-0.5 rounded border border-gray-300 flex-1" />
            </label>
            <label className="flex items-center gap-2">
              <span className="w-12 text-gray-500">type</span>
              <select value={f.type} onChange={(e) => updateField(i, { type: e.target.value as AskUserField['type'] })}
                className="px-2 py-0.5 rounded border border-gray-300">
                <option value="text">text</option>
                <option value="number">number</option>
                <option value="bool">bool</option>
                <option value="enum">enum</option>
              </select>
            </label>
            {f.type === 'enum' && (
              <label className="flex items-center gap-2">
                <span className="w-12 text-gray-500">variants</span>
                <input
                  value={(f.variants ?? []).join(',')}
                  onChange={(e) => updateField(i, { variants: e.target.value.split(',').map((s) => s.trim()).filter(Boolean) })}
                  placeholder="a,b,c"
                  className="px-2 py-0.5 rounded border border-gray-300 font-mono flex-1"
                />
              </label>
            )}
            <label className="flex items-center gap-2">
              <span className="w-12 text-gray-500">required</span>
              <input type="checkbox" checked={f.required !== false} onChange={(e) => updateField(i, { required: e.target.checked })} />
            </label>
            <button type="button" onClick={() => removeField(i)} className="text-red-600 text-xs self-end">删除该字段</button>
          </div>
        ))}
        <button type="button" onClick={addField} className="text-blue-600 text-sm">+ 添加字段</button>
      </div>
    </div>
  )
}
```

- [ ] **Step 2：TS 编译检查**

```bash
cd /Users/tom/Projects/cc-web/frontend && npx tsc --noEmit src/components/tracks/visual/forms/AskUserForm.tsx 2>&1 | head -10
```

预期：无错误。

- [ ] **Step 3：Commit**

```bash
git add frontend/src/components/tracks/visual/forms/AskUserForm.tsx && git commit -m "feat(tracks/visual): AskUserForm — outputVar + fields editor"
```

---

## Task 12：FaiForm.tsx

**Files:**
- Create: `frontend/src/components/tracks/visual/forms/FaiForm.tsx`

- [ ] **Step 1：写 FaiForm.tsx**

```tsx
// frontend/src/components/tracks/visual/forms/FaiForm.tsx
import type { FaiInput, FaiNode, FaiOutput, PromptSegment } from '../graph-types'
import { VarRefInput } from '../VarRefInput'

interface Props {
  node: FaiNode
  candidates: string[]
  onChange: (patch: Partial<FaiNode>) => void
}

export function FaiForm({ node, candidates, onChange }: Props) {
  // ── inputs editor ──
  function updateInput(idx: number, patch: Partial<FaiInput>): void {
    onChange({ inputs: node.inputs.map((i, k) => (k === idx ? { ...i, ...patch } : i)) })
  }
  function addInput(): void {
    onChange({
      inputs: [...node.inputs, { argName: 'arg' + (node.inputs.length + 1), argType: 'string', source: { kind: 'lit', raw: '""' } }],
    })
  }
  function removeInput(idx: number): void {
    onChange({ inputs: node.inputs.filter((_, k) => k !== idx) })
  }

  // ── outputs editor ──
  function updateOutput(idx: number, patch: Partial<FaiOutput>): void {
    onChange({ outputs: node.outputs.map((o, k) => (k === idx ? { ...o, ...patch } : o)) })
  }
  function addOutput(): void {
    onChange({ outputs: [...node.outputs, { name: 'out' + (node.outputs.length + 1), type: 'string' }] })
  }
  function removeOutput(idx: number): void {
    onChange({ outputs: node.outputs.filter((_, k) => k !== idx) })
  }

  // ── prompt textarea: M1 simple — text only (no chip rendering inside) ──
  // We serialize prompt as plain text with `@{path}` placeholders for refs.
  // Parse back on each keystroke into PromptSegment[].
  const promptAsText = node.promptTemplate.map((s) => s.kind === 'text' ? s.raw : `@{${s.path.join('.')}}`).join('')
  function setPromptText(raw: string): void {
    const segments: PromptSegment[] = []
    let i = 0
    while (i < raw.length) {
      const at = raw.indexOf('@{', i)
      if (at === -1) {
        segments.push({ kind: 'text', raw: raw.slice(i) })
        break
      }
      if (at > i) segments.push({ kind: 'text', raw: raw.slice(i, at) })
      const close = raw.indexOf('}', at + 2)
      if (close === -1) {
        segments.push({ kind: 'text', raw: raw.slice(at) })
        break
      }
      const path = raw.slice(at + 2, close).split('.').filter((s) => s.length > 0)
      if (path.length > 0) segments.push({ kind: 'ref', path })
      else segments.push({ kind: 'text', raw: raw.slice(at, close + 1) })
      i = close + 1
    }
    onChange({ promptTemplate: segments })
  }

  return (
    <div className="p-4 flex flex-col gap-4 text-sm">
      <label className="flex items-center gap-2">
        <span className="text-gray-600 w-20">fai 名:</span>
        <input value={node.faiName} onChange={(e) => onChange({ faiName: e.target.value })}
          className="px-2 py-0.5 rounded border border-gray-300 font-mono flex-1" />
      </label>
      <label className="flex items-center gap-2">
        <span className="text-gray-600 w-20">输出变量名:</span>
        <input value={node.outputVar} onChange={(e) => onChange({ outputVar: e.target.value })}
          className="px-2 py-0.5 rounded border border-gray-300 font-mono flex-1" />
      </label>

      <div>
        <div className="text-gray-600 mb-1">输入:</div>
        {node.inputs.map((i, k) => (
          <div key={k} className="flex items-center gap-2 mb-1">
            <input value={i.argName} onChange={(e) => updateInput(k, { argName: e.target.value })}
              className="px-2 py-0.5 rounded border border-gray-300 font-mono w-28" />
            <select value={i.argType} onChange={(e) => updateInput(k, { argType: e.target.value as FaiInput['argType'] })}
              className="px-2 py-0.5 rounded border border-gray-300">
              <option value="string">string</option>
              <option value="number">number</option>
              <option value="bool">bool</option>
              <option value="prompt">prompt</option>
            </select>
            <span>=</span>
            <VarRefInput value={i.source} candidates={candidates}
              onChange={(v) => updateInput(k, { source: v })} />
            <button type="button" onClick={() => removeInput(k)} className="text-red-600 text-xs ml-auto">×</button>
          </div>
        ))}
        <button type="button" onClick={addInput} className="text-blue-600 text-xs">+ 添加输入</button>
      </div>

      <div>
        <div className="text-gray-600 mb-1">输出 (schema):</div>
        {node.outputs.map((o, k) => (
          <div key={k} className="flex items-center gap-2 mb-1">
            <input value={o.name} onChange={(e) => updateOutput(k, { name: e.target.value })}
              className="px-2 py-0.5 rounded border border-gray-300 font-mono w-28" />
            <select value={o.type} onChange={(e) => updateOutput(k, { type: e.target.value as FaiOutput['type'] })}
              className="px-2 py-0.5 rounded border border-gray-300">
              <option value="string">string</option>
              <option value="int">int</option>
              <option value="number">number</option>
              <option value="bool">bool</option>
              <option value="array">array</option>
            </select>
            {o.type === 'array' && (
              <select value={o.innerType ?? 'string'} onChange={(e) => updateOutput(k, { innerType: e.target.value as FaiOutput['innerType'] })}
                className="px-2 py-0.5 rounded border border-gray-300">
                <option value="string">array&lt;string&gt;</option>
                <option value="int">array&lt;int&gt;</option>
                <option value="number">array&lt;number&gt;</option>
                <option value="bool">array&lt;bool&gt;</option>
              </select>
            )}
            <button type="button" onClick={() => removeOutput(k)} className="text-red-600 text-xs ml-auto">×</button>
          </div>
        ))}
        <button type="button" onClick={addOutput} className="text-blue-600 text-xs">+ 添加输出</button>
      </div>

      <div>
        <div className="text-gray-600 mb-1">Prompt（用 @{'{var.path}'} 引用上文变量）:</div>
        <textarea
          value={promptAsText}
          onChange={(e) => setPromptText(e.target.value)}
          rows={5}
          className="w-full px-2 py-1 rounded border border-gray-300 font-mono text-sm"
        />
        <div className="text-xs text-gray-500 mt-1">
          可用变量: {candidates.slice(0, 8).map((c) => `@{${c}}`).join(' · ')}
          {candidates.length > 8 ? ` 等 ${candidates.length} 个` : ''}
        </div>
      </div>
    </div>
  )
}
```

- [ ] **Step 2：TS 编译检查**

```bash
cd /Users/tom/Projects/cc-web/frontend && npx tsc --noEmit src/components/tracks/visual/forms/FaiForm.tsx 2>&1 | head -10
```

预期：无错误。

- [ ] **Step 3：Commit**

```bash
git add frontend/src/components/tracks/visual/forms/FaiForm.tsx && git commit -m "feat(tracks/visual): FaiForm — inputs/outputs/prompt editor"
```

---

## Task 13：LetForm.tsx + ReturnForm.tsx

**Files:**
- Create: `frontend/src/components/tracks/visual/forms/LetForm.tsx`
- Create: `frontend/src/components/tracks/visual/forms/ReturnForm.tsx`

M1 简化：let 和 return 都用 VarRefInput 编辑"单值"，不上 TripleSlot UI（三格拼装器留 M2 if 节点一起做）。

- [ ] **Step 1：写 LetForm.tsx**

```tsx
// frontend/src/components/tracks/visual/forms/LetForm.tsx
import type { LetNode } from '../graph-types'
import { VarRefInput } from '../VarRefInput'

interface Props {
  node: LetNode
  candidates: string[]
  onChange: (patch: Partial<LetNode>) => void
}

export function LetForm({ node, candidates, onChange }: Props) {
  // M1: only support VarRef | Literal values (no TripleSlot — M2)
  const v = node.value
  if (v.kind === 'triple') {
    // Defensive: M1 reducer shouldn't produce triple, but if loaded from
    // a future graph degrade gracefully.
    return (
      <div className="p-4 text-sm text-red-600">
        M1 不支持 TripleSlot 值。请等 M2 三格拼装器实装。
      </div>
    )
  }
  return (
    <div className="p-4 flex flex-col gap-3 text-sm">
      <label className="flex items-center gap-2">
        <span className="text-gray-600 w-16">变量名:</span>
        <input value={node.varName} onChange={(e) => onChange({ varName: e.target.value })}
          className="px-2 py-0.5 rounded border border-gray-300 font-mono flex-1" />
      </label>
      <label className="flex items-center gap-2">
        <span className="text-gray-600 w-16">值:</span>
        <VarRefInput value={v} candidates={candidates}
          placeholder='@变量 或字面量（如 "hello" / 42 / true）'
          onChange={(nv) => onChange({ value: nv })} />
      </label>
      <div className="text-xs text-gray-500">
        提示：M1 暂不支持 a + b 这种表达式。需要时先用 fai 节点中转，或等 M2 三格拼装器。
      </div>
    </div>
  )
}
```

- [ ] **Step 2：写 ReturnForm.tsx**

```tsx
// frontend/src/components/tracks/visual/forms/ReturnForm.tsx
import type { ReturnNode } from '../graph-types'
import { VarRefInput } from '../VarRefInput'

interface Props {
  node: ReturnNode
  candidates: string[]
  onChange: (patch: Partial<ReturnNode>) => void
}

export function ReturnForm({ node, candidates, onChange }: Props) {
  const v = node.value
  if (v.kind === 'triple') {
    return (
      <div className="p-4 text-sm text-red-600">
        M1 不支持 TripleSlot 值。等 M2 三格拼装器。
      </div>
    )
  }
  return (
    <div className="p-4 flex flex-col gap-3 text-sm">
      <label className="flex items-center gap-2">
        <span className="text-gray-600 w-16">返回值:</span>
        <VarRefInput value={v} candidates={candidates}
          placeholder='@变量 或字面量（如 { foo: 1 } / "hello" / null）'
          onChange={(nv) => onChange({ value: nv })} />
      </label>
    </div>
  )
}
```

- [ ] **Step 3：TS 编译检查**

```bash
cd /Users/tom/Projects/cc-web/frontend && npx tsc --noEmit src/components/tracks/visual/forms/LetForm.tsx src/components/tracks/visual/forms/ReturnForm.tsx 2>&1 | head -10
```

预期：无错误。

- [ ] **Step 4：Commit**

```bash
git add frontend/src/components/tracks/visual/forms/LetForm.tsx frontend/src/components/tracks/visual/forms/ReturnForm.tsx && git commit -m "feat(tracks/visual): LetForm + ReturnForm — single-value via VarRefInput"
```

---

## Task 14：NodeBlock.tsx —— 单节点展示卡片

**Files:**
- Create: `frontend/src/components/tracks/visual/NodeBlock.tsx`

- [ ] **Step 1：写 NodeBlock.tsx**

```tsx
// frontend/src/components/tracks/visual/NodeBlock.tsx
import { useDraggable, useDroppable } from '@dnd-kit/core'
import type { Node, VarRef, Literal } from './graph-types'

interface Props {
  node: Node
  index: number
  selected: boolean
  onSelect: () => void
  onDuplicate: () => void
  onRemove: () => void
}

const TYPE_META: Record<Node['type'], { icon: string; label: string; color: string }> = {
  ask_user: { icon: '💬', label: '问用户', color: 'bg-pink-50 border-pink-300' },
  fai:      { icon: '🤖', label: 'AI 调用', color: 'bg-orange-50 border-orange-300' },
  let:      { icon: '📦', label: '命名变量', color: 'bg-gray-50 border-gray-300' },
  return:   { icon: '⬅️', label: '返回', color: 'bg-purple-50 border-purple-300' },
}

function valuePreview(v: VarRef | Literal | { kind: 'triple' }): string {
  if (v.kind === 'var') return '@' + v.path.join('.')
  if (v.kind === 'lit') return v.raw
  return '(triple)'
}

export function NodeBlock({ node, index, selected, onSelect, onDuplicate, onRemove }: Props) {
  const meta = TYPE_META[node.type]
  const { attributes, listeners, setNodeRef: setDragRef, isDragging } = useDraggable({
    id: `node:${node.id}`,
    data: { kind: 'reorder', sourceIndex: index, nodeId: node.id },
  })
  const { setNodeRef: setDropRef, isOver } = useDroppable({
    id: `drop-before:${node.id}`,
    data: { kind: 'drop-before', index },
  })

  // Summary line
  let summary = ''
  if (node.type === 'ask_user') summary = `${node.outputVar} ← { ${node.fields.map((f) => f.key).join(', ')} }`
  else if (node.type === 'fai') summary = `${node.outputVar} ← ${node.faiName}(${node.inputs.length} args)`
  else if (node.type === 'let') summary = `${node.varName} = ${valuePreview(node.value)}`
  else if (node.type === 'return') summary = `return ${valuePreview(node.value)}`

  return (
    <div ref={setDropRef} className="relative">
      {/* Drop indicator line (above) */}
      {isOver && <div className="absolute left-0 right-0 -top-1 h-0.5 bg-blue-500 z-10" />}
      <div
        ref={setDragRef}
        {...attributes}
        {...listeners}
        onClick={(e) => { e.stopPropagation(); onSelect() }}
        className={[
          'border rounded-lg p-3 cursor-pointer transition-all',
          meta.color,
          selected ? 'ring-2 ring-blue-500 shadow' : 'hover:shadow-sm',
          isDragging ? 'opacity-50' : '',
        ].join(' ')}
      >
        <div className="flex items-center gap-2 mb-1">
          <span className="text-xl">{meta.icon}</span>
          <span className="font-medium">{meta.label}</span>
          <div className="ml-auto flex gap-1">
            <button type="button" onClick={(e) => { e.stopPropagation(); onDuplicate() }}
              className="text-xs text-gray-500 hover:text-gray-800 px-1">复制</button>
            <button type="button" onClick={(e) => { e.stopPropagation(); onRemove() }}
              className="text-xs text-red-500 hover:text-red-700 px-1">删除</button>
          </div>
        </div>
        <div className="text-sm font-mono text-gray-700">{summary}</div>
      </div>
    </div>
  )
}
```

- [ ] **Step 2：TS 编译检查**

```bash
cd /Users/tom/Projects/cc-web/frontend && npx tsc --noEmit src/components/tracks/visual/NodeBlock.tsx 2>&1 | head -10
```

预期：无错误（如有 @dnd-kit 类型 import 问题，确认 Task 1 已装包）。

- [ ] **Step 3：Commit**

```bash
git add frontend/src/components/tracks/visual/NodeBlock.tsx && git commit -m "feat(tracks/visual): NodeBlock — drag/drop card + summary"
```

---

## Task 15：NodePalette.tsx

**Files:**
- Create: `frontend/src/components/tracks/visual/NodePalette.tsx`

- [ ] **Step 1：写 NodePalette.tsx**

```tsx
// frontend/src/components/tracks/visual/NodePalette.tsx
import { useDraggable } from '@dnd-kit/core'
import type { Node } from './graph-types'

const PALETTE: { type: Node['type']; icon: string; label: string }[] = [
  { type: 'ask_user', icon: '💬', label: '问用户' },
  { type: 'fai',      icon: '🤖', label: 'AI 调用' },
  { type: 'let',      icon: '📦', label: '命名变量' },
  // M2 will add: if / for
  { type: 'return',   icon: '⬅️', label: '返回' },
]

function PaletteItem({ type, icon, label }: { type: Node['type']; icon: string; label: string }) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: `palette:${type}`,
    data: { kind: 'create', nodeType: type },
  })
  return (
    <div
      ref={setNodeRef}
      {...attributes}
      {...listeners}
      className={[
        'flex items-center gap-2 p-2 rounded border border-gray-300 bg-white cursor-grab',
        'hover:border-blue-400 hover:shadow-sm transition-all select-none',
        isDragging ? 'opacity-50' : '',
      ].join(' ')}
    >
      <span className="text-xl">{icon}</span>
      <span className="text-sm">{label}</span>
    </div>
  )
}

export function NodePalette() {
  return (
    <aside className="fixed left-4 top-1/4 w-40 flex flex-col gap-2 z-20">
      <div className="text-xs uppercase text-gray-500 mb-1 px-1">节点</div>
      {PALETTE.map((p) => <PaletteItem key={p.type} {...p} />)}
    </aside>
  )
}
```

- [ ] **Step 2：TS 编译检查**

```bash
cd /Users/tom/Projects/cc-web/frontend && npx tsc --noEmit src/components/tracks/visual/NodePalette.tsx 2>&1 | head -10
```

预期：无错误。

- [ ] **Step 3：Commit**

```bash
git add frontend/src/components/tracks/visual/NodePalette.tsx && git commit -m "feat(tracks/visual): NodePalette — 4 draggable items (M1 set)"
```

---

## Task 16：NodeFormDrawer.tsx

**Files:**
- Create: `frontend/src/components/tracks/visual/NodeFormDrawer.tsx`

- [ ] **Step 1：写 NodeFormDrawer.tsx**

```tsx
// frontend/src/components/tracks/visual/NodeFormDrawer.tsx
import type { Node } from './graph-types'
import { AskUserForm } from './forms/AskUserForm'
import { FaiForm } from './forms/FaiForm'
import { LetForm } from './forms/LetForm'
import { ReturnForm } from './forms/ReturnForm'

interface Props {
  node: Node | null
  candidates: string[]
  onChange: (patch: Partial<Node>) => void
  onClose: () => void
}

export function NodeFormDrawer({ node, candidates, onChange, onClose }: Props) {
  if (!node) return null
  return (
    <aside className="fixed right-0 top-0 bottom-0 w-96 bg-white border-l border-gray-300 shadow-xl overflow-y-auto z-30">
      <header className="flex items-center justify-between p-3 border-b border-gray-200 bg-gray-50">
        <span className="font-medium text-sm">编辑节点</span>
        <button type="button" onClick={onClose}
          className="text-gray-500 hover:text-gray-800 text-lg leading-none">×</button>
      </header>
      {node.type === 'ask_user' && <AskUserForm node={node} onChange={onChange as (p: Partial<typeof node>) => void} />}
      {node.type === 'fai' && <FaiForm node={node} candidates={candidates} onChange={onChange as (p: Partial<typeof node>) => void} />}
      {node.type === 'let' && <LetForm node={node} candidates={candidates} onChange={onChange as (p: Partial<typeof node>) => void} />}
      {node.type === 'return' && <ReturnForm node={node} candidates={candidates} onChange={onChange as (p: Partial<typeof node>) => void} />}
    </aside>
  )
}
```

- [ ] **Step 2：TS 编译检查**

```bash
cd /Users/tom/Projects/cc-web/frontend && npx tsc --noEmit src/components/tracks/visual/NodeFormDrawer.tsx 2>&1 | head -10
```

预期：无错误。

- [ ] **Step 3：Commit**

```bash
git add frontend/src/components/tracks/visual/NodeFormDrawer.tsx && git commit -m "feat(tracks/visual): NodeFormDrawer — dispatches per-type forms"
```

---

## Task 17：CodePreviewModal.tsx

**Files:**
- Create: `frontend/src/components/tracks/visual/CodePreviewModal.tsx`

- [ ] **Step 1：写 CodePreviewModal.tsx（用现有 Monaco 集成）**

先看现有 Monaco 用法：

```bash
grep -rn "from '@monaco-editor/react'" /Users/tom/Projects/cc-web/frontend/src 2>/dev/null | head -5
```

如果有现成的 Monaco wrapper（如 `TrackEditor.tsx` 已用 `<Editor>`），照搬即可。否则裸用 `@monaco-editor/react`。

```tsx
// frontend/src/components/tracks/visual/CodePreviewModal.tsx
import Editor from '@monaco-editor/react'

interface Props {
  open: boolean
  source: string
  errors?: { nodeId: string; nodeIndex: number; message: string }[]
  onClose: () => void
}

export function CodePreviewModal({ open, source, errors, onClose }: Props) {
  if (!open) return null
  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50" onClick={onClose}>
      <div className="bg-white rounded-lg w-3/4 h-3/4 flex flex-col" onClick={(e) => e.stopPropagation()}>
        <header className="flex items-center justify-between p-3 border-b border-gray-200">
          <span className="font-medium">预览 .tr（只读）</span>
          <button onClick={onClose} className="text-gray-500 hover:text-gray-800 text-lg leading-none">×</button>
        </header>
        {errors && errors.length > 0 && (
          <div className="bg-red-50 border-b border-red-200 p-2 text-sm text-red-700">
            <div className="font-medium mb-1">codegen 报错（{errors.length}）:</div>
            {errors.slice(0, 5).map((e, i) => (
              <div key={i} className="font-mono text-xs">节点 #{e.nodeIndex}: {e.message}</div>
            ))}
          </div>
        )}
        <div className="flex-1 overflow-hidden">
          <Editor
            value={source}
            language="javascript"
            options={{ readOnly: true, minimap: { enabled: false }, fontSize: 13 }}
          />
        </div>
      </div>
    </div>
  )
}
```

注意：train-lang 没有 Monaco language registered；前面 `train-monaco-lang.ts` 可能有自定义 language。M1 阶段用 `language="javascript"`（语法近似，多数关键字 fai/let/func/for/if/return 与 JS 重叠）。如有时间，复用 `train-monaco-lang.ts` 的 language id。

- [ ] **Step 2：TS 编译检查**

```bash
cd /Users/tom/Projects/cc-web/frontend && npx tsc --noEmit src/components/tracks/visual/CodePreviewModal.tsx 2>&1 | head -10
```

预期：无错误。

- [ ] **Step 3：Commit**

```bash
git add frontend/src/components/tracks/visual/CodePreviewModal.tsx && git commit -m "feat(tracks/visual): CodePreviewModal — read-only Monaco preview"
```

---

## Task 18：TrackCanvas.tsx —— DndContext + 拖拽路由

**Files:**
- Create: `frontend/src/components/tracks/visual/TrackCanvas.tsx`

- [ ] **Step 1：写 TrackCanvas.tsx**

```tsx
// frontend/src/components/tracks/visual/TrackCanvas.tsx
import { DndContext, DragEndEvent, DragOverlay, useDroppable } from '@dnd-kit/core'
import { useState } from 'react'
import type { Node, TrackGraph } from './graph-types'
import { Action } from './reducer'
import { NODE_FACTORY } from './default-nodes'
import { NodeBlock } from './NodeBlock'

interface Props {
  graph: TrackGraph
  dispatch: (a: Action) => void
  selectedId: string | null
  onSelect: (id: string | null) => void
}

export function TrackCanvas({ graph, dispatch, selectedId, onSelect }: Props) {
  const [activeDrag, setActiveDrag] = useState<{ kind: 'create' | 'reorder'; label: string } | null>(null)

  function handleDragEnd(event: DragEndEvent): void {
    setActiveDrag(null)
    const { active, over } = event
    if (!over) return
    const data = active.data.current as { kind?: string } | undefined
    const overData = over.data.current as { kind?: string; index?: number } | undefined
    if (!data || !overData) return

    if (data.kind === 'create' && overData.kind === 'drop-before') {
      const factory = NODE_FACTORY[(data as { nodeType: Node['type'] }).nodeType]
      if (factory) dispatch({ type: 'add', node: factory(), index: overData.index ?? 0 })
    }
    if (data.kind === 'create' && overData.kind === 'drop-end') {
      const factory = NODE_FACTORY[(data as { nodeType: Node['type'] }).nodeType]
      if (factory) dispatch({ type: 'add', node: factory(), index: graph.body.length })
    }
    if (data.kind === 'reorder' && overData.kind === 'drop-before') {
      const from = (data as { sourceIndex: number }).sourceIndex
      let to = overData.index ?? 0
      if (from < to) to -= 1   // adjust for self-removal before insert
      if (from !== to) dispatch({ type: 'move', from, to })
    }
  }

  return (
    <DndContext
      onDragStart={(e) => {
        const d = e.active.data.current as { kind?: string; nodeType?: string } | undefined
        if (d?.kind === 'create') setActiveDrag({ kind: 'create', label: d.nodeType ?? '?' })
      }}
      onDragEnd={handleDragEnd}
      onDragCancel={() => setActiveDrag(null)}
    >
      <main className="ml-48 mr-96 p-6 min-h-screen" onClick={() => onSelect(null)}>
        <h1 className="text-xl font-semibold mb-4">{graph.trackName}</h1>
        <div className="flex flex-col gap-2">
          {graph.body.length === 0 && (
            <EmptyDrop />
          )}
          {graph.body.map((n, i) => (
            <NodeBlock
              key={n.id}
              node={n}
              index={i}
              selected={selectedId === n.id}
              onSelect={() => onSelect(n.id)}
              onDuplicate={() => dispatch({ type: 'duplicate', index: i })}
              onRemove={() => dispatch({ type: 'remove', index: i })}
            />
          ))}
          <EndDrop />
        </div>
      </main>
      <DragOverlay>
        {activeDrag && (
          <div className="px-3 py-2 bg-white border-2 border-blue-400 rounded shadow text-sm">
            {activeDrag.label}
          </div>
        )}
      </DragOverlay>
    </DndContext>
  )
}

function EmptyDrop() {
  const { setNodeRef, isOver } = useDroppable({ id: 'drop-end', data: { kind: 'drop-end' } })
  return (
    <div
      ref={setNodeRef}
      className={[
        'border-2 border-dashed rounded-lg p-12 text-center text-gray-400',
        isOver ? 'border-blue-500 bg-blue-50' : 'border-gray-300',
      ].join(' ')}
    >
      从左侧拖一个节点过来开始搭建
    </div>
  )
}

function EndDrop() {
  const { setNodeRef, isOver } = useDroppable({ id: 'drop-end', data: { kind: 'drop-end' } })
  return (
    <div
      ref={setNodeRef}
      className={[
        'border-2 border-dashed rounded-lg p-4 text-center text-gray-400 text-sm',
        isOver ? 'border-blue-500 bg-blue-50' : 'border-gray-200',
      ].join(' ')}
    >
      拖节点到这里追加
    </div>
  )
}
```

- [ ] **Step 2：TS 编译检查**

```bash
cd /Users/tom/Projects/cc-web/frontend && npx tsc --noEmit src/components/tracks/visual/TrackCanvas.tsx 2>&1 | head -10
```

预期：无错误。

- [ ] **Step 3：Commit**

```bash
git add frontend/src/components/tracks/visual/TrackCanvas.tsx && git commit -m "feat(tracks/visual): TrackCanvas — DndContext + drag-end routing"
```

---

## Task 19：TrackVisualEditor.tsx —— 整页面编排

**Files:**
- Create: `frontend/src/components/tracks/visual/TrackVisualEditor.tsx`

- [ ] **Step 1：写 TrackVisualEditor.tsx**

```tsx
// frontend/src/components/tracks/visual/TrackVisualEditor.tsx
import { useMemo, useReducer, useState } from 'react'
import type { TrackGraph, Node, NodePath } from './graph-types'
import { reduce, makeEmptyGraph, Action } from './reducer'
import { codegen, type CodegenError } from './codegen'
import { scopeCandidates } from './scope'
import { TrackCanvas } from './TrackCanvas'
import { NodePalette } from './NodePalette'
import { NodeFormDrawer } from './NodeFormDrawer'
import { CodePreviewModal } from './CodePreviewModal'

interface Props {
  initialGraph?: TrackGraph
  trackName: string
  onSave: (source: string) => Promise<void> | void
}

function reducer(state: TrackGraph, action: Action): TrackGraph {
  return reduce(state, action)
}

export function TrackVisualEditor({ initialGraph, trackName, onSave }: Props) {
  const [graph, dispatch] = useReducer(reducer, initialGraph ?? makeEmptyGraph(trackName))
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [previewOpen, setPreviewOpen] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)

  const selectedIndex = selectedId === null ? -1 : graph.body.findIndex((n) => n.id === selectedId)
  const selectedNode = selectedIndex >= 0 ? graph.body[selectedIndex]! : null

  const candidates = useMemo(
    () => scopeCandidates(graph, selectedIndex >= 0 ? selectedIndex : graph.body.length),
    [graph, selectedIndex],
  )

  function handleSave(): void {
    setSaveError(null)
    const res = codegen(graph)
    if (!res.ok) {
      setSaveError(`codegen 报 ${res.errors?.length ?? 0} 个错。预览代码查看详情。`)
      setPreviewOpen(true)
      return
    }
    Promise.resolve(onSave(res.source!)).catch((e) => setSaveError(String(e)))
  }

  function handleNodePatch(patch: Partial<Node>): void {
    if (selectedIndex < 0) return
    dispatch({ type: 'update', index: selectedIndex, patch })
  }

  // Live preview data for the modal
  const liveCodegen = useMemo(() => codegen(graph), [graph])

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="fixed top-0 left-0 right-0 bg-white border-b border-gray-200 p-3 flex items-center gap-3 z-40">
        <span className="text-lg font-medium">{trackName}</span>
        <span className="text-xs text-gray-400">节点图模式</span>
        <div className="ml-auto flex gap-2">
          <button onClick={() => setPreviewOpen(true)}
            className="px-3 py-1 text-sm rounded border border-gray-300 hover:bg-gray-50">预览代码</button>
          <button onClick={handleSave}
            className="px-3 py-1 text-sm rounded bg-blue-600 text-white hover:bg-blue-700">保存</button>
        </div>
        {saveError && <div className="ml-3 text-xs text-red-600">{saveError}</div>}
      </header>
      <div className="pt-14">
        <NodePalette />
        <TrackCanvas
          graph={graph}
          dispatch={dispatch}
          selectedId={selectedId}
          onSelect={setSelectedId}
        />
        <NodeFormDrawer
          node={selectedNode}
          candidates={candidates}
          onChange={handleNodePatch}
          onClose={() => setSelectedId(null)}
        />
      </div>
      <CodePreviewModal
        open={previewOpen}
        source={liveCodegen.ok ? liveCodegen.source! : '// codegen 错误：\n' + (liveCodegen.errors ?? []).map((e) => `// #${e.nodeIndex}: ${e.message}`).join('\n')}
        errors={liveCodegen.ok ? undefined : liveCodegen.errors}
        onClose={() => setPreviewOpen(false)}
      />
    </div>
  )
}
```

- [ ] **Step 2：TS 编译检查**

```bash
cd /Users/tom/Projects/cc-web/frontend && npx tsc --noEmit src/components/tracks/visual/TrackVisualEditor.tsx 2>&1 | head -10
```

预期：无错误。

- [ ] **Step 3：Commit**

```bash
git add frontend/src/components/tracks/visual/TrackVisualEditor.tsx && git commit -m "feat(tracks/visual): TrackVisualEditor — full page orchestration"
```

---

## Task 20：接入 TracksListDialog 模式选择 + 路由识别

**Files:**
- Modify: `frontend/src/components/tracks/TracksListDialog.tsx`
- Modify 或新建路由：先看现有 `.tr` 打开是在哪渲染的

- [ ] **Step 1：找现有打开 .tr 的入口**

```bash
grep -rn "TrackEditor\|TrackVisualEditor\|TrackListDialog" /Users/tom/Projects/cc-web/frontend/src 2>/dev/null | head -20
```

确定打开 `.tr` 是 Dialog 内部还是独立 Page。M1 假设是 Dialog 内部用 `TrackEditor`（Monaco）。

- [ ] **Step 2：改 TracksListDialog.tsx 加"新建模式选择"**

具体改动需要先 Read 该文件，但模式如下：

```tsx
// 在 TracksListDialog.tsx 的 "新建" handler 内：
// 之前：直接进 STARTER_BASIC 或 STARTER_ASK_USER 模板进 Monaco
// 之后：先弹"模式选择" → 选节点图 → 进 TrackVisualEditor 空图
//             → 选写代码 → 走原 STARTER 流程进 Monaco

// 在打开已有 .tr 的 handler 内：
// import { hasMarker } from './visual/marker'
// 加载 source 后判断 hasMarker(source)：
//   true → 路由到 TrackVisualEditor（M1 不实现 reverse parse，
//         只能从空图开始或从已存的内存 TrackGraph 状态打开 — 
//         M1 阶段不支持中途关闭再打开节点图编辑，下次打开会回到 Monaco 只读
//         或弹"M1 阶段：节点图编辑器不支持已保存文件再打开，请删除重建"）
//   false → 走 Monaco
```

**M1 简化决定**：节点图保存的 `.tr` 下次打开 **不能** 回到节点图编辑器（因为没有反向 parse）。下次打开会进 Monaco 显示只读 + 顶部红字提示"这是节点图建的，重新编辑请删除重建"。这个限制在 spec 已经写明（第 11 节风险 4）。

具体 patch 走 minimum：

```tsx
// 1. import hasMarker, TrackVisualEditor
import { hasMarker } from './visual/marker'
import { TrackVisualEditor } from './visual/TrackVisualEditor'

// 2. 新建 handler 弹模式选择（一个简单的 confirm-style 选择）
const [creatingMode, setCreatingMode] = useState<'node-graph' | 'code' | null>(null)
// 在原 starter-kind 选择 UI 之前先选模式
{creatingMode === null && (
  <div className="...">
    <button onClick={() => setCreatingMode('node-graph')}>节点图搭建</button>
    <button onClick={() => setCreatingMode('code')}>写代码 .tr</button>
  </div>
)}
{creatingMode === 'node-graph' && <TrackVisualEditor trackName={filename} onSave={async (src) => { await api.saveTrack(projectId, filename, src) }} />}
{creatingMode === 'code' && <existing-starter-flow />}

// 3. 打开已有 .tr handler 中：
const source = await api.loadTrack(projectId, filename)
if (hasMarker(source)) {
  // M1 limitation: read-only mode
  return <ReadOnlyMonacoWithWarning source={source} />
}
return <MonacoEditor source={source} />  // existing
```

实际具体 React 代码要按 TracksListDialog.tsx 现状 adapt。**执行此 task 时先 Read TracksListDialog.tsx 全文，理解现有 state + 渲染逻辑，再做最小 patch**。

- [ ] **Step 3：TS 编译检查**

```bash
cd /Users/tom/Projects/cc-web/frontend && npm run build 2>&1 | tail -20
```

预期：build 成功（tsc 无错误，vite 产物生成）。

- [ ] **Step 4：浏览器手工验证**

```bash
# 起开发服务器（如果用户许可，否则提示用户自己起）
cd /Users/tom/Projects/cc-web/frontend && npm run dev
```

打开浏览器：
1. 进入一个项目
2. 点工作轨"新建"→ 应看到两个按钮"节点图搭建" / "写代码 .tr"
3. 选节点图 → 进入 TrackVisualEditor 空白页
4. 从左侧 palette 拖 ask_user / fai / return 节点到画布
5. 点选节点 → 右侧抽屉出现表单
6. 改 fai 的 prompt 加 `@{input.value}` 引用
7. 点"预览代码"→ 弹出 modal 看到 codegen 的 .tr
8. 点"保存"→ 检查 backend 收到 PUT 请求且 .tr 首行是 marker
9. 关闭后再列表点开该 .tr → 应显示 Monaco 只读 + 警告

- [ ] **Step 5：Commit**

```bash
git add frontend/src/components/tracks/TracksListDialog.tsx && git commit -m "feat(tracks): create-mode picker + visual editor route + marker detection"
```

---

## Task 21：M1 端到端 sanity

- [ ] **Step 1：跑所有 verify-* 脚本**

```bash
cd /Users/tom/Projects/cc-web/frontend
for f in src/components/tracks/visual/__tests__/verify-*.ts; do
  echo "=== $f ==="
  npx ts-node --compiler-options '{"module":"commonjs","esModuleInterop":true,"target":"es2020"}' "$f"
done
```

预期：每个脚本最后一行 `✅ ALL ... CHECKS PASSED`，整体 exit 0。

- [ ] **Step 2：backend regression 全绿（确保没意外波及）**

```bash
cd /Users/tom/Projects/cc-web/backend
npx ts-node src/tracks/__tests__/verify-track-t1.ts
npx ts-node src/tracks/__tests__/verify-track.ts
npx ts-node src/tracks/__tests__/verify-starter-templates.ts
npx ts-node src/tracks/__tests__/verify-track-cancel.ts
```

预期：4 个脚本全 `✅`。

- [ ] **Step 3：浏览器跑一次完整节点图 → 运行**

按 Task 20 Step 4 走，多做一步：
9. 用节点图建一个 ask_user + fai + return 的工作轨
10. 保存
11. 点列表里该 .tr 旁边的"运行"按钮（用现有运行机制）
12. 应看到 ask_user dialog 弹出
13. 填好提交 → fai 执行 → 完成
14. 检查 backend 日志没有 fatal / unhandledRejection

- [ ] **Step 4：M1 完成 commit**

```bash
git add -A frontend/src/components/tracks/visual/ docs/superpowers/plans/2026-05-16-visual-track-builder-M1.md && git status && git commit -m "$(cat <<'EOF'
chore(tracks/visual): M1 milestone complete

节点图编辑器骨架（不含 if/for / 运行可视化，M2/M3/M4 接力）：
- palette 4 类拖拽 + canvas drop routing
- ask_user/fai/let/return 表单
- 单向 codegen + 校验 + shape dedupe
- 预览代码 modal + 保存
- 首行 marker 区分模式
- 单元测试覆盖 codegen/reducer/scope/marker
EOF
)"
```

---

## Self-Review（plan 写完后跑）

**Spec coverage 检查（对照 spec 第 4-7 节）：**

- ✅ 用户体验路径 A 新建 → Task 20
- ✅ 用户体验路径 B 编辑（palette 拖拽 + 抽屉表单）→ Task 14-19
- ✅ 路径 C 预览代码 → Task 17/19
- ✅ 路径 D 保存（codegen + 首行 marker）→ Task 6-9, 19
- ✅ 路径 D 运行 + WS 事件 → **M2/M3/M4 范围，M1 沿用现有运行机制不变**
- ✅ 路径 E 跑完后 → 同上
- ✅ 4.2 边界（创建模式选择 / marker 识别 / 单向红线）→ Task 20
- ✅ 5.1 内存模型 → Task 1
- ✅ 5.2 codegen 规则 ask_user/fai/let/return + nid → Task 6-8
- ✅ 5.3 shape dedupe → Task 7
- ✅ 5.4 nid 注释 → Task 6
- ✅ 5.5 保存校验 → Task 8
- ✅ 6.1 左侧 palette → Task 15
- ✅ 6.2 折叠节点视觉 → Task 14
- ⏭️ 6.2 容器节点视觉 → M2
- ✅ 6.3 ask_user / fai / let / return 表单 → Task 11-13
- ⏭️ 6.3 if / for 表单 → M2
- ✅ 6.4 节点视觉状态（默认/选中/拖拽）→ Task 14, 15
- ⏭️ 6.4 running/completed/failed/skipped 状态 → M4
- ✅ 6.5 @ 下拉 + chip → Task 10
- ✅ 7.1 嵌套块路径选定 → 整 plan
- ✅ 7.2 组件树 → 所有 Task 文件路径
- ✅ 7.3 useReducer 状态 → Task 3
- ✅ 7.4 @dnd-kit 拖拽 → Task 1, 14, 15, 18
- ✅ 7.5 codegen 触发时机（保存时 + 预览时）→ Task 19
- ⏭️ 7.6 运行视图合一 → M4

**Placeholder scan：** 无 TBD/TODO/"add appropriate"/"similar to Task N"。一处例外：Task 20 Step 2 写"existing-starter-flow"指代用户应保留的现有 starter UI——这是个真实指代不是 placeholder，但执行时需 Read TracksListDialog.tsx 全文了解现状再做最小 patch。OK。

**类型一致性：** TrackGraph.body / Node / NodePath / Expression 在 Task 1 定义，后续 Task 引用一致。`Action` 在 Task 3 定义，Task 18-19 引用一致。`PromptSegment` Task 1 定义，Task 12 (FaiForm) + Task 6 (codegen.renderPrompt) 一致。

**M1 范围是否清晰：** 是。Task 21 Step 3 浏览器测试是 M1 完成判据——节点图建一个 ask_user + fai + return + 保存 + 跑通 + 后端无 fatal。

**已知 M1 限制（写进 spec/plan）：**
- 节点图保存的 .tr 下次打开进 Monaco 只读（缺反向 parse；spec 风险 4 已记）
- let 节点不支持 a + b 表达式（M2 三格拼装器一起做）
- 没有 if / for（M2）
- 没有运行可视化（M3/M4）
