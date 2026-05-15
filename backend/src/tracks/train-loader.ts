/**
 * Dynamic loader for train-lang (ESM) from ccweb backend (CommonJS).
 *
 * `import('@tom2012/train-core')` is rewritten by ts-node/tsc as `require()`
 * which fails because train-lang is ESM-only. Wrapping the expression in
 * `new Function(...)` defers it past the TS compiler, leaving a native
 * dynamic import at runtime.
 *
 * Single cache for the whole process. Idempotent.
 */

import type { Value, BuiltinFunction } from './types-train'

const dynamicImport = new Function(
  'p',
  'return import(p)',
) as (p: string) => Promise<unknown>

/**
 * Minimal facade over @tom2012/train-core. Only the entry points we use
 * from CJS code are listed; keep the type narrow so we don't leak ESM
 * types across the boundary and so changes to train-lang surface here
 * loudly.
 */
export interface TrainCoreModule {
  makeBuiltin: (
    name: string,
    call: (args: Value[]) => Value | Promise<Value>,
  ) => BuiltinFunction
  runFile: (absPath: string, opts: unknown) => Promise<{
    ok: boolean
    value: unknown
    error?: {
      errorType?: string
      message: string
      code?: string
    }
    lexErrors: ReadonlyArray<unknown>
    parseErrors: ReadonlyArray<unknown>
  }>
  TrainException: new (...args: unknown[]) => Error & {
    errorType: string
    message: string
    code?: string
  }
}

let modPromise: Promise<TrainCoreModule> | null = null

export async function loadTrainCore(): Promise<TrainCoreModule> {
  if (!modPromise) {
    modPromise = dynamicImport('@tom2012/train-core') as Promise<TrainCoreModule>
  }
  return modPromise
}

/**
 * Async wrapper for makeBuiltin — loads train-lang on first call and
 * forwards the rest. Use whenever you need to construct a BuiltinFunction
 * from CommonJS code.
 */
export async function makeBuiltinDynamic(
  name: string,
  call: (args: Value[]) => Value | Promise<Value>,
): Promise<BuiltinFunction> {
  const train = await loadTrainCore()
  return train.makeBuiltin(name, call)
}
