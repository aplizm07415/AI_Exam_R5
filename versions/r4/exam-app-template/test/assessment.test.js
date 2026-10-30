const test = require("node:test");
const assert = require("node:assert/strict");
const Assessment = require("../public/assessment");

test("完全な品質台帳にない問題・未知の新版を評価せず、台帳更新後に該当版だけ評価する", () => {
  const values = [
    { questionId: "removed", contentVersion: 1 },
    { questionId: "q", contentVersion: 1 },
    { questionId: "q", contentVersion: 2 },
    { questionId: "q", contentVersion: 3 },
    { questionId: "q", contentVersion: "invalid" },
    { questionId: "q", contentVersion: 2.5 }
  ].map((value, index) => ({ ...value, correct: true, sessionId: String(index), answeredAt: `2026-09-0${index + 1}T00:00:00Z` }));
  const original = structuredClone(values);
  const quality = { bankTotal: 1, questions: { q: { contentVersion: 2, minimumScoringVersion: 2 } } };
  assert.deepEqual(Assessment.eligibleRecords(values, quality).map((record) => record.contentVersion), [2]);
  const updated = { ...quality, questions: { q: { contentVersion: 3, minimumScoringVersion: 2 } } };
  assert.deepEqual(Assessment.eligibleRecords(values, updated).map((record) => record.contentVersion), [2, 3]);
  assert.deepEqual(values, original, "判定保留でも学習履歴自体を変更しない");
});

test("旧版の不成立問題と解説後の再回答を評価せず、同一試行の初回誤答を保つ", () => {
  const record = (questionId, correct, extra = {}) => ({ questionId, subject: "law", sessionId: "one", answeredAt: "2026-09-05T10:00:00Z", correct, ...extra });
  const values = [record("ambiguous", false), record("missing-table", true), record("normal", false),
    record("normal", true, { answeredAt: "2026-09-05T10:00:01Z" }),
    record("feedback-read", true, { assessmentEligible: false }),
    record("ambiguous", true, { contentVersion: 2 })];
  const result = Assessment.eligibleRecords(values, { questions: { ambiguous: { minimumScoringVersion: 2 } }, quarantinedQuestionIds: ["missing-table"] });
  assert.deepEqual(result.map((r) => [r.questionId, r.correct]), [["normal", false], ["ambiguous", true]]);
});

test("無関係の科目成績で未対応論点を完了にしない", () => {
  const records = Array.from({ length: 20 }, (_, index) => ({ subject: "finance", questionId: String(index), topicId: "accounting", sessionId: String(index % 3), minimumCourse: 60, correct: true, answeredAt: "2026-09-05" }));
  const index = Assessment.indexRecords(records);
  const criteria = { questions: 5, sessions: 2, rate: 85, recentRate: 80 };
  for (const item of [{ topicId: null }, { topicId: "cvp" }]) {
    const status = Assessment.topicStatus("finance", 60, item, [{ id: "cvp", subject: "finance", courseCounts: { 60: 0 } }], index, criteria);
    assert.equal(status.passed, false);
    assert.equal(status.uniqueQuestions, 0);
    assert.equal(status.reason, "対応教材なし・未判定");
  }
  assert.equal(Assessment.topicStatus("finance", 60, { topicId: "accounting" }, [{ id: "accounting", subject: "finance", courseCounts: { 60: 30 } }], index, criteria).passed, true);
});

test("80点判定には別教材の初見・電卓なし・時間内答案を要求する", () => {
  const base = { kind: "assessment", subject: "finance", source: "R5再試験", firstSeen: true, calculatorUsed: false, score: 80, maxScore: 100, minutes: 60, timeLimit: 60, completedAt: "2026-09-05" };
  const entries = { a: base, duplicate: { ...base }, repeated: { ...base, source: "R8", firstSeen: false },
    calculator: { ...base, source: "A模試", calculatorUsed: true }, overtime: { ...base, source: "B模試", minutes: 61 },
    other: { ...base, source: "C模試" }, wrongSubject: { ...base, subject: "law", source: "D模試" } };
  assert.equal(Assessment.independentAssessments(entries, "finance").length, 2);
});
