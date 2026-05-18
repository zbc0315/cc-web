import { describe, it, expect } from 'vitest'
import { validateFlow } from '../flow-validator'
import { initialFlow } from '../flow-reducer'
import type { FlowV3, UserInputNode, LLMNode, IfNode } from '../flow-types-v3'

describe('flow-validator', () => {
  it('空 flow → 错误：缺入口', () => {
    const r = validateFlow(initialFlow('t'))
    expect(r.ok).toBe(false)
    expect(r.errors.some((e) => /入口|空/.test(e.message))).toBe(true)
  })

  it('唯一入口 + 一个节点 → ok', () => {
    const f = initialFlow('t')
    const n: UserInputNode = { id: 'n_a', type: 'user_input', position: { x: 0, y: 0 }, fields: [] }
    f.nodes.push(n)
    const r = validateFlow(f)
    expect(r.ok).toBe(true)
  })

  it('多入口 → 错误', () => {
    const f = initialFlow('t')
    const a: UserInputNode = { id: 'n_a', type: 'user_input', position: { x: 0, y: 0 }, fields: [] }
    const b: UserInputNode = { id: 'n_b', type: 'user_input', position: { x: 0, y: 100 }, fields: [] }
    f.nodes.push(a, b)
    const r = validateFlow(f)
    expect(r.ok).toBe(false)
    expect(r.errors.some((e) => /多入口/.test(e.message))).toBe(true)
  })

  it('孤立节点（不可达入口）→ 错误', () => {
    const f = initialFlow('t')
    const entry: UserInputNode = { id: 'n_e', type: 'user_input', position: { x: 0, y: 0 }, fields: [] }
    const orphan: LLMNode = {
      id: 'n_o', type: 'llm', position: { x: 100, y: 0 },
      promptTemplate: '', inputs: [], outputs: [],
    }
    const next: LLMNode = {
      id: 'n_n', type: 'llm', position: { x: 0, y: 100 },
      promptTemplate: '', inputs: [], outputs: [],
    }
    f.nodes.push(entry, next, orphan)
    f.edges.push({ id: 'e1', source: 'n_e', target: 'n_n', sourceHandle: 'default' })
    const r = validateFlow(f)
    expect(r.ok).toBe(false)
    // orphan 无 incoming，与 entry 一样 → 报"多入口"
    expect(r.errors.some((e) => /多入口|孤立/.test(e.message))).toBe(true)
  })

  it('变量声明重名 → 错误', () => {
    const f = initialFlow('t')
    f.variables.push({ key: 'x', description: 'a', initialValue: null })
    f.variables.push({ key: 'x', description: 'b', initialValue: null })
    const n: UserInputNode = { id: 'n_a', type: 'user_input', position: { x: 0, y: 0 }, fields: [] }
    f.nodes.push(n)
    const r = validateFlow(f)
    expect(r.ok).toBe(false)
    expect(r.errors.some((e) => /重名|duplicate/i.test(e.message))).toBe(true)
  })

  it('变量 key 非法 identifier → 错误', () => {
    const f = initialFlow('t')
    f.variables.push({ key: '1abc', description: 'bad', initialValue: null })
    const n: UserInputNode = { id: 'n_a', type: 'user_input', position: { x: 0, y: 0 }, fields: [] }
    f.nodes.push(n)
    const r = validateFlow(f)
    expect(r.ok).toBe(false)
    expect(r.errors.some((e) => /1abc|identifier|invalid/i.test(e.message))).toBe(true)
  })

  it('LLM 节点 promptTemplate 引用未声明 var → 错误', () => {
    const f = initialFlow('t')
    const n: LLMNode = {
      id: 'n_l', type: 'llm', position: { x: 0, y: 0 },
      promptTemplate: '请处理 @{area}', inputs: ['area'], outputs: [],
    }
    f.nodes.push(n)
    // area 没在 variables 表声明
    const r = validateFlow(f)
    expect(r.ok).toBe(false)
    expect(r.errors.some((e) => /area|未声明|未定义/.test(e.message))).toBe(true)
  })

  it('if 节点 conditionExpr 引用未声明 var → 错误（rename 安全闸门）', () => {
    const f: FlowV3 = {
      version: 3, trackName: 't', adapter: 'claude-code',
      variables: [{ key: 'renamed', description: '', initialValue: null }],
      nodes: [{
        id: 'n_if', type: 'if', position: { x: 0, y: 0 },
        conditionExpr: 'old_key == "done"',  // 引用 rename 前的旧 key
      } as IfNode],
      edges: [],
    }
    const r = validateFlow(f)
    expect(r.ok).toBe(false)
    expect(r.errors.some((e) => /old_key|未声明/.test(e.message))).toBe(true)
  })

  it('if 节点 conditionExpr 关键字 + 字面量不被误判为变量', () => {
    const f: FlowV3 = {
      version: 3, trackName: 't', adapter: 'claude-code',
      variables: [{ key: 'status', description: '', initialValue: null }],
      nodes: [{
        id: 'n_if', type: 'if', position: { x: 0, y: 0 },
        // status 已声明；true / false / null 关键字 + "literal" 字符串都不应触发未声明错误
        conditionExpr: 'status == "done" && true != false || status != null',
      } as IfNode],
      edges: [],
    }
    const r = validateFlow(f)
    expect(r.ok).toBe(true)
  })

  it('if 节点 conditionExpr 字符串字面量内部内容不被当变量', () => {
    const f: FlowV3 = {
      version: 3, trackName: 't', adapter: 'claude-code',
      variables: [{ key: 'area', description: '', initialValue: null }],
      nodes: [{
        id: 'n_if', type: 'if', position: { x: 0, y: 0 },
        // "ghost" 字符串内的 ghost 不应触发未声明（剥字符串字面量后再抓 ident）
        conditionExpr: 'area == "ghost"',
      } as IfNode],
      edges: [],
    }
    const r = validateFlow(f)
    expect(r.ok).toBe(true)
  })

  it('adapter 合法 + 引用 var 都声明 → ok', () => {
    const f: FlowV3 = {
      version: 3, trackName: 't', adapter: 'claude-code',
      variables: [{ key: 'area', description: '', initialValue: null }],
      nodes: [{
        id: 'n_l', type: 'llm', position: { x: 0, y: 0 },
        promptTemplate: '@{area}', inputs: ['area'], outputs: [],
      }],
      edges: [],
    }
    const r = validateFlow(f)
    expect(r.ok).toBe(true)
  })
})
