---
date: 2026-05-17
status: design-approved-pending-spec-review
owner: zhang
supersedes: 2026-05-16-visual-track-builder-design.md
---

# Visual Track Builder v2（ReactFlow 节点图）设计

## 1. 摘要

为工作轨提供 **ReactFlow 风格的可视化编辑器 v2**：节点可自由拖动坐标、用箭头连线表达执行顺序、用 frame 容器表达 if/for 嵌套结构。完全替换 M1 嵌套块设计（`2026-05-16-visual-track-builder-design.md`，v-16-b → v-17-b），不做双系统并存。

核心心智模型变化：**节点是用户决定粒度的代码段**。一段不含 LLM/ask_user 的代码（不论几行）都可以是一个代码节点；LLM 和 ask_user 是天然的"可视化边界"——用户判断什么时候拆出独立节点，ccweb 不强制不阻止。

`.tr` 仍是 source of truth，单向 codegen；坐标 / edges / frame 等元数据存到 sidecar JSON。预估总工作量 6 周（M1-M5，含 v1 清理独立 milestone）。

## 2. 目标用户与心智模型

**目标用户**：稍懂 train-lang 基本语法（能写 `let x = ...` / 简单表达式）但不想全手撸 .tr 的人。

从 M1 spec 的"零代码可视化"调整为 **"低代码 + 关键边界可视化"**：

- 一段无 LLM/ask_user 的代码（含 if/for/while/let/纯函数调用）→ 任意行数，一个代码节点搞定
- 一个 if 任一支含 LLM/ask_user → 拆为分叉节点（IfFrame）
- 一个 for/while 循环体含 LLM/ask_user → 拆为循环节点（LoopFrame）
- 拆与不拆由用户判断，ccweb 不静态检查

**因此排除 M1 的设计：**

- 高度结构化的表单（`TripleSlot` 拼装器、@-chip 引用控件、ConditionList 多行 glue）—— 太重，写代码更快
- 节点固定 6 类锁死（ask_user/fai/let/if/for/return）—— 改为 6 类但 CodeNode 是通用容器，覆盖原 let/计算/条件/小循环
- 嵌套块 Scratch C-shape —— 改为 ReactFlow frame 容器
- 节点自动垂直堆叠 —— 改为自由坐标拖拽

**保留的约束**：

- 单向 `graph → .tr`，`.tr` 是 source of truth
- v2 模式与 Monaco 代码模式互不切换（双向 parse 仍是已知陷阱）
- 控制流 = 显式可视（用边/frame，不靠"位置"）
- 数据共享 = train-lang 全局 scope 隐式（变量名引用，沿用语言原生）

## 3. 不在范围（YAGNI）

- fai 节点跨工作轨复用 / fai 库 / SkillHub 集成
- Monaco LSP 深度集成（变量补全够用即可）
- 节点拖入 frame 的动画/磁吸效果
- 跨节点 copy/paste（M1 后再做）
- 触屏拖拽手势优化
- 反向：手写 .tr → graph 重 parse（违反单向红线）
- v1 节点图数据迁移工具（用户项目里几乎无 v1 生产数据）
- 任意 DAG（fan-in / fan-out 自由汇合）—— 顶层强制单进单出，分支只通过 frame 嵌套表达

**为何顶层禁 fan-out**（codex 审查 P2 后补充说明）：
- train-lang AST 是"语句序列 + 嵌套块"模型，不支持任意有向图。允许平铺 fan-out 后再汇合，会让 codegen 必须找"汇合点 / dominator"，对用户拖出的非法图（无汇合 / 死循环）只能反报错，体验差
- 顶层单链 + frame 嵌套足以表达 train-lang 所有控制流（if-else / for / while / loop），不丢表达力
- 演进条件：未来若 train-lang 支持并行执行（Promise.all 风格），可解除限制开放平铺 fan-out

## 4. 用户体验路径

### 4.1 五个核心动作

**A. 新建工作轨**
1. TracksListDialog 点"新建"
2. 弹"创建模式"对话框：`[节点图（v2）]` / `[写代码 .tr]` 两个大按钮
3. 选节点图 → 输入文件名 → 进入 TrackGraphEditor

**B. 编辑节点图**
- 左侧 NodePalette dock 固定 6 类节点（📝 代码 / 💬 问用户 / 🤖 AI 调用 / 🔀 如果 / 🔁 循环 / ⬅️ 返回）
- 从 palette 拖到画布生成节点（默认坐标在拖落点附近）
- 所有节点：顶部 default in port，底部 default out port（含 IfFrame / LoopFrame 外部接口）。frame 内部分支/循环结构通过子节点在 then/else/body slot 间用 default 边连接表达（不需要多 handle）
- 边创建两种方式：(1) 拖端口到端口（ReactFlow 标准）；(2) 选中节点 popover 点"添加下一个节点" → 自动落位 + 连边
- 双击节点 → 右侧 NodeInspector 抽屉滑出表单
- IfFrame / LoopFrame 是 ReactFlow group 节点，子节点拖入 frame 自动设 `parentId + parentSlot`；用 `extent: 'parent'` + `expandParent: true` 限制子节点不能拖出 frame 边界并自动撑开 frame

**B' UX 提示（CodeNode 内写 LLM/ask_user 调用时）：**
- CodeNode 内部允许用户写 `fai_xxx(...)` LLM 调用或 `__ccweb_ask_user(...)`，ccweb 不阻止
- 但运行时该 CodeNode 整体高亮，**内部 fai/ask_user 不会单独显示节点状态**——这是用户主动选择"代码节点粒度"的代价
- NodeInspector 在 CodeNode 选中时显示 hint："此节点内若含 LLM/ask_user 调用，建议拆为独立节点以获得更细粒度运行可视化"

**C. 实时预览 .tr 代码**
- 右上角"预览 .tr 代码"按钮 → 弹只读 Monaco viewer 显示 codegen 输出
- 关闭后继续编辑

**D. 保存 + 运行**
- 保存：codegen → 持久化 `.tr` + sidecar JSON
- 保存前校验：DAG 结构合规 + 变量 scope 引用可见性 lint
- 结构错（多入口 / 孤立节点 / frame 子图断链）→ 红边 + 保存禁用
- 节点内字段 lint（CodeNode parse error / 表达式语法）→ 黄色 lint **允许保存**
- 运行：`POST /tracks/run` 不变；后端在 statement 边界 emit `track_node_*` WS 事件
- 编辑器自动进入运行视图

**E. 跑完后**
- 节点保持终态颜色（绿 ✓ / 红 ✗ / 灰划线）
- 点节点 → NodeInspector 切到"变量面板"显示该节点产生的 vars JSON 快照
- 编辑节点图 → 所有运行状态 reset

### 4.2 与现有系统的边界

- TracksListDialog 新建按钮 → v2 模式对话框（去掉 M1 的三选）
- 工作轨列表图标：v2 节点图 .tr 显示 🕸️（与 v1 的 🧩 区分；v1 文件仍显示 🧩 但 hover tooltip 提示"旧版本，请用代码模式打开"）
- 打开 v2 marker `// @@ccweb-track-mode: graph v2` → 进 TrackGraphEditor
- 打开 v1 marker `// @@ccweb-track-mode: node-graph v1` → 提示"此节点图为旧版本，新编辑器不支持。可改为代码模式打开（只读 banner）"
- 打开无 marker 的纯 .tr → 照旧 Monaco
- 单向红线：v2 模式不允许切 Monaco 编辑；Monaco 模式不能切节点图

## 5. 架构

### 5.1 前端组件树

新建 `frontend/src/components/tracks/graph/`：

```
TrackGraphEditor                        // 顶层 Dialog 内部
├─ GraphToolbar                         // filename / save / run / stop / preview-code / 自动布局
├─ GraphCanvas                          // ReactFlow 容器，自由拖 / zoom / pan
│   ├─ CodeNode                         // Monaco 嵌入 train-lang 编辑器
│   ├─ AskUserNode                      // fields 表单卡片
│   ├─ FaiNode                          // prompt + inputs/outputs 表单卡片
│   ├─ IfFrameNode                      // frame + then/else 子区（ReactFlow group）
│   ├─ LoopFrameNode                    // frame + body 子区（for/while/loop 三态切换）
│   └─ ReturnNode                       // 表达式卡片
├─ NodePalette                          // 左侧 dock（6 类节点拖出生成）
├─ NodeInspector                        // 右侧抽屉（选中节点字段编辑 + 运行时变量面板）
└─ CodePreviewModal                     // 右上角"预览 .tr 代码"按钮触发
```

### 5.2 核心子模块

- `graph-types-v2.ts` —— TS 类型（NodeV2 / EdgeV2 / GraphV2）
- `codegen-v2.ts` —— 入口 + 每节点 render + fai shape dedupe + marker 注释拼接
- `topo-codegen.ts` —— DAG 拓扑遍历 + frame 子图递归（供 codegen-v2 调用）
- `reducer-v2.ts` —— useReducer 管理 nodes / edges / selection / dirty
- `scope-v2.ts` —— 计算每节点可见变量 scope（喂 Monaco autocomplete + 表达式 lint）
- `sidecar-io.ts` —— sidecar JSON 读写 + 与 .tr cross-check

### 5.3 新增 npm 依赖

- `reactflow` ~70KB gz（核心，节点编辑器）
- `dagre` ~12KB gz（自动布局算法，初始布局 + "重新整理"按钮）
- Monaco 已存在（self-host）+ `train-monaco-lang` 已存在（grammar），复用

### 5.4 后端

复用现有 `track-runner`。train-lang 0.2.0 升级后 `backend/vendor/@tom2012/train-core/dist/` 同步即可。

### 5.5 与 train-lang 的关系

`.tr` 仍是 source of truth。codegen 输出含 marker comment：
- CodeNode 首尾：`// @@ccweb-node-start: n_xx` / `// @@ccweb-node-end: n_xx`
- 其他节点首行：`// @@nid: n_xx`

train-lang 0.2.0 lexer 保留单行 comment 为 token，parser 关联到 statement.leadingComments，interpreter 在 statement 边界触发 trace hook。ccweb 后端从 leadingComments 推断"当前 statement 属于哪个节点"，把 statement 级事件聚合为节点级事件。

## 6. 数据模型 + 持久化

### 6.1 GraphV2 TS 类型

```ts
interface GraphV2 {
  version: 2
  trackName: string
  nodes: NodeV2[]
  edges: EdgeV2[]
}

interface NodeBase {
  id: string                            // n_xxxxxx, stable, codegen 用
  type: 'code' | 'ask_user' | 'fai' | 'if' | 'loop' | 'return'
  position: { x: number; y: number }    // 画布坐标
  parentId?: string                     // 属于某 frame 时填
  parentSlot?: 'then' | 'else' | 'body'
}

interface CodeNode extends NodeBase {
  type: 'code'
  code: string                          // 用户自由 train-lang 源码段
}

interface AskUserNode extends NodeBase {
  type: 'ask_user'
  outputVar: string
  fields: AskUserField[]                // 沿用 v1 schema
}

interface FaiNode extends NodeBase {
  type: 'fai'
  faiName: string
  outputVar: string
  inputs: { argName: string; argType: string; sourceExpr: string }[]
  outputs: { name: string; type: string; innerType?: string; constraints?: { min?: number; max?: number; maxLen?: number } }[]
  promptTemplate: string                // 纯字符串，用户写 ${var.path}
}

interface IfFrameNode extends NodeBase {
  type: 'if'
  conditionExpr: string                 // 用户写任意 train-lang 布尔表达式
}

interface LoopFrameNode extends NodeBase {
  type: 'loop'
  loopKind: 'for' | 'while' | 'loop'
  forSpec?: { iterVar: string; iterableExpr: string }
  whileSpec?: { conditionExpr: string }
}

interface ReturnNode extends NodeBase {
  type: 'return'
  valueExpr: string
}

interface EdgeV2 {
  id: string
  source: string                        // 起始 node id
  sourceHandle?: 'default'              // 当前仅 'default'；保留字段为未来 try/catch 等扩展
  target: string                        // 目标 node id（targetHandle 总是 default）
}
```

### 6.2 关键差异 vs v1 数据模型

- 引入 `position` 字段（必须持久化）
- 用 `parentId/parentSlot` 表达 frame containment（ReactFlow group 模式内置 ）
- 表达式从结构化 `TripleSlot/VarRef/Literal` 改为纯字符串（用户写 train-lang 表达式）
- `promptTemplate` 改纯字符串（带 `${var}` 用户自己写，不再 chip 化）
- 没有 `body: Node[]` 数组 —— 用 `edges` + `parentId` 表达执行顺序与嵌套

### 6.3 持久化形式

**`.tr` 文件**：codegen 输出的纯净 train-lang 代码 + marker comment（含每节点 `@@ccweb-node-start/end` 或 `@@nid`），无 GraphV2 metadata。

**sidecar JSON** `.ccweb/tracks/<basename>.tr.graph.json`：存 GraphV2 完整内容（version / trackName / nodes / edges），用 node id 与 .tr 的 marker 对齐。

**打开时 cross-check**：
- sidecar 所有 nodes[*].id 必须能在 .tr 的 marker 注释中找到
- 不匹配时降级为"代码模式只读 + banner 提示'sidecar 与 .tr 失同步'"
- 用户切到代码模式手改 .tr 删了某节点 marker → 重新打开节点图模式时检测失败

**优劣**：
- ✅ `.tr` 切到 Monaco 看到的是干净 train-lang 代码（无大段 JSON 注释）
- ✅ 改 metadata（坐标 / edges）不污染 .tr diff
- ⚠️ 两文件可能错位（用 cross-check 兜底）
- ⚠️ git 要追两个文件（一起 commit 即可）

## 7. 节点详细规范

### 7.1 📝 CodeNode（代码节点）

**字段**：`code: string`

**编辑形态**：
- 卡片内嵌 Monaco，语言 `train-lang`（train-monaco-lang grammar 已存在）
- 高度按内容自适应（min 80px，max 400px，超过滚动）
- **高度同步策略**（codex 审查 P0 后细化）：仅 onChange + updateNodeInternals 不够（折叠/字体切换/容器宽变化都不触发 change）。完整策略：
  - Monaco onDidContentSizeChange listener（专门为高度变化触发）→ debounce 100ms → `updateNodeInternals(nodeId)`
  - 外层 `<div>` 用 ResizeObserver 监控节点本身 size 变化 → 触发 `updateNodeInternals`
  - 字体/主题切换时 Editor remount 后强制 `updateNodeInternals` 一次
- Parse error → Monaco 红波浪 + 节点边框黄 lint（允许保存）
- Autocomplete：scope-v2 计算上游节点声明的变量名，注入 Monaco completionProvider

**Codegen**：
```
// @@ccweb-node-start: n_xxx
${node.code}
// @@ccweb-node-end: n_xxx
```

**视觉**：单纯灰色边框；展开态显示首行代码 + "..."（节点折叠时）。

### 7.2 💬 AskUserNode

**字段**：`outputVar`、`fields[]`（key / label / type / variants? / required?）

**编辑形态**：
- 折叠态显示 `outputVar ← { field1, field2, ... }`
- 展开态 NodeInspector 编辑字段表
- IdentifierInput 校验 outputVar / fields[*].key

**Codegen**：
```
// @@nid: n_xx
let ${outputVar} = __ccweb_ask_user({ fields: [...] })
```

### 7.3 🤖 FaiNode

**字段**：`faiName` / `outputVar` / `inputs[]` / `outputs[]` / `promptTemplate`

**关键差异 vs v1**：
- `inputs[*].sourceExpr` 是**纯字符串**（用户写 train-lang 表达式，比如 `r.rating` / `input.lang.toLower()` / `"literal"`），不再 chip
- `promptTemplate` 是**纯字符串**带 `${var}` 插值，用户自己写（不再 PromptSegment 数组）
- scope-v2 在表达式输入框旁挂 lint（黄色 underline 引用未声明变量）

**Codegen**：
- 顶部 fai 声明聚集（v1 shape dedupe 算法保留：同 shape merge，name 冲突 `_2/_3`）
- 调用点：
  ```
  // @@nid: n_xx
  let ${outputVar} = ${declName}(${arg1}, ${arg2}, ..., "${promptTemplate}")
  ```
- `prompt: prompt` 形参（v-17-b 教训 #2 固化）继续自动追加

### 7.4 🔀 IfFrameNode

**字段**：`conditionExpr`（纯字符串布尔表达式）

**编辑形态**：
- ReactFlow group 节点（虚线边框矩形，最小 width 400px / height 240px）
- 顶部一行 `if (conditionExpr)` —— 输入框内联编辑
- 内部分两个 slot 区：上半 `then`（背景浅蓝）；下半 `else`（背景浅红）；slot 间用一道分隔线视觉区分，分隔线位置 y = frame.height * 0.5
- 拖子节点入 frame 时 ReactFlow 按子节点中心 y 坐标判定落在 then 还是 else slot，设 `parentId = if-node-id, parentSlot = 'then' | 'else'`
- else 可隐藏/显示（toolbar 按钮）；隐藏时 codegen 不出 else 块
- frame 外部接口：顶部 default in port + 底部 default out port（仅这两个 port，frame 内部分支收敛由 codegen 反推；下游节点接 frame 的 default out 即可）
- **ReactFlow 配置**（codex 审查 P0 后细化）：
  - 子节点 `extent: 'parent'` —— 限制子节点不能拖出 frame 边界
  - 子节点 `expandParent: true` —— 子节点向 frame 边界外拖时 frame 自动撑开
  - frame 节点 `style: { width: 'auto', height: 'auto', minWidth: 400, minHeight: 240 }` + 通过 measured 字段拿到实际尺寸
  - 子节点 reparent 时（拖出 frame 或换 slot）调 `reactFlowInstance.updateNode(childId, { parentId, parentSlot })` 同步

**Codegen**：
```
// @@nid: n_xx
if (${conditionExpr}) {
  ${codegen of then-slot subgraph}
} else {
  ${codegen of else-slot subgraph}
}
```

**子图 codegen**：递归调 codegen-v2，把 then/else slot 内的节点 + edges 当成独立子图处理（入口节点 = parentSlot 匹配且无 incoming-from-same-slot edge 的节点）。

### 7.5 🔁 LoopFrameNode

**字段**：`loopKind: 'for' | 'while' | 'loop'`；按 kind 一组：
- for: `forSpec.iterVar` / `forSpec.iterableExpr`
- while: `whileSpec.conditionExpr`
- loop: 无（train-lang 的 `loop {}` until break）

**编辑形态**：
- 同 IfFrame 的 group 节点（含 `extent: 'parent'` + `expandParent: true` + auto width/height）
- 顶部一行 `for x in arr` / `while cond` / `loop`（toolbar 切换 kind）
- 内部单个 body slot（背景浅绿）；最小 width 400px / height 200px
- 子节点 `parentSlot: 'body'`（自动，无须 y 判定）
- frame 外部接口：顶部 default in port + 底部 default out port（after-loop 含义体现在 codegen 嵌套结构而非额外 handle）

**Codegen**：
```
// @@nid: n_xx
for ${iterVar} in ${iterableExpr} {
  ${codegen of body-slot subgraph}
}
```

### 7.6 ⬅️ ReturnNode

**字段**：`valueExpr`（纯字符串表达式）

**Codegen**：
```
// @@nid: n_xx
return ${valueExpr}
```

**约束**：顶层只能有一个 return 节点；M2 可在 IfFrame/LoopFrame 子图内多 return。

### 7.7 节点 ID 生成

所有节点创建时分配 `n_<6 chars from crypto.randomUUID>`（已有 v1 polyfill 处理 LAN HTTP 非 secure context），永不变。

## 8. Codegen 规则

### 8.1 .tr 文件结构

```
// @@ccweb-track-mode: graph v2
// 此文件由节点图编辑器生成；手改可能与 layout 元数据失同步。

<fai 声明 dedupe 段，按 v1 shape 算法>

func main() -> any {
  <按拓扑序展开的节点 codegen，每节点首行贴 marker comment>
}
export main
```

### 8.2 拓扑算法（control-flow tree → linear AST）

**模型说明**（codex 审查 P1 后澄清）：顶层执行模型并非任意 DAG，而是"线性单链 + frame 嵌套子图"。每层（顶层 / frame slot 内）都是从单一入口节点沿 default out 边走到单一出口节点的链；分支/循环结构由 frame 节点本身递归表达，不由"平铺 fan-out"边表达。这与 §3 "顶层禁 fan-out" 一致。


```pseudo
codegenSubgraph(nodes, edges):
  topLevel = nodes where parentId == undefined  // 仅顶层（frame 内部走递归）
  entry = topLevel where no incoming edge
  if entry.length != 1: error "多入口或空 graph"

  visited = set()
  out = []
  current = entry[0]
  while current != null:
    out.append(renderNode(current))
    visited.add(current.id)
    next_edge = edges.find(e => e.source == current.id && e.sourceHandle == 'default')
    current = next_edge ? findNode(next_edge.target) : null

  if visited.size < topLevel.size: error "孤立节点"
  return out
```

### 8.3 frame 内部递归

```pseudo
renderIfFrame(node):
  thenSrc = codegenSubgraph(
    nodes filter parentId == node.id && parentSlot == 'then',
    edges within above scope
  )
  elseSrc = codegenSubgraph(
    nodes filter parentId == node.id && parentSlot == 'else',
    edges within above scope
  )
  if elseSlot 隐藏:
    return `// @@nid: ${node.id}\nif (${node.conditionExpr}) {\n${thenSrc}\n}`
  return `// @@nid: ${node.id}\nif (${node.conditionExpr}) {\n${thenSrc}\n} else {\n${elseSrc}\n}`
```

类似 `renderLoopFrame`。

### 8.4 保存前校验（structural errors，阻止保存）

- 顶层入口必须唯一（无入度的节点 = 入口；多入口 / 零入口报错）
- 每节点出入度合规：
  - CodeNode / AskUser / Fai：1 default in + 1 default out（顶层 entry 可 0 in；顶层尾节点可 0 out 但必须接 Return）
  - Return：1 default in + 0 out
  - IfFrame：节点本身 1 default in + 1 default out；frame 内 then slot 必须至少有 1 个子节点且子图自洽；else slot 可为空（隐藏 else）
  - LoopFrame：节点本身 1 default in + 1 default out；frame 内 body slot 必须有节点且子图自洽
- IfFrame/LoopFrame 内 slot 子图自洽（slot 内入口唯一 + 全联通 + 出口唯一 → 出口节点的 default out 为空表示 slot 终止）
- 节点 id 唯一（reducer 保证）
- sidecar JSON 与 .tr marker 对齐（保存时同时写两文件，原子保证）

### 8.5 保存前 lint（黄色，不阻止保存）

- CodeNode train-lang parse error
- IfFrame conditionExpr / LoopFrame iter expr / FaiNode sourceExpr / promptTemplate / ReturnNode valueExpr 的表达式语法错
- 变量引用未声明（scope-v2 反查）

### 8.6 fai shape dedupe（沿用 v1 算法）

- shape 键 = `{faiName, inputs.schema (argName + argType), outputs.schema, promptTemplate}`
- 同 shape 合并为一个 fai 声明 + 多个调用点
- 改任一字段 → shape 不再等价 → 独立声明
- faiName 冲突自动 `_2 / _3` 后缀
- `renderFaiDeclaration` 仍自动追加 `prompt: prompt` 形参（v-17-b 教训 #2 固化）

## 9. 运行时高亮 + train-lang 0.2.0 trace hook

### 9.1 train-lang 0.2.0 增量（独立仓库）

非破坏增量，ccweb 是唯一消费者。

**Lexer**：保留 `// ...` 单行 comment 作为 token（不丢弃，加入 token stream）。

**Parser**：statement 节点前所有 leading comments 关联到 `statement.leadingComments: string[]`（保留原文，不解析）。

**Interpreter**：每 statement 边界触发 trace hook：

```ts
type TraceHook = {
  onStatementEnter(ev: {
    leadingComments: string[]
    scopeBefore: ReadonlyScope
  }): void
  onStatementExit(ev: {
    leadingComments: string[]
    scopeBefore: ReadonlyScope
    scopeAfter: ReadonlyScope
  }): void
  onStatementError(ev: { leadingComments: string[]; error: Error }): void
  onBlockSkipped(ev: { leadingComments: string[] }): void
}
```

**runFile / runSource opts**：加 `traceHook?: TraceHook`。

**train-lang 测试增量**：`lexer-comment-token.test.ts`、`parser-leading-comments.test.ts`、`interpreter-trace-hook.test.ts`。

### 9.2 ccweb 后端聚合（track-runner.ts）

维护 `currentActiveNid` 指针 + `accumulatedVars` 缓存：

- `onStatementEnter`：扫 leadingComments：
  - 命中 `@@ccweb-node-start: n_xx` 或 `@@nid: n_xx`，且不同于 `currentActiveNid`：
    - emit `track_node_completed(currentActiveNid, accumulatedVars)`
    - emit `track_node_active(n_xx)`
    - 重置 `accumulatedVars = {}`，更新 `currentActiveNid = n_xx`
  - 命中 `@@ccweb-node-end: n_xx` 等于 currentActiveNid：标记 pending-complete（等下一 statement 切换或运行结束 emit）
  - 未命中 → stay
- `onStatementExit`：scope diff（沿用 v1 §8.3 算法，object/array 单值超 4096 chars JSON.stringify 时截断为 `{__truncated, kind, size}`）累积到 `accumulatedVars`
- `onStatementError`：emit `track_node_failed(currentActiveNid, error)`
- `onBlockSkipped`：从 leadingComments 找 nid → emit `track_node_skipped(nid)`（递归 skip 该 nid 子图所有节点）

**性能策略**（codex 审查 P1 后补充）：trace hook + 每 statement scope diff 常态开启在长脚本（特别是 for 循环跑 N 次）会产生 N × statement 数量级的事件，可能拖慢 WS 吞吐。策略：

- **节点级聚合**（默认）：WS 只发节点边界事件（active/completed/failed/skipped），不发 statement 级。CodeNode 内多 statement 不产生多事件
- **scope diff 上限**：单次 diff 字段数超 50 → 截断为 `{__diff_truncated: true, count}`；单次 diff 总字节数超 32 KiB → 截断
- **循环 iteration 节流**：LoopFrame 子图节点的 active/completed 事件，每秒同一 nid 最多发 10 次（10Hz UI 刷新足够，超频丢弃中间事件保最后一次）
- **采样开关**：track-runner.ts 加 `traceVerbose` flag（开发模式开 statement-level，生产默认仅节点级），用 ws `track_verbose_subscribe` 客户端按需打开

### 9.3 WS 事件 schema（新增）

- `track_node_active` `{ runId, nid }`
- `track_node_completed` `{ runId, nid, vars }`
- `track_node_failed` `{ runId, nid, error }`
- `track_node_skipped` `{ runId, nid }`

### 9.4 前端

- `useTrackState.ts` 扩展 case 处理上述 4 事件
- `nodeRuntime: Map<nid, { state: 'idle'|'running'|'completed'|'failed'|'skipped'; vars: Record<string,unknown>; error?: string }>`
- 节点边框按 state 渲染：
  - running：黄色 pulse 边框
  - completed：绿色边 + ✓ 角标
  - failed：红色边 + ✗ + tooltip error
  - skipped：灰色 + 划线
- NodeInspector 在运行模式切到"变量面板"：显示选中节点 accumulatedVars JSON（含 truncated 提示）

## 10. v1 废弃与兼容性

### 10.1 v1 代码删除

- 完全删除 `frontend/src/components/tracks/visual/` 整目录（~18 文件 + 4 verify 脚本 + forms/ 子目录）
- 删除 `frontend/src/components/tracks/TracksListDialog` 里 v1 节点图分支
- 删除 v1 verify 脚本 npm scripts（`package.json` 的 `verify:codegen` 等）

### 10.2 TracksListDialog "新建"对话框

- 去掉 v1 的"节点图（v1）/ 代码-basic / 代码-ask"三选
- 改为两选："节点图（v2）" / "写代码 .tr"

### 10.3 v1 .tr 文件兼容

- v1 marker `// @@ccweb-track-mode: node-graph v1`：识别后弹"此节点图为旧版本，新编辑器不支持，请改代码模式打开（只读 banner）"
- 代码模式打开 v1 文件：显示 banner "v1 节点图（已弃用），可手动编辑后保存为代码模式"
- 不做自动迁移工具（用户项目里几乎无 v1 生产数据，commit `1d91026` `88fc89c` `acf6456` `75ae992` 之后的 starter graph 测试 .tr 弃用）

### 10.4 工作轨列表图标

- v2 节点图 `.tr` 显示 🕸️
- v1 节点图 `.tr` 显示 🧩（hover tooltip "旧版本"）
- 纯 .tr（无 marker）：无图标
- 后端 list 端点的 mode 字段优化（避免前端 N+1 fetch 判断 marker）不在本 spec 范围，留到独立 backend 优化

## 11. 错误处理与校验

### 11.1 编辑期 lint（实时显示）

- CodeNode：Monaco parse error → 红波浪
- 表达式字段（IfFrame conditionExpr / LoopFrame iter expr / FaiNode sourceExpr / promptTemplate / ReturnNode valueExpr）：parse error → 黄色 underline
- 变量引用未声明：scope-v2 反查 → 黄色 underline

### 11.2 结构校验（保存时阻止）

§8.4 详述：多入口 / 孤立节点 / 出入度不合规 / frame 子图非自洽 → 红边 + 保存按钮 disabled。

### 11.3 运行时错误

- `track_node_failed` 收到时节点红边 + ✗ + tooltip error message
- NodeInspector 抽屉切换错误详情面板（栈跟踪 / 失败 statement 源码定位）
- 运行结束（全图状态稳定）后用户可点节点继续看 vars

### 11.4 sidecar 与 .tr 失同步

- 打开 v2 .tr 时同时读 sidecar JSON
- cross-check：sidecar `nodes[*].id` 必须能在 .tr marker 中找到匹配（`@@ccweb-node-start: <id>` 或 `@@nid: <id>`）
- 不匹配时弹**恢复对话框**（codex 审查 P1 后扩充，提供三条路径）：
  1. **重建 sidecar**（推荐）：忽略损坏的 sidecar，从 .tr marker 反推一个最小可用 sidecar（节点位置走 dagre 自动布局，edges 按 nid 在 .tr 中出现的顺序串成单链）。用户可立即编辑保存
  2. **忽略 sidecar 强制打开图（只读）**：用 .tr 反推图但禁止保存（避免覆盖损坏的 sidecar，让用户能先看到图判断如何处理）
  3. **改代码模式打开**：放弃节点图视图，直接 Monaco 编辑 .tr
- 保存时**原子写两文件**：先写 sidecar tmp → 写 .tr tmp → rename .tr → rename sidecar。任一步失败 unlink 两个 tmp 文件。这保证 .tr 与 sidecar 要么同时更新要么都不更新

## 12. 测试策略

### 12.1 单元测试

- `codegen-v2.test.ts`：6 类节点 codegen 单测；IfFrame/LoopFrame 嵌套 codegen；fai shape dedupe；非法图（多入口 / 孤立节点 / frame 断链）的错误信息
- `reducer-v2.test.ts`：add / remove / move / duplicate / connect-edge / disconnect-edge / parentId reassign / frame 内拖出
- `scope-v2.test.ts`：变量可见性（顶层 / frame 内 / for iter / 跨 frame）
- `topo-codegen.test.ts`：单进单出 / 顶层 frame 嵌套 / frame 内部子图

### 12.2 端到端 runtime smoke test

`verify-graph-v2.ts` ts-node 脚本（沿用 v-17-b 教训 #2 模式）：
- 构造 GraphV2 → codegen → `core.runSource` + inline mock fai adapter
- 必须 `ok=true`
- 覆盖：仅 CodeNode、含 ask_user、含 fai、含 IfFrame、含 LoopFrame、含 IfFrame 嵌套 LoopFrame

### 12.3 Playwright E2E

- 拖 4 节点（ask_user + Code + fai + return）+ 连边 + 保存
- 验证 .tr 内容含预期 marker 和源码
- 验证 sidecar JSON 结构
- 触发运行 → 验证节点高亮事件按预期到来

### 12.4 train-lang 0.2.0 测试

- `lexer-comment-token.test.ts`：单行 comment 不丢弃
- `parser-leading-comments.test.ts`：comment 关联到正确 statement
- `interpreter-trace-hook.test.ts`：enter/exit/error/skipped 触发时机与字段

### 12.5 回归

所有现有 `verify-track-*` / `verify-starter-templates` / `verify-track-cancel` 保持绿（v2 是独立子系统，不影响）。

## 13. 里程碑切片

| M | 范围 | 工程量预估 |
|---|---|---|
| **M1**：编辑器骨架 + 4 基础节点 | ReactFlow 画布 + 自由拖 + 边连接 + CodeNode/AskUserNode/FaiNode/ReturnNode + Monaco 嵌入 + sidecar + codegen + 保存 + 模式选择对话框改。**v1 暂不删，识别 v1 marker 走只读 banner 提示**（codex 审查补充建议后调整） | 2.5 周 |
| **M2**：嵌套 frame + 最小 history | IfFrameNode + LoopFrameNode（for/while/loop）+ parentId 嵌套 + frame 内子图 codegen + 表达式 lint + **最小 undo/redo（ctrl+z/y，仅图结构变化）**（codex 审查建议提前） | 1.5 周 |
| **M3**：train-lang 0.2.0 trace hook | train-lang lexer/parser/interpreter trace hook → 发 0.2.0 → ccweb vendor 升级 + WS 事件 wire + 前端节点高亮 + 性能策略（节流/聚合） | 1 周 |
| **M4**：变量面板 + 错误态 | NodeInspector 变量面板模式 + scope diff snapshot + 运行时错误详情面板 | 0.5 周 |
| **M5**：v1 清理 | M4 完成后用户验证 v2 稳定 → 删除 `frontend/src/components/tracks/visual/` + v1 verify 脚本 + TracksListDialog v1 分支 | 0.5 周 |

**总约 6 周**（codex 审查 M1 偏乐观 + 提前引入 history + 推迟 v1 删除作为独立 milestone 后调整）。每 milestone 内：
- 单独发 ccweb 版本（v-18-a / -b / -c / -d / -e）
- M1/M2 verify-graph-v2 加 codegen 单测
- M3 需 train-lang 项目侧独立发版（0.2.0）
- M4 可与 M3 部分并行

## 14. 风险与开放问题

| # | 项 | 风险 | 缓解 |
|---|---|---|---|
| 1 | ReactFlow ~70KB + dagre ~12KB + Monaco 多实例 | 中 | TrackGraphEditor 走 React.lazy + Suspense；Monaco 复用 ProjectPage 单例 |
| 2 | DAG codegen 顶层禁止任意分叉，只通过 frame 嵌套表达分支 | 中 | M1 文档明示；用户造平铺 if 时校验报错引导用 IfFrame |
| 3 | CodeNode Monaco 高度变化时 ReactFlow 不知道 | 中 | onDidContentSizeChange + ResizeObserver + theme remount 三层兜底（§7.1 详） |
| 4 | sidecar JSON 与 .tr 失同步 | 中 | cross-check + 三选恢复对话框（重建 / 只读图 / 代码模式）；保存原子写两文件 |
| 5 | train-lang 0.2.0 breaking 风险 | 低 | 非破坏增量；ccweb 唯一消费者；M3 前先发 0.2.0-rc 试 |
| 6 | 顶层 entry 不唯一时用户困惑 | 低 | entry 视觉 ▶ 标记；多 entry 时高亮所有候选 + 引导选主入口 |
| 7 | CodeNode 内用户主动写 fai/ask_user 调用时 nid 边界 | 低 | CodeNode 整体共一个 nid；运行时整体高亮；§4.1 B' 段提示用户拆细粒度 |
| 8 | M1 期间 v1 用户在升级版本后无法打开 v1 节点图 | 低 | M5 才删 v1 代码；M1-M4 期间 v1 仍可用（只读 banner） |
| 9 | trace hook + scope diff 性能（长脚本 / 循环爆事件） | 中 | §9.2 性能策略：节点级聚合默认、scope diff 字段/字节双上限、LoopFrame 10Hz 节流、采样开关 |
| 10 | undo/redo 缺失导致拖错恢复成本高 | 中 | M2 引入最小 history（图结构变化 ctrl+z/y）；Phase 4 做完整 history |

## 15. 后续阶段（不在本 spec 范围）

- Phase 2：fai 节点跨工作轨复用 / fai 库 / SkillHub 集成
- Phase 2：CodeNode 内嵌 train-monaco-lang 的 LSP 深度（hover 显示变量类型）
- Phase 2：跨节点 copy / paste（含 sidecar 元数据片段）
- Phase 3：节点图 v2 export → SkillHub 分享（含 sidecar）
- Phase 3：try/catch 节点（train-lang 支持但教育成本高）
- Phase 4：触屏拖拽手势优化（手机/平板）
- Phase 4：完整 undo/redo（含字段编辑细粒度历史；M2 已做图结构变化的最小版本）
