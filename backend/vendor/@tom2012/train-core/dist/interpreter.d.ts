/**
 * train language interpreter — M3.
 *
 * Compared to M2 this revision:
 *  - is fully async (every evalExpr / execStmt / callFunc returns Promise),
 *    so fai calls can suspend on awaited adapter responses without
 *    blocking the event loop
 *  - implements real fai execution via an injected LLMAdapter:
 *    composes a prompt, dispatches to adapter.call, validates outputs,
 *    re-prompts with feedback on validation failures up to maxAttempts
 *  - falls back to the M2 "no adapter installed" RuntimeError if no
 *    adapter is configured
 *
 * Out of scope (later milestones):
 *  - Persistent stack-frame serialization (M3+)
 *  - Subflow / module loading (M5)
 *  - Cancellation propagation through fai (needs interpreter-level AbortController)
 */
import * as ast from './ast.js';
import { type Value, type FunctionValue, type Scope, type RuntimeContext, TrainException } from './runtime.js';
import type { LLMAdapter } from '@tom2012/train-adapter-spec';
import { type ModuleRegistry } from './module-loader.js';
export interface RunResult {
    ok: boolean;
    value: Value | null;
    error?: TrainException;
}
export interface InterpreterConfig {
    adapter?: LLMAdapter;
    /** Total attempts per fai call (initial + retries). Default 3. */
    maxFaiAttempts?: number;
    /** Per-fai-call timeout in ms (passed to adapter). Default 600000. */
    defaultFaiTimeoutMs?: number;
    /** Adapter-specific model id (passed to adapter). */
    model?: string;
    /**
     * Host-supplied "how to write outputs" hint appended to every fai
     * prompt. Replaces the built-in direct-API or agent-CLI hint.
     * Hosts with their own PTY protocol (ccweb, etc.) supply theirs here.
     * See prompt-composer.ts ComposeOptions.writeProtocolHint.
     */
    writeProtocolHint?: string;
    /**
     * AbortSignal forwarded to every adapter call's FaiCallOptions.signal.
     * When aborted, adapters that honor cancellation should resolve with
     * `{ kind: "cancelled" }`. The interpreter additionally short-circuits
     * pending retries once the signal fires.
     */
    signal?: AbortSignal;
}
export declare class Interpreter {
    private ctx;
    private faiCallCounter;
    private readonly adapter?;
    private readonly maxFaiAttempts;
    private readonly defaultFaiTimeoutMs;
    private readonly model?;
    private readonly writeProtocolHint?;
    private readonly hostSignal?;
    constructor(ctx: RuntimeContext, cfg?: InterpreterConfig);
    evalExpr(expr: ast.Expr, scope: Scope): Promise<Value>;
    private evalIdent;
    private evalTemplate;
    private evalUnary;
    private evalBinary;
    private getMember;
    private getIndex;
    private evalCall;
    callFunc(fn: FunctionValue, args: Value[], range?: ast.Range): Promise<Value>;
    /**
     * Execute a fai call: compose prompt → adapter.call → validate →
     * retry-with-feedback loop. Returns the validated outputs as a single
     * object (containing one key per declared output).
     */
    callFai(fn: FunctionValue, args: Value[], range?: ast.Range): Promise<Value>;
    execBlock(block: ast.Block, scope: Scope): Promise<void>;
    execStmt(stmt: ast.Stmt, scope: Scope): Promise<void>;
    private execLet;
    private bindLetTarget;
    private execAssign;
    private followSuffix;
    private setSuffix;
    private applyCompound;
    private execIf;
    private execFor;
    private iterable;
    private execWhile;
    private execTry;
    private truthy;
}
export interface RunOptions extends InterpreterConfig {
    entry?: string;
    args?: Value[];
    extraBuiltins?: Map<string, Value>;
    /**
     * Absolute path of the entry .tr file. Required when the program
     * contains `import` statements so submodule paths can be resolved.
     * Default: no module support (imports throw).
     */
    entryFile?: string;
    /**
     * Shared module registry. Reused across submodules in one run so the
     * cache hits and circular detection work. Default: a fresh registry.
     */
    moduleRegistry?: ModuleRegistry;
    /** Internal: importer stack (used by recursive submodule execution). */
    __importerStack?: string[];
}
export declare function runProgram(program: ast.Program, opts?: RunOptions): Promise<RunResult>;
//# sourceMappingURL=interpreter.d.ts.map