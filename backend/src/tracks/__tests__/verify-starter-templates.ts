/**
 * Sanity check: the starter .tr templates that the frontend renders into
 * the TracksListDialog (STARTER_BASIC / STARTER_ASK_USER) must:
 *
 *   1. Parse cleanly under @tom2012/train-core (no lex/parse errors).
 *   2. Declare `main` with ZERO parameters. ccweb's run button posts
 *      args=[] (there's no UI to supply arguments), so a starter whose
 *      main takes args fails at runtime with "main() expects N arg(s),
 *      got 0" — exactly the v-15-e bug that wasted user time.
 *   3. For STARTER_BASIC (no __ccweb_ask_user dependency): run main()
 *      end-to-end through a mock LLM adapter and assert ok=true. This
 *      is the strong check — anything that compiles+resolves but
 *      explodes at runtime gets caught here.
 *   4. For STARTER_ASK_USER: parse + main-is-zero-arg only; running it
 *      requires the ccweb-specific __ccweb_ask_user builtin which
 *      train-core doesn't ship.
 *
 * Extracts STARTER_* template literals from TracksListDialog.tsx
 * (single source of truth — do not duplicate the text here).
 *
 * Run:  cd backend && npx tsx src/tracks/__tests__/verify-starter-templates.ts
 */

import * as fs from 'fs'
import * as path from 'path'

// Dynamic imports via `new Function` so tsc/tsx don't rewrite to require()
// — @tom2012/train-* are ESM-only and CJS require() of their subpath
// exports fails with ERR_PACKAGE_PATH_NOT_EXPORTED.
const dynamicImport = new Function('p', 'return import(p)') as <T>(
  p: string,
) => Promise<T>

interface ParserMod {
  parse: (src: string) => {
    lexErrors: { message: string }[]
    parseErrors: { message: string }[]
  }
}

interface CoreMod {
  runSource: (
    src: string,
    config: {
      adapter: unknown
      entry?: string
      args?: unknown[]
      maxFaiAttempts?: number
    },
  ) => Promise<{
    ok: boolean
    value?: unknown
    error?: { message: string; errorType?: string; code?: string }
    lexErrors?: unknown[]
    parseErrors?: unknown[]
  }>
}

const DIALOG_PATH = path.resolve(
  __dirname,
  '../../../../frontend/src/components/tracks/TracksListDialog.tsx',
)

function extractTemplate(source: string, name: string): string {
  const re = new RegExp(`const\\s+${name}\\s*=\\s*\`([\\s\\S]*?)\``)
  const m = source.match(re)
  if (!m) throw new Error(`template ${name} not found in ${DIALOG_PATH}`)
  return m[1]
}

let failed = 0
function ok(name: string): void {
  console.log(`  ✓ ${name}`)
}
function fail(name: string, msg?: string): void {
  failed++
  console.error(`  ✗ ${name}${msg ? ': ' + msg : ''}`)
}

async function main() {
  console.log('Verifying starter .tr templates...')
  const parser = await dynamicImport<ParserMod>('@tom2012/train-core/parser')
  const core = await dynamicImport<CoreMod>('@tom2012/train-core')

  const dialogSrc = fs.readFileSync(DIALOG_PATH, 'utf8')

  // Helper: parse + assert main is 0-arg
  function checkParseAndMainSignature(name: string, body: string): boolean {
    const parsed = parser.parse(body)
    const errCount = parsed.lexErrors.length + parsed.parseErrors.length
    if (errCount > 0) {
      fail(`${name} parses`, `${errCount} error(s)`)
      for (const e of parsed.parseErrors)
        console.error(`      parse: ${e.message}`)
      for (const e of parsed.lexErrors) console.error(`      lex: ${e.message}`)
      return false
    }
    ok(`${name} parses`)

    // Find main decl and verify zero params. buildAst returns a typed
    // AST; we look for a FunctionDecl named 'main' (or whatever the
    // export aliases). Conservatively just check the source matches
    // `func main(` followed by `)` with only whitespace between —
    // train-lang grammar uses a paren list, so this is the literal
    // signature.
    if (!/func\s+main\s*\(\s*\)/.test(body)) {
      fail(
        `${name} main is 0-arg`,
        'starter must be runnable with zero args (ccweb run button posts args=[]). Use __ccweb_ask_user to collect input.',
      )
      return false
    }
    ok(`${name} main is 0-arg`)

    // Export must be exactly `export main` (no `as <alias>`). ccweb's
    // TrackRunner calls train.runFile without an explicit entry, which
    // defaults to 'main' in train-core. Aliasing to anything else
    // (e.g. `export main as literature_search`) makes the entry name
    // unreachable and the run fails with `no export named 'main' found`.
    if (!/^\s*export\s+main\s*$/m.test(body)) {
      fail(
        `${name} exports 'main' (no alias)`,
        "must be exactly `export main` — ccweb's default entry is 'main'; aliasing makes it unreachable",
      )
      return false
    }
    ok(`${name} exports 'main' (no alias)`)
    return true
  }

  // STARTER_BASIC: full end-to-end run through an inline mock adapter.
  // Inlined (not imported from @tom2012/train-adapter-mock) so this
  // script has zero runtime dependencies beyond train-core itself.
  const basic = extractTemplate(dialogSrc, 'STARTER_BASIC')
  if (checkParseAndMainSignature('STARTER_BASIC', basic)) {
    const adapter = {
      name: 'inline-mock',
      version: '0.0.0',
      capabilities: {
        parallel: true,
        cancellation: true,
        writesWorkflowData: false,
      },
      // eslint-disable-next-line @typescript-eslint/require-await
      async call(_req: unknown) {
        return {
          kind: 'success',
          outputs: {
            message: '工作轨是 ccweb 中的可视化任务编排子系统。',
          },
        }
      },
    }
    const result = await core.runSource(basic, { adapter, args: [] })
    if (!result.ok) {
      fail(
        'STARTER_BASIC runs with mock adapter',
        result.error
          ? `${result.error.errorType ?? 'Error'}: ${result.error.message}`
          : 'unknown failure',
      )
    } else {
      ok('STARTER_BASIC runs with mock adapter')
    }
  }

  // STARTER_ASK_USER: parse + signature only (needs __ccweb_ask_user).
  const askUser = extractTemplate(dialogSrc, 'STARTER_ASK_USER')
  checkParseAndMainSignature('STARTER_ASK_USER', askUser)
  // Quick existence check that the template uses __ccweb_ask_user
  // intentionally — otherwise it should be runnable in this script too.
  if (!askUser.includes('__ccweb_ask_user')) {
    fail(
      'STARTER_ASK_USER uses __ccweb_ask_user',
      'template named ASK_USER but does not call it',
    )
  } else {
    ok('STARTER_ASK_USER uses __ccweb_ask_user')
  }

  if (failed > 0) {
    console.error(`\n${failed} check(s) failed`)
    process.exit(1)
  }
  console.log('\nAll starter template checks passed.')
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
