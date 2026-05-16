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
import { TrainReturnSignal, TrainBreakSignal, TrainContinueSignal, TrainException, InterpreterBug, newScope, scopeLookup, scopeAssign, isFunctionValue, isBuiltin, } from './runtime.js';
import { defaultBuiltinBindings, formatValue } from './builtins.js';
import { composePrompt } from './prompt-composer.js';
import { composeRetryFeedback, validateOutputs } from './validation.js';
import { applyImport, collectExports, createModuleRegistry, } from './module-loader.js';
import { TrainErrorCode } from './runtime.js';
export class Interpreter {
    ctx;
    faiCallCounter = 0;
    adapter;
    maxFaiAttempts;
    defaultFaiTimeoutMs;
    model;
    writeProtocolHint;
    hostSignal;
    constructor(ctx, cfg = {}) {
        this.ctx = ctx;
        // ctx is intentionally mutable (private but not readonly) so that
        // cross-module calls can swap to the callee's module ctx and
        // restore on exit. See callFunc/callFai entry.
        this.adapter = cfg.adapter;
        this.maxFaiAttempts = cfg.maxFaiAttempts ?? 3;
        this.defaultFaiTimeoutMs = cfg.defaultFaiTimeoutMs ?? 600_000;
        this.model = cfg.model;
        this.writeProtocolHint = cfg.writeProtocolHint;
        this.hostSignal = cfg.signal;
    }
    // ─── Expressions ─────────────────────────────────────────────────────
    async evalExpr(expr, scope) {
        switch (expr.kind) {
            case 'IntLit':
            case 'FloatLit':
                return expr.value;
            case 'StringLit':
                return expr.value;
            case 'BoolLit':
                return expr.value;
            case 'NullLit':
                return null;
            case 'TemplateString':
                return this.evalTemplate(expr, scope);
            case 'IdentExpr':
                return this.evalIdent(expr, scope);
            case 'ArrayLit': {
                const out = [];
                for (const e of expr.elements)
                    out.push(await this.evalExpr(e, scope));
                return out;
            }
            case 'ObjectLit': {
                const obj = {};
                for (const f of expr.fields) {
                    obj[f.key] = await this.evalExpr(f.value, scope);
                }
                return obj;
            }
            case 'UnaryExpr':
                return this.evalUnary(expr, scope);
            case 'BinaryExpr':
                return this.evalBinary(expr, scope);
            case 'TernaryExpr':
                return this.truthy(await this.evalExpr(expr.cond, scope))
                    ? this.evalExpr(expr.then, scope)
                    : this.evalExpr(expr.otherwise, scope);
            case 'MemberExpr': {
                const o = await this.evalExpr(expr.object, scope);
                return this.getMember(o, expr.property, expr.range);
            }
            case 'IndexExpr': {
                const o = await this.evalExpr(expr.object, scope);
                const k = await this.evalExpr(expr.index, scope);
                return this.getIndex(o, k, expr.range);
            }
            case 'CallExpr':
                return this.evalCall(expr, scope);
        }
    }
    evalIdent(expr, scope) {
        const localVal = scopeLookup(scope, expr.name);
        if (localVal !== undefined)
            return localVal;
        if (this.ctx.globals.has(expr.name))
            return this.ctx.globals.get(expr.name);
        if (this.ctx.constants.has(expr.name))
            return this.ctx.constants.get(expr.name);
        if (this.ctx.functions.has(expr.name))
            return this.ctx.functions.get(expr.name);
        if (this.ctx.builtins.has(expr.name))
            return this.ctx.builtins.get(expr.name);
        throw new TrainException('RuntimeError', `Undefined identifier '${expr.name}'`, expr.range);
    }
    async evalTemplate(expr, scope) {
        const parts = [];
        for (const p of expr.parts) {
            if (p.kind === 'TemplateChunk')
                parts.push(p.value);
            else
                parts.push(formatValue(await this.evalExpr(p.expr, scope)));
        }
        return parts.join('');
    }
    async evalUnary(expr, scope) {
        const v = await this.evalExpr(expr.operand, scope);
        if (expr.op === '-') {
            if (typeof v !== 'number')
                throw new TrainException('RuntimeError', `unary '-' expected number, got ${typeName(v)}`, expr.range);
            return -v;
        }
        return !this.truthy(v);
    }
    async evalBinary(expr, scope) {
        if (expr.op === '&&') {
            const l = await this.evalExpr(expr.left, scope);
            if (!this.truthy(l))
                return l;
            return this.evalExpr(expr.right, scope);
        }
        if (expr.op === '||') {
            const l = await this.evalExpr(expr.left, scope);
            if (this.truthy(l))
                return l;
            return this.evalExpr(expr.right, scope);
        }
        const l = await this.evalExpr(expr.left, scope);
        const r = await this.evalExpr(expr.right, scope);
        switch (expr.op) {
            case '+':
                if (typeof l === 'string' || typeof r === 'string')
                    return formatValue(l) + formatValue(r);
                if (typeof l === 'number' && typeof r === 'number')
                    return l + r;
                throw binTypeErr(expr, l, r);
            case '-':
                return numBin(expr, l, r, (a, b) => a - b);
            case '*':
                return numBin(expr, l, r, (a, b) => a * b);
            case '/':
                if (typeof l === 'number' && typeof r === 'number') {
                    if (r === 0)
                        throw new TrainException('RuntimeError', 'division by zero', expr.range);
                    return l / r;
                }
                throw binTypeErr(expr, l, r);
            case '%':
                if (typeof l === 'number' && typeof r === 'number') {
                    if (r === 0)
                        throw new TrainException('RuntimeError', 'modulo by zero', expr.range);
                    return l % r;
                }
                throw binTypeErr(expr, l, r);
            case '==':
                return deepEqValue(l, r);
            case '!=':
                return !deepEqValue(l, r);
            case '<':
                return cmp(expr, l, r) < 0;
            case '<=':
                return cmp(expr, l, r) <= 0;
            case '>':
                return cmp(expr, l, r) > 0;
            case '>=':
                return cmp(expr, l, r) >= 0;
        }
        throw new InterpreterBug(`unhandled binary op: ${expr.op}`);
    }
    getMember(obj, prop, range) {
        if (obj === null)
            throw new TrainException('RuntimeError', `cannot read property '${prop}' of null`, range);
        if (typeof obj === 'object' && !Array.isArray(obj)) {
            const o = obj;
            if (prop in o)
                return o[prop];
            // Spec: missing object keys return null (consistent with array
            // out-of-bounds and string out-of-bounds, both of which also
            // return null). Previously this threw RuntimeError, breaking the
            // spec invariant `obj.missing === null` that downstream code
            // relies on (e.g. `if (obj.maybe == null) { ... }` patterns).
            return null;
        }
        if (Array.isArray(obj)) {
            if (prop === 'length')
                return obj.length;
        }
        if (typeof obj === 'string') {
            if (prop === 'length')
                return [...obj].length;
        }
        throw new TrainException('RuntimeError', `cannot read property '${prop}' on ${typeName(obj)}`, range);
    }
    getIndex(obj, key, range) {
        if (Array.isArray(obj)) {
            if (typeof key !== 'number')
                throw new TrainException('RuntimeError', `array index must be a number, got ${typeName(key)}`, range);
            const i = key < 0 ? obj.length + key : key;
            if (i < 0 || i >= obj.length)
                return null;
            return obj[i];
        }
        if (typeof obj === 'string') {
            if (typeof key !== 'number')
                throw new TrainException('RuntimeError', `string index must be a number, got ${typeName(key)}`, range);
            const codepoints = [...obj];
            const i = key < 0 ? codepoints.length + key : key;
            if (i < 0 || i >= codepoints.length)
                return null;
            return codepoints[i];
        }
        if (obj !== null && typeof obj === 'object') {
            if (typeof key !== 'string')
                throw new TrainException('RuntimeError', `object key must be a string, got ${typeName(key)}`, range);
            const o = obj;
            return key in o ? o[key] : null;
        }
        throw new TrainException('RuntimeError', `cannot index ${typeName(obj)}`, range);
    }
    async evalCall(expr, scope) {
        const callee = await this.evalExpr(expr.callee, scope);
        const args = [];
        for (const a of expr.args)
            args.push(await this.evalExpr(a, scope));
        if (isFunctionValue(callee)) {
            if (callee.isFai) {
                return this.callFai(callee, args, expr.range);
            }
            return this.callFunc(callee, args, expr.range);
        }
        if (isBuiltin(callee)) {
            const b = callee;
            // Builtins may be sync or async (Value | Promise<Value>); awaiting
            // a non-Promise is a no-op so this is safe for both cases.
            return await b.call(args);
        }
        throw new TrainException('RuntimeError', `value is not callable: ${typeName(callee)}`, expr.range);
    }
    async callFunc(fn, args, range) {
        if (fn.decl.kind !== 'FuncDecl')
            throw new InterpreterBug('callFunc dispatched on non-func decl');
        const decl = fn.decl;
        if (args.length !== decl.params.length) {
            throw new TrainException('RuntimeError', `${fn.name}() expects ${decl.params.length} arg(s), got ${args.length}`, range);
        }
        const callScope = newScope(fn.definedIn);
        decl.params.forEach((p, i) => callScope.bindings.set(p.name, args[i]));
        const prevCtx = this.ctx;
        if (fn.moduleCtx && fn.moduleCtx !== this.ctx)
            this.ctx = fn.moduleCtx;
        try {
            await this.execBlock(decl.body, callScope);
        }
        catch (e) {
            if (e instanceof TrainReturnSignal)
                return e.value ?? null;
            throw e;
        }
        finally {
            this.ctx = prevCtx;
        }
        return null;
    }
    /**
     * Execute a fai call: compose prompt → adapter.call → validate →
     * retry-with-feedback loop. Returns the validated outputs as a single
     * object (containing one key per declared output).
     */
    async callFai(fn, args, range) {
        if (fn.decl.kind !== 'FaiDecl')
            throw new InterpreterBug('callFai dispatched on non-fai decl');
        const decl = fn.decl;
        if (!this.adapter) {
            throw new TrainException('RuntimeError', `fai function '${fn.name}' requires an LLM adapter, none installed`, range);
        }
        if (args.length !== decl.params.length) {
            throw new TrainException('RuntimeError', `fai ${fn.name}() expects ${decl.params.length} arg(s), got ${args.length}`, range);
        }
        const callId = ++this.faiCallCounter;
        const argMap = new Map();
        decl.params.forEach((p, i) => argMap.set(p.name, args[i]));
        // Compose the prompt once; retry attempts will append feedback.
        const base = composePrompt(decl, argMap, {
            capabilities: this.adapter.capabilities,
            callId,
            writeProtocolHint: this.writeProtocolHint,
        });
        let promptText = base.text;
        let lastErrors = null;
        for (let attempt = 0; attempt < this.maxFaiAttempts; attempt++) {
            if (this.hostSignal?.aborted) {
                throw new TrainException('UserCancelError', `fai ${fn.name}: cancelled before attempt ${attempt + 1}`, range);
            }
            const req = {
                callId,
                fnName: fn.name,
                prompt: promptText,
                inputs: base.inputs,
                outputs: base.outputs,
                options: {
                    timeoutMs: this.defaultFaiTimeoutMs,
                    maxAttempts: this.maxFaiAttempts,
                    attempt,
                    model: this.model,
                    signal: this.hostSignal,
                },
            };
            const result = await this.adapter.call(req);
            switch (result.kind) {
                case 'success': {
                    const validated = validateOutputs(decl.outputs, result.outputs);
                    if (validated.ok) {
                        return validated.outputs;
                    }
                    lastErrors = validated;
                    if (attempt < this.maxFaiAttempts - 1) {
                        // Append feedback to prompt and retry
                        promptText =
                            base.text +
                                '\n\n' +
                                composeRetryFeedback(validated.errors, attempt, this.maxFaiAttempts);
                    }
                    break;
                }
                case 'validation-error':
                    // Adapter performed its own validation and rejected outputs
                    lastErrors = { ok: false, errors: result.errors };
                    if (attempt < this.maxFaiAttempts - 1) {
                        promptText =
                            base.text +
                                '\n\n' +
                                composeRetryFeedback(result.errors, attempt, this.maxFaiAttempts);
                    }
                    break;
                case 'timeout':
                    throw new TrainException('TimeoutError', `fai ${fn.name}: adapter timed out (attempt ${attempt + 1})`, range);
                case 'cancelled':
                    throw new TrainException('UserCancelError', `fai ${fn.name}: cancelled`, range);
                case 'error':
                    if (result.recoverable && attempt < this.maxFaiAttempts - 1) {
                        // try again with original prompt (no schema feedback)
                        break;
                    }
                    throw new TrainException('RuntimeError', `fai ${fn.name}: ${result.message}`, range);
            }
        }
        // All attempts exhausted with validation errors
        const errs = (lastErrors && !lastErrors.ok ? lastErrors.errors : []) ?? [];
        const summary = errs.map((e) => `${e.outputName}: ${e.message}`).join('; ');
        throw new TrainException('ValidationError', `fai ${fn.name}: failed after ${this.maxFaiAttempts} attempt(s) — ${summary || 'no details'}`, range);
    }
    // ─── Statements / blocks ─────────────────────────────────────────────
    async execBlock(block, scope) {
        const inner = newScope(scope);
        for (const s of block.stmts)
            await this.execStmt(s, inner);
    }
    async execStmt(stmt, scope) {
        switch (stmt.kind) {
            case 'LetDecl':
                return this.execLet(stmt, scope);
            case 'Assignment':
                return this.execAssign(stmt, scope);
            case 'IfStmt':
                return this.execIf(stmt, scope);
            case 'ForStmt':
                return this.execFor(stmt, scope);
            case 'WhileStmt':
                return this.execWhile(stmt, scope);
            case 'TryStmt':
                return this.execTry(stmt, scope);
            case 'BreakStmt':
                throw new TrainBreakSignal();
            case 'ContinueStmt':
                throw new TrainContinueSignal();
            case 'ReturnStmt':
                throw new TrainReturnSignal(stmt.value ? await this.evalExpr(stmt.value, scope) : null);
            case 'ExprStmt':
                await this.evalExpr(stmt.expr, scope);
                return;
        }
    }
    async execLet(stmt, scope) {
        const v = stmt.init ? await this.evalExpr(stmt.init, scope) : null;
        this.bindLetTarget(stmt.target, v, scope, stmt.range);
    }
    bindLetTarget(target, v, scope, range) {
        if (target.kind === 'IdentTarget') {
            scope.bindings.set(target.name, v);
            return;
        }
        if (target.kind === 'ObjectDestruct') {
            if (v === null ||
                typeof v !== 'object' ||
                Array.isArray(v) ||
                isFunctionValue(v) ||
                isBuiltin(v)) {
                throw new TrainException('RuntimeError', `cannot object-destructure ${typeName(v)}`, range);
            }
            const o = v;
            for (const f of target.fields) {
                scope.bindings.set(f.local, f.source in o ? o[f.source] : null);
            }
            return;
        }
        if (!Array.isArray(v)) {
            throw new TrainException('RuntimeError', `cannot array-destructure ${typeName(v)}`, range);
        }
        for (let i = 0; i < target.names.length; i++) {
            scope.bindings.set(target.names[i], i < v.length ? v[i] : null);
        }
    }
    async execAssign(stmt, scope) {
        const rhs = await this.evalExpr(stmt.value, scope);
        const baseName = stmt.target.base;
        if (stmt.target.suffixes.length === 0) {
            const current = scopeLookup(scope, baseName) ??
                (this.ctx.globals.has(baseName)
                    ? this.ctx.globals.get(baseName)
                    : undefined);
            const newVal = stmt.op === '='
                ? rhs
                : this.applyCompound(stmt.op, current, rhs, stmt.range);
            if (scopeAssign(scope, baseName, newVal))
                return;
            if (this.ctx.globals.has(baseName)) {
                this.ctx.globals.set(baseName, newVal);
                return;
            }
            if (this.ctx.constants.has(baseName))
                throw new TrainException('RuntimeError', `cannot reassign const '${baseName}'`, stmt.range);
            throw new TrainException('RuntimeError', `assignment to undeclared variable '${baseName}'`, stmt.range);
        }
        let cursor = scopeLookup(scope, baseName) ??
            this.ctx.globals.get(baseName) ??
            this.ctx.constants.get(baseName);
        if (cursor === undefined) {
            throw new TrainException('RuntimeError', `undefined identifier '${baseName}'`, stmt.range);
        }
        for (let i = 0; i < stmt.target.suffixes.length - 1; i++) {
            cursor = await this.followSuffix(cursor, stmt.target.suffixes[i], scope);
        }
        const lastSuf = stmt.target.suffixes[stmt.target.suffixes.length - 1];
        const oldValue = await this.followSuffix(cursor, lastSuf, scope);
        const newVal = stmt.op === '='
            ? rhs
            : this.applyCompound(stmt.op, oldValue, rhs, stmt.range);
        await this.setSuffix(cursor, lastSuf, newVal, scope, stmt.range);
    }
    async followSuffix(obj, suf, scope) {
        if (suf.kind === 'MemberSuffix')
            return this.getMember(obj, suf.name);
        return this.getIndex(obj, await this.evalExpr(suf.index, scope));
    }
    async setSuffix(obj, suf, val, scope, range) {
        if (suf.kind === 'MemberSuffix') {
            if (obj === null || typeof obj !== 'object' || Array.isArray(obj))
                throw new TrainException('RuntimeError', `cannot set property '${suf.name}' on ${typeName(obj)}`, range);
            obj[suf.name] = val;
            return;
        }
        const key = await this.evalExpr(suf.index, scope);
        if (Array.isArray(obj)) {
            if (typeof key !== 'number')
                throw new TrainException('RuntimeError', `array index must be a number, got ${typeName(key)}`, range);
            const i = key < 0 ? obj.length + key : key;
            obj[i] = val;
            return;
        }
        if (obj !== null && typeof obj === 'object') {
            if (typeof key !== 'string')
                throw new TrainException('RuntimeError', `object key must be a string`, range);
            obj[key] = val;
            return;
        }
        throw new TrainException('RuntimeError', `cannot index-assign ${typeName(obj)}`, range);
    }
    applyCompound(op, old, rhs, range) {
        if (old === undefined)
            throw new TrainException('RuntimeError', `compound assignment ${op} on undeclared variable`, range);
        if (typeof old !== 'number' || typeof rhs !== 'number') {
            if (op === '+=' && (typeof old === 'string' || typeof rhs === 'string')) {
                return formatValue(old) + formatValue(rhs);
            }
            throw new TrainException('RuntimeError', `${op} requires numbers, got ${typeName(old)} and ${typeName(rhs)}`, range);
        }
        switch (op) {
            case '+=':
                return old + rhs;
            case '-=':
                return old - rhs;
            case '*=':
                return old * rhs;
            case '/=':
                if (rhs === 0)
                    throw new TrainException('RuntimeError', 'division by zero', range);
                return old / rhs;
            case '%=':
                if (rhs === 0)
                    throw new TrainException('RuntimeError', 'modulo by zero', range);
                return old % rhs;
            case '=':
                return rhs;
        }
    }
    async execIf(stmt, scope) {
        if (this.truthy(await this.evalExpr(stmt.cond, scope))) {
            return this.execBlock(stmt.then, scope);
        }
        for (const elif of stmt.elifs) {
            if (this.truthy(await this.evalExpr(elif.cond, scope))) {
                return this.execBlock(elif.body, scope);
            }
        }
        if (stmt.otherwise)
            await this.execBlock(stmt.otherwise, scope);
    }
    async execFor(stmt, scope) {
        const iter = await this.evalExpr(stmt.iterable, scope);
        const items = this.iterable(iter, stmt.range);
        for (const item of items) {
            const inner = newScope(scope);
            inner.bindings.set(stmt.binding, item);
            try {
                await this.execBlock(stmt.body, inner);
            }
            catch (e) {
                if (e instanceof TrainBreakSignal)
                    return;
                if (e instanceof TrainContinueSignal)
                    continue;
                throw e;
            }
        }
    }
    iterable(v, range) {
        if (Array.isArray(v))
            return v;
        if (typeof v === 'string')
            return [...v];
        if (v !== null &&
            typeof v === 'object' &&
            !isFunctionValue(v) &&
            !isBuiltin(v)) {
            return Object.keys(v);
        }
        throw new TrainException('RuntimeError', `cannot iterate ${typeName(v)}`, range);
    }
    async execWhile(stmt, scope) {
        while (this.truthy(await this.evalExpr(stmt.cond, scope))) {
            try {
                await this.execBlock(stmt.body, scope);
            }
            catch (e) {
                if (e instanceof TrainBreakSignal)
                    return;
                if (e instanceof TrainContinueSignal)
                    continue;
                throw e;
            }
        }
    }
    async execTry(stmt, scope) {
        try {
            await this.execBlock(stmt.body, scope);
        }
        catch (e) {
            if (e instanceof TrainException) {
                for (const c of stmt.catches) {
                    // train error types are PascalCase by convention
                    // (RuntimeError, ValidationError, TimeoutError, ModuleError,
                    // UserCancelError, ...). When user writes `catch e { ... }`
                    // with a lowercase identifier, they meant "catch any error
                    // and bind it as `e`", not "catch the error type literally
                    // named 'e'" (which would never match anything). Treat the
                    // lowercase form as catch-all and bind the name as the
                    // error variable.
                    const startsLower = c.errorType.length > 0 &&
                        c.errorType[0] >= 'a' &&
                        c.errorType[0] <= 'z';
                    const matches = startsLower || c.errorType === e.errorType;
                    if (matches) {
                        const inner = newScope(scope);
                        const bindingName = c.binding ?? (startsLower ? c.errorType : null);
                        if (bindingName) {
                            inner.bindings.set(bindingName, {
                                type: e.errorType,
                                message: e.message,
                            });
                        }
                        await this.execBlock(c.body, inner);
                        return;
                    }
                }
            }
            throw e;
        }
    }
    // ─── Helpers ─────────────────────────────────────────────────────────
    truthy(v) {
        if (v === null)
            return false;
        if (typeof v === 'boolean')
            return v;
        if (typeof v === 'number')
            return v !== 0;
        if (typeof v === 'string')
            return v.length > 0;
        if (Array.isArray(v))
            return v.length > 0;
        return true;
    }
}
export async function runProgram(program, opts = {}) {
    const ctx = {
        constants: new Map(),
        globals: new Map(),
        functions: new Map(),
        builtins: new Map(),
        exports: new Map(),
    };
    for (const [k, v] of defaultBuiltinBindings()) {
        ctx.builtins.set(k, v);
    }
    if (opts.extraBuiltins) {
        for (const [k, v] of opts.extraBuiltins) {
            ctx.builtins.set(k, v);
        }
    }
    const interp = new Interpreter(ctx, opts);
    const rootScope = newScope(null);
    const moduleRegistry = opts.moduleRegistry ?? createModuleRegistry();
    const entryFile = opts.entryFile;
    const importerStack = opts.__importerStack ?? (entryFile ? [entryFile] : []);
    try {
        for (const item of program.items) {
            registerTopLevelFunctions(item, ctx, rootScope);
        }
    }
    catch (e) {
        if (e instanceof TrainException)
            return { ok: false, value: null, error: e };
        throw e;
    }
    try {
        for (const item of program.items) {
            await evalTopLevelItem(item, interp, ctx, rootScope, moduleRegistry, entryFile, importerStack, opts);
        }
    }
    catch (e) {
        if (e instanceof TrainException)
            return { ok: false, value: null, error: e };
        throw e;
    }
    const entryName = opts.entry ?? 'main';
    const internalName = ctx.exports.get(entryName);
    if (!internalName) {
        return {
            ok: false,
            value: null,
            error: new TrainException('RuntimeError', `no export named '${entryName}' found`),
        };
    }
    const fn = ctx.functions.get(internalName);
    if (!fn) {
        return {
            ok: false,
            value: null,
            error: new TrainException('RuntimeError', `export '${entryName}' is not a function`),
        };
    }
    try {
        if (fn.isFai) {
            // Allow fai as entry only if adapter installed
            if (!opts.adapter) {
                return {
                    ok: false,
                    value: null,
                    error: new TrainException('RuntimeError', `entry function '${entryName}' is a fai; cannot run without an LLM adapter`),
                };
            }
            const value = await interp.callFai(fn, opts.args ?? []);
            return { ok: true, value };
        }
        const value = await interp.callFunc(fn, opts.args ?? []);
        return { ok: true, value };
    }
    catch (e) {
        if (e instanceof TrainException)
            return { ok: false, value: null, error: e };
        throw e;
    }
}
/**
 * Reject names that already exist as a function, constant, or global in
 * this module context. Catches:
 *   - duplicate `func foo / func foo`
 *   - `func foo / const foo`
 *   - duplicate `import { foo } / import { foo }`
 *   - `import { foo } / func foo` (silent shadow before this fix)
 */
function assertFreshSymbol(name, ctx, range, source) {
    let prev = null;
    if (ctx.functions.has(name))
        prev = 'function';
    else if (ctx.constants.has(name))
        prev = 'const';
    else if (ctx.globals.has(name))
        prev = 'var';
    if (prev !== null) {
        throw new TrainException('RuntimeError', `duplicate symbol '${name}' (declared as ${source}, already exists as ${prev})`, range);
    }
}
function registerTopLevelFunctions(item, ctx, rootScope) {
    if (item.kind === 'FuncDecl' || item.kind === 'FaiDecl') {
        assertFreshSymbol(item.name, ctx, item.range, 'function');
        ctx.functions.set(item.name, {
            __kind: 'function',
            name: item.name,
            isFai: item.kind === 'FaiDecl',
            decl: item,
            definedIn: rootScope,
            moduleCtx: ctx,
        });
        return;
    }
    if (item.kind === 'ExportDecl') {
        const tgt = item.target;
        if (tgt.kind === 'FuncDecl' || tgt.kind === 'FaiDecl') {
            assertFreshSymbol(tgt.name, ctx, tgt.range, 'function');
            ctx.functions.set(tgt.name, {
                __kind: 'function',
                name: tgt.name,
                isFai: tgt.kind === 'FaiDecl',
                decl: tgt,
                definedIn: rootScope,
                moduleCtx: ctx,
            });
        }
    }
}
async function evalTopLevelItem(item, interp, ctx, rootScope, moduleRegistry, currentFile, importerStack, opts) {
    switch (item.kind) {
        case 'Import':
            await handleImport(item, ctx, moduleRegistry, currentFile, importerStack, opts);
            return;
        case 'RuntimeAnnotation':
            return;
        case 'ConstDecl':
            assertFreshSymbol(item.name, ctx, item.range, 'const');
            ctx.constants.set(item.name, await interp.evalExpr(item.value, rootScope));
            return;
        case 'VarDecl':
            assertFreshSymbol(item.name, ctx, item.range, 'var');
            ctx.globals.set(item.name, item.init ? await interp.evalExpr(item.init, rootScope) : null);
            return;
        case 'FuncDecl':
        case 'FaiDecl':
            return;
        case 'ExportDecl':
            registerExports(item, ctx);
            return;
    }
}
async function handleImport(imp, importerCtx, registry, currentFile, importerStack, rootOpts) {
    if (!currentFile) {
        throw new TrainException('ModuleError', `import statement requires entryFile to be set on runProgram (no current module path)`, imp.range, TrainErrorCode.ModuleNotFound);
    }
    const absPath = registry.resolve(imp.source, currentFile);
    // cache hit
    if (registry.hasCached(absPath)) {
        applyImport(imp, registry.getCached(absPath), importerCtx);
        return;
    }
    // cycle detection
    if (registry.isInProgress(absPath)) {
        const cycle = [...importerStack, absPath]
            .map((p) => p.split('/').pop())
            .join(' → ');
        throw new TrainException('ModuleError', `circular import: ${cycle}`, imp.range, TrainErrorCode.CircularImport);
    }
    registry.markInProgress(absPath);
    try {
        const childSource = await registry.read(absPath);
        const { parse } = await import('./parser.js');
        const { buildAst } = await import('./builder.js');
        const parseResult = parse(childSource);
        if (parseResult.lexErrors.length > 0 || parseResult.parseErrors.length > 0) {
            throw new TrainException('ModuleError', `module "${imp.source}" has parse errors (${parseResult.lexErrors.length + parseResult.parseErrors.length})`, imp.range, TrainErrorCode.ModuleNotFound);
        }
        const childAst = buildAst(parseResult.cst);
        if (!childAst) {
            throw new TrainException('ModuleError', `module "${imp.source}" failed to build AST`, imp.range, TrainErrorCode.ModuleNotFound);
        }
        // Recurse: run the child module's top-level via runProgram, but in
        // "submodule mode" — no entry call, no result; we only want its ctx.
        const childResult = await runSubmodule(childAst, {
            ...rootOpts,
            entryFile: absPath,
            moduleRegistry: registry,
            __importerStack: [...importerStack, absPath],
        });
        if (!childResult.ok) {
            throw (childResult.error ??
                new TrainException('ModuleError', `module "${imp.source}" failed to evaluate`, imp.range, TrainErrorCode.ModuleNotFound));
        }
        registry.set(absPath, {
            absPath,
            ctx: childResult.ctx,
            exports: collectExports(childResult.ctx),
        });
        applyImport(imp, registry.getCached(absPath), importerCtx);
    }
    finally {
        registry.unmarkInProgress(absPath);
    }
}
/**
 * Execute a child module's top-level without calling its entry. Returns
 * the populated RuntimeContext for export collection.
 */
async function runSubmodule(program, opts) {
    const ctx = {
        constants: new Map(),
        globals: new Map(),
        functions: new Map(),
        builtins: new Map(),
        exports: new Map(),
    };
    for (const [k, v] of defaultBuiltinBindings()) {
        ctx.builtins.set(k, v);
    }
    if (opts.extraBuiltins) {
        for (const [k, v] of opts.extraBuiltins) {
            ctx.builtins.set(k, v);
        }
    }
    const interp = new Interpreter(ctx, opts);
    const rootScope = newScope(null);
    const registry = opts.moduleRegistry;
    const importerStack = opts.__importerStack;
    for (const item of program.items) {
        registerTopLevelFunctions(item, ctx, rootScope);
    }
    try {
        for (const item of program.items) {
            await evalTopLevelItem(item, interp, ctx, rootScope, registry, opts.entryFile, importerStack, opts);
        }
    }
    catch (e) {
        if (e instanceof TrainException)
            return { ok: false, error: e, ctx };
        throw e;
    }
    return { ok: true, ctx };
}
function registerExports(decl, ctx) {
    const tgt = decl.target;
    if (tgt.kind === 'ExportNames') {
        for (const spec of tgt.specs) {
            const exported = spec.alias ?? spec.name;
            ctx.exports.set(exported, spec.name);
        }
        return;
    }
    ctx.exports.set(tgt.name, tgt.name);
}
// ─── Local helpers ────────────────────────────────────────────────────
function typeName(v) {
    if (v === null)
        return 'null';
    if (Array.isArray(v))
        return 'array';
    if (isFunctionValue(v) || isBuiltin(v))
        return 'function';
    return typeof v;
}
function numBin(expr, l, r, fn) {
    if (typeof l === 'number' && typeof r === 'number')
        return fn(l, r);
    throw binTypeErr(expr, l, r);
}
function cmp(expr, l, r) {
    if (typeof l === 'number' && typeof r === 'number') {
        return l < r ? -1 : l > r ? 1 : 0;
    }
    if (typeof l === 'string' && typeof r === 'string') {
        return l < r ? -1 : l > r ? 1 : 0;
    }
    throw binTypeErr(expr, l, r);
}
function binTypeErr(expr, l, r) {
    return new TrainException('RuntimeError', `operator '${expr.op}' undefined for ${typeName(l)} and ${typeName(r)}`, expr.range);
}
function deepEqValue(a, b) {
    if (a === b)
        return true;
    if (a === null || b === null)
        return false;
    if (typeof a !== typeof b)
        return false;
    if (Array.isArray(a) && Array.isArray(b)) {
        if (a.length !== b.length)
            return false;
        for (let i = 0; i < a.length; i++)
            if (!deepEqValue(a[i], b[i]))
                return false;
        return true;
    }
    if (typeof a === 'object' && typeof b === 'object') {
        if (Array.isArray(a) || Array.isArray(b))
            return false;
        const ao = a;
        const bo = b;
        const ak = Object.keys(ao);
        const bk = Object.keys(bo);
        if (ak.length !== bk.length)
            return false;
        for (const k of ak) {
            if (!(k in bo))
                return false;
            if (!deepEqValue(ao[k], bo[k]))
                return false;
        }
        return true;
    }
    return false;
}
//# sourceMappingURL=interpreter.js.map