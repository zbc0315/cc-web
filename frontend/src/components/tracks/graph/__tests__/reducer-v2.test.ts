// frontend/src/components/tracks/graph/__tests__/reducer-v2.test.ts
import { describe, it, expect } from 'vitest'
import { reducer, initialGraph } from '../reducer-v2'
import type { CodeNode, ReturnNode } from '../graph-types-v2'

describe('reducer-v2', () => {
  it('initialGraph 空', () => {
    const g = initialGraph('test')
    expect(g.version).toBe(2)
    expect(g.trackName).toBe('test')
    expect(g.nodes).toEqual([])
    expect(g.edges).toEqual([])
  })

  it('add_node 追加节点', () => {
    const g0 = initialGraph('t')
    const code: CodeNode = {
      id: 'n_x', type: 'code', position: { x: 0, y: 0 }, code: 'let a = 1',
    }
    const g1 = reducer(g0, { type: 'add_node', node: code })
    expect(g1.nodes).toHaveLength(1)
    expect(g1.nodes[0]!.id).toBe('n_x')
  })

  it('remove_node 同时移除相关 edges', () => {
    const g0 = initialGraph('t')
    const a: CodeNode = { id: 'n_a', type: 'code', position: { x: 0, y: 0 }, code: '' }
    const b: ReturnNode = { id: 'n_b', type: 'return', position: { x: 0, y: 100 }, valueExpr: '' }
    let g = reducer(g0, { type: 'add_node', node: a })
    g = reducer(g, { type: 'add_node', node: b })
    g = reducer(g, { type: 'add_edge', source: 'n_a', target: 'n_b' })
    expect(g.edges).toHaveLength(1)
    g = reducer(g, { type: 'remove_node', nodeId: 'n_a' })
    expect(g.nodes).toHaveLength(1)
    expect(g.edges).toHaveLength(0)
  })

  it('add_edge 不允许重复（同 source+target）', () => {
    const g0 = initialGraph('t')
    const a: CodeNode = { id: 'n_a', type: 'code', position: { x: 0, y: 0 }, code: '' }
    const b: ReturnNode = { id: 'n_b', type: 'return', position: { x: 0, y: 100 }, valueExpr: '' }
    let g = reducer(g0, { type: 'add_node', node: a })
    g = reducer(g, { type: 'add_node', node: b })
    g = reducer(g, { type: 'add_edge', source: 'n_a', target: 'n_b' })
    g = reducer(g, { type: 'add_edge', source: 'n_a', target: 'n_b' })
    expect(g.edges).toHaveLength(1)
  })

  it('update_node 改字段', () => {
    const g0 = initialGraph('t')
    const a: CodeNode = { id: 'n_a', type: 'code', position: { x: 0, y: 0 }, code: 'a' }
    let g = reducer(g0, { type: 'add_node', node: a })
    g = reducer(g, { type: 'update_node', nodeId: 'n_a', patch: { code: 'b' } })
    expect((g.nodes[0] as CodeNode).code).toBe('b')
  })

  it('move_node 更新 position', () => {
    const g0 = initialGraph('t')
    const a: CodeNode = { id: 'n_a', type: 'code', position: { x: 0, y: 0 }, code: '' }
    let g = reducer(g0, { type: 'add_node', node: a })
    g = reducer(g, { type: 'move_node', nodeId: 'n_a', position: { x: 100, y: 50 } })
    expect(g.nodes[0]!.position).toEqual({ x: 100, y: 50 })
  })
})
