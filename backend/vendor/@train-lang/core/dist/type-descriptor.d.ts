/**
 * Convert AST type annotations to the adapter-spec runtime descriptor.
 *
 * The descriptor is the wire format adapters consume: it's
 * JSON-serialisable, source-location-free, and contains everything an
 * adapter needs to build a structured-output schema (JSON Schema /
 * OpenAI tool params / Anthropic tool_use / etc.).
 */
import type * as ast from './ast.js';
import type { TrainTypeDescriptor } from '@train-lang/adapter-spec';
export declare function typeToDescriptor(t: ast.TypeAnnot): TrainTypeDescriptor;
/** Returns true if the leaf scalar type name is `prompt`. */
export declare function isPromptType(t: ast.TypeAnnot): boolean;
/** Returns true if a name is a recognised leaf type at the type-position. */
export declare function isLeafTypeName(name: string): boolean;
/** Render a TrainTypeDescriptor as a short human/LLM-readable string. */
export declare function describeType(t: TrainTypeDescriptor): string;
//# sourceMappingURL=type-descriptor.d.ts.map