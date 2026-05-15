/**
 * Dynamic loader for train-lang (ESM) from ccweb backend (CommonJS).
 *
 * `import('@train-lang/core')` is rewritten by ts-node/tsc as `require()`
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

interface TrainCoreModule {
  makeBuiltin: (
    name: string,
    call: (args: Value[]) => Value | Promise<Value>,
  ) => BuiltinFunction
  // Other entry points used elsewhere in tracks/ go here as needed.
  // Keep the type minimal to avoid leaking ESM types across the CJS boundary.
}

let modPromise: Promise<TrainCoreModule> | null = null

export async function loadTrainCore(): Promise<TrainCoreModule> {
  if (!modPromise) {
    modPromise = dynamicImport('@train-lang/core') as Promise<TrainCoreModule>
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
