const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const { publicContent } = require("../src/content");

test("ダッシュボード・全体確認・学習記録・実施履歴を描画できる", async () => {
  const elements = Object.fromEntries(["#app", "#pageTitle", "#saveStatus", "#brandName", "#brandShort", "#todayLabel"].map((selector) => [selector, { innerHTML: "", textContent: "", style: { setProperty() {} } }]));
  const storage = new Map();
  const answeredAt = new Date().toISOString();
  const savedResult = { questionId: "finance:test", subject: "finance", topic: "原価計算", topicId: "財務_会計:原価計算", minimumCourse: 60, difficulty: "基礎", correct: true, answeredAt };
  storage.set("exam-kit:r4:progress", JSON.stringify({ schemaVersion: 4, answers: {}, results: { "finance:test": savedResult }, flags: {}, notes: {}, attempts: {}, recent: [], mockResults: {}, activity: {}, sessions: [{ id: "session-test", type: "practice", label: "削除確認セッション", subject: "finance", course: 60, startedAt: answeredAt, lastActivityAt: answeredAt, questionCount: 1, results: [savedResult] }], plan: { targetScore: 60, completed: {}, autoCompleted: {} } }));
  const document = {
    documentElement: { style: { setProperty() {} } },
    querySelector(selector) { return elements[selector] || null; },
    querySelectorAll() { return []; },
    addEventListener() {}
  };
  const context = vm.createContext({
    console,
    document,
    window: { open() {}, scrollTo() {} },
    localStorage: { getItem(key) { return storage.get(key) || null; }, setItem(key, value) { storage.set(key, value); } },
    fetch: async (url) => ({
      ok: true,
      json: async () => url === "/api/content" ? publicContent() : url === "/api/progress" ? { configured: false, exists: false } : { configured: false }
    }),
    alert() {},
    confirm() { return true; },
    setTimeout,
    clearTimeout,
    setInterval,
    clearInterval,
    URLSearchParams,
    Intl,
    Date,
    Math,
    Map,
    Set,
    Promise
  });
  const source = fs.readFileSync(path.join(__dirname, "..", "public", "app.js"), "utf8");
  vm.runInContext(source, context, { filename: "public/app.js" });
  await new Promise((resolve) => setTimeout(resolve, 30));

  assert.match(elements["#app"].innerHTML, /TODAY'S MISSION/);
  assert.match(elements["#app"].innerHTML, /FINANCE ROUTE/);

  context.setView("overview");
  assert.match(elements["#app"].innerHTML, /試験までの全体像と現在地/);
  assert.match(elements["#app"].innerHTML, /本日の自動割当/);
  assert.match(elements["#app"].innerHTML, /現在フェーズの予実/);

  context.setView("progress");
  assert.match(elements["#app"].innerHTML, /層別進捗とコース到達度/);
  assert.match(elements["#app"].innerHTML, /60点基礎層/);
  assert.match(elements["#app"].innerHTML, /70点追加層/);
  assert.match(elements["#app"].innerHTML, /ロック中/);
  assert.doesNotMatch(elements["#app"].innerHTML, /記録をリセット/);

  const gates = vm.runInContext(`(() => {
    const originalSessions = state.sessions;
    const originalResults = state.results;
    const records = Array.from({ length: 60 }, (_, index) => ({ questionId: "finance:gate-" + index, subject: "finance", topic: "gate", topicId: "finance:gate", minimumCourse: 60, difficulty: "基礎", correct: true, answeredAt: new Date(Date.now() - index * 1000).toISOString() }));
    state.sessions = Array.from({ length: 4 }, (_, sessionIndex) => ({ id: "gate-session-" + sessionIndex, type: "practice", course: 60, startedAt: new Date().toISOString(), results: records.filter((_, index) => index % 4 === sessionIndex) }));
    state.results = Object.fromEntries(records.map((record) => [record.questionId, record]));
    const result = { sixty: tierProgress(60).passed, seventyUnlocked: isCourseUnlocked(70), eightyUnlocked: isCourseUnlocked(80), selector: courseSelector() };
    state.sessions = originalSessions;
    state.results = originalResults;
    return result;
  })()`, context);
  assert.equal(gates.sixty, true);
  assert.equal(gates.seventyUnlocked, true);
  assert.equal(gates.eightyUnlocked, false);
  assert.match(gates.selector, /data-set-course="80" disabled/);

  context.setView("history");
  assert.match(elements["#app"].innerHTML, /すべての実施記録/);
  assert.match(elements["#app"].innerHTML, /削除確認セッション/);
  context.removeSession("session-test");
  context.renderHistory();
  assert.doesNotMatch(elements["#app"].innerHTML, /削除確認セッション/);
});
