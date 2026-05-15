/**
 * AST cache (spec §4.5).
 *
 * Persist parsed AST to `<stateDir>/ast/<relativeFile>.ast.json` keyed by
 * sha256(source) + compilerVersion. On reload, verify both — if either
 * mismatches, return null and the caller re-parses.
 *
 * The cache file is plain JSON (no functions, no circular refs). All
 * train AST nodes are plain objects with primitive leaves + Range info,
 * so JSON.stringify is lossless.
 *
 * `normalizeForCache` strips fields that vary between runs (range,
 * future __id, etc.) so two ASTs of the same source can be compared
 * for equivalence by deep-equal of their normalized forms.
 */
import type * as ast from './ast.js';
/** Bump whenever AST shape changes — invalidates all caches. */
export declare const AST_CACHE_VERSION = "train-core-0.1.0";
export interface AstCacheRecord {
    sourceFile: string;
    sourceHash: string;
    compilerVersion: string;
    compiledAt: string;
    ast: ast.Program;
}
/** Compute the cache key for a source string. */
export declare function sourceHash(source: string): string;
/** Resolve cache file path under stateDir. */
export declare function cacheFilePath(stateDir: string, relSourceFile: string): string;
/**
 * Save AST to cache file. Atomic: write to tmp then rename.
 * Creates parent dirs as needed. Throws on filesystem errors.
 */
export declare function saveCache(cachePath: string, record: AstCacheRecord): Promise<void>;
/**
 * Load AST from cache file. Returns null if:
 *  - file does not exist
 *  - file is corrupt / not valid JSON / missing fields
 *  - sourceHash does not match the caller's expected hash
 *  - compilerVersion does not match AST_CACHE_VERSION
 *
 * Never throws on cache miss — caller should re-parse on null.
 */
export declare function loadCache(cachePath: string, expectedHash: string, expectedCompilerVersion?: string): Promise<AstCacheRecord | null>;
export declare function normalizeForCache(node: unknown): unknown;
/**
 * High-level facade: parse with cache.
 *
 * If a valid cached AST exists, return it. Otherwise call `parseFresh`,
 * save the result to cache, and return it.
 *
 * `parseFresh` returns the AST plus any errors. Cache only on no-error.
 */
export interface ParseWithCacheResult {
    ast: ast.Program | null;
    source: string;
    fromCache: boolean;
    /** Hash of source used for cache lookup. */
    hash: string;
    /** Any error from parseFresh, if cache was missed. */
    lexErrors: ReadonlyArray<unknown>;
    parseErrors: ReadonlyArray<unknown>;
}
export declare function parseWithCache(opts: {
    source: string;
    sourceFile: string;
    stateDir: string;
    parseFresh: (src: string) => {
        ast: ast.Program | null;
        lexErrors: ReadonlyArray<unknown>;
        parseErrors: ReadonlyArray<unknown>;
    };
}): Promise<ParseWithCacheResult>;
//# sourceMappingURL=ast-cache.d.ts.map