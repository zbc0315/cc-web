# Plan-Control 系统设计

## 概述

Plan-Control 是 ccweb 的确定性任务编排系统。核心理念：**AI 负责制定计划和执行任务，确定性程序负责调度、追踪和流程控制**。解决 AI 在长周期（数天）复杂任务中遗忘计划、丢失进度、无法可靠分支/循环的问题。

**适用范围**：初期仅支持 Claude（依赖文件写入能力完成 JSON 回填）。OpenCode、Codex、Qwen 等工具需要验证其 CLI 是否支持在对话中创建/修改 JSON 文件后方可接入。最低要求：CLI 工具必须能在对话过程中写入指定路径的 JSON 文件。复用 ccweb 已有的 PTY 交互和活动监测基础设施。

## 核心架构

```
用户点击"初始化"
  → 生成 .plan-control/ 骨架文件（init.md, plan-code.md, output-format.md）
  → AI 依据 init.md 对用户深度访谈
  → AI 依据 plan-code.md 编写 main.pc

用户点击"检查"（或自动触发）
  → Checker 语法检查 main.pc
  → 失败 → 向 terminal 发送错误信息要求 AI 修改
  → 成功 → 启动按钮可用

用户点击"启动"
  → Executor 逐节点执行：
      Parser 解析当前代码行 → 生成结构化指令块
      → 发送到 terminal → 监测 AI 活动 + JSON 文件变化
      → 读取 result → 决定下一步（顺序/分支/循环/跳出/replan）
```

三个引擎全部为纯确定性逻辑，不依赖 AI：

| 引擎 | 职责 |
|------|------|
| **Checker** | 语法检查 main.pc（缩进、关键字、变量引用、函数存在性） |
| **Parser** | 两遍扫描：第一遍收集函数定义，第二遍构建 AST + 生成指令块 |
| **Executor** | 状态机：选择下一行、发送指令、监测完成、读取结果、决定流转 |

## pc 语言规范

### 设计原则

- 类 Python 缩进式语法（固定 2 空格缩进，不允许 tab），AI 生成可靠性最高
- 任务描述为纯自然语言，不需要引号（单行，从 `task ` 之后到行尾全部为描述文本）
- 变量系统极简：静态列表 + task 动态返回值
- 不支持数值计算、字符串操作、嵌套数据结构、import/多文件

### 形式化语法（PEG）

PEG 语法仅定义**单行语法**。块结构（if/for/loop/func 的子语句归属）由 Parser 的独立缩进分析步骤确定：Parser 逐行追踪缩进深度（每 2 空格为一级），构建父子关系树。这与 Python 的 INDENT/DEDENT token 方案等价，但实现更简单。

```peg
Program     ← (Line / BlankLine)* EOF
BlankLine   ← Indent? Comment? EOL
Line        ← Indent? Statement EOL
Statement   ← Comment / VarAssign / TaskAssign / Task / If / Elif / Else
              / For / Loop / Func / Call / Break / Continue / Return

Comment     ← '#' [^\n]*
VarAssign   ← Identifier WS '=' WS ListLiteral
TaskAssign  ← Identifier WS '=' WS 'task' WS Description
Task        ← 'task' WS Description
If          ← 'if' WS Condition ':'
Elif        ← 'elif' WS Condition ':'
Else        ← 'else' ':'
For         ← 'for' WS Identifier WS 'in' WS VarRef ':'
Loop        ← 'loop' WS Integer (WS 'as' WS Identifier)? ':'
Func        ← 'func' WS Identifier '(' ParamList? ')' ':'
Call        ← 'call' WS Identifier '(' ArgList? ')'
Break       ← 'break'
Continue    ← 'continue'
Return      ← 'return'

Condition   ← 'success' / 'failed' / 'blocked' / VarRef
Description ← [^\n]+                          # 从关键字后到行尾，全部为自然语言（可含 ${var}，post-parse 替换）
Identifier  ← [a-zA-Z_\u4e00-\u9fff][a-zA-Z0-9_\u4e00-\u9fff]*
VarRef      ← '${' Identifier '}'
ListLiteral ← '[' (ListItem (',' ListItem)*)? ']'   # 允许空列表 []
ListItem    ← WS* [^,\]\n]+ WS*              # 逗号和 ] 不可出现在列表项中；实现必须 trim 匹配结果的首尾空白
ParamList   ← Identifier (',' WS? Identifier)*
ArgList     ← Arg (',' WS? Arg)*
Arg         ← VarRef / ListLiteral
Integer     ← [0-9]+
Indent      ← ('  ')*                         # 固定 2 空格为一级
WS          ← ' '+
EOL         ← '\n' / EOF
```

### 关键解析规则

1. **关键字仅在行首（缩进后）识别**：`task`、`if`、`else`、`elif`、`for`、`loop`、`func`、`call`、`break`、`continue`、`return`。task 描述中出现这些词不会被误解析。
2. **`task ` 之后到行尾全部为描述文本**，包括其中的 `=`、`if`、`for` 等字符。
3. **变量插值统一使用 `${var}` 语法**（带花括号的 dollar 前缀），避免与自然语言中的 `$` 符号混淆。Description 中的 `${var}` 不由 PEG 语法解析——Parser 在构建 AST 后，对 Description 文本进行 post-parse 字符串替换（正则 `\$\{([a-zA-Z_\u4e00-\u9fff][a-zA-Z0-9_\u4e00-\u9fff]*)\}` 匹配并替换为变量值，字符集与 Identifier 规则保持一致，支持中文标识符）。
4. **列表项不可包含 `,` 或 `]`**，项前后空白自动 trim（实现必须对 PEG 匹配结果显式 trim）。
5. **函数调用参数**只接受 `${var}` 变量引用或 `[...]` 列表字面量，不接受裸标识符——所有变量传递必须使用 `${var}` 语法以保持一致性。
6. **函数定义位置不限**：Parser 两遍扫描，第一遍收集所有 `func` 定义，第二遍构建 AST。`call` 可以出现在 `func` 之前。

### 关键字（共 12 个）

| 关键字 | 用途 | 示例 |
|--------|------|------|
| `task` | 任务节点 | `task 从PubChem下载候选分子` |
| `if` / `elif` / `else` | 条件分支 | `if success:` / `elif failed:` / `else:` |
| `for ... in` | 遍历列表 | `for db in ${databases}:` |
| `loop N` | 固定次数循环 | `loop 3:` / `loop 5 as i:` |
| `func` / `call` | 函数定义与调用 | `func 计算(targets):` / `call 计算(${molecules})` |
| `break` | 跳出最内层循环 | `break` |
| `continue` | 跳到最内层循环的下一次迭代 | `continue` |
| `return` | 从函数返回 | `return` |

### 变量系统

**静态定义**（字符串列表）：
```
databases = [PubChem, ZINC, ChEMBL]
methods = [ML预测, xtb计算, DFT计算]
```

**动态赋值**（task 返回值绑定到变量）：
```
databases = task 查询所有开源分子数据库并返回名称列表
molecules = task 从PubChem提取候选分子列表
```

执行器解析到 `var = task ...` 时，指令块自动附加返回格式要求，告知 AI 将结果写入 result 字段。

**引用语法**：统一使用 `${变量名}` — 在 task 描述、for 循环、call 参数中一致：
```
for db in ${databases}:
  task 从${db}下载候选分子
```

**变量类型**：
- 字符串列表（`["PubChem", "ZINC"]`）— 静态定义（VarAssign）和动态赋值（TaskAssign）均可产生
- 布尔值（`true` / `false`）— 仅由 TaskAssign 动态返回
- 字符串（`"PubChem"`）— 仅由 TaskAssign 动态返回

静态定义 `x = [...]` 只能产生字符串列表。布尔值和字符串仅由 task 的 result 字段动态返回，执行器自动推断类型。

### 条件判断

`if` / `elif` / `else` 的条件基于**同级作用域中最近一个已执行 task 的 status**。三个可匹配的 status 关键字：`success`、`failed`、`blocked`（blocked 由催促超时或用户手动标记产生，在 `if` 条件中与 success/failed 用法完全一致）：

```
task 连接数据库
if success:
  task 下载数据
elif failed:
  task 尝试备用连接方式
else:
  task 记录异常并通知用户
```

**Checker 规则**：

1. **前置 task 规则**：当条件为 `success` / `failed` / `blocked` 时，`if` / `elif` 的同级前方（同缩进层级）必须存在至少一个 `task` 语句。此规则在每个作用域内独立适用——函数体内的 `if success:` 需要函数体内的前置 task，不考虑调用方的 task（因为 `call` 会保存/恢复 `last_task_status`）。当条件为 `${var}` 形式时，此规则不适用。`else` 无条件，不受此规则约束。
2. **位置限制规则**：`break` 和 `continue` 必须出现在 `for` 或 `loop` 体内（任意嵌套深度）；`return` 必须出现在 `func` 体内。违反则报语法错误。

**条件限制**：条件仅支持单值判断，**不支持** `not`、`and`、`or`、比较运算符。如需复合条件，应拆分为多个 task 步骤。

**变量条件**：`if ${var}:` 形式，判断变量是否为 truthy（`true`、非空字符串、非空列表）：
```
has_gpu = task 检测当前环境是否有GPU
if ${has_gpu}:
  task 使用GPU加速计算
else:
  task 使用CPU计算
```

### 循环

**`for ... in`**：遍历列表变量。如果变量值为字符串，视为单元素列表执行一次；如果为布尔值或 null，执行器记录错误原因并进入 PAUSED 状态（`for` 是控制流语句，不产生 task 节点）。空列表 `[]` 则跳过循环体。
```
for db in ${databases}:
  task 从${db}下载候选分子
```

**`loop N`**：固定次数循环，可选 `as` 暴露计数器（从 1 开始）：
```
loop 3 as i:
  task 第${i}次优化分子构象
  if success:
    break
```

**`break` / `continue`**：作用于最内层循环（无论 `for` 还是 `loop`）。`continue` 在 `loop` 中递增计数器。

### 函数（子树）

函数用于封装复杂子流程。参数创建**局部作用域**，遮蔽同名全局变量。函数内部的变量赋值为局部变量，不影响全局作用域。

```
func 分子性质计算(molecule_set, method_list):
  for method in ${method_list}:
    results = task 使用${method}计算${molecule_set}的HOMO和LUMO
    if success:
      return
  task 所有方法均失败，请分析原因
```

**调用**：
```
call 分子性质计算(${molecules}, ${methods})
```

**函数定义位置不限**——可以先 call 后 func（Parser 两遍扫描）。

**不支持递归**——Checker 构建调用图（从所有 `func` 体内的 `call` 语句提取边），检测图中的环（标准 DFS 循环检测），包括直接递归和间接互递归。

**嵌套深度限制**：`loop_stack` 和 `call_stack` 各自最大深度为 20。超出时执行器报错并进入 PAUSED 状态。此为安全上限，实际 pc 代码不应超过 5 层嵌套。

### 注释

`#` 开头的行为注释，Parser 忽略：
```
# 第一阶段：数据收集
task 收集实验数据
```

### 完整示例

```
# 变量定义
methods = [ML预测, xtb计算, DFT计算]

# 函数定义（位置不限，可以放在 call 之后）
func 性质计算(targets, method_list):
  for m in ${method_list}:
    results = task 使用${m}计算${targets}的HOMO和LUMO并返回结果文件路径
    if success:
      return
  task 所有计算方法均失败，请分析原因并建议替代方案

# 主流程
databases = task 查询所有开源分子数据库并返回可用列表

for db in ${databases}:
  task 从${db}下载符合LogP小于5且分子量小于500的候选分子
  if success:
    molecules = task 提取${db}中符合条件的分子SMILES列表
    call 性质计算(${molecules}, ${methods})
    break

loop 3 as i:
  task 第${i}次基于计算结果优化分子构象
  if success:
    break

task 生成最终报告，汇总所有筛选和计算结果
```

## .plan-control/ 目录结构

```
.plan-control/
├── init.md              # AI访谈指引（初始化时生成）
├── plan-code.md         # pc语言规范说明（初始化时生成）
├── output-format.md     # 节点输出JSON格式模板（初始化时生成）
├── main.pc              # AI生成的计划代码
├── state.json           # 执行器全局状态
└── nodes/               # 节点执行记录
    ├── node-001.json
    ├── node-002.json
    └── ...
```

### init.md（AI 访谈指引）

初始化时自动生成，内容指导 AI：

1. 对用户进行深度访谈，挖掘未知需求和需求边界
2. 询问用户当前可调用资源（计算资源、远程服务器、网络资源等）
3. 制定总体计划
4. 依据 plan-code.md 中的 pc 语言规范，将计划编写为 main.pc 文件

### output-format.md（节点输出格式模板）

````markdown
# 节点输出格式

任务完成后，请更新指定的 JSON 文件，严格按以下格式：

```json
{
  "status": "success | failed | blocked | replan",
  "result": null,
  "summary": "",
  "request_replan": false,
  "replan_reason": ""
}
```

## 字段说明

| 字段 | 必填 | 类型 | 说明 |
|------|------|------|------|
| status | 是 | string | success=完成 / failed=失败 / blocked=需人工介入 / replan=计划需调整（等同于 request_replan=true，执行器归一化为 success 处理） |
| result | 是 | bool/string/array | 返回值。布尔值供 if 判断，列表供 for 遍历，字符串供插值 |
| summary | 是 | string | 一句话描述执行结果 |
| request_replan | 否 | bool | 如认为后续计划需要调整，设为 true |
| replan_reason | 否 | string | 当 request_replan=true 时必填，说明调整原因 |

## 示例

任务成功并返回列表：
```json
{
  "status": "success",
  "result": ["PubChem", "NIST"],
  "summary": "检测到2个可用的开源分子数据库"
}
```

任务失败：
```json
{
  "status": "failed",
  "result": false,
  "summary": "PubChem API 返回 503，服务暂时不可用"
}
```

需要调整计划：
```json
{
  "status": "replan",
  "result": false,
  "summary": "发现数据格式与预期不同，需要增加数据清洗步骤",
  "request_replan": true,
  "replan_reason": "原计划未考虑SDF格式和SMILES格式的混合情况，需在下载后增加格式统一步骤"
}
```
````

### state.json（执行器全局状态）

```json
{
  "status": "running",
  "current_line": 15,
  "executed_tasks": 2,
  "estimated_tasks": 12,
  "variables": {
    "databases": ["PubChem", "ZINC", "ChEMBL"],
    "molecules": null
  },
  "call_stack": [
    {
      "func": "性质计算",
      "return_line": 18,
      "local_vars": { "targets": ["mol1", "mol2"], "method_list": ["ML预测", "xtb计算"] },
      "saved_last_task_status": "success"
    }
  ],
  "loop_stack": [
    { "type": "for", "var": "db", "list": ["PubChem", "ZINC", "ChEMBL"], "index": 0, "start_line": 12 }
  ],
  "last_task_status": "success",
  "history": [
    { "node_id": "001", "line": 10, "status": "success", "timestamp": "2026-04-02T10:00:00Z" },
    { "node_id": "002", "line": 14, "status": "success", "timestamp": "2026-04-02T10:05:00Z" }
  ]
}
```

关键改动：
- `current_line` 替代 `current_node`——基于行号追踪，与 AST 对齐
- `estimated_tasks`：静态估算，计算方法为统计 AST 中所有 `task` 和 `TaskAssign` 节点数量，其中 `loop N` 体内的 task 计为 N 倍（嵌套 loop 按各层 N 值的乘积计算，如 `loop 3` 内嵌 `loop 2` 内有 1 个 task → 计为 6）。`for` 循环因列表长度运行时才确定，计为 1 倍（不展开）。这是执行总数的近似下界。前端显示为"已完成 N 个任务（预估 ≥M 个）"以明示下界语义；`executed_tasks`：实际执行计数
- `loop_stack` 追踪嵌套循环状态
- `last_task_status` 显式记录最近 task 的 status，供 `if` 判断使用
- `call_stack` 帧结构：`func`（函数名）、`return_line`（调用方的下一行行号）、`local_vars`（函数参数和局部变量快照）、`saved_last_task_status`（进入函数前的 last_task_status）。`call` 时 push 帧并保存当前 `last_task_status`；`return` 时 pop 帧并恢复 `saved_last_task_status`——确保函数内部的 task 状态不会影响调用方作用域的 `if` 判断

### node-XXX.json（节点执行记录）

节点 ID 为全局单调递增的整数（从 001 开始），贯穿整个执行生命周期（包括 replan 后新增的任务）。ID 不会重置或重复。格式为 3 位零填充（`001`-`999`），超过 999 时自动扩展位数。resume 后从上次最大 ID 继续递增。

由执行器创建骨架，AI 回填 status/result/summary：

```json
{
  "id": "003",
  "line": 14,
  "code": "task 从${db}下载候选分子",
  "resolved_code": "task 从PubChem下载候选分子",
  "prompt": "[PLAN-CONTROL] 任务 #003\n指令：从PubChem下载候选分子\n...",
  "started_at": "2026-04-02T10:10:00Z",
  "completed_at": null,
  "nudge_count": 0,
  "status": null,
  "result": null,
  "summary": null
}
```

## 指令块格式

执行器发送到 terminal 的结构化指令：

```
[PLAN-CONTROL] 任务 #003
指令：从PubChem下载候选分子
上下文：第3个任务（已完成2个）
前置任务：#002 (success) - 确认筛选指标为LogP<5, MW<500
输出文件：.plan-control/nodes/node-003.json
输出格式：见 .plan-control/output-format.md
[/PLAN-CONTROL]
```

当节点为赋值型 `var = task ...` 时，附加返回要求：

```
[PLAN-CONTROL] 任务 #001
指令：查询所有开源分子数据库并返回名称列表
上下文：第1个任务
输出文件：.plan-control/nodes/node-001.json
输出格式：见 .plan-control/output-format.md
返回要求：result 字段请填写为字符串列表，如 ["PubChem", "ZINC"]
[/PLAN-CONTROL]
```

## 执行器行为

### 状态机

**state.json `status` 字段与状态机状态的映射**：

| 状态机状态 | 持久化 status 值 | 说明 |
|-----------|-----------------|------|
| IDLE | `"running"` | 正在处理非 task 行或准备下一行 |
| SENDING | `"running"` | 等待 terminal 空闲以发送指令 |
| WAITING | `"waiting"` | 已发送指令，等待 AI 回填 JSON |
| PROCESSING | `"running"` | 读取结果、更新状态（瞬时，不持久化此中间态） |
| REPLANNING | `"replanning"` | 等待 AI 修改 main.pc |
| PAUSED | `"paused"` | 用户暂停或运行时错误 |
| STOPPED | `"stopped"` | 用户停止或 PTY 被 kill |
| （终态） | `"completed"` | 所有行执行完毕 |

```
IDLE → 读取 current_line → 解析该行
  → 非 task 行（变量定义/for/if/elif/else/func/call/break/continue/return/注释/空行）
    → 内部处理（更新变量/循环栈/调用栈/跳转行号）→ 持久化 state.json → 回到 IDLE
  → task 行 → Parser 插值变量生成指令块 → 创建 node-XXX.json → SENDING

SENDING → 检测 terminal 是否空闲（PTY 活动时间戳）
  → 空闲 → 发送指令块到 terminal → 进入 WAITING
  → 忙碌 → 等待空闲（每 5s 检查一次）

WAITING → 监测两个信号：
  1. node-XXX.json 文件变化（fs.watch + 轮询兜底每 10s）
     → 读取并校验 JSON（status 必须为合法值，result 类型合法）
     → 校验通过 → PROCESSING
     → 校验失败（corrupt JSON / 非法值）→ 发送格式纠正提示 → 留在 WAITING
  2. PTY 空闲超过阈值且 JSON 未更新 → 发送催促 → 留在 WAITING
     催促最多 N 次 → 仍无响应 → 标记 blocked → PROCESSING

PROCESSING → 根据 result + 代码上下文决定：
  - 更新 variables（如果是赋值型 task）
  - 记录 last_task_status
  - 更新 history
  - 持久化 state.json（atomic write）
  - request_replan == true → 进入 REPLANNING
  - 否则 → advance current_line → 回到 IDLE

REPLANNING → 暂停执行
  → 向 terminal 发送 replan 指令（见下文 replan 处理）
  → 等待 AI 修改 main.pc 并回填 node JSON status 为 success
  → 重新语法检查 main.pc
  → 通过 → 重建 AST → 从当前行继续（保留所有变量） → 回到 IDLE
  → 失败 → 向 terminal 发送语法错误 → 留在 REPLANNING

PAUSED → 用户点击暂停触发
  → 当前如在 WAITING，完成当前节点后暂停
  → 可通过 resume 恢复到 IDLE

STOPPED → 用户点击停止 或 项目 PTY 被 kill
  → 记录 stop_line 和 stop_node_id 到 state.json
  → status 设为 "stopped"
  → resume 时从 stop_line 继续（与 crash recovery 的 stopped 恢复逻辑一致）
```

### 发送前空闲检测

执行器在发送指令前等待 terminal 空闲，复用 ccweb 已有的 PTY `lastActivityAt` 时间戳。空闲阈值 5 秒。这避免了指令被追加到 AI 正在执行的操作中。

### 催促机制

- 监测 PTY `onData` 时间戳，空闲超过可配置阈值（默认 60 秒）
- 且对应 node-XXX.json 的 status 仍为 null
- 发送固定催促文本："请继续当前任务。如果已完成，请按照 .plan-control/output-format.md 的格式更新 .plan-control/nodes/node-XXX.json"
- 最多催促 3 次（间隔递增：60s / 120s / 240s）
- 3 次仍无响应 → 标记为 `blocked`，通知用户

### replan 处理

1. AI 在 node JSON 中返回 `request_replan: true`（可与任何 status 组合）。注意：`status: "replan"` 等同于 `request_replan: true`——执行器在 PROCESSING 阶段检测到 `status === "replan"` 时自动视为 replan 请求。
2. 先正常处理该节点的结果（更新变量）。**`last_task_status` 归一化**：`status: "replan"` 归一化为 `"success"` 记入 `last_task_status`（因为 replan 意味着任务本身已完成、但后续计划需调整）。其他 status（`success`/`failed`/`blocked`）直接记录。这确保 replan 后续的 `if success:` / `if failed:` 等条件能正常匹配。
3. 执行器进入 REPLANNING 状态
4. 向 terminal 发送：
   ```
   [PLAN-CONTROL] 计划调整请求
   原因：{replan_reason}
   请修改 .plan-control/main.pc，保留前 {current_line} 行不变，调整后续计划。
   修改完成后，请更新 .plan-control/nodes/node-{id}.json 的 status 为 "success"。
   [/PLAN-CONTROL]
   ```
5. AI 修改 main.pc 后回填 JSON
6. **行验证**：执行器逐行比对 main.pc 的前 `current_line` 行是否与修改前完全一致。如不一致，向 terminal 发送错误："前 N 行不可修改，请恢复并仅修改第 N+1 行之后的内容"，留在 REPLANNING。
7. 验证通过 → 重新语法检查
8. 通过 → 重建 AST，保留所有现有变量，从 current_line 的下一行继续
9. 失败 → 将语法错误发送到 terminal，要求 AI 修复，留在 REPLANNING

### Crash Recovery（崩溃恢复）

服务重启时，如果 `state.json` 存在且 `status` 不为 `completed`：

1. 读取 `state.json` 恢复完整状态（variables、loop_stack、call_stack、history）
2. 根据 `status` 决定恢复行为：
   - **`running` / `waiting`**：检查当前节点的 `node-XXX.json`：
     - 已有 result → 作为 PROCESSING 处理，推进到下一行
     - 无 result → 重新发送该节点的指令（回到 SENDING）
   - **`replanning`**：重新检查 main.pc 语法。通过 → 重建 AST 继续；失败 → 向 terminal 发送语法错误，留在 REPLANNING
   - **`paused`**：恢复到 PAUSED 状态，等待用户 resume
   - **`stopped`**：恢复到 STOPPED 状态，等待用户 resume
3. 恢复后继续正常状态机流转

### 文件并发策略

| 文件 | 写入方 | 读取方 | 策略 |
|------|--------|--------|------|
| `state.json` | 仅执行器 | 前端 API | 执行器使用 atomicWriteSync（需从 config.ts 导出或在 plan-control 模块内实现等价的 temp+rename 原子写入） |
| `node-XXX.json` | 执行器创建骨架，AI 填写结果 | 执行器读取 | 时序保证：创建→发送→等待→读取 |
| `main.pc` | 仅 AI | 执行器（启动/replan 时） | REPLANNING 状态下执行器暂停，AI 独占写 |

### Terminal 交互注意事项

- 执行中允许用户手动在 terminal 中输入，不锁定 terminal
- 用户输入可能导致 AI 执行偏离计划指令——这是允许的（协作模式）
- 催促和指令块是追加到 PTY stdin，与用户输入同等对待

## 后端实现

### 新增文件

| 文件 | 职责 |
|------|------|
| `backend/src/plan-control/types.ts` | 类型定义（AST 节点类型、状态类型、配置类型） |
| `backend/src/plan-control/checker.ts` | 语法检查器（基于 PEG 语法验证，报告行号+错误消息） |
| `backend/src/plan-control/parser.ts` | 解析器（两遍扫描：收集 func → 构建 AST，变量插值，指令块生成） |
| `backend/src/plan-control/executor.ts` | 执行状态机（节点调度、文件监测 fs.watch+轮询、催促、crash recovery） |
| `backend/src/plan-control/templates.ts` | 初始化模板文件内容（init.md, plan-code.md, output-format.md） |
| `backend/src/routes/plan-control.ts` | REST API 路由（含 /tree 端点：解析 AST + 合并 node status → PlanTreeNode 树） |
| `frontend/src/components/PlanPanel.tsx` | 任务树 tab 容器（工具栏 + TaskTree，lazy-loaded） |
| `frontend/src/components/TaskTree.tsx` | SVG 拓扑图渲染（树形布局、zoom/pan、状态着色、实时更新） |

### REST API

| Method | Endpoint | 用途 |
|--------|----------|------|
| `POST` | `/api/projects/:id/plan/init` | 初始化 .plan-control/ 目录（创建目录和模板文件，失败返回 500 + 错误消息） |
| `GET` | `/api/projects/:id/plan/status` | 获取执行状态（state.json） |
| `POST` | `/api/projects/:id/plan/check` | 语法检查 main.pc，返回错误列表或成功 |
| `POST` | `/api/projects/:id/plan/start` | 启动执行 |
| `POST` | `/api/projects/:id/plan/pause` | 暂停执行（完成当前节点后暂停） |
| `POST` | `/api/projects/:id/plan/resume` | 恢复执行（从暂停/停止处继续） |
| `POST` | `/api/projects/:id/plan/stop` | 停止执行（记录停止位置） |
| `GET` | `/api/projects/:id/plan/nodes` | 获取所有节点状态列表 |
| `GET` | `/api/projects/:id/plan/nodes/:nodeId` | 获取单个节点详情 |
| `GET` | `/api/projects/:id/plan/tree` | 获取 AST 拓扑树（PlanTreeNode 结构，含 node status 合并） |

### WebSocket 事件

所有 plan-control 事件通过项目级 WebSocket（`/ws/projects/:id`）发送给该项目的所有已连接客户端：

| 方向 | Type | Payload | 用途 |
|------|------|---------|------|
| Server → Client | `plan_status` | `{ status, executed_tasks, estimated_tasks, current_line }` | 执行状态变化 |
| Server → Client | `plan_node_update` | `{ node_id, status, summary }` | 节点完成/失败/blocked |
| Server → Client | `plan_nudge` | `{ node_id, nudge_count }` | 催促事件 |
| Server → Client | `plan_replan` | `{ node_id, reason }` | replan 事件 |

## 前端实现

### LeftPanel 集成

LeftPanel 新增第三个 tab："任务"（与"文件"、"Git"平级）。Tab 值 `'plan'`，图标可复用 `ListTree` 或 `GitBranch`。LeftPanel 向 PlanPanel 传递 `projectId` 和 `projectPath`。

### PlanPanel 组件（任务树 Tab 内容）

`frontend/src/components/PlanPanel.tsx`，lazy-loaded（`React.lazy`），包含两个区域：**顶部工具栏** + **任务拓扑图**。

#### 顶部工具栏

根据 plan-control 状态显示不同按钮组：

| 状态 | 工具栏内容 |
|------|-----------|
| 未初始化（无 `.plan-control/`） | "初始化" 按钮 |
| 已初始化 / 编辑中（有 main.pc，未检查或检查失败） | "检查语法" 按钮 + 错误计数 |
| 就绪（语法检查通过） | "启动" 按钮 |
| 执行中 | 进度文本 "已完成 N（≥M）" + "暂停" / "停止" 按钮 |
| 暂停 / 停止 | "继续" 按钮 |

工具栏高度固定 `h-8`，与 LeftPanel 其他 tab 的头部风格一致。

#### 任务拓扑图（TaskTree）

`frontend/src/components/TaskTree.tsx` — SVG 拓扑图，复用 GraphPreview 的交互模式（SVG zoom/pan/fit），但布局算法和数据源不同。

**数据来源**：
- `GET /api/projects/:id/plan/status` 获取 state.json（包含 AST 信息）
- `GET /api/projects/:id/plan/nodes` 获取所有节点执行记录
- WebSocket `plan_node_update` / `plan_status` 实时推送状态变更

**AST → 拓扑图映射**：

后端新增 `GET /api/projects/:id/plan/tree` 端点，返回前端可直接渲染的拓扑树结构：

```typescript
interface PlanTreeNode {
  id: string;              // AST 行号，如 "L10"
  type: 'task' | 'if' | 'elif' | 'else' | 'for' | 'loop' | 'call' | 'func' | 'var';
  label: string;           // 显示文本（task 描述截断、for 变量名、if 条件等）
  line: number;            // 源码行号
  node_id?: string;        // 关联的 node-XXX ID（仅 task 类型）
  status?: 'pending' | 'running' | 'success' | 'failed' | 'blocked' | 'skipped';
  children: PlanTreeNode[];  // 子节点（缩进块内的语句）
}
```

**布局算法**：自上而下的树形布局（非 DAG），因为 pc 语言的控制流是严格的树结构（无 goto/跳转）：

- 根节点为虚拟的 "main" 节点
- 每个 AST 语句为一个节点，按源码顺序自上而下排列
- `if`/`elif`/`else` 的分支为水平并列的子树
- `for`/`loop` 的循环体为垂直子树，循环节点用回边箭头标识
- `call` 节点连接到对应 `func` 定义的子树（虚线）
- 节点间距：NODE_W=140px, NODE_H=36px, H_GAP=20px, V_GAP=16px

**节点渲染**：

每个节点为 SVG `<g>` 组：
- 圆角矩形背景，颜色由 status 决定：
  - `pending`：`bg-muted`（灰色，默认）
  - `running`：`bg-blue-500/20` + 蓝色边框 + 脉冲动画（`animate-pulse`）
  - `success`：`bg-green-500/15` + 绿色边框
  - `failed`：`bg-red-500/15` + 红色边框
  - `blocked`：`bg-yellow-500/15` + 黄色边框
  - `skipped`：`bg-muted/50` + 虚线边框（分支未进入）
- 左侧状态图标（小圆点或对勾/叉号），10px
- 节点文本：type 标签（`task`/`if`/`for` 等）+ 截断的 label，11px
- 控制流节点（if/for/loop）用不同形状区分：菱形（if）、六边形（for/loop）
- task 节点右上角显示 node ID（如 `#003`），8px 灰色文本

**边（连线）**：
- 顺序执行：实线向下箭头
- 条件分支：从菱形节点分叉出多条线
- 循环回边：虚线从循环体底部回到循环头（曲线，避免覆盖正向线）
- call → func：虚线连接，标注函数名

**交互**：
- **Zoom/Pan**：与 GraphPreview 一致（鼠标滚轮缩放 0.2-3x，拖拽平移）
- **Fit view**：自动适配 + 手动按钮
- **点击节点**：展开浮层显示 node 详情（summary、started_at、completed_at）；task 节点可查看完整 prompt
- **当前执行行高亮**：`current_line` 对应的节点加粗边框 + 微弱发光效果

**实时状态更新**：

PlanPanel 通过 `useProjectWebSocket` 监听 plan-control 事件：

```typescript
// 在现有 WS 连接上监听新事件类型
case 'plan_status':
  // 更新 current_line → 高亮移动
  // 更新 executed_tasks / estimated_tasks → 工具栏进度
  break;
case 'plan_node_update':
  // 更新对应 node_id 的 task 节点 status + summary
  // 触发节点颜色/图标变化动画
  break;
case 'plan_replan':
  // 重新 fetch /plan/tree（AST 可能已变）
  break;
```

状态变化使用 `motion` 过渡动画（颜色渐变 200ms），当前执行节点平滑滚动到视口中央（`scrollIntoView` 等效的 SVG viewport 调整）。

**未初始化 / 无 main.pc 时**：
- 拓扑图区域显示空状态插图 + "初始化 Plan Control 以开始" 提示文本
- 初始化后、AI 编写 main.pc 期间：显示 "等待 AI 编写计划..." 提示

**语法检查失败时**：
- 拓扑图不渲染（无有效 AST）
- 工具栏下方显示错误列表（行号 + 错误消息），点击错误项无操作（main.pc 由 AI 编辑，非前端编辑器）

## 配置

通过项目设置可配置：

| 配置项 | 默认值 | 说明 |
|--------|--------|------|
| `nudge_idle_seconds` | 60 | AI 空闲多久后发送催促 |
| `nudge_max_count` | 3 | 最大催促次数 |
| `nudge_interval_multiplier` | 2 | 催促间隔递增倍数 |
| `send_idle_seconds` | 5 | 发送指令前等待 terminal 空闲的阈值 |
| `watch_poll_interval` | 10000 | fs.watch 兜底轮询间隔（ms） |
