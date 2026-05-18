import { describe, it, expect, beforeEach } from 'vitest'
import { FlowRunRegistry } from '../run-registry'

let r: FlowRunRegistry
beforeEach(() => { r = new FlowRunRegistry() })

describe('FlowRunRegistry', () => {
  it('start + get', () => {
    const info = r.start({ runId: 'run1', projectId: 'p1', basename: 'flow1' })
    expect(info.runId).toBe('run1')
    expect(r.get('run1')).toBe(info)
  })

  it('同 (project, basename) 重复 start → 抛 FLOW_ALREADY_RUNNING', () => {
    r.start({ runId: 'run1', projectId: 'p1', basename: 'flow1' })
    expect(() => r.start({ runId: 'run2', projectId: 'p1', basename: 'flow1' })).toThrow(/FLOW_ALREADY_RUNNING/)
  })

  it('不同 basename 可并发', () => {
    r.start({ runId: 'run1', projectId: 'p1', basename: 'flow1' })
    r.start({ runId: 'run2', projectId: 'p1', basename: 'flow2' })
    expect(r.listActive('p1')).toHaveLength(2)
  })

  it('cancel 释放 lock + 允许重启', () => {
    r.start({ runId: 'run1', projectId: 'p1', basename: 'flow1' })
    r.cancel('run1')
    r.start({ runId: 'run2', projectId: 'p1', basename: 'flow1' })  // 不抛
    expect(r.get('run2')).toBeDefined()
  })

  it('checkQuotaForNode 自增 + 超限报错', () => {
    r.start({ runId: 'run1', projectId: 'p1', basename: 'flow1', quotaOverride: { maxIterPerNode: 2 } })
    expect(r.checkQuotaForNode('run1', 'n_a')).toBe(null)
    expect(r.checkQuotaForNode('run1', 'n_a')).toBe(null)
    expect(r.checkQuotaForNode('run1', 'n_a')).toMatch(/maxIterPerNode/)
  })

  it('checkQuotaBeforeLlmCall 自增 + 超限', () => {
    r.start({ runId: 'run1', projectId: 'p1', basename: 'flow1', quotaOverride: { maxLlmCalls: 2 } })
    expect(r.checkQuotaBeforeLlmCall('run1')).toBe(null)
    expect(r.checkQuotaBeforeLlmCall('run1')).toBe(null)
    expect(r.checkQuotaBeforeLlmCall('run1')).toMatch(/maxLlmCalls/)
  })

  it('remainingQuota', () => {
    r.start({ runId: 'run1', projectId: 'p1', basename: 'flow1', quotaOverride: { maxIterPerNode: 5, maxLlmCalls: 10 } })
    r.checkQuotaForNode('run1', 'n_a')
    r.checkQuotaBeforeLlmCall('run1')
    const q = r.remainingQuota('run1', 'n_a')
    expect(q.iterRemaining).toBe(4)
    expect(q.llmCallsRemaining).toBe(9)
  })

  it('updateStatus completed → 释放 lock', () => {
    r.start({ runId: 'run1', projectId: 'p1', basename: 'flow1' })
    r.updateStatus('run1', 'completed')
    r.start({ runId: 'run2', projectId: 'p1', basename: 'flow1' })  // 不抛
  })
})
