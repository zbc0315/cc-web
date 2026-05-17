// frontend/src/components/tracks/graph/__tests__/codegen-v2.test.ts
import { describe, it, expect } from 'vitest'
import { codegen } from '../codegen-v2'
import type { GraphV2 } from '../graph-types-v2'

describe('codegen-v2 M1（顶层单链）', () => {
  it('空 graph 报错', () => {
    const g: GraphV2 = { version: 2, trackName: 't', nodes: [], edges: [] }
    const r = codegen(g)
    expect(r.ok).toBe(false)
    expect(r.errors?.[0]?.message).toMatch(/空 graph|无入口/)
  })

  it('单 Return 节点 → 含 marker + func main', () => {
    const g: GraphV2 = {
      version: 2,
      trackName: 't',
      nodes: [{ id: 'n_a', type: 'return', position: { x: 0, y: 0 }, valueExpr: '"hello"' }],
      edges: [],
    }
    const r = codegen(g)
    expect(r.ok).toBe(true)
    expect(r.source).toContain('// @@ccweb-track-mode: graph v2')
    expect(r.source).toContain('func main() -> any')
    expect(r.source).toContain('// @@nid: n_a')
    expect(r.source).toContain('return "hello"')
    expect(r.source).toContain('export main')
  })

  it('CodeNode → start/end marker 包裹', () => {
    const g: GraphV2 = {
      version: 2,
      trackName: 't',
      nodes: [
        { id: 'n_c', type: 'code', position: { x: 0, y: 0 }, code: 'let x = 1\nlet y = 2' },
        { id: 'n_r', type: 'return', position: { x: 0, y: 100 }, valueExpr: 'x + y' },
      ],
      edges: [{ id: 'e1', source: 'n_c', target: 'n_r' }],
    }
    const r = codegen(g)
    expect(r.ok).toBe(true)
    expect(r.source).toContain('// @@ccweb-node-start: n_c')
    expect(r.source).toContain('let x = 1')
    expect(r.source).toContain('let y = 2')
    expect(r.source).toContain('// @@ccweb-node-end: n_c')
    expect(r.source).toContain('// @@nid: n_r')
  })

  it('AskUserNode → __ccweb_ask_user 调用', () => {
    const g: GraphV2 = {
      version: 2,
      trackName: 't',
      nodes: [
        {
          id: 'n_a',
          type: 'ask_user',
          position: { x: 0, y: 0 },
          outputVar: 'input',
          fields: [
            { id: 'f1', key: 'name', label: '姓名', type: 'text' },
          ],
        },
        { id: 'n_r', type: 'return', position: { x: 0, y: 100 }, valueExpr: 'input' },
      ],
      edges: [{ id: 'e1', source: 'n_a', target: 'n_r' }],
    }
    const r = codegen(g)
    expect(r.ok).toBe(true)
    expect(r.source).toContain('let input = __ccweb_ask_user(')
    expect(r.source).toContain('key: "name"')
  })

  it('FaiNode → 声明聚集顶部 + 调用点 + prompt: prompt 形参', () => {
    const g: GraphV2 = {
      version: 2,
      trackName: 't',
      nodes: [
        {
          id: 'n_f',
          type: 'fai',
          position: { x: 0, y: 0 },
          faiName: 'analyze',
          outputVar: 'r',
          inputs: [{ id: 'i1', argName: 'text', argType: 'string', sourceExpr: '"hello"' }],
          outputs: [{ id: 'o1', name: 'rating', type: 'int', constraints: { min: 1, max: 10 } }],
          promptTemplate: '评分',
        },
        { id: 'n_r', type: 'return', position: { x: 0, y: 100 }, valueExpr: 'r' },
      ],
      edges: [{ id: 'e1', source: 'n_f', target: 'n_r' }],
    }
    const r = codegen(g)
    expect(r.ok).toBe(true)
    expect(r.source).toMatch(/fai analyze\([^)]*prompt: prompt[^)]*\) -> rating: int 1-10/)
    expect(r.source).toContain('let r = analyze("hello", "评分")')
  })

  it('同 shape 的 fai 节点 dedupe 为单声明', () => {
    const g: GraphV2 = {
      version: 2,
      trackName: 't',
      nodes: [
        {
          id: 'n_f1', type: 'fai', position: { x: 0, y: 0 },
          faiName: 'analyze', outputVar: 'r1',
          inputs: [{ id: 'i1', argName: 'x', argType: 'string', sourceExpr: '"a"' }],
          outputs: [{ id: 'o1', name: 'v', type: 'int' }],
          promptTemplate: 'p',
        },
        {
          id: 'n_f2', type: 'fai', position: { x: 0, y: 100 },
          faiName: 'analyze', outputVar: 'r2',
          inputs: [{ id: 'i1', argName: 'x', argType: 'string', sourceExpr: '"b"' }],
          outputs: [{ id: 'o1', name: 'v', type: 'int' }],
          promptTemplate: 'p',
        },
        { id: 'n_r', type: 'return', position: { x: 0, y: 200 }, valueExpr: 'r1' },
      ],
      edges: [
        { id: 'e1', source: 'n_f1', target: 'n_f2' },
        { id: 'e2', source: 'n_f2', target: 'n_r' },
      ],
    }
    const r = codegen(g)
    expect(r.ok).toBe(true)
    // 只出现一次 fai analyze 声明
    const declMatches = r.source!.match(/fai analyze\(/g) ?? []
    expect(declMatches.length).toBe(1)
    // 调用点两个
    expect(r.source).toContain('let r1 = analyze')
    expect(r.source).toContain('let r2 = analyze')
  })

  it('多顶层入口 → 报错', () => {
    const g: GraphV2 = {
      version: 2,
      trackName: 't',
      nodes: [
        { id: 'n_a', type: 'code', position: { x: 0, y: 0 }, code: 'let x = 1' },
        { id: 'n_b', type: 'code', position: { x: 200, y: 0 }, code: 'let y = 2' },
        { id: 'n_r', type: 'return', position: { x: 0, y: 100 }, valueExpr: 'x' },
      ],
      edges: [
        { id: 'e1', source: 'n_a', target: 'n_r' },
        { id: 'e2', source: 'n_b', target: 'n_r' },  // n_b 也是入口 + n_r 多 in
      ],
    }
    const r = codegen(g)
    expect(r.ok).toBe(false)
    expect(r.errors?.some(e => /多入口|出入度/.test(e.message))).toBe(true)
  })

  it('ask_user 字段含特殊字符 → JSON.stringify 转义', () => {
    const g: GraphV2 = {
      version: 2,
      trackName: 't',
      nodes: [
        {
          id: 'n_a',
          type: 'ask_user',
          position: { x: 0, y: 0 },
          outputVar: 'input',
          fields: [
            { id: 'f1', key: 'msg', label: '请输入"姓名"', type: 'text' },
          ],
        },
        { id: 'n_r', type: 'return', position: { x: 0, y: 100 }, valueExpr: 'input' },
      ],
      edges: [{ id: 'e1', source: 'n_a', target: 'n_r' }],
    }
    const r = codegen(g)
    expect(r.ok).toBe(true)
    // 双引号必须被转义成 \"
    expect(r.source).toContain('label: "请输入\\"姓名\\""')
  })

  it('孤立节点 → 报错', () => {
    const g: GraphV2 = {
      version: 2,
      trackName: 't',
      nodes: [
        { id: 'n_a', type: 'return', position: { x: 0, y: 0 }, valueExpr: '1' },
        { id: 'n_x', type: 'code', position: { x: 200, y: 0 }, code: 'let y = 2' },
      ],
      edges: [],
    }
    const r = codegen(g)
    expect(r.ok).toBe(false)
    expect(r.errors?.some(e => /孤立|未连接/.test(e.message))).toBe(true)
  })
})
