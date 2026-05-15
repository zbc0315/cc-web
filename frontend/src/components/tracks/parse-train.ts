/**
 * Browser-safe parser entry. Bypasses @train-lang/core's index.js so
 * we don't pull in ast-cache.ts / module-loader.ts (which import
 * node:fs and node:path). Subpath exports were added to train-lang's
 * package.json specifically to enable this.
 */

import { parse } from '@train-lang/core/parser'
import { buildAst } from '@train-lang/core/builder'

export interface ParseToAstResult {
  ast: ReturnType<typeof buildAst> | null
  lexErrors: ReadonlyArray<unknown>
  parseErrors: ReadonlyArray<unknown>
}

export function parseToAst(source: string): ParseToAstResult {
  const r = parse(source)
  const hasErrors = r.lexErrors.length > 0 || r.parseErrors.length > 0
  return {
    ast: hasErrors || !r.cst ? null : buildAst(r.cst),
    lexErrors: r.lexErrors,
    parseErrors: r.parseErrors,
  }
}

/**
 * Empty result used as the initial state and as a fallback when the
 * parser crashes. Keeps consumers from having to null-check ast.
 */
export const EMPTY_PARSE_RESULT: ParseToAstResult = {
  ast: null,
  lexErrors: [],
  parseErrors: [],
}
