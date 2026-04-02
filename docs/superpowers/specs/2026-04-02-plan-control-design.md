# Plan-Control 系统设计

## 概述

Plan-Control 是 ccweb 的确定性任务编排系统。核心理念：**AI 负责制定计划和执行任务，确定性程序负责调度、追踪和流程控制**。解决 AI 在长周期（数天）复杂任务中遗忘计划、丢失进度、无法可靠分支/循环的问题。

## 核心架构

```
用户点击"初始化"
  → 生成 .plan-control/ 骨架文件（init.md, plan-code.md, output-format.md）
  → AI 依据 init.md 对用户深度访谈
  → AI 依据 plan-code.md 编写 main.pc

用户点击"检查"
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
| **Checker** | 语法检查 main.pc（括号匹配、关键字、缩进、变量引用） |
| **Parser** | 将 pc 代码行 + 变量上下文转为结构化自然语言指令块 |
| **Executor** | 状态机：选择下一行、发送指令、监测完成、读取结果、决定流转 |

## pc 语言规范

### 设计原则

- 类 Python 缩进式语法，AI 生成可靠性最高
- 任务描述为纯自然语言，不需要引号（单行）
- 变量系统极简：静态列表 + task 动态返回值
- 不支持数值计算、字符串操作、嵌套数据结构、import/多文件

### 关键字（共 10 个）

| 关键字 | 用途 | 示例 |
|--------|------|------|
| `task` | 任务节点 | `task 从PubChem下载候选分子` |
| `if` / `else` | 条件分支 | `if success:` / `if failed:` / `if blocked:` |
| `for ... in` | 遍历列表 | `for db in $databases:` |
| `loop N` | 固定次数循环 | `loop 3:` |
| `func` / `call` | 函数定义与调用 | `func 计算(targets):` / `call 计算($molecules)` |
| `break` | 跳出当前循环 | `break` |
| `continue` | 跳到下一次循环 | `continue` |
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

执行器解析到 `var = task ...` 时，指令块自动附加返回格式要求，告知 AI 将结果以列表格式写入 result 字段。

**引用语法**：`$变量名` 用于 task 描述插值和 for 循环：
```
for db in $databases:
  task 从{db}下载候选分子
```

`{var}` 用于 task 描述中的字符串插值，`$var` 用于 for/call 中的变量引用。

**变量类型**：
- 布尔值（`true` / `false`）
- 字符串（`"PubChem"`）
- 字符串列表（`["PubChem", "ZINC"]`）

类型由执行器从 JSON result 字段自动推断。

### 条件判断

`if` 的条件基于上一个 task 的 status：
```
task 连接数据库
if success:
  task 下载数据
else:
  task 记录错误并尝试备选方案
```

支持 `success`、`failed`、`blocked`、`replan` 四个条件值。

### 函数（子树）

函数用于封装复杂子流程，参数通过 `$变量名` 传递：

```
func 分子性质计算(molecule_set, method_list):
  for method in $method_list:
    results = task 使用{method}计算{molecule_set}的HOMO和LUMO
    if success:
      return
  task 所有方法均失败，请分析原因

call 分子性质计算($molecules, $methods)
```

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

# 函数定义
func 性质计算(targets, method_list):
  for m in $method_list:
    results = task 使用{m}计算{targets}的HOMO和LUMO并返回结果文件路径
    if success:
      return
  task 所有计算方法均失败，请分析原因并建议替代方案

# 主流程
databases = task 查询所有开源分子数据库并返回可用列表

for db in $databases:
  task 从{db}下载符合LogP小于5且分子量小于500的候选分子
  if success:
    molecules = task 提取{db}中符合条件的分子SMILES列表
    call 性质计算($molecules, $methods)
    break

loop 3:
  task 基于计算结果优化分子构象
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
| status | 是 | string | success=完成 / failed=失败 / blocked=需人工介入 / replan=计划需调整 |
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
  "current_node": 3,
  "total_tasks": 12,
  "completed": 2,
  "failed": 0,
  "variables": {
    "databases": ["PubChem", "ZINC", "ChEMBL"],
    "molecules": null
  },
  "call_stack": [],
  "loop_counters": {},
  "history": [
    { "node": 1, "status": "success", "timestamp": "2026-04-02T10:00:00Z" },
    { "node": 2, "status": "success", "timestamp": "2026-04-02T10:05:00Z" }
  ]
}
```

### node-XXX.json（节点执行记录）

由执行器创建骨架，AI 回填 status/result/summary：

```json
{
  "id": "003",
  "code": "task 从PubChem下载候选分子",
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
上下文：分子筛选流程 第3步/共12步
前置任务：#002 (success) - 确认筛选指标为LogP<5, MW<500
输出文件：.plan-control/nodes/node-003.json
输出格式：见 .plan-control/output-format.md
[/PLAN-CONTROL]
```

当节点为赋值型 `var = task ...` 时，附加返回要求：

```
[PLAN-CONTROL] 任务 #001
指令：查询所有开源分子数据库并返回名称列表
上下文：分子筛选流程 第1步/共12步
输出文件：.plan-control/nodes/node-001.json
输出格式：见 .plan-control/output-format.md
返回要求：result 字段请填写为字符串列表，如 ["PubChem", "ZINC"]
[/PLAN-CONTROL]
```

## 执行器行为

### 状态机

```
IDLE → 选择下一行代码
  → 非 task 行（变量定义/for/if/func）→ 内部处理 → 回到选择
  → task 行 → Parser 生成指令块 → 创建 node-XXX.json → 发送到 terminal → WAITING

WAITING → 监测两个信号：
  1. node-XXX.json 文件变化（fs.watch）→ 读取 result → PROCESSING
  2. PTY 空闲超过阈值（默认60秒）且 JSON 未更新 → 发送催促 → 留在 WAITING
     催促最多 3 次 → 仍无响应 → 标记 blocked → PROCESSING

PROCESSING → 根据 result + 代码上下文决定：
  - success/failed/blocked → 更新 state.json → 评估 if/for/loop → 回到 IDLE
  - replan → 暂停 → 向 terminal 发送 replan 指令 → 等待 AI 修改 main.pc
    → 重新语法检查 → 从修改点继续
```

### 催促机制

- 监测 PTY `onData` 时间戳，空闲超过可配置阈值（默认 60 秒）
- 且对应 node-XXX.json 的 status 仍为 null
- 发送固定催促文本："请继续当前任务。如果已完成，请按照 .plan-control/output-format.md 的格式更新 .plan-control/nodes/node-XXX.json"
- 最多催促 3 次（间隔递增：60s / 120s / 240s）
- 3 次仍无响应 → 标记为 `blocked`，通知用户

### replan 处理

1. AI 在 node JSON 中返回 `status: "replan"` + `replan_reason`
2. 执行器暂停执行，状态变为 `replanning`
3. 向 terminal 发送：修改 main.pc 中从第 X 行开始的计划，并说明变更原因，修改完成后更新 node-XXX.json status 为 success
4. AI 修改 main.pc 后回填 JSON
5. 执行器重新语法检查 main.pc → 通过则从变更点继续

## 后端实现

### 新增文件

| 文件 | 职责 |
|------|------|
| `backend/src/plan-control/checker.ts` | pc 语法检查器（词法分析 + 语法验证） |
| `backend/src/plan-control/parser.ts` | pc 解析器（AST 构建 + 指令块生成） |
| `backend/src/plan-control/executor.ts` | 执行状态机（节点调度 + 文件监测 + 催促） |
| `backend/src/plan-control/types.ts` | 类型定义（AST 节点、状态、配置） |
| `backend/src/plan-control/templates.ts` | 初始化模板文件内容（init.md, plan-code.md, output-format.md） |
| `backend/src/routes/plan-control.ts` | REST API 路由 |

### REST API

| Method | Endpoint | 用途 |
|--------|----------|------|
| `POST` | `/api/projects/:id/plan/init` | 初始化 .plan-control/ 目录 |
| `GET` | `/api/projects/:id/plan/status` | 获取执行状态（state.json） |
| `POST` | `/api/projects/:id/plan/check` | 语法检查 main.pc |
| `POST` | `/api/projects/:id/plan/start` | 启动执行 |
| `POST` | `/api/projects/:id/plan/pause` | 暂停执行 |
| `POST` | `/api/projects/:id/plan/stop` | 停止执行 |
| `GET` | `/api/projects/:id/plan/nodes` | 获取所有节点状态 |
| `GET` | `/api/projects/:id/plan/nodes/:nodeId` | 获取单个节点详情 |

### WebSocket 事件

| 方向 | Type | 用途 |
|------|------|------|
| Server → Client | `plan_status` | 执行状态变化（started/paused/stopped/completed） |
| Server → Client | `plan_node_update` | 节点状态更新（started/completed/failed/blocked） |
| Server → Client | `plan_nudge` | 催促事件（通知前端显示） |
| Server → Client | `plan_replan` | replan 事件 |

## 前端实现

### PlanPanel 组件

放在 LeftPanel 新增的 tab 中（与文件树、Git 平级），包含：

**未初始化状态**：
- "初始化 Plan Control" 按钮

**已初始化/编辑中**：
- main.pc 代码预览（语法高亮，只读）
- "检查语法" 按钮
- 检查结果（错误列表或通过提示）

**就绪**：
- "启动" 按钮

**执行中**：
- 进度条（已完成/总数）
- 当前执行节点高亮
- 节点列表：编号、描述、状态图标（✓ success / ✗ failed / ⏳ running / ⚠ blocked / 🔄 replan）
- 展开节点查看 summary
- "暂停" / "停止" 按钮

**暂停/停止**：
- 节点历史（可折叠）
- "继续" / "重新启动" 按钮

## 配置

通过 state.json 或项目设置可配置：

| 配置项 | 默认值 | 说明 |
|--------|--------|------|
| `nudge_idle_seconds` | 60 | AI 空闲多久后发送催促 |
| `nudge_max_count` | 3 | 最大催促次数 |
| `nudge_interval_multiplier` | 2 | 催促间隔递增倍数 |
