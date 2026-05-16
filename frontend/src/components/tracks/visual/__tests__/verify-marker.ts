// frontend/src/components/tracks/visual/__tests__/verify-marker.ts
import { injectMarker, hasMarker, MARKER_LINE } from '../marker'

let failed = 0
function check(name: string, cond: boolean): void {
  if (cond) console.log(`  ✓ ${name}`)
  else { failed++; console.error(`  ✗ ${name}`) }
}

console.log('=== marker ===')

const body = 'func main() -> any { return 1 }\nexport main\n'
const withMarker = injectMarker(body)
check('injectMarker adds two header lines', withMarker.startsWith(MARKER_LINE + '\n'))
check('injectMarker preserves body', withMarker.endsWith(body))
check('hasMarker true after inject', hasMarker(withMarker))
check('hasMarker false on plain .tr', !hasMarker(body))
check('injectMarker idempotent', injectMarker(withMarker) === withMarker)

console.log(`\n${failed === 0 ? '✅ ALL MARKER CHECKS PASSED' : `❌ ${failed} FAILED`}`)
process.exit(failed === 0 ? 0 : 1)
