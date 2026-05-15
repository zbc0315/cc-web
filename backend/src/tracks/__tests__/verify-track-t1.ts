/**
 * T1 verification — extends T0 with:
 *   - __ccweb_ask_user builtin闭环 (bridge → push → submit → resume)
 *   - store CRUD (list / load / save / delete)
 *   - global-tracks store CRUD
 *   - TrackRegistry start / abort / state / submitInput
 *
 * Run:  cd backend && npx ts-node src/tracks/__tests__/verify-track-t1.ts
 */

import * as fs from 'fs/promises'
import * as fsSync from 'fs'
import * as os from 'os'
import * as path from 'path'

import {
  createTrackRunner,
  createWorkflowDataWatcher,
  createAskUserBridge,
  listTracks,
  loadTrack,
  saveTrack,
  deleteTrack,
  sanitizeTrackFilename,
  saveGlobalTrack,
  loadGlobalTrack,
  listGlobalTracks,
  deleteGlobalTrack,
  createTrackRegistry,
} from '..'
import type { AskUserPushEvent } from '../ask-user-bridge'
import type { WorkflowData } from '../types'

let failed = 0
function check(name: string, cond: boolean, msg?: string): void {
  if (cond) {
    console.log(`  ✓ ${name}`)
  } else {
    failed++
    console.error(`  ✗ ${name}${msg ? ': ' + msg : ''}`)
  }
}

async function readWf(p: string): Promise<WorkflowData> {
  return JSON.parse(await fs.readFile(p, 'utf8')) as WorkflowData
}
async function writeWf(p: string, w: WorkflowData): Promise<void> {
  await fs.writeFile(p, JSON.stringify(w, null, 2), 'utf8')
}

// ────────────────────────────────────────────────────────────────────────────
async function testStore(): Promise<void> {
  console.log('\n=== store CRUD ===')
  const tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'ccweb-t1-store-'))
  // Project store
  check('listTracks empty when dir missing', listTracks(tmpRoot).length === 0)
  const ok1 = saveTrack(tmpRoot, 'foo.tr', 'fai f() -> r: int { }\nexport f\n')
  check('saveTrack returns true', ok1)
  const list1 = listTracks(tmpRoot)
  check('list reports 1 file', list1.length === 1 && list1[0]!.filename === 'foo.tr')
  const src = loadTrack(tmpRoot, 'foo.tr')
  check('loadTrack returns content', src !== null && src.includes('fai f()'))
  check('loadTrack on missing returns null', loadTrack(tmpRoot, 'bogus.tr') === null)
  check('deleteTrack returns true', deleteTrack(tmpRoot, 'foo.tr'))
  check('list empty after delete', listTracks(tmpRoot).length === 0)

  // sanitize
  check('sanitize accepts foo.tr', sanitizeTrackFilename('foo.tr') === 'foo.tr')
  check('sanitize adds .tr extension', sanitizeTrackFilename('foo') === 'foo.tr')
  check('sanitize rejects slash', sanitizeTrackFilename('a/b.tr') === null)
  check('sanitize rejects ..', sanitizeTrackFilename('..foo.tr') === null)
  check('sanitize rejects empty', sanitizeTrackFilename('') === null)
  check('sanitize rejects non-string', sanitizeTrackFilename(42 as unknown) === null)

  // Global track store (per fake username under tmp HOME). We can't
  // easily redirect os.homedir() in this verify script, so we test
  // by directly using a temp user-scope dir via env trick — skip this
  // round and only test list returns empty for an unknown user.
  check(
    'listGlobalTracks empty for unknown user',
    listGlobalTracks('definitely-no-such-user-zxqv').length === 0,
  )
  check(
    'loadGlobalTrack returns null for unknown user',
    loadGlobalTrack('definitely-no-such-user-zxqv', 'foo.tr') === null,
  )

  await fs.rm(tmpRoot, { recursive: true, force: true })
}

// ────────────────────────────────────────────────────────────────────────────
async function testAskUserBridge(): Promise<void> {
  console.log('\n=== ask-user-bridge unit ===')
  const pushed: AskUserPushEvent[] = []
  const bridge = createAskUserBridge((ev) => {
    pushed.push(ev)
  })

  // Validation
  let threw = false
  try {
    await bridge.requestInput('r1', [])
  } catch {
    threw = true
  }
  check('empty spec rejected', threw)

  let threw2 = false
  try {
    await bridge.requestInput('r2', [
      { key: 'x', label: 'X', type: 'enum' }, // missing variants
    ])
  } catch {
    threw2 = true
  }
  check('enum without variants rejected', threw2)

  // Happy path
  const pending = bridge.requestInput('r3', [
    { key: 'name', label: 'Name', type: 'text' },
    { key: 'age', label: 'Age', type: 'number' },
  ])
  check('push event emitted', pushed.length === 1)
  check('push event has fields', pushed[0]!.fields.length === 2)
  check('push event has runId', pushed[0]!.runId === 'r3')

  const reqId = pushed[0]!.requestId
  check('getPending returns the request', bridge.getPending('r3')?.requestId === reqId)

  const submitResult = bridge.submitInput('r3', reqId, { name: 'Tom', age: 30 })
  check('submit returned ok', submitResult.ok)
  const got = await pending
  check('promise resolved with submitted data', got.name === 'Tom' && got.age === 30)
  check('pending cleared after submit', bridge.getPending('r3') === null)

  // requestId mismatch
  const p2 = bridge.requestInput('r4', [{ key: 'x', label: 'X', type: 'text' }])
  // wait one tick so push happens
  await new Promise((r) => setImmediate(r))
  const reqId2 = pushed[pushed.length - 1]!.requestId
  const wrongResult = bridge.submitInput('r4', 'wrong-id', { x: 'y' })
  check('mismatched requestId rejected', !wrongResult.ok)
  // Submit correct one to drain
  bridge.submitInput('r4', reqId2, { x: 'y' })
  await p2

  // Type validation
  const p3 = bridge.requestInput('r5', [
    { key: 'flag', label: 'F', type: 'bool' },
  ])
  await new Promise((r) => setImmediate(r))
  const reqId3 = pushed[pushed.length - 1]!.requestId
  const bad = bridge.submitInput('r5', reqId3, { flag: 'not-a-bool' })
  check('type-mismatched submit rejected', !bad.ok && (bad.message?.includes('boolean') ?? false))
  bridge.submitInput('r5', reqId3, { flag: true })
  await p3

  // AbortSignal
  const ac = new AbortController()
  const p4 = bridge.requestInput(
    'r6',
    [{ key: 'x', label: 'X', type: 'text' }],
    ac.signal,
  )
  await new Promise((r) => setImmediate(r))
  ac.abort()
  let p4ThrowMsg = ''
  try {
    await p4
  } catch (e) {
    p4ThrowMsg = (e as Error).message
  }
  check('signal-aborted request rejects', p4ThrowMsg.includes('cancelled'))

  // cancelAllForRun
  const p5 = bridge.requestInput('r7', [{ key: 'x', label: 'X', type: 'text' }])
  await new Promise((r) => setImmediate(r))
  bridge.cancelAllForRun('r7', 'manual')
  let p5ThrowMsg = ''
  try {
    await p5
  } catch (e) {
    p5ThrowMsg = (e as Error).message
  }
  check('cancelAllForRun rejects pending', p5ThrowMsg.includes('manual'))
}

// ────────────────────────────────────────────────────────────────────────────
async function testAskUserEndToEnd(): Promise<void> {
  console.log('\n=== ask_user end-to-end (.tr → bridge → submit → resume) ===')

  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'ccweb-t1-asku-'))
  const trackPath = path.join(tmpDir, 'asku.tr')
  const wfPath = path.join(tmpDir, 'workflow_data.json')

  // .tr that calls __ccweb_ask_user then returns the user's answer
  const trSource = `
func main() -> string {
  let answer = __ccweb_ask_user({
    fields: [
      { key: "decision", label: "继续吗？", type: "enum", variants: ["yes", "no"] }
    ]
  })
  return answer.decision
}

export main
`
  await fs.writeFile(trackPath, trSource, 'utf8')
  await writeWf(wfPath, { constants: {}, variables: {}, task_progress: [] })

  const watcher = createWorkflowDataWatcher(wfPath)
  const pushed: AskUserPushEvent[] = []
  const bridge = createAskUserBridge((ev) => {
    pushed.push(ev)
  })

  const runner = createTrackRunner({
    projectId: 'asku-proj',
    injector: () => {}, // no fai in this .tr, injector won't fire
    watcher,
    askUserBridge: bridge,
    maxFaiAttempts: 1,
    defaultFaiTimeoutMs: 5000,
  })

  const runPromise = runner.run(trackPath)

  // Wait for push event (with timeout)
  const start = Date.now()
  while (pushed.length === 0 && Date.now() - start < 3000) {
    await new Promise((r) => setTimeout(r, 20))
  }
  check('runner pushed ask_user event', pushed.length === 1)
  if (pushed.length === 1) {
    check('event runId matches runner state', pushed[0]!.runId === runner.getState()?.runId)
    check('event has decision field', pushed[0]!.fields[0]!.key === 'decision')
    // Submit response
    const reqId = pushed[0]!.requestId
    const submitResult = bridge.submitInput(pushed[0]!.runId, reqId, {
      decision: 'yes',
    })
    check('submitInput accepted', submitResult.ok)
  }

  const result = await runPromise
  check('runner completed ok', result.ok, JSON.stringify(result.error))
  check(
    'runner returned the submitted decision',
    result.value === 'yes',
    `got: ${JSON.stringify(result.value)}`,
  )

  await fs.rm(tmpDir, { recursive: true, force: true })
}

// ────────────────────────────────────────────────────────────────────────────
async function testRegistry(): Promise<void> {
  console.log('\n=== TrackRegistry (start/abort/state/submitInput) ===')

  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'ccweb-t1-reg-'))
  const projectDir = path.join(tmpDir, 'proj1')
  await fs.mkdir(path.join(projectDir, '.ccweb'), { recursive: true })
  const wfPath = path.join(projectDir, '.ccweb', 'workflow_data.json')
  await writeWf(wfPath, { constants: {}, variables: {}, task_progress: [] })

  // Create a track
  saveTrack(projectDir, 'reg.tr', `func main() -> int { return 1 }\nexport main\n`)

  const broadcastEvents: Array<{ projectId: string; msg: Record<string, unknown> }> = []
  const registry = createTrackRegistry({
    getProjectFolder: (id) => (id === 'proj1' ? projectDir : null),
    injectIntoPty: () => {},
    broadcast: (projectId, msg) => {
      broadcastEvents.push({ projectId, msg })
    },
  })

  check('isRunning false initially', !registry.isRunning('proj1'))
  check('getState null initially', registry.getState('proj1') === null)
  check('getPendingAskUser null initially', registry.getPendingAskUser('proj1') === null)

  const trackAbs = path.join(projectDir, '.ccweb', 'tracks', 'reg.tr')
  const start = await registry.start('proj1', trackAbs, 'reg.tr', [])
  check('start ok=true', start.ok && 'runId' in start)

  // Wait for run to complete
  await new Promise((r) => setTimeout(r, 200))

  const finalState = registry.getState('proj1')
  check('final state non-null', finalState !== null)
  check('final status is completed', finalState?.status === 'completed')
  check('result value is 1', finalState?.result === 1)
  check('isRunning false after completion', !registry.isRunning('proj1'))

  // Verify broadcasts happened (status_change + run_complete)
  const statusChanges = broadcastEvents.filter((e) => e.msg.type === 'track_status_change')
  check('at least one track_status_change emitted', statusChanges.length >= 1)
  const completes = broadcastEvents.filter((e) => e.msg.type === 'track_run_complete')
  check('track_run_complete emitted', completes.length === 1)

  // unknown project rejected
  const bogus = await registry.start('no-such-proj', trackAbs, 'reg.tr', [])
  check('start rejects unknown project', !bogus.ok)

  await fs.rm(tmpDir, { recursive: true, force: true })
}

// ────────────────────────────────────────────────────────────────────────────
async function main(): Promise<void> {
  console.log('=== T1 verification ===')
  await testStore()
  await testAskUserBridge()
  await testAskUserEndToEnd()
  await testRegistry()

  console.log(`\n${failed === 0 ? '✅ ALL T1 CHECKS PASSED' : `❌ ${failed} CHECK(S) FAILED`}`)
  process.exit(failed === 0 ? 0 : 1)
}

main().catch((e) => {
  console.error('verify-track-t1 crashed:', e)
  process.exit(2)
})
