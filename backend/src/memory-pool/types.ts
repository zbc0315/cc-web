// backend/src/memory-pool/types.ts

export interface GlobalBallOrigin {
  source_project: string;
  source_ball_id: string;
  synced_at: string;
}

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
  diameter?: number;  // Cached token estimate of ball content
  // Global pool only: origin tracking
  origins?: GlobalBallOrigin[];
  orphaned?: boolean;
  pre_orphan_B0?: number;  // B0 before orphan halving, for restoration
}

export interface PoolJson {
  version: number;
  t: number;
  lambda: number;
  alpha: number;
  active_capacity: number;
  surface_width: number;  // Token budget for surface layer (wedge top width)
  next_id: number;
  pool: string;
  initialized_at: string;
  balls: PoolBallMeta[];
  // Tick tracking
  last_tick_at?: string;
  last_tick_session?: string;
  // Project pool only: path to global pool
  global_pool_path?: string;
}

export interface PoolBallWithBuoyancy extends PoolBallMeta {
  buoyancy: number;
}

// ── Global pool types ──

export interface SourceEntry {
  project_id: string;
  project_name: string;
  pool_path: string;
  registered_at: string;
  last_synced_at: string | null;
  status: 'active' | 'unreachable';
  unreachable_count?: number;
}

export interface SourcesJson {
  version: number;
  sources: SourceEntry[];
}

export interface SyncResult {
  added: number;
  updated: number;
  skipped: number;
  orphaned: number;
  unreachable_projects: string[];
  synced_projects: string[];
}
