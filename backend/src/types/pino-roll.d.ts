// Minimal ambient declaration for pino-roll (no upstream @types package).
// pino-roll default export is an async factory returning a SonicBoom stream.
declare module 'pino-roll' {
  import type { DestinationStream } from 'pino';

  interface PinoRollLimit {
    count?: number;
    removeOtherLogFiles?: boolean;
  }

  interface PinoRollOptions {
    file: string | (() => string);
    size?: string | number;
    frequency?: 'daily' | 'hourly' | number;
    extension?: string;
    dateFormat?: string;
    symlink?: boolean;
    limit?: PinoRollLimit;
    mkdir?: boolean;
    // SonicBoom passthrough:
    mode?: number;
    sync?: boolean;
  }

  interface PinoRollStream extends DestinationStream {
    /** Blocks until buffered data is written to fd — required for fatal handlers. */
    flushSync(): void;
    end(): void;
  }

  function pinoRoll(options: PinoRollOptions): Promise<PinoRollStream>;
  export default pinoRoll;
}
