// frontend/src/components/tracks/flow/__tests__/flow-reducer.test.ts
import { describe, it, expect } from 'vitest'
import { reducer, initialFlow } from '../flow-reducer'
import type { UserInputNode, LLMNode, IfNode, VarDecl } from '../flow-types-v3'

describe('flow-reducer', () => {
  it('initialFlow 空', () => {
    const f = initialFlow('test')
    expect(f.version).toBe(3)
    expect(f.trackName).toBe('test')
    expect(f.adapter).toBe('claude-code')
    expect(f.variables).toEqual([])
    expect(f.nodes).toEqual([])
    expect(f.edges).toEqual([])
  })

  it('add_variable + remove_variable', () => {
    const f0 = initialFlow('t')
    const v: VarDecl = { key: 'area', description: '研究领域', initialValue: null }
    let f = reducer(f0, { type: 'add_variable', variable: v })
    expect(f.variables).toHaveLength(1)
    expect(f.variables[0]!.key).toBe('area')
    f = reducer(f, { type: 'remove_variable', key: 'area' })
    expect(f.variables).toEqual([])
  })

  it('update_variable 改 description / initialValue', () => {
    const f0 = initialFlow('t')
    const v: VarDecl = { key: 'a', description: 'd1', initialValue: null }
    let f = reducer(f0, { type: 'add_variable', variable: v })
    f = reducer(f, { type: 'update_variable', key: 'a', patch: { description: 'd2', initialValue: 42 } })
    expect(f.variables[0]!.description).toBe('d2')
    expect(f.variables[0]!.initialValue).toBe(42)
  })

  it('update_variable 改 key（重命名）— 保位置，不与现有 key 冲突', () => {
    const f0 = initialFlow('t')
    let f = reducer(f0, { type: 'add_variable', variable: { key: 'a', description: 'd', initialValue: 1 } })
    f = reducer(f, { type: 'add_variable', variable: { key: 'b', description: '', initialValue: null } })
    f = reducer(f, { type: 'update_variable', key: 'a', patch: { key: 'renamed' } })
    expect(f.variables).toHaveLength(2)
    expect(f.variables[0]!.key).toBe('renamed')         // 保位置
    expect(f.variables[0]!.description).toBe('d')        // 其它字段保留
    expect(f.variables[0]!.initialValue).toBe(1)
    expect(f.variables[1]!.key).toBe('b')
  })

  it('update_variable 改 key 与已有变量重名 → 拒绝（return state）', () => {
    const f0 = initialFlow('t')
    let f = reducer(f0, { type: 'add_variable', variable: { key: 'a', description: '', initialValue: null } })
    f = reducer(f, { type: 'add_variable', variable: { key: 'b', description: '', initialValue: null } })
    const before = f
    f = reducer(f, { type: 'update_variable', key: 'a', patch: { key: 'b' } })
    expect(f).toBe(before)  // 同一引用（reducer return state 未变）
  })

  it('add_node 追加', () => {
    const f0 = initialFlow('t')
    const n: UserInputNode = { id: 'n_a', type: 'user_input', position: { x: 0, y: 0 }, fields: [] }
    const f = reducer(f0, { type: 'add_node', node: n })
    expect(f.nodes).toHaveLength(1)
    expect(f.nodes[0]!.id).toBe('n_a')
  })

  it('remove_node 同时删相关 edges', () => {
    const f0 = initialFlow('t')
    const a: UserInputNode = { id: 'n_a', type: 'user_input', position: { x: 0, y: 0 }, fields: [] }
    const b: IfNode = { id: 'n_b', type: 'if', position: { x: 0, y: 100 }, conditionExpr: 'x == 1' }
    let f = reducer(f0, { type: 'add_node', node: a })
    f = reducer(f, { type: 'add_node', node: b })
    f = reducer(f, { type: 'add_edge', source: 'n_a', target: 'n_b' })
    expect(f.edges).toHaveLength(1)
    f = reducer(f, { type: 'remove_node', nodeId: 'n_a' })
    expect(f.nodes).toHaveLength(1)
    expect(f.edges).toEqual([])
  })

  it('add_edge 同 source+sourceHandle+target 去重', () => {
    const f0 = initialFlow('t')
    const a: UserInputNode = { id: 'n_a', type: 'user_input', position: { x: 0, y: 0 }, fields: [] }
    const b: IfNode = { id: 'n_b', type: 'if', position: { x: 0, y: 100 }, conditionExpr: 'x' }
    let f = reducer(f0, { type: 'add_node', node: a })
    f = reducer(f, { type: 'add_node', node: b })
    f = reducer(f, { type: 'add_edge', source: 'n_a', target: 'n_b' })
    f = reducer(f, { type: 'add_edge', source: 'n_a', target: 'n_b' })
    expect(f.edges).toHaveLength(1)
  })

  it('if 节点 true / false 双出口共存', () => {
    const f0 = initialFlow('t')
    const if_: IfNode = { id: 'n_if', type: 'if', position: { x: 0, y: 0 }, conditionExpr: 'x' }
    const t: LLMNode = { id: 'n_t', type: 'llm', position: { x: 0, y: 100 }, promptTemplate: '', inputs: [], outputs: [] }
    const fn: LLMNode = { id: 'n_f', type: 'llm', position: { x: 0, y: 200 }, promptTemplate: '', inputs: [], outputs: [] }
    let f = reducer(f0, { type: 'add_node', node: if_ })
    f = reducer(f, { type: 'add_node', node: t })
    f = reducer(f, { type: 'add_node', node: fn })
    f = reducer(f, { type: 'add_edge', source: 'n_if', sourceHandle: 'true', target: 'n_t' })
    f = reducer(f, { type: 'add_edge', source: 'n_if', sourceHandle: 'false', target: 'n_f' })
    expect(f.edges).toHaveLength(2)
  })

  it('update_node patch', () => {
    const f0 = initialFlow('t')
    const n: LLMNode = {
      id: 'n_l', type: 'llm', position: { x: 0, y: 0 },
      promptTemplate: '', inputs: [], outputs: [],
    }
    let f = reducer(f0, { type: 'add_node', node: n })
    f = reducer(f, { type: 'update_node', nodeId: 'n_l', patch: { promptTemplate: 'hello @{x}' } })
    expect((f.nodes[0] as LLMNode).promptTemplate).toBe('hello @{x}')
  })

  it('move_node', () => {
    const f0 = initialFlow('t')
    const n: UserInputNode = { id: 'n_a', type: 'user_input', position: { x: 0, y: 0 }, fields: [] }
    let f = reducer(f0, { type: 'add_node', node: n })
    f = reducer(f, { type: 'move_node', nodeId: 'n_a', position: { x: 100, y: 50 } })
    expect(f.nodes[0]!.position).toEqual({ x: 100, y: 50 })
  })

  it('set_track_name + set_adapter', () => {
    const f0 = initialFlow('t')
    let f = reducer(f0, { type: 'set_track_name', name: 'renamed' })
    expect(f.trackName).toBe('renamed')
    f = reducer(f, { type: 'set_adapter', adapter: 'codex' })
    expect(f.adapter).toBe('codex')
  })

  it('replace 全量替换', () => {
    const f0 = initialFlow('t')
    const fNew = initialFlow('other')
    const f = reducer(f0, { type: 'replace', flow: fNew })
    expect(f.trackName).toBe('other')
  })
})
