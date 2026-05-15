/**
 * Built-in functions / values available to every train program.
 *
 * Per spec §2.9 (deliberately conservative — no I/O / network / shell).
 * Side-effectful operations live behind `fai` (LLM-driven) and are
 * provided by adapters, not core.
 *
 * `log` is a namespace value (object) holding info / warn / error
 * builtins; user code calls `log.info("…")` which the interpreter
 * resolves as MemberExpr on the `log` binding.
 */
import { type Value } from './runtime.js';
declare function formatValue(v: Value): string;
export declare function defaultBuiltinBindings(): Map<string, Value>;
declare function deepEq(a: Value, b: Value): boolean;
export { deepEq, formatValue };
//# sourceMappingURL=builtins.d.ts.map