CREATE TABLE IF NOT EXISTS exam_states (
  app_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  state JSONB NOT NULL DEFAULT '{}'::jsonb,
  version BIGINT NOT NULL DEFAULT 1,
  mutation_id TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (app_id, user_id)
);

ALTER TABLE exam_states ADD COLUMN IF NOT EXISTS mutation_id TEXT;

CREATE TABLE IF NOT EXISTS exam_session_states (
  app_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  session_id TEXT NOT NULL,
  state JSONB NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (app_id, user_id, session_id)
);

CREATE INDEX IF NOT EXISTS exam_states_updated_at_idx
  ON exam_states (updated_at DESC);

CREATE INDEX IF NOT EXISTS exam_session_states_updated_at_idx
  ON exam_session_states (app_id, user_id, updated_at DESC);
