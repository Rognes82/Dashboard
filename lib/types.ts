export type ClientStatus = "active" | "paused" | "completed";
export type FileSource = "local" | "gdrive" | "notion";
export type VaultNoteSource = "notion" | "obsidian" | "capture" | "apple-notes";
export type AssignedBy = "auto" | "manual" | "agent";
export type AgentType = "cron" | "discord_bot" | "daemon" | "script" | "manual";
export type AgentStatus = "running" | "stopped" | "errored";
export type SyncStatus = "ok" | "error";

export interface Client {
  id: string;
  name: string;
  slug: string;
  status: ClientStatus;
  pipeline_stage: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

export interface Project {
  id: string;
  client_id: string | null;
  name: string;
  path: string;
  repo_url: string | null;
  branch: string | null;
  last_commit_at: string | null;
  last_commit_message: string | null;
  status: "active" | "inactive";
}

export interface FileRecord {
  id: string;
  client_id: string | null;
  project_id: string | null;
  name: string;
  path: string;
  source: FileSource;
  source_url: string | null;
  file_type: string | null;
  size: number | null;
  modified_at: string | null;
}

export interface VaultNote {
  id: string;
  vault_path: string;
  title: string;
  source: VaultNoteSource;
  source_id: string | null;
  source_url: string | null;
  content_hash: string;
  created_at: string;
  modified_at: string;
  last_indexed_at: string;
  deleted_at: string | null;
  client_id: string | null;
  project_id: string | null;
}

export interface Bin {
  id: string;
  name: string;
  parent_bin_id: string | null;
  source_seed: string | null;
  created_at: string;
  sort_order: number;
}

export interface BinNode extends Bin {
  children: BinNode[];
  note_count: number;
}

export interface NoteBin {
  note_id: string;
  bin_id: string;
  assigned_at: string;
  assigned_by: AssignedBy;
}

export interface NoteTag {
  note_id: string;
  tag: string;
}

export interface VaultNoteSearchHit {
  note: VaultNote;
  snippet: string;
  rank: number;
}

export interface Agent {
  id: string;
  name: string;
  type: AgentType;
  schedule: string | null;
  host: string;
  status: AgentStatus;
  last_run_at: string | null;
  last_output: string | null;
  config_path: string | null;
}

export interface ActivityEntry {
  id: string;
  client_id: string | null;
  agent_id: string | null;
  source: string;
  event_type: string;
  title: string;
  detail: string | null;
  timestamp: string;
}

export interface SyncStatusRecord {
  sync_name: string;
  last_run_at: string;
  status: SyncStatus;
  error_message: string | null;
  duration_ms: number | null;
  cursor: string | null;
}
