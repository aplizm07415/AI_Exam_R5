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
  storage.set("exam-kit:r4:progress", JSON.stringify({ schemaVersion: 5, answers: {}, results: { "finance:test": savedResult }, flags: {}, archived: { "finance:test": true }, notes: {}, attempts: {}, recent: [], mockResults: {}, activity: {}, sessions: [{ id: "session-test", type: "practice", label: "削除確認セッション", subject: "finance", course: 60, startedAt: answeredAt, lastActivityAt: answeredAt, questionCount: 1, results: [savedResult] }], plan: { targetScore: 60, completed: {}, autoCompleted: {} } }));
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
  const calculatorSource = fs.readFileSync(path.join(__dirname, "..", "public", "calculator.js"), "utf8");
  vm.runInContext(calculatorSource, context, { filename: "public/calculator.js" });
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
  assert.match(elements["#app"].innerHTML, /60点コースのチェックポイント/);
  assert.match(elements["#app"].innerHTML, /基礎をつなぐ/);
  assert.match(elements["#app"].innerHTML, /60点基礎層/);
  assert.match(elements["#app"].innerHTML, /70点追加層/);
  assert.match(elements["#app"].innerHTML, /ロック中/);
  assert.doesNotMatch(elements["#app"].innerHTML, /記録をリセット/);

  context.setView("practice");
  assert.match(elements["#app"].innerHTML, /除外問題を管理/);
  context.setView("archive");
  assert.match(elements["#app"].innerHTML, /演習対象から外した問題/);
  assert.match(elements["#app"].innerHTML, /finance:test/);
  assert.match(elements["#app"].innerHTML, /財務・会計/);
  assert.match(elements["#app"].innerHTML, /運営管理/);
  assert.match(elements["#app"].innerHTML, /演習対象に戻す/);

  vm.runInContext(`begin([{ id: "finance:ui-test", sourceId: "ui-test", subject: "finance", topic: "UI確認", difficulty: "基礎", minimumCourse: 60, calculationRequired: true, options: [{ id: "ア", label: "選択肢A" }, { id: "イ", label: "選択肢B" }] }], { label: "UI確認" })`, context);
  assert.match(elements["#app"].innerHTML, /role="checkbox"/);
  assert.match(elements["#app"].innerHTML, /aria-label="選択肢アを除外"[^>]*>×<\/button>/);
  assert.match(elements["#app"].innerHTML, /role="radio" tabindex="0"/);
  assert.doesNotMatch(elements["#app"].innerHTML, /左の縦チェックは「除外」/);
  assert.match(elements["#app"].innerHTML, /data-quit-session>一旦やめる/);
  assert.match(elements["#app"].innerHTML, /calculator is-minimized/);
  assert.match(elements["#app"].innerHTML, /data-finish-session>演習を完了してトップへ/);
  assert.doesNotMatch(elements["#app"].innerHTML, /QUESTION MAP/);
  assert.doesNotMatch(elements["#app"].innerHTML, /type="radio"/);
  assert.doesNotMatch(elements["#app"].innerHTML, /data-archive/);

  vm.runInContext(`state.answers["finance:ui-test"] = "イ"; feedbackCache.set("finance:ui-test", { correct: false, correctAnswer: "ア", explanation: "まず、条件を確認します。\\n\\n次に、式へ代入します。\\n\\n最後に、結果を確認します。出典 https://example.com/source" }); renderQuestion()`, context);
  assert.match(elements["#app"].innerHTML, /choice[^"']*is-correct/);
  assert.match(elements["#app"].innerHTML, /choice[^"']*is-incorrect/);
  assert.doesNotMatch(elements["#app"].innerHTML, /正答：/);
  assert.match(elements["#app"].innerHTML, /<a href="https:\/\/example\.com\/source" target="_blank" rel="noopener noreferrer">/);
  assert.match(elements["#app"].innerHTML, /guided-feedback-explanation/);
  assert.doesNotMatch(elements["#app"].innerHTML, /FINANCE MAP|READ|THINK|STEP|ORIGINAL|科目別ビュー|REVIEW/);
  assert.match(elements["#app"].innerHTML, /元教材の解説/);
  assert.match(elements["#app"].innerHTML, /<details class="original-explanation" open>/);
  assert.doesNotMatch(elements["#app"].innerHTML, /クリックして表示|正答へ落とし込む/);
  assert.match(elements["#app"].innerHTML, /feedback-quick-actions/);
  assert.match(elements["#app"].innerHTML, /アーカイブにする/);
  assert.match(elements["#app"].innerHTML, /data-grade disabled aria-busy="false">採点済み/);

  const correctBanner = vm.runInContext(`feedbackMarkup({ correct: true, correctAnswer: "ア", explanation: "解説" }, { id: "finance:ui-test", subject: "finance", topic: "UI確認", options: [] })`, context);
  assert.match(correctBanner, /feedback-result-banner"><strong>正解<\/strong><\/div>/);
  assert.doesNotMatch(correctBanner, /正解です|判断の流れを確認して|CORRECT/);

  const immediateSave = vm.runInContext(`(() => {
    let calls = 0;
    persistNow = async () => { calls += 1; };
    queueSave({ immediate: true });
    return calls;
  })()`, context);
  assert.equal(immediateSave, 1);

  const allocationSums = vm.runInContext(`content.learningPhases.every((phase) => Array.from({ length: Math.ceil(phase.sessionSize * .5) + 1 }, (_, extra) => phase.sessionSize + extra).every((total) => Object.values(weightedAllocation(total, phase.subjectWeights)).reduce((sum, value) => sum + value, 0) === total))`, context);
  assert.equal(allocationSums, true);

  const cumulativePlan = vm.runInContext(`(() => {
    const originalSessions = state.sessions;
    const item = content.studyPlans.subjects.finance.courses.find((course) => course.targetScore === 70).groups[0].items[0];
    const records = Array.from({ length: 7 }, (_, index) => ({ questionId: "finance:cumulative-" + index, subject: "finance", topic: item.topic, topicId: item.topicId, minimumCourse: 60, foundationCheckpoint: 1, difficulty: "基礎", correct: true, answeredAt: new Date(Date.now() - index * 1000).toISOString() }));
    state.sessions = [0, 1].map((part) => ({ id: "cumulative-" + part, type: "practice", course: 60, startedAt: new Date().toISOString(), results: records.filter((_, index) => index % 2 === part) }));
    const status = autoItemStatus("finance", 70, item);
    state.sessions = originalSessions;
    return status;
  })()`, context);
  assert.equal(cumulativePlan.passed, true);

  const archiveRule = vm.runInContext(`(() => {
    const originalSessions = state.sessions;
    const originalArchived = state.archived;
    const originalResets = state.archiveResets;
    const record = (day, correct = true) => ({ questionId: "finance:auto-test", subject: "finance", topic: "自動判定", correct, answeredAt: new Date(2026, 7, day, 12).toISOString() });
    state.sessions = [{ id: "auto-days", results: [record(20), record(20), record(21), record(22)] }];
    state.archived = {};
    state.archiveResets = {};
    const distinctDayStreak = consecutiveCorrectDayCount("finance:auto-test");
    const archived = autoArchiveMasteredQuestion("finance:auto-test");
    const reason = state.archived["finance:auto-test"].reason;
    restoreArchivedQuestion("finance:auto-test");
    const resetStreak = consecutiveCorrectDayCount("finance:auto-test");
    state.sessions = originalSessions;
    state.archived = originalArchived;
    state.archiveResets = originalResets;
    return { distinctDayStreak, archived, reason, resetStreak };
  })()`, context);
  assert.deepEqual(JSON.parse(JSON.stringify(archiveRule)), { distinctDayStreak: 3, archived: true, reason: "auto", resetStreak: 0 });

  const gates = vm.runInContext(`(() => {
    const originalSessions = state.sessions;
    const originalResults = state.results;
    const subjects = ["finance", "operations", "law", "sme"];
    const financeOnly = Array.from({ length: 60 }, (_, index) => ({ questionId: "finance:only-" + index, subject: "finance", topic: "gate", topicId: "finance:gate", minimumCourse: 60, foundationCheckpoint: 1, difficulty: "基礎", correct: true, answeredAt: new Date(Date.now() - index * 1000).toISOString() }));
    state.sessions = Array.from({ length: 4 }, (_, sessionIndex) => ({ id: "finance-only-" + sessionIndex, type: "practice", course: 60, startedAt: new Date().toISOString(), results: financeOnly.filter((_, index) => index % 4 === sessionIndex) }));
    state.results = Object.fromEntries(financeOnly.map((record) => [record.questionId, record]));
    const oneSubjectUnlocks = isCourseUnlocked(70);
    const records = [];
    const sessions = [];
    for (const checkpoint of [1, 2, 3]) for (const subject of subjects) {
      const subjectRecords = Array.from({ length: 20 }, (_, index) => ({ questionId: subject + ":gate-" + checkpoint + "-" + index, subject, topic: "gate", topicId: subject + ":gate", minimumCourse: 60, foundationCheckpoint: checkpoint, difficulty: "基礎", correct: true, answeredAt: new Date(Date.now() - (checkpoint * 100 + index) * 1000).toISOString() }));
      records.push(...subjectRecords);
      sessions.push(...[0, 1, 2].map((part) => ({ id: "gate-" + checkpoint + "-" + subject + "-" + part, type: "practice", course: 60, startedAt: new Date().toISOString(), results: subjectRecords.filter((_, index) => index % 3 === part) })));
    }
    state.sessions = sessions;
    state.results = Object.fromEntries(records.map((record) => [record.questionId, record]));
    const result = { oneSubjectUnlocks, foundation: foundationReadiness().passed, seventyUnlocked: isCourseUnlocked(70), eightyUnlocked: isCourseUnlocked(80), selector: courseSelector() };
    state.sessions = originalSessions;
    state.results = originalResults;
    return result;
  })()`, context);
  assert.equal(gates.oneSubjectUnlocks, false);
  assert.equal(gates.foundation, true);
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

test("サイドバーにアーカイブタブがある", () => {
  const html = fs.readFileSync(path.join(__dirname, "..", "public", "index.html"), "utf8");
  assert.match(html, /data-view="archive"[^>]*><span>08<\/span>アーカイブ/);
});

test("スマホ表示は本文16px・補助14pxと44px以上の操作領域を使う", () => {
  const css = fs.readFileSync(path.join(__dirname, "..", "public", "styles.css"), "utf8");
  assert.match(css, /#app :where\(p, li, td, th, label, button, input, select, textarea\) \{ font-size: 16px; \}/);
  assert.match(css, /#app :where\(small, span, \.eyebrow\) \{ font-size: 14px; \}/);
  assert.match(css, /\.eliminate-toggle \{ width: 44px; height: 44px;/);
  assert.match(css, /\.quit-session \{ min-height: 44px; \}/);
  assert.match(css, /\.calculator\.is-minimized \{ width: 76px; \}/);
  assert.doesNotMatch(css, /(?:html|body) \{[^}]*overflow-x: hidden/);
  assert.match(css, /\.table-scroll \{ width: 100%; max-width: 100%;[^}]*overflow-x: auto;/);
});
