/**
 * Module loader (M5).
 *
 * Resolves `import { x } from "./y"` against the filesystem, parses
 * each imported file, executes its top-level once, and exposes its
 * `export`-ed names back to the importing module.
 *
 * Properties:
 *   - relative paths only in M5 (`./y`, `../y`, with implicit `.tr`)
 *   - module cache: same absolute path executes top-level exactly once
 *   - circular import detection (E0501): tracked via a re-entry set
 *   - shared adapter + builtins: child modules use the same adapter
 *     instance as the importer (no ask-user / cancellation re-plumbing)
 *
 * Not yet supported (deferred to later milestones):
 *   - namespace imports (`import * as m from "..."`)
 *   - version tags (`@v1.0.0` on import) — parsed but ignored
 *   - absolute / package imports (`@scope/name`)
 *   - workflow_data isolation per submodule (uses host stateDir)
 */
import type * as ast from './ast.js';
import { type RuntimeContext, type Value } from './runtime.js';
export interface ModuleInstance {
    /** Absolute path of the module source file. */
    absPath: string;
    /** Map of exported (external) name → runtime value. */
    exports: Map<string, Value>;
    /** The RuntimeContext built during this module's top-level execution. */
    ctx: RuntimeContext;
}
export interface ModuleLoaderHooks {
    /** Resolve a `from "..."` spec against an importer's abs path. */
    resolve?(spec: string, importerAbs: string): string;
    /** Read source for an abs path. Default: fs.readFile utf8. */
    read?(absPath: string): Promise<string>;
}
/**
 * Build a fresh ModuleRegistry for a single `train run`. The registry
 * lives for one runProgram call; subsequent runs start fresh.
 */
export interface ModuleRegistry {
    /** Load (or hit cache for) a module at the given absolute path. */
    load(absPath: string, importerStack: string[]): Promise<ModuleInstance>;
    /** Resolve `spec` relative to `importerAbs` to an absolute path. */
    resolve(spec: string, importerAbs: string): string;
    /** Register a module instance (used after host has executed top level). */
    set(absPath: string, instance: ModuleInstance): void;
    /** Read a not-yet-cached source file. */
    read(absPath: string): Promise<string>;
    /** True if path is currently being loaded (re-entry → cycle). */
    isInProgress(absPath: string): boolean;
    markInProgress(absPath: string): void;
    unmarkInProgress(absPath: string): void;
    hasCached(absPath: string): boolean;
    getCached(absPath: string): ModuleInstance | undefined;
}
export declare function createModuleRegistry(hooks?: ModuleLoaderHooks): ModuleRegistry;
/**
 * Apply an Import declaration's specs to the importing module's
 * RuntimeContext, given the loaded child module instance.
 *
 * In M5 we inject imported symbols into the importer's
 * `constants` (for const exports), `globals` (for var exports), or
 * `functions` (for func / fai exports). The interpreter's identifier
 * lookup already consults these three maps in lexical order, so an
 * imported `foo` is visible just like a top-level `foo`.
 *
 * Throws ImportSymbolMissing if the import names a symbol the module
 * does not export.
 */
export declare function applyImport(imp: ast.Import, child: ModuleInstance, importerCtx: RuntimeContext): void;
/** Build the export map for a module from its executed RuntimeContext. */
export declare function collectExports(ctx: RuntimeContext): Map<string, Value>;
//# sourceMappingURL=module-loader.d.ts.map