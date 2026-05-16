// frontend/src/components/tracks/visual/__tests__/verify-codegen.ts
import { codegen } from '../codegen'
import { makeEmptyGraph, reduce } from '../reducer'
import { makeAskUser, makeLet, makeReturn } from '../default-nodes'
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

console.log(`\n${failed === 0 ? '✅ ALL CODEGEN-PARTIAL CHECKS PASSED' : `❌ ${failed} FAILED`}`)
process.exit(failed === 0 ? 0 : 1)
