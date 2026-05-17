import { describe, it, expect } from 'vitest'
import { encodeSidecar, decodeSidecar, crossCheck } from '../sidecar-io'
import type { GraphV2 } from '../graph-types-v2'

const sampleGraph: GraphV2 = {
  version: 2,
  trackName: 't',
  nodes: [
    { id: 'n_a', type: 'return', position: { x: 0, y: 0 }, valueExpr: '1' },
  ],
  edges: [],
}

describe('sidecar-io', () => {
  it('encodeSidecar 输出 GraphV2 + 元字段', () => {
    const s = encodeSidecar(sampleGraph)
    expect(s.version).toBe(2)
    expect(s.nodes).toHaveLength(1)
    expect(s.savedAt).toBeTypeOf('string')
  })

  it('decodeSidecar 接受 valid sidecar', () => {
    const s = encodeSidecar(sampleGraph)
    const r = decodeSidecar(s)
    expect(r.ok).toBe(true)
    expect(r.graph?.nodes).toHaveLength(1)
  })

  it('decodeSidecar 拒绝 version !== 2', () => {
    const r = decodeSidecar({ version: 1, nodes: [], edges: [] })
    expect(r.ok).toBe(false)
  })

  it('crossCheck 通过：sidecar nid 全在 .tr 中', () => {
    const source = '// @@nid: n_a\nreturn 1'
    const r = crossCheck(sampleGraph, source)
    expect(r.ok).toBe(true)
  })

  it('crossCheck 失败：sidecar nid 找不到', () => {
    const source = '// @@nid: n_xxx_other\nreturn 1'
    const r = crossCheck(sampleGraph, source)
    expect(r.ok).toBe(false)
    expect(r.missingNids).toContain('n_a')
  })
})
