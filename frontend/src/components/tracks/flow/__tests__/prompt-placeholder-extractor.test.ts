import { describe, it, expect } from 'vitest'
import { extractInputs, extractOutputs } from '../prompt-placeholder-extractor'

describe('prompt-placeholder-extractor', () => {
  it('空字符串返空数组', () => {
    expect(extractInputs('')).toEqual([])
    expect(extractOutputs('')).toEqual([])
  })

  it('单个 @{var} → inputs', () => {
    expect(extractInputs('请调研@{area}的论文')).toEqual(['area'])
    expect(extractOutputs('请调研@{area}的论文')).toEqual([])
  })

  it('单个 ${var} → outputs', () => {
    expect(extractInputs('修改 ${has_error}')).toEqual([])
    expect(extractOutputs('修改 ${has_error}')).toEqual(['has_error'])
  })

  it('混合 + 多个引用 + 去重', () => {
    const tpl = '请检查@{ref_fp}中的论文，相关性 @{area}，结果写入 ${has_error}，再次检查@{area}'
    expect(extractInputs(tpl)).toEqual(['ref_fp', 'area'])  // 保序 + 去重
    expect(extractOutputs(tpl)).toEqual(['has_error'])
  })

  it('非法名字（数字开头 / 含连字符）→ 忽略', () => {
    expect(extractInputs('@{1abc} @{-foo} @{valid_name}')).toEqual(['valid_name'])
  })

  it('占位符内部不允许空格', () => {
    expect(extractInputs('@{ space }')).toEqual([])
    expect(extractInputs('@{has space}')).toEqual([])
  })

  it('转义字符不参与匹配（M1 不实现转义；测试当前行为：字面 @ 不触发）', () => {
    // 仅验证 @ 后不接 { 时不触发匹配
    expect(extractInputs('email @example.com')).toEqual([])
  })
})
