// frontend/src/components/tracks/visual/__tests__/verify-scope.ts
import { scopeAt, scopeCandidates, isVarVisible } from '../scope'
import { makeEmptyGraph, reduce } from '../reducer'
import { makeAskUser, makeFai, makeLet, newItemId } from '../default-nodes'

let failed = 0
function check(name: string, cond: boolean): void {
  if (cond) console.log(`  ✓ ${name}`)
  else { failed++; console.error(`  ✗ ${name}`) }
}

console.log('=== scope ===')

let g = makeEmptyGraph('demo')
const a = makeAskUser()
a.outputVar = 'input'
a.fields = [
  { id: newItemId(), key: 'file_path', label: 'p', type: 'text' },
  { id: newItemId(), key: 'mode',      label: 'm', type: 'enum', variants: ['a', 'b'] },
]
g = reduce(g, { type: 'add', node: a, index: 0 })

const f = makeFai()
f.outputVar = 'r'
f.outputs = [
  { id: newItemId(), name: 'rating', type: 'int' },
  { id: newItemId(), name: 'comment', type: 'string' },
]
g = reduce(g, { type: 'add', node: f, index: 1 })

const l = makeLet()
l.varName = 'tmp'
g = reduce(g, { type: 'add', node: l, index: 2 })

check('scope at 0 is empty', scopeAt(g, 0).length === 0)
check('scope at 1 has input', scopeAt(g, 1).map((e) => e.name).join(',') === 'input')
check('scope at 2 has input,r', scopeAt(g, 2).map((e) => e.name).join(',') === 'input,r')
check('scope at 3 has input,r,tmp', scopeAt(g, 3).map((e) => e.name).join(',') === 'input,r,tmp')

const cands2 = scopeCandidates(g, 2)
check('candidates include input', cands2.includes('input'))
check('candidates include input.file_path', cands2.includes('input.file_path'))
check('candidates include input.mode', cands2.includes('input.mode'))
check('candidates include r at index 2', cands2.includes('r'))
check('candidates include r.rating at index 2', cands2.includes('r.rating'))

check('isVarVisible input.file_path at 1', isVarVisible(g, 1, ['input', 'file_path']))
check('isVarVisible r.rating at 2', isVarVisible(g, 2, ['r', 'rating']))
check('isVarVisible bogus.x rejects', !isVarVisible(g, 2, ['bogus', 'x']))
check('isVarVisible r.unknownField rejects', !isVarVisible(g, 2, ['r', 'unknownField']))

console.log(`\n${failed === 0 ? '✅ ALL SCOPE CHECKS PASSED' : `❌ ${failed} FAILED`}`)
process.exit(failed === 0 ? 0 : 1)
