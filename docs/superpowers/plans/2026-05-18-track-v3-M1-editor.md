# Track Flow Engine v3 — M1（编辑器骨架 + 数据模型 + 保存）Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 实现 v3 工作轨编辑器骨架：3 类节点（user_input / llm / if）+ 变量声明面板 + 自由拖 ReactFlow 画布 + Prompt 智能补全 + .flow JSON 持久化 + train.json sidecar + backend CRUD 端点。M1 完成后用户可以创建工作轨、定义变量、拖节点连边、写 prompt、保存到 `.ccweb/tracks/<name>.flow`，**但还不能运行**（runtime 是 M2a）。

**Architecture:** ccweb 自己定义 `.flow` JSON 格式（version=3，含 variables / nodes / edges），不 codegen 到任何 DSL。前端 `frontend/src/components/tracks/flow/` 全新子目录，复用 reactflow + dagre + 现有 train-adapter-spec。后端 `backend/src/track-flow/` + `routes/track-flows.ts` 新文件（hyphen 命名避免与 v1 `flows/` `flows.ts` 任务流系统冲突）。Prompt 转译规则（§7）与 runtime（§9）留 M2，本 plan 仅写**编辑期**所需的智能补全 / 占位符提取 / 校验。

**Tech Stack:** TypeScript / React 18 / ReactFlow 11.11 / vitest 1.6 / tsx 4 / Tailwind / Radix Dialog / Express (backend) / Node fs/path

---

## 前置数据（spec 关键决策摘录，写入 plan 供 subagent 参考）

### A. 命名规范（避免与 v1 旧任务流冲突）

| v1 系统（保留不动） | v3 系统（M1 新建） |
|---|---|
| `backend/src/flows/` | `backend/src/track-flow/`（hyphen） |
| `backend/src/routes/flows.ts` + `global-flows.ts` | `backend/src/routes/track-flows.ts`（新） |
| API `/api/projects/:projectId/flows` | API `/api/projects/:projectId/track-flows` |
| `frontend/src/components/flows/` (如有) | `frontend/src/components/tracks/flow/` |

frontend 内 `tracks/flow/` 不会与任何已有目录冲突（M0 已删 visual/ graph/）。

### B. M1 范围（spec §16）— 含 / 不含

**含**：
- 数据模型 `FlowV3` / `NodeV3` / `EdgeV3` / `VarDecl`（spec §5.2）
- 3 节点视图（UserInputNode / LLMNode / IfNode + 隐式 End）
- ReactFlow 画布 + DeletableEdge（边删除 hover ×）
- NodePalette（左 dock 拖出 3 类节点）
- VariablesPanel（变量声明 CRUD：key/description/initialValue）
- NodeInspector（右抽屉，节点字段编辑）
- PromptTemplateEditor（智能补全 textarea：`@` / `$` 触发下拉，spec §6.5）
- prompt-placeholder-extractor（从 promptTemplate 推 inputs/outputs，spec §6.2）
- flow-validator（保存前结构校验，spec §14.2）
- flow-sidecar-io（.flow + train.json 文件 IO）
- backend track-flow/store + routes（GET list / POST create / GET file / PUT save / DELETE）
- TrackFlowEditor 顶层组装 + TrackFlowsListDialog 替换占位
- Dirty 关闭确认 + sidecar cross-check（M0 占位级别，desync 只 banner 不提供"重建 sidecar"）

**不含**（M2a/M2b/M3/M4 范围）：
- prompt-translator 转译规则（§7，runtime 用）
- if-expr-parser / evaluator（§5.4，runtime 用）
- Runtime state machine（§9）
- LLM 调用 / train.json 同步（§8.2）
- WS 事件（§10）
- 用户输入对话框运行时弹窗（§6.1 运行时行为）
- 节点状态边框 / 变量面板实时刷新
- 跳回循环可视化
- 浏览器实测发版（M1 不发版；M0 已发 v-18-c，M2a 完成后才有运行能力，到那时再发）

### C. 关键文件清单（M1 创建 vs 修改）

**新建 frontend** (`frontend/src/components/tracks/flow/`)：

```
flow-types-v3.ts                  TS 类型 (FlowV3 / NodeV3 / EdgeV3 / VarDecl)
flow-reducer.ts                   useReducer (节点/边/变量 CRUD)
flow-validator.ts                 保存前结构校验
flow-sidecar-io.ts                .flow + train.json 文件 IO + cross-check
prompt-placeholder-extractor.ts   从 promptTemplate 提取 @{key} ${key}
GraphContext.tsx                  React Context 注入 dispatch 到节点组件
TrackFlowEditor.tsx               顶层 Dialog 内容
FlowToolbar.tsx                   filename / save / variables panel toggle
FlowCanvas.tsx                    ReactFlow 容器
NodePalette.tsx                   左 dock，3 类节点拖出
VariablesPanel.tsx                变量声明列表 + CRUD
NodeInspector.tsx                 右抽屉
PromptTemplateEditor.tsx          智能补全 textarea (§6.5)
IdentifierInput.tsx               valid identifier 校验输入框（复用 v2 模式）
TrackFlowsListDialog.tsx          替换 TracksListDialog 占位
nodes/NodeHeader.tsx              共享节点头（icon + label + ×）
nodes/UserInputNode.tsx
nodes/LLMNode.tsx
nodes/IfNode.tsx
nodes/EndPort.tsx                 隐式 end 终点圆点
edges/DeletableEdge.tsx           hover × 删除（复用 v2 逻辑）
__tests__/prompt-placeholder-extractor.test.ts
__tests__/flow-reducer.test.ts
__tests__/flow-validator.test.ts
__tests__/flow-sidecar-io.test.ts
```

**修改 frontend**：

```
frontend/src/components/tracks/TracksListDialog.tsx    — 替换占位 (delegate to TrackFlowsListDialog) 或直接删
frontend/src/components/tracks/api.ts                  — 加 track-flows endpoints
```

**新建 backend** (`backend/src/track-flow/`)：

```
backend/src/track-flow/store.ts          .flow + .train.json 文件 IO
backend/src/track-flow/index.ts          模块 barrel
```

**新建 backend route**：

```
backend/src/routes/track-flows.ts
```

**修改 backend**：

```
backend/src/index.ts                     — mount track-flows router
```

---

## Task 1：创建 flow-types-v3.ts + 工作目录骨架

**Files:**
- Create: `frontend/src/components/tracks/flow/flow-types-v3.ts`

- [ ] **Step 1：确认 M0 后 frontend tracks 状态**

```bash
ls /Users/tom/Projects/cc-web/frontend/src/components/tracks/
ls /Users/tom/Projects/cc-web/frontend/src/components/tracks/flow/ 2>&1 | head -3
```

预期：tracks/ 有 6 文件（api.ts / TracksListDialog.tsx / TrackStatusBar.tsx / TrackUserInputDialog.tsx / types.ts / useTrackState.ts），`flow/` 子目录不存在。

- [ ] **Step 2：创建目录 + flow-types-v3.ts**

```bash
mkdir -p /Users/tom/Projects/cc-web/frontend/src/components/tracks/flow/nodes
mkdir -p /Users/tom/Projects/cc-web/frontend/src/components/tracks/flow/edges
mkdir -p /Users/tom/Projects/cc-web/frontend/src/components/tracks/flow/__tests__
```

写 `frontend/src/components/tracks/flow/flow-types-v3.ts` 完整内容：

```typescript
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
```

- [ ] **Step 3：tsc 通过**

```bash
cd /Users/tom/Projects/cc-web/frontend
npx tsc --noEmit
```

预期：通过。

- [ ] **Step 4：Commit**

```bash
cd /Users/tom/Projects/cc-web
git add frontend/src/components/tracks/flow/flow-types-v3.ts
git commit -m "feat(track-flow): v3 types — FlowV3 / NodeV3 / EdgeV3 / VarDecl + id helpers"
```

**commit 无 Claude 署名**（用户全局规则）。

---

## Task 2：prompt-placeholder-extractor.ts + TDD

**Files:**
- Create: `frontend/src/components/tracks/flow/prompt-placeholder-extractor.ts`
- Create: `frontend/src/components/tracks/flow/__tests__/prompt-placeholder-extractor.test.ts`

- [ ] **Step 1：写失败测试**

```typescript
// frontend/src/components/tracks/flow/__tests__/prompt-placeholder-extractor.test.ts
import { describe, it, expect } from 'vitest'
import { extractInputs, extractOutputs } from '../prompt-placeholder-extractor'

describe('prompt-placeholder-extractor', () => {
  it('空字符串返空数组', () => {
    expect(extractInputs('')).toEqual([])
    expect(extractOutputs('')).toEqual([])
  })

  it('单个 @{var} → inputs', () => {
    expect(extractInputs('请调研@{area}的论文')).toEqual(['area'])
    expect(extractOutputs('请调研@{area}的论文')).toEqual([])
  })

  it('单个 ${var} → outputs', () => {
    expect(extractInputs('修改 ${has_error}')).toEqual([])
    expect(extractOutputs('修改 ${has_error}')).toEqual(['has_error'])
  })

  it('混合 + 多个引用 + 去重', () => {
    const tpl = '请检查@{ref_fp}中的论文，相关性 @{area}，结果写入 ${has_error}，再次检查@{area}'
    expect(extractInputs(tpl)).toEqual(['ref_fp', 'area'])  // 保序 + 去重
    expect(extractOutputs(tpl)).toEqual(['has_error'])
  })

  it('非法名字（数字开头 / 含连字符）→ 忽略', () => {
    expect(extractInputs('@{1abc} @{-foo} @{valid_name}')).toEqual(['valid_name'])
  })

  it('占位符内部不允许空格', () => {
    expect(extractInputs('@{ space }')).toEqual([])
    expect(extractInputs('@{has space}')).toEqual([])
  })

  it('转义字符不参与匹配（M1 不实现转义；测试当前行为：字面 @ 不触发）', () => {
    // 仅验证 @ 后不接 { 时不触发匹配
    expect(extractInputs('email @example.com')).toEqual([])
  })
})
```

- [ ] **Step 2：跑测试看失败**

```bash
cd /Users/tom/Projects/cc-web/frontend
npx vitest run src/components/tracks/flow/__tests__/prompt-placeholder-extractor.test.ts
```

预期：模块不存在，FAIL。

- [ ] **Step 3：实现 prompt-placeholder-extractor.ts**

```typescript
// frontend/src/components/tracks/flow/prompt-placeholder-extractor.ts

/**
 * Extract input/output variable keys from a prompt template.
 * Inputs are `@{key}`, outputs are `${key}`.
 * Returns deduplicated keys in first-occurrence order.
 *
 * spec §6.2 / §7：M1 仅做提取，不做求值或转译。
 */

const VALID_KEY_RE = /^[a-zA-Z_][a-zA-Z0-9_]*$/

function extractKeys(template: string, prefix: '@' | '$'): string[] {
  const re = prefix === '@'
    ? /@\{([^}]*)\}/g
    : /\$\{([^}]*)\}/g
  const seen = new Set<string>()
  const out: string[] = []
  let m: RegExpExecArray | null
  while ((m = re.exec(template)) !== null) {
    const key = m[1] ?? ''
    if (VALID_KEY_RE.test(key) && !seen.has(key)) {
      seen.add(key)
      out.push(key)
    }
  }
  return out
}

export function extractInputs(template: string): string[] {
  return extractKeys(template, '@')
}

export function extractOutputs(template: string): string[] {
  return extractKeys(template, '$')
}
```

- [ ] **Step 4：跑测试通过**

```bash
npx vitest run src/components/tracks/flow/__tests__/prompt-placeholder-extractor.test.ts
```

预期：7/7 PASS。

- [ ] **Step 5：Commit**

```bash
cd /Users/tom/Projects/cc-web
git add frontend/src/components/tracks/flow/prompt-placeholder-extractor.ts \
  frontend/src/components/tracks/flow/__tests__/prompt-placeholder-extractor.test.ts
git commit -m "feat(track-flow): v3 prompt placeholder extractor (@/\$ → inputs/outputs)"
```

---

## Task 3：flow-reducer.ts + TDD

**Files:**
- Create: `frontend/src/components/tracks/flow/flow-reducer.ts`
- Create: `frontend/src/components/tracks/flow/__tests__/flow-reducer.test.ts`

- [ ] **Step 1：写失败测试**

```typescript
// frontend/src/components/tracks/flow/__tests__/flow-reducer.test.ts
import { describe, it, expect } from 'vitest'
import { reducer, initialFlow } from '../flow-reducer'
import type { UserInputNode, LLMNode, IfNode, VarDecl } from '../flow-types-v3'

describe('flow-reducer', () => {
  it('initialFlow 空', () => {
    const f = initialFlow('test')
    expect(f.version).toBe(3)
    expect(f.trackName).toBe('test')
    expect(f.adapter).toBe('claude-code')
    expect(f.variables).toEqual([])
    expect(f.nodes).toEqual([])
    expect(f.edges).toEqual([])
  })

  it('add_variable + remove_variable', () => {
    const f0 = initialFlow('t')
    const v: VarDecl = { key: 'area', description: '研究领域', initialValue: null }
    let f = reducer(f0, { type: 'add_variable', variable: v })
    expect(f.variables).toHaveLength(1)
    expect(f.variables[0]!.key).toBe('area')
    f = reducer(f, { type: 'remove_variable', key: 'area' })
    expect(f.variables).toEqual([])
  })

  it('update_variable 改 description / initialValue', () => {
    const f0 = initialFlow('t')
    const v: VarDecl = { key: 'a', description: 'd1', initialValue: null }
    let f = reducer(f0, { type: 'add_variable', variable: v })
    f = reducer(f, { type: 'update_variable', key: 'a', patch: { description: 'd2', initialValue: 42 } })
    expect(f.variables[0]!.description).toBe('d2')
    expect(f.variables[0]!.initialValue).toBe(42)
  })

  it('add_node 追加', () => {
    const f0 = initialFlow('t')
    const n: UserInputNode = { id: 'n_a', type: 'user_input', position: { x: 0, y: 0 }, fields: [] }
    const f = reducer(f0, { type: 'add_node', node: n })
    expect(f.nodes).toHaveLength(1)
    expect(f.nodes[0]!.id).toBe('n_a')
  })

  it('remove_node 同时删相关 edges', () => {
    const f0 = initialFlow('t')
    const a: UserInputNode = { id: 'n_a', type: 'user_input', position: { x: 0, y: 0 }, fields: [] }
    const b: IfNode = { id: 'n_b', type: 'if', position: { x: 0, y: 100 }, conditionExpr: 'x == 1' }
    let f = reducer(f0, { type: 'add_node', node: a })
    f = reducer(f, { type: 'add_node', node: b })
    f = reducer(f, { type: 'add_edge', source: 'n_a', target: 'n_b' })
    expect(f.edges).toHaveLength(1)
    f = reducer(f, { type: 'remove_node', nodeId: 'n_a' })
    expect(f.nodes).toHaveLength(1)
    expect(f.edges).toEqual([])
  })

  it('add_edge 同 source+sourceHandle+target 去重', () => {
    const f0 = initialFlow('t')
    const a: UserInputNode = { id: 'n_a', type: 'user_input', position: { x: 0, y: 0 }, fields: [] }
    const b: IfNode = { id: 'n_b', type: 'if', position: { x: 0, y: 100 }, conditionExpr: 'x' }
    let f = reducer(f0, { type: 'add_node', node: a })
    f = reducer(f, { type: 'add_node', node: b })
    f = reducer(f, { type: 'add_edge', source: 'n_a', target: 'n_b' })
    f = reducer(f, { type: 'add_edge', source: 'n_a', target: 'n_b' })
    expect(f.edges).toHaveLength(1)
  })

  it('if 节点 true / false 双出口共存', () => {
    const f0 = initialFlow('t')
    const if_: IfNode = { id: 'n_if', type: 'if', position: { x: 0, y: 0 }, conditionExpr: 'x' }
    const t: LLMNode = { id: 'n_t', type: 'llm', position: { x: 0, y: 100 }, promptTemplate: '', inputs: [], outputs: [] }
    const fn: LLMNode = { id: 'n_f', type: 'llm', position: { x: 0, y: 200 }, promptTemplate: '', inputs: [], outputs: [] }
    let f = reducer(f0, { type: 'add_node', node: if_ })
    f = reducer(f, { type: 'add_node', node: t })
    f = reducer(f, { type: 'add_node', node: fn })
    f = reducer(f, { type: 'add_edge', source: 'n_if', sourceHandle: 'true', target: 'n_t' })
    f = reducer(f, { type: 'add_edge', source: 'n_if', sourceHandle: 'false', target: 'n_f' })
    expect(f.edges).toHaveLength(2)
  })

  it('update_node patch', () => {
    const f0 = initialFlow('t')
    const n: LLMNode = {
      id: 'n_l', type: 'llm', position: { x: 0, y: 0 },
      promptTemplate: '', inputs: [], outputs: [],
    }
    let f = reducer(f0, { type: 'add_node', node: n })
    f = reducer(f, { type: 'update_node', nodeId: 'n_l', patch: { promptTemplate: 'hello @{x}' } })
    expect((f.nodes[0] as LLMNode).promptTemplate).toBe('hello @{x}')
  })

  it('move_node', () => {
    const f0 = initialFlow('t')
    const n: UserInputNode = { id: 'n_a', type: 'user_input', position: { x: 0, y: 0 }, fields: [] }
    let f = reducer(f0, { type: 'add_node', node: n })
    f = reducer(f, { type: 'move_node', nodeId: 'n_a', position: { x: 100, y: 50 } })
    expect(f.nodes[0]!.position).toEqual({ x: 100, y: 50 })
  })

  it('set_track_name + set_adapter', () => {
    const f0 = initialFlow('t')
    let f = reducer(f0, { type: 'set_track_name', name: 'renamed' })
    expect(f.trackName).toBe('renamed')
    f = reducer(f, { type: 'set_adapter', adapter: 'codex' })
    expect(f.adapter).toBe('codex')
  })

  it('replace 全量替换', () => {
    const f0 = initialFlow('t')
    const fNew = initialFlow('other')
    const f = reducer(f0, { type: 'replace', flow: fNew })
    expect(f.trackName).toBe('other')
  })
})
```

- [ ] **Step 2：跑失败**

```bash
npx vitest run src/components/tracks/flow/__tests__/flow-reducer.test.ts
```

预期：FAIL，模块不存在。

- [ ] **Step 3：实现 flow-reducer.ts**

```typescript
// frontend/src/components/tracks/flow/flow-reducer.ts
import {
  AdapterKind, EdgeV3, FlowV3, NodeV3, VarDecl,
  emptyFlow, newEdgeId,
} from './flow-types-v3'

export type Action =
  | { type: 'add_variable'; variable: VarDecl }
  | { type: 'remove_variable'; key: string }
  | { type: 'update_variable'; key: string; patch: Partial<VarDecl> }
  | { type: 'add_node'; node: NodeV3 }
  | { type: 'remove_node'; nodeId: string }
  | { type: 'update_node'; nodeId: string; patch: Partial<NodeV3> }
  | { type: 'move_node'; nodeId: string; position: { x: number; y: number } }
  | { type: 'add_edge'; source: string; sourceHandle?: 'default' | 'true' | 'false'; target: string | null }
  | { type: 'remove_edge'; edgeId: string }
  | { type: 'set_track_name'; name: string }
  | { type: 'set_adapter'; adapter: AdapterKind }
  | { type: 'replace'; flow: FlowV3 }

export function initialFlow(trackName: string, adapter: AdapterKind = 'claude-code'): FlowV3 {
  return emptyFlow(trackName, adapter)
}

export function reducer(state: FlowV3, action: Action): FlowV3 {
  switch (action.type) {
    case 'add_variable':
      if (state.variables.some((v) => v.key === action.variable.key)) return state  // duplicate key ignored
      return { ...state, variables: [...state.variables, action.variable] }
    case 'remove_variable':
      return { ...state, variables: state.variables.filter((v) => v.key !== action.key) }
    case 'update_variable':
      return {
        ...state,
        variables: state.variables.map((v) =>
          v.key === action.key ? { ...v, ...action.patch } : v,
        ),
      }
    case 'add_node':
      return { ...state, nodes: [...state.nodes, action.node] }
    case 'remove_node':
      return {
        ...state,
        nodes: state.nodes.filter((n) => n.id !== action.nodeId),
        edges: state.edges.filter(
          (e) => e.source !== action.nodeId && e.target !== action.nodeId,
        ),
      }
    case 'update_node':
      return {
        ...state,
        nodes: state.nodes.map((n) =>
          n.id === action.nodeId ? ({ ...n, ...action.patch } as NodeV3) : n,
        ),
      }
    case 'move_node':
      return {
        ...state,
        nodes: state.nodes.map((n) =>
          n.id === action.nodeId ? { ...n, position: action.position } : n,
        ),
      }
    case 'add_edge': {
      const handle = action.sourceHandle ?? 'default'
      const dup = state.edges.some(
        (e) =>
          e.source === action.source &&
          (e.sourceHandle ?? 'default') === handle &&
          e.target === action.target,
      )
      if (dup) return state
      const edge: EdgeV3 = {
        id: newEdgeId(),
        source: action.source,
        sourceHandle: handle,
        target: action.target,
      }
      return { ...state, edges: [...state.edges, edge] }
    }
    case 'remove_edge':
      return { ...state, edges: state.edges.filter((e) => e.id !== action.edgeId) }
    case 'set_track_name':
      return { ...state, trackName: action.name }
    case 'set_adapter':
      return { ...state, adapter: action.adapter }
    case 'replace':
      return action.flow
    default:
      return state
  }
}
```

- [ ] **Step 4：跑测试通过**

```bash
npx vitest run src/components/tracks/flow/__tests__/flow-reducer.test.ts
```

预期：11/11 PASS。

- [ ] **Step 5：Commit**

```bash
cd /Users/tom/Projects/cc-web
git add frontend/src/components/tracks/flow/flow-reducer.ts \
  frontend/src/components/tracks/flow/__tests__/flow-reducer.test.ts
git commit -m "feat(track-flow): v3 reducer — variable/node/edge CRUD with edge cascade on remove"
```

---

## Task 4：flow-validator.ts + TDD

**Files:**
- Create: `frontend/src/components/tracks/flow/flow-validator.ts`
- Create: `frontend/src/components/tracks/flow/__tests__/flow-validator.test.ts`

按 spec §14.2 实现保存前结构校验：唯一入口 + 所有节点可达 + 变量声明无重名 + adapter 合法。

- [ ] **Step 1：写失败测试**

```typescript
// frontend/src/components/tracks/flow/__tests__/flow-validator.test.ts
import { describe, it, expect } from 'vitest'
import { validateFlow } from '../flow-validator'
import { initialFlow } from '../flow-reducer'
import type { FlowV3, UserInputNode, LLMNode, IfNode } from '../flow-types-v3'

describe('flow-validator', () => {
  it('空 flow → 错误：缺入口', () => {
    const r = validateFlow(initialFlow('t'))
    expect(r.ok).toBe(false)
    expect(r.errors.some((e) => /入口|空/.test(e.message))).toBe(true)
  })

  it('唯一入口 + 一个节点 → ok', () => {
    const f = initialFlow('t')
    const n: UserInputNode = { id: 'n_a', type: 'user_input', position: { x: 0, y: 0 }, fields: [] }
    f.nodes.push(n)
    const r = validateFlow(f)
    expect(r.ok).toBe(true)
  })

  it('多入口 → 错误', () => {
    const f = initialFlow('t')
    const a: UserInputNode = { id: 'n_a', type: 'user_input', position: { x: 0, y: 0 }, fields: [] }
    const b: UserInputNode = { id: 'n_b', type: 'user_input', position: { x: 0, y: 100 }, fields: [] }
    f.nodes.push(a, b)
    const r = validateFlow(f)
    expect(r.ok).toBe(false)
    expect(r.errors.some((e) => /多入口/.test(e.message))).toBe(true)
  })

  it('孤立节点（不可达入口）→ 错误', () => {
    const f = initialFlow('t')
    const entry: UserInputNode = { id: 'n_e', type: 'user_input', position: { x: 0, y: 0 }, fields: [] }
    const orphan: LLMNode = {
      id: 'n_o', type: 'llm', position: { x: 100, y: 0 },
      promptTemplate: '', inputs: [], outputs: [],
    }
    // 加一个 next 让 entry 不再是孤立（entry 有 entry: no incoming. orphan 也是 no incoming. 多入口）
    // 改设计：entry → next，但 orphan 浮空
    const next: LLMNode = {
      id: 'n_n', type: 'llm', position: { x: 0, y: 100 },
      promptTemplate: '', inputs: [], outputs: [],
    }
    f.nodes.push(entry, next, orphan)
    f.edges.push({ id: 'e1', source: 'n_e', target: 'n_n', sourceHandle: 'default' })
    const r = validateFlow(f)
    expect(r.ok).toBe(false)
    // orphan 有 no incoming，与 entry 一样 → 报"多入口"
    expect(r.errors.some((e) => /多入口|孤立/.test(e.message))).toBe(true)
  })

  it('变量声明重名 → 错误', () => {
    const f = initialFlow('t')
    f.variables.push({ key: 'x', description: 'a', initialValue: null })
    f.variables.push({ key: 'x', description: 'b', initialValue: null })
    const n: UserInputNode = { id: 'n_a', type: 'user_input', position: { x: 0, y: 0 }, fields: [] }
    f.nodes.push(n)
    const r = validateFlow(f)
    expect(r.ok).toBe(false)
    expect(r.errors.some((e) => /重名|duplicate/i.test(e.message))).toBe(true)
  })

  it('变量 key 非法 identifier → 错误', () => {
    const f = initialFlow('t')
    f.variables.push({ key: '1abc', description: 'bad', initialValue: null })
    const n: UserInputNode = { id: 'n_a', type: 'user_input', position: { x: 0, y: 0 }, fields: [] }
    f.nodes.push(n)
    const r = validateFlow(f)
    expect(r.ok).toBe(false)
    expect(r.errors.some((e) => /1abc|identifier|invalid/i.test(e.message))).toBe(true)
  })

  it('LLM 节点 promptTemplate 引用未声明 var → 错误', () => {
    const f = initialFlow('t')
    const n: LLMNode = {
      id: 'n_l', type: 'llm', position: { x: 0, y: 0 },
      promptTemplate: '请处理 @{area}', inputs: ['area'], outputs: [],
    }
    f.nodes.push(n)
    // area 没在 variables 表声明
    const r = validateFlow(f)
    expect(r.ok).toBe(false)
    expect(r.errors.some((e) => /area|未声明|未定义/.test(e.message))).toBe(true)
  })

  it('adapter 合法 + 引用 var 都声明 → ok', () => {
    const f: FlowV3 = {
      version: 3, trackName: 't', adapter: 'claude-code',
      variables: [{ key: 'area', description: '', initialValue: null }],
      nodes: [{
        id: 'n_l', type: 'llm', position: { x: 0, y: 0 },
        promptTemplate: '@{area}', inputs: ['area'], outputs: [],
      }],
      edges: [],
    }
    const r = validateFlow(f)
    expect(r.ok).toBe(true)
  })
})
```

- [ ] **Step 2：跑失败**

```bash
npx vitest run src/components/tracks/flow/__tests__/flow-validator.test.ts
```

预期：FAIL，模块不存在。

- [ ] **Step 3：实现 flow-validator.ts**

```typescript
// frontend/src/components/tracks/flow/flow-validator.ts
import type { FlowV3, NodeV3 } from './flow-types-v3'
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

  // 2. 变量
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
```

- [ ] **Step 4：跑测试通过**

```bash
npx vitest run src/components/tracks/flow/__tests__/flow-validator.test.ts
```

预期：8/8 PASS。

- [ ] **Step 5：Commit**

```bash
cd /Users/tom/Projects/cc-web
git add frontend/src/components/tracks/flow/flow-validator.ts \
  frontend/src/components/tracks/flow/__tests__/flow-validator.test.ts
git commit -m "feat(track-flow): v3 validator — unique entry / no orphan / var refs / adapter"
```

---

## Task 5：backend track-flow/store.ts + TDD

**Files:**
- Create: `backend/src/track-flow/store.ts`
- Create: `backend/src/track-flow/index.ts`

按 spec §5.1 / §8.1：`.ccweb/tracks/<basename>.flow`（JSON）+ `.ccweb/tracks/<basename>.train.json`（sidecar 全局变量字典）。

- [ ] **Step 1：实现 store.ts**

```typescript
// backend/src/track-flow/store.ts
import * as fs from 'fs'
import * as path from 'path'

/**
 * Sanitize filename — same rules as backend/src/tracks/store.ts sanitizeTrackFilename,
 * but expects `.flow` suffix.
 *
 * Returns sanitized basename WITHOUT extension on success, null on invalid input.
 */
export function sanitizeFlowFilename(raw: string): string | null {
  if (typeof raw !== 'string') return null
  const stripped = raw.replace(/\.flow$/i, '')
  if (stripped.length === 0 || stripped.length > 100) return null
  if (!/^[a-zA-Z0-9_一-龥぀-ヿ-]+$/.test(stripped)) return null
  if (stripped.startsWith('.')) return null
  return stripped
}

function flowDir(projectFolder: string): string {
  return path.join(projectFolder, '.ccweb', 'tracks')
}

function flowPath(projectFolder: string, basename: string): string {
  return path.join(flowDir(projectFolder), `${basename}.flow`)
}

function trainJsonPath(projectFolder: string, basename: string): string {
  return path.join(flowDir(projectFolder), `${basename}.train.json`)
}

export interface FlowFileInfo {
  filename: string                       // <basename>.flow
  basename: string                       // <basename>
  size: number
  mtimeMs: number
}

export function listFlows(projectFolder: string): FlowFileInfo[] {
  const dir = flowDir(projectFolder)
  try {
    if (!fs.existsSync(dir)) return []
    const entries = fs.readdirSync(dir, { withFileTypes: true })
    return entries
      .filter((e) => e.isFile() && e.name.endsWith('.flow'))
      .map((e) => {
        const full = path.join(dir, e.name)
        const stat = fs.statSync(full)
        return {
          filename: e.name,
          basename: e.name.replace(/\.flow$/, ''),
          size: stat.size,
          mtimeMs: stat.mtimeMs,
        }
      })
      .sort((a, b) => b.mtimeMs - a.mtimeMs)
  } catch {
    return []
  }
}

export function loadFlow(projectFolder: string, basename: string): unknown | null {
  const p = flowPath(projectFolder, basename)
  try {
    if (!fs.existsSync(p)) return null
    const raw = fs.readFileSync(p, 'utf8')
    return JSON.parse(raw)
  } catch {
    return null
  }
}

export function loadTrainJson(projectFolder: string, basename: string): Record<string, unknown> | null {
  const p = trainJsonPath(projectFolder, basename)
  try {
    if (!fs.existsSync(p)) return null
    const raw = fs.readFileSync(p, 'utf8')
    const parsed = JSON.parse(raw)
    if (typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>
    }
    return null
  } catch {
    return null
  }
}

/** Atomic write: temp file + rename. */
function atomicWriteJson(target: string, value: unknown): boolean {
  const dir = path.dirname(target)
  try {
    fs.mkdirSync(dir, { recursive: true })
    const tmp = `${target}.tmp.${process.pid}.${Date.now()}`
    fs.writeFileSync(tmp, JSON.stringify(value, null, 2), 'utf8')
    fs.renameSync(tmp, target)
    return true
  } catch {
    return false
  }
}

export function saveFlow(projectFolder: string, basename: string, flow: unknown): boolean {
  return atomicWriteJson(flowPath(projectFolder, basename), flow)
}

export function saveTrainJson(
  projectFolder: string,
  basename: string,
  trainJson: Record<string, unknown>,
): boolean {
  return atomicWriteJson(trainJsonPath(projectFolder, basename), trainJson)
}

export function deleteFlow(projectFolder: string, basename: string): boolean {
  try {
    const p = flowPath(projectFolder, basename)
    const tp = trainJsonPath(projectFolder, basename)
    if (fs.existsSync(p)) fs.unlinkSync(p)
    if (fs.existsSync(tp)) fs.unlinkSync(tp)
    return true
  } catch {
    return false
  }
}
```

- [ ] **Step 2：实现 backend/src/track-flow/index.ts**

```typescript
// backend/src/track-flow/index.ts
export * from './store'
```

- [ ] **Step 3：backend tsc 通过**

```bash
cd /Users/tom/Projects/cc-web/backend
npx tsc --noEmit
```

预期：通过。

- [ ] **Step 4：Commit**

```bash
cd /Users/tom/Projects/cc-web
git add backend/src/track-flow/store.ts backend/src/track-flow/index.ts
git commit -m "feat(track-flow): backend store — .flow + .train.json sidecar IO (atomic write)"
```

---

## Task 6：backend routes/track-flows.ts + 挂载

**Files:**
- Create: `backend/src/routes/track-flows.ts`
- Modify: `backend/src/index.ts` — 挂载新路由

按 spec §12.3 端点清单（M1 范围：CRUD，不含 run / user_input / cancel —— 那是 M2-M3）。

- [ ] **Step 1：实现 routes/track-flows.ts**

```typescript
// backend/src/routes/track-flows.ts
import { Router, Response } from 'express'
import type { AuthRequest } from '../auth'
import { getProject } from '../config'
import { requireProjectOwner } from '../middleware/authz'
import {
  listFlows, loadFlow, saveFlow, deleteFlow,
  loadTrainJson, saveTrainJson, sanitizeFlowFilename,
} from '../track-flow/store'
import { modLogger } from '../logger'

const log = modLogger('track-flows-route')

export function buildTrackFlowsRouter(): Router {
  const router = Router()

  // GET /api/projects/:projectId/track-flows — list
  router.get(
    '/:projectId/track-flows',
    requireProjectOwner('projectId'),
    (req: AuthRequest, res: Response): void => {
      const project = getProject(req.params.projectId)
      if (!project) {
        res.status(404).json({ error: 'Project not found' })
        return
      }
      const files = listFlows(project.folderPath)
      res.json({ files })
    },
  )

  // GET /api/projects/:projectId/track-flows/file/:filename
  router.get(
    '/:projectId/track-flows/file/:filename',
    requireProjectOwner('projectId'),
    (req: AuthRequest, res: Response): void => {
      const project = getProject(req.params.projectId)
      if (!project) {
        res.status(404).json({ error: 'Project not found' })
        return
      }
      const basename = sanitizeFlowFilename(req.params.filename)
      if (!basename) {
        res.status(400).json({ error: 'invalid filename' })
        return
      }
      const flow = loadFlow(project.folderPath, basename)
      if (flow === null) {
        res.status(404).json({ error: 'flow not found' })
        return
      }
      const trainJson = loadTrainJson(project.folderPath, basename)
      res.json({ filename: `${basename}.flow`, flow, trainJson })
    },
  )

  // PUT /api/projects/:projectId/track-flows/file/:filename — body { flow, trainJson? }
  router.put(
    '/:projectId/track-flows/file/:filename',
    requireProjectOwner('projectId'),
    (req: AuthRequest, res: Response): void => {
      const project = getProject(req.params.projectId)
      if (!project) {
        res.status(404).json({ error: 'Project not found' })
        return
      }
      const basename = sanitizeFlowFilename(req.params.filename)
      if (!basename) {
        res.status(400).json({ error: 'invalid filename' })
        return
      }
      const flow = req.body?.flow
      if (typeof flow !== 'object' || flow === null) {
        res.status(400).json({ error: 'body.flow must be an object' })
        return
      }
      const flowJsonStr = JSON.stringify(flow)
      if (flowJsonStr.length > 1_048_576) {
        res.status(413).json({ error: 'flow too large (>1MB)' })
        return
      }

      const trainJson = req.body?.trainJson
      const hasTrainJson = Object.prototype.hasOwnProperty.call(req.body ?? {}, 'trainJson')
      if (hasTrainJson) {
        if (typeof trainJson !== 'object' || trainJson === null || Array.isArray(trainJson)) {
          res.status(400).json({ error: 'body.trainJson must be an object (or null/undefined)' })
          return
        }
        if (JSON.stringify(trainJson).length > 524_288) {
          res.status(413).json({ error: 'trainJson too large (>512KB)' })
          return
        }
      }

      const ok = saveFlow(project.folderPath, basename, flow)
      if (!ok) {
        res.status(500).json({ error: 'failed to save flow' })
        return
      }

      if (hasTrainJson) {
        const okT = saveTrainJson(project.folderPath, basename, trainJson as Record<string, unknown>)
        if (!okT) {
          res.status(500).json({ error: 'failed to save trainJson' })
          return
        }
      }

      log.info(
        { projectId: project.id, basename, flowBytes: flowJsonStr.length },
        'track-flow saved',
      )
      res.json({ ok: true })
    },
  )

  // DELETE /api/projects/:projectId/track-flows/file/:filename
  router.delete(
    '/:projectId/track-flows/file/:filename',
    requireProjectOwner('projectId'),
    (req: AuthRequest, res: Response): void => {
      const project = getProject(req.params.projectId)
      if (!project) {
        res.status(404).json({ error: 'Project not found' })
        return
      }
      const basename = sanitizeFlowFilename(req.params.filename)
      if (!basename) {
        res.status(400).json({ error: 'invalid filename' })
        return
      }
      const ok = deleteFlow(project.folderPath, basename)
      res.json({ ok })
    },
  )

  return router
}
```

- [ ] **Step 2：在 backend/src/index.ts 挂载**

读 `backend/src/index.ts` 找到现有 `app.use('/api/projects', buildTracksRouter())` 之类的 mount 段，在后面加：

```typescript
import { buildTrackFlowsRouter } from './routes/track-flows'

// ... existing imports / setup

app.use('/api/projects', buildTrackFlowsRouter())
```

实际可能 `app.use` 写法略不同（取决于现有结构），按现有模式贴。

- [ ] **Step 3：backend tsc + build 通过**

```bash
cd /Users/tom/Projects/cc-web/backend
npx tsc --noEmit
npm run build 2>&1 | tail -3
```

预期：两者都通过。

- [ ] **Step 4：Commit**

```bash
cd /Users/tom/Projects/cc-web
git add backend/src/routes/track-flows.ts backend/src/index.ts
git commit -m "feat(track-flow): backend routes — /track-flows CRUD (list/get/put/delete)"
```

---

## Task 7：frontend api.ts 加 track-flows endpoints

**Files:**
- Modify: `frontend/src/components/tracks/api.ts` — 加 listFlows / getFlow / saveFlow / deleteFlow

- [ ] **Step 1：读现有 api.ts 现状**

```bash
cat /Users/tom/Projects/cc-web/frontend/src/components/tracks/api.ts
```

预期：~50 行，含 listTracks / getTrack / deleteTrack 三个 v1 read-only 接口。

- [ ] **Step 2：在 api.ts 文件末尾追加 v3 endpoints**

```typescript
// ── Track flows v3（spec §12.3） ─────────────────────────────────────────

import type { FlowV3 } from './flow/flow-types-v3'

export interface FlowFileInfo {
  filename: string
  basename: string
  size: number
  mtimeMs: number
}

export function listFlows(projectId: string): Promise<{ files: FlowFileInfo[] }> {
  return req('GET', `/api/projects/${projectId}/track-flows`)
}

export function getFlow(
  projectId: string,
  filename: string,
): Promise<{ filename: string; flow: FlowV3; trainJson: Record<string, unknown> | null }> {
  return req(
    'GET',
    `/api/projects/${projectId}/track-flows/file/${encodeURIComponent(filename)}`,
  )
}

export function saveFlow(
  projectId: string,
  filename: string,
  flow: FlowV3,
  trainJson?: Record<string, unknown>,
): Promise<{ ok: boolean }> {
  return req(
    'PUT',
    `/api/projects/${projectId}/track-flows/file/${encodeURIComponent(filename)}`,
    trainJson !== undefined ? { flow, trainJson } : { flow },
  )
}

export function deleteFlow(
  projectId: string,
  filename: string,
): Promise<{ ok: boolean }> {
  return req(
    'DELETE',
    `/api/projects/${projectId}/track-flows/file/${encodeURIComponent(filename)}`,
  )
}
```

注意：把 `import type { FlowV3 } from './flow/flow-types-v3'` 移到文件顶部 import 段。

- [ ] **Step 3：tsc 通过**

```bash
cd /Users/tom/Projects/cc-web/frontend
npx tsc --noEmit
```

预期：通过。

- [ ] **Step 4：Commit**

```bash
cd /Users/tom/Projects/cc-web
git add frontend/src/components/tracks/api.ts
git commit -m "feat(track-flow): frontend api — listFlows/getFlow/saveFlow/deleteFlow"
```

---

## Task 8：flow-sidecar-io.ts + TDD（前端封装）

**Files:**
- Create: `frontend/src/components/tracks/flow/flow-sidecar-io.ts`
- Create: `frontend/src/components/tracks/flow/__tests__/flow-sidecar-io.test.ts`

封装：加载 .flow + train.json + cross-check 节点 id 与 train.json key（虽然 v3 没有 marker，cross-check 简化为"variables 表的 key 必须出现在 train.json 中"）。

实际上 spec §11.4 sidecar desync 检查需要 .tr marker——v3 用 .flow JSON，没 marker，但 sidecar = train.json，跟 variables 声明对齐。M1 简化 cross-check 为：

- 检查 `flow.variables[*].key` 与 `trainJson` keys 是否一致（多/少都算 desync）
- 失同步时降级仅显示警告（M1 不实现"重建 sidecar"对话框；spec §11.4 三选路径 M2 起做）

- [ ] **Step 1：写失败测试**

```typescript
// frontend/src/components/tracks/flow/__tests__/flow-sidecar-io.test.ts
import { describe, it, expect } from 'vitest'
import { decodeFlow, deriveTrainJsonFromVariables, crossCheckTrainJson } from '../flow-sidecar-io'
import { initialFlow } from '../flow-reducer'

describe('flow-sidecar-io', () => {
  it('decodeFlow 接受 valid v3 object', () => {
    const f = initialFlow('t')
    const r = decodeFlow(f)
    expect(r.ok).toBe(true)
    expect(r.flow?.trackName).toBe('t')
  })

  it('decodeFlow 拒绝 version !== 3', () => {
    const r = decodeFlow({ version: 2, trackName: 't', adapter: 'claude-code', variables: [], nodes: [], edges: [] })
    expect(r.ok).toBe(false)
  })

  it('decodeFlow 拒绝缺字段', () => {
    expect(decodeFlow({}).ok).toBe(false)
    expect(decodeFlow({ version: 3 }).ok).toBe(false)
    expect(decodeFlow(null).ok).toBe(false)
    expect(decodeFlow('not an object').ok).toBe(false)
  })

  it('deriveTrainJsonFromVariables 用 initialValue 初始化', () => {
    const f = initialFlow('t')
    f.variables.push({ key: 'a', description: '', initialValue: 42 })
    f.variables.push({ key: 'b', description: '', initialValue: null })
    f.variables.push({ key: 'c', description: '', initialValue: 'hello' })
    const j = deriveTrainJsonFromVariables(f.variables)
    expect(j).toEqual({ a: 42, b: null, c: 'hello' })
  })

  it('crossCheckTrainJson 全匹配 → ok', () => {
    const f = initialFlow('t')
    f.variables.push({ key: 'a', description: '', initialValue: null })
    f.variables.push({ key: 'b', description: '', initialValue: null })
    const r = crossCheckTrainJson(f, { a: 1, b: 2 })
    expect(r.ok).toBe(true)
  })

  it('crossCheckTrainJson 缺字段 → desync', () => {
    const f = initialFlow('t')
    f.variables.push({ key: 'a', description: '', initialValue: null })
    f.variables.push({ key: 'b', description: '', initialValue: null })
    const r = crossCheckTrainJson(f, { a: 1 })
    expect(r.ok).toBe(false)
    expect(r.missingKeys).toContain('b')
  })

  it('crossCheckTrainJson 多字段 → desync', () => {
    const f = initialFlow('t')
    f.variables.push({ key: 'a', description: '', initialValue: null })
    const r = crossCheckTrainJson(f, { a: 1, ghost: 'x' })
    expect(r.ok).toBe(false)
    expect(r.extraKeys).toContain('ghost')
  })
})
```

- [ ] **Step 2：跑失败**

```bash
npx vitest run src/components/tracks/flow/__tests__/flow-sidecar-io.test.ts
```

- [ ] **Step 3：实现 flow-sidecar-io.ts**

```typescript
// frontend/src/components/tracks/flow/flow-sidecar-io.ts
import type { FlowV3, VarDecl } from './flow-types-v3'

export interface DecodeResult {
  ok: boolean
  flow?: FlowV3
  reason?: string
}

export function decodeFlow(raw: unknown): DecodeResult {
  if (!raw || typeof raw !== 'object') return { ok: false, reason: 'not an object' }
  const o = raw as Record<string, unknown>
  if (o.version !== 3) return { ok: false, reason: `unsupported version: ${o.version}` }
  if (typeof o.trackName !== 'string') return { ok: false, reason: 'trackName missing' }
  if (typeof o.adapter !== 'string') return { ok: false, reason: 'adapter missing' }
  if (!Array.isArray(o.variables) || !Array.isArray(o.nodes) || !Array.isArray(o.edges)) {
    return { ok: false, reason: 'variables/nodes/edges must be arrays' }
  }
  return { ok: true, flow: o as unknown as FlowV3 }
}

export function deriveTrainJsonFromVariables(vars: VarDecl[]): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const v of vars) {
    out[v.key] = v.initialValue ?? null
  }
  return out
}

export interface CrossCheckResult {
  ok: boolean
  missingKeys: string[]                 // declared in variables but absent from train.json
  extraKeys: string[]                   // present in train.json but not declared
}

export function crossCheckTrainJson(
  flow: FlowV3,
  trainJson: Record<string, unknown>,
): CrossCheckResult {
  const varKeys = new Set(flow.variables.map((v) => v.key))
  const jsonKeys = new Set(Object.keys(trainJson))
  const missingKeys = [...varKeys].filter((k) => !jsonKeys.has(k))
  const extraKeys = [...jsonKeys].filter((k) => !varKeys.has(k))
  return { ok: missingKeys.length === 0 && extraKeys.length === 0, missingKeys, extraKeys }
}
```

- [ ] **Step 4：跑测试通过**

```bash
npx vitest run src/components/tracks/flow/__tests__/flow-sidecar-io.test.ts
```

预期：7/7 PASS。

- [ ] **Step 5：Commit**

```bash
cd /Users/tom/Projects/cc-web
git add frontend/src/components/tracks/flow/flow-sidecar-io.ts \
  frontend/src/components/tracks/flow/__tests__/flow-sidecar-io.test.ts
git commit -m "feat(track-flow): v3 sidecar IO — decode + derive train.json + crossCheck"
```

---

## Task 9：GraphContext + 3 节点视图骨架 + DeletableEdge

**Files:**
- Create: `frontend/src/components/tracks/flow/GraphContext.tsx`
- Create: `frontend/src/components/tracks/flow/IdentifierInput.tsx`
- Create: `frontend/src/components/tracks/flow/nodes/NodeHeader.tsx`
- Create: `frontend/src/components/tracks/flow/nodes/UserInputNode.tsx`
- Create: `frontend/src/components/tracks/flow/nodes/LLMNode.tsx`
- Create: `frontend/src/components/tracks/flow/nodes/IfNode.tsx`
- Create: `frontend/src/components/tracks/flow/edges/DeletableEdge.tsx`

- [ ] **Step 1：写 GraphContext.tsx**

```typescript
// frontend/src/components/tracks/flow/GraphContext.tsx
import { createContext, useContext, type ReactNode } from 'react'
import type { Action } from './flow-reducer'

interface GraphCtx {
  dispatch: (a: Action) => void
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
```

- [ ] **Step 2：写 IdentifierInput.tsx**

```typescript
// frontend/src/components/tracks/flow/IdentifierInput.tsx
import { useState } from 'react'

const IDENT_RE = /^[a-zA-Z_][a-zA-Z0-9_]*$/

interface Props {
  value: string
  onChange: (v: string) => void
  placeholder?: string
}

export function IdentifierInput({ value, onChange, placeholder }: Props) {
  const [touched, setTouched] = useState(false)
  const valid = IDENT_RE.test(value) || value === ''
  return (
    <div>
      <input
        type="text"
        value={value}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
        onBlur={() => setTouched(true)}
        className={[
          'w-full px-2 py-1 rounded border text-sm font-mono',
          touched && !valid ? 'border-red-500' : 'border-gray-300',
        ].join(' ')}
      />
      {touched && !valid && (
        <div className="text-xs text-red-600 mt-1">
          仅允许字母/数字/下划线，不能以数字开头
        </div>
      )}
    </div>
  )
}
```

- [ ] **Step 3：写 nodes/NodeHeader.tsx（复用 v2 模式）**

```typescript
// frontend/src/components/tracks/flow/nodes/NodeHeader.tsx
import type { MouseEvent, PointerEvent } from 'react'
import { useGraphDispatch } from '../GraphContext'

interface Props {
  nodeId: string
  icon: string
  label: string
  hoverColor?: string
}

export function NodeHeader({ nodeId, icon, label, hoverColor = 'hover:text-red-600' }: Props) {
  const dispatch = useGraphDispatch()

  const onDelete = (e: MouseEvent) => {
    e.stopPropagation()
    dispatch({ type: 'remove_node', nodeId })
  }

  const stopDrag = (e: PointerEvent) => {
    e.stopPropagation()
  }

  return (
    <div className="flex items-center gap-2 mb-1">
      <span className="text-lg">{icon}</span>
      <span className="font-medium flex-1">{label}</span>
      <button
        type="button"
        className={`nodrag text-gray-400 ${hoverColor} px-1 text-base leading-none`}
        onClick={onDelete}
        onPointerDown={stopDrag}
        title="删除节点"
      >
        ×
      </button>
    </div>
  )
}
```

- [ ] **Step 4：写 nodes/UserInputNode.tsx**

```typescript
// frontend/src/components/tracks/flow/nodes/UserInputNode.tsx
import { Handle, Position } from 'reactflow'
import type { NodeProps } from 'reactflow'
import type { UserInputNode as UserInputNodeData } from '../flow-types-v3'
import { NodeHeader } from './NodeHeader'

export function UserInputNodeView({ id, data, selected }: NodeProps<UserInputNodeData>) {
  return (
    <div
      className={[
        'rounded-lg border-2 px-3 py-2 bg-pink-50 min-w-[240px]',
        selected ? 'border-blue-500 shadow' : 'border-pink-300',
      ].join(' ')}
    >
      <Handle type="target" position={Position.Top} />
      <NodeHeader nodeId={id} icon="💬" label="用户输入" />
      <div className="font-mono text-sm text-gray-700">
        {data.fields.length === 0 ? (
          <div className="text-gray-400">(无字段)</div>
        ) : (
          data.fields.map((f, i) => (
            <div key={i} className="pl-1">{f.varKey} <span className="text-xs text-gray-400">({f.uiHint ?? 'text'})</span></div>
          ))
        )}
      </div>
      <Handle type="source" position={Position.Bottom} />
    </div>
  )
}
```

- [ ] **Step 5：写 nodes/LLMNode.tsx**

```typescript
// frontend/src/components/tracks/flow/nodes/LLMNode.tsx
import { Handle, Position } from 'reactflow'
import type { NodeProps } from 'reactflow'
import type { LLMNode as LLMNodeData } from '../flow-types-v3'
import { NodeHeader } from './NodeHeader'

export function LLMNodeView({ id, data, selected }: NodeProps<LLMNodeData>) {
  return (
    <div
      className={[
        'rounded-lg border-2 px-3 py-2 bg-orange-50 min-w-[280px] max-w-[360px]',
        selected ? 'border-blue-500 shadow' : 'border-orange-300',
      ].join(' ')}
    >
      <Handle type="target" position={Position.Top} />
      <NodeHeader nodeId={id} icon="🤖" label="LLM 调用" />
      <div className="font-mono text-xs text-gray-700">
        <div className="truncate">
          prompt: {data.promptTemplate.slice(0, 60)}{data.promptTemplate.length > 60 ? '…' : ''}
        </div>
        <div className="text-xs text-gray-500 mt-1">
          {data.inputs.length} 输入 → {data.outputs.length} 输出
        </div>
      </div>
      <Handle type="source" position={Position.Bottom} />
    </div>
  )
}
```

- [ ] **Step 6：写 nodes/IfNode.tsx（双 true / false 底部端口）**

```typescript
// frontend/src/components/tracks/flow/nodes/IfNode.tsx
import { Handle, Position } from 'reactflow'
import type { NodeProps } from 'reactflow'
import type { IfNode as IfNodeData } from '../flow-types-v3'
import { NodeHeader } from './NodeHeader'

export function IfNodeView({ id, data, selected }: NodeProps<IfNodeData>) {
  return (
    <div
      className={[
        'rounded-lg border-2 px-3 py-2 bg-sky-50 min-w-[240px]',
        selected ? 'border-blue-500 shadow' : 'border-sky-300',
      ].join(' ')}
    >
      <Handle type="target" position={Position.Top} />
      <NodeHeader nodeId={id} icon="🔀" label="逻辑判断" />
      <div className="font-mono text-sm text-gray-700">
        if ({data.conditionExpr || '<空条件>'})
      </div>
      {/* 双底部端口 true / false，左右排开 */}
      <Handle
        type="source" position={Position.Bottom} id="true"
        style={{ left: '30%', background: '#10b981' }}
      />
      <Handle
        type="source" position={Position.Bottom} id="false"
        style={{ left: '70%', background: '#ef4444' }}
      />
      <div className="flex justify-between text-xs text-gray-400 mt-1 px-2">
        <span className="text-green-600">true</span>
        <span className="text-red-600">false</span>
      </div>
    </div>
  )
}
```

- [ ] **Step 7：写 edges/DeletableEdge.tsx**

```typescript
// frontend/src/components/tracks/flow/edges/DeletableEdge.tsx
import { useState, type MouseEvent } from 'react'
import { BaseEdge, EdgeLabelRenderer, getBezierPath, type EdgeProps } from 'reactflow'
import { useGraphDispatch } from '../GraphContext'

export function DeletableEdge(props: EdgeProps) {
  const { id, sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition, selected, style, markerEnd } = props
  const dispatch = useGraphDispatch()
  const [hovered, setHovered] = useState(false)

  const [edgePath, labelX, labelY] = getBezierPath({
    sourceX, sourceY, sourcePosition, targetX, targetY, targetPosition,
  })

  const onDelete = (e: MouseEvent) => {
    e.stopPropagation()
    dispatch({ type: 'remove_edge', edgeId: id })
  }

  return (
    <>
      <BaseEdge id={id} path={edgePath} markerEnd={markerEnd} style={style} />
      <path
        d={edgePath}
        fill="none"
        stroke="transparent"
        strokeWidth={20}
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
        style={{ cursor: 'pointer' }}
      />
      <EdgeLabelRenderer>
        {(hovered || selected) && (
          <div
            style={{
              position: 'absolute',
              transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)`,
              pointerEvents: 'all',
            }}
            className="nodrag nopan"
            onMouseEnter={() => setHovered(true)}
            onMouseLeave={() => setHovered(false)}
          >
            <button
              type="button"
              onClick={onDelete}
              className="rounded-full bg-white border border-gray-300 text-gray-500 hover:text-red-600 hover:border-red-400 w-5 h-5 leading-none text-sm shadow"
              title="删除连线"
            >
              ×
            </button>
          </div>
        )}
      </EdgeLabelRenderer>
    </>
  )
}
```

- [ ] **Step 8：tsc 通过**

```bash
cd /Users/tom/Projects/cc-web/frontend
npx tsc --noEmit
```

预期：通过（仍是孤立组件，未集成 FlowCanvas，但单独编译 OK）。

- [ ] **Step 9：Commit**

```bash
cd /Users/tom/Projects/cc-web
git add frontend/src/components/tracks/flow/GraphContext.tsx \
  frontend/src/components/tracks/flow/IdentifierInput.tsx \
  frontend/src/components/tracks/flow/nodes/ \
  frontend/src/components/tracks/flow/edges/
git commit -m "feat(track-flow): node views + DeletableEdge + GraphContext + IdentifierInput"
```

---

## Task 10：FlowCanvas + 拓扑编号（#N label）

**Files:**
- Create: `frontend/src/components/tracks/flow/FlowCanvas.tsx`

按 spec §11.1：BFS 入口节点起算 displayIndex，节点左上角小灰字 `#1` `#2` `#3` 显示。

- [ ] **Step 1：实现 FlowCanvas.tsx**

```typescript
// frontend/src/components/tracks/flow/FlowCanvas.tsx
import { useMemo, useCallback, useRef, type DragEvent } from 'react'
import ReactFlow, {
  Background, Controls, MiniMap,
  useReactFlow,
  type Node, type Edge, type Connection,
  type NodeChange, type EdgeChange,
} from 'reactflow'
import 'reactflow/dist/style.css'
import type { FlowV3, NodeV3 } from './flow-types-v3'
import type { Action } from './flow-reducer'
import { UserInputNodeView } from './nodes/UserInputNode'
import { LLMNodeView } from './nodes/LLMNode'
import { IfNodeView } from './nodes/IfNode'
import { DeletableEdge } from './edges/DeletableEdge'
import { makeDefaultNode } from './NodePalette'

interface Props {
  flow: FlowV3
  dispatch: (a: Action) => void
  selectedNodeId: string | null
  onSelect: (id: string | null) => void
}

const NODE_TYPES = {
  user_input: UserInputNodeView,
  llm: LLMNodeView,
  if: IfNodeView,
}

const EDGE_TYPES = {
  deletable: DeletableEdge,
}

const DEFAULT_EDGE_OPTIONS = { type: 'deletable' as const }

/**
 * Compute display index (#1, #2, ...) via BFS from entry node.
 * Returns Map<nodeId, displayIndex>.
 */
function computeDisplayIndices(flow: FlowV3): Map<string, number> {
  const result = new Map<string, number>()
  if (flow.nodes.length === 0) return result

  // entry = no-incoming-edge node
  const incoming = new Map<string, number>()
  for (const n of flow.nodes) incoming.set(n.id, 0)
  for (const e of flow.edges) {
    if (e.target !== null) incoming.set(e.target, (incoming.get(e.target) ?? 0) + 1)
  }
  const entries = flow.nodes.filter((n) => (incoming.get(n.id) ?? 0) === 0)

  // BFS（保序：按 edge 添加顺序的下游优先），多入口时按 nodes 数组顺序
  const visited = new Set<string>()
  const queue = entries.map((n) => n.id)
  let i = 1
  while (queue.length > 0) {
    const id = queue.shift()!
    if (visited.has(id)) continue
    visited.add(id)
    result.set(id, i++)
    const outEdges = flow.edges.filter((e) => e.source === id && e.target !== null)
    for (const e of outEdges) {
      if (e.target && !visited.has(e.target)) queue.push(e.target)
    }
  }
  // 未访问的（孤立子图）按 nodes 顺序追加
  for (const n of flow.nodes) {
    if (!visited.has(n.id)) result.set(n.id, i++)
  }
  return result
}

export function FlowCanvas({ flow, dispatch, selectedNodeId, onSelect }: Props) {
  const canvasRef = useRef<HTMLDivElement>(null)
  const rf = useReactFlow()

  const indices = useMemo(() => computeDisplayIndices(flow), [flow])

  const rfNodes: Node[] = useMemo(
    () =>
      flow.nodes.map((n) => ({
        id: n.id,
        type: n.type,
        position: n.position,
        data: n,
        selected: n.id === selectedNodeId,
      })),
    [flow.nodes, selectedNodeId],
  )

  const rfEdges: Edge[] = useMemo(
    () =>
      flow.edges
        .filter((e) => e.target !== null)
        .map((e) => ({
          id: e.id,
          source: e.source,
          target: e.target as string,
          sourceHandle: e.sourceHandle === 'default' ? null : (e.sourceHandle ?? null),
          type: 'deletable',
        })),
    [flow.edges],
  )

  const onNodesChange = useCallback(
    (changes: NodeChange[]) => {
      for (const c of changes) {
        if (c.type === 'position' && c.position) {
          dispatch({ type: 'move_node', nodeId: c.id, position: c.position })
        } else if (c.type === 'remove') {
          dispatch({ type: 'remove_node', nodeId: c.id })
        } else if (c.type === 'select') {
          if (c.selected) onSelect(c.id)
          else if (selectedNodeId === c.id) onSelect(null)
        }
      }
    },
    [dispatch, onSelect, selectedNodeId],
  )

  const onEdgesChange = useCallback(
    (changes: EdgeChange[]) => {
      for (const c of changes) {
        if (c.type === 'remove') {
          dispatch({ type: 'remove_edge', edgeId: c.id })
        }
      }
    },
    [dispatch],
  )

  const onConnect = useCallback(
    (c: Connection) => {
      if (!c.source || !c.target) return
      const handle = c.sourceHandle === 'true' || c.sourceHandle === 'false'
        ? c.sourceHandle
        : 'default'
      dispatch({ type: 'add_edge', source: c.source, sourceHandle: handle, target: c.target })
    },
    [dispatch],
  )

  const onDragOver = (ev: DragEvent<HTMLDivElement>) => {
    ev.preventDefault()
    ev.dataTransfer.dropEffect = 'move'
  }

  const onDrop = (ev: DragEvent<HTMLDivElement>) => {
    ev.preventDefault()
    const type = ev.dataTransfer.getData('application/x-ccweb-flow-node') as NodeV3['type']
    if (!type) return
    const flowPos = rf.screenToFlowPosition({ x: ev.clientX, y: ev.clientY })
    const node = makeDefaultNode(type, flowPos)
    dispatch({ type: 'add_node', node })
  }

  return (
    <div ref={canvasRef} className="flex-1 h-full relative" onDragOver={onDragOver} onDrop={onDrop}>
      <ReactFlow
        nodes={rfNodes}
        edges={rfEdges}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onConnect={onConnect}
        nodeTypes={NODE_TYPES}
        edgeTypes={EDGE_TYPES}
        defaultEdgeOptions={DEFAULT_EDGE_OPTIONS}
        deleteKeyCode={['Delete', 'Backspace']}
        fitView
      >
        <Background />
        <Controls />
        <MiniMap />
      </ReactFlow>
      {/* 拓扑编号 overlay：定位到每节点左上角 */}
      <div className="absolute inset-0 pointer-events-none">
        {flow.nodes.map((n) => {
          const idx = indices.get(n.id)
          if (idx === undefined) return null
          const pos = rf.flowToScreenPosition?.({ x: n.position.x, y: n.position.y })
          if (!pos) return null
          return (
            <div
              key={`label-${n.id}`}
              className="absolute text-xs text-gray-500 font-mono bg-white/80 px-1 rounded"
              style={{ left: pos.x - 4, top: pos.y - 16 }}
            >
              #{idx}
            </div>
          )
        })}
      </div>
    </div>
  )
}
```

注：`flowToScreenPosition` 是 reactflow 11 提供的（不是 11.0 而是 11.4+ 才稳定）。如果版本不支持，可以用 viewport state 自己算（M1 简化：跳过 overlay，#N 只在 NodeInspector 显示）。

- [ ] **Step 2：tsc 通过**

```bash
cd /Users/tom/Projects/cc-web/frontend
npx tsc --noEmit
```

预期：可能报 `flowToScreenPosition` 不存在或类型错。如果报错 → 简化 `<div className="absolute inset-0 pointer-events-none">` 段：删除 displayIndex overlay，只在 NodeInspector 显示 #N。

- [ ] **Step 3：Commit**

```bash
cd /Users/tom/Projects/cc-web
git add frontend/src/components/tracks/flow/FlowCanvas.tsx
git commit -m "feat(track-flow): FlowCanvas — ReactFlow container with nodes/edges/drop"
```

---

## Task 11：NodePalette + makeDefaultNode

**Files:**
- Create: `frontend/src/components/tracks/flow/NodePalette.tsx`

- [ ] **Step 1：实现 NodePalette.tsx**

```typescript
// frontend/src/components/tracks/flow/NodePalette.tsx
import { useGraphDispatch } from './GraphContext'
import { newNodeId, type NodeV3 } from './flow-types-v3'

type PaletteEntry = {
  type: NodeV3['type']
  icon: string
  label: string
}

const ENTRIES: PaletteEntry[] = [
  { type: 'user_input', icon: '💬', label: '用户输入' },
  { type: 'llm',        icon: '🤖', label: 'LLM 调用' },
  { type: 'if',         icon: '🔀', label: '逻辑判断' },
]

export function makeDefaultNode(
  type: NodeV3['type'],
  position: { x: number; y: number },
): NodeV3 {
  const id = newNodeId()
  switch (type) {
    case 'user_input':
      return { id, type: 'user_input', position, fields: [] }
    case 'llm':
      return {
        id, type: 'llm', position,
        promptTemplate: '',
        inputs: [],
        outputs: [],
      }
    case 'if':
      return { id, type: 'if', position, conditionExpr: '' }
    default:
      throw new Error(`unknown node type: ${type}`)
  }
}

export function NodePalette() {
  const dispatch = useGraphDispatch()
  return (
    <aside className="w-32 border-r bg-white p-2 flex flex-col gap-2">
      <div className="text-xs text-gray-500 px-1">拖入画布</div>
      {ENTRIES.map((e) => (
        <div
          key={e.type}
          draggable
          onDragStart={(ev) => {
            ev.dataTransfer.setData('application/x-ccweb-flow-node', e.type)
            ev.dataTransfer.effectAllowed = 'move'
          }}
          onClick={() => {
            // click-to-add at default position
            const node = makeDefaultNode(e.type, { x: 200, y: 200 })
            dispatch({ type: 'add_node', node })
          }}
          className="cursor-grab rounded border bg-gray-50 hover:bg-blue-50 px-2 py-2 text-sm flex items-center gap-1"
        >
          <span>{e.icon}</span>
          <span>{e.label}</span>
        </div>
      ))}
    </aside>
  )
}
```

- [ ] **Step 2：tsc 通过**

```bash
cd /Users/tom/Projects/cc-web/frontend
npx tsc --noEmit
```

- [ ] **Step 3：Commit**

```bash
cd /Users/tom/Projects/cc-web
git add frontend/src/components/tracks/flow/NodePalette.tsx
git commit -m "feat(track-flow): NodePalette — drag/click to add user_input/llm/if"
```

---

## Task 12：VariablesPanel — 变量声明 CRUD

**Files:**
- Create: `frontend/src/components/tracks/flow/VariablesPanel.tsx`

按用户最新要求：用户填**变量名 / 变量值（可为空）/ 变量描述**。

- [ ] **Step 1：实现 VariablesPanel.tsx**

```typescript
// frontend/src/components/tracks/flow/VariablesPanel.tsx
import type { VarDecl, FlowV3 } from './flow-types-v3'
import { useGraphDispatch } from './GraphContext'
import { IdentifierInput } from './IdentifierInput'

interface Props {
  flow: FlowV3
}

export function VariablesPanel({ flow }: Props) {
  const dispatch = useGraphDispatch()

  const addVariable = () => {
    const key = `var${flow.variables.length + 1}`
    const v: VarDecl = { key, description: '', initialValue: null }
    dispatch({ type: 'add_variable', variable: v })
  }

  return (
    <aside className="w-72 border-r bg-white p-3 overflow-y-auto">
      <div className="flex items-center justify-between mb-2">
        <div className="text-sm font-medium">变量声明</div>
        <button
          type="button"
          onClick={addVariable}
          className="text-xs px-2 py-0.5 rounded border hover:bg-blue-50"
        >
          + 新增
        </button>
      </div>
      {flow.variables.length === 0 && (
        <div className="text-xs text-gray-400">（无变量）</div>
      )}
      <div className="space-y-2">
        {flow.variables.map((v) => (
          <VariableRow key={v.key} variable={v} dispatch={dispatch} />
        ))}
      </div>
    </aside>
  )
}

function VariableRow({
  variable,
  dispatch,
}: {
  variable: VarDecl
  dispatch: ReturnType<typeof useGraphDispatch>
}) {
  const update = (patch: Partial<VarDecl>) => {
    dispatch({ type: 'update_variable', key: variable.key, patch })
  }
  const remove = () => {
    if (window.confirm(`删除变量 "${variable.key}"？`)) {
      dispatch({ type: 'remove_variable', key: variable.key })
    }
  }

  // initialValue UI：M1 简化为单文本框，输入"null"/"true"/"false"/数字字面量按对应解析，否则按 string
  const renderValue = (v: unknown): string => {
    if (v === null || v === undefined) return ''
    if (typeof v === 'string') return v
    return JSON.stringify(v)
  }
  const parseValue = (raw: string): unknown => {
    if (raw === '' || raw === 'null') return null
    if (raw === 'true') return true
    if (raw === 'false') return false
    const num = Number(raw)
    if (!Number.isNaN(num) && /^[0-9.+-]+$/.test(raw)) return num
    return raw
  }

  return (
    <div className="border rounded p-2 bg-gray-50 space-y-1">
      <div className="flex gap-1 items-start">
        <div className="flex-1">
          <IdentifierInput
            value={variable.key}
            onChange={(newKey) => {
              if (newKey === variable.key) return
              // 改 key 通过 remove + add（保持顺序简化 M1）
              dispatch({ type: 'remove_variable', key: variable.key })
              dispatch({ type: 'add_variable', variable: { ...variable, key: newKey } })
            }}
            placeholder="变量名"
          />
        </div>
        <button
          type="button"
          onClick={remove}
          className="text-xs text-red-500 hover:text-red-700 px-1"
          title="删除"
        >
          ×
        </button>
      </div>
      <input
        type="text"
        value={variable.description}
        onChange={(e) => update({ description: e.target.value })}
        placeholder="变量描述（含义）"
        className="w-full px-2 py-1 rounded border text-sm"
      />
      <input
        type="text"
        value={renderValue(variable.initialValue)}
        onChange={(e) => update({ initialValue: parseValue(e.target.value) })}
        placeholder="初始值（可空）"
        className="w-full px-2 py-1 rounded border text-sm font-mono"
      />
    </div>
  )
}
```

- [ ] **Step 2：tsc 通过**

```bash
cd /Users/tom/Projects/cc-web/frontend
npx tsc --noEmit
```

- [ ] **Step 3：Commit**

```bash
cd /Users/tom/Projects/cc-web
git add frontend/src/components/tracks/flow/VariablesPanel.tsx
git commit -m "feat(track-flow): VariablesPanel — declare variables (key/description/initialValue)"
```

---

## Task 13：PromptTemplateEditor 智能补全 textarea

**Files:**
- Create: `frontend/src/components/tracks/flow/PromptTemplateEditor.tsx`

按 spec §6.5：键入 `@` 或 `$` 弹下拉，显示 variables 表所有 key + "+ 新建变量"快捷；Enter/Tab 应用补全 + 光标移到 `}` 后；Esc 关闭；模糊过滤。

M1 简化：caret 位置算法用简化版（mirror div 后续优化，M1 用 textarea selectionStart + 估算 caret y 在 textarea 顶部，下拉始终在 textarea 下方）。M1 不做精确 caret 跟随，下拉固定在 textarea 下方即可（用户体验略不精确但可用）。

- [ ] **Step 1：实现 PromptTemplateEditor.tsx**

```typescript
// frontend/src/components/tracks/flow/PromptTemplateEditor.tsx
import { useState, useRef, useEffect, type ChangeEvent, type KeyboardEvent } from 'react'
import type { VarDecl } from './flow-types-v3'

interface Props {
  value: string
  variables: VarDecl[]
  onChange: (value: string) => void
  onCreateVariable?: (key: string) => void   // 用户点 "+ 新建变量" 时回调；父级弹 popover
  rows?: number
  placeholder?: string
}

type TriggerKind = '@' | '$'

interface DropdownState {
  trigger: TriggerKind
  startPos: number       // 触发字符在 textarea value 中的位置
  filter: string         // @ 后已输入的部分（用于过滤）
  selectedIndex: number  // 候选列表中当前 hover
}

export function PromptTemplateEditor({
  value,
  variables,
  onChange,
  onCreateVariable,
  rows = 5,
  placeholder,
}: Props) {
  const taRef = useRef<HTMLTextAreaElement>(null)
  const [dropdown, setDropdown] = useState<DropdownState | null>(null)

  // 候选列表（含 "+ 新建变量"）
  const candidates = dropdown
    ? variables.filter((v) => v.key.toLowerCase().includes(dropdown.filter.toLowerCase()))
    : []
  const hasCreateOption = !!onCreateVariable
  const totalOptionCount = candidates.length + (hasCreateOption ? 1 : 0)

  const closeDropdown = () => setDropdown(null)

  const applyCompletion = (varKey: string) => {
    if (!dropdown || !taRef.current) return
    const before = value.slice(0, dropdown.startPos)
    const after = value.slice(taRef.current.selectionStart)
    const insertion = `${dropdown.trigger}{${varKey}}`
    const newValue = before + insertion + after
    onChange(newValue)
    // 光标移到 `}` 后
    const newPos = before.length + insertion.length
    setTimeout(() => {
      if (taRef.current) {
        taRef.current.focus()
        taRef.current.setSelectionRange(newPos, newPos)
      }
    }, 0)
    closeDropdown()
  }

  const handleInput = (e: ChangeEvent<HTMLTextAreaElement>) => {
    const newValue = e.target.value
    const caret = e.target.selectionStart
    onChange(newValue)

    // 检测是否刚输入了 @ 或 $（最后一个字符）
    const justTyped = newValue[caret - 1]
    if ((justTyped === '@' || justTyped === '$') && !dropdown) {
      setDropdown({
        trigger: justTyped,
        startPos: caret - 1,
        filter: '',
        selectedIndex: 0,
      })
      return
    }

    // 更新 filter（如果在 dropdown 模式中）
    if (dropdown) {
      const slice = newValue.slice(dropdown.startPos + 1, caret)
      // 如果 slice 含非合法 identifier 字符，关闭下拉
      if (!/^[a-zA-Z0-9_]*$/.test(slice)) {
        closeDropdown()
        return
      }
      setDropdown({ ...dropdown, filter: slice, selectedIndex: 0 })
    }
  }

  const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (!dropdown) return
    if (e.key === 'Escape') {
      e.preventDefault()
      closeDropdown()
    } else if (e.key === 'ArrowDown') {
      e.preventDefault()
      setDropdown({ ...dropdown, selectedIndex: Math.min(dropdown.selectedIndex + 1, totalOptionCount - 1) })
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setDropdown({ ...dropdown, selectedIndex: Math.max(dropdown.selectedIndex - 1, 0) })
    } else if (e.key === 'Enter' || e.key === 'Tab') {
      if (totalOptionCount === 0) return
      e.preventDefault()
      const idx = dropdown.selectedIndex
      if (idx < candidates.length) {
        applyCompletion(candidates[idx]!.key)
      } else if (hasCreateOption && onCreateVariable) {
        // 触发新建变量 popover；父级负责弹界面并最终调 applyCompletion via onCreateVariable
        const newKey = window.prompt('新变量名（key，valid identifier）:', dropdown.filter || '')
        if (newKey && /^[a-zA-Z_][a-zA-Z0-9_]*$/.test(newKey)) {
          onCreateVariable(newKey)
          applyCompletion(newKey)
        }
      }
    }
  }

  // 点击 textarea 外关闭下拉
  useEffect(() => {
    if (!dropdown) return
    const onClick = (e: Event) => {
      if (taRef.current && !taRef.current.contains(e.target as globalThis.Node)) {
        closeDropdown()
      }
    }
    document.addEventListener('mousedown', onClick)
    return () => document.removeEventListener('mousedown', onClick)
  }, [dropdown])

  return (
    <div className="relative">
      <textarea
        ref={taRef}
        value={value}
        onChange={handleInput}
        onKeyDown={handleKeyDown}
        rows={rows}
        placeholder={placeholder}
        className="w-full px-2 py-1 rounded border text-sm font-mono"
      />
      {dropdown && totalOptionCount > 0 && (
        <div className="absolute left-0 right-0 top-full mt-1 max-h-60 overflow-y-auto rounded border bg-white shadow-lg z-50">
          {candidates.map((v, i) => (
            <div
              key={v.key}
              className={[
                'px-2 py-1 cursor-pointer text-sm',
                i === dropdown.selectedIndex ? 'bg-blue-100' : 'hover:bg-gray-50',
              ].join(' ')}
              onMouseDown={(e) => {
                e.preventDefault()
                applyCompletion(v.key)
              }}
              onMouseEnter={() => setDropdown({ ...dropdown, selectedIndex: i })}
            >
              <span className="font-mono">{dropdown.trigger}{v.key}</span>
              {v.description && (
                <span className="text-xs text-gray-400 ml-2">{v.description}</span>
              )}
            </div>
          ))}
          {hasCreateOption && (
            <div
              className={[
                'px-2 py-1 cursor-pointer text-sm border-t text-blue-600',
                dropdown.selectedIndex === candidates.length ? 'bg-blue-100' : 'hover:bg-gray-50',
              ].join(' ')}
              onMouseDown={(e) => {
                e.preventDefault()
                const newKey = window.prompt('新变量名（key，valid identifier）:', dropdown.filter || '')
                if (newKey && /^[a-zA-Z_][a-zA-Z0-9_]*$/.test(newKey) && onCreateVariable) {
                  onCreateVariable(newKey)
                  applyCompletion(newKey)
                }
              }}
              onMouseEnter={() => setDropdown({ ...dropdown, selectedIndex: candidates.length })}
            >
              + 新建变量
            </div>
          )}
        </div>
      )}
    </div>
  )
}
```

- [ ] **Step 2：tsc 通过**

```bash
cd /Users/tom/Projects/cc-web/frontend
npx tsc --noEmit
```

- [ ] **Step 3：Commit**

```bash
cd /Users/tom/Projects/cc-web
git add frontend/src/components/tracks/flow/PromptTemplateEditor.tsx
git commit -m "feat(track-flow): PromptTemplateEditor — @ / \$ autocomplete + new-variable shortcut"
```

---

## Task 14：NodeInspector — 节点字段编辑

**Files:**
- Create: `frontend/src/components/tracks/flow/NodeInspector.tsx`

按节点类型显示不同字段编辑 UI。LLM 节点用 PromptTemplateEditor + 自动推导 inputs/outputs。

- [ ] **Step 1：实现 NodeInspector.tsx**

```typescript
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
        支持：变量名、字面量（null/true/false/数字/字符串）、比较运算（==/!=/&gt;/&lt;/&gt;=/&lt;=）、逻辑（&amp;&amp; ||）。求值在 M2b 实现。
      </div>
    </div>
  )
}
```

- [ ] **Step 2：tsc 通过**

```bash
cd /Users/tom/Projects/cc-web/frontend
npx tsc --noEmit
```

- [ ] **Step 3：Commit**

```bash
cd /Users/tom/Projects/cc-web
git add frontend/src/components/tracks/flow/NodeInspector.tsx
git commit -m "feat(track-flow): NodeInspector — drawer forms for user_input / llm / if"
```

---

## Task 15：FlowToolbar + 保存逻辑

**Files:**
- Create: `frontend/src/components/tracks/flow/FlowToolbar.tsx`

- [ ] **Step 1：实现 FlowToolbar.tsx**

```typescript
// frontend/src/components/tracks/flow/FlowToolbar.tsx
import { useState } from 'react'
import type { FlowV3 } from './flow-types-v3'
import { validateFlow } from './flow-validator'
import { deriveTrainJsonFromVariables } from './flow-sidecar-io'
import { saveFlow as apiSaveFlow } from '../api'

interface Props {
  flow: FlowV3
  projectId: string
  filename: string
  dirty: boolean
  onSaved: () => void
  onClose: () => void
}

export function FlowToolbar({ flow, projectId, filename, dirty, onSaved, onClose }: Props) {
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)

  const handleSave = async () => {
    setSaveError(null)
    const v = validateFlow(flow)
    if (!v.ok) {
      setSaveError(`无法保存：${v.errors.map((e) => e.message).join('; ')}`)
      return
    }
    setSaving(true)
    try {
      const trainJson = deriveTrainJsonFromVariables(flow.variables)
      await apiSaveFlow(projectId, filename, flow, trainJson)
      onSaved()
    } catch (e) {
      setSaveError(`保存失败：${(e as Error).message}`)
    } finally {
      setSaving(false)
    }
  }

  return (
    <header className="border-b bg-white px-3 py-2 flex items-center gap-2">
      <button onClick={onClose} className="text-sm text-gray-600 hover:text-black">←</button>
      <div className="font-mono text-sm">{filename}</div>
      {dirty && <span className="text-xs text-orange-500">●</span>}
      <div className="flex-1" />
      <button
        onClick={handleSave}
        disabled={saving}
        className="text-sm px-3 py-1 rounded bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50"
      >
        {saving ? '保存中…' : '保存'}
      </button>
      {saveError && (
        <div className="text-xs text-red-600 ml-2 max-w-md truncate" title={saveError}>{saveError}</div>
      )}
    </header>
  )
}
```

- [ ] **Step 2：tsc 通过**

- [ ] **Step 3：Commit**

```bash
cd /Users/tom/Projects/cc-web
git add frontend/src/components/tracks/flow/FlowToolbar.tsx
git commit -m "feat(track-flow): FlowToolbar — save with validator + derive train.json"
```

---

## Task 16：TrackFlowEditor 顶层组装

**Files:**
- Create: `frontend/src/components/tracks/flow/TrackFlowEditor.tsx`

- [ ] **Step 1：实现 TrackFlowEditor.tsx**

```typescript
// frontend/src/components/tracks/flow/TrackFlowEditor.tsx
import { useEffect, useReducer, useState } from 'react'
import { ReactFlowProvider } from 'reactflow'
import type { FlowV3 } from './flow-types-v3'
import { reducer, initialFlow } from './flow-reducer'
import { GraphProvider } from './GraphContext'
import { FlowCanvas } from './FlowCanvas'
import { FlowToolbar } from './FlowToolbar'
import { NodePalette } from './NodePalette'
import { VariablesPanel } from './VariablesPanel'
import { NodeInspector } from './NodeInspector'
import { decodeFlow, crossCheckTrainJson } from './flow-sidecar-io'
import { getFlow } from '../api'

interface Props {
  projectId: string
  filename: string                      // 'foo.flow'
  isNew: boolean
  onClose: () => void
}

type LoadState =
  | { kind: 'loading' }
  | { kind: 'ready' }
  | { kind: 'error'; message: string }
  | { kind: 'desync'; message: string }

export function TrackFlowEditor({ projectId, filename, isNew, onClose }: Props) {
  const [flow, dispatch] = useReducer(reducer, initialFlow(filename.replace(/\.flow$/, '')))
  const [loadState, setLoadState] = useState<LoadState>(
    isNew ? { kind: 'ready' } : { kind: 'loading' },
  )
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null)
  const [dirty, setDirty] = useState(false)

  useEffect(() => {
    if (isNew) return
    let cancelled = false
    void (async () => {
      try {
        const res = await getFlow(projectId, filename)
        if (cancelled) return
        const decoded = decodeFlow(res.flow)
        if (!decoded.ok || !decoded.flow) {
          setLoadState({ kind: 'error', message: `flow 解析失败：${decoded.reason}` })
          return
        }
        const cc = res.trainJson ? crossCheckTrainJson(decoded.flow, res.trainJson) : { ok: true, missingKeys: [], extraKeys: [] }
        if (!cc.ok) {
          setLoadState({
            kind: 'desync',
            message: `train.json 与 variables 失同步（缺 ${cc.missingKeys.length} / 多 ${cc.extraKeys.length}）`,
          })
          // M1 不阻止，仅警告
        }
        dispatch({ type: 'replace', flow: decoded.flow })
        setLoadState({ kind: 'ready' })
      } catch (e) {
        if (!cancelled) setLoadState({ kind: 'error', message: (e as Error).message })
      }
    })()
    return () => { cancelled = true }
  }, [projectId, filename, isNew])

  useEffect(() => {
    if (loadState.kind === 'ready') setDirty(true)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [flow])

  const handleClose = () => {
    if (dirty) {
      const ok = window.confirm('未保存的修改将丢失。确认关闭吗？')
      if (!ok) return
    }
    onClose()
  }

  if (loadState.kind === 'loading') {
    return <div className="flex items-center justify-center h-full text-gray-400">加载中…</div>
  }
  if (loadState.kind === 'error') {
    return (
      <div className="flex flex-col items-center justify-center h-full text-red-600 gap-2 max-w-md mx-auto p-6">
        <div className="font-medium">加载失败</div>
        <div className="text-sm">{loadState.message}</div>
        <button onClick={onClose} className="text-sm px-3 py-1 rounded border mt-2">关闭</button>
      </div>
    )
  }

  return (
    <ReactFlowProvider>
      <GraphProvider value={{ dispatch }}>
        <div className="flex flex-col h-full">
          <FlowToolbar
            flow={flow}
            projectId={projectId}
            filename={filename}
            dirty={dirty}
            onSaved={() => setDirty(false)}
            onClose={handleClose}
          />
          {loadState.kind === 'desync' && (
            <div className="bg-amber-50 border-b border-amber-200 px-3 py-1 text-xs text-amber-800">
              ⚠ {loadState.message}（保存时将以当前 variables 重新派生 train.json）
            </div>
          )}
          <div className="flex-1 flex overflow-hidden">
            <NodePalette />
            <VariablesPanel flow={flow} />
            <FlowCanvas
              flow={flow}
              dispatch={dispatch}
              selectedNodeId={selectedNodeId}
              onSelect={setSelectedNodeId}
            />
            <NodeInspector flow={flow} selectedNodeId={selectedNodeId} />
          </div>
        </div>
      </GraphProvider>
    </ReactFlowProvider>
  )
}
```

- [ ] **Step 2：tsc 通过**

```bash
cd /Users/tom/Projects/cc-web/frontend
npx tsc --noEmit
```

- [ ] **Step 3：Commit**

```bash
cd /Users/tom/Projects/cc-web
git add frontend/src/components/tracks/flow/TrackFlowEditor.tsx
git commit -m "feat(track-flow): TrackFlowEditor — load/dirty/save with palette+vars+canvas+inspector"
```

---

## Task 17：TrackFlowsListDialog 替换占位

**Files:**
- Create: `frontend/src/components/tracks/flow/TrackFlowsListDialog.tsx`
- Modify: `frontend/src/components/tracks/TracksListDialog.tsx` — delegate 到 TrackFlowsListDialog

- [ ] **Step 1：实现 TrackFlowsListDialog.tsx**

```typescript
// frontend/src/components/tracks/flow/TrackFlowsListDialog.tsx
import { useState, useEffect } from 'react'
import * as Dialog from '@radix-ui/react-dialog'
import { listFlows, deleteFlow, saveFlow as apiSaveFlow, type FlowFileInfo } from '../api'
import { emptyFlow } from './flow-types-v3'
import { deriveTrainJsonFromVariables } from './flow-sidecar-io'
import { TrackFlowEditor } from './TrackFlowEditor'

interface Props {
  projectId: string
  open: boolean
  onOpenChange: (open: boolean) => void
}

type ActiveEditor = { filename: string; isNew: boolean } | null

export function TrackFlowsListDialog({ projectId, open, onOpenChange }: Props) {
  const [files, setFiles] = useState<FlowFileInfo[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [active, setActive] = useState<ActiveEditor>(null)
  const [creating, setCreating] = useState(false)

  const reload = async () => {
    if (!open) return
    setLoading(true)
    setError(null)
    try {
      const res = await listFlows(projectId)
      setFiles(res.files)
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void reload()
  }, [open, projectId])

  const handleCreate = async () => {
    const name = window.prompt('工作轨名（filename，不含 .flow 后缀）:')
    if (!name) return
    const trimmed = name.trim()
    if (!/^[a-zA-Z0-9_一-龥぀-ヿ-]+$/.test(trimmed)) {
      alert('名字只允许字母/数字/下划线/中文/连字符')
      return
    }
    setCreating(true)
    try {
      const flow = emptyFlow(trimmed)
      const trainJson = deriveTrainJsonFromVariables(flow.variables)
      await apiSaveFlow(projectId, `${trimmed}.flow`, flow, trainJson)
      await reload()
      setActive({ filename: `${trimmed}.flow`, isNew: false })
    } catch (e) {
      alert((e as Error).message)
    } finally {
      setCreating(false)
    }
  }

  const handleDelete = async (filename: string) => {
    if (!window.confirm(`删除 ${filename}？`)) return
    try {
      await deleteFlow(projectId, filename)
      await reload()
    } catch (e) {
      alert((e as Error).message)
    }
  }

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 bg-black/40 z-50" />
        <Dialog.Content className="fixed left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 w-[90vw] h-[85vh] bg-white rounded-lg z-50 flex flex-col">
          {active ? (
            <TrackFlowEditor
              projectId={projectId}
              filename={active.filename}
              isNew={active.isNew}
              onClose={() => {
                setActive(null)
                void reload()
              }}
            />
          ) : (
            <>
              <div className="border-b p-3 flex items-center gap-2">
                <Dialog.Title className="font-medium">工作轨（v3）</Dialog.Title>
                <div className="flex-1" />
                <button
                  type="button"
                  onClick={handleCreate}
                  disabled={creating}
                  className="text-sm px-3 py-1 rounded bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50"
                >
                  {creating ? '创建中…' : '+ 新建工作轨'}
                </button>
                <Dialog.Close className="text-sm text-gray-500 hover:text-gray-800 px-2">关闭</Dialog.Close>
              </div>
              <div className="flex-1 overflow-y-auto p-4">
                {loading && <div className="text-sm text-gray-400">加载中…</div>}
                {error && <div className="text-sm text-red-600">错误：{error}</div>}
                {!loading && !error && files.length === 0 && (
                  <div className="text-sm text-gray-400 text-center py-12">
                    暂无工作轨。点击右上角"新建工作轨"开始。
                  </div>
                )}
                {files.map((f) => (
                  <div
                    key={f.filename}
                    className="flex items-center gap-2 px-2 py-2 rounded hover:bg-gray-50 cursor-pointer"
                    onClick={() => setActive({ filename: f.filename, isNew: false })}
                  >
                    <span className="text-base">🕸️</span>
                    <div className="flex-1">
                      <div className="text-sm font-mono">{f.filename}</div>
                      <div className="text-xs text-gray-400">
                        {(f.size / 1024).toFixed(1)} KB · {new Date(f.mtimeMs).toLocaleString()}
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={(e) => { e.stopPropagation(); void handleDelete(f.filename) }}
                      className="text-xs text-red-500 hover:text-red-700 px-2"
                    >
                      删除
                    </button>
                  </div>
                ))}
              </div>
            </>
          )}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
```

- [ ] **Step 2：替换 TracksListDialog 占位**

```typescript
// frontend/src/components/tracks/TracksListDialog.tsx (完整覆盖)
import { TrackFlowsListDialog } from './flow/TrackFlowsListDialog'

interface Props {
  projectId: string
  open: boolean
  onOpenChange: (open: boolean) => void
}

export function TracksListDialog(props: Props) {
  return <TrackFlowsListDialog {...props} />
}
```

- [ ] **Step 3：tsc 通过 + frontend build 通过**

```bash
cd /Users/tom/Projects/cc-web/frontend
npx tsc --noEmit
npm run build 2>&1 | tail -5
```

预期：tsc 通过，build 成功，dist/ 含 v3 chunk。

- [ ] **Step 4：Commit**

```bash
cd /Users/tom/Projects/cc-web
git add frontend/src/components/tracks/flow/TrackFlowsListDialog.tsx \
  frontend/src/components/tracks/TracksListDialog.tsx
git commit -m "feat(track-flow): TrackFlowsListDialog — list/create/open/delete .flow files"
```

---

## Task 18：浏览器手测准备 + bump v-19-a M1 实施完毕

M1 完成不发版（按 spec §16 M1 是编辑器骨架，**运行能力在 M2a**）。这步只做：跑测试 + tsc + build + commit + push（不 publish）。

**Files:**
- Modify: `package.json` / `README.md` / `CLAUDE.md` — bump 版本

- [ ] **Step 1：跑全部测试 + build**

```bash
cd /Users/tom/Projects/cc-web/frontend
npx vitest run 2>&1 | tail -10
npx tsc --noEmit
npm run build 2>&1 | tail -5

cd /Users/tom/Projects/cc-web/backend
npx tsc --noEmit
npm run build 2>&1 | tail -3
```

预期：
- vitest 4 文件全绿（prompt-placeholder-extractor / flow-reducer / flow-validator / flow-sidecar-io，~30 tests pass）
- 两边 tsc 通过
- 两边 build 通过
- frontend chunks 含 `TrackFlowEditor` lazy chunk（如果 lazy load）或主 bundle 含 v3 code

- [ ] **Step 2：bump 版本号**

确认当前日期：

```bash
date "+%Y.%-m.%-d"
```

如果今天仍是 2026-05-18 → 新版 `2026.5.18-d`。如果是 2026-05-19+ → `2026.5.19-a`。

修改 3 个文件：
- `package.json` `"version"` 字段
- `README.md` 顶部 `**Current version**: v<NEW>` 行
- `CLAUDE.md` 顶部 `**当前版本**: v<NEW>` 行

- [ ] **Step 3：Commit + push**

```bash
cd /Users/tom/Projects/cc-web
git add package.json README.md CLAUDE.md \
  docs/superpowers/plans/2026-05-18-track-v3-M1-editor.md
git commit -m "release: v<NEW> — track-flow v3 M1 编辑器骨架（暂未发布运行能力）

v3 工作轨编辑器骨架完成，但**runtime 在 M2a 实现**，本版本无法运行工作轨：

- 3 节点视图（user_input / llm / if）+ 拓扑编号
- VariablesPanel 变量声明（key/description/initialValue）
- PromptTemplateEditor 智能补全（@/\$ 触发下拉 + + 新建变量）
- prompt-placeholder-extractor 自动推 inputs/outputs
- flow-validator 保存前校验（唯一入口 / 变量重名 / 引用未声明）
- flow-sidecar-io：.flow + train.json 双文件原子写
- backend /api/projects/:projectId/track-flows CRUD 端点
- TrackFlowsListDialog 替换占位

测试：vitest 30+ tests pass / backend tsc clean / frontend tsc clean / 两边 build OK
M1 实施 plan：docs/superpowers/plans/2026-05-18-track-v3-M1-editor.md
v3 设计 spec：docs/superpowers/specs/2026-05-18-track-v3-flow-design.md

下一步：M2a runtime（prompt-translator + state machine + train-adapter 集成 + WS 事件）"
git push origin main
```

- [ ] **Step 4：**等用户授权 npm publish。

subagent **不自行 publish**。报告新版本号 + commit sha + push 状态后停止，controller 提示用户授权。

## Self-Review

**Spec coverage**（spec §16 M1 范围 + §5-§14 编辑期相关）：
- §5 数据模型 ✓ Task 1 flow-types-v3
- §6.1 用户输入节点 ✓ Task 9/14
- §6.2 LLM 节点（inputs/outputs 从 promptTemplate 自动推导）✓ Task 2 + Task 14
- §6.3 If 节点（M1 仅存储 conditionExpr，不求值）✓ Task 9/14
- §6.4 隐式 end ✓ Task 3 reducer 支持 target=null + Task 10 FlowCanvas 过滤
- §6.5 PromptTemplateEditor ✓ Task 13
- §7 转译规则不实现（M2b 范围）✓ §4 spec 明示
- §8 train.json sidecar IO ✓ Task 5 + Task 8
- §9 runtime 不实现（M2a 范围）✓
- §10 WS 事件不实现 ✓
- §11.1 拓扑编号 ✓ Task 10 computeDisplayIndices
- §11.2 跳转 = 边 ✓ Task 3 reducer 支持 sourceHandle
- §11.3 隐式 end ✓ Task 3/10
- §12 编辑器架构 ✓ Tasks 9-17
- §13 v1/v2 废弃 ✓（M0 已做）
- §14.1 编辑期 lint：parse error / 引用未声明 ✓ Task 4 validator + Task 14 NodeInspector
- §14.2 结构校验 ✓ Task 4 validator
- §15 测试策略：4 个单测 + ts-node E2E（E2E 留 M2a 含 runtime 时做）

**Placeholder scan**：
- Task 10 FlowCanvas Step 2 有"如果 flowToScreenPosition 不存在 → 简化"——这是版本兼容兜底，不是占位
- 无 TBD / TODO / implement later

**Type consistency**：
- `NodeV3` / `EdgeV3` / `FlowV3` / `VarDecl` 全程一致
- `Action` 在 reducer-v3 定义，GraphContext 复用
- `extractInputs` / `extractOutputs` 签名贯穿 prompt-placeholder-extractor → flow-validator → NodeInspector LLMForm
- backend store `saveFlow / loadFlow` 与 frontend api `saveFlow / getFlow` 命名对齐（前端 `saveFlow` 含 trainJson 第 4 参数）

**已知 M1 简化**：
- PromptTemplateEditor 用 `window.prompt` 弹"新变量名"输入（spec §6.5 设计 popover；M1 简化为 window.prompt，UX 略糙）
- VariableRow 改 key 用 remove+add 模拟，可能丢失变量在数组中的位置（M1 接受）
- FlowCanvas 拓扑编号 overlay 依赖 `flowToScreenPosition`（reactflow 11.4+），版本不支持时降级为不显示编号
- TrackFlowEditor desync 提示仅 banner（spec §11.4 三选恢复路径 M2 起做）
- 节点状态边框（running/completed/failed）不实现（M3）

**已知风险 / 后续注意**：
- Backend `routes/track-flows.ts` 大小 cap 设为 1MB（flow）+ 512KB（trainJson）——M1 范围足够，M2 可能要根据真实使用调
- `getFlow` 不做 stale 检测（M1 未实现 sidecar cross-check 失败时的降级 UI）
