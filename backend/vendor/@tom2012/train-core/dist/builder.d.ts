/**
 * CST → typed AST visitor.
 *
 * Uses chevrotain's CST visitor pattern. Each `visit*` method
 * corresponds to one grammar rule in `parser.ts` and produces the
 * matching AST node from `ast.ts`.
 *
 * Conventions:
 * - Method name MUST equal the parser rule name (chevrotain dispatch).
 * - `ctx` carries children grouped by rule name (CstNode[]) or token
 *   name (IToken[]). Optional rules / tokens may be missing entirely;
 *   we read with safe defaults.
 * - All AST nodes carry a `range` derived from the spanning CST/Token.
 */
import type { CstNode } from 'chevrotain';
import * as ast from './ast.js';
/**
 * Build a typed AST from a parser CST. Returns null if no CST (parse failed).
 */
export declare function buildAst(cst: CstNode | undefined): ast.Program | null;
//# sourceMappingURL=builder.d.ts.map