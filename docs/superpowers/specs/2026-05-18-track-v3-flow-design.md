---
date: 2026-05-18
status: design-approved-pending-spec-review
owner: zhang
supersedes:
  - 2026-05-16-visual-track-builder-design.md (v1 嵌套块)
  - 2026-05-17-visual-track-builder-reactflow-design.md (v2 ReactFlow + train-lang codegen)
---

# Track Flow Engine v3（agentic workflow）设计

## 1. 摘要

完全重写工作轨子系统为 **agentic workflow 引擎**。**抛弃 train-lang DSL**，ccweb 自己实现 state-machine runtime；保留 train-adapter 协议（claude-code / codex / qwen / gemini 进程包装）和 workflow_data.json 约定（=train.json）。

目标用户从"程序员视角"切到"工作流编排者视角"：节点 = 单动作（用户输入 / LLM 调用 / 逻辑判断），变量 = 全局扁平 train.json 字典，Prompt = 用户写占位符 + 系统自动转译注入"含义+当前值+回写指令"。

不与 v1/v2 数据兼容——所有现有 `.tr` 文件标记"已弃用"。v3 用新格式 `.flow`（JSON）。

预估 6 周（M0-M4）。

## 2. 背景与动机

### 2.1 v1（嵌套块）与 v2（ReactFlow + train-lang codegen）的根本错配

v1 嵌套块设计目标"零代码可视化"，被用户实测后明确不能拖、没箭头线、不是树状。
v2 切到 ReactFlow + 自由坐标，但仍把节点图 codegen 到 train-lang `.tr`——意味着：

- 节点 = 用户决定粒度的代码段 ➜ **程序员视角**，要写 train-lang 表达式
- 变量 = train-lang scope（let X = ...） ➜ **scope-managed**，不直观
- Prompt = 用户写 `${var}` ➜ **用户手撸**，没有"系统帮你组装含义+当前值+回写指令"
- 控制流 = train-lang `if/for` 嵌套 ➜ **结构化语言**，循环必须嵌套块表达
- 不支持节点跳转 ➜ train-lang 不是 goto-based

用户在描述具体工作轨时给出了完全不同的范式：

> 1. 用户输入定义 area
> 2. LLM 调研 → ref_fp
> 3. LLM 检查 → has_error
> 4. if has_error==true → 跳 #{3}; else → #{end}

这是 **state machine / agentic workflow 引擎**（LangGraph / N8N / BPMN 那一类），不是"代码生成 UI"。

### 2.2 train-lang DSL 不是合适的目标语言

- train-lang 是结构化语言（statement 序列 + 嵌套 if/for），不支持任意跳转
- "跳回之前节点 retry" 这种 pattern 必须用 `loop {} break` 模拟，反直觉
- 用户的"全局变量 train.json"心智 vs train-lang scope-managed `let` 心智不对齐
- Prompt 自动转译在 train-lang codegen 流程里加进去，会让 codegen 规则爆炸

结论：**节点图不应该 codegen 到 train-lang**。ccweb 自己实现工作流 runtime 更直接。

### 2.3 保留 train-adapter + workflow_data 的原因

`train-adapter-{claude-code, codex, qwen, gemini}` 是 ccweb 调真实 LLM CLI 的核心机制——把 prompt 喂进进程、设置 cwd、等待退出、读 workflow_data.json 回来。从零写这套 4 个 CLI 的进程协议封装是 2-3 周工程量，无意义重做。

workflow_data.json 已经是 train-adapter 协议里"LLM 调用间共享状态"的约定，**改名 train.json 即可作为 v3 的全局变量字典**。

### 2.4 v3 的核心创新

| 维度 | v2 | v3 |
|---|---|---|
| 节点本质 | 用户决定粒度的代码段 | 单动作（input / LLM / if），粒度固定 |
| 变量 | scope-managed train-lang let | 全局扁平 train.json |
| Prompt | 用户写 `${var}` | 用户写 `@{var}` `${var}` + 系统自动转译注入含义+当前值+回写指令 |
| 控制流 | train-lang `if/for` 嵌套 | 节点之间连边 + if 双出口 + 允许跳回循环 |
| 执行 | train-lang interpreter（vendor train-core） | ccweb 自己 state machine + train-adapter LLM 调用 |
| 文件格式 | `.tr`（train-lang 源码）+ sidecar JSON | `.flow`（纯 JSON） |
| LLM 回写 | train-adapter fai 调用约定 | LLM 直接 Edit/Write train.json（继续走 train-adapter） |

## 3. 目标用户与心智模型

**目标用户**：编排者（工作流设计者），不一定会写代码。理解"步骤""变量""条件分支"等概念即可。

**心智模型**：

- 每个**工作轨** = 一个**有向图**（含循环），从入口节点开始走，遇 if 分叉，跑到没有下游为止
- 每个**节点** = 一个**动作**（问用户 / 让 LLM 做某事 / 做逻辑判断）
- 每个**变量** = train.json 里的一个字段，全局共享，所有节点可读，输出节点可写
- **Prompt 模板**只是用户写的"想让 LLM 干什么"的自然语言，**含义+值+回写指令由系统自动加**
- **运行过程**像看一个流程图自动跑：当前节点高亮，每完成一节点点亮下一节点，到 if 时按条件走

## 4. 不在范围（YAGNI）

- 子流程/嵌套（节点本身是个子工作轨）——M2+ 看需求
- 并行分支（两个出口同时走 / 多源汇总 join）——M3+ 看需求。**M1 工作流必须可线性化**：调研类场景"多个 LLM 并行" 需在 M1 用顺序串联代替（如：节点 2 调研主题 A → 节点 3 调研主题 B → 节点 4 汇总）。这是已知 M1 局限
- 节点超时/重试 policy（除 if 跳回外）——M3+
- 等待外部事件（webhook / 定时器）——M3+
- 跨工作轨 train.json 共享（一个 train.json 多个 .flow 共用）——不在范围
- 反向：.tr → .flow 转换工具（违反单向红线 + 完全两种范式不互通）
- 与 v1/v2 数据兼容——M1 直接废弃所有 `.tr`
- "写代码 .tr"高级用户入口——已删
- ccweb 自己实现 train-lang interpreter / parser——完全抛 train-lang DSL
- 节点 monaco 嵌入（不需要，节点字段都是结构化表单 + prompt textarea）
- 节点图 v1/v2 显示在工作轨列表（直接隐藏 .tr 文件）

## 5. 数据模型

### 5.1 .flow 文件格式

**位置**：`.ccweb/tracks/<basename>.flow`（项目根的 `.ccweb/tracks/` 目录，跟 train.json 同目录）

**结构**：

```json
{
  "version": 3,
  "trackName": "research-loop",
  "adapter": "claude-code",
  "variables": [
    { "key": "area", "description": "研究领域", "initialValue": null },
    { "key": "ref_fp", "description": "文献存储 bibtex 格式文件的路径", "initialValue": null },
    { "key": "has_error", "description": "文献存在错误", "initialValue": null }
  ],
  "nodes": [
    {
      "id": "n_xxx1",
      "type": "user_input",
      "position": { "x": 100, "y": 50 },
      "fields": [
        { "varKey": "area", "uiHint": "text" }
      ]
    },
    {
      "id": "n_xxx2",
      "type": "llm",
      "position": { "x": 100, "y": 200 },
      "inputs": ["area"],
      "outputs": ["ref_fp"],
      "promptTemplate": "请调研@{area}的科研论文，结果填写到${ref_fp}中"
    },
    {
      "id": "n_xxx3",
      "type": "llm",
      "position": { "x": 100, "y": 400 },
      "inputs": ["area", "ref_fp"],
      "outputs": ["has_error"],
      "promptTemplate": "请检查@{ref_fp}中的论文，检查其准确性，以及其与@{area}的相关性，如果存在错误，请进行修正，并修改变量${has_error}为true，如果不存在错误，就修改变量${has_error}为false"
    },
    {
      "id": "n_xxx4",
      "type": "if",
      "position": { "x": 100, "y": 600 },
      "conditionExpr": "has_error == true"
    }
  ],
  "edges": [
    { "id": "e1", "source": "n_xxx1", "target": "n_xxx2" },
    { "id": "e2", "source": "n_xxx2", "target": "n_xxx3" },
    { "id": "e3", "source": "n_xxx3", "target": "n_xxx4" },
    { "id": "e4", "source": "n_xxx4", "sourceHandle": "true", "target": "n_xxx3" },
    { "id": "e5", "source": "n_xxx4", "sourceHandle": "false", "target": null, "endLabel": "end" }
  ]
}
```

**Edge.target = null** 表示流程结束（连到隐式 `end` 出口）。endLabel 仅是 UI 提示。

### 5.2 TS 类型

```ts
export interface VarDecl {
  key: string                      // 变量名（train.json 字段名，valid identifier）
  description: string              // 变量描述（含义，中文/任意自然语言）
  initialValue: unknown            // 变量值（可为空，默认 null；string/number/bool/array/object/null 均可）
}

export type NodeV3 = UserInputNode | LLMNode | IfNode

export interface NodeBase {
  id: string                       // n_xxxxxx
  type: 'user_input' | 'llm' | 'if'
  position: { x: number; y: number }
}

export interface UserInputNode extends NodeBase {
  type: 'user_input'
  fields: { varKey: string; uiHint?: 'text' | 'textarea' | 'number' | 'bool' | 'enum'; variants?: string[] }[]
}

export interface LLMNode extends NodeBase {
  type: 'llm'
  inputs: string[]                 // 已声明变量 key 列表（被 @{} 引用的）
  outputs: string[]                // 已声明变量 key 列表（被 ${} 引用的）
  promptTemplate: string           // 含 @{key} 和 ${key} 占位符
}

export interface IfNode extends NodeBase {
  type: 'if'
  conditionExpr: string            // 受限表达式（5.4）
}

export interface EdgeV3 {
  id: string
  source: string                   // 起始 node id
  sourceHandle?: 'default' | 'true' | 'false'   // if 节点有 'true'/'false'，其他只用 'default'
  target: string | null            // null 表示连到隐式 end
  endLabel?: string                // 当 target=null 时的 UI 标签
}

export interface FlowV3 {
  version: 3
  trackName: string
  adapter: 'claude-code' | 'codex' | 'qwen' | 'gemini'
  variables: VarDecl[]
  nodes: NodeV3[]
  edges: EdgeV3[]
}
```

### 5.3 train.json 结构

```json
{
  "area": "逆合成",
  "ref_fp": "./test.bibtex",
  "has_error": null
}
```

key 一一对应 .flow `variables[*].key`。每变量在执行开始时由 `initialValue` 写入；用户输入节点 / LLM 节点改写。

### 5.4 if 节点条件表达式语法（受限）

为避免任意代码执行，**condition 是受限表达式语言**，由 ccweb 自己 parse：

```
expr     := term (('&&'|'||') term)*
term     := atom (('=='|'!='|'>'|'<'|'>='|'<=') atom)?
atom     := varName | literal | '(' expr ')'
literal  := number | string | 'true' | 'false' | 'null'
varName  := [a-zA-Z_][a-zA-Z0-9_]*    // 必须在 variables[*].key 中
```

无函数调用、无 `+/-/*//` 算术（M1 不要），保证安全可解析。

**null 语义规则**（codex P0-3 修：变量默认 null + 用户例子 `has_error == true` 在 has_error=null 时也要可求值）：

- `x == null` / `null == x` / `x != null` / `null != x` → 合法，按 `===` 比较返 true/false
- `x == lit` / `lit == x`（lit 非 null）当 x 为 null 时 → 返 `false`（**不抛 error**）
- `x > y` / `x < y` 等关系算子当任一边为 null 时 → 返 `false`
- `null && x` → `false`；`null || x` → x 的值（短路时把 null 视为 falsy）
- 类型不匹配（如 `"abc" > 5`）→ 返 `false`（**不抛 error**，运行容错优先）

这套规则保证用户例子 `has_error == true` 在 has_error=null 时返 false（走 else 分支），不会让 M1 首日卡死。

## 6. 节点详细规范

### 6.1 📝 用户输入节点（user_input）

**字段**：`fields: { varKey, uiHint?, variants? }[]`，每项绑到一个**已声明的**变量（variables 表）。

**编辑形态**：
- 节点卡片显示所有绑定字段（变量 key + 描述 + uiHint）
- NodeInspector 抽屉里可加/删 field，选择 varKey（下拉菜单：variables 表中所有 key）

**运行时行为**：
1. ccweb backend 发 WS `flow_user_input_required { runId, nodeId, fields: [{varKey, description, uiHint, variants?}] }`
2. 前端弹"用户输入对话框"，列字段，等用户填
3. 用户提交 → 前端调 `POST /flow/<runId>/user_input { values }`
4. ccweb 把 values merge 进 train.json
5. WS 发 `flow_node_completed`，继续下游

### 6.2 🤖 LLM 调用节点（llm）

**字段**：
- `promptTemplate: string`（用户写的，含 `@{key}` / `${key}` 占位）

**inputs / outputs 不是用户单独维护的字段，而是从 promptTemplate 自动推导**（codex P0-4 修）：

- `inputs := { key | "@{key}" 在 promptTemplate 中出现 且 key ∈ variables[*].key }`
- `outputs := { key | "${key}" 在 promptTemplate 中出现 且 key ∈ variables[*].key }`

保存时推导一次缓存到 `.flow` 文件的 `nodes[].inputs/outputs`（供 runtime 直接用，不再从 promptTemplate 重新 parse）。这样 variables 表与 prompt 占位永远是单一来源，不存在失同步。

**编辑形态**：
- 节点卡片显示：自动推导的 inputs/outputs 列表 + promptTemplate 预览（前 40 字符）
- NodeInspector：
  - promptTemplate **智能补全 textarea**（详见 §6.5）—— 键入 `@` 或 `$` 触发下拉，选中变量自动补全为 `@{key}` / `${key}`
  - 引用未声明变量 → 黄色 lint + 提示 "变量 `xxx` 未在 variables 表声明，请先添加"
  - adapter 选择（继承工作轨默认或单节点 override）—— M1 仅工作轨默认，不支持 override

### 6.5 promptTemplate 智能补全控件（新增）

**触发字符**：

| 触发键 | 弹出内容 | 选中后插入 |
|---|---|---|
| `@` | variables 表所有 key（带描述提示） + "+ 新建变量" 选项 | `@{key}` + 光标移到 `}` 之后 |
| `$` | variables 表所有 key + "+ 新建变量" 选项 | `${key}` + 光标移到 `}` 之后 |
| `#` | M1 暂不实现（详见 §6.5.1） | — |

**下拉项渲染**：

```
@area      研究领域
@ref_fp    文献存储 bibtex 格式文件的路径
@has_error 文献存在错误
─────────
+ 新建变量
```

每行显示 `<触发符><key>` + `<description>`（灰色辅助文字，便于用户挑选）。

**键盘交互**：
- 上下方向键移动选择
- Enter / Tab → 应用补全
- Esc / 输入其他字符 → 关闭下拉，保留已输入的 `@` 字面
- 已输入部分字母 → 模糊过滤（如 `@ar` 过滤到 `area`）

**"+ 新建变量"**：
- 点击 → 弹出小 popover：变量名输入框 + 描述输入框 + 初始值输入框（可空）+ 确认按钮
- 确认 → variables 表追加新声明 + 补全 `@{newKey}` 到 textarea + 关闭 popover
- 这让用户在写 prompt 时可以即时声明新变量，不用切去 VariablesPanel

**鼠标交互**：下拉支持 click 选中。

**实现技术**：M1 用受控 `<textarea>` + 自定义 popover（不上 Monaco，textarea 已足够）。光标位置追踪用 `selectionStart`，下拉位置算 caret coordinates（用 mirror div 技巧）。

#### 6.5.1 `#` 触发字符（M1 不实现）

用户最初例子用 `#{3}` 引用节点编号。v3 §11.2 决定**跳转用边不用 `#{n}` 语法**，所以 prompt 模板里也没必要引用节点编号。

M1 范围：键入 `#` 不触发下拉，作为普通字符插入。

未来若 prompt 需要引用"另一个节点的输出快照"（如 "重做节点 X 的工作"），可在 Phase 2 加 `#` 触发，弹出节点列表。但目前所有节点输出已经进 variables 全局表，用 `@{key}` 即可，没有 `#` 的必要场景。

**Prompt 自动转译规则**：

设 train.json 当前快照为 `S`。对 promptTemplate 做替换：

- `@{key}` → `key(description)='S[key]'`
  例：`@{area}` → `area(研究领域)='逆合成'`
- `${key}` → `修改变量 key(description;记录路径为 train.json 中的 key:key)=S[key] 为...`
  例：`${has_error}` → `修改变量 has_error(文献存在错误;记录路径为 train.json 中的 key:has_error)=null 为...`

变量未初始化时 `S[key]` 显示为 `null`。

转译后的 prompt 末尾追加**系统指令段**：

```
【系统指令】
本工作轨的全局变量记录在当前目录的 train.json 文件中。
本节点完成时，请用 Edit/Write 工具修改 train.json 文件，
更新以下字段：has_error, ref_fp
（其他字段不要改）。完成修改后告知"已写入"。
```

**运行时行为**：
1. ccweb runtime 把 sidecar `<basename>.train.json` 复制到 CLI cwd 为 `train.json`（也兼容 `workflow_data.json` 别名）
2. fork train-adapter 进程（按 .flow `adapter` 字段），传入转译后 prompt
3. WS 发 `flow_node_active { runId, nodeId }`
4. 进程退出后 reload `train.json` → 与 snapshot diff → 检查 `outputs` 中每个字段是否被改了
5. **outputs 中任一字段未在 diff 中（值 === snapshot 前值）→ 节点 `failed`**（codex P0-1 修：不再仅 warning），emit `flow_node_failed { reason: "LLM 未按要求修改字段 X" }`
6. 全部 outputs 都修改了 → emit `flow_var_changed { runId, key, value }` + `flow_node_completed`
7. **回写 sidecar 前按 `variables[*].key` 白名单过滤**（codex P0-2 修）：LLM 修改了未声明字段 → 这些字段 **丢弃 + 警告 toast**，不污染 sidecar。runtime 仅保留声明字段。

### 6.3 🔀 逻辑判断节点（if）

**字段**：
- `conditionExpr: string`（按 5.4 受限语法）

**编辑形态**：
- 节点卡片显示条件 + true/false 两个底部端口
- NodeInspector：condition 输入框（带语法 lint）
- ReactFlow Handle: source `true` + source `false` + target `default`

**运行时行为**：
1. ccweb 用受限 expr parser 求值（5.4）
2. true → 走 sourceHandle='true' 的出边
3. false → 走 sourceHandle='false' 的出边
4. WS 发 `flow_node_completed { result: true/false }`

### 6.4 隐式 end 出口

不是节点，是 edge.target=null。任何节点（包括 if 的 true/false）连到 end → 流程结束，emit `flow_done`。

## 7. Prompt 自动转译规则（详细）

### 7.1 占位符

- `@{key}`：input reference（让 LLM 知道当前值）
- `${key}`：output reference（告诉 LLM 要回写）

key 必须在 `variables[*].key` 中存在。

转译时如果 key 不存在 → 编辑期 lint 黄色提示；运行期保留原 `@{key}` 字面不替换（让 LLM 看到也好排查）。

### 7.2 转译算法

```pseudo
translate(template, varMap, outputKeys):
  result = template
  result = replace(result, /@\{(\w+)\}/g, (match, key) ->
    if key in varMap:
      decl = varDecl(key)
      return `${key}(${decl.description})='${formatValue(varMap[key])}'`
    return match
  )
  result = replace(result, /\$\{(\w+)\}/g, (match, key) ->
    if key in varMap:
      decl = varDecl(key)
      return `修改变量 ${key}(${decl.description};记录路径为 train.json 中的 key:${key})=${formatValue(varMap[key])} 为...`
    return match
  )
  result += systemInstructionSegment(outputKeys)
  return result
```

`formatValue` 规则：
- null → `null`
- string → 转义引号
- number → 直接数字
- bool → `true` / `false`
- array/object → `JSON.stringify`

### 7.3 系统指令段（追加到 prompt 末尾）

```
【系统指令】
本工作轨的全局变量记录在当前目录的 train.json 文件中。
本节点完成时，请用 Edit/Write 工具修改 train.json 文件，
更新以下字段：<outputs join ", ">
（其他字段不要改）。完成修改后告知"已写入"。
```

如果 `outputs` 为空，系统指令段省略（纯"咨询"型 LLM 节点）。

## 8. train.json 持久化与同步

### 8.1 主权文件

**Sidecar 文件 `.ccweb/tracks/<basename>.train.json`** 是主权文件。

工作轨执行时：
1. Runtime 加载 sidecar 为内存 snapshot
2. 用户输入节点 / LLM 节点修改 snapshot
3. 每次修改后写回 sidecar（每节点完成时同步一次）

### 8.2 LLM 调用前后

**LLM 调用前**（**原子写**，codex P0-6 修）：
- Runtime 把 snapshot **原子复制**到项目根 `train.json`：先写 `train.json.tmp` → `fs.renameSync('train.json.tmp', 'train.json')`
- 为兼容老 adapter 也同样原子复制为 `workflow_data.json`

**LLM 调用中**：CLI（claude-code 等）用 Edit/Write tool 直接改 train.json。**Prompt 系统指令段会要求 LLM 用原子写法**（write to `train.json.tmp` then rename），减少半写文件风险。

**LLM 调用后**（**带稳定性等待**）：
- Runtime 进程退出 → 等待 200ms 让 OS flush buffer
- 尝试 `fs.readFileSync('train.json')` + `JSON.parse`
- 失败（半写文件 / 非法 JSON）→ 再等 500ms 重试一次
- 仍失败 → 节点 `failed`，emit `flow_node_failed { reason: "train.json 解析失败" }`，sidecar 保持 snapshot 不变
- 成功：
  - diff snapshot vs 新内容 → 验证 outputs 字段被改（§6.2 step 5）
  - **白名单过滤**（§6.2 step 7）：只保留 `variables[*].key` 中的字段
  - 把过滤后内容**原子写**回 sidecar（temp + rename）
  - 删除项目根 `train.json` 和 `workflow_data.json`（避免污染下次运行）

### 8.3 并发与一致性

- 同一工作轨同一时刻只能有一个 run（runtime 锁 + sidecar 文件锁）
- 用户在 run 进行中再点"运行" → backend 返 `409 Conflict { code: "FLOW_ALREADY_RUNNING", runId: <existing> }`（codex P2-1 修：明确错误码与拒绝行为，不抢占不排队）
- 前端收到 409 → 弹"该工作轨已在运行，runId=xxx，请先取消或等待结束"，可点跳到当前 run 视图
- 工作轨之间互不影响（每个工作轨独立 sidecar）

### 8.4 变量变更审计（codex 补充建议）

每个节点完成时，runtime 追加一行 JSONL 到 `.ccweb/tracks/<basename>.flow.runs/<runId>.log.jsonl`：

```json
{"ts": 1716042312345, "nodeId": "n_xxx3", "iter": 1, "varsDiff": [{"key":"has_error", "old": null, "new": true}], "type":"node_completed"}
```

事件类型包含 `node_active` / `node_completed` / `node_failed` / `user_input` / `cancelled` / `done`。

用于：
- 回放（M2+ "重播 run" 功能基于 log）
- 定位"LLM 乱写"现场（节点上 hover 显示该节点该次 iter 的 diff）
- E2E 测试断言（verify-flow-v3 可比 log 全文与期望快照）

## 9. Runtime 状态机

### 9.1 状态

```ts
interface FlowRuntimeState {
  runId: string
  flowFile: string                 // <basename>.flow
  flow: FlowV3                     // 加载的 flow
  trainJsonSnapshot: Record<string, unknown>
  currentNodeId: string | null
  iterCounts: Map<string, number>  // 每节点已执行次数，防死循环
  status: 'pending' | 'running' | 'waiting_user_input' | 'completed' | 'failed' | 'cancelled'
  error?: { nodeId: string; message: string }
}
```

### 9.2 步进算法

```pseudo
start(flowFile):
  flow = loadFlow(flowFile)
  state.trainJsonSnapshot = loadSidecar() or initFromVarDecls(flow.variables)
  state.currentNodeId = findEntry(flow)
  state.status = 'running'

loop:
  if status != 'running': break
  node = flow.nodes.find(n => n.id == state.currentNodeId)
  if node == null:
    state.status = 'completed'
    emit flow_done
    break

  emit flow_node_active { nodeId: node.id }
  iterCount = state.iterCounts.get(node.id) + 1
  if iterCount > MAX_ITER_PER_NODE (默认 50):
    state.status = 'failed'
    state.error = { nodeId: node.id, message: 'max iter exceeded' }
    emit flow_node_failed
    break
  state.iterCounts.set(node.id, iterCount)

  result = await executeNode(node, state)
  // executeNode 分支:
  //   - user_input → emit flow_user_input_required, await /flow/<runId>/user_input
  //   - llm → 转译 prompt + train-adapter + reload train.json
  //   - if → eval conditionExpr → 返回 'true' 或 'false' 作为 sourceHandle

  emit flow_node_completed { nodeId: node.id, varsChanged: [...] }
  state.currentNodeId = pickNextNode(node, result.sourceHandle ?? 'default', flow.edges)

end loop
```

### 9.3 找入口节点

`entry = nodes.find(n => no edge has target = n.id)`

多入口 / 零入口 → 保存校验失败（结构错）。

### 9.4 pickNextNode

```pseudo
pickNextNode(node, sourceHandle, edges):
  for edge in edges:
    if edge.source == node.id and (edge.sourceHandle ?? 'default') == sourceHandle:
      return edge.target  // 可能 null (end)
  return null  // 当前节点无下游 = end
```

### 9.5 防死循环（三道硬约束，codex P1-2 修）

- 每节点最大执行次数 `MAX_ITER_PER_NODE = 50`（可在 .flow 顶层 override 为 `runtime.maxIterPerNode`）
- 整个 run 最大 LLM 调用次数 `MAX_LLM_CALLS = 100`（可 override 为 `runtime.maxLlmCalls`）
- 整个 run 最大运行时长 `MAX_RUN_DURATION_MS = 2 * 60 * 60 * 1000`（2 小时；可 override 为 `runtime.maxRunDurationMs`）
- 任一上限超过 → emit `flow_node_failed { reason: "exceeded ..." }` 状态 `failed`
- WS event 实时暴露剩余额度（如 `flow_node_active.payload` 加 `quota: { iterRemaining, llmCallsRemaining, durationRemainingMs }`）让前端可视化

### 9.6 daemon 重启时的 run 处理（codex P1-3 修）

M1 简化方案：

- runtime 不持久化 in-flight run 状态到磁盘（仅内存）
- daemon 重启检测：项目根 `train.json` / `workflow_data.json` 文件存在 → 视为"上次 run 异常中断"，启动时清理（删除）+ 日志记录
- 前端 WS 重连后调 `GET /flows/runs/active` 列当前 running run → 空列表 → 前端把所有"前一会话以为 running 的"工作轨标 `failed`
- M1 不支持 run 恢复（**用户必须重新运行**），spec 明示这点

### 9.7 取消

POST `/flow/<runId>/cancel` → 设置 status='cancelled' + kill 当前 LLM 进程（若运行中） + emit `flow_cancelled`。

## 10. WS 事件 schema

新增（替换 v2 时代的 track_* 事件，不向后兼容）：

| Event | Payload | 时机 |
|---|---|---|
| `flow_started` | `{ runId, flowFile }` | run 开始 |
| `flow_node_active` | `{ runId, nodeId, iterCount }` | 节点开始执行 |
| `flow_node_completed` | `{ runId, nodeId, varsChanged: [{key, value}] }` | 节点完成 |
| `flow_node_failed` | `{ runId, nodeId, error }` | 节点错误（含 max iter） |
| `flow_var_changed` | `{ runId, key, value }` | 任意 sidecar 写时（也含 user_input） |
| `flow_user_input_required` | `{ runId, nodeId, fields: [{varKey, description, uiHint, variants?}] }` | user_input 节点 |
| `flow_done` | `{ runId, finalVars }` | 完成 |
| `flow_cancelled` | `{ runId }` | 取消 |
| `flow_error` | `{ runId, message }` | runtime 异常 |

## 11. 节点编号 + 跳转 + UI

### 11.1 拓扑编号（UI label）

编辑器把 nodes 按 BFS 从入口节点开始遍历，给每节点分配 displayIndex（1-based）。

- 节点左上角显示 `#1` / `#2` / `#3` ... 灰色小标
- 跳回循环（边连到 displayIndex 小于自己的节点）：边渲染为虚线 + "↻" 标记
- 多入口或孤立：左上角红色 `?` 标示问题，保存按钮 disabled

displayIndex 仅 UI 提示，不参与运行（运行用 nodeId）。

### 11.2 跳转 = 一条边

用户不用写 `#{3}`。在 if 节点的 true/false 端口拉一条边连到目标节点即可。系统：

- 自动判断"边的 target 在 source 之前（按拓扑序）" → 显示为循环
- 系统监测无限循环（直接 self-loop 而无 if 中间节点）→ 保存时报错引导加 if

### 11.3 隐式 end

if 节点的某出口（如 false）不连任何节点 = 连到 end。编辑器 UI 显示一个固定的 "end" 终止圆点（粘住画布右下角或随节点 layout），任何 dangling edge target=null 在 UI 渲染为连到 end 圆点。

## 12. 编辑器架构（前端）

### 12.1 新建目录 `frontend/src/components/tracks/flow/`

```
TrackFlowEditor                      // 顶层 Dialog
├─ FlowToolbar                       // filename / save / run / stop / variables panel toggle
├─ FlowCanvas                        // ReactFlow 容器
│   ├─ UserInputNodeView             // 用户输入卡片
│   ├─ LLMNodeView                   // LLM 调用卡片
│   ├─ IfNodeView                    // if 卡片，true/false 双底部端口
│   ├─ EndPort                       // 隐式 end 终止圆点
│   └─ DeletableEdge                 // 复用 v2 的删除边（hover ×）
├─ NodePalette                       // 左侧 dock，3 类节点拖出
├─ VariablesPanel                    // 左侧底部 / 浮动，列变量声明（key + 描述 + 初始值），可加/删/改
├─ NodeInspector                     // 右侧抽屉，编辑节点字段
│   └─ PromptTemplateEditor          // §6.5 智能补全 textarea（@/$ 触发下拉 + "+ 新建变量"）
├─ PromptPreviewPopover              // LLM 节点 hover prompt 预览（实时显示转译后内容）
└─ FlowRunPanel                      // 运行时面板（变量值实时刷新 / 节点状态 / 当前节点 / iter 计数）
```

### 12.2 核心子模块

- `flow-types-v3.ts` — TS 类型（FlowV3 / NodeV3 / EdgeV3 / VarDecl）
- `flow-reducer.ts` — useReducer (add/remove node/edge, declare/update/delete variable, etc.)
- `flow-codegen.ts` — Prompt 转译算法（§7）+ if 表达式 parse + 入口节点查找
- `flow-validator.ts` — 保存前结构校验（多入口/孤立/变量引用未声明）
- `flow-sidecar-io.ts` — .flow 文件读写 + train.json sidecar 同步
- `if-expr-parser.ts` — 受限表达式 parser (§5.4)
- `if-expr-evaluator.ts` — 受限表达式求值
- `PromptTemplateEditor.tsx` — 智能补全 textarea 控件（§6.5）+ caret coordinates 算法
- `prompt-placeholder-extractor.ts` — 从 promptTemplate 字符串提取 `@{key}` / `${key}` 出现的 key 列表（推 inputs/outputs）

### 12.3 后端架构

新建 `backend/src/flow/`：

```
backend/src/flow/
├─ runtime.ts                        // 状态机引擎（§9）
├─ runtime-registry.ts               // 多 run 注册表 + 锁
├─ prompt-translator.ts              // Prompt 转译算法 + 系统指令段
├─ if-expr-evaluator.ts              // 复用前端 receptive expr 求值（共享代码 via shared/）
├─ train-json-sync.ts                // train.json sidecar ↔ CLI cwd 同步
└─ llm-dispatcher.ts                 // 调 train-adapter 的薄封装（沿用现有 ccweb-train-adapter 模式）
```

路由扩展 `backend/src/routes/flow.ts`（**新文件**，独立于 `routes/tracks.ts`）：

- `GET /api/projects/:projectId/flows` — 列出 .flow 文件
- `POST /api/projects/:projectId/flows` — 创建空 .flow
- `GET /api/projects/:projectId/flows/file/:filename` — 读 .flow + train.json
- `PUT /api/projects/:projectId/flows/file/:filename` — 保存 .flow + train.json
- `DELETE /api/projects/:projectId/flows/file/:filename` — 删除 .flow + train.json
- `POST /api/projects/:projectId/flows/run` — 开始 run
- `POST /api/projects/:projectId/flows/:runId/user_input` — 提交用户输入
- `POST /api/projects/:projectId/flows/:runId/cancel` — 取消

WS 事件复用现有 project WebSocket pipeline，加 `flow_*` 事件类型。

## 13. v1/v2/.tr 废弃与清理

### 13.1 直接删除

- `frontend/src/components/tracks/visual/`（v1 嵌套块代码）
- `frontend/src/components/tracks/graph/`（v2 ReactFlow + train-lang codegen）
- `frontend/src/components/tracks/TrackEditor.tsx`（写代码 .tr 模式）
- `frontend/src/components/tracks/parse-train.ts` / `train-monaco-lang.ts`
- `backend/src/routes/tracks.ts`（保留但只暴露列文件 / 删除文件等管理端点；不再有 run/save .tr 端点。M1 简化：仅保留 GET / DELETE，没了 PUT/POST）

### 13.2 保留

- `backend/vendor/@tom2012/train-adapter-spec/` + 4 个 adapter
- `backend/src/tracks/ccweb-train-adapter.ts`（沿用 adapter 调用机制）
- `backend/src/tracks/ask-user-bridge.ts`（部分逻辑可借鉴到 flow runtime）

### 13.3 TracksListDialog 改造

完全重写为 `FlowsListDialog`：

- 列项目 `.ccweb/tracks/*.flow` 文件
- 一个"新建工作轨"按钮（不再有创建模式选择，因为只有一种模式）
- 不再显示 `.tr` 文件（即使存在）
- "已弃用"提示横幅：项目目录里若存在任何 `.tr` 文件，横幅 "您有 N 个旧版工作轨文件 (.tr)，已不再支持，请重新建立。" + 按钮"查看旧文件位置"

### 13.4 旧 .tr 清理（用户主动）

不自动删除（避免数据丢失），用户可手动从文件系统删除。

### 13.5 backend/vendor/@tom2012/train-core 处理

**删除**。train-core 是 train-lang 语言核心（lexer/parser/interpreter），v3 不再 codegen 也不再执行 .tr，删干净。

保留 `@tom2012/train-adapter-spec` 和 `@tom2012/train-adapter-{claude-code, codex, qwen, gemini}` 四个 adapter 包。

**删除前依赖检查**（codex P0-5 修）：M1 实施 plan 必须包含一个**前置检查步骤**：

```bash
grep -rn "from '@tom2012/train-core'\|require('@tom2012/train-core'\|require.*train-core" \
  backend/src \
  backend/vendor/@tom2012/train-adapter-* \
  | grep -v node_modules
```

预期：
- 在 backend/src 内只有要删的代码引用（visual/ + graph/ + track-runner / 等）→ 这些代码本来就要删
- 在 train-adapter-* 内**零引用**（adapter 包应只依赖 adapter-spec）
- 如果发现 adapter 包内有 train-core 依赖 → 加 spec PATCH：在删除 train-core 前先 vendored adapter 改为依赖 adapter-spec 重新发版

实施 plan 的 M1 第一步是跑这个 grep + 把结果写进 plan，再做删除。

## 14. 错误处理与校验

### 14.1 编辑期 lint

- 变量声明：key 必须 valid identifier（`/^[a-zA-Z_][a-zA-Z0-9_]*$/`），重名报错
- LLM 节点：promptTemplate 中 `@{key}` / `${key}` 引用 key 必须存在于 variables 表
- if 节点：conditionExpr 用 5.4 parser 校验，错误→黄 lint
- 节点出入度：if 节点必须有 true/false 两条出边（缺一报黄 lint 但允许保存）

### 14.2 结构校验（保存时阻止）

- 唯一入口（无入度的节点 = 入口）
- 所有节点可达入口（没有孤立子图）
- 变量声明无重名
- if 节点 conditionExpr 必须能 parse
- adapter 字段必须是 4 个合法值之一

### 14.3 运行时错误

- LLM 进程退出码 ≠ 0 → emit `flow_node_failed`，可重试（用户点重新运行）
- train.json 解析失败（LLM 写坏了）→ 节点 failed，提示 "LLM 修改 train.json 后内容不是有效 JSON"
- outputs 字段未被改 → warning toast，继续下游
- if 求值失败（变量未初始化为 null）→ failed
- 用户输入超时（M1 无超时）

## 15. 测试策略

### 15.1 前端单测

- `flow-codegen.test.ts`：prompt 转译 / @{} / ${} / 系统指令段拼接 / 未声明变量保留字面
- `flow-validator.test.ts`：多入口 / 孤立 / 重名变量 / 引用不存在
- `flow-reducer.test.ts`：add/remove/update 节点边变量
- `if-expr-parser.test.ts`：5.4 受限语法的合法 / 非法表达式
- `if-expr-evaluator.test.ts`：求值含 null / 类型不匹配 / 短路 (&&/||)
- `prompt-placeholder-extractor.test.ts`：从 promptTemplate 提取 @{key}/${key} 列表
- `PromptTemplateEditor.test.tsx`：键入 `@` 触发下拉 / 模糊过滤 / Enter 补全 / "+ 新建变量" 流程 / Esc 关闭 / `#` M1 不触发

### 15.2 backend 单测

- `prompt-translator.test.ts`：与前端 codegen.test 对齐 + 系统指令段
- `if-expr-evaluator.test.ts`：与前端共享同一受限 expr 引擎，单测覆盖
- `train-json-sync.test.ts`：sidecar ↔ cwd 复制 + 删除 + 错误恢复

### 15.3 E2E smoke

`verify-flow-v3.ts` tsx ESM-native：
- 构造 FlowV3（你给的 4 节点例子）
- mock train-adapter（用 inline mock 写 train.json 模拟 LLM 回写）
- 跑 runtime → 验证 train.json 最终状态 + 跳转路径
- 包 retry 循环 case：连续 2 次 has_error=true 再 has_error=false

### 15.4 浏览器手测 checklist

- 创建工作轨 → 拖 3 类节点 + 变量声明 + 连边 + if true/false
- 保存 → .flow 文件出现 + train.json 用初始值初始化
- 运行 → 用户输入对话框 → 填写 → LLM 进度 → 自动跳转 → end
- 取消 → 中断 LLM
- 跳回循环：构造 has_error toggle 测试 retry 上限

## 16. 里程碑切片

| M | 范围 | 估时 |
|---|---|---|
| **M0**：清理 + 删 train-core + adapter 依赖验证 | grep 依赖检查（§13.5）+ 删 visual/ + graph/ + TrackEditor / parse-train / train-monaco-lang / train-core vendor + backend tracks routes 简化 + TracksListDialog 临时占位 | 0.5 周 |
| **M1**：编辑器骨架 + 数据模型 + 保存 | flow-types-v3 / FlowsListDialog / TrackFlowEditor / FlowCanvas / 3 节点视图 / NodePalette / VariablesPanel / NodeInspector / flow-validator / flow-sidecar-io / backend GET/PUT/POST/DELETE /flow 端点 | 2 周 |
| **M2a**：Runtime 核心 + LLM 集成 + 原子写 | flow runtime state machine / train-json-sync（原子写 + flush 等待） / llm-dispatcher / 节点失败语义（outputs 未改 → failed） / 白名单过滤 / WS 事件 | 1.5 周 |
| **M2b**：Prompt 转译 + if 引擎 + 三道防线 | prompt-translator / if-expr-parser/evaluator（含 null 语义） / iter / llm calls / duration 三道防线 / 变量变更审计 log / daemon 重启清理 | 1 周 |
| **M3**：用户输入对话框 + 运行可视化 | flow_user_input_required 处理 / 节点状态边框（黄 pulse / 绿 ✓ / 红 ✗）/ 变量面板实时刷新 / 跳回循环可视化 / 409 冲突处理 | 0.5 周 |
| **M4**：verify-flow-v3 E2E + 浏览器手测 + 发版 | E2E smoke（含 retry 循环 case）+ 文档 + bump + publish | 0.5 周 |

**总约 6 周**（codex P1-4 修：原 4.5 周对 M2 过乐观；增加 M0 + 拆 M2 为 M2a/M2b 让 runtime 核心与 prompt/if 分离交付）。每 M 内：
- 独立发 ccweb 版本（v-19-a / -b / -c / -d / -e / -f）
- M1/M2 verify-flow-v3 加单测
- M4 含 E2E + 浏览器手测

## 17. 风险与开放问题

| # | 项 | 风险 | 缓解 |
|---|---|---|---|
| 1 | LLM 写 train.json 时写坏 JSON 格式 / 半写文件 | 中 | §8.2 原子写策略：tmp+rename + 200ms/500ms 两次等待 + 失败节点 failed（不污染 sidecar） |
| 2 | LLM 不按 outputs 回写（漏字段或回写无关字段） | 中 | §6.2 step 5：outputs 任一未改 → 节点 failed；§6.2 step 7：白名单过滤回写时未声明字段丢弃 |
| 3 | 跳回循环 50 上限不够（科研场景可能要 100+ 次重试） | 低 | §9.5 三道防线含 .flow 顶层 override；额度通过 WS 暴露 |
| 4 | 受限 if expr parser 太弱（用户想用 array.length 等） | 中 | M1 仅 `==/!=/>/<` + 字面量 + null 安全语义；M2+ 加 `.length` / 简单字段访问 |
| 5 | train.json 在 CLI cwd 与 sidecar 双副本可能冲突 | 中 | §8.2 严格生命周期（原子写复制 → LLM 调用 → 等待+reload+白名单 → 删 cwd 副本） |
| 6 | adapter 字段 hard-code 4 选 1，未来加 adapter 要 redeploy | 低 | adapter spec 是 string，前端列表硬编码；后端按 spec 注册 |
| 7 | 同一工作轨同一时刻只能一个 run | 低 | §8.3 锁 + 409 错误码 + 跳到 active run 视图 |
| 8 | 删除 train-core 影响现存代码编译 | 中 | §13.5 删除前 grep 依赖检查 + M0 milestone 专门处理 |
| 9 | 拓扑序在含环图里不唯一，UI 显示 displayIndex 可能不稳定 | 低 | BFS 入口节点开始 + 按 edge 添加顺序破并列，稳定算法 |
| 10 | 用户输入节点字段绑同一变量给多次输入 → 后者覆盖前者 | 低 | M1 接受这种行为（用户主动重复）+ 节点 inspector 警告同 varKey 多次绑定 |
| 11 | daemon 重启时 in-flight run 丢失 | 中 | §9.6 重启清理 cwd train.json + 前端把 stale running 标 failed；用户必须重跑 |
| 12 | 变量变更审计 log 文件无限增长 | 低 | §8.4 log 路径含 runId，每 run 独立文件；后续 phase 加 rotation |
| 13 | M1 不支持并行（多源调研需顺序串联） | 中 | §4 显式列出局限；用户接受这点；M3+ Phase 2 加并行 |
| 14 | PromptTemplateEditor 下拉 caret 位置算法在缩放/不同字体下偏移 | 低 | M1 用 mirror div + getBoundingClientRect 标准技巧；浏览器手测覆盖 100%/125%/150% 缩放 |
| 15 | "+ 新建变量" popover 关闭后 textarea 失焦补全位置丢失 | 低 | popover 关闭时保存 textarea selectionStart 在 ref，确认后 setSelectionRange 恢复 |

## 18. 后续阶段（不在本 spec 范围）

- **Phase 2**：子流程节点（一个节点本身是个 .flow 文件，进入运行其 sub-runtime）
- **Phase 2**：并行节点（两个出口同时走，最后汇合）
- **Phase 2**：if expr 扩展（`.length` / `.in()` / 字符串包含）
- **Phase 3**：节点 retry policy（自动重试 N 次）
- **Phase 3**：超时（节点级 / 工作轨级）
- **Phase 3**：scheduled trigger（cron / webhook 启动 .flow）
- **Phase 4**：跨工作轨 train.json 共享 / 命名空间
- **Phase 4**：node-level adapter override（一个工作轨混用 claude-code + codex）
