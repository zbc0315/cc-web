---
date: 2026-05-16
status: design-approved-pending-spec-review
owner: zhang
---

# Visual Track Builder（节点图模式）设计

## 1. 摘要

为工作轨增加一种"免代码"的可视化创建方式，让不会 train-lang 语法的用户也能搭出可运行的 `.tr`。视觉形态走 **嵌套块编辑器**（Notion 块 / Scratch C-shape 风），而不是传统 node-graph。.tr 仍是唯一 source of truth；节点图保存时单向 codegen 出 `.tr`，首行 marker `// @@ccweb-track-mode: node-graph v1` 让下次打开识别为节点图模式。运行时通过 train-lang 的 statement-level trace hook + codegen 出的 `// @@nid` 注释实现节点高亮 + 变量快照 + 连线动画。

## 2. 目标用户与约束

**目标用户：完全不会 train-lang 语法的人**（允许有"一点基础"——理解"步骤、变量、条件"等概念）。

**因此排除的设计：**
- 节点之间的显式数据流连线（端口 to 端口）——多一层认知
- 自然语言生成代码 → 编辑器（生成后坏了改不动）
- 真·node-graph 自由拖动 + zoom/pan（手机不友好，与"步骤"心智不一致）

**保留的约束：**
- 单向 `节点图 → .tr`，`.tr` 是 source of truth
- 节点图模式与 Monaco 代码模式互不切换（双向 parse 是已知陷阱）
- 节点粒度 = "一个动作"（fai 调用 / ask_user / let / 控制流 / return）
- 连线含义 = 执行顺序，变量隐式共享（@ 下拉引用）
- 控制流 = 嵌套容器（Scratch C-shape）
- 不持久化 layout（Phase 1 每次打开自动布局；持久化推 Phase 2）

## 3. 不在范围（YAGNI）

- fai 节点跨工作轨复用 / "fai 库" / SkillHub 集成（先做单工作轨内）
- try/catch 节点（train-lang 支持但用户教育成本高，需要时切代码视图）
- while / break / continue（Phase 1 用 for 覆盖大部分场景）
- 复制粘贴跨工作轨节点
- 持久化 layout（节点位置）
- 反向：手写 .tr → 节点图 parse（违反单向红线）
- 移动端布局优化（嵌套块路径天然手机友好，但不专门做触屏拖拽手势）

## 4. 用户体验路径

### 4.1 五个核心动作

**A. 新建工作轨**
1. 在 TracksListDialog 点"新建"
2. 弹"创建模式"对话框：`[节点图搭建（可视化）]` / `[写代码 .tr（高级）]` 两个大按钮
3. 选节点图 → 输入文件名 → 进入节点图编辑器

**B. 编辑节点图**
- 画布左侧 palette 固定 6 类节点（问用户 / AI 调用 / 命名变量 / 如果 / 重复 / 返回）
- 从 palette 拖到画布主列表 / 容器内部
- 释放时 drop indicator（蓝线）显示插入位置
- 双击节点 → 右侧抽屉滑出表单
- 容器节点（if / for）内部留虚线占位区"拖节点到这里"，子节点拖入后撑开容器

**C. 实时预览 .tr 代码**
- 右上角"预览代码"按钮 → 弹出只读 Monaco viewer 显示 codegen 出的 .tr
- 关闭后继续编辑

**D. 保存 + 运行**
- 保存：codegen → 持久化 `.tr`（首行 marker）
- 保存前校验：变量引用必须可见、`outputVar` 在同一 scope 不重名；不通过则阻止保存 + 红色错误标注问题节点
- 运行：现有 `POST /tracks/run` 不变；后端在每个 statement 边界 emit 新 WS 事件
- 节点图编辑器自动进入"运行视图"：当前节点 pulse 高亮，已完成绿边 + ✓，失败红边 + ✗，跳过的 if 分支灰 + 划线；右侧抽屉切到"变量面板"。嵌套块路径下没有显式连线，因此无"连线动画"——状态变化通过节点边框动画呈现（见 8.4 降级说明）

**E. 跑完后**
- 节点图保持终态
- 点任一节点 → 抽屉显示该节点产生的变量 JSON 快照
- 用户编辑节点图后状态全 reset

### 4.2 与现有系统的边界

- `TracksListDialog` "新建"按钮 → 弹模式选择对话框
- 工作轨列表里：节点图模式 .tr 显示图标区分（识别首行 marker）
- 打开已有节点图 `.tr`：识别首行 marker → 进节点图编辑器
- 打开已有手写 `.tr`：照旧 Monaco
- 单向红线：节点图模式打开时不允许切 Monaco 编辑；Monaco 模式打开时不能切节点图

## 5. 数据模型 + codegen 规则

### 5.1 前端内存模型

```ts
type TrackGraph = {
  version: 1
  trackName: string
  body: Node[]                              // main 函数体
}

type Node = AskUserNode | FaiNode | LetNode | IfNode | ForNode | ReturnNode

interface NodeBase {
  id: string                                // n_xxx，稳定，运行时高亮用
  type: string
}

interface AskUserNode extends NodeBase {
  type: 'ask_user'
  outputVar: string
  fields: { key, label, type, variants?, required? }[]
}

interface FaiNode extends NodeBase {
  type: 'fai'
  faiName: string
  outputVar: string
  inputs: { argName, argType, source: VarRef | Literal }[]
  outputs: { name, type, constraints? }[]
  promptTemplate: string                    // 含 @{varRef} 占位
}

interface LetNode extends NodeBase {
  type: 'let'
  varName: string
  value: Expression
}

interface IfNode extends NodeBase {
  type: 'if'
  condition: { glue: 'and' | 'or'; rows: TripleSlot[] }
  thenBody: Node[]
  elseBody: Node[]                          // 空数组表示无 else
}

interface ForNode extends NodeBase {
  type: 'for'
  iterVar: string
  iterableRef: VarRef
  body: Node[]
}

interface ReturnNode extends NodeBase {
  type: 'return'
  value: Expression
}

type VarRef = { kind: 'var'; path: string[] }
type Literal = { kind: 'lit'; raw: string }
type TripleSlot = {
  kind: 'triple'
  left: VarRef | Literal
  op: '==' | '!=' | '>' | '<' | '>=' | '<=' | '+' | '-' | '*' | '/'
  right: VarRef | Literal
}
type Expression = VarRef | Literal | TripleSlot
```

### 5.2 codegen 规则

`.tr` 文件结构：

```
// @@ccweb-track-mode: node-graph v1
// 文件由节点图编辑器生成。手改无效—请用节点图编辑。

<所有 fai 节点 → 模块级声明聚集顶部，shape dedupe 后>

func main() -> any {
  <main 体：按 body 顺序展开>
}
export main
```

每种节点的 codegen：

| 节点 | 生成 |
|---|---|
| `ask_user` | `// @@nid: n_xx`<br>`let <outputVar> = __ccweb_ask_user({ fields: [...] })` |
| `fai` 声明 | 顶部聚集：`fai <faiName>(...) -> ... { }` |
| `fai` 调用 | `// @@nid: n_xx`<br>`let <outputVar> = <faiName>(<source values>, "<rendered prompt>")` |
| `let` | `// @@nid: n_xx`<br>`let <varName> = <expr>` |
| `if` | `// @@nid: n_xx`<br>`if <cond> { ... } else { ... }` |
| `for` | `// @@nid: n_xx`<br>`for <iter> in <ref> { ... }` |
| `return` | `// @@nid: n_xx`<br>`return <expr>` |

`Expression` 渲染：
- `VarRef { path: ['r','rating'] }` → `r.rating`
- `Literal { raw: '"hello"' }` → 拷贝 raw（用户填什么写什么，含引号）
- `TripleSlot` → `r.rating > 5`
- `ConditionList` 多行用 `&&` / `||` 拼

`promptTemplate` 渲染：`@{r.rating}` → train-lang 原生字符串插值 `${r.rating}`，整个 prompt 作为带插值字符串字面量输出。

### 5.3 fai shape dedupe

用户复制 fai 节点 = 数据层新建独立 `FaiNode`（深拷贝，新 id）。

codegen 时做 **shape dedupe pass**：
- shape 键 = `{faiName, inputs.schema, outputs.schema, promptTemplate}`（不含 outputVar）
- shape 等价的多 FaiNode 合并成一个 `fai` 声明 + 多个调用点
- 任一字段改动 → shape 不再等价 → codegen 出独立声明
- faiName 冲突时自动 `_2`/`_3` 后缀，UI toast 提示"名字冲突，已自动改为 xxx_2"

### 5.4 节点 ID 与运行时定位

每个产生 statement 的节点前 codegen 出一行 `// @@nid: n_xx`。train-lang interpreter 在 statement 边界触发 trace hook，hook 从该 statement 的 leading-comment 提取 nid → ccweb 后端发 WS 事件 → 前端定位节点。

### 5.5 保存前校验

- 每个 `VarRef` 必须能在该节点的可见 scope 里找到
- 同一 scope 内 `outputVar` / `varName` / `iterVar` 不能重名
- `for` 节点的 `iterableRef` 必须引用一个数组类型的变量（Phase 1 用启发式：来自 fai 输出 schema 标记为 array 或字面量数组）
- 不通过 → 保存按钮 disabled + 问题节点红边 + tooltip 错误描述

## 6. 节点类型 + 表单 UI

### 6.1 左侧 palette

固定浮动 dock，6 类：

```
💬  问用户     ← ask_user
🤖  AI 调用    ← fai
📦  命名变量   ← let
🔀  如果       ← if
🔁  重复       ← for
⬅️   返回       ← return
```

### 6.2 画布节点的默认折叠视觉

```
┌─────────────────────────────────┐
│ 🤖 AI 调用     analyzeFile      │
│ ──────────────────────────────  │
│ 输入: @input.file_path           │
│ 输出: r (rating, comment)        │
└──────────────────────────────────┘
```

容器节点（if / for）：

```
┌─────────────────────────────────┐
│ 🔀 如果                          │
│  @r.rating > 5  AND              │
│  @r.confidence > 0.8             │
├─────────────────────────────────┤
│ 则:                              │
│  ┌- - - - - - - - - - - - - -┐  │
│  │   [拖节点到这里]            │  │
│  └- - - - - - - - - - - - - -┘  │
├─────────────────────────────────┤
│ 否则:               [启用 ▾]    │
│  ┌- - - - - - - - - - - - - -┐  │
│  │   (禁用状态灰色)            │  │
│  └- - - - - - - - - - - - - -┘  │
└──────────────────────────────────┘
```

### 6.3 每节点的表单（右侧抽屉）

详细布局见第 3 节设计讨论。简表：

- **ask_user**：`outputVar` 输入 + `fields` 数组（key/label/type/variants?/required?）
- **fai**：`faiName` + `outputVar` + `inputs[]`（每项 argType ∈ `string` / `number` / `bool` / `prompt`）+ `outputs[]`（每项 type ∈ `string` / `number` / `bool` / `int` / `array<inner>`，array 时 inner 复用同一组类型）+ `promptTemplate`（大文本框，@ 触发下拉）
- **let**：`varName` + 三格拼装器（中间 op 可清空 → 单值模式）
- **if**：`condition` 一组三格行 + glue（AND/OR） + 嵌套 thenBody / elseBody
- **for**：`iterVar` + `iterableRef` + 嵌套 body
- **return**：值大文本框（支持 @ 引用）

### 6.4 视觉状态

| 状态 | 视觉 |
|---|---|
| 默认 | 浅灰边 |
| 选中 | 蓝边 + 阴影 |
| 拖拽中 | 半透明 + grabbing cursor |
| 容器接受拖入 | 内部虚线变亮 |
| running | 黄色 pulse 边框 |
| completed | 绿色边 + ✓ |
| failed | 红色边 + ✗ + 错误 hover tooltip |
| skipped | 灰色 + 划线 |

### 6.5 变量引用控件（@ 下拉 + chip）

- 任何变量引用位置（输入下拉 / textarea / 三格拼装器槽）键入 `@` 弹建议列表
- 候选来源：从根到当前节点路径上所有 `ask_user.outputVar` / `fai.outputVar` / `fai.outputs[*]` / `let.varName` / `for.iterVar`
- 渲染层呈现 **chip / pill**：不可分割彩色徽章，点 × 或退格整体删除
- **内部 state 不是字符串**：textarea 的 value 用 segment 数组表示，例如
  ```ts
  [{kind:'text', raw:'请对'}, {kind:'ref', path:['input','file_path']}, {kind:'text', raw:'评分'}]
  ```
  保存 JSON 序列化时 ref 段写成 `VarRef`，codegen 时把 ref 段拼成 train-lang 字符串插值 `${input.file_path}`
- 三格拼装器和下拉的"值"位置使用同一 `VarRef | Literal | TripleSlot` union，控件实现 = chip 输入框（chip 来自 @ 下拉，文字部分自由输入

## 7. 前端架构

### 7.1 路径选择：嵌套块编辑器（不用 ReactFlow）

实施路径走 **Notion 风 / Scratch 风嵌套块**：
- 节点是纵向卡片列表，没有显式连线（顺序天然）
- 容器节点内部缩进 + 竖线区分子节点
- 拖拽 = Notion 块拖拽（drop indicator 横线）
- 不需要 zoom/pan/minimap/SVG edge routing
- 代码量预估 1500-2000 行（ReactFlow 路径预估 4000+ 行）

### 7.2 组件树

新建 `frontend/src/components/tracks/visual/`：

```
TrackEditorPage
├─ TrackHeader (filename, run/stop/save, preview-code toggle)
├─ TrackCanvas
│   ├─ NodePalette        (左侧浮动 dock，6 项可拖)
│   ├─ NodeList           (中央纵向列表)
│   │   └─ NodeBlock      (递归 — 容器节点内部又含 NodeList)
│   │       ├─ NodeHeader (icon + 标题 + summary + 状态边框)
│   │       └─ NodeContainerSlot (仅 if/for)
│   └─ NodeFormDrawer     (右侧抽屉，选中节点时展示表单)
└─ CodePreviewModal       (右上角"预览代码"打开)
```

辅助：
- `forms/AskUserForm.tsx` / `FaiForm.tsx` / `LetForm.tsx` / `IfForm.tsx` / `ForForm.tsx` / `ReturnForm.tsx`
- `TripleSlot.tsx`（条件 / let 值共享）
- `VarRefInput.tsx`（@ 引用下拉 + chip 渲染）
- `codegen.ts`（节点图 → .tr）
- `scope.ts`（计算节点可见变量 scope）
- `graph-types.ts`（5.1 的 TS 类型）

复用：
- `parse-train.ts` 用于"预览代码"语法高亮
- `TrackUserInputDialog.tsx` 运行 ask_user 时弹窗（不变）
- `useTrackState.ts` 订阅 WS 事件（要扩展接受 `track_node_active` / `track_node_completed` / `track_node_failed` / `track_node_skipped`）

### 7.3 状态管理

节点图状态用一个 `useReducer`（不引入 zustand/redux）：

```ts
type Action =
  | { type: 'add'; node: Node; targetPath: NodePath; index: number }
  | { type: 'remove'; path: NodePath }
  | { type: 'move'; from: NodePath; to: NodePath }
  | { type: 'duplicate'; path: NodePath }
  | { type: 'update'; path: NodePath; patch: Partial<Node> }

type NodePath = number[]    // 嵌套位置：[0, 1] = body[0] 的容器内第 1 个子节点
```

运行时状态独立（不进 reducer）：

```ts
type RuntimeState = Map<nodeId, 'idle' | 'running' | 'completed' | 'failed' | 'skipped'>
type VarSnapshots = Map<nodeId, Record<string, unknown>>
```

订阅 `useTrackState` 扩展的事件更新。

### 7.4 拖拽

使用 `@dnd-kit/core`（轻量 ~30KB，a11y 友好，触屏支持）：
- `DndContext` 包住整个 `TrackCanvas`
- palette 6 项是 `useDraggable`
- 主 NodeList 与每个容器的 child NodeList 都是 `useDroppable`
- 已放在画布上的节点既 `useDraggable` 又 `useDroppable`（重排序）
- drop indicator：1px 蓝线显示插入位置

### 7.5 codegen 触发时机

- 编辑时（reducer dispatch 任何 action）→ **不立即** codegen（避免 N 次字符串拼接浪费）
- 保存时 codegen → 持久化 .tr
- 点"预览代码"按钮 → 立即 codegen 显示
- codegen 内部顺便跑 5.5 校验，错误阻止保存

### 7.6 编辑器与运行视图合一

不做两个独立组件——同一个 `TrackCanvas` 既是编辑器又是运行视图：

- 运行中（`useTrackState.running === true`）：节点形状不变，添加 `running/completed/failed` 状态边框；右侧抽屉切到"变量面板"模式
- 运行结束：状态保留，可点节点看 vars 快照
- 用户编辑节点图 → 状态全部 reset

## 8. 后端运行可视化机制

### 8.1 设计目标

让前端在每个节点边界收到事件：
- `track_node_active` `{ runId, nid }` —— 该节点开始执行
- `track_node_completed` `{ runId, nid, vars }` —— 该节点完成，新增/改动变量快照
- `track_node_failed` `{ runId, nid, error }` —— 该节点 throw 异常
- `track_node_skipped` `{ runId, nid }` —— if/for 没走到的分支

### 8.2 实现路径：train-lang 加 statement trace hook + ccweb wire

**train-lang 项目侧（独立仓库，需要发 0.2.0）：**
- `lexer`：保留 `// @@nid: n_xx` 这种特殊 comment 作为 `TrailingNidComment` token（不丢弃）
- `parser`：把 `TrailingNidComment` 关联到下一个 statement 节点的 `leadingNid` 字段
- `interpreter`：在每个 statement 执行前后触发 trace hook：
  ```ts
  type TraceHook = {
    onStatementEnter(ev: { nid?: string; scopeBefore: ReadonlyScope }): void
    onStatementExit(ev: { nid?: string; scopeAfter: ReadonlyScope; scopeBefore: ReadonlyScope }): void
    onStatementError(ev: { nid?: string; error: Error }): void
    onBlockSkipped(ev: { nid?: string }): void
  }
  ```
- `runFile` opts 加 `traceHook?: TraceHook`
- nid 为空时（手写 .tr / 测试代码）trace hook 仍触发但 nid undefined，ccweb 侧忽略

**ccweb 侧（backend）：**
- `track-runner.ts` 在 `train.runFile` 调用时传入 traceHook
- `onStatementEnter` → diff scope —— 此时 scope 还未变 —— 仅 emit `track_node_active`
- `onStatementExit` → diff(scopeAfter, scopeBefore) → emit `track_node_completed` with vars
- `onStatementError` → emit `track_node_failed`
- `onBlockSkipped` → emit `track_node_skipped`（递归 emit 该分支内所有节点的 skipped）
- 事件经 `broadcast` 函数发到 WS（与现有 track_status_change 一样）

**ccweb 前端：**
- `useTrackState.ts` 扩展 case 处理新事件
- 节点 RuntimeState Map 按 nid 更新

### 8.3 scope diff 算法

`scopeAfter` 与 `scopeBefore` 比对：
- 新增的 key → 进 vars
- 值变化的 key → 进 vars
- 删除的 key（理论上 train-lang let 不会删变量）→ 忽略
- 控制大对象/数组的 snapshot 大小：top-level scalar 全发；object/array 单个值的 `JSON.stringify(value).length` 超过 4096（字符数，约 4 KiB）时只发 `{ __truncated: true, kind: 'object' | 'array', size: <实际字节数> }` 提示前端。用户在变量面板点"展开完整值"再触发 lazy fetch（Phase 2，本 spec 不实现 fetch endpoint，先展示截断版）

### 8.4 暂不做：变量面板的"连线动画"

第 4 节抽屉确认了"变量面板"模式，但"连线动画"在嵌套块路径下没有连线（没 SVG edge），所以这个 UX 自然降级为"节点 vars 抽屉 + 节点状态边框动画"。spec 接受此降级。

## 9. 里程碑切片

| Milestone | 范围 | 工程量预估 |
|---|---|---|
| **M1：节点图编辑器骨架** | palette + 拖拽 + ask_user/fai/let/return 节点 + 表单抽屉 + codegen 单向 + 预览代码 + 保存（无 if/for，无运行可视化） | 1.5-2 周 |
| **M2：嵌套容器** | if / for 节点 + 三格拼装器 + 条件 ConditionList + 嵌套渲染 + 校验 scope | 1 周 |
| **M3：train-lang trace hook** | train-lang 加 lexer / parser / interpreter trace hook → 发 train-core 0.2.0 → ccweb vendor 升级 + wire 起来 | 1 周（train-lang 侧 + ccweb 侧合计） |
| **M4：运行可视化** | 节点状态边框（running/completed/failed/skipped）+ 变量面板抽屉 + WS 事件订阅 + scope diff snapshot | 1 周 |

**总约 4-5 周**。每个 milestone 内部需要：
- 单独发 ccweb 版本（feature-flagged 默认关闭，避免影响生产）
- M1/M2 verify-* 测试加节点图 codegen 单元测试
- M3 需要 train-lang 项目侧的独立发版流程

## 10. 测试策略

- **codegen 单元测试**（`codegen.test.ts`）：每种节点类型 → 预期 .tr；shape dedupe 用例；@ 变量引用 → ${} 插值；校验路径
- **节点图 reducer 测试**：add/remove/move/duplicate/update 各种嵌套场景
- **拖拽 E2E**（Playwright）：从 palette 拖 ask_user/fai/return → 保存 → 验证 .tr parse + 用 mock injector 跑通
- **运行可视化 E2E**：节点图建一个含 if 的工作轨 → 运行 → 验证收到 active/completed/skipped 事件 + 前端节点 RuntimeState 正确
- **回归**：`verify-track-t1` / `verify-track` / `verify-starter-templates` / `verify-track-cancel` 全部保持绿
- **train-lang trace hook 测试**（M3）：train-lang 项目侧加 `lexer-nid-comment.test.ts` / `parser-attach-nid.test.ts` / `interpreter-trace-hook.test.ts`

## 11. 开放问题 / 风险

| # | 项 | 风险等级 | 缓解 |
|---|---|---|---|
| 1 | M3 train-lang 需要发 0.2.0，breaking 风险（其他 train-lang 消费者尚无） | 低 | 加 hook 是非破坏增量，ccweb 是唯一消费者 |
| 2 | scope diff 在大对象上的 snapshot 大小（4KB 截断阈值） | 中 | M4 实测调阈值；前端"展开完整变量"按钮可触发 lazy fetch |
| 3 | 嵌套深度过深时 NodeBlock 递归渲染性能 | 低 | Phase 1 不优化；React.memo NodeBlock；用户极端嵌套时先提示"嵌套过深，建议拆分" |
| 4 | 已保存 .tr 用户手改了首行 marker / 节点 codegen 注释（破坏 nid 映射） | 低 | 节点图模式打开时检测 nid 注释完整性，缺失则提示"已被外部编辑，请切代码视图" |
| 5 | "外部 CLI（claude/codex）"的 fai 注入在节点图模式下不变（同走 CcwebTrainAdapter），但 fai prompt 模板里的 @ 引用必须 codegen 成 train-lang 字符串插值才会被注入 | 中 | codegen 单元测试覆盖 + verify-track 加端到端用例 |

## 12. 后续阶段（不在本 spec 范围）

- Phase 2：layout 持久化（sidecar JSON）
- Phase 2：fai 节点跨工作轨复用（"fai 库" / SkillHub 集成）
- Phase 3：try/catch / while / break / continue 节点
- Phase 3：节点图的 import / export 给 SkillHub 分享
- Phase 4：移动端触屏拖拽手势优化
