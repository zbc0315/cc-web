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
import { trainParser, parseExpression } from './parser.js';
const BaseVisitor = trainParser.getBaseCstVisitorConstructor();
// ─── Range helpers ────────────────────────────────────────────────────
function tokenRange(tok) {
    return {
        startLine: tok.startLine ?? 0,
        startColumn: tok.startColumn ?? 0,
        endLine: tok.endLine ?? 0,
        endColumn: tok.endColumn ?? 0,
        startOffset: tok.startOffset,
        endOffset: tok.endOffset ?? tok.startOffset,
    };
}
function cstRange(cst) {
    const loc = cst.location;
    if (!loc) {
        return {
            startLine: 0,
            startColumn: 0,
            endLine: 0,
            endColumn: 0,
            startOffset: 0,
            endOffset: 0,
        };
    }
    return {
        startLine: loc.startLine ?? 0,
        startColumn: loc.startColumn ?? 0,
        endLine: loc.endLine ?? 0,
        endColumn: loc.endColumn ?? 0,
        startOffset: loc.startOffset,
        endOffset: loc.endOffset ?? loc.startOffset,
    };
}
// ─── Literal value helpers ────────────────────────────────────────────
function unquoteString(raw) {
    // raw is the matched StringLit including surrounding quotes
    const inner = raw.slice(1, -1);
    return unescapeStringBody(inner);
}
function unescapeStringBody(inner) {
    return inner.replace(/\\(.)/g, (_, ch) => {
        switch (ch) {
            case 'n':
                return '\n';
            case 't':
                return '\t';
            case 'r':
                return '\r';
            case '\\':
                return '\\';
            case '"':
                return '"';
            case "'":
                return "'";
            case '$':
                return '$';
            default:
                return ch;
        }
    });
}
function splitTemplate(body) {
    // Invariant when output contains any expr: result is strictly
    //   chunk, expr, chunk, expr, ..., chunk
    // i.e. first and last segments are always chunks (possibly empty).
    // When no expr appears, output is a single chunk (possibly empty).
    const segments = [];
    let buf = '';
    let bufStart = 0;
    let i = 0;
    const flushChunk = (endPos) => {
        segments.push({
            kind: 'chunk',
            source: buf,
            startInBody: bufStart,
            endInBody: endPos,
        });
        buf = '';
        bufStart = endPos;
    };
    while (i < body.length) {
        if (body[i] === '$' && body[i + 1] === '{') {
            // chunk that precedes this interpolation (may be empty)
            flushChunk(i);
            // find matching `}` (track nested {})
            let depth = 1;
            let j = i + 2;
            while (j < body.length && depth > 0) {
                const ch = body[j];
                if (ch === '{')
                    depth++;
                else if (ch === '}') {
                    depth--;
                    if (depth === 0)
                        break;
                }
                j++;
            }
            if (depth !== 0) {
                // Unterminated — recover by treating the rest as one chunk.
                buf += body.slice(i);
                bufStart = i;
                i = body.length;
                break;
            }
            const exprBody = body.slice(i + 2, j);
            segments.push({
                kind: 'expr',
                source: exprBody,
                startInBody: i,
                endInBody: j + 1,
            });
            bufStart = j + 1;
            i = j + 1;
        }
        else if (body[i] === '\\' && i + 1 < body.length) {
            buf += body.slice(i, i + 2);
            i += 2;
        }
        else {
            buf += body[i];
            i++;
        }
    }
    // Final flush: keep the "first and last are chunks" invariant.
    // If we have any expr OR no segments yet, emit a chunk for the tail
    // (possibly empty). If we have only a partially-buffered plain string
    // and no segments, the empty flush still produces the single chunk.
    const hasExpr = segments.some((s) => s.kind === 'expr');
    if (hasExpr || segments.length === 0) {
        flushChunk(body.length);
    }
    else if (buf.length > 0) {
        // pure literal case where buffer was carried past a recovery path
        flushChunk(body.length);
    }
    return segments;
}
/**
 * Build either a plain StringLit (no interpolation) or a TemplateString
 * (one or more `${...}`) from the source token. Offsets in returned
 * sub-ranges are relative to the source file (using `tok.startOffset` +
 * 1 to skip the opening quote).
 */
function buildStringExpr(tok) {
    const raw = tok.image;
    const body = raw.slice(1, -1); // strip surrounding quotes
    const fullRange = tokenRange(tok);
    const segs = splitTemplate(body);
    if (!segs.some((s) => s.kind === 'expr')) {
        // Pure literal — return StringLit
        const merged = segs.map((s) => s.source).join('');
        return {
            kind: 'StringLit',
            value: unescapeStringBody(merged),
            range: fullRange,
        };
    }
    // Has interpolation — build TemplateString
    const bodyOffset = tok.startOffset + 1; // skip opening quote
    const parts = segs.map((seg) => {
        if (seg.kind === 'chunk') {
            return {
                kind: 'TemplateChunk',
                value: unescapeStringBody(seg.source),
                range: subRange(fullRange, bodyOffset, seg.startInBody, seg.endInBody),
            };
        }
        // expr — recursively parse it via the parser's exprEntry
        const result = parseExpression(seg.source);
        if (result.lexErrors.length > 0 ||
            result.parseErrors.length > 0 ||
            !result.cst) {
            // emit a fallback: empty string chunk with the broken expr's text.
            // In a future revision we should propagate diagnostics up.
            return {
                kind: 'TemplateChunk',
                value: '${' + seg.source + '}',
                range: subRange(fullRange, bodyOffset, seg.startInBody, seg.endInBody),
            };
        }
        const innerExpr = astBuilder.visit(result.cst);
        return {
            kind: 'TemplateExpr',
            expr: innerExpr,
            range: subRange(fullRange, bodyOffset, seg.startInBody, seg.endInBody),
        };
    });
    return {
        kind: 'TemplateString',
        parts,
        range: fullRange,
    };
}
/** Produce a Range for a sub-region of a single-line-ish source token.
 *  Sufficient for now (no per-segment line/column tracking inside templates). */
function subRange(full, bodyOffset, startInBody, endInBody) {
    return {
        startLine: full.startLine,
        startColumn: full.startColumn,
        endLine: full.endLine,
        endColumn: full.endColumn,
        startOffset: bodyOffset + startInBody,
        endOffset: bodyOffset + endInBody,
    };
}
function stripAtPrefix(name) {
    return name.startsWith('@') ? name.slice(1) : name;
}
// ─── Visitor implementation ───────────────────────────────────────────
class TrainAstBuilder extends BaseVisitor {
    constructor() {
        super();
        this.validateVisitor();
    }
    // ─── Program ────────────────────────────────────────────────────────
    /** Used by buildStringExpr → parseExpression for ${...} bodies. */
    exprEntry(ctx) {
        return this.visit(ctx.expr[0]);
    }
    program(ctx, _params) {
        const cst = (ctx.$cstNode ?? undefined);
        const items = (ctx.topLevel ?? []).map((c) => this.visit(c));
        return {
            kind: 'Program',
            items,
            range: cst ? cstRange(cst) : emptyRange(items),
        };
    }
    topLevel(ctx) {
        if (ctx.importDecl)
            return this.visit(ctx.importDecl[0]);
        if (ctx.runtimeAnnotation)
            return this.visit(ctx.runtimeAnnotation[0]);
        if (ctx.constDecl)
            return this.visit(ctx.constDecl[0]);
        if (ctx.varDecl)
            return this.visit(ctx.varDecl[0]);
        if (ctx.annotatedDecl)
            return this.visit(ctx.annotatedDecl[0]);
        if (ctx.funcDecl)
            return this.visit(ctx.funcDecl[0]);
        if (ctx.faiDecl)
            return this.visit(ctx.faiDecl[0]);
        if (ctx.exportDecl)
            return this.visit(ctx.exportDecl[0]);
        throw new Error('unreachable: topLevel had no matching alternative');
    }
    // ─── Imports ────────────────────────────────────────────────────────
    importDecl(ctx) {
        const clause = this.visit(ctx.importClause[0]);
        const sourceTok = ctx.StringLit[0];
        const versionTok = ctx.AtName?.[0];
        const importTok = ctx.Import[0];
        const endTok = versionTok ?? sourceTok;
        return {
            kind: 'Import',
            clause,
            source: unquoteString(sourceTok.image),
            version: versionTok ? versionTok.image.slice(1) : null,
            range: spanTokens(importTok, endTok),
        };
    }
    importClause(ctx) {
        if (ctx.namedImports)
            return this.visit(ctx.namedImports[0]);
        return this.visit(ctx.namespaceImport[0]);
    }
    namedImports(ctx) {
        const specs = (ctx.importSpec ?? []).map((c) => this.visit(c));
        const lcurly = ctx.LCurly[0];
        const rcurly = ctx.RCurly[0];
        return {
            kind: 'NamedImports',
            specs,
            range: spanTokens(lcurly, rcurly),
        };
    }
    importSpec(ctx) {
        const ids = ctx.Identifier;
        const name = ids[0].image;
        const alias = ids.length > 1 ? ids[1].image : null;
        return {
            kind: 'ImportSpec',
            name,
            alias,
            range: spanTokens(ids[0], ids[ids.length - 1]),
        };
    }
    namespaceImport(ctx) {
        const star = ctx.Star[0];
        const alias = ctx.Identifier[0];
        return {
            kind: 'NamespaceImport',
            alias: alias.image,
            range: spanTokens(star, alias),
        };
    }
    // ─── Annotations ────────────────────────────────────────────────────
    runtimeAnnotation(ctx) {
        const name = ctx.AtName[0];
        const argsCst = ctx.annoArgList?.[0];
        const args = argsCst ? this.visit(argsCst) : [];
        const rparen = ctx.RParen?.[0];
        const endTok = rparen ?? name;
        return {
            kind: 'RuntimeAnnotation',
            name: stripAtPrefix(name.image),
            args,
            range: spanTokens(name, endTok),
        };
    }
    declAnnotation(ctx) {
        const name = ctx.AtName[0];
        const argsCst = ctx.annoArgList?.[0];
        const args = argsCst ? this.visit(argsCst) : [];
        const rparen = ctx.RParen?.[0];
        const endTok = rparen ?? name;
        return {
            kind: 'Annotation',
            name: stripAtPrefix(name.image),
            args,
            range: spanTokens(name, endTok),
        };
    }
    annoArgList(ctx) {
        return (ctx.annoArg ?? []).map((c) => this.visit(c));
    }
    annoArg(ctx) {
        const keyTok = ctx.Identifier?.[0];
        const lits = ctx.literal;
        const literalCst = lits[0];
        const value = this.visit(literalCst);
        const startTok = keyTok ?? findFirstToken(literalCst);
        const endRange = value.range;
        return {
            kind: 'AnnotationArg',
            key: keyTok ? keyTok.image : null,
            value,
            range: {
                startLine: startTok?.startLine ?? endRange.startLine,
                startColumn: startTok?.startColumn ?? endRange.startColumn,
                endLine: endRange.endLine,
                endColumn: endRange.endColumn,
                startOffset: startTok?.startOffset ?? endRange.startOffset,
                endOffset: endRange.endOffset,
            },
        };
    }
    annotatedDecl(ctx) {
        const annotations = (ctx.declAnnotation ?? []).map((c) => this.visit(c));
        let decl;
        if (ctx.funcDecl)
            decl = this.visit(ctx.funcDecl[0]);
        else
            decl = this.visit(ctx.faiDecl[0]);
        return { ...decl, annotations };
    }
    // ─── Top-level declarations ─────────────────────────────────────────
    constDecl(ctx) {
        const constTok = ctx.Const[0];
        const id = ctx.Identifier[0];
        const type = this.visit(ctx.typeAnnot[0]);
        const value = this.visit(ctx.expr[0]);
        return {
            kind: 'ConstDecl',
            name: id.image,
            type,
            value,
            range: spanFromTokenToRange(constTok, value.range),
        };
    }
    varDecl(ctx) {
        const varTok = ctx.Var[0];
        const id = ctx.Identifier[0];
        const type = this.visit(ctx.typeAnnot[0]);
        const init = ctx.expr ? this.visit(ctx.expr[0]) : null;
        const endRange = init?.range ?? type.range;
        return {
            kind: 'VarDecl',
            name: id.image,
            type,
            init,
            range: spanFromTokenToRange(varTok, endRange),
        };
    }
    funcDecl(ctx) {
        const funcTok = ctx.Func[0];
        const id = ctx.Identifier[0];
        const params = ctx.paramList
            ? this.visit(ctx.paramList[0])
            : [];
        const returnType = ctx.typeAnnot
            ? this.visit(ctx.typeAnnot[0])
            : null;
        const body = this.visit(ctx.block[0]);
        return {
            kind: 'FuncDecl',
            annotations: [],
            name: id.image,
            params,
            returnType,
            body,
            range: spanFromTokenToRange(funcTok, body.range),
        };
    }
    faiDecl(ctx) {
        const faiTok = ctx.Fai[0];
        const id = ctx.Identifier[0];
        const params = ctx.faiParamList
            ? this.visit(ctx.faiParamList[0])
            : [];
        const outputs = this.visit(ctx.faiOutputList[0]);
        const body = this.visit(ctx.block[0]);
        return {
            kind: 'FaiDecl',
            annotations: [],
            name: id.image,
            params,
            outputs,
            body,
            range: spanFromTokenToRange(faiTok, body.range),
        };
    }
    exportDecl(ctx) {
        const exportTok = ctx.Export[0];
        let target;
        if (ctx.exportNames)
            target = this.visit(ctx.exportNames[0]);
        else if (ctx.funcDecl)
            target = this.visit(ctx.funcDecl[0]);
        else
            target = this.visit(ctx.faiDecl[0]);
        return {
            kind: 'ExportDecl',
            target,
            range: spanFromTokenToRange(exportTok, target.range),
        };
    }
    exportNames(ctx) {
        const specs = (ctx.exportSpec ?? []).map((c) => this.visit(c));
        if (specs.length === 0) {
            return {
                kind: 'ExportNames',
                specs: [],
                range: emptyRange([]),
            };
        }
        const first = specs[0].range;
        const last = specs[specs.length - 1].range;
        return {
            kind: 'ExportNames',
            specs,
            range: spanRanges(first, last),
        };
    }
    exportSpec(ctx) {
        const ids = ctx.Identifier;
        const name = ids[0].image;
        const alias = ids.length > 1 ? ids[1].image : null;
        return {
            kind: 'ExportSpec',
            name,
            alias,
            range: spanTokens(ids[0], ids[ids.length - 1]),
        };
    }
    // ─── Parameters / Outputs ───────────────────────────────────────────
    paramList(ctx) {
        return (ctx.param ?? []).map((c) => this.visit(c));
    }
    param(ctx) {
        const id = ctx.Identifier[0];
        const type = ctx.typeAnnot
            ? this.visit(ctx.typeAnnot[0])
            : null;
        const endRange = type?.range ?? tokenRange(id);
        return {
            kind: 'Param',
            name: id.image,
            type,
            range: spanFromTokenToRange(id, endRange),
        };
    }
    faiParamList(ctx) {
        return (ctx.faiParam ?? []).map((c) => this.visit(c));
    }
    faiParam(ctx) {
        const id = ctx.Identifier[0];
        const type = this.visit(ctx.typeAnnot[0]);
        return {
            kind: 'FaiParam',
            name: id.image,
            type,
            range: spanFromTokenToRange(id, type.range),
        };
    }
    faiOutputList(ctx) {
        return ctx.faiOutput.map((c) => this.visit(c));
    }
    faiOutput(ctx) {
        const id = ctx.Identifier[0];
        const type = this.visit(ctx.typeAnnot[0]);
        return {
            kind: 'FaiOutput',
            name: id.image,
            type,
            range: spanFromTokenToRange(id, type.range),
        };
    }
    // ─── Types ──────────────────────────────────────────────────────────
    typeAnnot(ctx) {
        if (ctx.enumType)
            return this.visit(ctx.enumType[0]);
        if (ctx.arrayType)
            return this.visit(ctx.arrayType[0]);
        if (ctx.objectType)
            return this.visit(ctx.objectType[0]);
        return this.visit(ctx.scalarType[0]);
    }
    scalarType(ctx) {
        const id = ctx.Identifier[0];
        const constraint = ctx.typeConstraint
            ? this.visit(ctx.typeConstraint[0])
            : null;
        const endRange = constraint?.range ?? tokenRange(id);
        return {
            kind: 'ScalarType',
            name: id.image,
            constraint,
            range: spanFromTokenToRange(id, endRange),
        };
    }
    enumType(ctx) {
        const enumTok = ctx.KwEnum[0];
        const variants = ctx.Identifier.map((t) => t.image);
        const lastId = ctx.Identifier.at(-1);
        return {
            kind: 'EnumType',
            variants,
            range: spanTokens(enumTok, lastId),
        };
    }
    arrayType(ctx) {
        const arrTok = ctx.KwArray[0];
        const element = this.visit(ctx.typeAnnot[0]);
        const rangle = ctx.RAngle[0];
        const constraint = ctx.namedConstraint
            ? this.visit(ctx.namedConstraint[0])
            : null;
        const endRange = constraint?.range ?? tokenRange(rangle);
        return {
            kind: 'ArrayType',
            element,
            constraint,
            range: spanFromTokenToRange(arrTok, endRange),
        };
    }
    objectType(ctx) {
        const objTok = ctx.KwObject[0];
        const rcurly = ctx.RCurly[0];
        const fields = (ctx.objectTypeField ?? []).map((c) => this.visit(c));
        return {
            kind: 'ObjectType',
            fields,
            range: spanTokens(objTok, rcurly),
        };
    }
    objectTypeField(ctx) {
        const id = ctx.Identifier[0];
        const type = this.visit(ctx.typeAnnot[0]);
        return {
            kind: 'ObjectTypeField',
            name: id.image,
            type,
            range: spanFromTokenToRange(id, type.range),
        };
    }
    typeConstraint(ctx) {
        if (ctx.rangeConstraint)
            return this.visit(ctx.rangeConstraint[0]);
        return this.visit(ctx.namedConstraint[0]);
    }
    rangeConstraint(ctx) {
        const nums = ctx.numberLit.map((c) => this.visit(c));
        return {
            kind: 'RangeConstraint',
            min: nums[0].value,
            max: nums[1].value,
            range: spanRanges(nums[0].range, nums[1].range),
        };
    }
    namedConstraint(ctx) {
        const key = ctx.Identifier[0];
        let value;
        let endRange;
        if (ctx.numberLit) {
            const n = this.visit(ctx.numberLit[0]);
            value = n.value;
            endRange = n.range;
        }
        else {
            const sTok = ctx.StringLit[0];
            value = unquoteString(sTok.image);
            endRange = tokenRange(sTok);
        }
        return {
            kind: 'NamedConstraint',
            key: key.image,
            value,
            range: spanFromTokenToRange(key, endRange),
        };
    }
    numberLit(ctx) {
        if (ctx.IntLit) {
            const tok = ctx.IntLit[0];
            return { value: Number.parseInt(tok.image, 10), range: tokenRange(tok) };
        }
        const tok = ctx.FloatLit[0];
        return { value: Number.parseFloat(tok.image), range: tokenRange(tok) };
    }
    // ─── Block / Statements ─────────────────────────────────────────────
    block(ctx) {
        const lcurly = ctx.LCurly[0];
        const rcurly = ctx.RCurly[0];
        const stmts = (ctx.stmt ?? []).map((c) => this.visit(c));
        return { kind: 'Block', stmts, range: spanTokens(lcurly, rcurly) };
    }
    stmt(ctx) {
        if (ctx.letDecl)
            return this.visit(ctx.letDecl[0]);
        if (ctx.ifStmt)
            return this.visit(ctx.ifStmt[0]);
        if (ctx.forStmt)
            return this.visit(ctx.forStmt[0]);
        if (ctx.whileStmt)
            return this.visit(ctx.whileStmt[0]);
        if (ctx.tryStmt)
            return this.visit(ctx.tryStmt[0]);
        if (ctx.breakStmt)
            return this.visit(ctx.breakStmt[0]);
        if (ctx.continueStmt)
            return this.visit(ctx.continueStmt[0]);
        if (ctx.returnStmt)
            return this.visit(ctx.returnStmt[0]);
        if (ctx.assignment)
            return this.visit(ctx.assignment[0]);
        if (ctx.exprStmt)
            return this.visit(ctx.exprStmt[0]);
        throw new Error('unreachable: stmt had no matching alternative');
    }
    letDecl(ctx) {
        const letTok = ctx.Let[0];
        const target = this.visit(ctx.letTarget[0]);
        const type = ctx.typeAnnot
            ? this.visit(ctx.typeAnnot[0])
            : null;
        const init = ctx.expr ? this.visit(ctx.expr[0]) : null;
        const endRange = init?.range ?? type?.range ?? target.range;
        return {
            kind: 'LetDecl',
            target,
            type,
            init,
            range: spanFromTokenToRange(letTok, endRange),
        };
    }
    letTarget(ctx) {
        if (ctx.Identifier) {
            const id = ctx.Identifier[0];
            return { kind: 'IdentTarget', name: id.image, range: tokenRange(id) };
        }
        if (ctx.objectDestruct)
            return this.visit(ctx.objectDestruct[0]);
        return this.visit(ctx.arrayDestruct[0]);
    }
    objectDestruct(ctx) {
        const lcurly = ctx.LCurly[0];
        const rcurly = ctx.RCurly[0];
        const fields = (ctx.destructField ?? []).map((c) => this.visit(c));
        return {
            kind: 'ObjectDestruct',
            fields,
            range: spanTokens(lcurly, rcurly),
        };
    }
    destructField(ctx) {
        const ids = ctx.Identifier;
        const source = ids[0].image;
        const local = ids.length > 1 ? ids[1].image : source;
        return {
            kind: 'DestructField',
            source,
            local,
            range: spanTokens(ids[0], ids[ids.length - 1]),
        };
    }
    arrayDestruct(ctx) {
        const lbracket = ctx.LBracket[0];
        const rbracket = ctx.RBracket[0];
        const names = ctx.Identifier.map((t) => t.image);
        return {
            kind: 'ArrayDestruct',
            names,
            range: spanTokens(lbracket, rbracket),
        };
    }
    assignment(ctx) {
        const target = this.visit(ctx.lvalue[0]);
        const op = this.visit(ctx.assignOp[0]);
        const value = this.visit(ctx.expr[0]);
        return {
            kind: 'Assignment',
            target,
            op,
            value,
            range: spanRanges(target.range, value.range),
        };
    }
    lvalue(ctx) {
        const id = ctx.Identifier[0];
        const suffixes = (ctx.lvalueSuffix ?? []).map((c) => this.visit(c));
        const endRange = suffixes.length > 0 ? suffixes[suffixes.length - 1].range : tokenRange(id);
        return {
            kind: 'LValue',
            base: id.image,
            suffixes,
            range: spanFromTokenToRange(id, endRange),
        };
    }
    lvalueSuffix(ctx) {
        if (ctx.Dot) {
            const dot = ctx.Dot[0];
            const id = ctx.Identifier[0];
            return {
                kind: 'MemberSuffix',
                name: id.image,
                range: spanTokens(dot, id),
            };
        }
        const lbracket = ctx.LBracket[0];
        const rbracket = ctx.RBracket[0];
        const index = this.visit(ctx.expr[0]);
        return {
            kind: 'IndexSuffix',
            index,
            range: spanTokens(lbracket, rbracket),
        };
    }
    assignOp(ctx) {
        if (ctx.Equals)
            return '=';
        if (ctx.PlusEq)
            return '+=';
        if (ctx.MinusEq)
            return '-=';
        if (ctx.StarEq)
            return '*=';
        if (ctx.SlashEq)
            return '/=';
        return '%=';
    }
    ifStmt(ctx) {
        const ifTok = ctx.If[0];
        const exprs = ctx.expr;
        const blocks = ctx.block;
        const cond = this.visit(exprs[0]);
        const then = this.visit(blocks[0]);
        // remaining expr/block pairs (each "else if") + optional final else block
        // grammar: ifStmt has: 1 cond expr + 1 then block + N elif-pairs (expr+block) + optional else block
        const elifs = [];
        for (let i = 1; i < exprs.length; i++) {
            const eCond = this.visit(exprs[i]);
            const eBody = this.visit(blocks[i]);
            elifs.push({
                kind: 'ElseIf',
                cond: eCond,
                body: eBody,
                range: spanRanges(eCond.range, eBody.range),
            });
        }
        // if there is a trailing else, its block is the last one in `blocks`
        let otherwise = null;
        if (blocks.length > exprs.length) {
            otherwise = this.visit(blocks[blocks.length - 1]);
        }
        const endRange = otherwise?.range ?? elifs.at(-1)?.range ?? then.range;
        return {
            kind: 'IfStmt',
            cond,
            then,
            elifs,
            otherwise,
            range: spanFromTokenToRange(ifTok, endRange),
        };
    }
    forStmt(ctx) {
        const forTok = ctx.For[0];
        const binding = ctx.Identifier[0].image;
        const iterable = this.visit(ctx.expr[0]);
        const body = this.visit(ctx.block[0]);
        return {
            kind: 'ForStmt',
            binding,
            iterable,
            body,
            range: spanFromTokenToRange(forTok, body.range),
        };
    }
    whileStmt(ctx) {
        const whileTok = ctx.While[0];
        const cond = this.visit(ctx.expr[0]);
        const body = this.visit(ctx.block[0]);
        return {
            kind: 'WhileStmt',
            cond,
            body,
            range: spanFromTokenToRange(whileTok, body.range),
        };
    }
    tryStmt(ctx) {
        const tryTok = ctx.Try[0];
        const body = this.visit(ctx.block[0]);
        const catches = ctx.catchClause.map((c) => this.visit(c));
        const endRange = catches.at(-1)?.range ?? body.range;
        return {
            kind: 'TryStmt',
            body,
            catches,
            range: spanFromTokenToRange(tryTok, endRange),
        };
    }
    catchClause(ctx) {
        const catchTok = ctx.Catch[0];
        const ids = ctx.Identifier;
        const errorType = ids[0].image;
        const binding = ids.length > 1 ? ids[1].image : null;
        const body = this.visit(ctx.block[0]);
        return {
            kind: 'CatchClause',
            errorType,
            binding,
            body,
            range: spanFromTokenToRange(catchTok, body.range),
        };
    }
    breakStmt(ctx) {
        const tok = ctx.Break[0];
        return { kind: 'BreakStmt', range: tokenRange(tok) };
    }
    continueStmt(ctx) {
        const tok = ctx.Continue[0];
        return { kind: 'ContinueStmt', range: tokenRange(tok) };
    }
    returnStmt(ctx) {
        const retTok = ctx.Return[0];
        const value = ctx.expr ? this.visit(ctx.expr[0]) : null;
        return {
            kind: 'ReturnStmt',
            value,
            range: value ? spanFromTokenToRange(retTok, value.range) : tokenRange(retTok),
        };
    }
    exprStmt(ctx) {
        const expr = this.visit(ctx.expr[0]);
        return { kind: 'ExprStmt', expr, range: expr.range };
    }
    // ─── Expressions ────────────────────────────────────────────────────
    expr(ctx) {
        return this.visit(ctx.ternaryExpr[0]);
    }
    ternaryExpr(ctx) {
        const cond = this.visit(ctx.logicalOrExpr[0]);
        if (!ctx.expr)
            return cond;
        const [thenCst, elseCst] = ctx.expr;
        const thenExpr = this.visit(thenCst);
        const elseExpr = this.visit(elseCst);
        return {
            kind: 'TernaryExpr',
            cond,
            then: thenExpr,
            otherwise: elseExpr,
            range: spanRanges(cond.range, elseExpr.range),
        };
    }
    logicalOrExpr(ctx) {
        return buildLeftAssocBinary(ctx.logicalAndExpr.map((c) => this.visit(c)), (ctx.OrOr ?? []).map(() => '||'));
    }
    logicalAndExpr(ctx) {
        return buildLeftAssocBinary(ctx.equalityExpr.map((c) => this.visit(c)), (ctx.AndAnd ?? []).map(() => '&&'));
    }
    equalityExpr(ctx) {
        const operands = ctx.comparisonExpr.map((c) => this.visit(c));
        const ops = combineOps(ctx, [['EqEq', '=='], ['NotEq', '!=']]);
        return buildLeftAssocBinary(operands, ops);
    }
    comparisonExpr(ctx) {
        const operands = ctx.additiveExpr.map((c) => this.visit(c));
        const ops = combineOps(ctx, [
            ['LAngle', '<'],
            ['LtEq', '<='],
            ['RAngle', '>'],
            ['GtEq', '>='],
        ]);
        return buildLeftAssocBinary(operands, ops);
    }
    additiveExpr(ctx) {
        const operands = ctx.multiplicativeExpr.map((c) => this.visit(c));
        const ops = combineOps(ctx, [['Plus', '+'], ['Dash', '-']]);
        return buildLeftAssocBinary(operands, ops);
    }
    multiplicativeExpr(ctx) {
        const operands = ctx.unaryExpr.map((c) => this.visit(c));
        const ops = combineOps(ctx, [
            ['Star', '*'],
            ['Slash', '/'],
            ['Percent', '%'],
        ]);
        return buildLeftAssocBinary(operands, ops);
    }
    unaryExpr(ctx) {
        const operand = this.visit(ctx.postfixExpr[0]);
        if (ctx.Dash) {
            const dash = ctx.Dash[0];
            return {
                kind: 'UnaryExpr',
                op: '-',
                operand,
                range: spanFromTokenToRange(dash, operand.range),
            };
        }
        if (ctx.Bang) {
            const bang = ctx.Bang[0];
            return {
                kind: 'UnaryExpr',
                op: '!',
                operand,
                range: spanFromTokenToRange(bang, operand.range),
            };
        }
        return operand;
    }
    postfixExpr(ctx) {
        let current = this.visit(ctx.primaryExpr[0]);
        const suffixes = (ctx.postfixSuffix ?? []);
        for (const sufCst of suffixes) {
            const suf = this.visit(sufCst);
            if (suf.tag === 'member') {
                current = {
                    kind: 'MemberExpr',
                    object: current,
                    property: suf.name,
                    range: spanRanges(current.range, suf.range),
                };
            }
            else if (suf.tag === 'index') {
                current = {
                    kind: 'IndexExpr',
                    object: current,
                    index: suf.index,
                    range: spanRanges(current.range, suf.range),
                };
            }
            else {
                current = {
                    kind: 'CallExpr',
                    callee: current,
                    args: suf.args,
                    range: spanRanges(current.range, suf.range),
                };
            }
        }
        return current;
    }
    postfixSuffix(ctx) {
        if (ctx.Dot) {
            const dot = ctx.Dot[0];
            const id = ctx.Identifier[0];
            return { tag: 'member', name: id.image, range: spanTokens(dot, id) };
        }
        if (ctx.LBracket) {
            const lb = ctx.LBracket[0];
            const rb = ctx.RBracket[0];
            const index = this.visit(ctx.expr[0]);
            return { tag: 'index', index, range: spanTokens(lb, rb) };
        }
        const lp = ctx.LParen[0];
        const rp = ctx.RParen[0];
        const args = ctx.argList
            ? this.visit(ctx.argList[0])
            : [];
        return { tag: 'call', args, range: spanTokens(lp, rp) };
    }
    argList(ctx) {
        return ctx.expr.map((c) => this.visit(c));
    }
    primaryExpr(ctx) {
        if (ctx.literal)
            return this.visit(ctx.literal[0]);
        if (ctx.Identifier) {
            const id = ctx.Identifier[0];
            return { kind: 'IdentExpr', name: id.image, range: tokenRange(id) };
        }
        if (ctx.arrayLit)
            return this.visit(ctx.arrayLit[0]);
        if (ctx.objectLit)
            return this.visit(ctx.objectLit[0]);
        // parenthesised
        return this.visit(ctx.expr[0]);
    }
    /**
     * Returns either a plain Literal or a TemplateString. Callers in
     * expression position accept Expr; callers expecting a strict Literal
     * (annotation args, type constraint values) should narrow by `kind`.
     */
    literal(ctx) {
        if (ctx.IntLit) {
            const tok = ctx.IntLit[0];
            return {
                kind: 'IntLit',
                value: Number.parseInt(tok.image, 10),
                range: tokenRange(tok),
            };
        }
        if (ctx.FloatLit) {
            const tok = ctx.FloatLit[0];
            return {
                kind: 'FloatLit',
                value: Number.parseFloat(tok.image),
                range: tokenRange(tok),
            };
        }
        if (ctx.StringLit) {
            const tok = ctx.StringLit[0];
            return buildStringExpr(tok);
        }
        if (ctx.True) {
            const tok = ctx.True[0];
            return { kind: 'BoolLit', value: true, range: tokenRange(tok) };
        }
        if (ctx.False) {
            const tok = ctx.False[0];
            return { kind: 'BoolLit', value: false, range: tokenRange(tok) };
        }
        const tok = ctx.Null[0];
        return { kind: 'NullLit', range: tokenRange(tok) };
    }
    arrayLit(ctx) {
        const lb = ctx.LBracket[0];
        const rb = ctx.RBracket[0];
        const elements = ctx.expr
            ? ctx.expr.map((c) => this.visit(c))
            : [];
        return { kind: 'ArrayLit', elements, range: spanTokens(lb, rb) };
    }
    objectLit(ctx) {
        const lc = ctx.LCurly[0];
        const rc = ctx.RCurly[0];
        const fields = (ctx.objectLitField ?? []).map((c) => this.visit(c));
        return { kind: 'ObjectLit', fields, range: spanTokens(lc, rc) };
    }
    objectLitField(ctx) {
        if (ctx.StringLit) {
            const keyTok = ctx.StringLit[0];
            const value = this.visit(ctx.expr[0]);
            return {
                kind: 'ObjectLitField',
                key: unquoteString(keyTok.image),
                shorthand: false,
                value,
                range: spanFromTokenToRange(keyTok, value.range),
            };
        }
        const idTok = ctx.Identifier[0];
        if (ctx.expr) {
            const value = this.visit(ctx.expr[0]);
            return {
                kind: 'ObjectLitField',
                key: idTok.image,
                shorthand: false,
                value,
                range: spanFromTokenToRange(idTok, value.range),
            };
        }
        // shorthand: { x } means { x: x }
        return {
            kind: 'ObjectLitField',
            key: idTok.image,
            shorthand: true,
            value: { kind: 'IdentExpr', name: idTok.image, range: tokenRange(idTok) },
            range: tokenRange(idTok),
        };
    }
}
// ─── Helpers used by visitor ──────────────────────────────────────────
function spanTokens(start, end) {
    return {
        startLine: start.startLine ?? 0,
        startColumn: start.startColumn ?? 0,
        endLine: end.endLine ?? 0,
        endColumn: end.endColumn ?? 0,
        startOffset: start.startOffset,
        endOffset: end.endOffset ?? end.startOffset,
    };
}
function spanRanges(a, b) {
    return {
        startLine: a.startLine,
        startColumn: a.startColumn,
        endLine: b.endLine,
        endColumn: b.endColumn,
        startOffset: a.startOffset,
        endOffset: b.endOffset,
    };
}
function spanFromTokenToRange(start, end) {
    return {
        startLine: start.startLine ?? 0,
        startColumn: start.startColumn ?? 0,
        endLine: end.endLine,
        endColumn: end.endColumn,
        startOffset: start.startOffset,
        endOffset: end.endOffset,
    };
}
function emptyRange(items) {
    if (items.length === 0) {
        return {
            startLine: 0,
            startColumn: 0,
            endLine: 0,
            endColumn: 0,
            startOffset: 0,
            endOffset: 0,
        };
    }
    const first = items[0].range;
    const last = items[items.length - 1].range;
    return spanRanges(first, last);
}
function findFirstToken(node) {
    // CstNode children: { ruleName: CstNode[] | IToken[], ... }
    const children = node.children;
    let earliest;
    for (const key of Object.keys(children)) {
        const arr = children[key];
        for (const child of arr) {
            let tok;
            if ('image' in child) {
                tok = child;
            }
            else {
                tok = findFirstToken(child);
            }
            if (tok && (!earliest || tok.startOffset < earliest.startOffset)) {
                earliest = tok;
            }
        }
    }
    return earliest;
}
/**
 * Build a left-associative binary expression chain from a list of
 * operands and a parallel list of operators. operators[i] joins
 * operands[i] and operands[i+1].
 */
function buildLeftAssocBinary(operands, operators) {
    let current = operands[0];
    for (let i = 0; i < operators.length; i++) {
        const right = operands[i + 1];
        current = {
            kind: 'BinaryExpr',
            op: operators[i],
            left: current,
            right,
            range: spanRanges(current.range, right.range),
        };
    }
    return current;
}
/**
 * For rules where multiple alternative token names can appear in MANY,
 * gather all operator tokens in source order and map them to AST op strings.
 */
function combineOps(ctx, mapping) {
    const all = [];
    for (const [tokName, op] of mapping) {
        const toks = ctx[tokName] ?? [];
        for (const t of toks)
            all.push({ offset: t.startOffset, op });
    }
    all.sort((a, b) => a.offset - b.offset);
    return all.map((x) => x.op);
}
// ─── Public API ───────────────────────────────────────────────────────
const astBuilder = new TrainAstBuilder();
/**
 * Build a typed AST from a parser CST. Returns null if no CST (parse failed).
 */
export function buildAst(cst) {
    if (!cst)
        return null;
    return astBuilder.visit(cst);
}
//# sourceMappingURL=builder.js.map