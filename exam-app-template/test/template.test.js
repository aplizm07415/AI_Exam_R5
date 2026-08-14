const test = require("node:test");
const assert = require("node:assert/strict");
const { Readable } = require("node:stream");

const { content, publicContent, validateContent } = require("../src/content");
const { gradeQuestion } = require("../src/grading");
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

test("公開データに正答と解説を含めない", () => {
  const result = publicContent();
  assert.equal(result.questions.length, content.questions.length);
  assert.equal("answer" in result.questions[0], false);
  assert.equal("explanation" in result.questions[0], false);
});

test("4種類の問題を採点できる", () => {
  for (const question of content.questions) assert.equal(gradeQuestion(question, question.answer).correct, true);
  const numeric = content.questions.find((question) => question.type === "numeric");
  assert.equal(gradeQuestion(numeric, "３0円").correct, true);
  const text = content.questions.find((question) => question.type === "text");
  assert.equal(gradeQuestion(text, text.aliases[0]).correct, true);
});

test("教材設定の不整合を起動前に検出する", () => {
  const invalid = JSON.parse(JSON.stringify(content));
  invalid.questions[0].subject = "missing";
  assert.throws(() => validateContent(invalid), /subjectsにありません/);
});

test("APIが教材を配信し採点する", async () => {
  const catalog = await dispatch("/api/content");
  assert.equal(catalog.status, 200);
  assert.equal((await catalog.json()).exam.id, "sample-exam");
  const question = content.questions[0];
  const graded = await dispatch("/api/grade", { method: "POST", body: JSON.stringify({ questionId: question.id, answer: question.answer }) });
  assert.equal(graded.status, 200);
  assert.equal((await graded.json()).correct, true);
});

test("保存状態は許可したフィールドだけ受け付ける", () => {
  assert.equal(validState({ schemaVersion: 1, answers: {}, results: {} }), true);
  assert.equal(validState({ answers: {}, admin: true }), false);
});
