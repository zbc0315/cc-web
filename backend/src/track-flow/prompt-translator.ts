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
    return `修改变量 ${key}(${decl.description};记录路径为 .ccweb-flow-train.json 中的 key:${key})=${formatValue(snapshot[key] ?? null)} 为...`
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
  const nodeId = ctx?.nodeId ?? '<节点 id>'
  const lines = [
    '【系统指令】',
    '运行进度记录在文件 `' + runStatePath + '`（相对当前项目根目录）。',
    `本节点 id 为 \`${nodeId}\`，状态在该文件的 \`nodes.${nodeId}\` 下。`,
    '',
    '完成本节点的任务后，请用 Edit/Write 工具修改 run-state.json：',
    `  把 \`nodes.${nodeId}.done\` 设为 true。`,
    '',
    '如果任务无法完成（如用户输入不合理 / 资源不可用），请改 run-state.json：',
    `  把 \`nodes.${nodeId}.failed\` 设为 true，并把 \`nodes.${nodeId}.reason\` 设为字符串（说明原因）。`,
    '',
    'ccweb 实时监听该文件；done=true 后进入下一节点，failed=true 后停止整个工作轨。',
    '在 done/failed 标记前 ccweb 不会推进，**LLM 可以多步交互后再标记**。',
  ]
  if (outputs.length > 0) {
    lines.push('', '业务变量在 `.ccweb-flow-train.json`，本节点声明的输出字段：' + outputs.join(', '),
      '（任务过程中也请用 Edit/Write 更新这些字段，未更新会在 audit log 留 warning 但不阻塞）。')
  }
  return lines.join('\n')
}
