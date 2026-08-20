const test = require("node:test");
const assert = require("node:assert/strict");
const { Readable } = require("node:stream");

const { content, officialExam, publicContent, queryQuestions, validateContent } = require("../src/content");
const { gradeQuestion, gradeOfficialExam } = require("../src/grading");
const { calculationRequired, difficultyFor, normalizeChoiceId, normalizeChoiceText } = require("../src/question-quality");
const { auditQuestions } = require("../tools/audit-questions");
const { handler, validState } = require("../server");

function dispatch(url, options = {}) {
  return new Promise((resolve, reject) => {
    const request = new Readable({ read() {} });
    request.method = options.method || "GET";
    request.url = url;
    request.headers = { host: "test.local" };
    request.push(options.body || "");
    request.push(null);
    const response = {
      statusCode: 200,
      writeHead(status) { this.statusCode = status; },
      end(chunk = "") { resolve({ status: this.statusCode, json: async () => JSON.parse(String(chunk)), text: async () => String(chunk) }); }
    };
    Promise.resolve(handler(request, response)).catch(reject);
  });
}

test("Azure由来の重複整理済み問題と公式補充問題を一意なIDで読み込む", () => {
  assert.equal(content.exam.id, "r4");
  assert.equal(content.subjects.length, 4);
  assert.equal(content.questions.length, 2474);
  assert.equal(new Set(content.questions.map((question) => question.id)).size, 2474);
  assert.deepEqual(Object.fromEntries(content.subjects.map((subject) => [subject.id, content.questions.filter((question) => question.subject === subject.id).length])), {
    finance: 493,
    operations: 563,
    law: 489,
    sme: 929
  });
});

test("公開カタログは正答・解説・Azureファイル名を配信しない", () => {
  const result = publicContent();
  assert.equal(result.totals.questions, 2474);
  assert.equal(result.subjects[0].sourceFile, undefined);
  assert.equal(result.officialExam.subjects.finance.answers, undefined);
  const selected = queryQuestions({ subject: "finance", limit: 3, seed: "test" });
  assert.equal(selected.questions.length, 3);
  assert.equal("answer" in selected.questions[0], false);
  assert.equal("explanation" in selected.questions[0], false);
  assert.equal("originalExplanation" in selected.questions[0], false);
});

test("60・70・80点コースで問題範囲を段階開放する", () => {
  const sixty = queryQuestions({ course: 60, limit: 100, seed: "same" });
  const eighty = queryQuestions({ course: 80, limit: 100, seed: "same" });
  const seventyTier = queryQuestions({ course: 70, tier: "exact", limit: 100, seed: "same" });
  assert.ok(sixty.questions.every((question) => question.minimumCourse <= 60));
  assert.ok(eighty.questions.some((question) => question.minimumCourse > 60));
  assert.ok(seventyTier.questions.every((question) => question.minimumCourse === 70));
});

test("ダッシュボード用のフェーズ・配分・財務ルートを公開する", () => {
  const result = publicContent();
  assert.equal(result.learningPhases.length, 5);
  assert.equal(result.baselineScores.finance, 59);
  assert.equal(result.financeTrack.qualification, "日商簿記2級");
  assert.ok(result.financeTrack.milestones.length >= 5);
  assert.ok(result.courseCounts[60].total < result.courseCounts[70].total);
  assert.ok(result.courseCounts[70].total < result.courseCounts[80].total);
  assert.equal(result.courseCounts[80].total, 2474);
  assert.equal([60, 70, 80].reduce((sum, score) => sum + result.courseCounts[score].addedAtCourse, 0), 2474);
  for (const score of [60, 70, 80]) {
    assert.equal(Object.values(result.courseCounts[score].addedSubjects).reduce((sum, value) => sum + value, 0), result.courseCounts[score].addedAtCourse);
  }
  assert.ok(result.studyPlans.subjects.finance.courses.some((course) => course.groups.some((group) => group.items.some((item) => "topicId" in item))));
  for (const phase of result.learningPhases) {
    assert.equal(Object.values(phase.subjectWeights).reduce((sum, value) => sum + value, 0), 100);
    assert.equal(Object.values(phase.financeSplit).reduce((sum, value) => sum + value, 0), 100);
    assert.ok(phase.milestones.length >= 4);
  }
});

test("通常問題と令和8年度公式模試をサーバー採点する", () => {
  const question = content.questions[0];
  const graded = gradeQuestion(question, question.answer);
  assert.equal(graded.correct, true);
  assert.ok(graded.correctAnswerText);
  assert.equal(graded.originalExplanation, question.originalExplanation);
  const officialAnswers = Object.fromEntries(officialExam.subjects.finance.answers.map((item) => [item.id, item.answer]));
  const mock = gradeOfficialExam(officialExam, "finance", officialAnswers);
  assert.equal(mock.score, 100);
  assert.equal(mock.maxScore, 100);
});

test("全問題が採点後の順序型解説に必要な元解説を持つ", () => {
  for (const question of content.questions) {
    const result = gradeQuestion(question, question.answer);
    assert.ok(result.explanation, `${question.id}: 整形済み解説`);
    assert.ok(result.originalExplanation, `${question.id}: 元解説`);
  }
});

test("教材設定の不整合を起動前に検出する", () => {
  const invalid = { ...content, questions: content.questions.map((question, index) => index ? question : { ...question, subject: "missing" }) };
  assert.throws(() => validateContent(invalid), /subjectsにありません/);
});

test("APIがカタログ・問題・採点・公式模試を提供する", async () => {
  const catalog = await dispatch("/api/content");
  assert.equal(catalog.status, 200);
  assert.equal((await catalog.json()).exam.id, "r4");

  const session = await dispatch("/api/questions?subject=law&limit=5&course=60&seed=test");
  const questions = await session.json();
  assert.equal(questions.questions.length, 5);
  assert.ok(questions.questions.every((question) => question.subject === "law"));

  const question = content.questions[0];
  const graded = await dispatch("/api/grade", { method: "POST", body: JSON.stringify({ questionId: question.id, answer: question.answer }) });
  assert.equal(graded.status, 200);
  assert.equal((await graded.json()).correct, true);

  const mock = await dispatch("/api/mock/grade", { method: "POST", body: JSON.stringify({ subjectId: "finance", answers: {} }) });
  assert.equal(mock.status, 200);
  assert.equal((await mock.json()).score, 0);

  const removedSamples = await dispatch("/api/explanation-samples");
  assert.equal(removedSamples.status, 404);
});

test("保存状態はR4の許可フィールドだけ受け付ける", () => {
  assert.equal(validState({ schemaVersion: 5, answers: {}, results: {}, archived: {}, attempts: {}, mockResults: {}, activity: {}, sessions: [], plan: {} }), true);
  assert.equal(validState({ answers: {}, admin: true }), false);
});

test("Phase 1は8月24日開始で、計算問題だけ電卓対象フラグを持つ", () => {
  const phase = content.learningPhases[0];
  assert.equal(phase.start, "2026-08-24");
  assert.equal(phase.creditFrom, "2026-08-17");
  assert.equal(phase.end, "2026-11-15");
  assert.ok(phase.sessionSize > 15);
  assert.equal(content.questions.find((question) => question.id === "finance:S-5026").calculationRequired, true);
  assert.equal(content.questions.find((question) => question.id === "finance:S-5401").calculationRequired, false);
  assert.equal(content.questions.find((question) => question.id === "operations:S-4510").calculationRequired, true);
  assert.equal(content.questions.find((question) => question.id === "operations:S-4526").calculationRequired, false);
});

test("選択肢の負号と小書きカナを正規化し、正答不能を防ぐ", () => {
  assert.equal(normalizeChoiceText({ label: "ア", text: "ア. -220" }), "-220");
  assert.equal(normalizeChoiceText({ label: "イ", text: "インボイス枠" }), "インボイス枠");
  assert.equal(normalizeChoiceId("ィ"), "イ");
  const variance = content.questions.find((question) => question.id === "finance:S-5057");
  assert.deepEqual(variance.options.map((option) => option.label), ["-220", "-200", "200", "220"]);
  const mm = content.questions.find((question) => question.id === "finance:S-5401");
  assert.equal(mm.answer, "イ");
  assert.equal(gradeQuestion(mm, "イ").correct, true);
});

test("難易度生成は解説の長さを使わず、知識と判断工程で判定する", () => {
  const directKnowledge = { question_text: "用語Xの定義として最も適切なものはどれか。", choices: [{ text: "A" }, { text: "B" }] };
  assert.equal(difficultyFor({ ...directKnowledge, explanation: "短い" }), "基礎");
  assert.equal(difficultyFor({ ...directKnowledge, explanation: "長い".repeat(5000) }), "基礎");
  assert.equal(calculationRequired({ question_text: "次の資料に基づきWACCを計算せよ。【資料】負債400万円、株主資本600万円" }), true);
});

test("全問題の構造監査で正答不能・重複選択肢・文字化けを残さない", () => {
  const report = auditQuestions(content.questions);
  assert.equal(report.total, 2474);
  assert.equal(report.missingCorrectOptions.length, 0);
  assert.equal(report.duplicateOptionTexts.length, 0);
  assert.equal(report.replacementCharacters.length, 0);
  assert.equal(report.emptyExplanations.length, 0);
  assert.equal(report.serializedExplanationCandidates.length, 0);
  assert.equal(report.missingThoughtFlow.length, 0);
  assert.equal(report.directAnswerSummaries.length, 0);
  assert.equal(report.answerConclusionRecaps.length, 0);
  assert.equal(report.explicitOptionJudgments.length, 0);
  assert.equal(report.explanationSectionLabels.length, 0);
  assert.equal(report.standaloneCautions.length, 0);
  assert.equal(report.unresolvedContentWarnings.length, 0);
  assert.equal(report.exactDuplicateQuestions.length, 0);
  assert.equal(report.samePromptGroups.length, 36);
});

test("完全重複を除外し、2026年版白書の出典付き補充問題を収録する", () => {
  assert.equal(content.questions.some((question) => question.id === "operations:S-4540"), false);
  const supplements = content.questions.filter((question) => question.source === "official-2026-whitepaper");
  assert.equal(supplements.length, 12);
  assert.ok(supplements.every((question) => question.sourceReference?.url && question.sourceReference?.checkedAt === "2026-08-16"));
  assert.deepEqual([...new Set(supplements.map((question) => question.minimumCourse))].sort(), [60, 70, 80]);
});

test("判明した問題・正答不整合を計算結果と現行制度へ合わせる", () => {
  const expected = {
    "finance:S-5150": ["エ", "2.0"],
    "finance:S-5199": ["ア", "売上高売上原価率:A 売上高営業利益率:A 総資本回転率:A"],
    "operations:S-4831": ["ウ", "505"],
    "operations:S-4993": ["ア", "10"],
    "sme:Q932": ["ア", "A:創造的 B:個人"]
  };
  for (const [id, [answer, label]] of Object.entries(expected)) {
    const question = content.questions.find((item) => item.id === id);
    assert.equal(question.answer, answer);
    assert.equal(question.options.find((option) => option.id === answer).label, label);
    assert.equal(gradeQuestion(question, answer).correct, true);
  }
  assert.equal(content.questions.find((question) => question.id === "finance:S-5209").calculationRequired, true);
  assert.equal(content.questions.find((question) => question.id === "operations:S-4827").calculationRequired, true);
  const maruke = content.questions.find((question) => question.id === "sme:S-0352");
  assert.match(maruke.options.find((option) => option.id === "A").label, /賃上げ貸付利率特例制度/);
  assert.equal(maruke.answer, "D");
  assert.equal(content.questions.find((question) => question.id === "sme:S-0127").options.find((option) => option.id === "イ").label, "インボイス枠");
  assert.match(content.questions.find((question) => question.id === "sme:S-0444").options.find((option) => option.id === "A").label, /グローバル枠/);
  assert.match(content.questions.find((question) => question.id === "sme:S-0543").options.find((option) => option.id === "ア").label, /16%/);
  assert.match(content.questions.find((question) => question.id === "sme:S-0738").options.find((option) => option.id === "イ").label, /3\.5%/);
});
