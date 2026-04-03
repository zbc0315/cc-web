# pc 语言规范

## 基础语法

- 固定 2 空格缩进（不允许 tab）
- 任务描述为纯自然语言，不需要引号
- 变量引用统一使用 \`${变量名}\` 语法

## 关键字

| 关键字 | 示例 |
|--------|------|
| task | \`task 从PubChem下载候选分子\` |
| if/elif/else | \`if success:\` / \`elif failed:\` / \`else:\` |
| for...in | \`for db in ${databases}:\` |
| loop N | \`loop 3:\` / \`loop 5 as i:\` |
| func/call | \`func 计算(targets):\` / \`call 计算(${molecules})\` |
| break | 跳出最内层循环 |
| continue | 跳到下一次迭代 |
| return | 从函数返回 |

## 变量

静态定义（仅列表）：
\`\`\`
databases = [PubChem, ZINC, ChEMBL]
\`\`\`

动态赋值（task返回值）：
\`\`\`
results = task 查询所有数据库
\`\`\`

## 条件判断

基于最近 task 的状态：\`success\` / \`failed\` / \`blocked\`
变量条件：\`if ${has_gpu}:\` 检查 truthy

## 完整示例

\`\`\`
methods = [ML预测, xtb计算, DFT计算]

func 性质计算(targets, method_list):
  for m in ${method_list}:
    results = task 使用${m}计算${targets}的性质
    if success:
      return
  task 所有方法均失败，请分析原因

databases = task 查询所有开源分子数据库
for db in ${databases}:
  task 从${db}下载候选分子
  if success:
    molecules = task 提取候选分子列表
    call 性质计算(${molecules}, ${methods})
    break

task 生成最终报告
\`\`\`
