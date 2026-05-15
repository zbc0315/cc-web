/**
 * Typed Abstract Syntax Tree for train language.
 *
 * The AST is what later stages (type checker, interpreter, formatter)
 * consume. It is produced from the CST by the visitor in `builder.ts`.
 *
 * Design choices:
 * - Every node has a `kind` discriminator (TypeScript narrowing)
 * - Every node has a `range` carrying source location for diagnostics
 * - Numeric / string / bool literals are pre-parsed to their JS values
 * - String escape sequences are unescaped
 * - All node names are PascalCase nominal types
 */
export {};
//# sourceMappingURL=ast.js.map