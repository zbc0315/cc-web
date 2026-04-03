# 节点输出格式

任务完成后，请更新指定的 JSON 文件，严格按以下格式：

\`\`\`json
{
  "status": "success | failed | blocked | replan",
  "result": null,
  "summary": "",
  "request_replan": false,
  "replan_reason": ""
}
\`\`\`

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
\`\`\`json
{
  "status": "success",
  "result": ["PubChem", "NIST"],
  "summary": "检测到2个可用的开源分子数据库"
}
\`\`\`

任务失败：
\`\`\`json
{
  "status": "failed",
  "result": false,
  "summary": "PubChem API 返回 503，服务暂时不可用"
}
\`\`\`
