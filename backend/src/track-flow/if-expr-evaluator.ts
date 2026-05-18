import type { IfExprAst } from './if-expr-parser'

/**
 * Evaluate an IfExprAst against a runtime scope (train.json snapshot).
 * Returns boolean. Designed to NEVER throw — spec §5.4 null-safe semantics:
 *
 *  - `x == null` / `null == x` / `x != null` / `null != x` → strict === / !==
 *  - 其他与 null 比较（如 `x == 5` 当 x=null）→ false（不报错）
 *  - 关系算子两边任一为 null → false
 *  - 类型不匹配（如 `"abc" > 5`）→ false
 *  - && / || 短路：null 视为 falsy
 *  - 未定义变量 = null
 */
export function evaluateIfExpr(ast: IfExprAst, scope: Record<string, unknown>): boolean {
  return !!evaluateValue(ast, scope)
}

/** Returns the raw value of the expression (used internally for short-circuit). */
function evaluateValue(ast: IfExprAst, scope: Record<string, unknown>): unknown {
  if (ast.kind === 'literal') return ast.value
  if (ast.kind === 'var') {
    const v = scope[ast.name]
    return v === undefined ? null : v
  }
  if (ast.kind === 'and') {
    const lv = evaluateValue(ast.left, scope)
    if (!isTruthy(lv)) return false
    const rv = evaluateValue(ast.right, scope)
    return isTruthy(rv)
  }
  if (ast.kind === 'or') {
    const lv = evaluateValue(ast.left, scope)
    if (isTruthy(lv)) return true
    const rv = evaluateValue(ast.right, scope)
    return isTruthy(rv)
  }
  // compare
  const left = evaluateValue(ast.left, scope)
  const right = evaluateValue(ast.right, scope)
  const op = ast.op

  // null-safe equality
  if (op === '==') return left === right
  if (op === '!=') return left !== right

  // relational ops: 任一边为 null → false
  if (left === null || right === null) return false

  // 类型匹配才比较
  if (typeof left === 'number' && typeof right === 'number') {
    if (op === '>') return left > right
    if (op === '<') return left < right
    if (op === '>=') return left >= right
    if (op === '<=') return left <= right
  }
  // 字符串：仅 == / != 处理过；> / < 不支持 → false
  return false
}

function isTruthy(v: unknown): boolean {
  if (v === null || v === undefined) return false
  if (v === false || v === 0 || v === '') return false
  return true
}
