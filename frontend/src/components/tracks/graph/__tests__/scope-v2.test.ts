// frontend/src/components/tracks/graph/__tests__/scope-v2.test.ts
import { describe, it, expect } from 'vitest'
import { visibleVarsAt } from '../scope-v2'
import type { GraphV2 } from '../graph-types-v2'

describe('scope-v2 M1', () => {
  it('入口节点：无可见变量', () => {
    const g: GraphV2 = {
      version: 2,
      trackName: 't',
      nodes: [
        { id: 'n_a', type: 'ask_user', position: { x: 0, y: 0 }, outputVar: 'input', fields: [] },
      ],
      edges: [],
    }
    expect(visibleVarsAt(g, 'n_a')).toEqual([])
  })

  it('下游节点：上游 outputVar 可见', () => {
    const g: GraphV2 = {
      version: 2,
      trackName: 't',
      nodes: [
        { id: 'n_a', type: 'ask_user', position: { x: 0, y: 0 }, outputVar: 'input', fields: [] },
        { id: 'n_r', type: 'return', position: { x: 0, y: 100 }, valueExpr: 'input' },
      ],
      edges: [{ id: 'e1', source: 'n_a', target: 'n_r' }],
    }
    expect(visibleVarsAt(g, 'n_r')).toEqual(['input'])
  })

  it('多上游链接（CodeNode + Fai + Return）合并', () => {
    const g: GraphV2 = {
      version: 2,
      trackName: 't',
      nodes: [
        {
          id: 'n_a', type: 'ask_user', position: { x: 0, y: 0 },
          outputVar: 'input', fields: [],
        },
        {
          id: 'n_c', type: 'code', position: { x: 0, y: 100 },
          code: 'let x = 1',
        },
        {
          id: 'n_f', type: 'fai', position: { x: 0, y: 200 },
          faiName: 'analyze', outputVar: 'r',
          inputs: [], outputs: [], promptTemplate: '',
        },
        {
          id: 'n_r', type: 'return', position: { x: 0, y: 300 },
          valueExpr: 'r',
        },
      ],
      edges: [
        { id: 'e1', source: 'n_a', target: 'n_c' },
        { id: 'e2', source: 'n_c', target: 'n_f' },
        { id: 'e3', source: 'n_f', target: 'n_r' },
      ],
    }
    // CodeNode 的 `let x = 1` 在 M1 用启发式扫描第一行 `let X =`
    expect(visibleVarsAt(g, 'n_r')).toEqual(expect.arrayContaining(['input', 'x', 'r']))
  })
})
