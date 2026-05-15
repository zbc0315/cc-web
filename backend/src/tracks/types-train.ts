/**
 * Re-export train-lang types for CommonJS consumers.
 *
 * train-lang is ESM-only, so direct `import { Value } from '@train-lang/core'`
 * in ts-node CJS mode is risky (TS sometimes resolves types fine, but
 * isolatedModules / module resolution corner cases can break it).
 *
 * Using `import type` here is purely a compile-time alias — the import
 * is fully erased at JS emit, so no runtime require() is generated.
 */

export type {
  Value,
  BuiltinFunction,
  TrainException,
  RuntimeContext,
} from '@train-lang/core'
