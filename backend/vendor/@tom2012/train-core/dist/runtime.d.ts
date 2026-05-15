/**
 * Runtime value model + execution state for the train interpreter.
 *
 * For this milestone the interpreter executes everything in process
 * memory; persistent stack-frame serialization (needed for fai
 * suspend/resume) will be added in M3 when LLM adapters arrive.
 */
import type * as ast from './ast.js';
/** Runtime values. Mirrors train's surface types. */
export type Value = null | boolean | number | string | Value[] | {
    [key: string]: Value;
} | FunctionValue;
/**
 * Functions (both `func` and `fai`) are first-class only internally —
 * they are stored in the runtime context as named bindings, NOT in
 * user variables. Source code cannot create them as expression values.
 */
export interface FunctionValue {
    readonly __kind: 'function';
    readonly name: string;
    readonly isFai: boolean;
    readonly decl: ast.FuncDecl | ast.FaiDecl;
    /** The lexical scope where the function was defined. */
    readonly definedIn: Scope;
    /**
     * The module-level RuntimeContext this function was defined in. The
     * interpreter swaps to this context on entry so identifier lookup
     * resolves against the function's own module (E0xx M5 module
     * isolation). Optional for backward compat — bindings created before
     * M5 share the caller's context.
     */
    readonly moduleCtx?: RuntimeContext;
}
export declare function isFunctionValue(v: Value): v is FunctionValue;
/** A lexical scope: chain of binding maps. */
export interface Scope {
    parent: Scope | null;
    bindings: Map<string, Value>;
}
export declare function newScope(parent?: Scope | null): Scope;
export declare function scopeLookup(scope: Scope, name: string): Value | undefined;
/**
 * Assign to an existing binding in the closest scope where it's
 * defined. Returns false if no such binding exists (caller decides
 * whether to error or create one).
 */
export declare function scopeAssign(scope: Scope, name: string, value: Value): boolean;
/** Runtime context for a whole program execution. */
export interface RuntimeContext {
    /** Top-level constants (immutable at runtime). */
    constants: Map<string, Value>;
    /** Top-level `var` globals (mutable). */
    globals: Map<string, Value>;
    /** Named function declarations (func + fai). */
    functions: Map<string, FunctionValue>;
    /** Builtins registered before execution. */
    builtins: Map<string, BuiltinFunction>;
    /** Names that are publicly exported from this program. */
    exports: Map<string, string>;
}
export interface BuiltinFunction {
    readonly __kind: 'builtin';
    readonly name: string;
    /**
     * Builtin call signature. Built-ins MAY return a Promise<Value> to
     * support async operations (host I/O, ask_user-style user prompts,
     * shell-out, etc.). The interpreter awaits the return value before
     * proceeding.
     *
     * Synchronous builtins simply return Value directly — no Promise
     * wrapping required.
     */
    call(args: Value[]): Value | Promise<Value>;
}
export declare function makeBuiltin(name: string, call: (args: Value[]) => Value | Promise<Value>): BuiltinFunction;
export declare function isBuiltin(v: unknown): v is BuiltinFunction;
export declare class TrainReturnSignal {
    readonly value: Value | null;
    constructor(value: Value | null);
}
export declare class TrainBreakSignal {
}
export declare class TrainContinueSignal {
}
/**
 * Stable error code registry. Every TrainException SHOULD carry one of
 * these codes; the codes are reviewed and documented in
 * `docs/error-codes.md`. The lint script
 * `scripts/check-error-codes.ts` verifies code/docs consistency.
 *
 * Conventions:
 *   E01xx — lex errors
 *   E02xx — parse errors
 *   E03xx — type / declaration errors
 *   E04xx — runtime evaluation errors
 *   E05xx — module loader errors
 *   E06xx — fai / adapter errors
 *   E07xx — validation errors
 *   E08xx — i/o + state-dir + cache errors
 *   E99xx — uncoded (legacy throws — to be migrated)
 */
export declare const TrainErrorCode: {
    readonly CircularImport: "E0501";
    readonly ModuleNotFound: "E0502";
    readonly VersionMismatch: "E0503";
    readonly ImportSymbolMissing: "E0504";
    readonly ExportConflict: "E0505";
    readonly AdapterMissing: "E0601";
    readonly AdapterTimeout: "E0602";
    readonly AdapterError: "E0603";
    readonly RetryExhausted: "E0604";
    readonly ValidationFailed: "E0701";
    readonly OutputShapeMismatch: "E0702";
    readonly EnumOutOfRange: "E0703";
    readonly StateDirNotWritable: "E0801";
    readonly AstCacheCorrupt: "E0802";
    readonly Uncoded: "E9999";
};
export type TrainErrorCodeKey = keyof typeof TrainErrorCode;
export type TrainErrorCodeValue = typeof TrainErrorCode[TrainErrorCodeKey];
/**
 * A train-level exception. Surfaces as catchable RuntimeError /
 * ValidationError / etc in try-catch. JS Error subclass so it can be
 * thrown / caught natively, but the `errorType` carries the train
 * exception class name visible in `catch X as e`.
 *
 * NEW (v0.2): `code` is now part of the public shape. Legacy throws
 * that don't pass a code default to TrainErrorCode.Uncoded so the
 * runtime invariant "every TrainException has a code" holds without
 * forcing a single-shot rewrite of all 53 existing throw sites.
 */
export declare class TrainException extends Error {
    readonly errorType: string;
    readonly range?: ast.Range | undefined;
    readonly name = "TrainException";
    readonly code: TrainErrorCodeValue;
    constructor(errorType: string, message: string, range?: ast.Range | undefined, code?: TrainErrorCodeValue);
}
/** Helper for new code: throw with explicit code, errorType inferred. */
export declare function trainError(code: TrainErrorCodeValue, message: string, range?: ast.Range): TrainException;
/** Programmer error inside the interpreter itself (e.g. unimplemented). */
export declare class InterpreterBug extends Error {
    readonly name = "InterpreterBug";
    constructor(message: string);
}
//# sourceMappingURL=runtime.d.ts.map