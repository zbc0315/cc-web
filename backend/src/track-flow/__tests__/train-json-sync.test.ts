import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import {
  copyToProjectCwd, reloadFromProjectCwd, cleanupProjectCwd,
  filterByWhitelist,
} from '../train-json-sync'

let testDir: string
beforeEach(() => {
  testDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sync-test-'))
})
afterEach(() => {
  fs.rmSync(testDir, { recursive: true, force: true })
})

describe('train-json-sync', () => {
  it('copyToProjectCwd 原子写 train.json + workflow_data.json', () => {
    const snapshot = { a: 1, b: 'hello' }
    const ok = copyToProjectCwd(testDir, snapshot)
    expect(ok).toBe(true)
    const trainJson = JSON.parse(fs.readFileSync(path.join(testDir, 'train.json'), 'utf8'))
    const wfd = JSON.parse(fs.readFileSync(path.join(testDir, 'workflow_data.json'), 'utf8'))
    expect(trainJson).toEqual(snapshot)
    expect(wfd).toEqual(snapshot)
  })

  it('reloadFromProjectCwd 读现有 train.json', async () => {
    fs.writeFileSync(path.join(testDir, 'train.json'), JSON.stringify({ x: 42 }), 'utf8')
    const r = await reloadFromProjectCwd(testDir)
    expect(r.ok).toBe(true)
    expect(r.data).toEqual({ x: 42 })
  })

  it('reloadFromProjectCwd 找不到文件返 ok=false', async () => {
    const r = await reloadFromProjectCwd(testDir)
    expect(r.ok).toBe(false)
  })

  it('reloadFromProjectCwd 非法 JSON：重试一次后报错', async () => {
    fs.writeFileSync(path.join(testDir, 'train.json'), 'not json', 'utf8')
    const r = await reloadFromProjectCwd(testDir)
    expect(r.ok).toBe(false)
    expect(r.error).toMatch(/JSON|parse/)
  })

  it('cleanupProjectCwd 删除 train.json + workflow_data.json', () => {
    fs.writeFileSync(path.join(testDir, 'train.json'), '{}', 'utf8')
    fs.writeFileSync(path.join(testDir, 'workflow_data.json'), '{}', 'utf8')
    cleanupProjectCwd(testDir)
    expect(fs.existsSync(path.join(testDir, 'train.json'))).toBe(false)
    expect(fs.existsSync(path.join(testDir, 'workflow_data.json'))).toBe(false)
  })

  it('cleanupProjectCwd 文件不存在不报错', () => {
    expect(() => cleanupProjectCwd(testDir)).not.toThrow()
  })

  it('filterByWhitelist 仅保留声明 key', () => {
    const r = filterByWhitelist({ a: 1, b: 2, ghost: 3 }, ['a', 'b'])
    expect(r).toEqual({ a: 1, b: 2 })
  })

  it('filterByWhitelist 缺字段填 null', () => {
    const r = filterByWhitelist({ a: 1 }, ['a', 'b'])
    expect(r).toEqual({ a: 1, b: null })
  })
})
