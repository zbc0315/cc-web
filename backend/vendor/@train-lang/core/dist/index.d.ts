/**
 * @train-lang/core — public API
 *
 * train language runtime: lexer, parser, type checker (planned), interpreter (planned).
 *
 * This is the M1 PoC export surface. More will be added as milestones progress.
 */
export { tokenize, trainLexer, allTokens } from './lexer.js';
export { parse, parseExpression, trainParser, type ParseResult, } from './parser.js';
export { buildAst } from './builder.js';
export * as ast from './ast.js';
export { Interpreter, runProgram, type RunResult, type RunOptions, } from './interpreter.js';
export { TrainException, TrainErrorCode, trainError, TrainReturnSignal, TrainBreakSignal, TrainContinueSignal, makeBuiltin, isBuiltin, newScope, scopeLookup, scopeAssign, isFunctionValue, type TrainErrorCodeKey, type TrainErrorCodeValue, type Value, type FunctionValue, type BuiltinFunction, type RuntimeContext, type Scope, } from './runtime.js';
export { defaultBuiltinBindings, formatValue } from './builtins.js';
import { type RunOptions } from './interpreter.js';
import { TrainException } from './runtime.js';
import type * as ast from './ast.js';
export interface ParseToAstResult {
    ast: ast.Program | null;
    lexErrors: ReadonlyArray<unknown>;
    parseErrors: ReadonlyArray<unknown>;
}
/**
 * Convenience: parse source text and immediately build the typed AST.
 * AST will be null if there were any lex or parse errors.
 */
export declare function parseToAst(source: string): ParseToAstResult;
/**
 * End-to-end: parse + build AST + execute. Useful for tests and the
 * future `train run` CLI command (modulo CLI argument plumbing).
 *
 * Returns the value of the called entry function (or its error).
 * Does not throw on lex/parse errors; returns them in the result.
 */
export interface RunSourceResult {
    ok: boolean;
    value: import('./runtime.js').Value | null;
    error?: TrainException;
    lexErrors: ReadonlyArray<unknown>;
    parseErrors: ReadonlyArray<unknown>;
}
export declare function runSource(source: string, opts?: RunOptions): Promise<RunSourceResult>;
export { composePrompt } from './prompt-composer.js';
export { validateOutputs, validateValue, composeRetryFeedback, } from './validation.js';
export { typeToDescriptor, isPromptType, describeType, } from './type-descriptor.js';
export { AST_CACHE_VERSION, sourceHash, cacheFilePath, saveCache, loadCache, normalizeForCache, parseWithCache, type AstCacheRecord, type ParseWithCacheResult, } from './ast-cache.js';
export { createModuleRegistry, applyImport, collectExports, type ModuleInstance, type ModuleLoaderHooks, type ModuleRegistry, } from './module-loader.js';
/**
 * runSource for a file on disk. Required when the source uses
 * `import` statements so module resolution works. Equivalent to:
 *   runSource(await fs.readFile(file), { ...opts, entryFile: file })
 */
export declare function runFile(absFilePath: string, opts?: import('./interpreter.js').RunOptions): Promise<RunSourceResult>;
//# sourceMappingURL=index.d.ts.map