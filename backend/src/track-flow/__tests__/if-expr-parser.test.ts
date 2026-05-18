import { describe, it, expect } from 'vitest'
import { parseIfExpr } from '../if-expr-parser'

describe('parseIfExpr', () => {
  it('字面量 true', () => {
    const ast = parseIfExpr('true')
    expect(ast).toEqual({ kind: 'literal', value: true })
  })

  it('字面量 false / null', () => {
    expect(parseIfExpr('false')).toEqual({ kind: 'literal', value: false })
    expect(parseIfExpr('null')).toEqual({ kind: 'literal', value: null })
  })

  it('字面量整数', () => {
    expect(parseIfExpr('42')).toEqual({ kind: 'literal', value: 42 })
  })

  it('字面量负数', () => {
    expect(parseIfExpr('-3')).toEqual({ kind: 'literal', value: -3 })
  })

  it('字面量字符串', () => {
    expect(parseIfExpr('"hello"')).toEqual({ kind: 'literal', value: 'hello' })
  })

  it('变量引用', () => {
    expect(parseIfExpr('has_error')).toEqual({ kind: 'var', name: 'has_error' })
  })

  it('等号比较', () => {
    const ast = parseIfExpr('has_error == true')
    expect(ast).toEqual({
      kind: 'compare', op: '==',
      left: { kind: 'var', name: 'has_error' },
      right: { kind: 'literal', value: true },
    })
  })

  it('大于', () => {
    const ast = parseIfExpr('count > 5')
    expect(ast).toEqual({
      kind: 'compare', op: '>',
      left: { kind: 'var', name: 'count' },
      right: { kind: 'literal', value: 5 },
    })
  })

  it('AND 短路', () => {
    const ast = parseIfExpr('a && b')
    expect(ast).toEqual({
      kind: 'and',
      left: { kind: 'var', name: 'a' },
      right: { kind: 'var', name: 'b' },
    })
  })

  it('OR 短路', () => {
    const ast = parseIfExpr('a || b')
    expect(ast).toEqual({
      kind: 'or',
      left: { kind: 'var', name: 'a' },
      right: { kind: 'var', name: 'b' },
    })
  })

  it('括号优先级', () => {
    const ast = parseIfExpr('(a == 1) && (b > 2)')
    expect(ast.kind).toBe('and')
  })

  it('AND 优先级高于 OR（左结合）', () => {
    // spec §5.4 简化为左结合从左到右，&& 和 || 同优先级
    // a && b || c = ((a && b) || c)
    const ast = parseIfExpr('a && b || c')
    expect(ast.kind).toBe('or')
  })

  it('非法 token 抛错', () => {
    expect(() => parseIfExpr('a + b')).toThrow()  // 不支持算术
    expect(() => parseIfExpr('foo(1)')).toThrow() // 不支持函数调用
    expect(() => parseIfExpr('a.b')).toThrow()    // 不支持字段访问
    expect(() => parseIfExpr('')).toThrow()
    expect(() => parseIfExpr('==')).toThrow()
  })
})
