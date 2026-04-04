// backend/src/memory-pool/buoyancy.ts

export function computeBuoyancy(
  B0: number,
  H: number,
  alpha: number,
  lambda: number,
  t: number,
  t_last: number,
  permanent: boolean,
): number {
  const base = B0 + alpha * H;
  if (permanent) return Math.round(base * 100) / 100;
  const decay = Math.pow(lambda, Math.max(0, t - t_last));
  return Math.round(base * decay * 100) / 100;
}
