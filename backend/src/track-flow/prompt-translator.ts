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
 * (output) placeholders with descriptive metadata, then optionally append
 * a system instruction section telling the LLM to modify train.json.
 *
 * spec §7：
 *  - @{key} → `key(description)='<value>'`
 *  - ${key} → `修改变量 key(description;记录路径为 train.json 中的 key:key)=<value> 为...`
 *  - 末尾系统指令段（仅 outputs 非空时）
 *
 * Unknown keys (not in `variables`) are preserved literally to aid debugging.
 */
export function translatePrompt(
  template: string,
  variables: VarDecl[],
  snapshot: Record<string, unknown>,
  outputs: string[],
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
    return `修改变量 ${key}(${decl.description};记录路径为 train.json 中的 key:${key})=${formatValue(snapshot[key] ?? null)} 为...`
  })

  if (outputs.length > 0) {
    result += '\n\n' + buildSystemInstruction(outputs)
  }
  return result
}

function buildSystemInstruction(outputs: string[]): string {
  return [
    '【系统指令】',
    '本工作轨的全局变量记录在当前目录的 train.json 文件中。',
    '本节点完成时，请用 Edit/Write 工具修改 train.json 文件，',
    `更新以下字段：${outputs.join(', ')}`,
    '（其他字段不要改）。完成修改后告知"已写入"。',
  ].join('\n')
}
