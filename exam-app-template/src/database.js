const { content } = require("./content");

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
    schemaPromise = sql`
      CREATE TABLE IF NOT EXISTS exam_states (
        app_id TEXT NOT NULL,
        user_id TEXT NOT NULL,
        state JSONB NOT NULL DEFAULT '{}'::jsonb,
        version BIGINT NOT NULL DEFAULT 1,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        PRIMARY KEY (app_id, user_id)
      )
    `.catch((error) => {
      schemaPromise = null;
      throw error;
    });
  }
  await schemaPromise;
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
  return { configured: true, exists: true, state: rows[0].state, version: Number(rows[0].version), updatedAt: rows[0].updated_at };
}

async function saveState(state) {
  const sql = connection();
  if (!sql) return { configured: false };
  await ensureSchema(sql);
  const serialized = JSON.stringify(state);
  const rows = await sql`
    INSERT INTO exam_states (app_id, user_id, state)
    VALUES (${content.exam.id}, ${userId()}, ${serialized}::jsonb)
    ON CONFLICT (app_id, user_id) DO UPDATE SET
      state = EXCLUDED.state,
      version = exam_states.version + 1,
      updated_at = NOW()
    RETURNING version, updated_at
  `;
  return { configured: true, version: Number(rows[0].version), updatedAt: rows[0].updated_at };
}

module.exports = { databaseConfigured, getState, saveState };
