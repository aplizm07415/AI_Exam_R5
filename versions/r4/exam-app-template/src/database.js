const { content, officialExam } = require("./content");
const { randomUUID } = require("node:crypto");
const { snapshot: syncSnapshot, mergeSessions } = require("../public/progress-sync");

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
        CREATE TABLE IF NOT EXISTS exam_session_deletions (
          app_id TEXT NOT NULL,
          user_id TEXT NOT NULL,
          session_id TEXT NOT NULL,
          deleted_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
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
  return { ...syncSnapshot(state), ...(state.savedAt ? { savedAt: state.savedAt } : {}) };
}

function hasLegacyHistory(snapshot = {}) {
  return Boolean(snapshot.sessions?.length || Object.keys(snapshot.results || {}).length || Object.keys(snapshot.mockResults || {}).length);
}

function legacyDateKey(value) {
  // Match the app's Japanese study day, independent of the server's timezone.
  // Old timestamps without an offset already represent a local calendar date.
  if (typeof value === "string" && /^\d{4}-\d{2}-\d{2}(?:T[\d:.]+)?$/.test(value)) return value.slice(0, 10);
  const time = Date.parse(value);
  return new Date((Number.isFinite(time) ? time : 0) + 9 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

function restoreLegacyHistory(snapshot = {}, splitSessions = [], fallbackDate) {
  const sessions = mergeSessions(snapshot.sessions || [], splitSessions);
  // A populated snapshot.sessions is authoritative; its results are a cache.
  // Older snapshots without it can coexist with partly migrated session rows.
  if (!snapshot.sessions?.length) {
    const recorded = new Map();
    for (const item of sessions.filter((entry) => entry.type !== "official-mock")) {
      for (const result of item.results || []) {
        const existing = recorded.get(result.questionId) || [];
        existing.push(result);
        recorded.set(result.questionId, existing);
      }
    }
    const groups = new Map();
    for (const [questionId, result] of Object.entries(snapshot.results || {})) {
      if (!result || typeof result !== "object") continue;
      const id = result.questionId || questionId;
      const alreadyRecorded = (recorded.get(id) || []).some((item) => {
        if (item.attemptId && result.attemptId) return item.attemptId === result.attemptId;
        // An undated old latest-result cache cannot establish another attempt.
        return !item.answeredAt || !result.answeredAt || item.answeredAt === result.answeredAt
          || Date.parse(item.answeredAt) === Date.parse(result.answeredAt);
      });
      if (alreadyRecorded) continue;
      const date = legacyDateKey(result.answeredAt || snapshot.savedAt || fallbackDate);
      const group = groups.get(date) || { id: `legacy-${date}`, type: "legacy", label: "移行前の演習記録",
        course: result.minimumCourse || 60, startedAt: `${date}T00:00:00`, lastActivityAt: `${date}T23:59:59`, results: [] };
      group.results.push({ ...result, questionId: id });
      groups.set(date, group);
    }
    sessions.push(...groups.values());
  }
  for (const [subject, result] of Object.entries(snapshot.mockResults || {})) {
    if (!result || typeof result !== "object" || sessions.some((item) => item.type === "official-mock" && item.subject === subject)) continue;
    const finishedAt = result.finishedAt || snapshot.savedAt || fallbackDate || "1970-01-01T00:00:00Z";
    const date = legacyDateKey(finishedAt);
    const label = content.subjects.find((item) => item.id === subject)?.label || subject;
    sessions.push({ id: `legacy-mock-${subject}-${date}`, type: "official-mock", subject, course: 80,
      label: `令和8年度 ${label} 公式模試`, startedAt: finishedAt, finishedAt, lastActivityAt: finishedAt,
      questionCount: officialExam.subjects[subject]?.answers.length || 0, mockMinutes: 0,
      summary: { score: result.score || 0, maxScore: result.maxScore || 100, answered: 0 },
      ...(Array.isArray(result.details) ? { mockResult: { ...result } } : {}), results: [] });
  }
  return mergeSessions([], sessions);
}

async function writeState(sql, state, options = {}) {
  const expectedVersion = Math.max(0, Number(options.expectedVersion) || 0);
  const incomingSessions = Array.isArray(options.sessions) ? options.sessions.filter((item) => item?.id) : [];
  const deletedSessionIds = [...new Set(Array.isArray(options.deletedSessionIds) ? options.deletedSessionIds.filter(Boolean) : [])];
  const appId = content.exam.id;
  const owner = userId();
  const serializedIds = JSON.stringify(incomingSessions.map((item) => item.id));
  const currentRows = await sql`
    SELECT e.version, e.state, e.updated_at,
      COALESCE((
        SELECT jsonb_agg(s.state ORDER BY s.updated_at, s.session_id)
        FROM exam_session_states s
        WHERE s.app_id = e.app_id AND s.user_id = e.user_id
          AND (e.state ? 'sessions' OR e.state ? 'results' OR e.state ? 'mockResults'
            OR s.session_id IN (SELECT jsonb_array_elements_text(${serializedIds}::jsonb)))
      ), '[]'::jsonb) AS sessions,
      COALESCE((
        SELECT jsonb_agg(d.session_id)
        FROM exam_session_deletions d
        WHERE d.app_id = e.app_id AND d.user_id = e.user_id
          AND (e.state ? 'sessions' OR e.state ? 'results' OR e.state ? 'mockResults'
            OR d.session_id IN (SELECT jsonb_array_elements_text(${serializedIds}::jsonb)))
      ), '[]'::jsonb) AS deleted_session_ids
    FROM exam_states e
    WHERE e.app_id = ${appId} AND e.user_id = ${owner} LIMIT 1
  `;
  const current = currentRows[0];
  if (Number(current?.version || 0) !== expectedVersion) return { configured: true, conflict: true };
  // Merge before CAS. If another writer changes these rows, the transaction below
  // rejects the old version; a stale draft can never erase a recorded attempt.
  const currentSessions = restoreLegacyHistory(current?.state, current?.sessions, current?.updated_at);
  const sessions = mergeSessions(currentSessions, incomingSessions,
    [...(current?.deleted_session_ids || []), ...deletedSessionIds]);
  const mutationId = randomUUID();
  const serialized = JSON.stringify(compactState(state));
  const serializedSessions = JSON.stringify(sessions);
  const serializedDeleted = JSON.stringify(deletedSessionIds);
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
        AND NOT EXISTS (
          SELECT 1 FROM exam_session_deletions
          WHERE app_id = ${appId} AND user_id = ${owner} AND session_id = value->>'id'
        )
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
      INSERT INTO exam_session_deletions (app_id, user_id, session_id)
      SELECT ${appId}, ${owner}, value
      FROM jsonb_array_elements_text(${serializedDeleted}::jsonb) AS value
      WHERE EXISTS (
        SELECT 1 FROM exam_states
        WHERE app_id = ${appId} AND user_id = ${owner} AND mutation_id = ${mutationId}
      )
      ON CONFLICT (app_id, user_id, session_id) DO NOTHING
    `);
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

async function readConsistentState(sql) {
  // One statement sees one MVCC snapshot, including its version and tombstones.
  const rows = await sql`
    SELECT e.state, e.version, e.updated_at,
      COALESCE((
        SELECT jsonb_agg(s.state ORDER BY s.updated_at, s.session_id)
        FROM exam_session_states s
        WHERE s.app_id = e.app_id AND s.user_id = e.user_id
      ), '[]'::jsonb) AS sessions,
      COALESCE((
        SELECT jsonb_agg(d.session_id ORDER BY d.session_id)
        FROM exam_session_deletions d
        WHERE d.app_id = e.app_id AND d.user_id = e.user_id
      ), '[]'::jsonb) AS deleted_session_ids
    FROM exam_states e
    WHERE e.app_id = ${content.exam.id} AND e.user_id = ${userId()} LIMIT 1
  `;
  if (!rows.length) return { configured: true, exists: false, state: null, version: 0, updatedAt: null };
  const row = rows[0];
  const snapshot = row.state || {};
  const deletedSessionIds = row.deleted_session_ids || [];
  return {
    configured: true,
    exists: true,
    state: { ...snapshot, sessions: mergeSessions([], restoreLegacyHistory(snapshot, row.sessions || [], row.updated_at), deletedSessionIds) },
    version: Number(row.version),
    updatedAt: row.updated_at,
    deletedSessionIds,
    storage: hasLegacyHistory(snapshot) ? "legacy" : "split"
  };
}

async function getStateWithSql(sql) {
  let saved = await readConsistentState(sql);
  // A competing migration/save invalidates every part of the read; read again.
  for (let retry = 0; saved.storage === "legacy" && retry < 3; retry += 1) {
    await writeState(sql, saved.state, { expectedVersion: saved.version, sessions: saved.state.sessions });
    saved = await readConsistentState(sql);
  }
  return saved;
}

async function getState() {
  const sql = connection();
  if (!sql) return { configured: false, exists: false, state: null };
  await ensureSchema(sql);
  return getStateWithSql(sql);
}

async function saveState(state, options = {}) {
  const sql = connection();
  if (!sql) return { configured: false };
  await ensureSchema(sql);
  return writeState(sql, state, options);
}

module.exports = { compactState, databaseConfigured, getState, saveState, getStateWithSql, writeState };
