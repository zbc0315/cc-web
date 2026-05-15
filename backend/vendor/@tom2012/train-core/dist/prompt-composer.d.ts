/**
 * Compose the full LLM prompt for one fai function call.
 *
 * Default composition layout (spec §3.6):
 *
 *   [System]      Short instruction header.
 *   [Inputs]      Each non-prompt-typed parameter with name(description, type) = value
 *   [Task]        Concatenation of all prompt-typed parameters.
 *   [Outputs]     Each declared output with name(description, type) and the
 *                 wire format the adapter expects (JSON object).
 *   [Adapter hint] Either "JSON object" (direct API) or "modify
 *                 .ccweb/workflow_data.json" (agent CLI), depending on
 *                 the adapter's capabilities.writesWorkflowData flag.
 *
 * Short scalar/bool/number values are formatted inline; arrays/objects
 * and multi-line strings are formatted as fenced blocks.
 *
 * No special handling for `fai` body — the M1 parser already collected
 * the body block (currently empty in 99% of cases). If we add a future
 * "body can compute a custom prompt" feature, this composer will read
 * a `prompt = ...` assignment from the body before defaulting.
 */
import type * as ast from './ast.js';
import type { Value } from './runtime.js';
import type { AdapterCapabilities, FaiInputSpec, FaiOutputSpec } from '@tom2012/train-adapter-spec';
export interface ComposedPrompt {
    text: string;
    inputs: Record<string, FaiInputSpec>;
    outputs: Record<string, FaiOutputSpec>;
}
export interface ComposeOptions {
    capabilities: AdapterCapabilities;
    /** Adapter context for the writesWorkflowData hint. */
    callId?: number;
    /**
     * Override the final "how to write outputs" hint. If provided, this
     * string replaces both the default direct-API ("Respond with JSON ...")
     * hint and the default agent-CLI hint. Hosts that have their own PTY
     * protocol (e.g. ccweb's `variables` + `task_progress.finish` scheme)
     * pass their own protocol text here. The composer still emits the
     * [System] / [Inputs] / [Task] / [Outputs] sections unchanged.
     *
     * The string is appended as a final section verbatim — no quoting,
     * no template interpolation.
     */
    writeProtocolHint?: string;
}
export declare function composePrompt(decl: ast.FaiDecl, argValues: Map<string, Value>, opts: ComposeOptions): ComposedPrompt;
//# sourceMappingURL=prompt-composer.d.ts.map