/**
 * train language parser (CST-based)
 *
 * Built with chevrotain's CstParser. Produces a Concrete Syntax Tree;
 * a later transformer step (M1 end) converts CST → typed AST.
 *
 * Coverage as of this milestone:
 *  - Top-level: import / const / var / func / fai / export / @runtime
 *  - Annotations (@cache / @timeout / @adapter / ...) on func & fai decls
 *  - Statements: let (with destructuring), assignment, if/else, for-in,
 *    while, break, continue, return, try-catch, expression statement
 *  - Expressions: full precedence chain (ternary / || / && / == != /
 *    comparison / additive / multiplicative / unary / postfix /
 *    array & object literals / identifiers / literals / parens)
 *  - Types: leaf types with range/named constraints
 *
 * NOT yet implemented (TODO for later):
 *  - Structural types: enum / array<T> / object{...}
 *  - String template interpolation (${...}) — needs lexer modes
 */
import { CstParser, EOF } from 'chevrotain';
import * as t from './lexer.js';
export class TrainParser extends CstParser {
    constructor() {
        super(t.allTokens, { recoveryEnabled: false });
        this.performSelfAnalysis();
    }
    // ─── Program ──────────────────────────────────────────────────────────
    program = this.RULE('program', () => {
        this.MANY(() => this.SUBRULE(this.topLevel));
    });
    /** Entry rule for parsing a bare expression (used by template string
     *  interpolation: the builder hands `${ ... }` body to this rule
     *  rather than re-implementing expression parsing). */
    exprEntry = this.RULE('exprEntry', () => {
        this.SUBRULE(this.expr);
    });
    topLevel = this.RULE('topLevel', () => {
        this.OR([
            { ALT: () => this.SUBRULE(this.importDecl) },
            { ALT: () => this.SUBRULE(this.constDecl) },
            { ALT: () => this.SUBRULE(this.varDecl) },
            // Annotation-prefixed forms — order matters: @runtime is its own
            // top-level statement; any other @<name> applied to func/fai must
            // route to annotatedDecl.
            {
                GATE: () => this.isRuntimeAnnotation(),
                ALT: () => this.SUBRULE(this.runtimeAnnotation),
            },
            {
                GATE: () => this.isAnnotatedFuncOrFai(),
                ALT: () => this.SUBRULE(this.annotatedDecl),
            },
            { ALT: () => this.SUBRULE(this.funcDecl) },
            { ALT: () => this.SUBRULE(this.faiDecl) },
            { ALT: () => this.SUBRULE(this.exportDecl) },
        ]);
    });
    /** @runtime(...) — distinguished from other annotations by literal name. */
    isRuntimeAnnotation() {
        const t1 = this.LA(1);
        return t1.tokenType === t.AtName && t1.image === '@runtime';
    }
    /** Look ahead: an AtName followed eventually by `func` or `fai`. */
    isAnnotatedFuncOrFai() {
        let i = 1;
        while (this.LA(i).tokenType === t.AtName) {
            i++;
            // Skip optional `(...)` arg list of annotation
            if (this.LA(i).tokenType === t.LParen) {
                let depth = 1;
                i++;
                while (depth > 0 && this.LA(i).tokenType !== EOF) {
                    const tok = this.LA(i).tokenType;
                    if (tok === t.LParen)
                        depth++;
                    else if (tok === t.RParen)
                        depth--;
                    i++;
                }
            }
        }
        const next = this.LA(i).tokenType;
        return next === t.Func || next === t.Fai;
    }
    // ─── Imports ──────────────────────────────────────────────────────────
    importDecl = this.RULE('importDecl', () => {
        this.CONSUME(t.Import);
        this.SUBRULE(this.importClause);
        this.CONSUME(t.From);
        this.CONSUME(t.StringLit);
        this.OPTION(() => this.CONSUME(t.AtName));
    });
    importClause = this.RULE('importClause', () => {
        this.OR([
            { ALT: () => this.SUBRULE(this.namedImports) },
            { ALT: () => this.SUBRULE(this.namespaceImport) },
        ]);
    });
    namedImports = this.RULE('namedImports', () => {
        this.CONSUME(t.LCurly);
        this.SUBRULE(this.importSpec);
        this.MANY(() => {
            this.CONSUME(t.Comma);
            this.SUBRULE2(this.importSpec);
        });
        this.OPTION(() => this.CONSUME2(t.Comma)); // trailing comma
        this.CONSUME(t.RCurly);
    });
    importSpec = this.RULE('importSpec', () => {
        this.CONSUME(t.Identifier);
        this.OPTION(() => {
            this.CONSUME(t.As);
            this.CONSUME2(t.Identifier);
        });
    });
    namespaceImport = this.RULE('namespaceImport', () => {
        this.CONSUME(t.Star);
        this.CONSUME(t.As);
        this.CONSUME(t.Identifier);
    });
    // ─── Annotations ──────────────────────────────────────────────────────
    /** Top-level `@runtime(adapter = "claude", ...)`. */
    runtimeAnnotation = this.RULE('runtimeAnnotation', () => {
        this.CONSUME(t.AtName); // must literally be "@runtime"; semantic layer enforces name
        this.OPTION(() => {
            this.CONSUME(t.LParen);
            this.OPTION2(() => this.SUBRULE(this.annoArgList));
            this.CONSUME(t.RParen);
        });
    });
    /** Decoration-style annotation attached to a func/fai/import declaration. */
    declAnnotation = this.RULE('declAnnotation', () => {
        this.CONSUME(t.AtName);
        this.OPTION(() => {
            this.CONSUME(t.LParen);
            this.OPTION2(() => this.SUBRULE(this.annoArgList));
            this.CONSUME(t.RParen);
        });
    });
    annoArgList = this.RULE('annoArgList', () => {
        this.SUBRULE(this.annoArg);
        this.MANY(() => {
            this.CONSUME(t.Comma);
            this.SUBRULE2(this.annoArg);
        });
        this.OPTION(() => this.CONSUME2(t.Comma));
    });
    annoArg = this.RULE('annoArg', () => {
        // Either `key = value` or bare `value`
        this.OR([
            {
                GATE: () => this.LA(1).tokenType === t.Identifier &&
                    this.LA(2).tokenType === t.Equals,
                ALT: () => {
                    this.CONSUME(t.Identifier);
                    this.CONSUME(t.Equals);
                    this.SUBRULE(this.literal);
                },
            },
            { ALT: () => this.SUBRULE2(this.literal) },
        ]);
    });
    /** Wrapper: zero-or-more decl annotations followed by func or fai decl. */
    annotatedDecl = this.RULE('annotatedDecl', () => {
        this.AT_LEAST_ONE(() => this.SUBRULE(this.declAnnotation));
        this.OR([
            { ALT: () => this.SUBRULE(this.funcDecl) },
            { ALT: () => this.SUBRULE(this.faiDecl) },
        ]);
    });
    // ─── Top-level declarations ───────────────────────────────────────────
    constDecl = this.RULE('constDecl', () => {
        this.CONSUME(t.Const);
        this.CONSUME(t.Identifier);
        this.CONSUME(t.Colon);
        this.SUBRULE(this.declTypeAnnot);
        this.CONSUME(t.Equals);
        this.SUBRULE(this.expr);
    });
    varDecl = this.RULE('varDecl', () => {
        this.CONSUME(t.Var);
        this.CONSUME(t.Identifier);
        this.CONSUME(t.Colon);
        this.SUBRULE(this.declTypeAnnot);
        this.OPTION(() => {
            this.CONSUME(t.Equals);
            this.SUBRULE(this.expr);
        });
    });
    funcDecl = this.RULE('funcDecl', () => {
        this.CONSUME(t.Func);
        this.CONSUME(t.Identifier);
        this.CONSUME(t.LParen);
        this.OPTION(() => this.SUBRULE(this.paramList));
        this.CONSUME(t.RParen);
        this.OPTION2(() => {
            this.CONSUME(t.Arrow);
            this.SUBRULE(this.typeAnnot);
        });
        this.SUBRULE(this.block);
    });
    faiDecl = this.RULE('faiDecl', () => {
        this.CONSUME(t.Fai);
        this.CONSUME(t.Identifier);
        this.CONSUME(t.LParen);
        this.OPTION(() => this.SUBRULE(this.faiParamList));
        this.CONSUME(t.RParen);
        this.CONSUME(t.Arrow);
        this.SUBRULE(this.faiOutputList);
        this.SUBRULE(this.block);
    });
    exportDecl = this.RULE('exportDecl', () => {
        this.CONSUME(t.Export);
        this.OR([
            { ALT: () => this.SUBRULE(this.exportNames) },
            { ALT: () => this.SUBRULE(this.funcDecl) },
            { ALT: () => this.SUBRULE(this.faiDecl) },
        ]);
    });
    exportNames = this.RULE('exportNames', () => {
        this.OR([
            {
                ALT: () => {
                    // `export name [as alias]` or `export name`
                    this.SUBRULE(this.exportSpec);
                },
            },
            {
                ALT: () => {
                    this.CONSUME(t.LCurly);
                    this.SUBRULE2(this.exportSpec);
                    this.MANY(() => {
                        this.CONSUME(t.Comma);
                        this.SUBRULE3(this.exportSpec);
                    });
                    this.OPTION(() => this.CONSUME2(t.Comma));
                    this.CONSUME(t.RCurly);
                },
            },
        ]);
    });
    exportSpec = this.RULE('exportSpec', () => {
        this.CONSUME(t.Identifier);
        this.OPTION(() => {
            this.CONSUME(t.As);
            this.CONSUME2(t.Identifier);
        });
    });
    // ─── Parameters / Outputs ─────────────────────────────────────────────
    paramList = this.RULE('paramList', () => {
        this.SUBRULE(this.param);
        this.MANY(() => {
            this.CONSUME(t.Comma);
            this.SUBRULE2(this.param);
        });
        this.OPTION(() => this.CONSUME2(t.Comma));
    });
    param = this.RULE('param', () => {
        this.CONSUME(t.Identifier);
        this.OPTION(() => {
            this.CONSUME(t.Colon);
            this.SUBRULE(this.typeAnnot);
        });
    });
    faiParamList = this.RULE('faiParamList', () => {
        this.SUBRULE(this.faiParam);
        this.MANY(() => {
            this.CONSUME(t.Comma);
            this.SUBRULE2(this.faiParam);
        });
        this.OPTION(() => this.CONSUME2(t.Comma));
    });
    faiParam = this.RULE('faiParam', () => {
        this.CONSUME(t.Identifier);
        this.CONSUME(t.Colon);
        this.SUBRULE(this.typeAnnot);
    });
    faiOutputList = this.RULE('faiOutputList', () => {
        this.SUBRULE(this.faiOutput);
        this.MANY(() => {
            this.CONSUME(t.Comma);
            this.SUBRULE2(this.faiOutput);
        });
    });
    faiOutput = this.RULE('faiOutput', () => {
        this.CONSUME(t.Identifier);
        this.CONSUME(t.Colon);
        this.SUBRULE(this.typeAnnot);
    });
    // ─── Type annotations ─────────────────────────────────────────────────
    typeAnnot = this.RULE('typeAnnot', () => {
        this.OR([
            { ALT: () => this.SUBRULE(this.enumType) },
            { ALT: () => this.SUBRULE(this.arrayType) },
            { ALT: () => this.SUBRULE(this.objectType) },
            { ALT: () => this.SUBRULE(this.scalarType) }, // catch-all leaf type
        ]);
    });
    // Variant of typeAnnot used by let/var/const declarations. These
    // forbid trailing named constraints (`int 0-10`, `maxLen=5`, etc.)
    // because the following statement (`x = 5`) would otherwise be
    // silently absorbed as a NamedConstraint, swallowing the assignment.
    // Constraints belong on fai outputs / func params where they're
    // contract-relevant, not on local bindings.
    declTypeAnnot = this.RULE('declTypeAnnot', () => {
        this.OR([
            { ALT: () => this.SUBRULE(this.enumType) },
            { ALT: () => this.SUBRULE(this.declArrayType) },
            { ALT: () => this.SUBRULE(this.objectType) },
            { ALT: () => this.SUBRULE(this.declScalarType) },
        ]);
    });
    declScalarType = this.RULE('declScalarType', () => {
        this.CONSUME(t.Identifier);
    });
    declArrayType = this.RULE('declArrayType', () => {
        this.CONSUME(t.KwArray);
        this.CONSUME(t.LAngle);
        this.SUBRULE(this.typeAnnot);
        this.CONSUME(t.RAngle);
    });
    scalarType = this.RULE('scalarType', () => {
        this.CONSUME(t.Identifier); // int / float / bool / string / prompt / any / etc.
        this.OPTION(() => this.SUBRULE(this.typeConstraint));
    });
    enumType = this.RULE('enumType', () => {
        this.CONSUME(t.KwEnum);
        this.CONSUME(t.Colon);
        this.CONSUME(t.Identifier); // first variant
        this.MANY(() => {
            this.CONSUME(t.Pipe);
            this.CONSUME2(t.Identifier);
        });
    });
    arrayType = this.RULE('arrayType', () => {
        this.CONSUME(t.KwArray);
        this.CONSUME(t.LAngle);
        this.SUBRULE(this.typeAnnot);
        this.CONSUME(t.RAngle);
        this.OPTION(() => this.SUBRULE(this.namedConstraint));
    });
    objectType = this.RULE('objectType', () => {
        this.CONSUME(t.KwObject);
        this.CONSUME(t.LCurly);
        this.SUBRULE(this.objectTypeField);
        this.MANY(() => {
            this.CONSUME(t.Comma);
            this.SUBRULE2(this.objectTypeField);
        });
        this.OPTION(() => this.CONSUME2(t.Comma));
        this.CONSUME(t.RCurly);
    });
    objectTypeField = this.RULE('objectTypeField', () => {
        this.CONSUME(t.Identifier);
        this.CONSUME(t.Colon);
        this.SUBRULE(this.typeAnnot);
    });
    typeConstraint = this.RULE('typeConstraint', () => {
        this.OR([
            {
                GATE: () => this.isRangeConstraint(),
                ALT: () => this.SUBRULE(this.rangeConstraint),
            },
            { ALT: () => this.SUBRULE(this.namedConstraint) },
        ]);
    });
    /** Range constraint starts with a numeric literal; named with identifier. */
    isRangeConstraint() {
        const t1 = this.LA(1).tokenType;
        return t1 === t.IntLit || t1 === t.FloatLit;
    }
    rangeConstraint = this.RULE('rangeConstraint', () => {
        this.SUBRULE(this.numberLit);
        this.CONSUME(t.Dash);
        this.SUBRULE2(this.numberLit);
    });
    namedConstraint = this.RULE('namedConstraint', () => {
        this.CONSUME(t.Identifier); // "maxLen", "minLen", "min", "max", "matches"
        this.CONSUME(t.Equals);
        this.OR([
            { ALT: () => this.SUBRULE(this.numberLit) },
            { ALT: () => this.CONSUME(t.StringLit) },
        ]);
    });
    numberLit = this.RULE('numberLit', () => {
        this.OR([
            { ALT: () => this.CONSUME(t.IntLit) },
            { ALT: () => this.CONSUME(t.FloatLit) },
        ]);
    });
    // ─── Block / Statements ───────────────────────────────────────────────
    block = this.RULE('block', () => {
        this.CONSUME(t.LCurly);
        this.MANY(() => this.SUBRULE(this.stmt));
        this.CONSUME(t.RCurly);
    });
    stmt = this.RULE('stmt', () => {
        this.OR([
            { ALT: () => this.SUBRULE(this.letDecl) },
            { ALT: () => this.SUBRULE(this.ifStmt) },
            { ALT: () => this.SUBRULE(this.forStmt) },
            { ALT: () => this.SUBRULE(this.whileStmt) },
            { ALT: () => this.SUBRULE(this.tryStmt) },
            { ALT: () => this.SUBRULE(this.breakStmt) },
            { ALT: () => this.SUBRULE(this.continueStmt) },
            { ALT: () => this.SUBRULE(this.returnStmt) },
            // Assignment vs expression-statement: both start with the same
            // primary tokens (Identifier mostly). Distinguish by lookahead.
            {
                GATE: () => this.isAssignment(),
                ALT: () => this.SUBRULE(this.assignment),
            },
            { ALT: () => this.SUBRULE(this.exprStmt) },
        ]);
        // Optional explicit semicolon terminator. Newlines are also treated
        // as terminators implicitly by chevrotain (which skips whitespace),
        // so most programs write one statement per line.
        this.OPTION(() => this.CONSUME(t.Semicolon));
    });
    /**
     * An assignment starts with an l-value (Identifier with optional . [ suffixes)
     * followed by an assignment operator. We scan ahead, skipping balanced
     * brackets, looking for one of the assignment ops at the same paren depth.
     */
    isAssignment() {
        if (this.LA(1).tokenType !== t.Identifier)
            return false;
        let i = 2;
        let depth = 0;
        while (true) {
            const tok = this.LA(i).tokenType;
            if (tok === EOF)
                return false;
            if (depth === 0) {
                if (tok === t.Equals ||
                    tok === t.PlusEq ||
                    tok === t.MinusEq ||
                    tok === t.StarEq ||
                    tok === t.SlashEq ||
                    tok === t.PercentEq) {
                    return true;
                }
                // boundaries that disqualify l-value parsing
                if (tok === t.Semicolon ||
                    tok === t.RCurly ||
                    tok === t.LCurly ||
                    tok === t.Comma ||
                    tok === t.RParen) {
                    return false;
                }
                // valid l-value continuations
                if (tok === t.Dot || tok === t.Identifier) {
                    i++;
                    continue;
                }
                if (tok === t.LBracket || tok === t.LParen) {
                    depth++;
                    i++;
                    continue;
                }
                // Any other token at depth 0 means this isn't a plain l-value chain
                return false;
            }
            else {
                // inside brackets: skip until balanced
                if (tok === t.LBracket || tok === t.LParen)
                    depth++;
                else if (tok === t.RBracket || tok === t.RParen)
                    depth--;
                i++;
                if (depth < 0)
                    return false;
            }
        }
    }
    letDecl = this.RULE('letDecl', () => {
        this.CONSUME(t.Let);
        this.SUBRULE(this.letTarget);
        this.OPTION(() => {
            this.CONSUME(t.Colon);
            this.SUBRULE(this.declTypeAnnot);
        });
        this.OPTION2(() => {
            this.CONSUME(t.Equals);
            this.SUBRULE(this.expr);
        });
    });
    letTarget = this.RULE('letTarget', () => {
        this.OR([
            { ALT: () => this.CONSUME(t.Identifier) },
            { ALT: () => this.SUBRULE(this.objectDestruct) },
            { ALT: () => this.SUBRULE(this.arrayDestruct) },
        ]);
    });
    objectDestruct = this.RULE('objectDestruct', () => {
        this.CONSUME(t.LCurly);
        this.SUBRULE(this.destructField);
        this.MANY(() => {
            this.CONSUME(t.Comma);
            this.SUBRULE2(this.destructField);
        });
        this.OPTION(() => this.CONSUME2(t.Comma));
        this.CONSUME(t.RCurly);
    });
    destructField = this.RULE('destructField', () => {
        this.CONSUME(t.Identifier);
        this.OPTION(() => {
            this.CONSUME(t.Colon);
            this.CONSUME2(t.Identifier);
        });
    });
    arrayDestruct = this.RULE('arrayDestruct', () => {
        this.CONSUME(t.LBracket);
        this.CONSUME(t.Identifier);
        this.MANY(() => {
            this.CONSUME(t.Comma);
            this.CONSUME2(t.Identifier);
        });
        this.OPTION(() => this.CONSUME2(t.Comma));
        this.CONSUME(t.RBracket);
    });
    assignment = this.RULE('assignment', () => {
        this.SUBRULE(this.lvalue);
        this.SUBRULE(this.assignOp);
        this.SUBRULE(this.expr);
    });
    lvalue = this.RULE('lvalue', () => {
        this.CONSUME(t.Identifier);
        this.MANY(() => this.SUBRULE(this.lvalueSuffix));
    });
    lvalueSuffix = this.RULE('lvalueSuffix', () => {
        this.OR([
            {
                ALT: () => {
                    this.CONSUME(t.Dot);
                    this.CONSUME(t.Identifier);
                },
            },
            {
                ALT: () => {
                    this.CONSUME(t.LBracket);
                    this.SUBRULE(this.expr);
                    this.CONSUME(t.RBracket);
                },
            },
        ]);
    });
    assignOp = this.RULE('assignOp', () => {
        this.OR([
            { ALT: () => this.CONSUME(t.Equals) },
            { ALT: () => this.CONSUME(t.PlusEq) },
            { ALT: () => this.CONSUME(t.MinusEq) },
            { ALT: () => this.CONSUME(t.StarEq) },
            { ALT: () => this.CONSUME(t.SlashEq) },
            { ALT: () => this.CONSUME(t.PercentEq) },
        ]);
    });
    ifStmt = this.RULE('ifStmt', () => {
        this.CONSUME(t.If);
        this.CONSUME(t.LParen);
        this.SUBRULE(this.expr);
        this.CONSUME(t.RParen);
        this.SUBRULE(this.block);
        this.MANY({
            GATE: () => this.LA(1).tokenType === t.Else && this.LA(2).tokenType === t.If,
            DEF: () => {
                this.CONSUME(t.Else);
                this.CONSUME2(t.If);
                this.CONSUME2(t.LParen);
                this.SUBRULE2(this.expr);
                this.CONSUME2(t.RParen);
                this.SUBRULE2(this.block);
            },
        });
        this.OPTION(() => {
            this.CONSUME3(t.Else);
            this.SUBRULE3(this.block);
        });
    });
    forStmt = this.RULE('forStmt', () => {
        this.CONSUME(t.For);
        this.CONSUME(t.Identifier);
        this.CONSUME(t.In);
        this.SUBRULE(this.expr);
        this.SUBRULE(this.block);
    });
    whileStmt = this.RULE('whileStmt', () => {
        this.CONSUME(t.While);
        this.CONSUME(t.LParen);
        this.SUBRULE(this.expr);
        this.CONSUME(t.RParen);
        this.SUBRULE(this.block);
    });
    tryStmt = this.RULE('tryStmt', () => {
        this.CONSUME(t.Try);
        this.SUBRULE(this.block);
        this.AT_LEAST_ONE(() => this.SUBRULE(this.catchClause));
    });
    catchClause = this.RULE('catchClause', () => {
        this.CONSUME(t.Catch);
        this.CONSUME(t.Identifier); // exception type name
        this.OPTION(() => {
            this.CONSUME(t.As);
            this.CONSUME2(t.Identifier); // bound variable
        });
        this.SUBRULE(this.block);
    });
    breakStmt = this.RULE('breakStmt', () => {
        this.CONSUME(t.Break);
    });
    continueStmt = this.RULE('continueStmt', () => {
        this.CONSUME(t.Continue);
    });
    returnStmt = this.RULE('returnStmt', () => {
        this.CONSUME(t.Return);
        this.OPTION({
            // Avoid eating tokens that begin the next statement.
            GATE: () => this.canStartExpression(),
            DEF: () => this.SUBRULE(this.expr),
        });
    });
    /** Heuristic: does the current lookahead token start an expression? */
    canStartExpression() {
        const tok = this.LA(1).tokenType;
        return (tok === t.IntLit ||
            tok === t.FloatLit ||
            tok === t.StringLit ||
            tok === t.True ||
            tok === t.False ||
            tok === t.Null ||
            tok === t.Identifier ||
            tok === t.LParen ||
            tok === t.LBracket ||
            tok === t.LCurly ||
            tok === t.Dash ||
            tok === t.Bang);
    }
    exprStmt = this.RULE('exprStmt', () => {
        this.SUBRULE(this.expr);
    });
    // ─── Expressions (precedence from LOW to HIGH) ────────────────────────
    expr = this.RULE('expr', () => {
        this.SUBRULE(this.ternaryExpr);
    });
    ternaryExpr = this.RULE('ternaryExpr', () => {
        this.SUBRULE(this.logicalOrExpr);
        this.OPTION(() => {
            this.CONSUME(t.Question);
            this.SUBRULE(this.expr);
            this.CONSUME(t.Colon);
            this.SUBRULE2(this.expr);
        });
    });
    logicalOrExpr = this.RULE('logicalOrExpr', () => {
        this.SUBRULE(this.logicalAndExpr);
        this.MANY(() => {
            this.CONSUME(t.OrOr);
            this.SUBRULE2(this.logicalAndExpr);
        });
    });
    logicalAndExpr = this.RULE('logicalAndExpr', () => {
        this.SUBRULE(this.equalityExpr);
        this.MANY(() => {
            this.CONSUME(t.AndAnd);
            this.SUBRULE2(this.equalityExpr);
        });
    });
    equalityExpr = this.RULE('equalityExpr', () => {
        this.SUBRULE(this.comparisonExpr);
        this.MANY(() => {
            this.OR([
                { ALT: () => this.CONSUME(t.EqEq) },
                { ALT: () => this.CONSUME(t.NotEq) },
            ]);
            this.SUBRULE2(this.comparisonExpr);
        });
    });
    comparisonExpr = this.RULE('comparisonExpr', () => {
        this.SUBRULE(this.additiveExpr);
        this.MANY(() => {
            this.OR([
                { ALT: () => this.CONSUME(t.LAngle) },
                { ALT: () => this.CONSUME(t.LtEq) },
                { ALT: () => this.CONSUME(t.RAngle) },
                { ALT: () => this.CONSUME(t.GtEq) },
            ]);
            this.SUBRULE2(this.additiveExpr);
        });
    });
    additiveExpr = this.RULE('additiveExpr', () => {
        this.SUBRULE(this.multiplicativeExpr);
        this.MANY(() => {
            this.OR([
                { ALT: () => this.CONSUME(t.Plus) },
                { ALT: () => this.CONSUME(t.Dash) },
            ]);
            this.SUBRULE2(this.multiplicativeExpr);
        });
    });
    multiplicativeExpr = this.RULE('multiplicativeExpr', () => {
        this.SUBRULE(this.unaryExpr);
        this.MANY(() => {
            this.OR([
                { ALT: () => this.CONSUME(t.Star) },
                { ALT: () => this.CONSUME(t.Slash) },
                { ALT: () => this.CONSUME(t.Percent) },
            ]);
            this.SUBRULE2(this.unaryExpr);
        });
    });
    unaryExpr = this.RULE('unaryExpr', () => {
        this.OPTION(() => {
            this.OR([
                { ALT: () => this.CONSUME(t.Dash) },
                { ALT: () => this.CONSUME(t.Bang) },
            ]);
        });
        this.SUBRULE(this.postfixExpr);
    });
    postfixExpr = this.RULE('postfixExpr', () => {
        this.SUBRULE(this.primaryExpr);
        this.MANY(() => this.SUBRULE(this.postfixSuffix));
    });
    postfixSuffix = this.RULE('postfixSuffix', () => {
        this.OR([
            {
                ALT: () => {
                    this.CONSUME(t.Dot);
                    this.CONSUME(t.Identifier);
                },
            },
            {
                ALT: () => {
                    this.CONSUME(t.LBracket);
                    this.SUBRULE(this.expr);
                    this.CONSUME(t.RBracket);
                },
            },
            {
                ALT: () => {
                    this.CONSUME(t.LParen);
                    this.OPTION(() => this.SUBRULE(this.argList));
                    this.CONSUME(t.RParen);
                },
            },
        ]);
    });
    argList = this.RULE('argList', () => {
        this.SUBRULE(this.expr);
        this.MANY(() => {
            this.CONSUME(t.Comma);
            this.SUBRULE2(this.expr);
        });
        this.OPTION(() => this.CONSUME2(t.Comma));
    });
    primaryExpr = this.RULE('primaryExpr', () => {
        this.OR([
            { ALT: () => this.SUBRULE(this.literal) },
            { ALT: () => this.CONSUME(t.Identifier) },
            { ALT: () => this.SUBRULE(this.arrayLit) },
            { ALT: () => this.SUBRULE(this.objectLit) },
            {
                ALT: () => {
                    this.CONSUME(t.LParen);
                    this.SUBRULE(this.expr);
                    this.CONSUME(t.RParen);
                },
            },
        ]);
    });
    literal = this.RULE('literal', () => {
        this.OR([
            { ALT: () => this.CONSUME(t.IntLit) },
            { ALT: () => this.CONSUME(t.FloatLit) },
            { ALT: () => this.CONSUME(t.StringLit) },
            { ALT: () => this.CONSUME(t.True) },
            { ALT: () => this.CONSUME(t.False) },
            { ALT: () => this.CONSUME(t.Null) },
        ]);
    });
    arrayLit = this.RULE('arrayLit', () => {
        this.CONSUME(t.LBracket);
        this.OPTION(() => {
            this.SUBRULE(this.expr);
            this.MANY(() => {
                this.CONSUME(t.Comma);
                this.SUBRULE2(this.expr);
            });
            this.OPTION2(() => this.CONSUME2(t.Comma));
        });
        this.CONSUME(t.RBracket);
    });
    objectLit = this.RULE('objectLit', () => {
        this.CONSUME(t.LCurly);
        this.OPTION(() => {
            this.SUBRULE(this.objectLitField);
            this.MANY(() => {
                this.CONSUME(t.Comma);
                this.SUBRULE2(this.objectLitField);
            });
            this.OPTION2(() => this.CONSUME2(t.Comma));
        });
        this.CONSUME(t.RCurly);
    });
    objectLitField = this.RULE('objectLitField', () => {
        this.OR([
            {
                // `"key": value`
                GATE: () => this.LA(1).tokenType === t.StringLit,
                ALT: () => {
                    this.CONSUME(t.StringLit);
                    this.CONSUME(t.Colon);
                    this.SUBRULE(this.expr);
                },
            },
            {
                // `key: value` or shorthand `key`
                ALT: () => {
                    this.CONSUME(t.Identifier);
                    this.OPTION(() => {
                        this.CONSUME2(t.Colon);
                        this.SUBRULE2(this.expr);
                    });
                },
            },
        ]);
    });
}
// Singleton parser instance (chevrotain best practice — performSelfAnalysis is expensive)
export const trainParser = new TrainParser();
/**
 * Parse train source text. Returns CST + any errors (does not throw on parse errors,
 * to allow IDE-style error reporting).
 */
export function parse(source) {
    const lexResult = t.trainLexer.tokenize(source);
    trainParser.input = lexResult.tokens;
    const cst = trainParser.program();
    return {
        cst,
        lexErrors: lexResult.errors,
        parseErrors: trainParser.errors,
    };
}
/**
 * Parse a single expression. Used internally by the template-string
 * interpolation builder. The source must be exactly an expression
 * (no surrounding statement/punctuation).
 */
export function parseExpression(source) {
    const lexResult = t.trainLexer.tokenize(source);
    trainParser.input = lexResult.tokens;
    const cst = trainParser.exprEntry();
    return {
        cst,
        lexErrors: lexResult.errors,
        parseErrors: trainParser.errors,
    };
}
//# sourceMappingURL=parser.js.map