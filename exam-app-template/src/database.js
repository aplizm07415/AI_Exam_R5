const { content } = require("./content");
const { randomUUID } = require("node:crypto");

let schemaPromise = null;
let neonClient = null;

function connection() {
  if (!process.env.DATABASE_URL) return null;
  if (!neonClient) ({ neon: neonClient } = require("@neondatabase/serverless"));
  return neonClient(process.env.DATABASE_URL);
}

function databaseConfigured() {
  return Boolean(process.env.DATABASE_URL);
}

function userId() {
  return String(process.env.APP_USER_ID || "owner").slice(0, 128);
}

async function ensureSchema(sql) {
  if (!schemaPromise) {
    schemaPromise = (async () => {
      await sql`
        CREATE TABLE IF NOT EXISTS exam_states (
          app_id TEXT NOT NULL,
          user_id TEXT NOT NULL,
          state JSONB NOT NULL DEFAULT '{}'::jsonb,
          version BIGINT NOT NULL DEFAULT 1,
          mutation_id TEXT,
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          PRIMARY KEY (app_id, user_id)
        )
      `;
      await sql`ALTER TABLE exam_states ADD COLUMN IF NOT EXISTS mutation_id TEXT`;
      await sql`
        CREATE TABLE IF NOT EXISTS exam_session_states (
          app_id TEXT NOT NULL,
          user_id TEXT NOT NULL,
          session_id TEXT NOT NULL,
          state JSONB NOT NULL,
          updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          PRIMARY KEY (app_id, user_id, session_id)
        )
      `;
      await sql`
        CREATE INDEX IF NOT EXISTS exam_states_updated_at_idx
        ON exam_states (updated_at DESC)
      `;
      await sql`
        CREATE INDEX IF NOT EXISTS exam_session_states_updated_at_idx
        ON exam_session_states (app_id, user_id, updated_at DESC)
      `;
    })().catch((error) => {
      schemaPromise = null;
      throw error;
    });
  }
  await schemaPromise;
}

function compactState(state = {}) {
  const { sessions, results, attempts, recent, mockResults, ...snapshot } = state;
  const plan = snapshot.plan ? { ...snapshot.plan } : undefined;
  if (plan) delete plan.autoCompleted;
  return plan ? { ...snapshot, plan } : snapshot;
}

async function writeState(sql, state, options = {}) {
  const expectedVersion = Math.max(0, Number(options.expectedVersion) || 0);
  const sessions = Array.isArray(options.sessions) ? options.sessions.filter((item) => item?.id) : [];
  const deletedSessionIds = Array.isArray(options.deletedSessionIds) ? options.deletedSessionIds.filter(Boolean) : [];
  const mutationId = randomUUID();
  const serialized = JSON.stringify(compactState(state));
  const serializedSessions = JSON.stringify(sessions);
  const serializedDeleted = JSON.stringify(deletedSessionIds);
  const appId = content.exam.id;
  const owner = userId();

  const queries = [sql`
    INSERT INTO exam_states (app_id, user_id, state, version, mutation_id)
    VALUES (${appId}, ${owner}, ${serialized}::jsonb, 1, ${mutationId})
    ON CONFLICT (app_id, user_id) DO UPDATE SET
      state = EXCLUDED.state,
      version = exam_states.version + 1,
      mutation_id = EXCLUDED.mutation_id,
      updated_at = NOW()
    WHERE exam_states.version = ${expectedVersion}
    RETURNING version, updated_at
  `];

  if (sessions.length) {
    queries.push(sql`
      INSERT INTO exam_session_states (app_id, user_id, session_id, state, updated_at)
      SELECT ${appId}, ${owner}, value->>'id', value, NOW()
      FROM jsonb_array_elements(${serializedSessions}::jsonb) AS value
      WHERE value ? 'id'
        AND EXISTS (
          SELECT 1 FROM exam_states
          WHERE app_id = ${appId} AND user_id = ${owner} AND mutation_id = ${mutationId}
        )
      ON CONFLICT (app_id, user_id, session_id) DO UPDATE SET
        state = EXCLUDED.state,
        updated_at = NOW()
    `);
  }
  if (deletedSessionIds.length) {
    queries.push(sql`
      DELETE FROM exam_session_states
      WHERE app_id = ${appId} AND user_id = ${owner}
        AND session_id IN (SELECT jsonb_array_elements_text(${serializedDeleted}::jsonb))
        AND EXISTS (
          SELECT 1 FROM exam_states
          WHERE app_id = ${appId} AND user_id = ${owner} AND mutation_id = ${mutationId}
        )
    `);
  }

  const results = await sql.transaction(queries);
  const saved = results[0];
  if (!saved.length) return { configured: true, conflict: true };
  return { configured: true, version: Number(saved[0].version), updatedAt: saved[0].updated_at };
}

async function getState() {
  const sql = connection();
  if (!sql) return { configured: false, exists: false, state: null };
  await ensureSchema(sql);
  const rows = await sql`
    SELECT state, version, updated_at FROM exam_states
    WHERE app_id = ${content.exam.id} AND user_id = ${userId()} LIMIT 1
  `;
  if (!rows.length) return { configured: true, exists: false, state: null, version: 0, updatedAt: null };
  let snapshot = rows[0].state || {};
  let version = Number(rows[0].version);
  let sessions = await sql`
    SELECT state FROM exam_session_states
    WHERE app_id = ${content.exam.id} AND user_id = ${userId()}
    ORDER BY updated_at, session_id
  `;

  // 旧版の巨大JSONは初回読込時にセッション行へ分割して移行する。
  if (!sessions.length && Array.isArray(snapshot.sessions) && snapshot.sessions.length) {
    const legacySessions = snapshot.sessions;
    const migrated = await writeState(sql, compactState(snapshot), {
      expectedVersion: version,
      sessions: legacySessions
    });
    if (!migrated.conflict) version = migrated.version;
    sessions = legacySessions.map((state) => ({ state }));
    snapshot = compactState(snapshot);
  }

  return {
    configured: true,
    exists: true,
    state: { ...snapshot, sessions: sessions.map((row) => row.state) },
    version,
    updatedAt: rows[0].updated_at,
    storage: "split"
  };
}

async function saveState(state, options = {}) {
  const sql = connection();
  if (!sql) return { configured: false };
  await ensureSchema(sql);
  return writeState(sql, state, options);
}

module.exports = { compactState, databaseConfigured, getState, saveState };
