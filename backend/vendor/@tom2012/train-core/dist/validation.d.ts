/**
 * Runtime validation of fai outputs against their declared schema.
 *
 * Used by the interpreter's fai-call path. If an adapter returns
 * `kind: 'success'`, the runtime validates the payload here before
 * accepting it; mismatches trigger a retry-with-feedback (composing
 * a new prompt that itemizes what went wrong).
 *
 * Adapters with `capabilities.writesWorkflowData = true` (agent CLI)
 * write directly to the project's workflow_data.json; the runtime
 * still re-reads and revalidates so adapter trust isn't unbounded.
 */
import type * as ast from './ast.js';
import type { ValidationErrorItem } from '@tom2012/train-adapter-spec';
import type { Value } from './runtime.js';
export type ValidateValueResult = {
    ok: true;
    value: Value;
} | {
    ok: false;
    message: string;
};
export type ValidateOutputsResult = {
    ok: true;
    outputs: Record<string, Value>;
} | {
    ok: false;
    errors: ValidationErrorItem[];
};
/**
 * Validate a map of raw outputs (as produced by an adapter) against the
 * declared FaiOutput list. Returns either {ok:true, outputs} or
 * {ok:false, errors} suitable for feeding back into a retry prompt.
 */
export declare function validateOutputs(outputDecls: ReadonlyArray<ast.FaiOutput>, raw: Record<string, unknown>): ValidateOutputsResult;
/** Validate a single value against a type annotation. */
export declare function validateValue(v: unknown, type: ast.TypeAnnot): ValidateValueResult;
/**
 * Build a retry-with-feedback prompt body (text appended after the
 * original prompt) explaining which outputs failed validation and what
 * was expected. Used by the interpreter's fai-call retry loop.
 */
export declare function composeRetryFeedback(errors: ValidationErrorItem[], attempt: number, maxAttempts: number): string;
//# sourceMappingURL=validation.d.ts.map