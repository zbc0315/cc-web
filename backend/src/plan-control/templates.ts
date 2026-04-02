// backend/src/plan-control/templates.ts

export const INIT_MD = `# Plan-Control 初始化指引

你现在处于 Plan-Control 初始化模式。请按以下步骤操作：

## 第一步：深度访谈

对用户进行深度访谈，了解：
1. 具体目标和预期成果
2. 当前可用资源（计算资源、远程服务器、API、数据库等）
3. 约束条件和优先级
4. 成功标准

## 第二步：制定计划

基于访谈结果，制定详细的执行计划。

## 第三步：初始化 Git 仓库

如果项目目录尚未初始化 Git，请执行 \\\`git init\\\` 并完成首次 commit。后续每个任务节点执行前后都必须进行 Git commit，以保证每步工作可追溯、可回滚。

## 第四步：编写 main.pc

依据 .plan-control/plan-code.md 中的 pc 语言规范，将计划编写为 .plan-control/main.pc 文件。

## 反馈通道

在编写 main.pc 的过程中，如果你发现当前 pc 语言的语法规范限制了你对计划的表达——例如缺少某种控制结构、变量操作不够灵活、无法描述某类任务依赖等——请将你的反馈写入 \\\`.plan-control/dsl-feedback.md\\\` 文件。

反馈内容可以包括：
- 你想表达但无法实现的计划逻辑
- 你认为缺失或需要改进的语法特性
- 具体的场景描述和你期望的写法

这些反馈会帮助我们持续改进 pc 语言。请放心提出，不会影响当前计划的执行。
`;

export const OUTPUT_FORMAT_MD = `# 节点输出格式

任务完成后，请更新指定的 JSON 文件，严格按以下格式：

\\\`\\\`\\\`json
{
  "status": "success | failed | blocked | replan",
  "result": null,
  "summary": "",
  "request_replan": false,
  "replan_reason": ""
}
\\\`\\\`\\\`

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
\\\`\\\`\\\`json
{
  "status": "success",
  "result": ["PubChem", "NIST"],
  "summary": "检测到2个可用的开源分子数据库"
}
\\\`\\\`\\\`

任务失败：
\\\`\\\`\\\`json
{
  "status": "failed",
  "result": false,
  "summary": "PubChem API 返回 503，服务暂时不可用"
}
\\\`\\\`\\\`
`;

export const PLAN_CODE_MD = `# pc 语言规范

## 基础语法

- 固定 2 空格缩进（不允许 tab）
- 任务描述为纯自然语言，不需要引号
- 变量引用统一使用 \\\`\${变量名}\\\` 语法

## 关键字

| 关键字 | 示例 |
|--------|------|
| task | \\\`task 从PubChem下载候选分子\\\` |
| if/elif/else | \\\`if success:\\\` / \\\`elif failed:\\\` / \\\`else:\\\` |
| for...in | \\\`for db in \${databases}:\\\` |
| loop N | \\\`loop 3:\\\` / \\\`loop 5 as i:\\\` |
| func/call | \\\`func 计算(targets):\\\` / \\\`call 计算(\${molecules})\\\` |
| break | 跳出最内层循环 |
| continue | 跳到下一次迭代 |
| return | 从函数返回 |

## 变量

静态定义（仅列表）：
\\\`\\\`\\\`
databases = [PubChem, ZINC, ChEMBL]
\\\`\\\`\\\`

动态赋值（task返回值）：
\\\`\\\`\\\`
results = task 查询所有数据库
\\\`\\\`\\\`

## 条件判断

基于最近 task 的状态：\\\`success\\\` / \\\`failed\\\` / \\\`blocked\\\`
变量条件：\\\`if \${has_gpu}:\\\` 检查 truthy

## 编写规则

### 1. \\\`task\\\` 是单行指令，不是 section header

每条 \\\`task\\\` 必须写成一行，把所有上下文信息压缩进这一行的自然语言描述中。
task 后面不能跟缩进的子内容——解析器会将缩进内容视为控制流块。

\\\`\\\`\\\`
# ✅ 正确：单行 task，描述完整具体
task 创建Vite+Babylon.js项目结构(package.json/vite.config.js/index.html/src/main.js)
task 配置3D场景(ArcRotateCamera/环境光/聚光灯/实验室地板墙壁/雾效)

# ❌ 错误：把 task 当成标题，下面跟多行描述
task 初始化项目
  创建基于Vite的项目结构:
  - package.json配置依赖
  - vite.config.js配置
\\\`\\\`\\\`

### 2. \\\`call\\\` 只接受字面函数名，不支持动态分派

\\\`call\\\` 后面必须写定义过的函数名，不能用变量（\\\`call \${name}\\\` 是非法的）。

\\\`\\\`\\\`
# ✅ 正确
func 处理数据(source):
  task 从\${source}下载并处理数据

call 处理数据(\${db_name})

# ❌ 错误：call 不支持变量做函数名
tasks = [初始化, 构建, 测试]
for t in \${tasks}:
  call \${t}
\\\`\\\`\\\`

### 3. 顺序执行不需要列表+循环

如果任务之间是简单的顺序依赖，直接逐行写 task 即可。
只有"对一组同类数据执行相同操作"时才需要 for 循环。

\\\`\\\`\\\`
# ✅ 正确：顺序任务直接逐行写
task 初始化项目结构
task 创建3D场景基础
task 构建仪器模型
task 添加用户交互
task 测试验证

# ❌ 错误：把步骤名塞进列表再循环——无意义的复杂化
steps = [初始化, 场景, 模型, 交互, 测试]
for s in \${steps}:
  task 执行\${s}
\\\`\\\`\\\`

### 4. main.pc 中不要写大段 Markdown 文档

注释（\\\`#\\\` 开头）用于简短说明即可。项目概述、技术选型、详细需求等信息应该在访谈阶段与用户确认，不需要写入 main.pc。main.pc 要保持精简——它是执行蓝图，不是项目文档。

### 5. for 循环的正确场景：同类操作 × 多个数据

\\\`\\\`\\\`
# ✅ 正确：10种仪器执行相同的建模操作
instruments = [XRD, FT-IR, Raman, NMR, MS, UV-Vis, GC-MS, LC-MS, XPS, AAS]
for inst in \${instruments}:
  task 为\${inst}创建程序化3D模型并添加PBR材质
\\\`\\\`\\\`

### 其他注意事项

- 使用 2 空格缩进
- task 描述要具体明确，执行时的 AI 能理解上下文
- 合理使用 if/for/loop 控制流
- 需要返回值时使用 \\\`变量 = task 描述\\\` 语法

## 完整示例

\\\`\\\`\\\`
methods = [ML预测, xtb计算, DFT计算]

func 性质计算(targets, method_list):
  for m in \${method_list}:
    results = task 使用\${m}计算\${targets}的性质
    if success:
      return
  task 所有方法均失败，请分析原因

databases = task 查询所有开源分子数据库
for db in \${databases}:
  task 从\${db}下载候选分子
  if success:
    molecules = task 提取候选分子列表
    call 性质计算(\${molecules}, \${methods})
    break

task 生成最终报告
\\\`\\\`\\\`
`;
