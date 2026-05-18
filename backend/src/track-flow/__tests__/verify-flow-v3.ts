/**
 * E2E smoke: build FlowV3 → runtime → run to completion.
 *
 * Uses a mock injector that simulates LLM behaviour by writing predetermined
 * values into train.json after prompt injection. Covers the research-loop
 * example from spec §2:
 *
 *   user_input → llm(research) → llm(check) → if has_error → loop / end
 *
 * check node returns has_error=true on 1st call (loop), false on 2nd (end).
 * user input (area=逆合成) is submitted asynchronously via setTimeout.
 *
 * 5 checks:
 *   1. run completed
 *   2. check node called 2 times
 *   3. flow_node_active emitted >= 4 times
 *   4. flow_done emitted
 *   5. has_error final value = false
 */
import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import { runFlow, submitUserInputForRun, type FlowV3 } from '../runtime'
import { flowRunRegistry } from '../run-registry'

interface CheckResult { name: string; ok: boolean; detail?: string }
const results: CheckResult[] = []

function check(name: string, ok: boolean, detail?: string) {
  results.push({ name, ok, detail })
  const mark = ok ? '✓' : '✗'
  console.log(`${mark} ${name}${detail ? `  — ${detail}` : ''}`)
}

async function main() {
  const testDir = fs.mkdtempSync(path.join(os.tmpdir(), 'verify-flow-v3-'))

  let checkCallCount = 0

  /**
   * Mock injector: reads current train.json written by dispatchLlmCall,
   * sets the appropriate fields, then atomically writes it back.
   *
   * A 10ms sleep ensures the mtime of the re-written file is strictly
   * greater than the mtime recorded by dispatchLlmCall right after its
   * own copyToProjectCwd write.
   */
  const mockInjector = async (prompt: string) => {
    await new Promise<void>((r) => setTimeout(r, 10))

    const trainJsonPath = path.join(testDir, 'train.json')
    let current: Record<string, unknown> = {}
    try {
      current = JSON.parse(fs.readFileSync(trainJsonPath, 'utf8')) as Record<string, unknown>
    } catch {
      /* file may not exist yet; start from empty */
    }

    if (prompt.includes('请调研')) {
      // research node: provide ref_fp
      current.ref_fp = './test.bibtex'
    } else if (prompt.includes('请检查')) {
      // check node: first call → has_error=true (loop); second → false (end)
      checkCallCount += 1
      current.has_error = checkCallCount === 1 ? true : false
    }

    // Atomic write so mtime is updated and file is valid JSON
    const tmp = `${trainJsonPath}.tmp.${process.pid}.${Date.now()}`
    fs.writeFileSync(tmp, JSON.stringify(current), 'utf8')
    fs.renameSync(tmp, trainJsonPath)
  }

  // Research-loop FlowV3 definition
  const flow: FlowV3 = {
    version: 3,
    trackName: 'research-loop',
    adapter: 'claude-code',
    variables: [
      { key: 'area',      description: '研究领域',                     initialValue: null },
      { key: 'ref_fp',    description: '文献存储 bibtex 格式文件的路径', initialValue: null },
      { key: 'has_error', description: '文献存在错误',                   initialValue: null },
    ],
    nodes: [
      {
        id: 'n_input', type: 'user_input', position: { x: 0, y: 0 },
        fields: [{ varKey: 'area', uiHint: 'text' }],
      },
      {
        id: 'n_research', type: 'llm', position: { x: 0, y: 100 },
        promptTemplate: '请调研@{area}的科研论文，结果填写到${ref_fp}中',
        inputs: ['area'], outputs: ['ref_fp'],
      },
      {
        id: 'n_check', type: 'llm', position: { x: 0, y: 200 },
        promptTemplate: '请检查@{ref_fp}中的论文，相关性@{area}，结果${has_error}',
        inputs: ['area', 'ref_fp'], outputs: ['has_error'],
      },
      {
        id: 'n_if', type: 'if', position: { x: 0, y: 300 },
        conditionExpr: 'has_error == true',
      },
    ],
    edges: [
      { id: 'e1', source: 'n_input',    target: 'n_research' },
      { id: 'e2', source: 'n_research', target: 'n_check' },
      { id: 'e3', source: 'n_check',    target: 'n_if' },
      { id: 'e4', source: 'n_if', sourceHandle: 'true',  target: 'n_check' },  // retry loop
      { id: 'e5', source: 'n_if', sourceHandle: 'false', target: null },        // end
    ],
  }

  const runId = 'verify_run_v3_1'
  const events: { type: string; payload: Record<string, unknown> }[] = []

  flowRunRegistry.start({ runId, projectId: 'p_verify', basename: 'research-loop' })

  // Submit user input asynchronously (simulates frontend interaction)
  setTimeout(() => {
    submitUserInputForRun(runId, { area: '逆合成' })
  }, 100)

  await runFlow(flow, {}, {
    projectFolder: testDir,
    basename: 'research-loop',
    runId,
    injector: mockInjector,
    broadcast: (event, payload) => events.push({ type: event, payload }),
  })

  // ── Assertions ──────────────────────────────────────────────────────────

  const info = flowRunRegistry.get(runId)
  check(
    'run completed',
    info?.status === 'completed',
    `status=${info?.status}`,
  )

  check(
    'check node called 2 times (loop once then end)',
    checkCallCount === 2,
    `checkCallCount=${checkCallCount}`,
  )

  const activeCount = events.filter((e) => e.type === 'flow_node_active').length
  check(
    'flow_node_active emitted >= 4 times',
    activeCount >= 4,
    `count=${activeCount}`,
  )

  check(
    'flow_done emitted',
    events.some((e) => e.type === 'flow_done'),
  )

  const hasErrorEvents = events.filter(
    (e) => e.type === 'flow_var_changed' && (e.payload as Record<string, unknown>).key === 'has_error',
  )
  const lastHasError = hasErrorEvents.at(-1)?.payload.value
  check(
    'has_error final value = false',
    lastHasError === false,
    `last has_error=${JSON.stringify(lastHasError)}`,
  )

  // ── Summary ─────────────────────────────────────────────────────────────

  fs.rmSync(testDir, { recursive: true, force: true })

  const failures = results.filter((r) => !r.ok)
  console.log(`\n${results.length - failures.length}/${results.length} checks passed`)
  if (failures.length > 0) {
    console.log('FAILED:')
    failures.forEach((r) => console.log(`  ✗ ${r.name}${r.detail ? ` — ${r.detail}` : ''}`))
    process.exit(1)
  }
}

main().catch((e) => {
  console.error('verify-flow-v3 failed with exception:', e)
  process.exit(1)
})
