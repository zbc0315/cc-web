// frontend/src/components/tracks/graph/__tests__/verify-graph-v2.ts
/**
 * End-to-end smoke: build GraphV2 → codegen → train-core runSource
 * + inline mock fai adapter → must reach ok=true.
 *
 * Mirrors the v-17-b lesson #2 pattern: parse-pass ≠ runtime-pass.
 *
 * Runner: `npm run verify:graph-v2` (uses tsx, ESM-native).
 *
 * Note: @tom2012/train-core vendor bundle is ESM-only. CJS require() and
 * createRequire both fail with ERR_PACKAGE_PATH_NOT_EXPORTED on chevrotain
 * sub-packages. We use `new Function('p','return import(p)')` to defer the
 * import past tsx's module system, same pattern as backend/train-loader.ts.
 */
import { codegen } from '../codegen-v2'
import { newNodeId } from '../graph-types-v2'
import type { GraphV2 } from '../graph-types-v2'
import { fileURLToPath } from 'node:url'
import { resolve, dirname } from 'node:path'

// Defer dynamic import past tsx's CJS rewriter — train-core is ESM-only
const dynamicImport = new Function('p', 'return import(p)') as <T>(p: string) => Promise<T>

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

interface CoreMod {
  parse: (src: string) => {
    lexErrors: { message: string }[]
    parseErrors: { message: string }[]
  }
  runSource: (
    src: string,
    opts: { adapter: unknown; args?: unknown[] },
  ) => Promise<{
    ok: boolean
    value?: unknown
    error?: { message: string; errorType?: string }
    lexErrors?: unknown[]
    parseErrors?: unknown[]
  }>
}

const TRAIN_CORE_PATH = resolve(
  __dirname,
  '../../../../../../backend/vendor/@tom2012/train-core/dist/index.js',
)

interface CheckResult { name: string; ok: boolean; detail?: string }
const results: CheckResult[] = []
function check(name: string, cond: boolean, detail?: string) {
  results.push({ name, ok: cond, detail })
  console.log(`${cond ? '✓' : '✗'} ${name}${detail ? `  — ${detail}` : ''}`)
}

const inlineMockAdapter = {
  name: 'inline-mock',
  version: '0.0.0',
  capabilities: { parallel: true, cancellation: true, writesWorkflowData: false },
  // eslint-disable-next-line @typescript-eslint/require-await
  async call(_req: unknown) {
    return { kind: 'success', outputs: { rating: 7, comment: 'mock' } }
  },
}

async function main() {
  const core = await dynamicImport<CoreMod>(TRAIN_CORE_PATH)

  // ── Case 1: single return node ─────────────────────────────────────
  console.log('\n=== case 1: single return ===')
  {
    const g: GraphV2 = {
      version: 2, trackName: 't1',
      nodes: [{ id: newNodeId(), type: 'return', position: { x: 0, y: 0 }, valueExpr: '"hello"' }],
      edges: [],
    }
    const r = codegen(g)
    check('case1 codegen ok', r.ok)
    if (r.ok && r.source) {
      const run = await core.runSource(r.source, { adapter: inlineMockAdapter, args: [] })
      check('case1 runtime ok=true', run.ok, run.ok
        ? `result=${JSON.stringify(run.value)}`
        : `error=${run.error?.message ?? String(run.error)}`)
    }
  }

  // ── Case 2: code + fai + return chain ────────────────────────────
  console.log('\n=== case 2: code + fai + return chain ===')
  {
    const nC = newNodeId(), nF = newNodeId(), nR = newNodeId()
    const g: GraphV2 = {
      version: 2, trackName: 't2',
      nodes: [
        { id: nC, type: 'code', position: { x: 0, y: 0 }, code: 'let s = "hello"' },
        {
          id: nF, type: 'fai', position: { x: 0, y: 100 },
          faiName: 'analyze', outputVar: 'r',
          inputs: [{ id: 'i1', argName: 'text', argType: 'string', sourceExpr: 's' }],
          outputs: [
            { id: 'o1', name: 'rating', type: 'int', constraints: { min: 1, max: 10 } },
            { id: 'o2', name: 'comment', type: 'string' },
          ],
          promptTemplate: '评分',
        },
        { id: nR, type: 'return', position: { x: 0, y: 200 }, valueExpr: 'r' },
      ],
      edges: [
        { id: 'e1', source: nC, target: nF },
        { id: 'e2', source: nF, target: nR },
      ],
    }
    const r = codegen(g)
    check('case2 codegen ok', r.ok, r.ok ? '' : r.errors?.map((e) => e.message).join('; '))
    if (r.ok && r.source) {
      // Static arity check: decl and call must have same arg count
      const declMatch = r.source.match(/^fai analyze\(([^)]*)\)/m)
      const callMatch = r.source.match(/let r = analyze\(([^)]*)\)/)
      const declArity = declMatch?.[1] ? declMatch[1].split(',').length : 0
      const callArity = callMatch?.[1] ? callMatch[1].split(',').length : 0
      check('case2 fai decl has prompt formal', !!declMatch?.[1]?.includes('prompt: prompt'),
        `decl: ${declMatch?.[1]}`)
      check('case2 decl arity == call arity', declArity === callArity,
        `decl=${declArity}, call=${callArity}`)
      // Runtime: mock adapter returns { rating, comment } matching declared outputs
      const run = await core.runSource(r.source, { adapter: inlineMockAdapter, args: [] })
      check('case2 runtime ok=true', run.ok, run.ok
        ? `result=${JSON.stringify(run.value)}`
        : `error=${run.error?.message ?? String(run.error)}`)
    }
  }

  // ── Case 3: ask_user + return (codegen only; runtime needs backend injection) ──
  console.log('\n=== case 3: ask_user + return (codegen check) ===')
  {
    const nA = newNodeId(), nR = newNodeId()
    const g: GraphV2 = {
      version: 2, trackName: 't3',
      nodes: [
        {
          id: nA, type: 'ask_user', position: { x: 0, y: 0 },
          outputVar: 'input',
          fields: [{ id: 'f1', key: 'name', label: '姓名', type: 'text' }],
        },
        { id: nR, type: 'return', position: { x: 0, y: 100 }, valueExpr: 'input.name' },
      ],
      edges: [{ id: 'e1', source: nA, target: nR }],
    }
    const r = codegen(g)
    check('case3 codegen ok', r.ok)
    // Note: ask_user runtime needs __ccweb_ask_user injection (provided by backend track-runner).
    // Full runtime test for ask_user is in backend verify-track.
    // Parse-level check via train-core:
    if (r.ok && r.source) {
      const parsed = core.parse(r.source)
      check('case3 parse no lex errors', parsed.lexErrors.length === 0,
        JSON.stringify(parsed.lexErrors.slice(0, 2)))
      check('case3 parse no parse errors', parsed.parseErrors.length === 0,
        JSON.stringify(parsed.parseErrors.slice(0, 2).map((e: { message: string }) => e.message)))
    }
  }

  const fails = results.filter((r) => !r.ok)
  console.log(`\n${results.length - fails.length}/${results.length} checks passed`)
  if (fails.length > 0) {
    console.log('\nFAILED:')
    fails.forEach((r) => console.log(`  ✗ ${r.name}${r.detail ? ` — ${r.detail}` : ''}`))
    process.exit(1)
  }
}

main().catch((e) => {
  console.error('verify failed with exception:', e)
  process.exit(1)
})
