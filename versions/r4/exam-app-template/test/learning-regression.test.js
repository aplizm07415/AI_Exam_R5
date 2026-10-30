const test = require("node:test");
const assert = require("node:assert/strict");
const { harness } = require("./helpers/app-harness");
const Learning = require("../public/learning");

function registerFixtureQuestions(h) {
  h.run(`content.questionQuality = { quarantinedQuestionIds: [], questions: Object.fromEntries(
    state.sessions.flatMap(item => item.results).map(record => [record.questionId, {
      subject: record.subject, minimumCourse: record.minimumCourse,
      foundationCheckpoint: record.foundationCheckpoint, contentVersion: 1, minimumScoringVersion: 1
    }])) };
    content.questionQuality.bankTotal = Object.keys(content.questionQuality.questions).length;`);
}

test("80点追加層の対象が少ない科目では科目別必要数の合計で全体を判定する", () => {
  const h = harness();
  h.run(`content.courseCounts[80].addedSubjects = { finance: 10, operations: 10, law: 4, sme: 10 };
    content.courseCounts[80].addedAtCourse = 34;
    state.sessions = content.subjects.flatMap(subject => Array.from({ length: 4 }, (_, part) => ({
      id: subject.id + '-tier-' + part, type: 'practice',
      results: Array.from({ length: content.courseCounts[80].addedSubjects[subject.id] }, (_, index) => ({
        questionId: 'tier-test:' + subject.id + ':' + index, subject: subject.id, minimumCourse: 80,
        correct: true, answeredAt: '2026-09-0' + (part + 1) + 'T00:00:00Z'
      })).filter((_, index) => index % 4 === part)
    })));`);
  registerFixtureQuestions(h);
  assert.equal(h.run("tierProgress(80, 'law').requiredQuestions"), 4);
  assert.equal(h.run("tierProgress(80, 'law').passed"), true);
  assert.equal(h.run("content.subjects.every(subject => tierProgress(80, subject.id).passed === true)"), true);
  assert.equal(h.run("tierProgress(80).requiredQuestions"), 34);
  assert.equal(h.run("tierProgress(80).answered"), 34);
  assert.equal(h.run("tierProgress(80).passed"), true);

  h.run("state.sessions = state.sessions.filter(item => item.id !== 'law-tier-3')");
  assert.equal(h.run("tierProgress(80, 'law').passed"), false);
  assert.equal(h.run("tierProgress(80).passed"), false);
});

test("隔離後の60点チェックポイント必要数表示と段階開放を科目別対象数へ揃える", () => {
  const h = harness();
  h.run(`content.foundationCheckpointCounts[1] = { total: 10, subjects: { finance: 2, operations: 3, law: 1, sme: 4 } };
    state.sessions = content.subjects.flatMap(subject => Array.from({ length: 2 }, (_, part) => ({
      id: subject.id + '-checkpoint-' + part, type: 'practice',
      results: Array.from({ length: content.foundationCheckpointCounts[1].subjects[subject.id] }, (_, index) => ({
        questionId: 'checkpoint-test:' + subject.id + ':' + index, subject: subject.id,
        minimumCourse: 60, foundationCheckpoint: 1, correct: true,
        answeredAt: '2026-09-0' + (part + 1) + 'T00:00:00Z'
      }))
    })));`);
  registerFixtureQuestions(h);
  assert.equal(h.run("foundationCheckpointProgress(1).requiredQuestions"), 10);
  assert.equal(h.run("foundationCheckpointProgress(1).answered"), 10);
  assert.equal(h.run("foundationCheckpointProgress(1, 'law').requiredQuestions"), 1);
  assert.equal(h.run("foundationCheckpointProgress(1, 'law').passed"), true);
  assert.equal(h.run("foundationCheckpointProgress(1).passed"), true);
  assert.equal(h.run("isFoundationCheckpointUnlocked(2)"), true);

  h.run("state.sessions = state.sessions.map(item => ({ ...item, results: item.results.filter(record => record.questionId !== 'checkpoint-test:finance:1') }))");
  assert.equal(h.run("foundationCheckpointProgress(1).passed"), false);
  assert.equal(h.run("isFoundationCheckpointUnlocked(2)"), false);

  h.run("content.foundationCheckpointCounts[1].subjects.finance = 0");
  assert.equal(h.run("foundationCheckpointProgress(1, 'finance').passed"), false);
  assert.equal(h.run("foundationCheckpointProgress(1).passed"), false);
});

test("選択・採点・再演習を実クリックで検証し、解説の漏れと重複計上を防ぐ", async () => {
  const h = harness();
  await h.run("beginRemote({ subject: 'finance', limit: 1, seed: 'regression' })");
  const id = h.run("session[0].id");
  const wrong = h.run("session[0].options[0].id");
  await h.click("select-choice", wrong);
  assert.equal(h.run("currentAttempt().selectedAnswer"), wrong);
  await h.run("gradeCurrent()");
  const answer = h.run("activeSession.results[0].correctAnswer");
  await h.click("select-choice", answer);
  await h.run("gradeCurrent()");
  assert.equal(h.run("activeSession.results.length"), 1);
  assert.equal(h.run("currentAttempt().selectedAnswer"), wrong);
  assert.equal(h.run("feedbackCache.size"), 1);
  await h.run(`beginRemote({ ids: ${JSON.stringify(id)}, limit: 1 })`);
  assert.equal(h.run("currentAttempt().selectedAnswer"), "");
  assert.equal(h.run("feedbackCache.size"), 0);
  assert.doesNotMatch(h.element("#app").innerHTML, /feedback-result-banner/);
  await h.click("select-choice", answer);
  await h.run("gradeCurrent()");
  assert.equal(h.run("activeSession.results[0].assessmentEligible"), false);
  assert.equal(h.run("assessmentRecords().length"), 1);
});

test("日次割当は中断位置を保存し、回答済み問題を新しい試行で繰り返さない", async () => {
  const h = harness();
  await h.run("beginDailyAllocation()");
  const firstSession = h.run("activeSession.id");
  const firstQuestion = h.run("session[0].id");
  await h.click("select-choice", h.run("session[0].options[0].id"));
  await h.run("gradeCurrent()");
  await h.click("quit-session");
  await h.run("beginDailyAllocation()");
  assert.equal(h.run("activeSession.id"), firstSession);
  assert.notEqual(h.run("session[currentIndex].id"), firstQuestion);
  await h.click("finish-session");
  await h.run("beginDailyAllocation()");
  assert.equal(h.run(`session.some((question) => question.id === ${JSON.stringify(firstQuestion)})`), false);
});

test("模試の答案が再読込で残り、同じ模試を二重計上せず時間外変更を拒む", async () => {
  const h = harness();
  h.run("startOfficialMock('finance')");
  const slot = h.run("content.officialExam.subjects.finance.answerSlots[0].id");
  const target = { dataset: { mockAnswer: slot }, value: "ア", matches(selector) { return selector === "[data-mock-answer]"; } };
  await h.dispatch("change", target);
  await h.run("persistNow()");
  h.clock.now += 60 * 60000;
  target.value = "イ";
  await h.dispatch("change", target);
  assert.equal(h.run(`currentMock().answers[${JSON.stringify(slot)}]`), "ア");
  const reloaded = harness({ storage: h.storage, now: new Date(h.clock.now).toISOString() });
  await reloaded.run("initializePersistence()");
  reloaded.run("startOfficialMock('finance')");
  assert.equal(reloaded.run(`currentMock().answers[${JSON.stringify(slot)}]`), "ア");
  await reloaded.run("gradeMock()");
  await reloaded.run("gradeMock()");
  assert.equal(reloaded.run("state.sessions.filter((entry) => entry.type === 'official-mock').length"), 1);
  assert.equal(reloaded.run("currentMock().mockMinutes"), 60);
  reloaded.run("rebuildAggregatesFromSessions()");
  assert.ok(reloaded.run("state.mockResults.finance.details.length") > 0);
  assert.equal(reloaded.run("practiceRecords().length"), 0);
});

test("旧自動アーカイブを解除し、その日の最初の自力回答で復習期限を決める", () => {
  const h = harness();
  h.run("state.archived = { old: {reason: 'auto', archivedAt: '2026-09-01'}, manual: true }; rebuildAggregatesFromSessions()");
  assert.equal(h.run("isArchived('old')"), false);
  assert.equal(h.run("isArchived('manual')"), true);
  const records = [false, true].map((correct, index) => ({ questionId: "q", correct, answeredAt: `2026-09-01T10:0${index}:00Z` }));
  assert.equal(Learning.reviewSchedule(records, "q").lastCorrect, false);
  assert.equal(Learning.reviewSchedule(records, "q").intervalDays, 1);
});

test("表示の解説は4番目以降の手順や長い式の結論を省略しない", () => {
  const h = harness();
  h.context.explanationTest = { explanation: "まず、条件。\n\n次に、" + "計算".repeat(200) + "重要な式。\n\n続いて、検算。\n\n最後に、最後の根拠。" };
  const markup = h.run("guidedFeedbackExplanationMarkup({}, explanationTest)");
  assert.match(markup, /重要な式/);
  assert.match(markup, /最後の根拠/);
  assert.doesNotMatch(markup, /…/);
});

test("演習の再開ボタンから選択と中断位置を復元し、離席時間を加算しない", async () => {
  const h = harness();
  await h.run("beginRemote({ subject: 'finance', limit: 3, seed: 'resume-clock' })");
  h.clock.now += 15000;
  await h.click("next");
  assert.equal(h.run("activeSession.attempts[session[0].id].elapsedMs"), 15000);
  assert.equal(h.run("activeSession.attempts[session[0].id].activeSince"), null);
  h.clock.now += 10000;
  const selected = h.run("session[currentIndex].options[0].id");
  await h.click("select-choice", selected);
  const id = h.run("activeSession.id");
  const question = h.run("session[currentIndex].id");
  // Reload without beforeunload also must not charge the offline interval.
  await h.run("persistNow()");
  const reloaded = harness({ storage: h.storage, now: new Date(h.clock.now + 2 * 86400000).toISOString() });
  await reloaded.run("initializePersistence()");
  reloaded.run("renderLibrary()");
  assert.match(reloaded.element("#app").innerHTML, /data-resume-session/);
  await reloaded.click("resume-session", id);
  assert.equal(reloaded.run("session[currentIndex].id"), question);
  assert.equal(reloaded.run("currentAttempt().selectedAnswer"), selected);
  assert.equal(reloaded.run("currentAttempt().elapsedMs"), 10000);
  reloaded.clock.now += 5000;
  await reloaded.run("gradeCurrent()");
  assert.equal(reloaded.run("activeSession.results[0].elapsedMs"), 15000);
});

test("採点中の画面ジャンプを拒み、未完了リクエストからも再開できる", async () => {
  const h = harness();
  await h.run("beginRemote({ subject: 'law', limit: 3, seed: 'busy' })");
  h.run("gradingQuestionId = session[0].id; currentAttempt().status = 'grading'");
  await h.click("jump", "2");
  assert.equal(h.run("currentIndex"), 0);
  const id = h.run("activeSession.id");
  await h.run("persistNow()");
  const reloaded = harness({ storage: h.storage });
  await reloaded.run("initializePersistence()");
  await reloaded.click("resume-session", id);
  assert.equal(reloaded.run("currentAttempt().status"), "answering");
  await reloaded.click("prev");
  assert.equal(reloaded.run("currentIndex"), 0);
  await reloaded.click("jump", "99");
  assert.equal(reloaded.run("currentIndex"), 0);
});

test("履歴から採点済み模試の答案を開いても新しい模試を作らない", async () => {
  const h = harness();
  h.run("startOfficialMock('finance')");
  h.clock.now += 60000;
  await h.run("gradeMock()");
  const id = h.run("currentMock().id");
  h.run("setView('history')");
  assert.match(h.element("#app").innerHTML, /data-open-mock/);
  await h.click("open-mock", id);
  assert.equal(h.run("state.sessions.length"), 1);
  assert.match(h.element("#app").innerHTML, /採点済み/);
  assert.equal(h.run("sessionSummary(currentMock()).answered"), 0);
});

test("過去の解説を今日再表示した直後の再演習は実力判定に加えない", async () => {
  const h = harness();
  await h.run("beginRemote({ subject: 'law', limit: 1, seed: 'exposure' })");
  await h.click("select-choice", h.run("session[0].options[0].id"));
  await h.run("gradeCurrent()");
  const id = h.run("session[0].id");
  const saved = h.run("activeSession.id");
  await h.click("quit-session");
  h.clock.now += 3 * 86400000;
  await h.click("resume-session", saved);
  await h.run("gradeCurrent()");
  await h.run(`beginRemote({ ids: ${JSON.stringify(id)}, limit: 1 })`);
  assert.equal(h.run("currentAttempt().assessmentEligible"), false);
  assert.equal(h.run("state.sessions[0].results.length"), 1);
});

test("採点通信中の同期後も最新のセッションに結果を保存し、削除は優先する", async () => {
  for (const deleted of [false, true]) {
    const h = harness();
    await h.run("beginRemote({ subject: 'law', limit: 1, seed: 'merge-during-grade' })");
    await h.click("select-choice", h.run("session[0].options[0].id"));
    const id = h.run("activeSession.id");
    const originalFetch = h.context.fetch;
    let release, entered;
    const started = new Promise((resolve) => { entered = resolve; });
    h.context.fetch = async (url, options) => {
      if (url === "/api/grade") { entered(); await new Promise((resolve) => { release = resolve; }); }
      return originalFetch(url, options);
    };
    const grading = h.run("gradeCurrent()");
    await started;
    h.context.remoteDuringGrade = { configured: true, exists: true, version: 1,
      state: h.json("state"), deletedSessionIds: deleted ? [id] : [] };
    h.run("acceptRemoteProgress(remoteDuringGrade)");
    release();
    await grading;
    assert.equal(h.run("practiceRecords().length"), deleted ? 0 : 1);
    if (deleted) assert.equal(h.run("currentView"), "practice");
  }
});

test("模試も採点通信中の同期先へ記録し、削除された答案を復活させない", async () => {
  for (const deleted of [false, true]) {
    const h = harness();
    h.run("startOfficialMock('finance')");
    const id = h.run("currentMock().id");
    const originalFetch = h.context.fetch;
    let release, entered;
    const started = new Promise((resolve) => { entered = resolve; });
    h.context.fetch = async (url, options) => {
      if (url === "/api/mock/grade") { entered(); await new Promise((resolve) => { release = resolve; }); }
      return originalFetch(url, options);
    };
    const grading = h.run("gradeMock()");
    await started;
    h.context.remoteDuringGrade = { configured: true, exists: true, version: 1,
      state: h.json("state"), deletedSessionIds: deleted ? [id] : [] };
    h.run("acceptRemoteProgress(remoteDuringGrade)");
    release();
    await grading;
    assert.equal(h.run("state.sessions.filter((s) => s.mockResult).length"), deleted ? 0 : 1);
    if (deleted) assert.equal(h.run("currentView"), "mock");
  }
});

test("4科目とも実戦補強は実施証跡を必要とし、学習時間の入力だけで完了にしない", () => {
  const h = harness();
  h.run(`for (const [subject, plan] of Object.entries(content.studyPlans.subjects)) {
    const assessments = plan.courses.flatMap(c => c.groups.flatMap(g => g.items)).filter(i => i.evidenceType === 'assessment');
    if (!assessments.length) throw new Error(subject + ': missing independent assessment');
  }`);
  h.run("testExternalItem = content.studyPlans.subjects.sme.courses.flatMap(c => c.groups.flatMap(g => g.items)).find(i => /各問題の資料名/.test(i.text))");
  assert.equal(h.run("testExternalItem.evidenceType"), "external");
  h.run("state.plan.evidence = { x: {kind:'activity',subject:'sme',source:'2026年版白書',completedAt:'2026-09-05',minutes:30,itemText:testExternalItem.text,confirmedCompletion:false} }");
  assert.equal(h.run("autoItemStatus('sme',80,testExternalItem).passed"), false);
  h.run("state.plan.evidence.x.confirmedCompletion=true");
  assert.equal(h.run("autoItemStatus('sme',80,testExternalItem).passed"), true);
  h.run("state.plan.evidence.x.itemText='別項目'");
  assert.equal(h.run("autoItemStatus('sme',80,testExternalItem).passed"), false);
});

test("採点前に電卓を使った回答は練習として残し、自力の到達判定に混ぜない", async () => {
  const h = harness();
  await h.run("beginRemote({ ids: 'finance:S-5248', limit: 1 })");
  h.run("useCalculator('digit', '7')");
  await h.click("select-choice", "ウ");
  await h.run("gradeCurrent()");
  assert.equal(h.run("activeSession.results[0].correct"), true);
  assert.equal(h.run("activeSession.results[0].calculatorUsed"), true);
  assert.equal(h.run("practiceRecords().length"), 1);
  assert.equal(h.run("assessmentRecords().length"), 0);
  assert.match(h.element("#app").innerHTML, /電卓を使った回答/);
});
