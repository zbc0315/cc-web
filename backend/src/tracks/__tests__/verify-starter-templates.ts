/**
 * Sanity check: the starter .tr templates that the frontend renders into
 * the TracksListDialog (STARTER_BASIC / STARTER_ASK_USER) must parse
 * cleanly under @tom2012/train-core. v-15-d shipped templates whose
 * return type was `-> object {` — `object` is a structural-type keyword
 * that requires `{ field: T, ... }` field syntax, so the parser misread
 * the function body as object fields and rejected `let` as not an
 * Identifier. The track started and finished in <10ms with status=failed.
 *
 * This script extracts the two STARTER_* template literals from
 * TracksListDialog.tsx (single source of truth — do not duplicate the
 * text here) and runs the train parser on each.
 *
 * Run:  cd backend && npx ts-node src/tracks/__tests__/verify-starter-templates.ts
 */

import * as fs from 'fs'
import * as path from 'path'

// Dynamic import via `new Function` so tsc/tsx don't rewrite to require()
// — @tom2012/train-core is ESM-only and CJS require() of its subpath
// exports fails with ERR_PACKAGE_PATH_NOT_EXPORTED.
const dynamicImport = new Function('p', 'return import(p)') as (
  p: string,
) => Promise<{ parse: (src: string) => { lexErrors: { message: string }[]; parseErrors: { message: string }[] } }>

let parseFn: (src: string) => { lexErrors: { message: string }[]; parseErrors: { message: string }[] }

const DIALOG_PATH = path.resolve(
  __dirname,
  '../../../../frontend/src/components/tracks/TracksListDialog.tsx',
)

function extractTemplate(source: string, name: string): string {
  // Match: const NAME = `...` (template literal, allowing newlines)
  const re = new RegExp(`const\\s+${name}\\s*=\\s*\`([\\s\\S]*?)\``)
  const m = source.match(re)
  if (!m) throw new Error(`template ${name} not found in ${DIALOG_PATH}`)
  return m[1]
}

let failed = 0
function checkParses(name: string, body: string): void {
  const result = parseFn(body)
  const errCount = result.lexErrors.length + result.parseErrors.length
  if (errCount === 0) {
    console.log(`  ✓ ${name} parses cleanly`)
  } else {
    failed++
    console.error(`  ✗ ${name}: ${errCount} error(s)`)
    for (const e of result.parseErrors)
      console.error(`      parse: ${e.message}`)
    for (const e of result.lexErrors)
      console.error(`      lex: ${e.message}`)
  }
}

async function main() {
  console.log('Verifying starter .tr templates parse under train-lang...')
  const mod = await dynamicImport('@tom2012/train-core/parser')
  parseFn = mod.parse
  const dialogSrc = fs.readFileSync(DIALOG_PATH, 'utf8')
  checkParses('STARTER_BASIC', extractTemplate(dialogSrc, 'STARTER_BASIC'))
  checkParses(
    'STARTER_ASK_USER',
    extractTemplate(dialogSrc, 'STARTER_ASK_USER'),
  )
  if (failed > 0) {
    console.error(`\n${failed} template(s) failed`)
    process.exit(1)
  }
  console.log('\nAll starter templates parse OK.')
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
