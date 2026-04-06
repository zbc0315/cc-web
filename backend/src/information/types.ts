// backend/src/information/types.ts

export interface ConversationMeta {
  session: string;
  started_at: string;
  ended_at: string;
  turns: number;
  summary: string;
  original_tokens: number;
  sync_status: 'complete' | 'partial';
  versions: Record<string, VersionEntry>;
  latest: string; // e.g. "v0", "v1", "v2"
  cohesion_map: Record<string, number | null>; // turn → cohesion score
  expand_stats: ExpandStats;
  reorganize_count: number;
  last_reorganize_at: string | null;
}

export interface VersionEntry {
  file: string;
  tokens: number;
  created_at?: string;
  action?: 'condense' | 'reorganize';
  base?: string; // which version this was derived from
  high_attention_turns?: string[]; // for reorganize
}

export interface ExpandStats {
  total_llm: number;
  total_user: number;
  by_turn: Record<string, number>; // only llm source
  recent: ExpandRecord[]; // max 50, FIFO
}

export interface ExpandRecord {
  from: string; // version expanded from
  to: string;   // version expanded to
  at: string;   // ISO timestamp
  source: 'llm' | 'user';
}

export interface ConversationIndex {
  version: number;
  conversations: string[]; // just IDs
}
