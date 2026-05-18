/**
 * AskUserBridge — bridges train-lang's host builtin call to the ccweb
 * frontend.
 *
 * Flow:
 *   1. .tr code calls `__ccweb_ask_user({ fields: [...] })`
 *   2. train evaluates this as a builtin → call our bridge.requestInput()
 *   3. bridge pushes a "track_ask_user" event (via onPush callback)
 *      to the WebSocket layer, which broadcasts to the frontend
 *   4. frontend renders a form, user submits → POST /api/.../tracks/input
 *   5. route handler calls bridge.submitInput(runId, requestId, data)
 *   6. bridge resolves the pending Promise → train continues
 *
 * The bridge maintains one pending request per runId. Concurrent
 * ask_user calls within one track would queue (only the most recent
 * pending request is active). For T1 this is fine; multi-prompt would
 * need a queue (T2+).
 *
 * Cancellation: AbortSignal aborts the pending request immediately,
 * rejecting the Promise with a TrainException-shaped error.
 */

// Minimal local type aliases — these mirror @tom2012/train-core's public
// surface types. When train-core is re-introduced in M1 these can be
// replaced with `import type { Value, BuiltinFunction } from '@tom2012/train-core'`.
export type Value = unknown
export interface BuiltinFunction {
  readonly __kind: 'builtin'
  readonly name: string
  call(args: Value[]): Value | Promise<Value>
}

const _dynamicImport = new Function('p', 'return import(p)') as (
  p: string,
) => Promise<unknown>

async function makeBuiltinDynamic(
  name: string,
  call: (args: Value[]) => Value | Promise<Value>,
): Promise<BuiltinFunction> {
  const train = (await _dynamicImport('@tom2012/train-core')) as {
    makeBuiltin: (
      n: string,
      fn: (args: Value[]) => Value | Promise<Value>,
    ) => BuiltinFunction
  }
  return train.makeBuiltin(name, call)
}

export interface AskUserFieldSpec {
  key: string
  label: string
  type: 'text' | 'enum' | 'number' | 'bool'
  variants?: string[] // required when type === 'enum'
  placeholder?: string
  required?: boolean
}

export interface AskUserRequest {
  runId: string
  requestId: string
  fields: AskUserFieldSpec[]
}

export interface AskUserPushEvent extends AskUserRequest {
  kind: 'track_ask_user'
}

export type AskUserPushFn = (event: AskUserPushEvent) => void

export interface AskUserBridge {
  /** Called from the builtin when train evaluates __ccweb_ask_user(...). */
  requestInput(
    runId: string,
    spec: AskUserFieldSpec[],
    signal?: AbortSignal,
  ): Promise<Record<string, Value>>

  /** Called from the route handler when the user submits the form. */
  submitInput(
    runId: string,
    requestId: string,
    data: Record<string, Value>,
  ): { ok: boolean; message?: string }

  /** Reject all pending requests for a runId (e.g. on track cancel). */
  cancelAllForRun(runId: string, reason?: string): void

  /** For diagnostics + tests. */
  getPending(runId: string): AskUserRequest | null
}

interface PendingRequest {
  request: AskUserRequest
  resolve: (data: Record<string, Value>) => void
  reject: (err: Error) => void
  signalHandler?: () => void
  signal?: AbortSignal
}

function detachSignal(entry: PendingRequest): void {
  if (entry.signal && entry.signalHandler) {
    entry.signal.removeEventListener('abort', entry.signalHandler)
    entry.signalHandler = undefined
  }
}

export function createAskUserBridge(onPush: AskUserPushFn): AskUserBridge {
  const pending = new Map<string, PendingRequest>() // runId → PendingRequest

  function newRequestId(): string {
    return 'req-' + Math.random().toString(36).slice(2, 10)
  }

  function validateSpec(spec: AskUserFieldSpec[]): void {
    if (!Array.isArray(spec) || spec.length === 0) {
      throw new Error('ask_user requires a non-empty fields array')
    }
    const seen = new Set<string>()
    for (const f of spec) {
      if (!f.key || typeof f.key !== 'string') {
        throw new Error('ask_user field missing string key')
      }
      if (seen.has(f.key)) {
        throw new Error(`ask_user duplicate field key: ${f.key}`)
      }
      seen.add(f.key)
      if (f.type === 'enum' && (!f.variants || f.variants.length === 0)) {
        throw new Error(`ask_user enum field "${f.key}" missing variants`)
      }
    }
  }

  function validateResponse(
    spec: AskUserFieldSpec[],
    data: Record<string, Value>,
  ): { ok: true } | { ok: false; message: string } {
    for (const f of spec) {
      const v = data[f.key]
      if (v === undefined && f.required !== false) {
        return { ok: false, message: `missing required field: ${f.key}` }
      }
      if (v === undefined) continue
      switch (f.type) {
        case 'text':
          if (typeof v !== 'string') {
            return { ok: false, message: `${f.key}: expected string` }
          }
          break
        case 'number':
          if (typeof v !== 'number') {
            return { ok: false, message: `${f.key}: expected number` }
          }
          break
        case 'bool':
          if (typeof v !== 'boolean') {
            return { ok: false, message: `${f.key}: expected boolean` }
          }
          break
        case 'enum':
          if (typeof v !== 'string' || !f.variants?.includes(v)) {
            return {
              ok: false,
              message: `${f.key}: must be one of [${f.variants?.join(', ') ?? ''}]`,
            }
          }
          break
      }
    }
    return { ok: true }
  }

  return {
    requestInput(runId, spec, signal) {
      validateSpec(spec)
      return new Promise<Record<string, Value>>((resolve, reject) => {
        // If a previous request for this runId is still pending,
        // detach its abort listener BEFORE rejecting + replacing.
        // Otherwise an abort on the old signal would `pending.delete(runId)`
        // and clobber the new request.
        const existing = pending.get(runId)
        if (existing) {
          detachSignal(existing)
          pending.delete(runId)
          existing.reject(new Error('superseded by new ask_user request'))
        }
        const request: AskUserRequest = {
          runId,
          requestId: newRequestId(),
          fields: spec,
        }
        const entry: PendingRequest = { request, resolve, reject, signal }
        if (signal) {
          if (signal.aborted) {
            reject(new Error('ask_user cancelled'))
            return
          }
          // The handler validates that THIS entry is still the active one
          // before mutating the map (defense in depth — supersede path above
          // already detaches, but a separate abort + supersede race could
          // still try to fire stale handlers).
          entry.signalHandler = () => {
            const current = pending.get(runId)
            if (current === entry) {
              pending.delete(runId)
              reject(new Error('ask_user cancelled'))
            }
          }
          signal.addEventListener('abort', entry.signalHandler, { once: true })
        }
        pending.set(runId, entry)
        onPush({ kind: 'track_ask_user', ...request })
      })
    },

    submitInput(runId, requestId, data) {
      const entry = pending.get(runId)
      if (!entry) {
        return { ok: false, message: `no pending ask_user for runId=${runId}` }
      }
      if (entry.request.requestId !== requestId) {
        return {
          ok: false,
          message: `requestId mismatch (expected ${entry.request.requestId}, got ${requestId})`,
        }
      }
      const v = validateResponse(entry.request.fields, data)
      if (!v.ok) return v
      pending.delete(runId)
      detachSignal(entry)
      entry.resolve(data)
      return { ok: true }
    },

    cancelAllForRun(runId, reason = 'cancelled') {
      const entry = pending.get(runId)
      if (!entry) return
      pending.delete(runId)
      detachSignal(entry)
      entry.reject(new Error(`ask_user ${reason}`))
    },

    getPending(runId) {
      return pending.get(runId)?.request ?? null
    },
  }
}

/**
 * Build the `__ccweb_ask_user` builtin function bound to this run's
 * bridge + AbortSignal. Pass into TrainOptions.extraBuiltins.
 */
export async function createAskUserBuiltin(
  bridge: AskUserBridge,
  runId: string,
  signal?: AbortSignal,
): Promise<BuiltinFunction> {
  return makeBuiltinDynamic('__ccweb_ask_user', async (args: Value[]) => {
    // args[0] is the spec object passed from .tr:
    //   __ccweb_ask_user({ fields: [...] })
    const arg = args[0] as { fields?: AskUserFieldSpec[] } | null
    if (!arg || typeof arg !== 'object') {
      throw new Error(
        '__ccweb_ask_user expects 1 argument: { fields: [...] }',
      )
    }
    const fields = arg.fields
    if (!Array.isArray(fields)) {
      throw new Error('__ccweb_ask_user spec.fields must be an array')
    }
    const result = await bridge.requestInput(runId, fields, signal)
    return result as unknown as Value
  })
}
