CREATE TABLE IF NOT EXISTS exam_states (
  app_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  state JSONB NOT NULL DEFAULT '{}'::jsonb,
  version BIGINT NOT NULL DEFAULT 1,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (app_id, user_id)
);

CREATE INDEX IF NOT EXISTS exam_states_updated_at_idx
  ON exam_states (updated_at DESC);
