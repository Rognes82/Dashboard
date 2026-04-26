-- v1.3 — Whole-note auto-classify
-- Adds: classifier_skip + classifier_attempts on vault_notes;
--       classification_proposals, classification_log, classifier_runs tables.

ALTER TABLE vault_notes ADD COLUMN classifier_skip INTEGER NOT NULL DEFAULT 0;
ALTER TABLE vault_notes ADD COLUMN classifier_attempts INTEGER NOT NULL DEFAULT 0;

CREATE TABLE IF NOT EXISTS classifier_runs (
  id TEXT PRIMARY KEY,
  trigger TEXT NOT NULL,
  started_at INTEGER NOT NULL,
  finished_at INTEGER,
  notes_seen INTEGER NOT NULL DEFAULT 0,
  notes_auto_assigned INTEGER NOT NULL DEFAULT 0,
  notes_auto_created INTEGER NOT NULL DEFAULT 0,
  notes_pending INTEGER NOT NULL DEFAULT 0,
  notes_errored INTEGER NOT NULL DEFAULT 0,
  error_message TEXT
);

CREATE TABLE IF NOT EXISTS classification_proposals (
  id TEXT PRIMARY KEY,
  note_id TEXT NOT NULL REFERENCES vault_notes(id) ON DELETE CASCADE,
  proposed_existing_bin_id TEXT REFERENCES bins(id) ON DELETE CASCADE,
  existing_confidence REAL NOT NULL,
  proposed_new_bin_path TEXT,
  new_bin_rating REAL,
  no_fit_reasoning TEXT,
  reasoning TEXT NOT NULL,
  model TEXT NOT NULL,
  profile_id TEXT NOT NULL,
  run_id TEXT NOT NULL REFERENCES classifier_runs(id) ON DELETE CASCADE,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_proposals_note ON classification_proposals(note_id);
CREATE INDEX IF NOT EXISTS idx_proposals_created ON classification_proposals(created_at);

CREATE TABLE IF NOT EXISTS classification_log (
  id TEXT PRIMARY KEY,
  note_id TEXT REFERENCES vault_notes(id) ON DELETE SET NULL,
  action TEXT NOT NULL,
  bin_id TEXT REFERENCES bins(id) ON DELETE SET NULL,
  new_bin_path TEXT,
  existing_confidence REAL,
  new_bin_rating REAL,
  reasoning TEXT,
  model TEXT,
  profile_id TEXT,
  run_id TEXT REFERENCES classifier_runs(id) ON DELETE SET NULL,
  prior_log_id TEXT REFERENCES classification_log(id),
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_log_note ON classification_log(note_id);
CREATE INDEX IF NOT EXISTS idx_log_action_created ON classification_log(action, created_at);
