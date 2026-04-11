export type ClientStatus = "active" | "paused" | "completed";
export type FileSource = "local" | "gdrive" | "notion";
export type NoteSource = "notion" | "apple_notes" | "obsidian";
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

export interface Note {
  id: string;
  client_id: string | null;
  title: string;
  content_preview: string | null;
  source: NoteSource;
  source_url: string | null;
  tags: string | null;
  modified_at: string | null;
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
}
