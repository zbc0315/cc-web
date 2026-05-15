/**
 * train language lexer
 *
 * Token definitions for chevrotain. Covers Part 1-11 of grammar.ebnf.
 *
 * Implementation notes:
 * - Keywords use `longer_alt: Identifier` so that e.g. `int` is keyword but
 *   `integer` is an identifier (chevrotain picks the longer match).
 * - String literals are currently a single token; ${...} interpolation
 *   parsing is deferred to a later milestone (would require lexer modes).
 * - Whitespace and comments are SKIPPED (consumed but not emitted).
 */
import { Lexer, type TokenType } from 'chevrotain';
export declare const Whitespace: TokenType;
export declare const LineComment: TokenType;
export declare const BlockComment: TokenType;
export declare const Identifier: TokenType;
export declare const Import: TokenType;
export declare const Export: TokenType;
export declare const From: TokenType;
export declare const As: TokenType;
export declare const Const: TokenType;
export declare const Var: TokenType;
export declare const Let: TokenType;
export declare const Func: TokenType;
export declare const Fai: TokenType;
export declare const Return: TokenType;
export declare const If: TokenType;
export declare const Else: TokenType;
export declare const For: TokenType;
export declare const In: TokenType;
export declare const While: TokenType;
export declare const Break: TokenType;
export declare const Continue: TokenType;
export declare const Try: TokenType;
export declare const Catch: TokenType;
export declare const True: TokenType;
export declare const False: TokenType;
export declare const Null: TokenType;
export declare const KwEnum: TokenType;
export declare const KwArray: TokenType;
export declare const KwObject: TokenType;
export declare const FloatLit: TokenType;
export declare const IntLit: TokenType;
export declare const StringLit: TokenType;
export declare const Arrow: TokenType;
export declare const FatArrow: TokenType;
export declare const EqEq: TokenType;
export declare const NotEq: TokenType;
export declare const LtEq: TokenType;
export declare const GtEq: TokenType;
export declare const AndAnd: TokenType;
export declare const OrOr: TokenType;
export declare const PlusEq: TokenType;
export declare const MinusEq: TokenType;
export declare const StarEq: TokenType;
export declare const SlashEq: TokenType;
export declare const PercentEq: TokenType;
export declare const Spread: TokenType;
export declare const LCurly: TokenType;
export declare const RCurly: TokenType;
export declare const LParen: TokenType;
export declare const RParen: TokenType;
export declare const LBracket: TokenType;
export declare const RBracket: TokenType;
export declare const LAngle: TokenType;
export declare const RAngle: TokenType;
export declare const Comma: TokenType;
export declare const Colon: TokenType;
export declare const Semicolon: TokenType;
export declare const Dot: TokenType;
export declare const Question: TokenType;
export declare const AtName: TokenType;
export declare const Plus: TokenType;
export declare const Dash: TokenType;
export declare const Star: TokenType;
export declare const Slash: TokenType;
export declare const Percent: TokenType;
export declare const Bang: TokenType;
export declare const Pipe: TokenType;
export declare const Equals: TokenType;
export declare const allTokens: TokenType[];
export declare const trainLexer: Lexer;
/**
 * Tokenize source text. Throws on lexer errors.
 */
export declare function tokenize(source: string): import("chevrotain").ILexingResult;
//# sourceMappingURL=lexer.d.ts.map