import { describe, it, expect } from 'vitest'
import { translatePrompt } from '../prompt-translator'

interface VarDecl {
  key: string
  description: string
  initialValue: unknown
}

describe('translatePrompt', () => {
  const vars: VarDecl[] = [
    { key: 'area', description: '研究领域', initialValue: null },
    { key: 'ref_fp', description: '文献存储 bibtex 格式文件的路径', initialValue: null },
    { key: 'has_error', description: '文献存在错误', initialValue: null },
  ]

  it('替换 @{key} 为 key(description)=\'value\'', () => {
    const r = translatePrompt('请调研@{area}', vars, { area: '逆合成' }, [])
    expect(r).toContain("area(研究领域)='逆合成'")
  })

  it('null 值显示为 null（不带引号）', () => {
    const r = translatePrompt('@{area}', vars, { area: null }, [])
    expect(r).toContain('area(研究领域)=null')
  })

  it('替换 ${key} 为修改变量指令', () => {
    const r = translatePrompt('修改 ${has_error}', vars, { has_error: null }, ['has_error'])
    expect(r).toContain('修改变量 has_error(文献存在错误;记录路径为 .ccweb-flow-train.json 中的 key:has_error)=null 为...')
  })

  it('outputs 非空时追加系统指令段', () => {
    const r = translatePrompt('做点啥 ${has_error}', vars, { has_error: null }, ['has_error'])
    expect(r).toContain('【系统指令】')
    expect(r).toContain('.ccweb-flow-train.json')
    expect(r).toContain('has_error')
  })

  it('outputs 为空时不追加系统指令段', () => {
    const r = translatePrompt('单纯咨询 @{area}', vars, { area: '逆合成' }, [])
    expect(r).not.toContain('【系统指令】')
  })

  it('未声明的 key 保留字面（不替换）', () => {
    const r = translatePrompt('@{未知}', vars, {}, [])
    expect(r).toContain('@{未知}')
  })

  it('完整研究循环 prompt（spec 例子）', () => {
    const tpl = '请检查@{ref_fp}中的论文，相关性 @{area}，结果 ${has_error}'
    const r = translatePrompt(tpl, vars, { area: '逆合成', ref_fp: './test.bibtex', has_error: null }, ['has_error'])
    expect(r).toContain("ref_fp(文献存储 bibtex 格式文件的路径)='./test.bibtex'")
    expect(r).toContain("area(研究领域)='逆合成'")
    expect(r).toContain('修改变量 has_error(文献存在错误;')
    expect(r).toContain('【系统指令】')
  })

  it('数字值不加引号', () => {
    const r = translatePrompt('@{n}', [{ key: 'n', description: '次数', initialValue: 0 }], { n: 42 }, [])
    expect(r).toContain('n(次数)=42')
    expect(r).not.toContain("n(次数)='42'")
  })

  it('boolean 值', () => {
    const r = translatePrompt('@{f}', [{ key: 'f', description: '标志', initialValue: false }], { f: true }, [])
    expect(r).toContain('f(标志)=true')
  })

  it('object/array 值用 JSON.stringify', () => {
    const r = translatePrompt('@{x}', [{ key: 'x', description: '数据', initialValue: null }], { x: { a: 1 } }, [])
    expect(r).toContain('x(数据)=\'{"a":1}\'')
  })
})
