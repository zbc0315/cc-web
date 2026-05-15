/**
 * Runtime value model + execution state for the train interpreter.
 *
 * For this milestone the interpreter executes everything in process
 * memory; persistent stack-frame serialization (needed for fai
 * suspend/resume) will be added in M3 when LLM adapters arrive.
 */
export function isFunctionValue(v) {
    return (typeof v === 'object' &&
        v !== null &&
        !Array.isArray(v) &&
        v.__kind === 'function');
}
export function newScope(parent = null) {
    return { parent, bindings: new Map() };
}
export function scopeLookup(scope, name) {
    let s = scope;
    while (s) {
        if (s.bindings.has(name))
            return s.bindings.get(name);
        s = s.parent;
    }
    return undefined;
}
/**
 * Assign to an existing binding in the closest scope where it's
 * defined. Returns false if no such binding exists (caller decides
 * whether to error or create one).
 */
export function scopeAssign(scope, name, value) {
    let s = scope;
    while (s) {
        if (s.bindings.has(name)) {
            s.bindings.set(name, value);
            return true;
        }
        s = s.parent;
    }
    return false;
}
export function makeBuiltin(name, call) {
    return { __kind: 'builtin', name, call };
}
export function isBuiltin(v) {
    return (typeof v === 'object' &&
        v !== null &&
        v.__kind === 'builtin');
}
// ─── Control-flow signals (thrown to short-circuit execution) ─────────
export class TrainReturnSignal {
    value;
    constructor(value) {
        this.value = value;
    }
}
export class TrainBreakSignal {
}
export class TrainContinueSignal {
}
// ─── User-visible runtime exceptions ──────────────────────────────────
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
export const TrainErrorCode = {
    // Module loader (M5)
    CircularImport: 'E0501',
    ModuleNotFound: 'E0502',
    VersionMismatch: 'E0503',
    ImportSymbolMissing: 'E0504',
    ExportConflict: 'E0505',
    // Fai / adapter
    AdapterMissing: 'E0601',
    AdapterTimeout: 'E0602',
    AdapterError: 'E0603',
    RetryExhausted: 'E0604',
    // Validation
    ValidationFailed: 'E0701',
    OutputShapeMismatch: 'E0702',
    EnumOutOfRange: 'E0703',
    // I/O + state
    StateDirNotWritable: 'E0801',
    AstCacheCorrupt: 'E0802',
    // Legacy / unclassified (migrate over time)
    Uncoded: 'E9999',
};
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
export class TrainException extends Error {
    errorType;
    range;
    name = 'TrainException';
    code;
    constructor(errorType, message, range, code = TrainErrorCode.Uncoded) {
        super(message);
        this.errorType = errorType;
        this.range = range;
        this.code = code;
    }
}
/** Helper for new code: throw with explicit code, errorType inferred. */
export function trainError(code, message, range) {
    // Map code prefix to errorType bucket (purely cosmetic for `catch X as e`).
    const errorType = errorTypeFromCode(code);
    return new TrainException(errorType, message, range, code);
}
function errorTypeFromCode(code) {
    if (code.startsWith('E01'))
        return 'LexError';
    if (code.startsWith('E02'))
        return 'ParseError';
    if (code.startsWith('E03'))
        return 'TypeError';
    if (code.startsWith('E04'))
        return 'RuntimeError';
    if (code.startsWith('E05'))
        return 'ModuleError';
    if (code.startsWith('E06'))
        return 'AdapterError';
    if (code.startsWith('E07'))
        return 'ValidationError';
    if (code.startsWith('E08'))
        return 'IOError';
    return 'RuntimeError';
}
/** Programmer error inside the interpreter itself (e.g. unimplemented). */
export class InterpreterBug extends Error {
    name = 'InterpreterBug';
    constructor(message) {
        super(message);
    }
}
//# sourceMappingURL=runtime.js.map