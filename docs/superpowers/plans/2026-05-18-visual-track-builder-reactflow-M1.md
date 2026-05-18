# Visual Track Builder v2 ReactFlow — M1 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 实现节点图编辑器 v2 的 M1 骨架（4 基础节点 / 顶层单链 codegen / Monaco 嵌入 / sidecar 持久化 / TracksListDialog 改两选 / v1 readonly banner），可拖节点、连边、保存、重新打开。不含 if/for frame（M2）、运行时高亮（M3）、变量面板（M4）。

**Architecture:** 前端走 ReactFlow ~70KB + dagre ~12KB + Monaco 复用。新增 `frontend/src/components/tracks/graph/` 子模块，与 v1 `visual/` 完全独立。`.tr` 保存纯净 train-lang 代码（带 marker comment），坐标 / edges 元数据存到 `.ccweb/tracks/<basename>.tr.graph.json` sidecar。后端只新增 sidecar 字段扩展现有 PUT/GET 路由。M1 顶层强制单进单出（无任意 DAG 分叉）。

**Tech Stack:** TypeScript / React 18 / ReactFlow 11.x / @monaco-editor/react / Tailwind / Radix / Vitest（前端单测）/ ts-node + train-core mock adapter（E2E smoke）

---

## File Structure

**新建 frontend：**
- `frontend/src/components/tracks/graph/graph-types-v2.ts` — TS 类型（GraphV2 / NodeV2 / EdgeV2）
- `frontend/src/components/tracks/graph/marker-v2.ts` — `// @@ccweb-track-mode: graph v2` marker 常量 + nid comment 生成
- `frontend/src/components/tracks/graph/codegen-v2.ts` — 入口 + 每节点 render + fai shape dedupe
- `frontend/src/components/tracks/graph/topo-codegen.ts` — 顶层单链拓扑（M1 无 frame 递归）
- `frontend/src/components/tracks/graph/scope-v2.ts` — 节点可见变量 scope
- `frontend/src/components/tracks/graph/reducer-v2.ts` — useReducer actions
- `frontend/src/components/tracks/graph/sidecar-io.ts` — sidecar JSON encode/decode + cross-check
- `frontend/src/components/tracks/graph/TrackGraphEditor.tsx` — 顶层 Dialog 内容
- `frontend/src/components/tracks/graph/GraphCanvas.tsx` — ReactFlow 容器
- `frontend/src/components/tracks/graph/GraphToolbar.tsx` — 顶部工具栏
- `frontend/src/components/tracks/graph/NodePalette.tsx` — 左侧 dock
- `frontend/src/components/tracks/graph/NodeInspector.tsx` — 右侧抽屉
- `frontend/src/components/tracks/graph/CodePreviewModal.tsx` — 预览 .tr
- `frontend/src/components/tracks/graph/nodes/CodeNode.tsx` — Monaco 嵌入
- `frontend/src/components/tracks/graph/nodes/AskUserNode.tsx` — 字段表单卡片
- `frontend/src/components/tracks/graph/nodes/FaiNode.tsx` — fai 表单卡片
- `frontend/src/components/tracks/graph/nodes/ReturnNode.tsx` — return 表达式卡片
- `frontend/src/components/tracks/graph/__tests__/codegen-v2.test.ts`
- `frontend/src/components/tracks/graph/__tests__/reducer-v2.test.ts`
- `frontend/src/components/tracks/graph/__tests__/scope-v2.test.ts`
- `frontend/src/components/tracks/graph/__tests__/sidecar-io.test.ts`
- `frontend/src/components/tracks/graph/__tests__/verify-graph-v2.ts` — ts-node E2E smoke

**修改 frontend：**
- `frontend/package.json` — 加 reactflow / dagre 依赖
- `frontend/src/components/tracks/TracksListDialog.tsx` — 创建模式改两选 + v1/v2 marker 识别

**修改 backend：**
- `backend/src/routes/tracks.ts` — PUT 加 `sidecar?: object` 可选字段；GET 返 `{ filename, source, sidecar? }`
- `backend/src/tracks/store.ts` — 现有 saveTrack/loadTrack 文件；本 plan 追加 saveSidecar/loadSidecar/deleteSidecar

---

## Task 1：依赖安装 + 核心 TS 类型 + marker 常量

**Files:**
- Modify: `frontend/package.json`
- Create: `frontend/src/components/tracks/graph/graph-types-v2.ts`
- Create: `frontend/src/components/tracks/graph/marker-v2.ts`

- [ ] **Step 1：装依赖（生产 + 开发）**

frontend 当前**没有任何测试 runner**（没装 vitest / jest / ts-node / tsx）。本 plan 用 vitest 跑单测、tsx 跑 verify-graph-v2 ESM-native smoke。所以本 task 一次性装齐：

```bash
cd /Users/tom/Projects/cc-web/frontend
# 生产依赖
npm install --include=dev reactflow@11 dagre@^0.8.5
# 开发依赖（vitest 单测 / tsx ESM runner / @types/dagre）
npm install --include=dev --save-dev vitest@^1 @vitest/ui@^1 tsx@^4 @types/dagre
```

注意：`--include=dev` 是因为本机 `~/.npmrc` 设 `omit=dev`，否则 devDependencies 会被静默跳过（项目级 lesson — frontend 必加）。

加 npm scripts 到 `frontend/package.json`（如果还没）：

```json
{
  "scripts": {
    "dev": "vite",
    "build": "tsc && vite build",
    "preview": "vite preview",
    "test": "vitest",
    "test:run": "vitest run",
    "verify:graph-v2": "tsx src/components/tracks/graph/__tests__/verify-graph-v2.ts"
  }
}
```

预期：`package.json` 出现 `"reactflow"`、`"dagre"` 生产依赖；devDependencies 出现 `"vitest"`、`"@vitest/ui"`、`"tsx"`、`"@types/dagre"`；scripts 多 3 个新条目。

- [ ] **Step 2：创建 `graph-types-v2.ts`（完整代码）**

```typescript
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
```

- [ ] **Step 3：创建 `marker-v2.ts`（完整代码）**

```typescript
// frontend/src/components/tracks/graph/marker-v2.ts

export const MARKER_LINE_V2 = '// @@ccweb-track-mode: graph v2'
export const NOTICE_LINE_V2 = '// 此文件由节点图编辑器生成；手改可能与 sidecar 元数据失同步。'

export const V1_MARKER_LINE = '// @@ccweb-track-mode: node-graph v1'

/** Format an nid comment line (single-line marker for non-CodeNode statements). */
export function nidComment(id: string, indent: string = '  '): string {
  return `${indent}// @@nid: ${id}`
}

/** Format CodeNode start/end markers. */
export function codeNodeStartComment(id: string, indent: string = '  '): string {
  return `${indent}// @@ccweb-node-start: ${id}`
}

export function codeNodeEndComment(id: string, indent: string = '  '): string {
  return `${indent}// @@ccweb-node-end: ${id}`
}

/** Detect track mode from .tr first line. */
export function detectTrackMode(source: string): 'graph-v2' | 'node-graph-v1' | 'code' {
  const firstLine = source.split('\n', 1)[0]?.trim() ?? ''
  if (firstLine === MARKER_LINE_V2) return 'graph-v2'
  if (firstLine === V1_MARKER_LINE) return 'node-graph-v1'
  return 'code'
}

/** Extract all node ids from a .tr source by scanning marker comments. */
export function extractNidsFromSource(source: string): Set<string> {
  const result = new Set<string>()
  const re = /\/\/\s*@@(?:nid|ccweb-node-start|ccweb-node-end):\s*(n_[A-Za-z0-9_]+)/g
  let m: RegExpExecArray | null
  while ((m = re.exec(source)) !== null) {
    if (m[1]) result.add(m[1])
  }
  return result
}
```

- [ ] **Step 4：验证类型编译通过**

```bash
cd /Users/tom/Projects/cc-web/frontend
npx tsc --noEmit
```

预期：通过（types-v2 是新文件，无 import 进入应用 bundle）。

- [ ] **Step 5：Commit**

```bash
cd /Users/tom/Projects/cc-web
git add frontend/package.json frontend/package-lock.json \
  frontend/src/components/tracks/graph/graph-types-v2.ts \
  frontend/src/components/tracks/graph/marker-v2.ts
git commit -m "feat(tracks/graph): v2 base — types + marker + reactflow/dagre deps"
```

---

## Task 2：codegen-v2（顶层单链，无 frame）+ TDD

**Files:**
- Create: `frontend/src/components/tracks/graph/topo-codegen.ts`
- Create: `frontend/src/components/tracks/graph/codegen-v2.ts`
- Create: `frontend/src/components/tracks/graph/__tests__/codegen-v2.test.ts`

- [ ] **Step 1：写失败测试 `codegen-v2.test.ts`**

```typescript
// frontend/src/components/tracks/graph/__tests__/codegen-v2.test.ts
import { describe, it, expect } from 'vitest'
import { codegen } from '../codegen-v2'
import type { GraphV2 } from '../graph-types-v2'

describe('codegen-v2 M1（顶层单链）', () => {
  it('空 graph 报错', () => {
    const g: GraphV2 = { version: 2, trackName: 't', nodes: [], edges: [] }
    const r = codegen(g)
    expect(r.ok).toBe(false)
    expect(r.errors?.[0]?.message).toMatch(/空 graph|无入口/)
  })

  it('单 Return 节点 → 含 marker + func main', () => {
    const g: GraphV2 = {
      version: 2,
      trackName: 't',
      nodes: [{ id: 'n_a', type: 'return', position: { x: 0, y: 0 }, valueExpr: '"hello"' }],
      edges: [],
    }
    const r = codegen(g)
    expect(r.ok).toBe(true)
    expect(r.source).toContain('// @@ccweb-track-mode: graph v2')
    expect(r.source).toContain('func main() -> any')
    expect(r.source).toContain('// @@nid: n_a')
    expect(r.source).toContain('return "hello"')
    expect(r.source).toContain('export main')
  })

  it('CodeNode → start/end marker 包裹', () => {
    const g: GraphV2 = {
      version: 2,
      trackName: 't',
      nodes: [
        { id: 'n_c', type: 'code', position: { x: 0, y: 0 }, code: 'let x = 1\nlet y = 2' },
        { id: 'n_r', type: 'return', position: { x: 0, y: 100 }, valueExpr: 'x + y' },
      ],
      edges: [{ id: 'e1', source: 'n_c', target: 'n_r' }],
    }
    const r = codegen(g)
    expect(r.ok).toBe(true)
    expect(r.source).toContain('// @@ccweb-node-start: n_c')
    expect(r.source).toContain('let x = 1')
    expect(r.source).toContain('let y = 2')
    expect(r.source).toContain('// @@ccweb-node-end: n_c')
    expect(r.source).toContain('// @@nid: n_r')
  })

  it('AskUserNode → __ccweb_ask_user 调用', () => {
    const g: GraphV2 = {
      version: 2,
      trackName: 't',
      nodes: [
        {
          id: 'n_a',
          type: 'ask_user',
          position: { x: 0, y: 0 },
          outputVar: 'input',
          fields: [
            { id: 'f1', key: 'name', label: '姓名', type: 'text' },
          ],
        },
        { id: 'n_r', type: 'return', position: { x: 0, y: 100 }, valueExpr: 'input' },
      ],
      edges: [{ id: 'e1', source: 'n_a', target: 'n_r' }],
    }
    const r = codegen(g)
    expect(r.ok).toBe(true)
    expect(r.source).toContain('let input = __ccweb_ask_user(')
    expect(r.source).toContain('key: "name"')
  })

  it('FaiNode → 声明聚集顶部 + 调用点 + prompt: prompt 形参', () => {
    const g: GraphV2 = {
      version: 2,
      trackName: 't',
      nodes: [
        {
          id: 'n_f',
          type: 'fai',
          position: { x: 0, y: 0 },
          faiName: 'analyze',
          outputVar: 'r',
          inputs: [{ id: 'i1', argName: 'text', argType: 'string', sourceExpr: '"hello"' }],
          outputs: [{ id: 'o1', name: 'rating', type: 'int', constraints: { min: 1, max: 10 } }],
          promptTemplate: '评分',
        },
        { id: 'n_r', type: 'return', position: { x: 0, y: 100 }, valueExpr: 'r' },
      ],
      edges: [{ id: 'e1', source: 'n_f', target: 'n_r' }],
    }
    const r = codegen(g)
    expect(r.ok).toBe(true)
    expect(r.source).toMatch(/fai analyze\([^)]*prompt: prompt[^)]*\) -> rating: int 1-10/)
    expect(r.source).toContain('let r = analyze("hello", "评分")')
  })

  it('同 shape 的 fai 节点 dedupe 为单声明', () => {
    const g: GraphV2 = {
      version: 2,
      trackName: 't',
      nodes: [
        {
          id: 'n_f1', type: 'fai', position: { x: 0, y: 0 },
          faiName: 'analyze', outputVar: 'r1',
          inputs: [{ id: 'i1', argName: 'x', argType: 'string', sourceExpr: '"a"' }],
          outputs: [{ id: 'o1', name: 'v', type: 'int' }],
          promptTemplate: 'p',
        },
        {
          id: 'n_f2', type: 'fai', position: { x: 0, y: 100 },
          faiName: 'analyze', outputVar: 'r2',
          inputs: [{ id: 'i1', argName: 'x', argType: 'string', sourceExpr: '"b"' }],
          outputs: [{ id: 'o1', name: 'v', type: 'int' }],
          promptTemplate: 'p',
        },
        { id: 'n_r', type: 'return', position: { x: 0, y: 200 }, valueExpr: 'r1' },
      ],
      edges: [
        { id: 'e1', source: 'n_f1', target: 'n_f2' },
        { id: 'e2', source: 'n_f2', target: 'n_r' },
      ],
    }
    const r = codegen(g)
    expect(r.ok).toBe(true)
    // 只出现一次 fai analyze 声明
    const declMatches = r.source!.match(/fai analyze\(/g) ?? []
    expect(declMatches.length).toBe(1)
    // 调用点两个
    expect(r.source).toContain('let r1 = analyze')
    expect(r.source).toContain('let r2 = analyze')
  })

  it('多顶层入口 → 报错', () => {
    const g: GraphV2 = {
      version: 2,
      trackName: 't',
      nodes: [
        { id: 'n_a', type: 'code', position: { x: 0, y: 0 }, code: 'let x = 1' },
        { id: 'n_b', type: 'code', position: { x: 200, y: 0 }, code: 'let y = 2' },
        { id: 'n_r', type: 'return', position: { x: 0, y: 100 }, valueExpr: 'x' },
      ],
      edges: [
        { id: 'e1', source: 'n_a', target: 'n_r' },
        { id: 'e2', source: 'n_b', target: 'n_r' },  // n_b 也是入口 + n_r 多 in
      ],
    }
    const r = codegen(g)
    expect(r.ok).toBe(false)
    expect(r.errors?.some(e => /多入口|出入度/.test(e.message))).toBe(true)
  })

  it('孤立节点 → 报错', () => {
    const g: GraphV2 = {
      version: 2,
      trackName: 't',
      nodes: [
        { id: 'n_a', type: 'return', position: { x: 0, y: 0 }, valueExpr: '1' },
        { id: 'n_x', type: 'code', position: { x: 200, y: 0 }, code: 'let y = 2' },
      ],
      edges: [],
    }
    const r = codegen(g)
    expect(r.ok).toBe(false)
    expect(r.errors?.some(e => /孤立|未连接/.test(e.message))).toBe(true)
  })
})
```

- [ ] **Step 2：跑测试看失败**

```bash
cd /Users/tom/Projects/cc-web/frontend
npx vitest run src/components/tracks/graph/__tests__/codegen-v2.test.ts
```

预期：FAIL（codegen-v2 / topo-codegen 还没创建）。

- [ ] **Step 3：创建 `topo-codegen.ts`（完整代码）**

```typescript
// frontend/src/components/tracks/graph/topo-codegen.ts
import type { EdgeV2, NodeV2 } from './graph-types-v2'

export interface TopoResult {
  ordered: NodeV2[]               // 拓扑序节点（顶层单链）
  errors: string[]
}

/**
 * Walk the top-level chain from entry to exit along default-handle edges.
 * M1 doesn't recurse into frames (no frame nodes yet).
 *
 * Returns ordered = entry → ... → terminal, or errors if multi-entry / orphans / cycles.
 */
export function topoOrderTopLevel(nodes: NodeV2[], edges: EdgeV2[]): TopoResult {
  const errors: string[] = []
  const topLevel = nodes.filter((n) => n.parentId === undefined)

  if (topLevel.length === 0) {
    errors.push('空 graph（无顶层节点）')
    return { ordered: [], errors }
  }

  // Build incoming-edge count for top-level nodes only
  const topLevelIds = new Set(topLevel.map((n) => n.id))
  const inDegree = new Map<string, number>()
  for (const n of topLevel) inDegree.set(n.id, 0)
  for (const e of edges) {
    if (topLevelIds.has(e.source) && topLevelIds.has(e.target)) {
      inDegree.set(e.target, (inDegree.get(e.target) ?? 0) + 1)
    }
  }

  // Entry = top-level node with in-degree 0
  const entries = topLevel.filter((n) => (inDegree.get(n.id) ?? 0) === 0)
  if (entries.length === 0) {
    errors.push('无入口节点（图中存在环）')
    return { ordered: [], errors }
  }
  if (entries.length > 1) {
    errors.push(`多入口节点：${entries.map((n) => n.id).join(', ')}`)
    return { ordered: [], errors }
  }

  // Walk default-handle chain from entry
  const ordered: NodeV2[] = []
  const visited = new Set<string>()
  let cur: NodeV2 | null = entries[0]!
  while (cur !== null) {
    if (visited.has(cur.id)) {
      errors.push(`检测到环：${cur.id}`)
      return { ordered: [], errors }
    }
    visited.add(cur.id)
    ordered.push(cur)
    const outEdges = edges.filter(
      (e) =>
        e.source === cur!.id &&
        (e.sourceHandle === 'default' || e.sourceHandle === undefined) &&
        topLevelIds.has(e.target),
    )
    if (outEdges.length === 0) {
      cur = null
    } else if (outEdges.length === 1) {
      cur = topLevel.find((n) => n.id === outEdges[0]!.target) ?? null
    } else {
      errors.push(`节点 ${cur.id} 顶层出度 > 1（M1 不支持 fan-out，请用 IfFrame）`)
      return { ordered: [], errors }
    }
  }

  // Orphan check
  if (visited.size < topLevel.length) {
    const orphans = topLevel.filter((n) => !visited.has(n.id)).map((n) => n.id)
    errors.push(`孤立未连接节点：${orphans.join(', ')}`)
    return { ordered: [], errors }
  }

  return { ordered, errors: [] }
}
```

- [ ] **Step 4：创建 `codegen-v2.ts`（完整代码）**

```typescript
// frontend/src/components/tracks/graph/codegen-v2.ts
import {
  AskUserNode, CodeNode, FaiNode, GraphV2, NodeV2, ReturnNode,
} from './graph-types-v2'
import {
  MARKER_LINE_V2, NOTICE_LINE_V2,
  codeNodeStartComment, codeNodeEndComment, nidComment,
} from './marker-v2'
import { topoOrderTopLevel } from './topo-codegen'

export interface CodegenError {
  nodeId?: string
  message: string
}

export interface CodegenResult {
  ok: boolean
  source?: string
  errors?: CodegenError[]
}

// ── Per-node renderers ────────────────────────────────────────────────

function renderCodeNode(n: CodeNode): string {
  const indented = n.code
    .split('\n')
    .map((line) => (line.length === 0 ? '' : `  ${line}`))
    .join('\n')
  return [
    codeNodeStartComment(n.id),
    indented,
    codeNodeEndComment(n.id),
  ].join('\n')
}

function renderAskUser(n: AskUserNode): string {
  const fieldsLines = n.fields.map((f) => {
    const parts = [`key: "${f.key}"`, `label: "${f.label}"`, `type: "${f.type}"`]
    if (f.type === 'enum' && f.variants) {
      parts.push(`variants: [${f.variants.map((v) => `"${v}"`).join(', ')}]`)
    }
    if (f.required === false) parts.push(`required: false`)
    return `      { ${parts.join(', ')} }`
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

function renderReturn(n: ReturnNode): string {
  return [
    nidComment(n.id),
    `  return ${n.valueExpr}`,
  ].join('\n')
}

// ── fai shape dedupe（沿用 v1 算法 + 自动追加 prompt: prompt 形参）────

interface FaiShape {
  faiName: string
  inputsKey: string
  outputsKey: string
  promptKey: string
}

function shapeOf(n: FaiNode): FaiShape {
  const inputsKey = n.inputs.map((i) => `${i.argName}:${i.argType}`).join('|')
  const outputsKey = n.outputs
    .map((o) => {
      const c = o.constraints ?? {}
      const cBits: string[] = []
      if (c.min !== undefined && c.max !== undefined) cBits.push(`range=${c.min}-${c.max}`)
      if (c.maxLen !== undefined) cBits.push(`maxLen=${c.maxLen}`)
      const ct = cBits.length ? `;${cBits.join(',')}` : ''
      if (o.type === 'array') return `${o.name}:array<${o.innerType ?? 'string'}>${ct}`
      return `${o.name}:${o.type}${ct}`
    })
    .join('|')
  return { faiName: n.faiName, inputsKey, outputsKey, promptKey: n.promptTemplate }
}

function shapeEq(a: FaiShape, b: FaiShape): boolean {
  return a.faiName === b.faiName
    && a.inputsKey === b.inputsKey
    && a.outputsKey === b.outputsKey
    && a.promptKey === b.promptKey
}

interface DedupedFai {
  declName: string
  declSource: string
  shape: FaiShape
}

interface DedupeResult {
  decls: DedupedFai[]
  nodeIdToDeclName: Map<string, string>
}

function dedupeFais(faiNodes: FaiNode[]): DedupeResult {
  const decls: DedupedFai[] = []
  const nodeIdToDeclName = new Map<string, string>()
  for (const n of faiNodes) {
    const sh = shapeOf(n)
    let match = decls.find((d) => shapeEq(d.shape, sh))
    if (!match) {
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
  // train-lang fai must declare `prompt: prompt` as the last formal arg
  // (v-17-b lesson #2 固化). renderFaiCall always appends the prompt string.
  const userInputs = n.inputs.map((i) => `${i.argName}: ${i.argType}`)
  const inputs = [...userInputs, 'prompt: prompt'].join(', ')
  const outputs = n.outputs
    .map((o) => {
      let typeStr: string = o.type
      if (o.type === 'array') typeStr = `array<${o.innerType ?? 'string'}>`
      const c = o.constraints ?? {}
      const cParts: string[] = []
      if (typeof c.min === 'number' && typeof c.max === 'number') cParts.push(`${c.min}-${c.max}`)
      if (typeof c.maxLen === 'number') cParts.push(`maxLen=${c.maxLen}`)
      const cSuffix = cParts.length ? ` ${cParts.join(' ')}` : ''
      return `${o.name}: ${typeStr}${cSuffix}`
    })
    .join(', ')
  return `fai ${declName}(${inputs}) -> ${outputs} { }`
}

function renderFaiCall(n: FaiNode, declName: string): string {
  const argValues = n.inputs.map((i) => i.sourceExpr)
  const promptStr = JSON.stringify(n.promptTemplate)
  const allArgs = [...argValues, promptStr].join(', ')
  return [
    nidComment(n.id),
    `  let ${n.outputVar} = ${declName}(${allArgs})`,
  ].join('\n')
}

// ── Entrypoint ────────────────────────────────────────────────────────

export function codegen(graph: GraphV2): CodegenResult {
  const topo = topoOrderTopLevel(graph.nodes, graph.edges)
  if (topo.errors.length > 0) {
    return { ok: false, errors: topo.errors.map((m) => ({ message: m })) }
  }

  // Collect fai nodes (M1: only top-level, since no frames)
  const faiNodes = topo.ordered.filter((n): n is FaiNode => n.type === 'fai')
  const dedupe = dedupeFais(faiNodes)

  const bodyLines: string[] = []
  for (const n of topo.ordered) {
    if (n.type === 'code') bodyLines.push(renderCodeNode(n))
    else if (n.type === 'ask_user') bodyLines.push(renderAskUser(n))
    else if (n.type === 'return') bodyLines.push(renderReturn(n))
    else if (n.type === 'fai') {
      const declName = dedupe.nodeIdToDeclName.get(n.id)
      if (!declName) {
        return { ok: false, errors: [{ nodeId: n.id, message: 'fai dedupe lost node' }] }
      }
      bodyLines.push(renderFaiCall(n, declName))
    }
  }

  const declSection =
    dedupe.decls.length === 0 ? '' : dedupe.decls.map((d) => d.declSource).join('\n\n') + '\n\n'

  const source = [
    MARKER_LINE_V2,
    NOTICE_LINE_V2,
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
```

- [ ] **Step 5：跑测试看全部通过**

```bash
cd /Users/tom/Projects/cc-web/frontend
npx vitest run src/components/tracks/graph/__tests__/codegen-v2.test.ts
```

预期：8/8 PASS。

- [ ] **Step 6：Commit**

```bash
cd /Users/tom/Projects/cc-web
git add frontend/src/components/tracks/graph/topo-codegen.ts \
  frontend/src/components/tracks/graph/codegen-v2.ts \
  frontend/src/components/tracks/graph/__tests__/codegen-v2.test.ts
git commit -m "feat(tracks/graph): v2 codegen — top-level chain + fai dedupe + nid markers"
```

---

## Task 3：scope-v2（变量可见性）+ TDD

**Files:**
- Create: `frontend/src/components/tracks/graph/scope-v2.ts`
- Create: `frontend/src/components/tracks/graph/__tests__/scope-v2.test.ts`

- [ ] **Step 1：写失败测试**

```typescript
// frontend/src/components/tracks/graph/__tests__/scope-v2.test.ts
import { describe, it, expect } from 'vitest'
import { visibleVarsAt } from '../scope-v2'
import type { GraphV2 } from '../graph-types-v2'

describe('scope-v2 M1', () => {
  it('入口节点：无可见变量', () => {
    const g: GraphV2 = {
      version: 2,
      trackName: 't',
      nodes: [
        { id: 'n_a', type: 'ask_user', position: { x: 0, y: 0 }, outputVar: 'input', fields: [] },
      ],
      edges: [],
    }
    expect(visibleVarsAt(g, 'n_a')).toEqual([])
  })

  it('下游节点：上游 outputVar 可见', () => {
    const g: GraphV2 = {
      version: 2,
      trackName: 't',
      nodes: [
        { id: 'n_a', type: 'ask_user', position: { x: 0, y: 0 }, outputVar: 'input', fields: [] },
        { id: 'n_r', type: 'return', position: { x: 0, y: 100 }, valueExpr: 'input' },
      ],
      edges: [{ id: 'e1', source: 'n_a', target: 'n_r' }],
    }
    expect(visibleVarsAt(g, 'n_r')).toEqual(['input'])
  })

  it('多上游链接（CodeNode + Fai + Return）合并', () => {
    const g: GraphV2 = {
      version: 2,
      trackName: 't',
      nodes: [
        {
          id: 'n_a', type: 'ask_user', position: { x: 0, y: 0 },
          outputVar: 'input', fields: [],
        },
        {
          id: 'n_c', type: 'code', position: { x: 0, y: 100 },
          code: 'let x = 1',
        },
        {
          id: 'n_f', type: 'fai', position: { x: 0, y: 200 },
          faiName: 'analyze', outputVar: 'r',
          inputs: [], outputs: [], promptTemplate: '',
        },
        {
          id: 'n_r', type: 'return', position: { x: 0, y: 300 },
          valueExpr: 'r',
        },
      ],
      edges: [
        { id: 'e1', source: 'n_a', target: 'n_c' },
        { id: 'e2', source: 'n_c', target: 'n_f' },
        { id: 'e3', source: 'n_f', target: 'n_r' },
      ],
    }
    // CodeNode 的 `let x = 1` 在 M1 用启发式扫描第一行 `let X =`
    expect(visibleVarsAt(g, 'n_r')).toEqual(expect.arrayContaining(['input', 'x', 'r']))
  })
})
```

- [ ] **Step 2：跑失败**

```bash
cd /Users/tom/Projects/cc-web/frontend
npx vitest run src/components/tracks/graph/__tests__/scope-v2.test.ts
```

预期：FAIL。

- [ ] **Step 3：实现 `scope-v2.ts`**

```typescript
// frontend/src/components/tracks/graph/scope-v2.ts
import type { GraphV2, NodeV2 } from './graph-types-v2'

/**
 * Names declared by a single node (visible to its downstream).
 * For CodeNode we use a simple `let <name>` regex; M1 doesn't claim
 * full train-lang parse — Phase 2 LSP integration will replace this.
 */
export function namesDeclaredBy(n: NodeV2): string[] {
  if (n.type === 'ask_user') return [n.outputVar]
  if (n.type === 'fai') return [n.outputVar]
  if (n.type === 'code') {
    const re = /\blet\s+([a-zA-Z_][a-zA-Z0-9_]*)/g
    const out: string[] = []
    let m: RegExpExecArray | null
    while ((m = re.exec(n.code)) !== null) {
      if (m[1]) out.push(m[1])
    }
    return out
  }
  return []
}

/**
 * Walk upstream from target node along default-handle edges in the
 * top-level chain. Collect all declared names on the path.
 *
 * M1: top-level chain only. M2 will add frame-aware scope.
 */
export function visibleVarsAt(graph: GraphV2, targetNodeId: string): string[] {
  const byId = new Map(graph.nodes.map((n) => [n.id, n] as const))
  const visited = new Set<string>()
  const collected: string[] = []

  function walkUpstream(nodeId: string): void {
    if (visited.has(nodeId)) return
    visited.add(nodeId)
    const incoming = graph.edges.filter((e) => e.target === nodeId)
    for (const e of incoming) {
      const up = byId.get(e.source)
      if (!up) continue
      walkUpstream(up.id)
      collected.push(...namesDeclaredBy(up))
    }
  }

  walkUpstream(targetNodeId)
  // Dedup preserving order
  const seen = new Set<string>()
  return collected.filter((name) => (seen.has(name) ? false : (seen.add(name), true)))
}
```

- [ ] **Step 4：跑测试通过**

```bash
npx vitest run src/components/tracks/graph/__tests__/scope-v2.test.ts
```

预期：3/3 PASS。

- [ ] **Step 5：Commit**

```bash
cd /Users/tom/Projects/cc-web
git add frontend/src/components/tracks/graph/scope-v2.ts \
  frontend/src/components/tracks/graph/__tests__/scope-v2.test.ts
git commit -m "feat(tracks/graph): v2 scope — upstream var visibility for autocomplete/lint"
```

---

## Task 4：reducer-v2（CRUD nodes/edges）+ TDD

**Files:**
- Create: `frontend/src/components/tracks/graph/reducer-v2.ts`
- Create: `frontend/src/components/tracks/graph/__tests__/reducer-v2.test.ts`

- [ ] **Step 1：写失败测试**

```typescript
// frontend/src/components/tracks/graph/__tests__/reducer-v2.test.ts
import { describe, it, expect } from 'vitest'
import { reducer, initialGraph } from '../reducer-v2'
import type { CodeNode, ReturnNode } from '../graph-types-v2'

describe('reducer-v2', () => {
  it('initialGraph 空', () => {
    const g = initialGraph('test')
    expect(g.version).toBe(2)
    expect(g.trackName).toBe('test')
    expect(g.nodes).toEqual([])
    expect(g.edges).toEqual([])
  })

  it('add_node 追加节点', () => {
    const g0 = initialGraph('t')
    const code: CodeNode = {
      id: 'n_x', type: 'code', position: { x: 0, y: 0 }, code: 'let a = 1',
    }
    const g1 = reducer(g0, { type: 'add_node', node: code })
    expect(g1.nodes).toHaveLength(1)
    expect(g1.nodes[0]!.id).toBe('n_x')
  })

  it('remove_node 同时移除相关 edges', () => {
    const g0 = initialGraph('t')
    const a: CodeNode = { id: 'n_a', type: 'code', position: { x: 0, y: 0 }, code: '' }
    const b: ReturnNode = { id: 'n_b', type: 'return', position: { x: 0, y: 100 }, valueExpr: '' }
    let g = reducer(g0, { type: 'add_node', node: a })
    g = reducer(g, { type: 'add_node', node: b })
    g = reducer(g, { type: 'add_edge', source: 'n_a', target: 'n_b' })
    expect(g.edges).toHaveLength(1)
    g = reducer(g, { type: 'remove_node', nodeId: 'n_a' })
    expect(g.nodes).toHaveLength(1)
    expect(g.edges).toHaveLength(0)
  })

  it('add_edge 不允许重复（同 source+target）', () => {
    const g0 = initialGraph('t')
    const a: CodeNode = { id: 'n_a', type: 'code', position: { x: 0, y: 0 }, code: '' }
    const b: ReturnNode = { id: 'n_b', type: 'return', position: { x: 0, y: 100 }, valueExpr: '' }
    let g = reducer(g0, { type: 'add_node', node: a })
    g = reducer(g, { type: 'add_node', node: b })
    g = reducer(g, { type: 'add_edge', source: 'n_a', target: 'n_b' })
    g = reducer(g, { type: 'add_edge', source: 'n_a', target: 'n_b' })
    expect(g.edges).toHaveLength(1)
  })

  it('update_node 改字段', () => {
    const g0 = initialGraph('t')
    const a: CodeNode = { id: 'n_a', type: 'code', position: { x: 0, y: 0 }, code: 'a' }
    let g = reducer(g0, { type: 'add_node', node: a })
    g = reducer(g, { type: 'update_node', nodeId: 'n_a', patch: { code: 'b' } })
    expect((g.nodes[0] as CodeNode).code).toBe('b')
  })

  it('move_node 更新 position', () => {
    const g0 = initialGraph('t')
    const a: CodeNode = { id: 'n_a', type: 'code', position: { x: 0, y: 0 }, code: '' }
    let g = reducer(g0, { type: 'add_node', node: a })
    g = reducer(g, { type: 'move_node', nodeId: 'n_a', position: { x: 100, y: 50 } })
    expect(g.nodes[0]!.position).toEqual({ x: 100, y: 50 })
  })
})
```

- [ ] **Step 2：跑失败**

```bash
npx vitest run src/components/tracks/graph/__tests__/reducer-v2.test.ts
```

预期：FAIL。

- [ ] **Step 3：实现 `reducer-v2.ts`**

```typescript
// frontend/src/components/tracks/graph/reducer-v2.ts
import { GraphV2, NodeV2, newEdgeId } from './graph-types-v2'

export type Action =
  | { type: 'add_node'; node: NodeV2 }
  | { type: 'remove_node'; nodeId: string }
  | { type: 'update_node'; nodeId: string; patch: Partial<NodeV2> }
  | { type: 'move_node'; nodeId: string; position: { x: number; y: number } }
  | { type: 'add_edge'; source: string; target: string }
  | { type: 'remove_edge'; edgeId: string }
  | { type: 'set_track_name'; name: string }
  | { type: 'replace'; graph: GraphV2 }

export function initialGraph(trackName: string): GraphV2 {
  return { version: 2, trackName, nodes: [], edges: [] }
}

export function reducer(state: GraphV2, action: Action): GraphV2 {
  switch (action.type) {
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
          n.id === action.nodeId ? ({ ...n, ...action.patch } as NodeV2) : n,
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
      const dup = state.edges.some(
        (e) => e.source === action.source && e.target === action.target,
      )
      if (dup) return state
      return {
        ...state,
        edges: [
          ...state.edges,
          { id: newEdgeId(), source: action.source, target: action.target, sourceHandle: 'default' },
        ],
      }
    }
    case 'remove_edge':
      return { ...state, edges: state.edges.filter((e) => e.id !== action.edgeId) }
    case 'set_track_name':
      return { ...state, trackName: action.name }
    case 'replace':
      return action.graph
    default:
      return state
  }
}
```

- [ ] **Step 4：跑测试通过**

```bash
npx vitest run src/components/tracks/graph/__tests__/reducer-v2.test.ts
```

预期：6/6 PASS。

- [ ] **Step 5：Commit**

```bash
cd /Users/tom/Projects/cc-web
git add frontend/src/components/tracks/graph/reducer-v2.ts \
  frontend/src/components/tracks/graph/__tests__/reducer-v2.test.ts
git commit -m "feat(tracks/graph): v2 reducer — node/edge CRUD with edge cascade on delete"
```

---

## Task 5：sidecar-io + backend API 扩展

**Files:**
- Modify: `backend/src/tracks/store.ts`（注意：真实路径是 `tracks/store.ts`，不是 `projects/tracks.ts`）
- Modify: `backend/src/routes/tracks.ts`
- Create: `frontend/src/components/tracks/graph/sidecar-io.ts`
- Create: `frontend/src/components/tracks/graph/__tests__/sidecar-io.test.ts`

- [ ] **Step 1：扩展 backend `tracks/store.ts`（按需读项目代码）**

先读现有签名：

```bash
grep -n "export function saveTrack\|export function loadTrack\|export function listTracks" /Users/tom/Projects/cc-web/backend/src/tracks/store.ts
```

加 `saveSidecar / loadSidecar / deleteSidecar` 三个函数。如果文件顶部已 import 过 `fs` / `path`，复用现有 import，不要重复：

```typescript
// 追加到 backend/src/tracks/store.ts 末尾（fs/path 复用现有 import）
import * as fs from 'fs'
import * as path from 'path'

function sidecarPath(folderPath: string, filename: string): string {
  // 复用现有 .ccweb/tracks/ 目录约定
  const basename = filename.replace(/\.tr$/, '')
  return path.join(folderPath, '.ccweb', 'tracks', `${basename}.tr.graph.json`)
}

export function saveSidecar(folderPath: string, filename: string, sidecar: unknown): boolean {
  const target = sidecarPath(folderPath, filename)
  const dir = path.dirname(target)
  try {
    fs.mkdirSync(dir, { recursive: true })
    fs.writeFileSync(target, JSON.stringify(sidecar, null, 2), 'utf8')
    return true
  } catch {
    return false
  }
}

export function loadSidecar(folderPath: string, filename: string): unknown | null {
  const target = sidecarPath(folderPath, filename)
  try {
    if (!fs.existsSync(target)) return null
    const raw = fs.readFileSync(target, 'utf8')
    return JSON.parse(raw)
  } catch {
    return null
  }
}

export function deleteSidecar(folderPath: string, filename: string): void {
  const target = sidecarPath(folderPath, filename)
  try { fs.unlinkSync(target) } catch { /* ignore */ }
}
```

- [ ] **Step 2：扩展 backend routes（PUT 接受 `sidecar` 可选字段；GET 返 `sidecar`）**

修改 `backend/src/routes/tracks.ts` PUT handler，在 `source` 校验后插入：

```typescript
// 在 PUT handler 内、saveTrack 调用前/后插入
// sidecar 字段语义：
//   - 缺省 / undefined：保持原 sidecar 不动（向后兼容旧客户端，行为同 v-17-b 之前）
//   - null：显式删除 sidecar（用户切到代码模式手动保存时使用）
//   - 对象：保存为新 sidecar
const sidecar = req.body?.sidecar
const hasSidecarField = Object.prototype.hasOwnProperty.call(req.body ?? {}, 'sidecar')
if (hasSidecarField && sidecar !== null) {
  if (typeof sidecar !== 'object' || Array.isArray(sidecar)) {
    res.status(400).json({ error: 'body.sidecar must be an object or null' })
    return
  }
  const sizeCheck = JSON.stringify(sidecar).length
  if (sizeCheck > 524_288) {
    res.status(413).json({ error: 'sidecar too large (>512KB)' })
    return
  }
}

const ok = saveTrack(project.folderPath, safe, source)
if (ok && hasSidecarField) {
  if (sidecar === null) {
    deleteSidecar(project.folderPath, safe)
  } else {
    const okSidecar = saveSidecar(project.folderPath, safe, sidecar)
    if (!okSidecar) {
      res.status(500).json({ error: 'failed to save sidecar' })
      return
    }
  }
}
```

GET handler 同样扩展，在返回时附带 sidecar：

```typescript
// 修改 GET /tracks/file/:filename handler 的 res.json
const source = loadTrack(project.folderPath, safe)
if (source === null) {
  res.status(404).json({ error: 'Track not found' })
  return
}
const sidecar = loadSidecar(project.folderPath, safe)
res.json({ filename: safe, source, sidecar })
```

记得在 routes/tracks.ts 顶部 import（实际路径是 `../tracks/store`，请按文件已有 import 风格扩展）：

```typescript
import {
  saveTrack, loadTrack,
  saveSidecar, loadSidecar, deleteSidecar,
} from '../tracks/store'
```

- [ ] **Step 3：写 frontend sidecar-io 测试**

```typescript
// frontend/src/components/tracks/graph/__tests__/sidecar-io.test.ts
import { describe, it, expect } from 'vitest'
import { encodeSidecar, decodeSidecar, crossCheck } from '../sidecar-io'
import type { GraphV2 } from '../graph-types-v2'

const sampleGraph: GraphV2 = {
  version: 2,
  trackName: 't',
  nodes: [
    { id: 'n_a', type: 'return', position: { x: 0, y: 0 }, valueExpr: '1' },
  ],
  edges: [],
}

describe('sidecar-io', () => {
  it('encodeSidecar 输出 GraphV2 + 元字段', () => {
    const s = encodeSidecar(sampleGraph)
    expect(s.version).toBe(2)
    expect(s.nodes).toHaveLength(1)
    expect(s.savedAt).toBeTypeOf('string')
  })

  it('decodeSidecar 接受 valid sidecar', () => {
    const s = encodeSidecar(sampleGraph)
    const r = decodeSidecar(s)
    expect(r.ok).toBe(true)
    expect(r.graph?.nodes).toHaveLength(1)
  })

  it('decodeSidecar 拒绝 version !== 2', () => {
    const r = decodeSidecar({ version: 1, nodes: [], edges: [] })
    expect(r.ok).toBe(false)
  })

  it('crossCheck 通过：sidecar nid 全在 .tr 中', () => {
    const source = '// @@nid: n_a\nreturn 1'
    const r = crossCheck(sampleGraph, source)
    expect(r.ok).toBe(true)
  })

  it('crossCheck 失败：sidecar nid 找不到', () => {
    const source = '// @@nid: n_xxx_other\nreturn 1'
    const r = crossCheck(sampleGraph, source)
    expect(r.ok).toBe(false)
    expect(r.missingNids).toContain('n_a')
  })
})
```

- [ ] **Step 4：实现 frontend `sidecar-io.ts`**

```typescript
// frontend/src/components/tracks/graph/sidecar-io.ts
import type { GraphV2 } from './graph-types-v2'
import { extractNidsFromSource } from './marker-v2'

export interface SidecarEnvelope {
  version: 2
  trackName: string
  nodes: GraphV2['nodes']
  edges: GraphV2['edges']
  savedAt: string                       // ISO timestamp
  appVersion?: string                   // ccweb 版本
}

export function encodeSidecar(graph: GraphV2, appVersion?: string): SidecarEnvelope {
  return {
    version: 2,
    trackName: graph.trackName,
    nodes: graph.nodes,
    edges: graph.edges,
    savedAt: new Date().toISOString(),
    appVersion,
  }
}

export interface DecodeResult {
  ok: boolean
  graph?: GraphV2
  reason?: string
}

export function decodeSidecar(raw: unknown): DecodeResult {
  if (!raw || typeof raw !== 'object') return { ok: false, reason: 'not an object' }
  const o = raw as Record<string, unknown>
  if (o.version !== 2) return { ok: false, reason: `unsupported version: ${o.version}` }
  if (typeof o.trackName !== 'string') return { ok: false, reason: 'trackName missing' }
  if (!Array.isArray(o.nodes) || !Array.isArray(o.edges)) {
    return { ok: false, reason: 'nodes/edges not arrays' }
  }
  return {
    ok: true,
    graph: {
      version: 2,
      trackName: o.trackName,
      nodes: o.nodes as GraphV2['nodes'],
      edges: o.edges as GraphV2['edges'],
    },
  }
}

export interface CrossCheckResult {
  ok: boolean
  missingNids: string[]                 // sidecar 有但 .tr 没有的 nid
  extraNids: string[]                   // .tr 有但 sidecar 没有的 nid
}

/**
 * Verify sidecar nodes & .tr marker comments stay aligned.
 * On mismatch, the editor surfaces the recovery dialog (spec §11.4).
 */
export function crossCheck(graph: GraphV2, source: string): CrossCheckResult {
  const sourceNids = extractNidsFromSource(source)
  const graphNids = new Set(graph.nodes.map((n) => n.id))
  const missingNids = [...graphNids].filter((id) => !sourceNids.has(id))
  const extraNids = [...sourceNids].filter((id) => !graphNids.has(id))
  return { ok: missingNids.length === 0 && extraNids.length === 0, missingNids, extraNids }
}
```

- [ ] **Step 5：跑 frontend 测试**

```bash
cd /Users/tom/Projects/cc-web/frontend
npx vitest run src/components/tracks/graph/__tests__/sidecar-io.test.ts
```

预期：5/5 PASS。

- [ ] **Step 6：扩展前端 `api.ts` 改 getTrack/saveTrack 签名**

修改 `frontend/src/components/tracks/api.ts` 的 getTrack/saveTrack：

```typescript
export function getTrack(
  projectId: string,
  filename: string,
): Promise<{ filename: string; source: string; sidecar?: unknown }> {
  return req(
    'GET',
    `/api/projects/${projectId}/tracks/file/${encodeURIComponent(filename)}`,
  )
}

export function saveTrack(
  projectId: string,
  filename: string,
  source: string,
  sidecar?: unknown,
): Promise<{ ok: boolean }> {
  return req(
    'PUT',
    `/api/projects/${projectId}/tracks/file/${encodeURIComponent(filename)}`,
    sidecar !== undefined ? { source, sidecar } : { source },
  )
}
```

- [ ] **Step 7：手动验证 backend 改动**

```bash
cd /Users/tom/Projects/cc-web/backend
npx tsc --noEmit
```

预期：通过。

- [ ] **Step 8：Commit**

```bash
cd /Users/tom/Projects/cc-web
git add backend/src/tracks/store.ts \
  backend/src/routes/tracks.ts \
  frontend/src/components/tracks/api.ts \
  frontend/src/components/tracks/graph/sidecar-io.ts \
  frontend/src/components/tracks/graph/__tests__/sidecar-io.test.ts
git commit -m "feat(tracks/graph): v2 sidecar — PUT/GET tracks API + crossCheck"
```

---

## Task 6：GraphCanvas 骨架 + ReactFlow 集成

**Files:**
- Create: `frontend/src/components/tracks/graph/GraphCanvas.tsx`
- Create: `frontend/src/components/tracks/graph/nodes/ReturnNode.tsx`（先实现最简单的 ReturnNode 用来跑通画布）

- [ ] **Step 1：创建 ReturnNode 组件（最简单，用作 ReactFlow smoke 测试）**

```typescript
// frontend/src/components/tracks/graph/nodes/ReturnNode.tsx
import { Handle, Position, NodeProps } from 'reactflow'
import type { ReturnNode as ReturnNodeData } from '../graph-types-v2'

export function ReturnNodeView({ data, selected }: NodeProps<ReturnNodeData>) {
  return (
    <div
      className={[
        'rounded-lg border-2 px-3 py-2 bg-purple-50 min-w-[180px]',
        selected ? 'border-blue-500 shadow' : 'border-purple-300',
      ].join(' ')}
    >
      <Handle type="target" position={Position.Top} />
      <div className="flex items-center gap-2 mb-1">
        <span className="text-lg">⬅️</span>
        <span className="font-medium">返回</span>
      </div>
      <div className="font-mono text-sm text-gray-700 truncate">
        return {data.valueExpr || '<empty>'}
      </div>
    </div>
  )
}
```

注意：ReactFlow 的 `NodeProps<T>` 期望 `data` 字段，所以画布里 reactflow nodes 数组要把 GraphV2 节点适配成 `{ id, position, type, data: node }` 形态。

- [ ] **Step 2：创建 `GraphCanvas.tsx`**

```typescript
// frontend/src/components/tracks/graph/GraphCanvas.tsx
import { useMemo, useCallback } from 'react'
import ReactFlow, {
  Background, Controls, MiniMap,
  type Node, type Edge, type Connection,
  type NodeChange, type EdgeChange,
} from 'reactflow'
import 'reactflow/dist/style.css'
import type { GraphV2 } from './graph-types-v2'
import type { Action } from './reducer-v2'
import { ReturnNodeView } from './nodes/ReturnNode'

interface Props {
  graph: GraphV2
  dispatch: (a: Action) => void
  selectedNodeId: string | null
  onSelect: (id: string | null) => void
}

const NODE_TYPES = {
  return: ReturnNodeView,
  // 后续 Task 7-9 加 code/ask_user/fai
}

export function GraphCanvas({ graph, dispatch, selectedNodeId, onSelect }: Props) {
  const rfNodes: Node[] = useMemo(
    () =>
      graph.nodes.map((n) => ({
        id: n.id,
        type: n.type,
        position: n.position,
        data: n,
        selected: n.id === selectedNodeId,
      })),
    [graph.nodes, selectedNodeId],
  )

  const rfEdges: Edge[] = useMemo(
    () =>
      graph.edges.map((e) => ({
        id: e.id, source: e.source, target: e.target, sourceHandle: e.sourceHandle ?? null,
      })),
    [graph.edges],
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
      if (c.source && c.target) {
        dispatch({ type: 'add_edge', source: c.source, target: c.target })
      }
    },
    [dispatch],
  )

  return (
    <div className="flex-1 h-full">
      <ReactFlow
        nodes={rfNodes}
        edges={rfEdges}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onConnect={onConnect}
        nodeTypes={NODE_TYPES}
        fitView
      >
        <Background />
        <Controls />
        <MiniMap />
      </ReactFlow>
    </div>
  )
}
```

- [ ] **Step 3：vite/tsc 检查无编译错误**

```bash
cd /Users/tom/Projects/cc-web/frontend
npx tsc --noEmit
```

预期：通过。

- [ ] **Step 4：Commit**

```bash
cd /Users/tom/Projects/cc-web
git add frontend/src/components/tracks/graph/GraphCanvas.tsx \
  frontend/src/components/tracks/graph/nodes/ReturnNode.tsx
git commit -m "feat(tracks/graph): v2 ReactFlow canvas skeleton + ReturnNode"
```

---

## Task 7：CodeNode + Monaco 嵌入 + 高度同步

**Files:**
- Create: `frontend/src/components/tracks/graph/nodes/CodeNode.tsx`
- Modify: `frontend/src/components/tracks/graph/GraphCanvas.tsx`（注册 code 节点类型）

- [ ] **Step 1：创建 CodeNode 组件**

```typescript
// frontend/src/components/tracks/graph/nodes/CodeNode.tsx
import { useCallback, useEffect, useRef } from 'react'
import Editor, { type Monaco, type OnMount } from '@monaco-editor/react'
import { Handle, Position, NodeProps, useReactFlow } from 'reactflow'
import type { CodeNode as CodeNodeData } from '../graph-types-v2'

interface ContextActions {
  onChange: (code: string) => void
}

const HEIGHT_MIN = 80
const HEIGHT_MAX = 400

export function makeCodeNodeView(actions: ContextActions) {
  return function CodeNodeView({ id, data, selected }: NodeProps<CodeNodeData & ContextActions>) {
    const flow = useReactFlow()
    const containerRef = useRef<HTMLDivElement>(null)
    const editorRef = useRef<Parameters<OnMount>[0] | null>(null)
    const heightRef = useRef<number>(HEIGHT_MIN)

    const updateInternals = useCallback(() => {
      flow.updateNodeInternals(id)
    }, [flow, id])

    const handleMount: OnMount = useCallback((editor, monaco: Monaco) => {
      editorRef.current = editor
      // Listener fires on every content size change (folding / wrap / font / value)
      editor.onDidContentSizeChange(() => {
        const contentH = editor.getContentHeight()
        const next = Math.min(Math.max(contentH, HEIGHT_MIN), HEIGHT_MAX)
        if (next !== heightRef.current) {
          heightRef.current = next
          editor.layout({ width: editor.getLayoutInfo().width, height: next })
          updateInternals()
        }
      })
      updateInternals()
    }, [updateInternals])

    // ResizeObserver on outer div for container width changes
    useEffect(() => {
      if (!containerRef.current) return
      const ro = new ResizeObserver(() => {
        if (editorRef.current) {
          editorRef.current.layout()
          updateInternals()
        }
      })
      ro.observe(containerRef.current)
      return () => ro.disconnect()
    }, [updateInternals])

    return (
      <div
        ref={containerRef}
        className={[
          'rounded-lg border-2 bg-gray-50 overflow-hidden',
          selected ? 'border-blue-500 shadow' : 'border-gray-300',
        ].join(' ')}
        style={{ width: 400, height: heightRef.current + 32 }}
      >
        <Handle type="target" position={Position.Top} />
        <div className="flex items-center gap-2 px-3 py-1 bg-gray-100 border-b">
          <span className="text-base">📝</span>
          <span className="text-sm font-medium">代码</span>
        </div>
        <Editor
          height={heightRef.current}
          language="train-lang"
          value={data.code}
          onChange={(v) => actions.onChange(v ?? '')}
          onMount={handleMount}
          options={{
            minimap: { enabled: false },
            scrollBeyondLastLine: false,
            fontSize: 12,
            lineNumbers: 'off',
            folding: true,
            scrollbar: { vertical: 'auto', horizontal: 'hidden' },
          }}
        />
        <Handle type="source" position={Position.Bottom} />
      </div>
    )
  }
}
```

注意：因为 ReactFlow nodeTypes 是静态映射，每节点的 onChange 不能传到节点组件。`makeCodeNodeView` 接受 actions 后产生组件实例。但每节点的 data.code 来自 `data` prop。所以 onChange 怎么发到对应 node？

最简洁：用 ReactFlow 的 `setNodes` API + zustand store / context。M1 用 React context：

实际更简单方式：CodeNode 组件直接调 `dispatch` —— 通过 React Context 注入。

调整：
- 新建 `GraphContext` 暴露 `dispatch`
- CodeNodeView 内 `useGraphContext()` 拿 dispatch 调 `update_node`

重写如下：

- [ ] **Step 2：创建 GraphContext + 调整 CodeNode**

```typescript
// frontend/src/components/tracks/graph/GraphContext.tsx
import { createContext, useContext, type ReactNode } from 'react'
import type { Action } from './reducer-v2'

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

- [ ] **Step 3：CodeNode 改用 context**

把 Step 1 的 `makeCodeNodeView` 改为直接的 component：

```typescript
// 替换 nodes/CodeNode.tsx 末尾的导出
export function CodeNodeView({ id, data, selected }: NodeProps<CodeNodeData>) {
  const dispatch = useGraphDispatch()
  // ... 同 Step 1，但 onChange 改为：
  // onChange={(v) => dispatch({ type: 'update_node', nodeId: id, patch: { code: v ?? '' } })}
}
```

完整文件覆盖 Step 1 的内容：

**重要：Monaco self-host loader（项目级 lesson）**

frontend 默认 `@monaco-editor/react` 从 CDN 拉 Monaco assets，被 ccweb CSP（`script-src 'self'`）挡住。现有 `TrackEditor.tsx:22-34` 用 `lazy` + `loader.config({ monaco })` 把本地 `monaco-editor` 包注入 wrapper。本 plan 所有用 Monaco 的组件都必须沿用此模式，否则节点编辑器在生产环境无法加载。

```typescript
// frontend/src/components/tracks/graph/nodes/CodeNode.tsx (final)
import { useCallback, useEffect, useRef, useState, Suspense, lazy } from 'react'
import { Handle, Position, type NodeProps, useReactFlow } from 'reactflow'
import type { editor as MonacoEditor } from 'monaco-editor'
import type { CodeNode as CodeNodeData } from '../graph-types-v2'
import { useGraphDispatch } from '../GraphContext'

// Same self-host loader pattern as TrackEditor.tsx:22-34.
// Monaco core is bundled via local `monaco-editor` package, NOT fetched from CDN.
const Editor = lazy(async () => {
  const [monacoNs, reactWrapper] = await Promise.all([
    import('monaco-editor'),
    import('@monaco-editor/react'),
  ])
  const m = monacoNs as unknown as { default?: typeof monacoNs }
  const monacoLib = m.default ?? monacoNs
  reactWrapper.loader.config({ monaco: monacoLib as never })
  return { default: reactWrapper.default }
})

type OnMountFn = (editor: MonacoEditor.IStandaloneCodeEditor) => void

const HEIGHT_MIN = 80
const HEIGHT_MAX = 400

export function CodeNodeView({ id, data, selected }: NodeProps<CodeNodeData>) {
  const dispatch = useGraphDispatch()
  const flow = useReactFlow()
  const containerRef = useRef<HTMLDivElement>(null)
  const editorRef = useRef<MonacoEditor.IStandaloneCodeEditor | null>(null)
  const [height, setHeight] = useState<number>(HEIGHT_MIN)

  const updateInternals = useCallback(() => flow.updateNodeInternals(id), [flow, id])

  const handleMount: OnMountFn = useCallback((editor) => {
    editorRef.current = editor
    editor.onDidContentSizeChange(() => {
      const contentH = editor.getContentHeight()
      const next = Math.min(Math.max(contentH, HEIGHT_MIN), HEIGHT_MAX)
      setHeight(next)
      updateInternals()
    })
    updateInternals()
  }, [updateInternals])

  useEffect(() => {
    if (!containerRef.current) return
    const ro = new ResizeObserver(() => {
      editorRef.current?.layout()
      updateInternals()
    })
    ro.observe(containerRef.current)
    return () => ro.disconnect()
  }, [updateInternals])

  return (
    <div
      ref={containerRef}
      className={[
        'rounded-lg border-2 bg-gray-50 overflow-hidden',
        selected ? 'border-blue-500 shadow' : 'border-gray-300',
      ].join(' ')}
      style={{ width: 400, height: height + 32 }}
    >
      <Handle type="target" position={Position.Top} />
      <div className="flex items-center gap-2 px-3 py-1 bg-gray-100 border-b">
        <span className="text-base">📝</span>
        <span className="text-sm font-medium">代码</span>
      </div>
      <Suspense fallback={<div className="px-3 py-2 text-xs text-gray-400">加载编辑器…</div>}>
        <Editor
          height={height}
          language="train-lang"
          value={data.code}
          onChange={(v) => dispatch({ type: 'update_node', nodeId: id, patch: { code: v ?? '' } })}
          onMount={handleMount}
          options={{
            minimap: { enabled: false },
            scrollBeyondLastLine: false,
            fontSize: 12,
            lineNumbers: 'off',
            folding: true,
            scrollbar: { vertical: 'auto', horizontal: 'hidden' },
          }}
        />
      </Suspense>
      <Handle type="source" position={Position.Bottom} />
    </div>
  )
}
```

- [ ] **Step 4：注册 code 节点类型**

修改 `GraphCanvas.tsx` 的 `NODE_TYPES`：

```typescript
import { CodeNodeView } from './nodes/CodeNode'

const NODE_TYPES = {
  return: ReturnNodeView,
  code: CodeNodeView,
}
```

- [ ] **Step 5：tsc 检查**

```bash
npx tsc --noEmit
```

预期：通过。

- [ ] **Step 6：Commit**

```bash
cd /Users/tom/Projects/cc-web
git add frontend/src/components/tracks/graph/nodes/CodeNode.tsx \
  frontend/src/components/tracks/graph/GraphContext.tsx \
  frontend/src/components/tracks/graph/GraphCanvas.tsx
git commit -m "feat(tracks/graph): v2 CodeNode — Monaco embed + height sync (3 layers)"
```

---

## Task 8：AskUserNode + FaiNode

**Files:**
- Create: `frontend/src/components/tracks/graph/nodes/AskUserNode.tsx`
- Create: `frontend/src/components/tracks/graph/nodes/FaiNode.tsx`
- Modify: `frontend/src/components/tracks/graph/GraphCanvas.tsx`

- [ ] **Step 1：创建 AskUserNode**

```typescript
// frontend/src/components/tracks/graph/nodes/AskUserNode.tsx
import { Handle, Position, NodeProps } from 'reactflow'
import type { AskUserNode as AskUserNodeData } from '../graph-types-v2'

export function AskUserNodeView({ data, selected }: NodeProps<AskUserNodeData>) {
  return (
    <div
      className={[
        'rounded-lg border-2 px-3 py-2 bg-pink-50 min-w-[240px]',
        selected ? 'border-blue-500 shadow' : 'border-pink-300',
      ].join(' ')}
    >
      <Handle type="target" position={Position.Top} />
      <div className="flex items-center gap-2 mb-1">
        <span className="text-lg">💬</span>
        <span className="font-medium">问用户</span>
      </div>
      <div className="font-mono text-sm text-gray-700">
        <div>{data.outputVar || '<未命名>'} ← {`{`}</div>
        {data.fields.length === 0 ? (
          <div className="text-gray-400 pl-2">(无字段)</div>
        ) : (
          data.fields.map((f) => (
            <div key={f.id} className="pl-2">{f.key}: {f.type}</div>
          ))
        )}
        <div>{`}`}</div>
      </div>
      <Handle type="source" position={Position.Bottom} />
    </div>
  )
}
```

- [ ] **Step 2：创建 FaiNode**

```typescript
// frontend/src/components/tracks/graph/nodes/FaiNode.tsx
import { Handle, Position, NodeProps } from 'reactflow'
import type { FaiNode as FaiNodeData } from '../graph-types-v2'

export function FaiNodeView({ data, selected }: NodeProps<FaiNodeData>) {
  return (
    <div
      className={[
        'rounded-lg border-2 px-3 py-2 bg-orange-50 min-w-[260px]',
        selected ? 'border-blue-500 shadow' : 'border-orange-300',
      ].join(' ')}
    >
      <Handle type="target" position={Position.Top} />
      <div className="flex items-center gap-2 mb-1">
        <span className="text-lg">🤖</span>
        <span className="font-medium">AI 调用</span>
      </div>
      <div className="font-mono text-sm text-gray-700">
        <div>{data.outputVar} ← {data.faiName}(...)</div>
        <div className="text-xs text-gray-500 truncate mt-1">
          prompt: {data.promptTemplate.slice(0, 40)}{data.promptTemplate.length > 40 ? '…' : ''}
        </div>
        <div className="text-xs text-gray-500">
          {data.inputs.length} inputs → {data.outputs.length} outputs
        </div>
      </div>
      <Handle type="source" position={Position.Bottom} />
    </div>
  )
}
```

- [ ] **Step 3：注册到 NODE_TYPES**

```typescript
// GraphCanvas.tsx
import { AskUserNodeView } from './nodes/AskUserNode'
import { FaiNodeView } from './nodes/FaiNode'

const NODE_TYPES = {
  return: ReturnNodeView,
  code: CodeNodeView,
  ask_user: AskUserNodeView,
  fai: FaiNodeView,
}
```

- [ ] **Step 4：tsc 通过**

```bash
npx tsc --noEmit
```

- [ ] **Step 5：Commit**

```bash
cd /Users/tom/Projects/cc-web
git add frontend/src/components/tracks/graph/nodes/AskUserNode.tsx \
  frontend/src/components/tracks/graph/nodes/FaiNode.tsx \
  frontend/src/components/tracks/graph/GraphCanvas.tsx
git commit -m "feat(tracks/graph): v2 AskUserNode + FaiNode (view-only summary cards)"
```

---

## Task 9：NodePalette + 拖出生成

**Files:**
- Create: `frontend/src/components/tracks/graph/NodePalette.tsx`
- Modify: `frontend/src/components/tracks/graph/GraphCanvas.tsx`（接住 drop）

- [ ] **Step 1：创建 NodePalette**

```typescript
// frontend/src/components/tracks/graph/NodePalette.tsx
import { useGraphDispatch } from './GraphContext'
import { newNodeId, NodeV2 } from './graph-types-v2'

type PaletteEntry = {
  type: NodeV2['type']
  icon: string
  label: string
}

const ENTRIES: PaletteEntry[] = [
  { type: 'code',     icon: '📝', label: '代码' },
  { type: 'ask_user', icon: '💬', label: '问用户' },
  { type: 'fai',      icon: '🤖', label: 'AI 调用' },
  { type: 'return',   icon: '⬅️', label: '返回' },
  // M2 will add: if / loop
]

export function makeDefaultNode(type: NodeV2['type'], position: { x: number; y: number }): NodeV2 {
  const id = newNodeId()
  switch (type) {
    case 'code':
      return { id, type: 'code', position, code: 'let x = 1' }
    case 'ask_user':
      return { id, type: 'ask_user', position, outputVar: 'input', fields: [] }
    case 'fai':
      return {
        id, type: 'fai', position,
        faiName: 'analyze', outputVar: 'r',
        inputs: [], outputs: [], promptTemplate: '',
      }
    case 'return':
      return { id, type: 'return', position, valueExpr: '"done"' }
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
            ev.dataTransfer.setData('application/x-ccweb-graph-node', e.type)
            ev.dataTransfer.effectAllowed = 'move'
          }}
          onClick={() => {
            // Click-to-add at default position (canvas center-ish, M1 simple)
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

- [ ] **Step 2：让 GraphCanvas 接住拖 drop**

修改 `GraphCanvas.tsx`：

**修改 GraphCanvas.tsx**：加 import + onDragOver/onDrop。完整变更：

```typescript
// 在文件顶部 import 段补充：
import { useMemo, useCallback, useRef, type DragEvent } from 'react'  // useRef + DragEvent 新增
import ReactFlow, {
  Background, Controls, MiniMap,
  useReactFlow,  // 新增
  type Node, type Edge, type Connection,
  type NodeChange, type EdgeChange,
} from 'reactflow'
import 'reactflow/dist/style.css'
import type { GraphV2, NodeV2 } from './graph-types-v2'  // NodeV2 加回（onDrop cast 用）
import type { Action } from './reducer-v2'
import { ReturnNodeView } from './nodes/ReturnNode'
import { CodeNodeView } from './nodes/CodeNode'           // Task 7 加入
import { AskUserNodeView } from './nodes/AskUserNode'    // Task 8 加入
import { FaiNodeView } from './nodes/FaiNode'             // Task 8 加入
import { makeDefaultNode } from './NodePalette'           // 本 task 新增

export function GraphCanvas({ graph, dispatch, selectedNodeId, onSelect }: Props) {
  const canvasRef = useRef<HTMLDivElement>(null)
  const flow = useReactFlow()  // NOTE: GraphCanvas 必须被包在 ReactFlowProvider 内（Task 12 TrackGraphEditor 处理）

  // ... existing memo / callbacks

  const onDragOver = (ev: DragEvent<HTMLDivElement>) => {
    ev.preventDefault()
    ev.dataTransfer.dropEffect = 'move'
  }

  const onDrop = (ev: DragEvent<HTMLDivElement>) => {
    ev.preventDefault()
    const type = ev.dataTransfer.getData('application/x-ccweb-graph-node') as NodeV2['type']
    if (!type) return
    const bounds = canvasRef.current?.getBoundingClientRect()
    if (!bounds) return
    const flowPos = flow.screenToFlowPosition({ x: ev.clientX, y: ev.clientY })
    const node = makeDefaultNode(type, flowPos)
    dispatch({ type: 'add_node', node })
  }

  return (
    <div ref={canvasRef} className="flex-1 h-full" onDragOver={onDragOver} onDrop={onDrop}>
      <ReactFlow /* ... */ />
    </div>
  )
}
```

注意 useReactFlow 必须在 ReactFlowProvider 内调，所以 TrackGraphEditor 顶层要包 ReactFlowProvider（Task 13 做）。

- [ ] **Step 3：tsc 通过**

- [ ] **Step 4：Commit**

```bash
cd /Users/tom/Projects/cc-web
git add frontend/src/components/tracks/graph/NodePalette.tsx \
  frontend/src/components/tracks/graph/GraphCanvas.tsx
git commit -m "feat(tracks/graph): v2 NodePalette — drag-from-palette to create nodes"
```

---

## Task 10：NodeInspector 抽屉（编辑节点字段）

**Files:**
- Create: `frontend/src/components/tracks/graph/NodeInspector.tsx`
- Create: `frontend/src/components/tracks/graph/IdentifierInput.tsx`（v1 已有同名组件，但属 visual/ 子模块，v2 独立复制一份避免耦合）

- [ ] **Step 1：创建 IdentifierInput（复用 v1 校验正则）**

```typescript
// frontend/src/components/tracks/graph/IdentifierInput.tsx
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

- [ ] **Step 2：创建 NodeInspector**

```typescript
// frontend/src/components/tracks/graph/NodeInspector.tsx
import { useState } from 'react'
import type {
  GraphV2, NodeV2, AskUserNode, AskUserField,
  FaiNode, FaiInput, FaiOutput,
} from './graph-types-v2'
import { useGraphDispatch } from './GraphContext'
import { IdentifierInput } from './IdentifierInput'

interface Props {
  graph: GraphV2
  selectedNodeId: string | null
}

export function NodeInspector({ graph, selectedNodeId }: Props) {
  const dispatch = useGraphDispatch()
  const node = graph.nodes.find((n) => n.id === selectedNodeId) ?? null

  if (!node) {
    return (
      <aside className="w-80 border-l bg-white p-4 text-sm text-gray-400">
        点节点编辑
      </aside>
    )
  }

  const patch = (p: Partial<NodeV2>) =>
    dispatch({ type: 'update_node', nodeId: node.id, patch: p })

  return (
    <aside className="w-80 border-l bg-white p-4 overflow-y-auto">
      <div className="text-xs text-gray-500 mb-2">节点 ID: {node.id}</div>
      {node.type === 'code' && (
        <div className="text-sm text-gray-600">
          代码节点的内容在画布上直接编辑（Monaco）。
        </div>
      )}
      {node.type === 'ask_user' && (
        <div className="space-y-3">
          <div>
            <label className="text-xs text-gray-500 block mb-1">outputVar</label>
            <IdentifierInput
              value={node.outputVar}
              onChange={(v) => patch({ outputVar: v })}
            />
          </div>
          <div>
            <label className="text-xs text-gray-500 block mb-1">字段</label>
            <AskUserFieldsEditor node={node} dispatch={dispatch} />
          </div>
        </div>
      )}
      {node.type === 'fai' && (
        <FaiInspectorForm node={node} dispatch={dispatch} />
      )}
      {node.type === 'return' && (
        <div>
          <label className="text-xs text-gray-500 block mb-1">返回表达式</label>
          <textarea
            value={node.valueExpr}
            onChange={(e) => patch({ valueExpr: e.target.value })}
            rows={4}
            className="w-full px-2 py-1 rounded border text-sm font-mono"
          />
        </div>
      )}
    </aside>
  )
}

// ── AskUser fields editor ───────────────────────────────────────────

function AskUserFieldsEditor({
  node,
  dispatch,
}: {
  node: AskUserNode
  dispatch: ReturnType<typeof useGraphDispatch>
}) {
  const addField = () => {
    const f: AskUserField = {
      id: `f_${Math.random().toString(36).slice(2, 8)}`,
      key: `field${node.fields.length + 1}`,
      label: '',
      type: 'text',
    }
    dispatch({ type: 'update_node', nodeId: node.id, patch: { fields: [...node.fields, f] } })
  }
  const updateField = (id: string, patch: Partial<AskUserField>) =>
    dispatch({
      type: 'update_node', nodeId: node.id,
      patch: { fields: node.fields.map((f) => (f.id === id ? { ...f, ...patch } : f)) },
    })
  const removeField = (id: string) =>
    dispatch({
      type: 'update_node', nodeId: node.id,
      patch: { fields: node.fields.filter((f) => f.id !== id) },
    })

  return (
    <div className="space-y-2">
      {node.fields.map((f) => (
        <div key={f.id} className="border rounded p-2 space-y-1 bg-gray-50">
          <div className="flex gap-1">
            <IdentifierInput value={f.key} onChange={(v) => updateField(f.id, { key: v })} placeholder="key" />
            <button onClick={() => removeField(f.id)} className="text-xs text-red-500 px-2">×</button>
          </div>
          <input
            type="text"
            value={f.label}
            placeholder="label"
            onChange={(e) => updateField(f.id, { label: e.target.value })}
            className="w-full px-2 py-1 rounded border text-sm"
          />
          <select
            value={f.type}
            onChange={(e) => updateField(f.id, { type: e.target.value as AskUserField['type'] })}
            className="w-full px-2 py-1 rounded border text-sm"
          >
            <option value="text">text</option>
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

// ── Fai inspector form ──────────────────────────────────────────────

function FaiInspectorForm({
  node,
  dispatch,
}: {
  node: FaiNode
  dispatch: ReturnType<typeof useGraphDispatch>
}) {
  const patch = (p: Partial<FaiNode>) =>
    dispatch({ type: 'update_node', nodeId: node.id, patch: p })

  const addInput = () => {
    const i: FaiInput = {
      id: `i_${Math.random().toString(36).slice(2, 8)}`,
      argName: `arg${node.inputs.length + 1}`,
      argType: 'string',
      sourceExpr: '""',
    }
    patch({ inputs: [...node.inputs, i] })
  }
  const updateInput = (id: string, p: Partial<FaiInput>) =>
    patch({ inputs: node.inputs.map((i) => (i.id === id ? { ...i, ...p } : i)) })
  const removeInput = (id: string) =>
    patch({ inputs: node.inputs.filter((i) => i.id !== id) })

  const addOutput = () => {
    const o: FaiOutput = {
      id: `o_${Math.random().toString(36).slice(2, 8)}`,
      name: `out${node.outputs.length + 1}`,
      type: 'string',
    }
    patch({ outputs: [...node.outputs, o] })
  }
  const updateOutput = (id: string, p: Partial<FaiOutput>) =>
    patch({ outputs: node.outputs.map((o) => (o.id === id ? { ...o, ...p } : o)) })
  const removeOutput = (id: string) =>
    patch({ outputs: node.outputs.filter((o) => o.id !== id) })

  return (
    <div className="space-y-3">
      <div>
        <label className="text-xs text-gray-500 block mb-1">fai 名</label>
        <IdentifierInput value={node.faiName} onChange={(v) => patch({ faiName: v })} />
      </div>
      <div>
        <label className="text-xs text-gray-500 block mb-1">outputVar</label>
        <IdentifierInput value={node.outputVar} onChange={(v) => patch({ outputVar: v })} />
      </div>
      <div>
        <label className="text-xs text-gray-500 block mb-1">prompt 模板</label>
        <textarea
          value={node.promptTemplate}
          onChange={(e) => patch({ promptTemplate: e.target.value })}
          rows={3}
          className="w-full px-2 py-1 rounded border text-sm"
          placeholder="使用 ${var.path} 插值"
        />
      </div>
      <div>
        <label className="text-xs text-gray-500 block mb-1">inputs</label>
        <div className="space-y-2">
          {node.inputs.map((i) => (
            <div key={i.id} className="border rounded p-2 bg-gray-50 space-y-1">
              <div className="flex gap-1">
                <IdentifierInput value={i.argName} onChange={(v) => updateInput(i.id, { argName: v })} placeholder="argName" />
                <button onClick={() => removeInput(i.id)} className="text-xs text-red-500 px-2">×</button>
              </div>
              <select
                value={i.argType}
                onChange={(e) => updateInput(i.id, { argType: e.target.value as FaiInput['argType'] })}
                className="w-full px-2 py-1 rounded border text-sm"
              >
                <option value="string">string</option>
                <option value="number">number</option>
                <option value="bool">bool</option>
                <option value="prompt">prompt</option>
              </select>
              <input
                type="text"
                value={i.sourceExpr}
                placeholder="train-lang 表达式（如 r.text 或 &quot;literal&quot;）"
                onChange={(e) => updateInput(i.id, { sourceExpr: e.target.value })}
                className="w-full px-2 py-1 rounded border text-sm font-mono"
              />
            </div>
          ))}
          <button onClick={addInput} className="text-sm text-blue-600">+ 添加 input</button>
        </div>
      </div>
      <div>
        <label className="text-xs text-gray-500 block mb-1">outputs</label>
        <div className="space-y-2">
          {node.outputs.map((o) => (
            <div key={o.id} className="border rounded p-2 bg-gray-50 space-y-1">
              <div className="flex gap-1">
                <IdentifierInput value={o.name} onChange={(v) => updateOutput(o.id, { name: v })} placeholder="name" />
                <button onClick={() => removeOutput(o.id)} className="text-xs text-red-500 px-2">×</button>
              </div>
              <select
                value={o.type}
                onChange={(e) => updateOutput(o.id, { type: e.target.value as FaiOutput['type'] })}
                className="w-full px-2 py-1 rounded border text-sm"
              >
                <option value="string">string</option>
                <option value="number">number</option>
                <option value="int">int</option>
                <option value="bool">bool</option>
                <option value="array">array</option>
              </select>
            </div>
          ))}
          <button onClick={addOutput} className="text-sm text-blue-600">+ 添加 output</button>
        </div>
      </div>
    </div>
  )
}
```

- [ ] **Step 3：tsc 通过**

```bash
npx tsc --noEmit
```

- [ ] **Step 4：Commit**

```bash
cd /Users/tom/Projects/cc-web
git add frontend/src/components/tracks/graph/IdentifierInput.tsx \
  frontend/src/components/tracks/graph/NodeInspector.tsx
git commit -m "feat(tracks/graph): v2 NodeInspector — drawer forms for ask_user/fai/return"
```

---

## Task 11：GraphToolbar + 保存逻辑

**Files:**
- Create: `frontend/src/components/tracks/graph/GraphToolbar.tsx`
- Create: `frontend/src/components/tracks/graph/CodePreviewModal.tsx`

- [ ] **Step 1：创建 CodePreviewModal**

```typescript
// frontend/src/components/tracks/graph/CodePreviewModal.tsx
import { Suspense, lazy } from 'react'
import * as Dialog from '@radix-ui/react-dialog'

// Self-host Monaco（同 CodeNode 的模式，参 TrackEditor.tsx:22-34）
const Editor = lazy(async () => {
  const [monacoNs, reactWrapper] = await Promise.all([
    import('monaco-editor'),
    import('@monaco-editor/react'),
  ])
  const m = monacoNs as unknown as { default?: typeof monacoNs }
  const monacoLib = m.default ?? monacoNs
  reactWrapper.loader.config({ monaco: monacoLib as never })
  return { default: reactWrapper.default }
})

interface Props {
  open: boolean
  onOpenChange: (open: boolean) => void
  source: string
  errors?: string[]
}

export function CodePreviewModal({ open, onOpenChange, source, errors }: Props) {
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 bg-black/40 z-50" />
        <Dialog.Content className="fixed left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 w-[80vw] h-[80vh] bg-white rounded-lg z-50 flex flex-col">
          <div className="border-b p-3 flex items-center justify-between">
            <Dialog.Title className="font-medium">.tr 代码预览（只读）</Dialog.Title>
            <Dialog.Close className="text-gray-500 px-2">×</Dialog.Close>
          </div>
          {errors && errors.length > 0 && (
            <div className="bg-red-50 border-b p-3 text-sm text-red-700">
              <div className="font-medium mb-1">codegen 错误：</div>
              <ul className="list-disc pl-5">
                {errors.map((e, i) => <li key={i}>{e}</li>)}
              </ul>
            </div>
          )}
          <div className="flex-1">
            <Suspense fallback={<div className="p-4 text-sm text-gray-400">加载编辑器…</div>}>
              <Editor
                height="100%"
                language="train-lang"
                value={source}
                options={{ readOnly: true, minimap: { enabled: false }, fontSize: 12 }}
              />
            </Suspense>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
```

- [ ] **Step 2：创建 GraphToolbar**

```typescript
// frontend/src/components/tracks/graph/GraphToolbar.tsx
import { useState } from 'react'
import type { GraphV2 } from './graph-types-v2'
import { codegen } from './codegen-v2'
import { encodeSidecar } from './sidecar-io'
import { saveTrack } from '../api'
import { CodePreviewModal } from './CodePreviewModal'

interface Props {
  graph: GraphV2
  projectId: string
  filename: string
  dirty: boolean
  onSaved: () => void
  onClose: () => void
}

export function GraphToolbar({ graph, projectId, filename, dirty, onSaved, onClose }: Props) {
  const [previewOpen, setPreviewOpen] = useState(false)
  const [previewSrc, setPreviewSrc] = useState('')
  const [previewErrors, setPreviewErrors] = useState<string[]>([])
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)

  const handlePreview = () => {
    const r = codegen(graph)
    setPreviewSrc(r.source ?? '')
    setPreviewErrors(r.errors?.map((e) => e.message) ?? [])
    setPreviewOpen(true)
  }

  const handleSave = async () => {
    setSaveError(null)
    const r = codegen(graph)
    if (!r.ok || !r.source) {
      setSaveError(`无法保存：${r.errors?.map((e) => e.message).join('; ') ?? 'unknown'}`)
      return
    }
    setSaving(true)
    try {
      const sidecar = encodeSidecar(graph)
      await saveTrack(projectId, filename, r.source, sidecar)
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
      <button onClick={handlePreview} className="text-sm px-3 py-1 rounded border hover:bg-gray-50">
        预览 .tr 代码
      </button>
      <button
        onClick={handleSave}
        disabled={saving}
        className="text-sm px-3 py-1 rounded bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50"
      >
        {saving ? '保存中…' : '保存'}
      </button>
      {saveError && (
        <div className="text-xs text-red-600 ml-2">{saveError}</div>
      )}
      <CodePreviewModal
        open={previewOpen}
        onOpenChange={setPreviewOpen}
        source={previewSrc}
        errors={previewErrors}
      />
    </header>
  )
}
```

- [ ] **Step 3：tsc 通过**

- [ ] **Step 4：Commit**

```bash
cd /Users/tom/Projects/cc-web
git add frontend/src/components/tracks/graph/GraphToolbar.tsx \
  frontend/src/components/tracks/graph/CodePreviewModal.tsx
git commit -m "feat(tracks/graph): v2 toolbar — save + code preview modal"
```

---

## Task 12：TrackGraphEditor 顶层组装 + 加载逻辑

**Files:**
- Create: `frontend/src/components/tracks/graph/TrackGraphEditor.tsx`

- [ ] **Step 1：创建 TrackGraphEditor**

```typescript
// frontend/src/components/tracks/graph/TrackGraphEditor.tsx
import { useEffect, useReducer, useState } from 'react'
import { ReactFlowProvider } from 'reactflow'
import type { GraphV2 } from './graph-types-v2'
import { reducer, initialGraph } from './reducer-v2'
import { GraphProvider } from './GraphContext'
import { GraphCanvas } from './GraphCanvas'
import { GraphToolbar } from './GraphToolbar'
import { NodePalette } from './NodePalette'
import { NodeInspector } from './NodeInspector'
import { decodeSidecar, crossCheck } from './sidecar-io'
import { detectTrackMode } from './marker-v2'
import { getTrack } from '../api'

interface Props {
  projectId: string
  filename: string                      // 'foo.tr'
  isNew: boolean                        // true 时跳过 GET，直接进空图编辑（避免覆盖现有 .tr）
  onClose: () => void
}

type LoadState =
  | { kind: 'loading' }
  | { kind: 'ready' }
  | { kind: 'error'; message: string }
  | { kind: 'desync'; message: string; recoverable: boolean }

export function TrackGraphEditor({ projectId, filename, isNew, onClose }: Props) {
  const [graph, dispatch] = useReducer(reducer, initialGraph(filename.replace(/\.tr$/, '')))
  const [loadState, setLoadState] = useState<LoadState>(
    isNew ? { kind: 'ready' } : { kind: 'loading' },
  )
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null)
  const [dirty, setDirty] = useState(false)

  useEffect(() => {
    // 新建路径不去 GET（避免覆盖同名旧 .tr 或加载不属于本编辑器的内容）
    if (isNew) return
    let cancelled = false
    void (async () => {
      try {
        const res = await getTrack(projectId, filename)
        if (cancelled) return
        const mode = detectTrackMode(res.source)
        if (mode === 'node-graph-v1') {
          setLoadState({
            kind: 'error',
            message: '此节点图为旧版本（M1 嵌套块）。请切换到代码模式打开，或手动重建。',
          })
          return
        }
        if (mode === 'code') {
          // 已是纯代码 .tr，不能作为节点图打开（会丢失代码）
          setLoadState({
            kind: 'error',
            message: '此文件是纯 .tr 代码（无节点图 marker）。请切换到代码模式打开。',
          })
          return
        }
        // mode === 'graph-v2'
        if (res.sidecar) {
          const decoded = decodeSidecar(res.sidecar)
          if (!decoded.ok || !decoded.graph) {
            setLoadState({ kind: 'desync', message: `sidecar 解析失败：${decoded.reason}`, recoverable: false })
            return
          }
          const cc = crossCheck(decoded.graph, res.source)
          if (!cc.ok) {
            setLoadState({
              kind: 'desync',
              message: `sidecar 与 .tr 节点 nid 不匹配（缺失 ${cc.missingNids.length} / 多余 ${cc.extraNids.length}）`,
              recoverable: true,
            })
            return
          }
          dispatch({ type: 'replace', graph: decoded.graph })
        }
        setLoadState({ kind: 'ready' })
      } catch (e) {
        if (!cancelled) {
          setLoadState({ kind: 'error', message: (e as Error).message })
        }
      }
    })()
    return () => { cancelled = true }
  }, [projectId, filename, isNew])

  // Mark dirty on any reducer state change after initial load
  useEffect(() => {
    if (loadState.kind === 'ready') setDirty(true)
    // ESLint: depend on graph identity only after ready; ignore loadState in deps
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [graph])

  const wrappedDispatch = (a: Parameters<typeof dispatch>[0]) => {
    dispatch(a)
  }

  if (loadState.kind === 'loading') {
    return <div className="flex items-center justify-center h-full text-gray-400">加载中…</div>
  }
  if (loadState.kind === 'error') {
    return (
      <div className="flex flex-col items-center justify-center h-full text-red-600 gap-2">
        <div>{loadState.message}</div>
        <button onClick={onClose} className="text-sm px-3 py-1 rounded border">关闭</button>
      </div>
    )
  }
  if (loadState.kind === 'desync') {
    return (
      <div className="flex flex-col items-center justify-center h-full text-amber-700 gap-2 max-w-md mx-auto p-6">
        <div className="font-medium">sidecar 与 .tr 失同步</div>
        <div className="text-sm">{loadState.message}</div>
        <div className="text-xs text-gray-600 mt-2">
          M1 暂仅支持"代码模式打开" 兜底；M2 起会提供"重建 sidecar / 只读图"恢复路径。
        </div>
        <div className="flex gap-2 mt-2">
          <button onClick={onClose} className="text-sm px-3 py-1 rounded border">关闭</button>
          <button
            onClick={() => {
              // 通知父级以代码模式重新打开此文件（父级 TracksListDialog 处理）
              window.dispatchEvent(new CustomEvent('ccweb:open-track-as-code', {
                detail: { projectId, filename },
              }))
              onClose()
            }}
            className="text-sm px-3 py-1 rounded bg-blue-600 text-white"
          >
            改为代码模式打开
          </button>
        </div>
      </div>
    )
  }

  const handleClose = () => {
    if (dirty) {
      const ok = window.confirm('未保存的修改将丢失。确认关闭吗？')
      if (!ok) return
    }
    onClose()
  }

  return (
    <ReactFlowProvider>
      <GraphProvider value={{ dispatch: wrappedDispatch }}>
        <div className="flex flex-col h-full">
          <GraphToolbar
            graph={graph}
            projectId={projectId}
            filename={filename}
            dirty={dirty}
            onSaved={() => setDirty(false)}
            onClose={handleClose}
          />
          <div className="flex-1 flex overflow-hidden">
            <NodePalette />
            <GraphCanvas
              graph={graph}
              dispatch={wrappedDispatch}
              selectedNodeId={selectedNodeId}
              onSelect={setSelectedNodeId}
            />
            <NodeInspector graph={graph} selectedNodeId={selectedNodeId} />
          </div>
        </div>
      </GraphProvider>
    </ReactFlowProvider>
  )
}
```

- [ ] **Step 2：tsc 通过**

```bash
npx tsc --noEmit
```

- [ ] **Step 3：Commit**

```bash
cd /Users/tom/Projects/cc-web
git add frontend/src/components/tracks/graph/TrackGraphEditor.tsx
git commit -m "feat(tracks/graph): v2 TrackGraphEditor — load + sidecar crossCheck + dirty"
```

---

## Task 13：TracksListDialog 改两选 + v1 readonly banner

> **本 task 自包含说明**：因为 TracksListDialog 现有代码结构复杂，subagent 执行此 task 时第一步必须完整 read 该文件，再基于 read 结果定制 diff。本 task 分为三个独立 step，subagent 应按顺序逐 step 完成。

**Files:**
- Modify: `frontend/src/components/tracks/TracksListDialog.tsx`

- [ ] **Step 1：通读现有 TracksListDialog 全文 + 定位关键改点**

执行：

```bash
wc -l /Users/tom/Projects/cc-web/frontend/src/components/tracks/TracksListDialog.tsx
grep -n "新建\|创建\|node-graph\|track-mode\|onOpen\|handleCreate\|mode.*===" /Users/tom/Projects/cc-web/frontend/src/components/tracks/TracksListDialog.tsx | head -30
```

完整 read 该文件，在 task notes 里列出：
- 现有"新建"流程入口（函数名 / state 变量）
- 现有"创建模式"对话框（如有）的渲染位置
- 现有"点文件打开"逻辑（路由到 TrackEditor / visual / etc）
- visual/ v1 模式相关引用（要删除）

预期：定位到 3-5 个关键改点 + 1 个 v1 visual/ 入口要删。

- [ ] **Step 2：实施最小路由接入**

按 Step 1 定位结果，做下列修改（顺序敏感）：

1. 删除"v1 visual editor"入口（如有 `import { TrackVisualEditor } from './visual/...'` 之类的引用，去掉）
2. 加 `import { TrackGraphEditor } from './graph/TrackGraphEditor'` 和 `import { MARKER_LINE_V2, V1_MARKER_LINE } from './graph/marker-v2'`
3. 创建模式对话框改两选（删 v1 三选，留"节点图（v2 ReactFlow）" + "写代码 .tr"）
4. 列表 row 渲染时按 source 首行加图标
5. 点文件 handler 按 marker 路由

骨架代码示例：

骨架修改示例：

```typescript
// 模式选择对话框（替换 v1 三选）
import { TrackGraphEditor } from './graph/TrackGraphEditor'
import { MARKER_LINE_V2, V1_MARKER_LINE } from './graph/marker-v2'

// 新建按钮点击 → 弹两选对话框
const [createMode, setCreateMode] = useState<'graph-v2' | 'code' | null>(null)
const [activeEditor, setActiveEditor] = useState<
  | { kind: 'graph-v2'; filename: string; isNew: boolean }
  | { kind: 'code'; filename: string; banner?: string }
  | null
>(null)

// ...

{createMode === null && (
  <div className="space-y-2">
    <h3>选择创建模式</h3>
    <button onClick={() => {
      setCreateMode('graph-v2')
      // 弹文件名输入后 setActiveEditor({ kind: 'graph-v2', filename, isNew: true })
    }}>节点图（v2 ReactFlow）</button>
    <button onClick={() => setCreateMode('code')}>写代码 .tr</button>
  </div>
)}

// 列表 row 渲染时根据 file source 首行判断模式
function rowIcon(source: string | null): string {
  if (!source) return ''
  const firstLine = source.split('\n', 1)[0]?.trim() ?? ''
  if (firstLine === MARKER_LINE_V2) return '🕸️'
  if (firstLine === V1_MARKER_LINE) return '🧩'
  return ''
}

// 点击 .tr 文件打开
const handleOpen = async (filename: string) => {
  const res = await getTrack(projectId, filename)
  const firstLine = res.source.split('\n', 1)[0]?.trim() ?? ''
  if (firstLine === MARKER_LINE_V2) {
    setActiveEditor({ kind: 'graph-v2', filename, isNew: false })
  } else if (firstLine === V1_MARKER_LINE) {
    setActiveEditor({ kind: 'code', filename, banner: 'v1 节点图（已弃用），M1 阶段仅支持只读查看' })
  } else {
    setActiveEditor({ kind: 'code', filename })
  }
}

// 渲染 activeEditor
{activeEditor?.kind === 'graph-v2' && (
  <TrackGraphEditor
    projectId={projectId}
    filename={activeEditor.filename}
    isNew={activeEditor.isNew}
    onClose={() => setActiveEditor(null)}
  />
)}

// 听 sidecar desync 时 TrackGraphEditor 发的 fallback 事件
useEffect(() => {
  const onFallback = (ev: Event) => {
    const detail = (ev as CustomEvent).detail as { projectId: string; filename: string }
    if (detail.projectId === projectId) {
      setActiveEditor({ kind: 'code', filename: detail.filename, banner: 'sidecar 失同步，代码模式查看' })
    }
  }
  window.addEventListener('ccweb:open-track-as-code', onFallback)
  return () => window.removeEventListener('ccweb:open-track-as-code', onFallback)
}, [projectId])
```

- [ ] **Step 3：tsc 通过 + 浏览器手动 smoke**

```bash
cd /Users/tom/Projects/cc-web/frontend
npx tsc --noEmit
```

预期：通过。

启动 dev server，浏览器实测：
- 点工作轨"新建" → 弹两选对话框 → 选 v2 → 输入文件名 → 进入 TrackGraphEditor（空图状态）
- 列表里之前的 v1 .tr（如有）显示 🧩 + tooltip 旧版本，点开走代码 readonly 模式
- 列表里 v2 文件显示 🕸️，点开走 TrackGraphEditor

- [ ] **Step 4：Commit**

```bash
cd /Users/tom/Projects/cc-web
git add frontend/src/components/tracks/TracksListDialog.tsx
git commit -m "feat(tracks/graph): TracksListDialog — two-mode create + v1/v2 marker routing"
```

---

## Task 14：verify-graph-v2.ts ts-node E2E smoke test

**Files:**
- Create: `frontend/src/components/tracks/graph/__tests__/verify-graph-v2.ts`
- Modify: `frontend/package.json`（加 verify script）

- [ ] **Step 1：写端到端 smoke 脚本**

```typescript
// frontend/src/components/tracks/graph/__tests__/verify-graph-v2.ts
/**
 * End-to-end smoke: build GraphV2 → codegen → train-core runSource
 * + inline mock fai adapter → must reach ok=true.
 *
 * Mirrors the v-17-b lesson #2 pattern: parse-pass ≠ runtime-pass.
 *
 * Runner: `npm run verify:graph-v2` (uses tsx, ESM-native).
 * Important: frontend tsconfig is ESM, so we use createRequire to load
 * the vendored train-core CommonJS bundle.
 */
import { createRequire } from 'node:module'
import { codegen } from '../codegen-v2'
import { newNodeId } from '../graph-types-v2'
import type { GraphV2 } from '../graph-types-v2'

// Bridge ESM → CJS for vendored train-core (same bundle backend uses)
const require = createRequire(import.meta.url)
// eslint-disable-next-line @typescript-eslint/no-require-imports
const core = require('../../../../../../backend/vendor/@tom2012/train-core/dist/index.js')

interface CheckResult { name: string; ok: boolean; detail?: string }
const results: CheckResult[] = []
function check(name: string, ok: boolean, detail?: string) {
  results.push({ name, ok, detail })
  console.log(`${ok ? '✓' : '✗'} ${name}${detail ? `  — ${detail}` : ''}`)
}

const inlineMockAdapter = {
  name: 'inline-mock',
  version: '0.0.0',
  capabilities: { parallel: true, cancellation: true, writesWorkflowData: false },
  async call(_req: unknown) {
    return { kind: 'success', outputs: { rating: 7, comment: 'mock' } }
  },
}

async function main() {
  // ── Case 1: empty return only ──
  {
    const g: GraphV2 = {
      version: 2, trackName: 't1',
      nodes: [{ id: newNodeId(), type: 'return', position: { x: 0, y: 0 }, valueExpr: '"hello"' }],
      edges: [],
    }
    const r = codegen(g)
    check('case1 codegen ok', r.ok)
    if (r.ok && r.source) {
      const run = await core.runSource(r.source, { adapter: inlineMockAdapter, args: [] })
      check('case1 runtime ok=true', run.ok, run.ok ? `result=${JSON.stringify(run.result)}` : `error=${run.error?.message}`)
    }
  }

  // ── Case 2: code + fai + return chain ──
  {
    const nC = newNodeId(), nF = newNodeId(), nR = newNodeId()
    const g: GraphV2 = {
      version: 2, trackName: 't2',
      nodes: [
        { id: nC, type: 'code', position: { x: 0, y: 0 }, code: 'let s = "hello"' },
        {
          id: nF, type: 'fai', position: { x: 0, y: 100 },
          faiName: 'analyze', outputVar: 'r',
          inputs: [{ id: 'i1', argName: 'text', argType: 'string', sourceExpr: 's' }],
          outputs: [
            { id: 'o1', name: 'rating', type: 'int', constraints: { min: 1, max: 10 } },
            { id: 'o2', name: 'comment', type: 'string' },
          ],
          promptTemplate: '评分',
        },
        { id: nR, type: 'return', position: { x: 0, y: 200 }, valueExpr: 'r' },
      ],
      edges: [
        { id: 'e1', source: nC, target: nF },
        { id: 'e2', source: nF, target: nR },
      ],
    }
    const r = codegen(g)
    check('case2 codegen ok', r.ok, r.ok ? '' : r.errors?.map((e) => e.message).join('; '))
    if (r.ok && r.source) {
      const run = await core.runSource(r.source, { adapter: inlineMockAdapter, args: [] })
      check('case2 runtime ok=true', run.ok, run.ok ? `result=${JSON.stringify(run.result)}` : `error=${run.error?.message}`)
    }
  }

  // ── Case 3: ask_user + return (use injector for ask_user mock) ──
  {
    const nA = newNodeId(), nR = newNodeId()
    const g: GraphV2 = {
      version: 2, trackName: 't3',
      nodes: [
        {
          id: nA, type: 'ask_user', position: { x: 0, y: 0 },
          outputVar: 'input',
          fields: [{ id: 'f1', key: 'name', label: '姓名', type: 'text' }],
        },
        { id: nR, type: 'return', position: { x: 0, y: 100 }, valueExpr: 'input.name' },
      ],
      edges: [{ id: 'e1', source: nA, target: nR }],
    }
    const r = codegen(g)
    check('case3 codegen ok', r.ok)
    // Note: ask_user runtime needs __ccweb_ask_user injection (provided by backend track-runner).
    // We just verify parse + codegen here (since the inline mock doesn't simulate ask_user).
    // Full runtime test for ask_user is in backend verify-track.
  }

  const fails = results.filter((r) => !r.ok)
  console.log(`\n${results.length - fails.length}/${results.length} checks passed`)
  if (fails.length > 0) {
    console.log(`\nFAILED:`)
    fails.forEach((r) => console.log(`  ✗ ${r.name}${r.detail ? ` — ${r.detail}` : ''}`))
    process.exit(1)
  }
}

main().catch((e) => {
  console.error('verify failed with exception:', e)
  process.exit(1)
})
```

- [ ] **Step 2：确认 verify script 已在 Task 1 加入**

Task 1 已经把 `"verify:graph-v2": "tsx src/components/tracks/graph/__tests__/verify-graph-v2.ts"` 加到 `frontend/package.json` scripts。此处只需确认存在：

```bash
grep "verify:graph-v2" /Users/tom/Projects/cc-web/frontend/package.json
```

预期：命中。

- [ ] **Step 3：跑 verify 脚本**

```bash
cd /Users/tom/Projects/cc-web/frontend
npm run verify:graph-v2
```

预期：all checks PASS（至少 case1 + case2 全绿）。

- [ ] **Step 4：Commit**

```bash
cd /Users/tom/Projects/cc-web
git add frontend/src/components/tracks/graph/__tests__/verify-graph-v2.ts \
  frontend/package.json
git commit -m "test(tracks/graph): verify-graph-v2 — end-to-end runtime smoke with mock adapter"
```

---

## Task 15：浏览器手动 smoke + 版本发布

**Files:**
- Modify: `package.json`、`backend/package.json`、`frontend/package.json`、`README.md`（按现有发版三文件同步约定）

- [ ] **Step 1：浏览器实测**

```bash
cd /Users/tom/Projects/cc-web
# 启动 backend + frontend（按项目现有约定）
```

打开项目，点工作轨"新建" → 选"节点图（v2 ReactFlow）" → 输入文件名 `test1.tr` → 进 TrackGraphEditor。

测试 checklist：
- [ ] 拖 ask_user / code / fai / return 节点到画布 → 节点出现
- [ ] 点节点 → 右侧 NodeInspector 出现表单
- [ ] 拖端口连边 → 边出现，按 reducer 持久化
- [ ] CodeNode Monaco 编辑代码 → 节点高度自适应
- [ ] 点"预览 .tr 代码" → 弹模态显示 codegen 输出，含 marker + nid
- [ ] 改一个表达式让 codegen 失败 → 预览模态显示错误
- [ ] 点"保存" → 后台 .tr + sidecar JSON 都写入（用 `ls -la project/.ccweb/tracks/` 确认）
- [ ] 关闭编辑器 → 重新打开 → 节点和边都恢复
- [ ] 列表里 .tr 文件显示 🕸️ 图标
- [ ] 新建一个 v1 marker 的 .tr（手工 vim）→ 列表显示 🧩 → 点打开 → 弹"v1 旧版本"提示

- [ ] **Step 2：bump 版本**

按项目现有约定（CLAUDE.md / 历史教训）同步版本号。新版本号取当天 + 字母后缀，例如 `v2026.5.18-a`。

修改：
- `/Users/tom/Projects/cc-web/package.json` `version`
- `/Users/tom/Projects/cc-web/backend/package.json` `version`
- `/Users/tom/Projects/cc-web/frontend/package.json` `version`
- `/Users/tom/Projects/cc-web/README.md` 顶部版本号

- [ ] **Step 3：build + commit + push + publish（按用户授权）**

```bash
cd /Users/tom/Projects/cc-web
# build
cd backend && npm run build && cd ..
cd frontend && npm run build && cd ..
# commit
git add -A && git commit -m "release: v2026.5.18-a — visual track builder v2 M1（reactflow base）"
git push origin main
```

**npm publish 需要用户当前消息明确授权 + 提供 token（按用户偏好 — 历史教训 #1）。** 本步骤实施者发现已经 commit + push 后，应该停下来问用户是否 publish + token，不要自行 publish。

- [ ] **Step 4：通知用户 M1 完成 + 后续 milestone**

提示：M1 完成，M2 起新 plan（IfFrameNode + LoopFrameNode + frame 嵌套 + 最小 history）。

---

## Self-Review

**Spec 覆盖检查**（spec §1-§15）：

- §1 摘要 ✓（M1 范围全覆盖）
- §2 心智模型 ✓（节点 type / 自由拖 / 由用户决定粒度）
- §3 YAGNI ✓（M1 不做 if/for/trace/copy paste）
- §4 用户体验 ✓（Task 13 改对话框 / Task 9 拖 palette / Task 11 预览 + 保存 / Task 12 加载 + dirty）
- §5 架构 ✓（Task 1 types + 各子模块 / Task 12 顶层 ReactFlowProvider 包裹）
- §6 数据模型 ✓（Task 1）+ 持久化 ✓（Task 5 sidecar）
- §7 6 类节点：M1 覆盖 4 类（Task 6/7/8 + Inspector 表单），IfFrame/LoopFrame 留 M2
- §8 Codegen 顶层单链 ✓（Task 2）；frame 递归留 M2
- §9 运行时 trace hook 不在 M1 范围
- §10 v1 兼容 ✓（Task 13 readonly banner + marker 路由）
- §11 错误：parse error lint ✓（Task 7 Monaco 自带）；结构校验 ✓（Task 2 topo-codegen 多入口/孤立）；sidecar 失同步 M1 仅"显示错误后关闭"，复杂恢复对话框留 M2
- §12 测试 ✓（codegen-v2.test / reducer-v2.test / scope-v2.test / sidecar-io.test / verify-graph-v2 E2E）
- §13 milestone：本 plan 仅 M1，M2-M5 后续

**Placeholder 扫描**：每 task 都给具体代码，没有 TBD / 留空。Task 13 TracksListDialog 改造是"骨架修改示例 + 实施者按现有结构定制"，因为不读现有完整代码无法给精确 diff——这是已知限制，实施者执行 Task 13 时先 read 整文件再 edit。

**类型一致性**：
- newNodeId 在 graph-types-v2、reducer-v2 单测、NodePalette、verify 都用
- Action 类型在 reducer-v2 定义，GraphContext 复用
- GraphV2 在 codegen-v2、sidecar-io、TrackGraphEditor、GraphToolbar 一致使用
- FaiInput.sourceExpr / promptTemplate 在 codegen 与 inspector 表单字段名一致
- NODE_TYPES 字符串 key（'code' / 'ask_user' / 'fai' / 'return'）与 graph-types-v2 type union 一致

**已知 M1 简化**（spec 允许、M2+ 完整化）：
- sidecar 失同步只支持"显示错误后关闭"，spec §11.4 三选恢复（重建/只读图/代码模式）M2 起做
- CodeNode parse error 仅靠 Monaco 自带 train-monaco-lang grammar，深度 lint M2+ 强化
- scope-v2 用 `let X = ` 启发式扫 CodeNode 变量名，未真正 parse train-lang（Phase 2 LSP 替换）
- 顶层禁 fan-out 严格执行，多入口/出度>1 报错；M2 加 IfFrame 后才有"分支"概念
- 节点 nid 在保存时自动持久化到 sidecar；M1 不实现"修改 .tr 后重新打开自动 reconcile"
- 自动布局（dagre）依赖装了但 M1 不调用；M2 加 IfFrame 时引入"重新整理"按钮
