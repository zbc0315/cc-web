/**
 * ⚠️ 本文件是 backend/src/track-flow/if-expr-parser.ts 的精确副本（v-h 起）。
 * 任何修改必须双向同步，否则前端 validator 通过 / backend runtime 失败（或反之）。
 * spec §5.4 明确受限语法不再扩展，维护负担小。
 *
 * Restricted expression language for IfNode.conditionExpr (spec §5.4).
 *
 *   expr     := term (('&&'|'||') term)*       — left-associative, same priority
 *   term     := atom (('=='|'!='|'>'|'<'|'>='|'<=') atom)?
 *   atom     := varName | literal | '(' expr ')'
 *   literal  := number | string | 'true' | 'false' | 'null'
 *   varName  := [a-zA-Z_][a-zA-Z0-9_]*
 *
 * No function calls, no arithmetic, no field access — kept tiny so it can
 * be evaluated safely without eval().
 */

export type IfExprAst =
  | { kind: 'literal'; value: number | string | boolean | null }
  | { kind: 'var'; name: string }
  | { kind: 'compare'; op: '==' | '!=' | '>' | '<' | '>=' | '<='; left: IfExprAst; right: IfExprAst }
  | { kind: 'and'; left: IfExprAst; right: IfExprAst }
  | { kind: 'or'; left: IfExprAst; right: IfExprAst }

type Token =
  | { kind: 'num'; value: number }
  | { kind: 'str'; value: string }
  | { kind: 'kw'; value: 'true' | 'false' | 'null' }
  | { kind: 'ident'; value: string }
  | { kind: 'op'; value: '==' | '!=' | '>' | '<' | '>=' | '<=' | '&&' | '||' }
  | { kind: 'punc'; value: '(' | ')' }

function tokenize(src: string): Token[] {
  const tokens: Token[] = []
  let i = 0
  while (i < src.length) {
    const c = src[i]!
    if (/\s/.test(c)) { i++; continue }
    // 字符串
    if (c === '"') {
      const end = src.indexOf('"', i + 1)
      if (end === -1) throw new Error(`unterminated string at position ${i}`)
      tokens.push({ kind: 'str', value: src.slice(i + 1, end) })
      i = end + 1
      continue
    }
    // 数字（含可选 -）
    if (/[0-9]/.test(c) || (c === '-' && /[0-9]/.test(src[i + 1] ?? ''))) {
      let j = i + (c === '-' ? 1 : 0)
      while (j < src.length && /[0-9.]/.test(src[j]!)) j++
      const numStr = src.slice(i, j)
      const num = Number(numStr)
      if (Number.isNaN(num)) throw new Error(`invalid number "${numStr}"`)
      tokens.push({ kind: 'num', value: num })
      i = j
      continue
    }
    // 标识符 / 关键字
    if (/[a-zA-Z_]/.test(c)) {
      let j = i
      while (j < src.length && /[a-zA-Z0-9_]/.test(src[j]!)) j++
      const word = src.slice(i, j)
      if (word === 'true' || word === 'false' || word === 'null') {
        tokens.push({ kind: 'kw', value: word })
      } else {
        tokens.push({ kind: 'ident', value: word })
      }
      i = j
      continue
    }
    // 运算符
    const two = src.slice(i, i + 2)
    if (['==', '!=', '>=', '<=', '&&', '||'].includes(two)) {
      tokens.push({ kind: 'op', value: two as '==' })
      i += 2
      continue
    }
    if (c === '>' || c === '<') {
      tokens.push({ kind: 'op', value: c })
      i += 1
      continue
    }
    if (c === '(' || c === ')') {
      tokens.push({ kind: 'punc', value: c })
      i += 1
      continue
    }
    throw new Error(`unexpected character '${c}' at position ${i}`)
  }
  return tokens
}

class Parser {
  private pos = 0
  constructor(private tokens: Token[]) {}

  parseExpr(): IfExprAst {
    let left = this.parseTerm()
    while (this.peek('op', '&&') || this.peek('op', '||')) {
      const op = (this.tokens[this.pos] as { value: string }).value as '&&' | '||'
      this.pos++
      const right = this.parseTerm()
      left = op === '&&'
        ? { kind: 'and', left, right }
        : { kind: 'or', left, right }
    }
    return left
  }

  private parseTerm(): IfExprAst {
    const left = this.parseAtom()
    const op = this.peekOp(['==', '!=', '>', '<', '>=', '<='])
    if (op) {
      this.pos++
      const right = this.parseAtom()
      return { kind: 'compare', op, left, right }
    }
    return left
  }

  private parseAtom(): IfExprAst {
    const t = this.tokens[this.pos]
    if (!t) throw new Error('unexpected end of input')
    if (t.kind === 'num') { this.pos++; return { kind: 'literal', value: t.value } }
    if (t.kind === 'str') { this.pos++; return { kind: 'literal', value: t.value } }
    if (t.kind === 'kw') {
      this.pos++
      const v = t.value === 'true' ? true : t.value === 'false' ? false : null
      return { kind: 'literal', value: v }
    }
    if (t.kind === 'ident') { this.pos++; return { kind: 'var', name: t.value } }
    if (t.kind === 'punc' && t.value === '(') {
      this.pos++
      const inner = this.parseExpr()
      const close = this.tokens[this.pos]
      if (!close || close.kind !== 'punc' || close.value !== ')') {
        throw new Error('missing closing paren')
      }
      this.pos++
      return inner
    }
    throw new Error(`unexpected token ${JSON.stringify(t)}`)
  }

  private peek(kind: Token['kind'], value?: string): boolean {
    const t = this.tokens[this.pos]
    if (!t) return false
    if (t.kind !== kind) return false
    if (value !== undefined && (t as { value: string }).value !== value) return false
    return true
  }

  private peekOp(ops: string[]): '==' | '!=' | '>' | '<' | '>=' | '<=' | null {
    const t = this.tokens[this.pos]
    if (!t || t.kind !== 'op') return null
    if (!ops.includes(t.value)) return null
    return t.value as '==' | '!=' | '>' | '<' | '>=' | '<='
  }

  ensureFullyConsumed(): void {
    if (this.pos < this.tokens.length) {
      throw new Error(`extra tokens after parse: ${JSON.stringify(this.tokens[this.pos])}`)
    }
  }
}

export function parseIfExpr(src: string): IfExprAst {
  const tokens = tokenize(src)
  if (tokens.length === 0) throw new Error('empty expression')
  const parser = new Parser(tokens)
  const ast = parser.parseExpr()
  parser.ensureFullyConsumed()
  return ast
}
