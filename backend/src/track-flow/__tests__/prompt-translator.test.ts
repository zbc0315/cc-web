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

  it('替换 ${key} 为 update-variable 英文指令（v-19-b 起 prompt 英文化）', () => {
    const r = translatePrompt('修改 ${has_error}', vars, { has_error: null }, ['has_error'])
    expect(r).toContain('Update variable has_error(文献存在错误; stored at .ccweb-flow-train.json under key:has_error). Current value: null. Write the new value.')
  })

  it('outputs 非空时追加系统指令段', () => {
    const r = translatePrompt('do something ${has_error}', vars, { has_error: null }, ['has_error'])
    expect(r).toContain('[System Instructions]')
    expect(r).toContain('.ccweb-flow-train.json')
    expect(r).toContain('has_error')
  })

  it('outputs 为空时仍追加系统指令段（v-j：done flag 是完成信号源）', () => {
    const r = translatePrompt('just ask @{area}', vars, { area: '逆合成' }, [])
    expect(r).toContain('[System Instructions]')
    expect(r).toContain('run-state.json')
    expect(r).toContain('.done')
  })

  it('ctx 传入时系统指令含具体 basename + nodeId', () => {
    const r = translatePrompt('@{area}', vars, { area: 'x' }, [], { basename: 'flow1', nodeId: 'n_llm_a' })
    expect(r).toContain('.ccweb/tracks/flow1.run-state.json')
    expect(r).toContain('nodes.n_llm_a.done')
    expect(r).toContain('nodes.n_llm_a.failed')
  })

  it('done flag 指令对 LLM 多步操作友好（明确说"可多步后标"）', () => {
    const r = translatePrompt('@{area}', vars, { area: 'x' }, [], { basename: 'flow1', nodeId: 'n1' })
    expect(r).toContain('you may perform multiple steps before marking')
  })

  it('placeholder nodeId 不带空格（默认 <node-id>，与 <basename> 风格一致）', () => {
    const r = translatePrompt('@{area}', vars, { area: 'x' }, [])
    expect(r).toContain('<node-id>')
    expect(r).not.toContain('<node id>')
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
    expect(r).toContain('Update variable has_error(文献存在错误;')
    expect(r).toContain('[System Instructions]')
  })

  it('codex P1 顺修：所有提及 run-state.json 的句子都用完整路径插值（防 LLM 误改根目录）', () => {
    const r = translatePrompt('@{area}', vars, { area: 'x' }, [], { basename: 'flow1', nodeId: 'n1' })
    // 完整路径在多个句子中重复出现（path + done modify + failed modify + watch sentence）
    const matches = r.match(/\.ccweb\/tracks\/flow1\.run-state\.json/g) ?? []
    expect(matches.length).toBeGreaterThanOrEqual(4)
  })

  it('codex P2 顺修：done/failed 互斥 + 禁动其他字段', () => {
    const r = translatePrompt('@{area}', vars, { area: 'x' }, [], { basename: 'flow1', nodeId: 'n1' })
    expect(r).toContain('exactly one of `done` or `failed`')
    expect(r).toContain('Do not modify other fields')
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
