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
import { CstParser, type CstNode } from 'chevrotain';
export declare class TrainParser extends CstParser {
    constructor();
    program: import("chevrotain").ParserMethod<[], CstNode>;
    /** Entry rule for parsing a bare expression (used by template string
     *  interpolation: the builder hands `${ ... }` body to this rule
     *  rather than re-implementing expression parsing). */
    exprEntry: import("chevrotain").ParserMethod<[], CstNode>;
    private topLevel;
    /** @runtime(...) — distinguished from other annotations by literal name. */
    private isRuntimeAnnotation;
    /** Look ahead: an AtName followed eventually by `func` or `fai`. */
    private isAnnotatedFuncOrFai;
    private importDecl;
    private importClause;
    private namedImports;
    private importSpec;
    private namespaceImport;
    /** Top-level `@runtime(adapter = "claude", ...)`. */
    private runtimeAnnotation;
    /** Decoration-style annotation attached to a func/fai/import declaration. */
    private declAnnotation;
    private annoArgList;
    private annoArg;
    /** Wrapper: zero-or-more decl annotations followed by func or fai decl. */
    private annotatedDecl;
    private constDecl;
    private varDecl;
    private funcDecl;
    private faiDecl;
    private exportDecl;
    private exportNames;
    private exportSpec;
    private paramList;
    private param;
    private faiParamList;
    private faiParam;
    private faiOutputList;
    private faiOutput;
    private typeAnnot;
    private declTypeAnnot;
    private declScalarType;
    private declArrayType;
    private scalarType;
    private enumType;
    private arrayType;
    private objectType;
    private objectTypeField;
    private typeConstraint;
    /** Range constraint starts with a numeric literal; named with identifier. */
    private isRangeConstraint;
    private rangeConstraint;
    private namedConstraint;
    private numberLit;
    private block;
    private stmt;
    /**
     * An assignment starts with an l-value (Identifier with optional . [ suffixes)
     * followed by an assignment operator. We scan ahead, skipping balanced
     * brackets, looking for one of the assignment ops at the same paren depth.
     */
    private isAssignment;
    private letDecl;
    private letTarget;
    private objectDestruct;
    private destructField;
    private arrayDestruct;
    private assignment;
    private lvalue;
    private lvalueSuffix;
    private assignOp;
    private ifStmt;
    private forStmt;
    private whileStmt;
    private tryStmt;
    private catchClause;
    private breakStmt;
    private continueStmt;
    private returnStmt;
    /** Heuristic: does the current lookahead token start an expression? */
    private canStartExpression;
    private exprStmt;
    private expr;
    private ternaryExpr;
    private logicalOrExpr;
    private logicalAndExpr;
    private equalityExpr;
    private comparisonExpr;
    private additiveExpr;
    private multiplicativeExpr;
    private unaryExpr;
    private postfixExpr;
    private postfixSuffix;
    private argList;
    private primaryExpr;
    private literal;
    private arrayLit;
    private objectLit;
    private objectLitField;
}
export declare const trainParser: TrainParser;
export interface ParseResult {
    cst: CstNode | undefined;
    lexErrors: ReadonlyArray<unknown>;
    parseErrors: ReadonlyArray<unknown>;
}
/**
 * Parse train source text. Returns CST + any errors (does not throw on parse errors,
 * to allow IDE-style error reporting).
 */
export declare function parse(source: string): ParseResult;
/**
 * Parse a single expression. Used internally by the template-string
 * interpolation builder. The source must be exactly an expression
 * (no surrounding statement/punctuation).
 */
export declare function parseExpression(source: string): ParseResult;
//# sourceMappingURL=parser.d.ts.map