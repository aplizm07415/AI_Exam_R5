const test = require("node:test");
const assert = require("node:assert/strict");
const { Readable } = require("node:stream");
const { harness } = require("./helpers/app-harness");
const { questionsById, questionBank } = require("../src/content");
const { gradeQuestion } = require("../src/grading");
const { handler } = require("../server");
const Learning = require("../public/learning");

function gradeApi(body) {
  return new Promise((resolve, reject) => {
    const request = Readable.from([JSON.stringify(body)]);
    Object.assign(request, { method: "POST", url: "/api/grade", headers: { host: "test.local" } });
    const response = {
      statusCode: 200,
      writeHead(status) { this.statusCode = status; },
      end(data) { resolve({ status: this.statusCode, body: JSON.parse(String(data)) }); }
    };
    Promise.resolve(handler(request, response)).catch(reject);
  });
}

async function practice(h) {
  await h.run("beginRemote({ subject: 'law', limit: 2, seed: 'unknown-answer' })");
  return h.run("session[0].id");
}

test("わからない指定は選択済みの正答や空文字正答を含め全形式で0点とし、解説を返す", () => {
  for (const [type, answer] of [["single_choice", "A"], ["multiple_choice", ["A", "B"]], ["numeric", 0], ["text", ""]]) {
    const question = { id: "unknown-unit", type, answer, points: 4, explanation: "確認する根拠", originalExplanation: "元の根拠" };
    assert.equal(gradeQuestion(question, answer).correct, true);
    const result = gradeQuestion(question, answer, { answerStatus: "unknown" });
    assert.equal(result.answerStatus, "unknown");
    assert.equal(result.correct, false);
    assert.equal(result.score, 0);
    assert.equal(result.normalizedAnswer, "");
    assert.deepEqual(result.correctAnswer, answer);
    assert.equal(result.explanation, question.explanation);
    assert.equal(result.originalExplanation, question.originalExplanation);
  }
});

test("わからないの採点APIも教材版・出題停止を確認し、通常採点と区別する", async () => {
  const question = questionsById.get("finance:S-5469");
  const request = { questionId: question.id, contentVersion: question.contentVersion, answer: question.answer };
  const unknown = await gradeApi({ ...request, answerStatus: "unknown" });
  assert.equal(unknown.status, 200);
  assert.equal(unknown.body.answerStatus, "unknown");
  assert.equal(unknown.body.correct, false);
  assert.equal(unknown.body.score, 0);
  assert.ok(unknown.body.explanation);
  assert.equal((await gradeApi({ ...request, answerStatus: "unknown", contentVersion: 1 })).status, 409);
  const stopped = questionBank.find((item) => item.qualityStatus === "quarantined");
  assert.equal((await gradeApi({ questionId: stopped.id, answerStatus: "unknown" })).status, 404);
  assert.equal((await gradeApi({ ...request, answerStatus: "invalid" })).status, 400);
  const normal = await gradeApi(request);
  assert.equal(normal.body.answerStatus, "answered");
  assert.equal(normal.body.correct, true);
});

test("未選択でわからないを押すと一度だけ不正解を保存し、解説・到達判定・翌日の復習へ反映する", async () => {
  const h = harness();
  const id = await practice(h);
  assert.match(h.element("#app").innerHTML, /data-unknown/);
  h.clock.now += 12000;
  await h.click("unknown");
  const record = h.json("activeSession.results[0]");
  assert.equal(record.questionId, id);
  assert.equal(record.answerStatus, "unknown");
  assert.equal(record.submittedAnswer, "");
  assert.equal(record.correct, false);
  assert.equal(record.assessmentEligible, true);
  assert.equal(record.elapsedMs, 12000);
  assert.equal(h.run("currentAttempt().status"), "graded");
  assert.equal(h.run("assessmentRecords().length"), 1);
  assert.equal(h.run("assessmentRecords()[0].correct"), false);
  assert.equal(h.run("courseProgress(60, 'law').answered"), 1);
  assert.equal(h.run("courseProgress(60, 'law').rate"), 0);
  assert.ok(h.json("reviewQuestionIds('incorrect')").includes(id));
  const schedule = Learning.reviewSchedule([record], id);
  assert.equal(schedule.intervalDays, 1);
  assert.equal(schedule.streak, 0);
  assert.equal(Date.parse(schedule.dueAt) - Date.parse(record.answeredAt), Learning.DAY);
  assert.match(h.element("#app").innerHTML, /わからない.*不正解/s);
  assert.match(h.element("#app").innerHTML, /判断の根拠/);
  assert.doesNotMatch(h.element("#app").innerHTML, /aria-checked="true"/);
  await h.click("unknown");
  await h.click("grade");
  await h.click("select-choice", record.correctAnswer);
  assert.equal(h.run("practiceRecords().length"), 1);
  assert.equal(h.run("currentAttempt().selectedAnswer"), "");
});

test("選択済みでもわからないで確定でき、通信失敗なら選択と未採点状態を保持する", async () => {
  const h = harness();
  const id = await practice(h);
  const answer = questionsById.get(id).answer;
  await h.click("select-choice", answer);
  const original = h.context.fetch;
  h.context.fetch = async (url, options) => url === "/api/grade" ? h.response({}, 503) : original(url, options);
  await h.click("unknown");
  assert.equal(h.run("practiceRecords().length"), 0);
  assert.equal(h.run("currentAttempt().status"), "answering");
  assert.equal(h.run("currentAttempt().selectedAnswer"), answer);
  assert.equal(h.run("feedbackCache.size"), 0);
  h.context.fetch = original;
  await h.click("unknown");
  assert.equal(h.run("practiceRecords()[0].correct"), false);
  assert.equal(h.run("practiceRecords()[0].answerStatus"), "unknown");
  assert.equal(h.run("currentAttempt().selectedAnswer"), "");
  assert.ok(!h.json("state.answers")[id]);
});

test("わからないの履歴は再読込後も残り、空回答でも解説を再表示できる", async () => {
  const h = harness();
  const id = await practice(h);
  const sessionId = h.run("activeSession.id");
  await h.click("unknown");
  const record = h.json("practiceRecords()[0]");
  await h.click("quit-session");
  await h.run("persistNow()");
  const reloaded = harness({ storage: h.storage, now: new Date(h.clock.now + 3600000).toISOString() });
  await reloaded.run("initializePersistence()");
  await reloaded.run(`resumePracticeSession(${JSON.stringify(sessionId)})`);
  await reloaded.click("jump", "0");
  assert.equal(reloaded.run("session[currentIndex].id"), id);
  assert.match(reloaded.element("#app").innerHTML, /わからない/);
  assert.equal(reloaded.run("currentAttempt().selectedAnswer"), "");
  await reloaded.click("grade");
  assert.match(reloaded.element("#app").innerHTML, /判断の根拠/);
  assert.equal(reloaded.run("practiceRecords().length"), 1);
  assert.equal(reloaded.run("practiceRecords()[0].answerStatus"), "unknown");
  assert.equal(reloaded.run("practiceRecords()[0].answeredAt"), record.answeredAt);
  assert.ok(Date.parse(reloaded.run("practiceRecords()[0].explanationViewedAt")) > Date.parse(record.explanationViewedAt));
  assert.equal(reloaded.calls.some((call) => /選択肢を選んで/.test(call.alert || "")), false);
});

test("わからないの通信中は連打・通常採点を重ねず、採点済みの回答も変更しない", async () => {
  const h = harness();
  const id = await practice(h);
  const original = h.context.fetch;
  let release, entered, requests = 0;
  const started = new Promise((resolve) => { entered = resolve; });
  h.context.fetch = async (url, options) => {
    if (url === "/api/grade") {
      requests += 1;
      entered();
      await new Promise((resolve) => { release = resolve; });
    }
    return original(url, options);
  };
  const pending = h.click("unknown");
  await started;
  await h.click("unknown");
  await h.click("grade");
  await h.click("select-choice", questionsById.get(id).answer);
  assert.equal(requests, 1);
  release();
  await pending;
  assert.equal(h.run("practiceRecords().length"), 1);
  h.context.fetch = original;
  await h.click("next");
  const nextId = h.run("session[currentIndex].id");
  await h.click("select-choice", questionsById.get(nextId).answer);
  await h.click("grade");
  await h.click("unknown");
  assert.equal(h.run("practiceRecords().length"), 2);
  assert.equal(h.run("practiceRecords()[1].correct"), true);
  assert.equal(h.run("practiceRecords()[1].answerStatus"), "answered");
});

test("日次演習と誤答復習でわからないを使え、公式模試には追加しない", async () => {
  const h = harness();
  await h.run("beginDailyAllocation()");
  const id = h.run("session[0].id");
  await h.click("unknown");
  assert.equal(h.run("practiceRecords()[0].answerStatus"), "unknown");
  await h.click("finish-session");
  await h.run("beginDailyAllocation()");
  assert.equal(h.json("session.map(item => item.id)").includes(id), false);
  await h.click("quit-session");
  await h.run("startReview('incorrect')");
  assert.equal(h.run("session[0].id"), id);
  await h.click("unknown");
  assert.equal(h.run("activeSession.results[0].answerStatus"), "unknown");
  assert.equal(h.run("activeSession.results[0].assessmentEligible"), false, "直後の再回答は実力判定から除く");
  await h.click("quit-session");
  h.run("startOfficialMock('law')");
  assert.doesNotMatch(h.element("#app").innerHTML, /data-unknown/);
});

test("保存競合で別端末の先行採点が優先されたら、わからないと通常回答の表示もその記録へ揃える", async () => {
  for (const localUnknown of [true, false]) {
    let remote, puts = 0;
    const h = harness({ progressFetch: (url, options, response) => {
      if (options.method !== "PUT") return response(remote || { configured: true, exists: false, version: 0, deletedSessionIds: [] });
      const body = JSON.parse(options.body);
      puts += 1;
      if (puts === 1) {
        const syncedState = { ...body.state, sessions: structuredClone(body.sessions) };
        const record = syncedState.sessions[0].results[0];
        record.answeredAt = new Date(Date.parse(record.answeredAt) - 1000).toISOString();
        record.correct = localUnknown;
        record.submittedAnswer = localUnknown ? record.correctAnswer : "";
        if (localUnknown) delete record.answerStatus; // Older clients omit the normal-answer marker.
        else record.answerStatus = "unknown";
        syncedState.sessions[0].lastActivityAt = new Date(h.clock.now + 1000).toISOString();
        remote = { configured: true, exists: true, version: 1, state: syncedState, deletedSessionIds: [] };
        return response({ error: "version_conflict" }, 409);
      }
      return response({ configured: true, version: 2 });
    } });
    await h.run("initializePersistence()");
    const id = await practice(h);
    h.clock.now += 10000;
    if (!localUnknown) await h.click("select-choice", questionsById.get(id).answer);
    await h.click(localUnknown ? "unknown" : "grade");
    assert.equal(puts, 2);
    assert.equal(h.run("practiceRecords().length"), 1);
    const record = h.json("practiceRecords()[0]");
    const feedback = h.json("feedbackCache.get(currentAttempt().attemptId)");
    assert.equal(record.correct, localUnknown);
    assert.equal(feedback.correct, record.correct);
    assert.equal(feedback.answerStatus, record.answerStatus || "answered");
    assert.equal(h.run("currentAttempt().selectedAnswer"), record.submittedAnswer);
    const html = h.element("#app").innerHTML;
    if (localUnknown) {
      assert.match(html, /feedback-result-banner"><strong>正解/);
      assert.doesNotMatch(html, /わからない（不正解として記録）/);
    } else assert.match(html, /feedback-result-banner"><strong>わからない（不正解として記録）/);
  }
});
