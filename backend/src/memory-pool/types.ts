// backend/src/memory-pool/types.ts

export interface PoolBallMeta {
  id: string;
  type: 'user' | 'feedback' | 'project' | 'reference';
  summary: string;
  B0: number;
  H: number;
  t_last: number;
  hardness: number;
  permanent: boolean;
  links: string[];
  created_at: string;
}

export interface PoolJson {
  version: number;
  t: number;
  lambda: number;
  alpha: number;
  active_capacity: number;
  next_id: number;
  pool: string;
  initialized_at: string;
  balls: PoolBallMeta[];
}

export interface PoolBallWithBuoyancy extends PoolBallMeta {
  buoyancy: number;
}
