/**
 * Browser-safe parser entry. Bypasses @tom2012/train-core's index.js so
 * we don't pull in ast-cache.ts / module-loader.ts (which import
 * node:fs and node:path). Subpath exports were added to train-lang's
 * package.json specifically to enable this.
 */

import { parse } from '@tom2012/train-core/parser'
import { buildAst } from '@tom2012/train-core/builder'

export interface ParseToAstResult {
  ast: ReturnType<typeof buildAst> | null
  lexErrors: ReadonlyArray<unknown>
  parseErrors: ReadonlyArray<unknown>
}

/**
 * NEVER-THROW contract. Chevrotain normally collects parse errors into
 * `parser.errors`, but partial inputs (mid-typing) plus certain GATE
 * paths in the parser can let a MismatchedTokenException escape. We
 * wrap both `parse` and `buildAst` in try/catch so any thrown exception
 * is converted into a synthetic parseError, keeping the caller free of
 * `Uncaught (in promise)` traces in production.
 *
 * v2026.5.15-b shipped without this guard → users editing .tr saw
 *   "Uncaught (in promise) MismatchedTokenException: Expecting
 *    Identifier but found 'let'"
 * in DevTools and Track editor froze.
 */
export function parseToAst(source: string): ParseToAstResult {
  let parseR
  try {
    parseR = parse(source)
  } catch (e) {
    return {
      ast: null,
      lexErrors: [],
      parseErrors: [
        {
          name: (e as Error).name ?? 'ParseException',
          message: (e as Error).message ?? String(e),
          token: { startLine: 1, startColumn: 1, image: '' },
        },
      ],
    }
  }
  const hasErrors =
    parseR.lexErrors.length > 0 || parseR.parseErrors.length > 0
  if (hasErrors || !parseR.cst) {
    return {
      ast: null,
      lexErrors: parseR.lexErrors,
      parseErrors: parseR.parseErrors,
    }
  }
  let ast: ReturnType<typeof buildAst> | null = null
  try {
    ast = buildAst(parseR.cst)
  } catch (e) {
    return {
      ast: null,
      lexErrors: parseR.lexErrors,
      parseErrors: [
        ...parseR.parseErrors,
        {
          name: (e as Error).name ?? 'BuildAstException',
          message: `buildAst crashed: ${(e as Error).message ?? String(e)}`,
          token: { startLine: 1, startColumn: 1, image: '' },
        },
      ],
    }
  }
  return {
    ast,
    lexErrors: parseR.lexErrors,
    parseErrors: parseR.parseErrors,
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
