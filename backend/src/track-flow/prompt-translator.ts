export interface VarDecl {
  key: string
  description: string
  initialValue: unknown
}

/**
 * Format a value for embedding inside a translated prompt.
 *  - null/undefined → `null`
 *  - string → `'<value>'`（用单引号，转义内部 \' 和 \\）
 *  - number / bool → 字面量无引号
 *  - object/array → JSON.stringify 后用单引号包
 */
function formatValue(v: unknown): string {
  if (v === null || v === undefined) return 'null'
  if (typeof v === 'string') return `'${v.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`
  if (typeof v === 'number' || typeof v === 'boolean') return String(v)
  return `'${JSON.stringify(v).replace(/'/g, "\\'")}'`
}

/**
 * Translate a prompt template by replacing @{key} (input) and ${key}
 * (output) placeholders with descriptive metadata, then append the
 * v-j 系统指令段告诉 LLM：
 *   - 业务变量存 `.ccweb-flow-train.json`（${key} 引用的字段最好也更新）
 *   - 运行进度存 `.ccweb/tracks/<basename>.run-state.json`
 *   - 完成任务后必须改 run-state.json 把 `nodes.<nodeId>.done` 设为 true
 *   - 任务不可完成时把 `nodes.<nodeId>.failed` 设为 true + 写 reason 字符串
 *
 * spec §7（v-j 修订）：完成判定从 "outputs 改了 = 完成" 改为 "LLM 自报 done=true"，
 * 避免 LLM 第一次 Edit 就被强制结束节点（影响多步操作场景）。
 *
 * v-19-b：发给 LLM 的英文化（CLI LLM 对英文 prompt 执行更稳定）。变量
 * description 字段是用户数据，保留原始（多语言）。codex P1 顺修：所有提到 run-state.json
 * 的句子都用完整路径插值，防止 LLM 误改项目根的 run-state.json；P2 加 done/failed
 * 互斥提示 + outputs 更新指令用显式 slot 替代 `to ...` 省略号。
 *
 * Unknown keys (not in `variables`) are preserved literally to aid debugging.
 */
export function translatePrompt(
  template: string,
  variables: VarDecl[],
  snapshot: Record<string, unknown>,
  outputs: string[],
  ctx?: { basename: string; nodeId: string },
): string {
  const byKey = new Map<string, VarDecl>(variables.map((v) => [v.key, v]))

  let result = template.replace(/@\{(\w+)\}/g, (_m, key: string) => {
    const decl = byKey.get(key)
    if (!decl) return `@{${key}}`
    return `${key}(${decl.description})=${formatValue(snapshot[key] ?? null)}`
  })

  result = result.replace(/\$\{(\w+)\}/g, (_m, key: string) => {
    const decl = byKey.get(key)
    if (!decl) return `\${${key}}`
    return `Update variable ${key}(${decl.description}; stored at .ccweb-flow-train.json under key:${key}). Current value: ${formatValue(snapshot[key] ?? null)}. Write the new value.`
  })

  // 系统指令始终追加（v-j：即便 outputs 为空，也得告诉 LLM 通过 done flag 结束节点）
  result += '\n\n' + buildSystemInstruction(outputs, ctx)
  return result
}

function buildSystemInstruction(
  outputs: string[],
  ctx?: { basename: string; nodeId: string },
): string {
  const runStatePath = ctx
    ? `.ccweb/tracks/${ctx.basename}.run-state.json`
    : '.ccweb/tracks/<basename>.run-state.json'
  const nodeId = ctx?.nodeId ?? '<node-id>'
  const lines = [
    '[System Instructions]',
    'Runtime progress is recorded in `' + runStatePath + '` (path is relative to the project root).',
    `This node's id is \`${nodeId}\`; its state lives under \`nodes.${nodeId}\` in that file.`,
    '',
    `After completing this node's task, use the Edit/Write tool to modify \`${runStatePath}\`:`,
    `  Set \`nodes.${nodeId}.done\` to true.`,
    '',
    `If the task cannot be completed (e.g. invalid user input, unavailable resource), modify \`${runStatePath}\`:`,
    `  Set \`nodes.${nodeId}.failed\` to true and set \`nodes.${nodeId}.reason\` to a string explaining why.`,
    '',
    `Rules: set exactly one of \`done\` or \`failed\` to true (never both). Do not modify other fields under \`nodes.${nodeId}\` (such as \`iter\`, \`status\`, \`type\`) — ccweb manages those.`,
    '',
    `ccweb watches \`${runStatePath}\` in real time: once done=true the next node starts; once failed=true the entire flow stops.`,
    'Until you mark done/failed, ccweb does NOT advance — you may perform multiple steps before marking.',
  ]
  if (outputs.length > 0) {
    lines.push(
      '',
      'Business variables live in `.ccweb-flow-train.json`. Output fields declared by this node: ' + outputs.join(', '),
      '(Please update these fields with Edit/Write during the task; missing updates are logged as a warning in the audit log but do not block progress.)',
    )
  }
  return lines.join('\n')
}
