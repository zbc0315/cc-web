import { terminalManager as _tm } from './terminal-manager'

/**
 * Re-export the terminal-manager singleton for modules that cannot import
 * from index.ts without creating circular dependencies.
 *
 * Real injection API: writeRaw(projectId, data)
 */
export { _tm as terminalManager }
