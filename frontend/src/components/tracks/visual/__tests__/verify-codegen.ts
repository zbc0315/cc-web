// frontend/src/components/tracks/visual/__tests__/verify-codegen.ts
import { codegen } from '../codegen'
import { makeEmptyGraph, reduce } from '../reducer'
import { makeAskUser, makeFai, makeLet, makeReturn } from '../default-nodes'
import { hasMarker } from '../marker'

let failed = 0
function check(name: string, cond: boolean, msg?: string): void {
  if (cond) console.log(`  ✓ ${name}`)
  else { failed++; console.error(`  ✗ ${name}${msg ? ': ' + msg : ''}`) }
}

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
  f1.outputs = [{ name: 'score', type: 'int' }]
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
  f1.outputs = [{ name: 'score', type: 'int' }]
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
  }
}

console.log(`\n${failed === 0 ? '✅ ALL CODEGEN-PARTIAL CHECKS PASSED' : `❌ ${failed} FAILED`}`)
process.exit(failed === 0 ? 0 : 1)
