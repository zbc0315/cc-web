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

## 第三步：编写 main.pc

依据 .plan-control/plan-code.md 中的 pc 语言规范，将计划编写为 .plan-control/main.pc 文件。

注意事项：
- 使用 2 空格缩进
- task 描述要具体明确，AI 执行时能理解
- 合理使用 if/for/loop 控制流
- 需要返回值时使用 \\\`变量 = task 描述\\\` 语法
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
