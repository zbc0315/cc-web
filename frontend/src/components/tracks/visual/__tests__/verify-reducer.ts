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

// Duplicate auto-unique outputVar (P0 #4 fix)
{
  let g4 = makeEmptyGraph('dup-test')
  const a1 = makeAskUser()
  a1.outputVar = 'foo'
  g4 = reduce(g4, { type: 'add', node: a1, index: 0 })
  g4 = reduce(g4, { type: 'duplicate', index: 0 })
  check('duplicate produces 2 nodes', g4.body.length === 2)
  check('first kept name foo',
    g4.body[0]!.type === 'ask_user' && (g4.body[0] as typeof a1).outputVar === 'foo')
  check('clone got foo_2',
    g4.body[1]!.type === 'ask_user' && (g4.body[1] as typeof a1).outputVar === 'foo_2')
  // Third duplicate from index 0 should get foo_3
  g4 = reduce(g4, { type: 'duplicate', index: 0 })
  const third = g4.body[1]  // duplicate inserts at sourceIndex+1
  check('third clone got foo_3',
    third?.type === 'ask_user' && (third as typeof a1).outputVar === 'foo_3')
}

// Duplicated ask_user has fresh field ids
{
  let g5 = makeEmptyGraph('field-id-test')
  const a = makeAskUser()
  // makeAskUser default has one field; check it has an id
  check('default field has id', typeof a.fields[0]!.id === 'string' && a.fields[0]!.id.length > 0)
  g5 = reduce(g5, { type: 'add', node: a, index: 0 })
  g5 = reduce(g5, { type: 'duplicate', index: 0 })
  const cloneField = g5.body[1]?.type === 'ask_user' ? g5.body[1].fields[0] : null
  check('clone field has fresh id', cloneField !== null && cloneField!.id !== a.fields[0]!.id)
}

console.log(`\n${failed === 0 ? '✅ ALL REDUCER CHECKS PASSED' : `❌ ${failed} FAILED`}`)
process.exit(failed === 0 ? 0 : 1)
