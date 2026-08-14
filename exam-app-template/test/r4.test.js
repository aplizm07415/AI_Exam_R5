const test = require("node:test");
const assert = require("node:assert/strict");
const { Readable } = require("node:stream");

const { content, officialExam, publicContent, queryQuestions, validateContent } = require("../src/content");
const { gradeQuestion, gradeOfficialExam } = require("../src/grading");
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

test("Azure由来の4科目2,463問を一意なIDで読み込む", () => {
  assert.equal(content.exam.id, "r4");
  assert.equal(content.subjects.length, 4);
  assert.equal(content.questions.length, 2463);
  assert.equal(new Set(content.questions.map((question) => question.id)).size, 2463);
  assert.deepEqual(Object.fromEntries(content.subjects.map((subject) => [subject.id, content.questions.filter((question) => question.subject === subject.id).length])), {
    finance: 493,
    operations: 564,
    law: 489,
    sme: 917
  });
});

test("公開カタログは正答・解説・Azureファイル名を配信しない", () => {
  const result = publicContent();
  assert.equal(result.totals.questions, 2463);
  assert.equal(result.subjects[0].sourceFile, undefined);
  assert.equal(result.officialExam.subjects.finance.answers, undefined);
  const selected = queryQuestions({ subject: "finance", limit: 3, seed: "test" });
  assert.equal(selected.questions.length, 3);
  assert.equal("answer" in selected.questions[0], false);
  assert.equal("explanation" in selected.questions[0], false);
});

test("60・70・80点コースで問題範囲を段階開放する", () => {
  const sixty = queryQuestions({ course: 60, limit: 100, seed: "same" });
  const eighty = queryQuestions({ course: 80, limit: 100, seed: "same" });
  assert.ok(sixty.questions.every((question) => question.minimumCourse <= 60));
  assert.ok(eighty.questions.some((question) => question.minimumCourse > 60));
});

test("通常問題と令和8年度公式模試をサーバー採点する", () => {
  const question = content.questions[0];
  const graded = gradeQuestion(question, question.answer);
  assert.equal(graded.correct, true);
  assert.ok(graded.correctAnswerText);
  const officialAnswers = Object.fromEntries(officialExam.subjects.finance.answers.map((item) => [item.id, item.answer]));
  const mock = gradeOfficialExam(officialExam, "finance", officialAnswers);
  assert.equal(mock.score, 100);
  assert.equal(mock.maxScore, 100);
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
});

test("保存状態はR4の許可フィールドだけ受け付ける", () => {
  assert.equal(validState({ schemaVersion: 2, answers: {}, results: {}, attempts: {}, mockResults: {}, plan: {} }), true);
  assert.equal(validState({ answers: {}, admin: true }), false);
});
