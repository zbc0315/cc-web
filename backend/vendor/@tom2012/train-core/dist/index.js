/**
 * @tom2012/train-core — public API
 *
 * train language runtime: lexer, parser, type checker (planned), interpreter (planned).
 *
 * This is the M1 PoC export surface. More will be added as milestones progress.
 */
export { tokenize, trainLexer, allTokens } from './lexer.js';
export { parse, parseExpression, trainParser, } from './parser.js';
export { buildAst } from './builder.js';
export * as ast from './ast.js';
export { Interpreter, runProgram, } from './interpreter.js';
export { TrainException, TrainErrorCode, trainError, TrainReturnSignal, TrainBreakSignal, TrainContinueSignal, makeBuiltin, isBuiltin, newScope, scopeLookup, scopeAssign, isFunctionValue, } from './runtime.js';
export { defaultBuiltinBindings, formatValue } from './builtins.js';
import { parse } from './parser.js';
import { buildAst } from './builder.js';
import { runProgram } from './interpreter.js';
/**
 * Convenience: parse source text and immediately build the typed AST.
 * AST will be null if there were any lex or parse errors.
 */
export function parseToAst(source) {
    const result = parse(source);
    const hasErrors = result.lexErrors.length > 0 || result.parseErrors.length > 0;
    return {
        ast: hasErrors ? null : buildAst(result.cst),
        lexErrors: result.lexErrors,
        parseErrors: result.parseErrors,
    };
}
export async function runSource(source, opts = {}) {
    const { ast: program, lexErrors, parseErrors } = parseToAst(source);
    if (!program) {
        return {
            ok: false,
            value: null,
            lexErrors,
            parseErrors,
        };
    }
    const result = await runProgram(program, opts);
    return {
        ok: result.ok,
        value: result.value,
        error: result.error,
        lexErrors,
        parseErrors,
    };
}
// Also re-export the new helpers so adapter packages and tests can use them.
export { composePrompt } from './prompt-composer.js';
export { validateOutputs, validateValue, composeRetryFeedback, } from './validation.js';
export { typeToDescriptor, isPromptType, describeType, } from './type-descriptor.js';
export { AST_CACHE_VERSION, sourceHash, cacheFilePath, saveCache, loadCache, normalizeForCache, parseWithCache, } from './ast-cache.js';
export { createModuleRegistry, applyImport, collectExports, } from './module-loader.js';
/**
 * runSource for a file on disk. Required when the source uses
 * `import` statements so module resolution works. Equivalent to:
 *   runSource(await fs.readFile(file), { ...opts, entryFile: file })
 */
export async function runFile(absFilePath, opts = {}) {
    const fs = await import('node:fs/promises');
    const source = await fs.readFile(absFilePath, 'utf8');
    return runSource(source, { ...opts, entryFile: absFilePath });
}
//# sourceMappingURL=index.js.map