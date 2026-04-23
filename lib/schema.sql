CREATE TABLE IF NOT EXISTS clients (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  slug TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL DEFAULT 'active',
  pipeline_stage TEXT,
  notes TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS projects (
  id TEXT PRIMARY KEY,
  client_id TEXT,
  name TEXT NOT NULL,
  path TEXT NOT NULL UNIQUE,
  repo_url TEXT,
  branch TEXT,
  last_commit_at TEXT,
  last_commit_message TEXT,
  status TEXT NOT NULL DEFAULT 'active',
  FOREIGN KEY (client_id) REFERENCES clients(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS files (
  id TEXT PRIMARY KEY,
  client_id TEXT,
  project_id TEXT,
  name TEXT NOT NULL,
  path TEXT NOT NULL,
  source TEXT NOT NULL,
  source_url TEXT,
  file_type TEXT,
  size INTEGER,
  modified_at TEXT,
  FOREIGN KEY (client_id) REFERENCES clients(id) ON DELETE SET NULL,
  FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE SET NULL
);

-- Vault notes — index only. Content lives in markdown files on disk.
CREATE TABLE IF NOT EXISTS vault_notes (
  id TEXT PRIMARY KEY,
  vault_path TEXT UNIQUE NOT NULL,
  title TEXT NOT NULL,
  source TEXT NOT NULL,
  source_id TEXT,
  source_url TEXT,
  content_hash TEXT NOT NULL,
  created_at TEXT NOT NULL,
  modified_at TEXT NOT NULL,
  last_indexed_at TEXT NOT NULL,
  deleted_at TEXT,
  client_id TEXT REFERENCES clients(id) ON DELETE SET NULL,
  project_id TEXT REFERENCES projects(id) ON DELETE SET NULL
);

-- FTS5 search over vault content.
-- STANDALONE table — not tied to vault_notes via external content. The indexer
-- explicitly INSERTs/UPDATEs/DELETEs rows here using the same rowid as the
-- corresponding vault_notes row. snippet() works because the table stores its
-- own copy of title/content/tags.
CREATE VIRTUAL TABLE IF NOT EXISTS vault_notes_fts USING fts5(
  title, content, tags,
  tokenize = 'porter unicode61 remove_diacritics 1'
);

CREATE TABLE IF NOT EXISTS bins (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  parent_bin_id TEXT REFERENCES bins(id) ON DELETE CASCADE,
  source_seed TEXT UNIQUE,
  created_at TEXT NOT NULL,
  sort_order INTEGER DEFAULT 0
);

CREATE TABLE IF NOT EXISTS note_bins (
  note_id TEXT NOT NULL REFERENCES vault_notes(id) ON DELETE CASCADE,
  bin_id TEXT NOT NULL REFERENCES bins(id) ON DELETE CASCADE,
  assigned_at TEXT NOT NULL,
  assigned_by TEXT NOT NULL CHECK (assigned_by IN ('auto', 'manual', 'agent')),
  PRIMARY KEY (note_id, bin_id)
);

CREATE TABLE IF NOT EXISTS note_tags (
  note_id TEXT NOT NULL REFERENCES vault_notes(id) ON DELETE CASCADE,
  tag TEXT NOT NULL,
  PRIMARY KEY (note_id, tag)
);

CREATE TABLE IF NOT EXISTS agents (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  type TEXT NOT NULL,
  schedule TEXT,
  host TEXT NOT NULL DEFAULT 'mac_mini',
  status TEXT NOT NULL DEFAULT 'stopped',
  last_run_at TEXT,
  last_output TEXT,
  config_path TEXT
);

CREATE TABLE IF NOT EXISTS activity (
  id TEXT PRIMARY KEY,
  client_id TEXT,
  agent_id TEXT,
  source TEXT NOT NULL,
  event_type TEXT NOT NULL,
  title TEXT NOT NULL,
  detail TEXT,
  timestamp TEXT NOT NULL,
  FOREIGN KEY (client_id) REFERENCES clients(id) ON DELETE SET NULL,
  FOREIGN KEY (agent_id) REFERENCES agents(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS sync_status (
  sync_name TEXT PRIMARY KEY,
  last_run_at TEXT NOT NULL,
  status TEXT NOT NULL,
  error_message TEXT,
  duration_ms INTEGER,
  cursor TEXT
);

CREATE INDEX IF NOT EXISTS idx_projects_client_id ON projects(client_id);
CREATE INDEX IF NOT EXISTS idx_files_client_id ON files(client_id);
CREATE INDEX IF NOT EXISTS idx_vault_notes_source ON vault_notes(source);
CREATE INDEX IF NOT EXISTS idx_vault_notes_modified ON vault_notes(modified_at);
CREATE INDEX IF NOT EXISTS idx_vault_notes_client ON vault_notes(client_id);
CREATE INDEX IF NOT EXISTS idx_vault_notes_project ON vault_notes(project_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_vault_notes_source_id ON vault_notes(source_id) WHERE source_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_vault_notes_deleted ON vault_notes(deleted_at) WHERE deleted_at IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_bins_parent ON bins(parent_bin_id);
CREATE INDEX IF NOT EXISTS idx_note_bins_note ON note_bins(note_id);
CREATE INDEX IF NOT EXISTS idx_note_bins_bin ON note_bins(bin_id);
CREATE INDEX IF NOT EXISTS idx_note_tags_tag ON note_tags(tag);
CREATE INDEX IF NOT EXISTS idx_activity_timestamp ON activity(timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_activity_client_id ON activity(client_id);
