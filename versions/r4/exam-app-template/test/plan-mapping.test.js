const test = require("node:test");
const assert = require("node:assert/strict");
const { createClassifier, mapPlanItem, questionText } = require("../tools/build-r4-content");
const { content, publicContent } = require("../src/content");
const Assessment = require("../public/assessment");
const overrides = require("../content/analysis/plan-mapping-overrides.json");

function mappingContext(subjectId) {
  const subject = content.subjects.find((value) => value.id === subjectId);
  const taxonomy = require(`../content/analysis/${subject.taxonomyFile}`);
  const rawQuestions = require(`../content/source/${subject.sourceFile}`);
  return { taxonomy, rawQuestions, classify: createClassifier(taxonomy) };
}

test("収録問題の根拠を持つCF分析と標準時間だけを科目・コース・本文の完全一致で対応させる", () => {
  for (const override of overrides.mappings) {
    const { taxonomy, rawQuestions, classify } = mappingContext(override.subjectId);
    const input = { text: override.text, evidenceType: "topic" };
    const mapped = mapPlanItem(override.subjectId, override.course, input, taxonomy, classify);
    assert.equal(mapped.topicId, override.topicId);
    assert.equal(mapped.mappingStatus, "reviewed-topic-link");
    for (const id of mapped.supportingQuestionIds) {
      const question = rawQuestions.find((value) => `${override.subjectId}:${value.id}` === id);
      assert.ok(question, id);
      // A later classifier change must not silently break the reviewed link.
      assert.equal(classify(questionText(question), question.category)?.topic.topic_id, mapped.topicId, id);
      assert.ok(content.questions.some((value) => value.id === id && value.minimumCourse <= override.course), id);
    }
    assert.notEqual(mapPlanItem(override.subjectId, override.course + 10, input, taxonomy, classify).mappingStatus, "reviewed-topic-link");
    assert.notEqual(mapPlanItem(override.subjectId, override.course, { ...input, text: `${input.text}の応用` }, taxonomy, classify).mappingStatus, "reviewed-topic-link");
    assert.equal(mapPlanItem(override.subjectId, override.course, { ...input, evidenceType: "external" }, taxonomy, classify).topicId, null);
  }
});

test("レビューした教材で計画判定でき、無関係な財務・IE論点だけでは完了しない", () => {
  const topics = publicContent().topics;
  for (const override of overrides.mappings) {
    const { taxonomy, classify } = mappingContext(override.subjectId);
    const item = mapPlanItem(override.subjectId, override.course, { text: override.text, evidenceType: "topic" }, taxonomy, classify);
    const criteria = { questions: override.course === 60 ? 5 : 7, sessions: 2, rate: 85, recentRate: 80 };
    const questions = content.questions.filter((question) => question.subject === override.subjectId && question.topicId === item.topicId && question.minimumCourse <= override.course);
    const records = questions.map((question, index) => ({ questionId: question.id, subject: question.subject, topicId: question.topicId,
      minimumCourse: question.minimumCourse, correct: true, sessionId: `session-${index % 2}`, answeredAt: `2026-09-0${index % 2 + 1}T00:00:00Z` }));
    assert.equal(Assessment.topicStatus(override.subjectId, override.course, item, topics, Assessment.indexRecords(records), criteria).passed, true);
    const unrelated = records.map((record) => ({ ...record, topicId: override.subjectId === "finance" ? "財務_会計:企業価値評価(DCF等)" : "運営管理:IE(インダストリアル・エンジニアリング)関連手法" }));
    const failed = Assessment.topicStatus(override.subjectId, override.course, item, topics, Assessment.indexRecords(unrelated), criteria);
    assert.equal(failed.passed, false);
    assert.equal(failed.uniqueQuestions, 0);
  }
});

test("未確認のBSC・QR/ECR・60点時間価値を似た語や広域論点で埋めない", () => {
  for (const [subject, course, text] of [
    ["finance", 80, "バランスト・スコアカード（BSC）"],
    ["finance", 60, "時間価値の計算（現在価値・将来価値）"],
    ["operations", 70, "QR（クイックレスポンス）とECR（効率的消費者対応）"]
  ]) {
    const { taxonomy, classify } = mappingContext(subject);
    const mapped = mapPlanItem(subject, course, { text, evidenceType: "topic" }, taxonomy, classify);
    assert.equal(mapped.mappingStatus, "unmapped");
    assert.equal(mapped.topicId, null);
  }
  const { taxonomy, classify } = mappingContext("finance");
  const bad = [{ ...overrides.mappings[0], topicId: "finance:missing-topic" }];
  assert.throws(() => mapPlanItem("finance", 70, { text: bad[0].text, evidenceType: "topic" }, taxonomy, classify, bad), /taxonomy/);
});
