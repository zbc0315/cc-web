/**
 * Extract input/output variable keys from a prompt template.
 * Inputs are `@{key}`, outputs are `${key}`.
 * Returns deduplicated keys in first-occurrence order.
 *
 * spec §6.2 / §7：M1 仅做提取，不做求值或转译。
 */

const VALID_KEY_RE = /^[a-zA-Z_][a-zA-Z0-9_]*$/

function extractKeys(template: string, prefix: '@' | '$'): string[] {
  const re = prefix === '@'
    ? /@\{([^}]*)\}/g
    : /\$\{([^}]*)\}/g
  const seen = new Set<string>()
  const out: string[] = []
  let m: RegExpExecArray | null
  while ((m = re.exec(template)) !== null) {
    const key = m[1] ?? ''
    if (VALID_KEY_RE.test(key) && !seen.has(key)) {
      seen.add(key)
      out.push(key)
    }
  }
  return out
}

export function extractInputs(template: string): string[] {
  return extractKeys(template, '@')
}

export function extractOutputs(template: string): string[] {
  return extractKeys(template, '$')
}
