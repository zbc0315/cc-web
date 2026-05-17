// frontend/src/components/tracks/visual/__tests__/verify-codegen.ts
import { codegen } from '../codegen'
import { makeEmptyGraph, reduce } from '../reducer'
import { makeAskUser, makeFai, makeLet, makeReturn, newItemId } from '../default-nodes'
import { hasMarker } from '../marker'

let failed = 0
function check(name: string, cond: boolean, msg?: string): void {
  if (cond) console.log(`  ✓ ${name}`)
  else { failed++; console.error(`  ✗ ${name}${msg ? ': ' + msg : ''}`) }
}

async function main(): Promise<void> {
console.log('=== codegen (M1 partial — ask_user/let/return) ===')

{
  let g = makeEmptyGraph('demo')
  const a = makeAskUser()
  a.outputVar = 'input'
  g = reduce(g, { type: 'add', node: a, index: 0 })
  const l = makeLet()
  l.varName = 'x'
  l.value = { kind: 'lit', raw: '42' }
  g = reduce(g, { type: 'add', node: l, index: 1 })
  const r = makeReturn()
  r.value = { kind: 'var', path: ['x'] }
  g = reduce(g, { type: 'add', node: r, index: 2 })

  const result = codegen(g)
  check('ok=true', result.ok === true, JSON.stringify(result.errors))

  if (result.ok && result.source) {
    check('has marker first line', hasMarker(result.source))
    check('emits ask_user', /__ccweb_ask_user/.test(result.source))
    check('emits let x = 42', /let x = 42/.test(result.source))
    check('emits return x', /return x/.test(result.source))
    check('emits 3 nid comments', (result.source.match(/@@nid:/g) ?? []).length === 3)
    check('exports main', /export main/.test(result.source))
  }
}

// ── fai shape dedupe ───────────────────────────────────────────────────
console.log('\n=== fai shape dedupe ===')

// Same shape twice → 1 declaration
{
  let g2 = makeEmptyGraph('demo2')
  const f1 = makeFai()
  f1.faiName = 'analyze'
  f1.outputVar = 'r1'
  f1.outputs = [{ id: newItemId(), name: 'score', type: 'int' }]
  f1.promptTemplate = [{ kind: 'text', raw: 'do' }]
  const f2 = JSON.parse(JSON.stringify(f1)) as typeof f1
  f2.id = 'n_dup'
  f2.outputVar = 'r2'
  g2 = reduce(g2, { type: 'add', node: f1, index: 0 })
  g2 = reduce(g2, { type: 'add', node: f2, index: 1 })
  const res = codegen(g2)
  check('same shape → ok', res.ok)
  if (res.ok && res.source) {
    const declCount = (res.source.match(/^fai analyze/gm) ?? []).length
    check('same shape → 1 declaration', declCount === 1)
    check('two distinct call sites', (res.source.match(/= analyze\(/g) ?? []).length === 2)
  }
}

// Same faiName but different prompt → 2 declarations with auto-rename
{
  let g3 = makeEmptyGraph('demo3')
  const f1 = makeFai()
  f1.faiName = 'analyze'
  f1.outputVar = 'r1'
  f1.outputs = [{ id: newItemId(), name: 'score', type: 'int' }]
  f1.promptTemplate = [{ kind: 'text', raw: 'do A' }]
  const f2 = JSON.parse(JSON.stringify(f1)) as typeof f1
  f2.id = 'n_diff'
  f2.outputVar = 'r2'
  f2.promptTemplate = [{ kind: 'text', raw: 'do B' }]
  g3 = reduce(g3, { type: 'add', node: f1, index: 0 })
  g3 = reduce(g3, { type: 'add', node: f2, index: 1 })
  const res = codegen(g3)
  check('diff shape same name → ok', res.ok)
  if (res.ok && res.source) {
    check('has fai analyze', /^fai analyze\(/m.test(res.source))
    check('has fai analyze_2', /^fai analyze_2\(/m.test(res.source))
    check('second call site uses analyze_2', /= analyze_2\(/.test(res.source))
  }
}

// ── validation ────────────────────────────────────────────────────────
console.log('\n=== validation ===')

// missing var reference
{
  let g = makeEmptyGraph('vt')
  const r = makeReturn()
  r.value = { kind: 'var', path: ['nonexistent'] }
  g = reduce(g, { type: 'add', node: r, index: 0 })
  const res = codegen(g)
  check('missing var → ok=false', !res.ok)
  check('error mentions nonexistent', !!res.errors?.some((e) => e.message.includes('nonexistent')))
}

// duplicate outputVar
{
  let g = makeEmptyGraph('vt2')
  const a1 = makeAskUser(); a1.outputVar = 'dup'
  const a2 = makeAskUser(); a2.outputVar = 'dup'
  g = reduce(g, { type: 'add', node: a1, index: 0 })
  g = reduce(g, { type: 'add', node: a2, index: 1 })
  const res = codegen(g)
  check('dup outputVar → ok=false', !res.ok)
  check('error mentions already declared', !!res.errors?.some((e) => e.message.includes('already declared')))
}

// ── end-to-end: codegen → train-core parse() ──────────────────────────
console.log('\n=== end-to-end parse ===')
{
  let g = makeEmptyGraph('e2e')
  const a = makeAskUser()
  a.outputVar = 'input'
  a.fields = [{ id: newItemId(), key: 'file_path', label: 'p', type: 'text', required: true }]
  g = reduce(g, { type: 'add', node: a, index: 0 })

  const f = makeFai()
  f.faiName = 'analyze'
  f.outputVar = 'r'
  f.inputs = [
    { id: newItemId(), argName: 'file_path', argType: 'string', source: { kind: 'var', path: ['input', 'file_path'] } },
  ]
  f.outputs = [
    { id: newItemId(), name: 'rating', type: 'int', constraints: { min: 0, max: 10 } },
    { id: newItemId(), name: 'comment', type: 'string', constraints: { maxLen: 500 } },
  ]
  f.promptTemplate = [
    { kind: 'text', raw: '请对 ' },
    { kind: 'ref', path: ['input', 'file_path'] },
    { kind: 'text', raw: ' 评分' },
  ]
  g = reduce(g, { type: 'add', node: f, index: 1 })

  const ret = makeReturn()
  ret.value = { kind: 'var', path: ['r'] }
  g = reduce(g, { type: 'add', node: ret, index: 2 })

  const res = codegen(g)
  check('e2e ok=true', res.ok, JSON.stringify(res.errors))
  if (res.ok && res.source) {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const train = require('../../../../../../backend/vendor/@tom2012/train-core/dist/index.js')
    const parsed = train.parse(res.source)
    check('train.parse — no lex errors', parsed.lexErrors.length === 0,
      JSON.stringify(parsed.lexErrors))
    check('train.parse — no parse errors', parsed.parseErrors.length === 0,
      JSON.stringify(parsed.parseErrors.slice(0, 2).map((e: { message: string }) => e.message)))
  }
}

// ── identifier validation ─────────────────────────────────────────────
console.log('\n=== identifier validation ===')

// outputVar with space
{
  let g = makeEmptyGraph('id-test')
  const a = makeAskUser()
  a.outputVar = 'foo bar'
  g = reduce(g, { type: 'add', node: a, index: 0 })
  const res = codegen(g)
  check('invalid outputVar → ok=false', !res.ok)
  check('error mentions valid identifier',
    !!res.errors?.some((e) => e.message.includes('not a valid identifier')))
}

// faiName with dot
{
  let g = makeEmptyGraph('id-test2')
  const f = makeFai()
  f.faiName = 'my.fn'
  g = reduce(g, { type: 'add', node: f, index: 0 })
  const ret = makeReturn()
  ret.value = { kind: 'var', path: ['r'] }
  g = reduce(g, { type: 'add', node: ret, index: 1 })
  const res = codegen(g)
  check('invalid faiName → ok=false', !res.ok)
  check('error mentions fai name',
    !!res.errors?.some((e) => e.message.includes('fai name')))
}

// leading digit in field key
{
  let g = makeEmptyGraph('id-test3')
  const a = makeAskUser()
  a.fields = [{ id: 'i_a', key: '1bad', label: 'x', type: 'text' }]
  g = reduce(g, { type: 'add', node: a, index: 0 })
  const res = codegen(g)
  check('leading-digit field key → ok=false', !res.ok)
  check('error mentions field key',
    !!res.errors?.some((e) => e.message.includes('field key')))
}

// ── runtime exec via train-core runSource + mock adapter (P0 v-17-b) ──
// Catches arity mismatches between fai decl and call site. Previously
// renderFaiDeclaration omitted `prompt: prompt` while renderFaiCall always
// appends the prompt string, causing "expects N arg(s), got N+1" at runtime.
// The static parse check alone (T9) does NOT catch this — train-lang's
// arity is checked at dispatch time.
console.log('\n=== runtime exec (mock adapter) ===')
{
  let g = makeEmptyGraph('rt-test')
  const f = makeFai()
  f.faiName = 'simple'
  f.outputVar = 'r'
  f.inputs = []
  f.outputs = [{ id: 'i_msg', name: 'msg', type: 'string' }]
  f.promptTemplate = [{ kind: 'text', raw: '回复 hello' }]
  g = reduce(g, { type: 'add', node: f, index: 0 })
  const ret = makeReturn()
  ret.value = { kind: 'var', path: ['r', 'msg'] }
  g = reduce(g, { type: 'add', node: ret, index: 1 })

  const res = codegen(g)
  check('runtime e2e codegen ok', res.ok, JSON.stringify(res.errors))
  if (res.ok && res.source) {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const core = require('../../../../../../backend/vendor/@tom2012/train-core/dist/index.js')
    const adapter = {
      name: 'inline-mock',
      version: '0.0.0',
      capabilities: { parallel: true, cancellation: true, writesWorkflowData: false },
      // eslint-disable-next-line @typescript-eslint/require-await
      async call(_req: unknown) {
        return { kind: 'success', outputs: { msg: 'hello from mock' } }
      },
    }
    const runResult = await core.runSource(res.source, { adapter, args: [] })
    check('runtime exec ok=true (no arity mismatch)', runResult.ok,
      runResult.error ? `${runResult.error.errorType ?? 'Error'}: ${runResult.error.message}` : '')
    check('runtime returns expected value', runResult.value === 'hello from mock',
      `got ${JSON.stringify(runResult.value)}`)
  }
}

// ── fai decl/call arity consistency (static check) ────────────────────
// Cheap regex-based guard for the same class of bug — fast feedback.
{
  let g = makeEmptyGraph('arity-test')
  const f = makeFai()
  f.faiName = 'multiArg'
  f.outputVar = 'r'
  f.inputs = [
    { id: 'i_1', argName: 'a', argType: 'string', source: { kind: 'lit', raw: '"x"' } },
    { id: 'i_2', argName: 'b', argType: 'number', source: { kind: 'lit', raw: '1' } },
  ]
  f.outputs = [{ id: 'i_o', name: 'out', type: 'string' }]
  f.promptTemplate = [{ kind: 'text', raw: 'p' }]
  g = reduce(g, { type: 'add', node: f, index: 0 })

  const res = codegen(g)
  check('arity-test codegen ok', res.ok)
  if (res.ok && res.source) {
    const declMatch = res.source.match(/^fai multiArg\(([^)]*)\)/m)
    const callMatch = res.source.match(/let r = multiArg\(([^)]*)\)/)
    const declArity = declMatch?.[1] ? declMatch[1].split(',').length : 0
    // Crude: split call args on commas. Won't handle nested commas (e.g. in object literals).
    // Our prompt segments are escaped/quoted so this works for the test case.
    const callArity = callMatch?.[1] ? callMatch[1].split(',').length : 0
    check('fai decl includes prompt formal', !!declMatch?.[1]?.includes('prompt: prompt'),
      `decl: ${declMatch?.[1]}`)
    check('decl arity == call arity', declArity === callArity,
      `decl=${declArity}, call=${callArity}, decl="${declMatch?.[1]}", call="${callMatch?.[1]}"`)
  }
}

}  // end main()

main().then(() => {
  console.log(`\n${failed === 0 ? '✅ ALL CODEGEN-PARTIAL CHECKS PASSED' : `❌ ${failed} FAILED`}`)
  process.exit(failed === 0 ? 0 : 1)
}).catch((err) => {
  console.error('verify-codegen crashed:', err)
  process.exit(2)
})
