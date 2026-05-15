/**
 * @tom2012/train-adapter-spec — LLM adapter protocol for train.
 *
 * This package contains ONLY TypeScript type definitions; it has zero
 * runtime dependencies. Every LLM adapter (OpenAI / Anthropic / Ollama /
 * Claude Code / Codex / ccweb / etc.) implements the interfaces here.
 *
 * train's core (@tom2012/train-core) depends on this package and dispatches
 * fai function calls through whatever LLMAdapter is configured at run
 * time. Core itself never makes HTTP requests or spawns processes.
 */
export {};
//# sourceMappingURL=index.js.map