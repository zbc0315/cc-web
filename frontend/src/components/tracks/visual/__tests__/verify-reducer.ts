// frontend/src/components/tracks/visual/__tests__/verify-reducer.ts
import { reduce, makeEmptyGraph } from '../reducer'
import { makeAskUser, makeLet, makeReturn } from '../default-nodes'

let failed = 0
function check(name: string, cond: boolean, msg?: string): void {
  if (cond) console.log(`  ✓ ${name}`)
  else { failed++; console.error(`  ✗ ${name}${msg ? ': ' + msg : ''}`) }
}

console.log('=== reducer ===')
let g = makeEmptyGraph('demo')
check('empty body', g.body.length === 0)

const a = makeAskUser()
g = reduce(g, { type: 'add', node: a, index: 0 })
check('add inserts at 0', g.body.length === 1 && g.body[0]!.id === a.id)

const r = makeReturn()
g = reduce(g, { type: 'add', node: r, index: 1 })
check('add inserts at 1', g.body.length === 2 && g.body[1]!.id === r.id)

g = reduce(g, { type: 'move', from: 0, to: 1 })
check('move reorders', g.body[0]!.id === r.id && g.body[1]!.id === a.id)

g = reduce(g, { type: 'duplicate', index: 0 })
check('duplicate adds clone after source', g.body.length === 3 && g.body[1]!.type === 'return' && g.body[1]!.id !== r.id)

g = reduce(g, { type: 'update', index: 0, patch: { outputVar: 'newname' } })
check('update mutates only target',
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (g.body[0] as any).outputVar === 'newname',
)

g = reduce(g, { type: 'remove', index: 1 })
check('remove deletes', g.body.length === 2)

// Re-set up a fresh small graph to test 'update' precisely.
{
  let g2 = makeEmptyGraph('update-test')
  const lTest = makeLet()
  lTest.varName = 'original'
  g2 = reduce(g2, { type: 'add', node: lTest, index: 0 })
  g2 = reduce(g2, { type: 'update', index: 0, patch: { varName: 'mutated' } })
  const after = g2.body[0]
  check('update mutates target field', after?.type === 'let' && after.varName === 'mutated')
}

// Add with out-of-range indices
{
  let g3 = makeEmptyGraph('clamp')
  const a3 = makeAskUser()
  g3 = reduce(g3, { type: 'add', node: a3, index: -5 })
  check('add clamps negative index to 0', g3.body.length === 1 && g3.body[0]!.id === a3.id)
  const a4 = makeAskUser()
  g3 = reduce(g3, { type: 'add', node: a4, index: 999 })
  check('add clamps over-large index to end', g3.body.length === 2 && g3.body[1]!.id === a4.id)
}

console.log(`\n${failed === 0 ? '✅ ALL REDUCER CHECKS PASSED' : `❌ ${failed} FAILED`}`)
process.exit(failed === 0 ? 0 : 1)
