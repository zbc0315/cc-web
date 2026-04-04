// backend/src/memory-pool/pool-lock.ts
// Per-project Promise-chain mutex for serializing pool.json writes.

const locks = new Map<string, Promise<void>>();

export function withPoolLock<T>(poolDir: string, fn: () => T): Promise<T> {
  const prev = locks.get(poolDir) ?? Promise.resolve();

  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const resultPromise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });

  const next = prev.then(() => {
    try {
      const result = fn();
      if (result instanceof Promise) {
        return (result as Promise<unknown>).then(
          (v) => resolve(v as T),
          (e) => reject(e),
        );
      }
      resolve(result);
    } catch (e) {
      reject(e);
    }
  });

  // Keep chain alive (swallow rejections so next caller can proceed)
  const chain = next.catch(() => {});
  locks.set(poolDir, chain);
  chain.then(() => { if (locks.get(poolDir) === chain) locks.delete(poolDir); });

  return resultPromise;
}
