// backend/src/information/types.ts

export interface ConversationMeta {
  jsonl_file: string;     // source JSONL filename (e.g. "abc123.jsonl")
  started_at: string;
  ended_at: string;
  turns: number;
  summary: string;
  original_tokens: number;
  sync_status: 'complete' | 'partial';
  versions: Record<string, VersionEntry>;
  latest: string;
  cohesion_map: Record<string, number | null>;
  expand_stats: ExpandStats;
  reorganize_count: number;
  last_reorganize_at: string | null;
}

export interface VersionEntry {
  file: string;
  tokens: number;
  created_at?: string;
  action?: 'condense' | 'reorganize';
  base?: string;
  high_attention_turns?: string[];
}

export interface ExpandStats {
  total_llm: number;
  total_user: number;
  by_turn: Record<string, number>;
  recent: ExpandRecord[];
}

export interface ExpandRecord {
  from: string;
  to: string;
  at: string;
  source: 'llm' | 'user';
}
