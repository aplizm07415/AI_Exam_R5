const test = require("node:test");
const assert = require("node:assert/strict");
const { Readable } = require("node:stream");
const { writeState, getStateWithSql } = require("../src/database");
const { handler, validProgressBundle } = require("../server");
const { content } = require("../src/content");

// Script the driver boundary, without opening a database connection. These tests
// inspect the actual bound values and CAS guards as well as the returned state.
function scriptedSql({ reads = [], transactions = [] } = {}) {
  const observed = { reads: [], transactions: [] };
  const sql = (strings, ...values) => {
    const query = { text: strings.join("?").replace(/\s+/g, " ").trim(), values };
    query.then = (resolve, reject) => Promise.resolve().then(() => {
      observed.reads.push(query);
      assert.ok(reads.length, "unexpected read");
      const next = reads.shift();
      return typeof next === "function" ? next(query) : next;
    }).then(resolve, reject);
    return query;
  };
  sql.transaction = async (queries) => {
    observed.transactions.push(queries);
    assert.ok(transactions.length, "unexpected transaction");
    const next = transactions.shift();
    return typeof next === "function" ? next(queries) : next;
  };
  return { sql, observed };
}

const row = (version, state, sessions = [], deleted = []) => [{ state, version, sessions,
  deleted_session_ids: deleted, updated_at: `2026-09-06T00:${String(version).padStart(2, "0")}:00Z` }];
const session = (id, results = []) => ({ id, type: "practice", results });
const boundSessions = (queries) => {
  const insert = queries.find((query) => query.text.startsWith("INSERT INTO exam_session_states"));
  return insert ? JSON.parse(insert.values.find((value) => typeof value === "string" && value.startsWith("[{"))) : [];
};

test("古い版と存在しない保存先への非ゼロ版更新は書込前に競合とする", async () => {
  for (const current of [row(8, {}), []]) {
    const { sql, observed } = scriptedSql({ reads: [current] });
    assert.deepEqual(await writeState(sql, { notes: { q: "未送信" } }, { expectedVersion: 7, sessions: [session("new")] }),
      { configured: true, conflict: true });
    assert.equal(observed.transactions.length, 0);
  }
});

test("読取直後の競合はCASで拒否し、session更新と削除を同一mutationに制限する", async () => {
  const { sql } = scriptedSql({ reads: [row(7, {})], transactions: [(queries) => {
    assert.match(queries[0].text, /WHERE exam_states\.version = \?/);
    assert.equal(queries[0].values.at(-1), 7);
    const mutationId = queries[0].values[3];
    for (const query of queries.slice(1)) {
      assert.match(query.text, /mutation_id = \?/);
      assert.ok(query.values.includes(mutationId));
    }
    assert.match(queries.find((query) => query.text.startsWith("INSERT INTO exam_session_states")).text,
      /NOT EXISTS \( SELECT 1 FROM exam_session_deletions/);
    return queries.map(() => []);
  }] });
  assert.deepEqual(await writeState(sql, { notes: {} }, { expectedVersion: 7,
    sessions: [session("answer")], deletedSessionIds: ["removed"] }), { configured: true, conflict: true });
});

test("新しいドラフトでもサーバー上の同一試行の採点と他設問の履歴を保持する", async () => {
  const answer = { attemptId: "attempt-q", questionId: "q", answeredAt: "2026-09-06T00:00:00Z", submittedAnswer: "イ", correct: false };
  const graded = { ...session("practice", [answer]), lastActivityAt: answer.answeredAt,
    attempts: { q: { attemptId: answer.attemptId, status: "graded" } } };
  const draft = { ...session("practice", [{ attemptId: "attempt-r", questionId: "r", answeredAt: "2026-09-06T01:00:00Z", correct: true }]),
    lastActivityAt: "2026-09-06T01:00:00Z", attempts: { q: { attemptId: answer.attemptId, status: "answering", selectedAnswer: "ア" } } };
  const { sql } = scriptedSql({ reads: [row(4, {}, [graded])], transactions: [(queries) => {
    const [written] = boundSessions(queries);
    assert.equal(written.results.length, 2);
    assert.deepEqual(written.results.find((item) => item.questionId === "q"), answer);
    assert.equal(written.attempts.q.status, "graded");
    assert.equal(written.attempts.q.selectedAnswer, "イ");
    return [[{ version: 5, updated_at: "saved" }], []];
  }] });
  const saved = await writeState(sql, { notes: {} }, { expectedVersion: 4, sessions: [draft] });
  assert.equal(saved.version, 5);
});

test("削除済みIDの再送を無視し、同じ送信内の削除をドラフトより優先する", async () => {
  const { sql } = scriptedSql({ reads: [row(5, {}, [], ["deleted"])], transactions: [(queries) => {
    assert.deepEqual(boundSessions(queries).map((item) => item.id), ["survivor"]);
    const tombstone = queries.find((query) => query.text.startsWith("INSERT INTO exam_session_deletions"));
    assert.ok(tombstone.values.includes('["remove-now"]'));
    assert.match(tombstone.text, /ON CONFLICT .* DO NOTHING/);
    assert.ok(queries.some((query) => query.text.startsWith("DELETE FROM exam_session_states")));
    return [[{ version: 6, updated_at: "saved" }], [], [], []];
  }] });
  await writeState(sql, {}, { expectedVersion: 5,
    sessions: [session("deleted"), session("remove-now"), session("survivor")], deletedSessionIds: ["remove-now", "remove-now"] });
});

test("進捗GETはsnapshot・履歴・削除・versionを一度に読み、2000件以上を保持する", async () => {
  const sessions = Array.from({ length: 2101 }, (_, index) => session(`session-${index}`));
  const { sql, observed } = scriptedSql({ reads: [row(12, { notes: { q: "保存済み" } }, sessions, ["session-4"])] });
  const saved = await getStateWithSql(sql);
  assert.equal(observed.reads.length, 1);
  assert.equal(observed.transactions.length, 0);
  assert.match(observed.reads[0].text, /^SELECT e\.state, e\.version, e\.updated_at,/);
  assert.match(observed.reads[0].text, /FROM exam_session_states/);
  assert.match(observed.reads[0].text, /FROM exam_session_deletions/);
  assert.equal(saved.version, 12);
  assert.equal(saved.state.sessions.length, 2100);
  assert.equal(saved.state.sessions.some((item) => item.id === "session-4"), false);
  assert.equal(saved.state.notes.q, "保存済み");
});

test("旧JSON移行中の競合では旧sessionを返さず、保存済みの最新版を再取得する", async () => {
  const legacy = { notes: { old: "旧端末" }, sessions: [session("removed")] };
  const { sql, observed } = scriptedSql({ reads: [row(2, legacy), row(3, {}), row(3, { notes: { current: "別端末更新" } }, [session("fresh")], ["removed"])] });
  const saved = await getStateWithSql(sql);
  assert.equal(saved.version, 3);
  assert.equal(saved.updatedAt, "2026-09-06T00:03:00Z");
  assert.deepEqual(saved.state.sessions.map((item) => item.id), ["fresh"]);
  assert.deepEqual(saved.state.notes, { current: "別端末更新" });
  assert.equal(observed.transactions.length, 0);
});

test("旧JSONと分割済みsessionが併存する移行も削除を尊重して統合する", async () => {
  const first = { questionId: "q", attemptId: "q-1", answeredAt: "2026-09-06T00:00:00Z", correct: true };
  const second = { questionId: "r", attemptId: "r-1", answeredAt: "2026-09-06T00:01:00Z", correct: false };
  const legacy = { sessions: [session("same", [first]), session("removed")], notes: { q: "保持" } };
  const split = [session("same", [second])];
  const { sql } = scriptedSql({ reads: [row(2, legacy, split, ["removed"]), row(2, {}, split, ["removed"]),
    row(3, { notes: { q: "保持" } }, [session("same", [first, second])], ["removed"])],
  transactions: [(queries) => {
    const written = boundSessions(queries);
    assert.deepEqual(written.map((item) => item.id), ["same"]);
    assert.equal(written[0].results.length, 2);
    const savedSnapshot = JSON.parse(queries[0].values[2]);
    assert.equal(savedSnapshot.sessions, undefined);
    assert.equal(savedSnapshot.notes.q, "保持");
    return [[{ version: 3, updated_at: "migrated" }], []];
  }] });
  const saved = await getStateWithSql(sql);
  assert.equal(saved.storage, "split");
  assert.equal(saved.version, 3);
  assert.equal(saved.state.sessions[0].results.length, 2);
});

test("旧JSON移行が競合し続けても3回で止め、最後の整合した読取を返す", async () => {
  const legacy = (version) => row(version, { notes: { version }, sessions: [session(`legacy-${version}`)] });
  const { sql, observed } = scriptedSql({ reads: [legacy(1), row(2, {}), legacy(2), row(3, {}), legacy(3), row(4, {}), legacy(4)] });
  const saved = await getStateWithSql(sql);
  assert.equal(observed.reads.length, 7);
  assert.equal(observed.transactions.length, 0);
  assert.equal(saved.version, 4);
  assert.equal(saved.state.notes.version, 4);
  assert.deepEqual(saved.state.sessions.map((item) => item.id), ["legacy-4"]);
});

test("resultsとmockResultsのみの旧状態を移行し、メモ保存後の再取得でも履歴を保持する", async () => {
  const answer = { subject: "finance", correct: false, answeredAt: "2026-09-06T16:00:00Z", minimumCourse: 60 };
  let snapshot = { notes: { q: "変更前" }, results: { q: answer },
    mockResults: { finance: { score: 64, maxScore: 100, finishedAt: answer.answeredAt,
      details: [{ id: "1", submitted: "ア", correct: true, answer: "ア" }] } } };
  let sessions = [];
  let version = 4;
  const read = (query) => {
    const requestedIds = query.text.startsWith("SELECT e.version,") ? JSON.parse(query.values[0]) : null;
    const legacy = snapshot.results || snapshot.mockResults || snapshot.sessions;
    return row(version, snapshot, !requestedIds || legacy ? sessions : sessions.filter((item) => requestedIds.includes(item.id)));
  };
  const save = (queries) => {
    assert.equal(queries[0].values.at(-1), version);
    snapshot = JSON.parse(queries[0].values[2]);
    assert.equal(snapshot.results, undefined);
    assert.equal(snapshot.mockResults, undefined);
    const byId = new Map(sessions.map((item) => [item.id, item]));
    for (const item of boundSessions(queries)) byId.set(item.id, item);
    sessions = [...byId.values()];
    version += 1;
    return [[{ version, updated_at: "saved" }], ...queries.slice(1).map(() => [])];
  };
  const { sql, observed } = scriptedSql({ reads: [read, read, read, read, read], transactions: [save, save] });
  const migrated = await getStateWithSql(sql);
  assert.equal(migrated.storage, "split");
  assert.equal(migrated.version, 5);
  assert.deepEqual(migrated.state.sessions.map((item) => item.id), ["legacy-2026-09-07", "legacy-mock-finance-2026-09-07"]);
  assert.deepEqual(migrated.state.sessions[0].results, [{ ...answer, questionId: "q" }]);
  assert.equal(migrated.state.sessions[1].summary.score, 64);
  assert.equal(migrated.state.sessions[1].mockResult.details[0].submitted, "ア");

  // The normal client sends only its compact snapshot for a note-only edit.
  await writeState(sql, { notes: { q: "変更後" } }, { expectedVersion: migrated.version, sessions: [] });
  const reloaded = await getStateWithSql(sql);
  assert.equal(reloaded.version, 6);
  assert.equal(reloaded.state.notes.q, "変更後");
  assert.deepEqual(reloaded.state.sessions, migrated.state.sessions);
  assert.equal(observed.transactions.length, 2);
});

test("旧形式GETを経由しないメモ保存でも旧回答を分割行へ移してから置換する", async () => {
  const legacy = { results: { q: { correct: true } }, mockResults: { law: { score: 80 } } };
  let snapshot;
  let sessions;
  const { sql } = scriptedSql({ reads: [row(2, legacy), () => row(3, snapshot, sessions)], transactions: [(queries) => {
    snapshot = JSON.parse(queries[0].values[2]);
    sessions = boundSessions(queries);
    assert.deepEqual(sessions.map((item) => item.id), ["legacy-2026-09-06", "legacy-mock-law-2026-09-06"]);
    assert.equal(sessions[0].results[0].questionId, "q");
    assert.equal(sessions[1].summary.score, 80);
    assert.equal(snapshot.results, undefined);
    return [[{ version: 3, updated_at: "saved" }], []];
  }] });
  await writeState(sql, { notes: { q: "旧端末のメモ" } }, { expectedVersion: 2, sessions: [] });
  const saved = await getStateWithSql(sql);
  assert.equal(saved.state.notes.q, "旧端末のメモ");
  assert.equal(saved.state.sessions.length, 2);
});

test("旧集計から再構成したsessionも削除済みIDを復活させない", async () => {
  const legacy = { savedAt: "2026-09-06T12:00:00+09:00", results: { q: { correct: true } },
    mockResults: { law: { score: 80 } } };
  const deleted = ["legacy-2026-09-06", "legacy-mock-law-2026-09-06"];
  let snapshot;
  const { sql } = scriptedSql({ reads: [row(2, legacy, [], deleted), row(2, legacy, [], deleted),
    () => row(3, snapshot, [], deleted)], transactions: [(queries) => {
    snapshot = JSON.parse(queries[0].values[2]);
    assert.deepEqual(boundSessions(queries), []);
    assert.equal(snapshot.results, undefined);
    assert.equal(snapshot.mockResults, undefined);
    return [[{ version: 3, updated_at: "saved" }]];
  }] });
  const saved = await getStateWithSql(sql);
  assert.deepEqual(saved.state.sessions, []);
  assert.deepEqual(saved.deletedSessionIds, deleted);
});

for (const mode of ["mock-only", "partial-practice", "partial-deleted"]) {
  test(`旧resultsと分割行が併存しても未移行回答を保持し二重計上しない (${mode})`, async () => {
    const first = { questionId: "q", correct: true, answeredAt: "2026-09-06T16:00:00Z" };
    const second = { questionId: "r", correct: false,
      answeredAt: mode === "partial-deleted" ? "2026-09-06T10:00:00Z" : "2026-09-06T17:00:00Z" };
    const mock = { ...session("mock-finance"), type: "official-mock", subject: "finance", summary: { score: 64 } };
    const split = mode === "mock-only" ? [mock] : [session("legacy-2026-09-07", [first])];
    const legacy = { results: { q: { ...first, answeredAt: "2026-09-07T01:00:00+09:00" }, r: second },
      ...(mode === "mock-only" ? { mockResults: { finance: { score: 64 } } } : {}) };
    const deleted = mode === "partial-deleted" ? ["legacy-2026-09-06"] : [];
    let snapshot;
    let savedSessions;
    const { sql } = scriptedSql({ reads: [row(2, legacy, split, deleted), () => row(3, snapshot, savedSessions, deleted)],
      transactions: [(queries) => {
        snapshot = JSON.parse(queries[0].values[2]);
        savedSessions = boundSessions(queries);
        const practice = savedSessions.filter((item) => item.type !== "official-mock");
        assert.equal(practice.length, 1);
        assert.equal(practice[0].id, "legacy-2026-09-07");
        assert.deepEqual(practice[0].results.map((item) => item.questionId).sort(), mode === "partial-deleted" ? ["q"] : ["q", "r"]);
        assert.equal(savedSessions.filter((item) => item.type === "official-mock").length, mode === "mock-only" ? 1 : 0);
        if (mode === "mock-only") assert.deepEqual(savedSessions.find((item) => item.id === "mock-finance"), mock);
        assert.equal(snapshot.results, undefined);
        return [[{ version: 3, updated_at: "saved" }], []];
      }] });
    await writeState(sql, { notes: { q: "移行中のメモ保存" } }, { expectedVersion: 2, sessions: [] });
    const reloaded = await getStateWithSql(sql);
    assert.equal(reloaded.state.notes.q, "移行中のメモ保存");
    assert.deepEqual(reloaded.state.sessions, savedSessions);
    assert.deepEqual(reloaded.deletedSessionIds, deleted);
  });
}

test("旧snapshotに完全なsessionsがある場合は集計キャッシュを再移行しない", async () => {
  const kept = session("existing", [{ questionId: "q", correct: true }]);
  const snapshot = { sessions: [kept], results: { stale: { questionId: "stale", correct: false } } };
  const { sql } = scriptedSql({ reads: [row(2, snapshot)], transactions: [(queries) => {
    assert.deepEqual(boundSessions(queries), [kept]);
    return [[{ version: 3, updated_at: "saved" }], []];
  }] });
  await writeState(sql, { notes: {} }, { expectedVersion: 2, sessions: [] });
});

function grade(body) {
  return new Promise((resolve, reject) => {
    const request = Readable.from([JSON.stringify(body)]);
    Object.assign(request, { method: "POST", url: "/api/grade", headers: { host: "test.local" } });
    let status;
    const response = { writeHead(value) { status = value; }, end(value) { resolve({ status, body: JSON.parse(value) }); } };
    Promise.resolve(handler(request, response)).catch(reject);
  });
}

test("教材改訂前の採点要求を409で拒否し、現在版の回答のみ採点する", async () => {
  const question = content.questions.find((item) => item.contentVersion > 1);
  assert.ok(question, "test needs a revised question");
  const old = await grade({ questionId: question.id, answer: question.answer });
  assert.deepEqual(old, { status: 409, body: { error: "question_version_changed" } });
  const current = await grade({ questionId: question.id, answer: question.answer, contentVersion: question.contentVersion });
  assert.equal(current.status, 200);
  assert.equal(current.body.correct, true);
});

test("重複session IDを持つ不正batchをAPIで拒否する", () => {
  assert.equal(validProgressBundle({ state: { notes: {} }, sessions: [session("same"), session("same")],
    deletedSessionIds: [], expectedVersion: 0 }), false);
});
