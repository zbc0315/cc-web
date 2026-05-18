import { describe, it, expect } from 'vitest'
import { evaluateIfExpr } from '../if-expr-evaluator'
import { parseIfExpr } from '../if-expr-parser'

function evalStr(src: string, scope: Record<string, unknown>): boolean {
  return evaluateIfExpr(parseIfExpr(src), scope)
}

describe('evaluateIfExpr', () => {
  it('字面量 true / false', () => {
    expect(evalStr('true', {})).toBe(true)
    expect(evalStr('false', {})).toBe(false)
  })

  it('变量为 true', () => {
    expect(evalStr('x', { x: true })).toBe(true)
    expect(evalStr('x', { x: false })).toBe(false)
  })

  it('未定义变量当 null 处理', () => {
    expect(evalStr('x == null', {})).toBe(true)
    expect(evalStr('x == true', {})).toBe(false)
  })

  it('null 安全比较：x == null / null == null', () => {
    expect(evalStr('x == null', { x: null })).toBe(true)
    expect(evalStr('x != null', { x: 5 })).toBe(true)
  })

  it('null 与非 null 比较返 false（不抛错）', () => {
    expect(evalStr('x == true', { x: null })).toBe(false)
    expect(evalStr('x > 5', { x: null })).toBe(false)
    expect(evalStr('x < 5', { x: null })).toBe(false)
  })

  it('类型不匹配返 false（不抛错）', () => {
    expect(evalStr('"abc" > 5', {})).toBe(false)
    expect(evalStr('true == 1', {})).toBe(false)
  })

  it('数字比较', () => {
    expect(evalStr('x > 5', { x: 10 })).toBe(true)
    expect(evalStr('x > 5', { x: 3 })).toBe(false)
    expect(evalStr('x >= 5', { x: 5 })).toBe(true)
    expect(evalStr('x <= 5', { x: 5 })).toBe(true)
  })

  it('字符串相等', () => {
    expect(evalStr('s == "hello"', { s: 'hello' })).toBe(true)
    expect(evalStr('s == "world"', { s: 'hello' })).toBe(false)
  })

  it('AND 短路', () => {
    expect(evalStr('true && true', {})).toBe(true)
    expect(evalStr('true && false', {})).toBe(false)
    expect(evalStr('false && true', {})).toBe(false)
  })

  it('null && x → false（null 视为 falsy）', () => {
    expect(evalStr('x && true', { x: null })).toBe(false)
  })

  it('OR 短路 + null || x', () => {
    expect(evalStr('false || true', {})).toBe(true)
    // spec §5.4: null || x → 视 null 为 falsy，返 x（如果 x truthy 才返 true）
    expect(evalStr('x || true', { x: null })).toBe(true)
    expect(evalStr('x || false', { x: null })).toBe(false)
  })

  it('用户例子：has_error == true（null 时返 false 走 else 分支）', () => {
    expect(evalStr('has_error == true', { has_error: null })).toBe(false)
    expect(evalStr('has_error == true', { has_error: true })).toBe(true)
    expect(evalStr('has_error == true', { has_error: false })).toBe(false)
  })
})
