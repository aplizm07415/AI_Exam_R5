const test = require("node:test");
const assert = require("node:assert/strict");
const Sync = require("../public/progress-sync");
const { harness } = require("./helpers/app-harness");

function remoteStore() {
  const store = { state: null, version: 0, deleted: new Set(), offline: false, puts: 0 };
  store.fetch = async (url, options, response) => {
    if (store.offline) throw new Error("offline");
    if (options.method !== "PUT") return response({ configured: true, exists: Boolean(store.state), state: store.state, version: store.version, deletedSessionIds: [...store.deleted] });
    const body = JSON.parse(options.body);
    store.puts += 1;
    if (body.expectedVersion !== store.version) return response({ error: "version_conflict" }, 409);
    for (const id of body.deletedSessionIds) store.deleted.add(id);
    const sessions = new Map((store.state?.sessions || []).map((item) => [item.id, item]));
    for (const item of body.sessions) sessions.set(item.id, item);
    store.state = { ...body.state, sessions: [...sessions.values()].filter((item) => !store.deleted.has(item.id)) };
    store.version += 1;
    return response({ configured: true, version: store.version });
  };
  return store;
}

test("二端末の競合を統合し、未送信の履歴・別メモ・計画変更を保持する", async () => {
  const remote = remoteStore();
  const a = harness({ progressFetch: remote.fetch });
  const b = harness({ progressFetch: remote.fetch });
  await a.run("initializePersistence()");
  await b.run("initializePersistence()");
  await a.run("beginRemote({subject:'finance',limit:1,seed:'one'})");
  a.run("state.notes.a = '端末A'; state.plan.studyProfile = {weeklyMinutes: 600}; queueSave()");
  b.run("state.notes.b = '端末B'; state.flags.flag = true; queueSave()");
  await b.run("persistNow()");
  const reloaded = harness({ storage: a.storage, progressFetch: remote.fetch });
  await reloaded.run("initializePersistence()");
  await reloaded.run("persistNow()");
  assert.equal(remote.state.notes.a, "端末A");
  assert.equal(remote.state.notes.b, "端末B");
  assert.equal(remote.state.flags.flag, true);
  assert.equal(remote.state.plan.studyProfile.weeklyMinutes, 600);
  assert.equal(remote.state.sessions.length, 1);
  b.run("state.notes.c = '競合後'; queueSave()");
  await b.run("persistNow()");
  assert.equal(remote.state.notes.a, "端末A");
  assert.equal(remote.state.notes.c, "競合後");
  assert.ok(remote.puts >= 4);
});

test("オフライン削除を再読込後に送信し、古い別端末のドラフトで復活させない", async () => {
  const remote = remoteStore();
  const a = harness({ progressFetch: remote.fetch });
  await a.run("initializePersistence()");
  await a.run("beginRemote({subject:'finance',limit:1})");
  await a.run("persistNow()");
  const id = remote.state.sessions[0].id;
  const b = harness({ progressFetch: remote.fetch });
  await b.run("initializePersistence()");
  remote.offline = true;
  a.run(`removeSession(${JSON.stringify(id)}); queueSave()`);
  await a.run("persistNow()");
  const reloaded = harness({ storage: a.storage, progressFetch: remote.fetch });
  await reloaded.run("initializePersistence()");
  assert.ok(reloaded.json("[...deletedSessionIds]").includes(id));
  remote.offline = false;
  await reloaded.run("persistNow()");
  assert.equal(remote.state.sessions.length, 0);
  b.run(`state.sessions[0].lastActivityAt = new Date().toISOString(); markSessionDirty(${JSON.stringify(id)}); queueSave()`);
  await b.run("persistNow()");
  assert.equal(remote.state.sessions.length, 0);
  assert.equal(b.run("state.sessions.length"), 0);
});

test("送信中の追加編集は送信済みと誤認せず次回のキューに残す", async () => {
  const remote = remoteStore();
  let release;
  let entered;
  const started = new Promise((resolve) => { entered = resolve; });
  let hold = false;
  const h = harness({ progressFetch: async (url, options, response) => {
    if (hold && options.method === "PUT") {
      entered();
      await new Promise((resolve) => { release = resolve; });
    }
    return remote.fetch(url, options, response);
  } });
  await h.run("initializePersistence()");
  h.run("state.notes.a = '送信前'; queueSave()");
  hold = true;
  const save = h.run("persistNow()");
  await started;
  h.run("state.notes.a = '送信中の編集'; queueSave()");
  release();
  await save;
  assert.ok(h.run("pendingStateChanges.size") > 0);
  hold = false;
  await h.run("persistNow()");
  assert.equal(remote.state.notes.a, "送信中の編集");
});

test("同じ試行の採点済み状態を新しいドラフトで戻さず、除外日を項目単位に統合する", () => {
  const record = { attemptId: "a", questionId: "q", submittedAnswer: "イ", correct: false, answeredAt: "2026-09-06T01:00:00Z" };
  const first = { id: "s", lastActivityAt: record.answeredAt, attempts: { q: { attemptId: "a", status: "graded" } }, results: [record] };
  const stale = { id: "s", lastActivityAt: "2026-09-06T02:00:00Z", attempts: { q: { attemptId: "a", status: "answering", selectedAnswer: "ア" } }, results: [] };
  const merged = Sync.mergeSession(first, stale);
  assert.equal(merged.attempts.q.status, "graded");
  assert.equal(merged.attempts.q.selectedAnswer, "イ");
  const before = { plan: { schedule: { excludedDates: ["2026-09-01"] } } };
  const after = { plan: { schedule: { excludedDates: ["2026-09-01", "2026-09-03"] } } };
  assert.deepEqual(Sync.applyChanges({ plan: { schedule: { excludedDates: ["2026-09-02"] } } }, Sync.changes(before, after)).plan.schedule.excludedDates, ["2026-09-02", "2026-09-03"]);
});

test("保存容量不足を保存済みと表示せず、メモリ内の未送信操作を保持する", async () => {
  const h = harness();
  h.context.localStorage.setItem = () => { throw new Error("QuotaExceededError"); };
  h.run("state.notes.unsaved = '残すメモ'; queueSave()");
  await h.run("persistNow()");
  assert.equal(h.run("localSaveFailed"), true);
  assert.match(h.element("#saveStatus").textContent, /端末に保存できません/);
  assert.equal(h.run("state.notes.unsaved"), "残すメモ");
  assert.ok(h.run("pendingStateChanges.size") > 0);
});

test("連続競合は3回で打ち切り、キューを保持して次の保存で再送する", async () => {
  const remote = remoteStore();
  let conflict = true;
  let attempted = 0;
  const h = harness({ progressFetch: (url, options, response) => {
    if (options.method === "PUT") {
      attempted += 1;
      if (conflict) return response({ error: "version_conflict" }, 409);
    }
    return remote.fetch(url, options, response);
  } });
  await h.run("initializePersistence()");
  h.run("state.notes.q = '競合中のメモ'; queueSave()");
  await h.run("persistNow()");
  assert.equal(attempted, 3);
  assert.ok(h.run("pendingStateChanges.size") > 0);
  assert.match(h.element("#saveStatus").textContent, /次の保存時に再同期/);
  conflict = false;
  await h.run("persistNow()");
  assert.equal(remote.state.notes.q, "競合中のメモ");
  assert.equal(h.run("pendingStateChanges.size"), 0);
});
