import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import {
  writeRunState, readRunState, patchRunState,
  getRunStateMtime, runStateRelativePath, initialRunState,
} from '../run-state-file'

let folder: string
beforeEach(() => {
  folder = fs.mkdtempSync(path.join(os.tmpdir(), 'run-state-'))
})
afterEach(() => {
  fs.rmSync(folder, { recursive: true, force: true })
})

describe('run-state-file', () => {
  it('initialRunState 含所有节点 idle + iter=0', () => {
    const s = initialRunState('r1', 'flow1', [
      { id: 'n_a', type: 'user_input', label: '入口' },
      { id: 'n_b', type: 'llm' },
    ])
    expect(s.runId).toBe('r1')
    expect(s.status).toBe('pending')
    expect(s.nodes.n_a!.status).toBe('idle')
    expect(s.nodes.n_a!.iter).toBe(0)
    expect(s.nodes.n_a!.label).toBe('入口')
    expect(s.nodes.n_b!.label).toBeUndefined()
  })

  it('writeRunState + readRunState 往返', () => {
    const init = initialRunState('r1', 'flow1', [{ id: 'n_a', type: 'llm' }])
    writeRunState(folder, 'flow1', init)
    const read = readRunState(folder, 'flow1')
    expect(read?.runId).toBe('r1')
    expect(read?.nodes.n_a!.type).toBe('llm')
  })

  it('文件不存在时 readRunState 返 null', () => {
    expect(readRunState(folder, 'nope')).toBeNull()
  })

  it('版本号不为 1 时 readRunState 拒绝', () => {
    const target = path.join(folder, '.ccweb', 'tracks', 'flow1.run-state.json')
    fs.mkdirSync(path.dirname(target), { recursive: true })
    fs.writeFileSync(target, JSON.stringify({ version: 99, runId: 'x' }))
    expect(readRunState(folder, 'flow1')).toBeNull()
  })

  it('patchRunState read-modify-write', () => {
    writeRunState(folder, 'flow1', initialRunState('r1', 'flow1', [{ id: 'n_a', type: 'llm' }]))
    patchRunState(folder, 'flow1', (cur) => ({
      ...cur,
      status: 'running',
      nodes: { ...cur.nodes, n_a: { ...cur.nodes.n_a!, status: 'active', iter: 1 } },
    }))
    const read = readRunState(folder, 'flow1')
    expect(read?.status).toBe('running')
    expect(read?.nodes.n_a!.status).toBe('active')
    expect(read?.nodes.n_a!.iter).toBe(1)
  })

  it('patchRunState 在文件不存在时返 null（不创建）', () => {
    const r = patchRunState(folder, 'absent', (cur) => cur)
    expect(r).toBeNull()
  })

  it('getRunStateMtime 文件不存在返 0', () => {
    expect(getRunStateMtime(folder, 'nope')).toBe(0)
  })

  it('getRunStateMtime 在 write 后递增', () => {
    writeRunState(folder, 'f', initialRunState('r', 'f', []))
    expect(getRunStateMtime(folder, 'f')).toBeGreaterThan(0)
  })

  it('runStateRelativePath 返相对路径（给 LLM prompt 用）', () => {
    expect(runStateRelativePath('research-loop')).toBe('.ccweb/tracks/research-loop.run-state.json')
  })

  it('LLM 模拟修改 done flag → readRunState 能读出', () => {
    writeRunState(folder, 'f', initialRunState('r', 'f', [{ id: 'n_a', type: 'llm' }]))
    // 模拟 LLM Edit 文件加 done=true
    patchRunState(folder, 'f', (cur) => ({
      ...cur,
      nodes: { ...cur.nodes, n_a: { ...cur.nodes.n_a!, done: true } },
    }))
    const s = readRunState(folder, 'f')
    expect(s?.nodes.n_a!.done).toBe(true)
    expect(s?.nodes.n_a!.failed).toBeUndefined()
  })

  it('LLM 自报 failed=true + reason → readRunState 能读出', () => {
    writeRunState(folder, 'f', initialRunState('r', 'f', [{ id: 'n_a', type: 'llm' }]))
    patchRunState(folder, 'f', (cur) => ({
      ...cur,
      nodes: { ...cur.nodes, n_a: { ...cur.nodes.n_a!, failed: true, reason: '用户输入不合理' } },
    }))
    const s = readRunState(folder, 'f')
    expect(s?.nodes.n_a!.failed).toBe(true)
    expect(s?.nodes.n_a!.reason).toBe('用户输入不合理')
  })
})
