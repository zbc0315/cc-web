// frontend/src/components/tracks/flow/__tests__/flow-sidecar-io.test.ts
import { describe, it, expect } from 'vitest'
import { decodeFlow, deriveTrainJsonFromVariables, crossCheckTrainJson } from '../flow-sidecar-io'
import { initialFlow } from '../flow-reducer'

describe('flow-sidecar-io', () => {
  it('decodeFlow 接受 valid v3 object', () => {
    const f = initialFlow('t')
    const r = decodeFlow(f)
    expect(r.ok).toBe(true)
    expect(r.flow?.trackName).toBe('t')
  })

  it('decodeFlow 拒绝 version !== 3', () => {
    const r = decodeFlow({ version: 2, trackName: 't', adapter: 'claude-code', variables: [], nodes: [], edges: [] })
    expect(r.ok).toBe(false)
  })

  it('decodeFlow 拒绝缺字段', () => {
    expect(decodeFlow({}).ok).toBe(false)
    expect(decodeFlow({ version: 3 }).ok).toBe(false)
    expect(decodeFlow(null).ok).toBe(false)
    expect(decodeFlow('not an object').ok).toBe(false)
  })

  it('deriveTrainJsonFromVariables 用 initialValue 初始化', () => {
    const f = initialFlow('t')
    f.variables.push({ key: 'a', description: '', initialValue: 42 })
    f.variables.push({ key: 'b', description: '', initialValue: null })
    f.variables.push({ key: 'c', description: '', initialValue: 'hello' })
    const j = deriveTrainJsonFromVariables(f.variables)
    expect(j).toEqual({ a: 42, b: null, c: 'hello' })
  })

  it('crossCheckTrainJson 全匹配 → ok', () => {
    const f = initialFlow('t')
    f.variables.push({ key: 'a', description: '', initialValue: null })
    f.variables.push({ key: 'b', description: '', initialValue: null })
    const r = crossCheckTrainJson(f, { a: 1, b: 2 })
    expect(r.ok).toBe(true)
  })

  it('crossCheckTrainJson 缺字段 → desync', () => {
    const f = initialFlow('t')
    f.variables.push({ key: 'a', description: '', initialValue: null })
    f.variables.push({ key: 'b', description: '', initialValue: null })
    const r = crossCheckTrainJson(f, { a: 1 })
    expect(r.ok).toBe(false)
    expect(r.missingKeys).toContain('b')
  })

  it('crossCheckTrainJson 多字段 → desync', () => {
    const f = initialFlow('t')
    f.variables.push({ key: 'a', description: '', initialValue: null })
    const r = crossCheckTrainJson(f, { a: 1, ghost: 'x' })
    expect(r.ok).toBe(false)
    expect(r.extraKeys).toContain('ghost')
  })
})
