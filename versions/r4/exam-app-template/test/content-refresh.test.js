const test = require("node:test");
const assert = require("node:assert/strict");
const { harness } = require("./helpers/app-harness");

async function prepared() {
  const h = harness();
  await h.run("beginRemote({subject:'law',limit:2,seed:'content-refresh'})");
  await h.click("select-choice", h.run("session[0].options[0].id"));
  return h;
}

function catalogueUpdate(h, status) {
  const [question, unchanged] = h.json("session");
  const before = h.json("content");
  const after = structuredClone(before);
  const reviewed = after.questionQuality.questions[question.id];
  Object.assign(reviewed, status === 404
    ? { status: "quarantined", reviewedAt: "2026-09-09" }
    : { contentVersion: 2, minimumScoringVersion: 2, status: "corrected", reviewedAt: "2026-09-09" });
  if (status === 404) {
    after.questionQuality.quarantinedQuestionIds.push(question.id);
    after.questionQuality.availableTotal -= 1;
    after.totals.questions -= 1;
  }
  // A catalogue revision can also correct classification without voiding a grade.
  Object.assign(after.questionQuality.questions[unchanged.id], { minimumCourse: 70, foundationCheckpoint: null });
  after.foundationCheckpointCounts[question.foundationCheckpoint].subjects[question.subject] -= status === 404 ? 2 : 1;
  after.foundationCheckpointCounts[question.foundationCheckpoint].total -= status === 404 ? 2 : 1;
  delete after.foundationQuestionCheckpoints[unchanged.id];
  if (status === 404) delete after.foundationQuestionCheckpoints[question.id];
  after.courseCounts[60].addedAtCourse -= status === 404 ? 2 : 1;
  after.courseCounts[60].addedSubjects[question.subject] -= status === 404 ? 2 : 1;
  after.courseCounts[70].addedAtCourse += 1;
  after.courseCounts[70].addedSubjects[question.subject] += 1;
  h.context.oldResults = [question, unchanged].map((item, index) => ({
    questionId: item.id, subject: item.subject, topic: item.topic, topicId: item.topicId,
    minimumCourse: 60, foundationCheckpoint: item.foundationCheckpoint, contentVersion: 1,
    attemptId: `old-result-${index}`, correct: true, assessmentEligible: true, answeredAt: "2026-09-01T00:00:00Z"
  }));
  h.run(`state.sessions.push({ id: 'old-content-history', type: 'practice', status: 'completed',
    startedAt: '2026-09-01T00:00:00Z', lastActivityAt: '2026-09-01T00:00:00Z', results: oldResults });
    rebuildAggregatesFromSessions()`);
  assert.equal(h.run("assessmentRecords().length"), 2, "旧台帳では旧版の成績をまだ判定に含む");
  return { before, after, question, unchanged };
}

function delayedQuestionFetch(h, { gradeStatus = 409, empty = false } = {}) {
  const original = h.context.fetch;
  let release, entered;
  const started = new Promise((resolve) => { entered = resolve; });
  const updated = { ...h.json("session[0]"), contentVersion: 2, prompt: "更新された問題本文" };
  h.context.fetch = async (url, options) => {
    if (url === "/api/grade") return h.response({ error: gradeStatus === 409 ? "question_version_changed" : "question_not_found" }, gradeStatus);
    if (url.startsWith("/api/questions")) {
      entered();
      await new Promise((resolve) => { release = resolve; });
      return h.response({ questions: empty ? [] : [updated], total: empty ? 0 : 1 });
    }
    return original(url, options);
  };
  return { started, release() { release(); } };
}

test("新版の取得中に同期してもliveな試行へ再選択状態を保存し、削除は復活させない", async () => {
  for (const deleted of [false, true]) {
    const h = await prepared();
    const id = h.run("activeSession.id");
    const delayed = delayedQuestionFetch(h);
    const grading = h.run("gradeCurrent()");
    await delayed.started;
    const remote = h.json("state");
    remote.sessions[0].label = "同期後の演習";
    remote.sessions[0].lastActivityAt = new Date(h.clock.now + 1000).toISOString();
    h.context.remoteRefresh = { configured: true, exists: true, version: 1, state: remote, deletedSessionIds: deleted ? [id] : [] };
    h.run("acceptRemoteProgress(remoteRefresh)");
    delayed.release();
    await grading;
    assert.equal(h.run("practiceRecords().length"), 0);
    assert.equal(h.run("feedbackCache.size"), 0);
    if (deleted) {
      assert.equal(h.run("state.sessions.length"), 0);
      assert.equal(h.run("activeSession"), null);
      assert.equal(h.run("currentView"), "practice");
    } else {
      assert.equal(h.run("activeSession === state.sessions.find(item => item.id === activeSession.id)"), true);
      assert.equal(h.run("activeSession.label"), "同期後の演習");
      assert.equal(h.run("session[0].contentVersion"), 2);
      assert.equal(h.run("currentAttempt().contentVersion"), 2);
      assert.equal(h.run("currentAttempt().selectedAnswer"), "");
      assert.equal(h.run("currentAttempt().status"), "answering");
      assert.match(h.element("#app").innerHTML, /更新された問題本文/);
      assert.doesNotMatch(h.element("#app").innerHTML, /feedback-result-banner/);
    }
  }
});

test("新版の取得中に届いたさらに新しい試行は古い画面で上書きしない", async () => {
  const h = await prepared();
  const questionId = h.run("session[0].id");
  const delayed = delayedQuestionFetch(h);
  const grading = h.run("gradeCurrent()");
  await delayed.started;
  const remote = h.json("state");
  remote.sessions[0].lastActivityAt = new Date(h.clock.now + 1000).toISOString();
  Object.assign(remote.sessions[0].attempts[questionId], { attemptId: "newer-version-attempt", contentVersion: 3, selectedAnswer: "B", status: "answering" });
  h.context.remoteRefresh = { configured: true, exists: true, version: 1, state: remote, deletedSessionIds: [] };
  h.run("acceptRemoteProgress(remoteRefresh)");
  delayed.release();
  await grading;
  assert.equal(h.run("currentView"), "practice");
  assert.equal(h.run(`state.sessions[0].attempts[${JSON.stringify(questionId)}].contentVersion`), 3);
  assert.equal(h.run(`state.sessions[0].attempts[${JSON.stringify(questionId)}].selectedAnswer`), "B");
});

test("隔離問題の404と新版一覧の空応答は出題停止として扱い、旧問題の再採点を残さない", async () => {
  for (const status of [404, 409]) {
    const h = await prepared();
    const questionId = h.run("session[0].id");
    const delayed = delayedQuestionFetch(h, { gradeStatus: status, empty: true });
    const grading = h.run("gradeCurrent()");
    if (status === 409) { await delayed.started; delayed.release(); }
    await grading;
    assert.equal(h.run("currentView"), "practice");
    assert.equal(h.run("activeSession"), null);
    assert.equal(h.run("session.length"), 0);
    assert.equal(h.run(`state.sessions[0].questionIds.includes(${JSON.stringify(questionId)})`), false);
    assert.equal(h.run("state.sessions[0].questionCount"), 1);
    assert.equal(h.run(`state.sessions[0].attempts[${JSON.stringify(questionId)}]`), undefined);
    assert.equal(h.run("practiceRecords().length"), 0);
    assert.ok(h.calls.some((call) => /出題を停止/.test(call.alert || "")));
    assert.equal(h.calls.some((call) => /接続を確認/.test(call.alert || "")), false);
    await h.run("gradeCurrent()");
    assert.equal(h.run("practiceRecords().length"), 0);
  }
});

test("中断再開の問題取得中に同期・削除されても旧セッション参照を復活させない", async () => {
  for (const deleted of [false, true]) {
    const h = await prepared();
    const id = h.run("activeSession.id");
    await h.click("quit-session");
    const original = h.context.fetch;
    let release, entered;
    const started = new Promise((resolve) => { entered = resolve; });
    h.context.fetch = async (url, options) => {
      if (url.startsWith("/api/questions")) { entered(); await new Promise((resolve) => { release = resolve; }); }
      return original(url, options);
    };
    const resuming = h.run(`resumePracticeSession(${JSON.stringify(id)})`);
    await started;
    const remote = h.json("state");
    remote.sessions[0].lastActivityAt = new Date(h.clock.now + 1000).toISOString();
    remote.sessions[0].label = "再開中に同期した演習";
    h.context.remoteResume = { configured: true, exists: true, version: 1, state: remote, deletedSessionIds: deleted ? [id] : [] };
    h.run("acceptRemoteProgress(remoteResume)");
    release();
    await resuming;
    if (deleted) {
      assert.equal(h.run("state.sessions.length"), 0);
      assert.equal(h.run("activeSession"), null);
      assert.equal(h.run("currentView"), "practice");
    } else {
      assert.equal(h.run("activeSession === state.sessions.find(item => item.id === activeSession.id)"), true);
      assert.equal(h.run("activeSession.label"), "再開中に同期した演習");
      await h.click("select-choice", h.run("session[0].options[1].id"));
      await h.run("gradeCurrent()");
      assert.equal(h.run("practiceRecords().length"), 1);
    }
  }
});

test("演習画面への同期で新しい版の試行が届いたら古い問題の操作を止め、同版の同期は続行できる", async () => {
  for (const changedIndex of [0, 1]) {
    for (const newer of [false, true]) {
      const h = await prepared();
      const questions = h.json("session");
      const questionId = questions[changedIndex].id;
      const remote = h.json("state");
      remote.sessions[0].lastActivityAt = new Date(h.clock.now + 1000).toISOString();
      remote.sessions[0].attempts[questionId] = {
        ...remote.sessions[0].attempts[questionId], questionId,
        attemptId: `remote-synced-${changedIndex}`, contentVersion: newer ? 3 : questions[changedIndex].contentVersion,
        selectedAnswer: "B", eliminatedChoices: ["C"], status: "answering", activeSince: null
      };
      h.context.newerInSession = { configured: true, exists: true, version: 1, state: remote, deletedSessionIds: [] };
      h.run("acceptRemoteProgress(newerInSession)");
      if (newer) {
        assert.equal(h.run("currentView"), "practice");
        assert.equal(h.run("activeSession"), null);
        assert.equal(h.run("session.length"), 0);
        // A click queued from the replaced screen must not recreate its old draft.
        await h.click("select-choice", questions[changedIndex].options[0].id);
        const attempt = h.json("state.sessions[0].attempts")[questionId];
        assert.equal(attempt.contentVersion, 3);
        assert.equal(attempt.selectedAnswer, "B");
        assert.deepEqual(attempt.eliminatedChoices, ["C"]);
      } else {
        assert.equal(h.run("currentView"), "session");
        assert.equal(h.run("activeSession === state.sessions[0]"), true);
        await h.click("jump", String(changedIndex));
        assert.equal(h.run("currentAttempt().selectedAnswer"), "B");
      }
    }
  }
});

test("中断再開の問題取得中に届いた新しい版の選択状態を古い問題で置換しない", async () => {
  for (const changedIndex of [0, 1]) {
    const h = await prepared();
    const id = h.run("activeSession.id");
    const questions = h.json("session").map((question) => ({ ...question, contentVersion: 2 }));
    const questionId = questions[changedIndex].id;
    await h.click("quit-session");
    const original = h.context.fetch;
    let release, entered;
    const started = new Promise((resolve) => { entered = resolve; });
    h.context.fetch = async (url, options) => {
      if (url.startsWith("/api/questions")) {
        entered();
        await new Promise((resolve) => { release = resolve; });
        return h.response({ questions, total: questions.length });
      }
      return original(url, options);
    };
    const resuming = h.run(`resumePracticeSession(${JSON.stringify(id)})`);
    await started;
    const remote = h.json("state");
    remote.sessions[0].lastActivityAt = new Date(h.clock.now + 1000).toISOString();
    remote.sessions[0].attempts[questionId] = {
      ...remote.sessions[0].attempts[questionId], questionId,
      attemptId: "newer-version-on-resume", contentVersion: 3,
      selectedAnswer: "B", eliminatedChoices: ["C"], status: "answering", activeSince: null
    };
    h.context.newerResume = { configured: true, exists: true, version: 1, state: remote, deletedSessionIds: [] };
    h.run("acceptRemoteProgress(newerResume)");
    release();
    await resuming;
    const attempt = h.json("state.sessions[0].attempts")[questionId];
    assert.equal(attempt.contentVersion, 3);
    assert.equal(attempt.selectedAnswer, "B");
    assert.deepEqual(attempt.eliminatedChoices, ["C"]);
    assert.equal(h.run("currentView"), "practice");
    assert.equal(h.run("activeSession"), null);
    assert.ok(h.calls.some((call) => /問題が更新/.test(call.alert || "")));
  }
});

test("409と404では最新台帳と分類集計を取得し、旧版・隔離成績を履歴に残して即時に判定から除く", async () => {
  for (const status of [409, 404]) {
    const h = await prepared();
    const { after, question, unchanged } = catalogueUpdate(h, status);
    const original = h.context.fetch;
    let catalogueRequests = 0;
    h.context.fetch = async (url, options) => {
      if (url === "/api/grade") return h.response({}, status);
      if (url === "/api/content") {
        catalogueRequests += 1;
        assert.equal(options.cache, "no-store");
        return h.response(after);
      }
      if (url.startsWith("/api/questions")) return h.response({ questions: [{ ...question, contentVersion: 2 }], total: 1 });
      return original(url, options);
    };
    await h.run("gradeCurrent()");
    assert.equal(h.run("practiceRecords().length"), 2, "以前の解答履歴を消去しない");
    assert.deepEqual(h.json("assessmentRecords().map(record => record.questionId)"), [unchanged.id]);
    assert.equal(catalogueRequests, 1);
    assert.equal(h.run("assessmentRecords()[0].minimumCourse"), 70);
    assert.equal(h.run("tierProgress(60, 'law').answered"), 0);
    assert.equal(h.run("tierProgress(70, 'law').answered"), 1);
    for (const key of ["questionQuality", "topics", "courseCounts", "foundationCheckpointCounts", "foundationQuestionCheckpoints", "totals"]) {
      assert.deepEqual(h.json(`content.${key}`), after[key], key);
    }
    if (status === 409) {
      assert.equal(h.run("currentAttempt().selectedAnswer"), "");
      assert.equal(h.run("currentAttempt().contentVersion"), 2);
    } else {
      assert.equal(h.run("currentView"), "practice");
    }
  }
});

test("最新台帳の取得中も成績判定を保留し、同期後のセッション・新しい試行・削除を尊重する", async () => {
  for (const status of [409, 404]) {
    for (const change of ["metadata", "attempt", "completed", "deleted"]) {
      const h = await prepared();
      const id = h.run("activeSession.id");
      const { after, question, unchanged } = catalogueUpdate(h, status);
      const original = h.context.fetch;
      let entered, release;
      const started = new Promise((resolve) => { entered = resolve; });
      h.context.fetch = async (url, options) => {
        if (url === "/api/grade") return h.response({}, status);
        if (url === "/api/content") {
          entered();
          await new Promise((resolve) => { release = resolve; });
          return h.response(after);
        }
        if (url.startsWith("/api/questions")) return h.response({ questions: [{ ...question, contentVersion: 2 }], total: 1 });
        return original(url, options);
      };
      const grading = h.run("gradeCurrent()");
      await started;
      assert.deepEqual(h.json("assessmentRecords().map(record => record.questionId)"), [unchanged.id], "待機中に旧成績を判定へ戻さない");
      const remote = h.json("state");
      const remoteSession = remote.sessions.find((item) => item.id === id);
      remoteSession.lastActivityAt = new Date(h.clock.now + 1000).toISOString();
      remoteSession.label = "台帳取得中に同期した演習";
      if (change === "attempt") Object.assign(remoteSession.attempts[question.id], { attemptId: "remote-version-3", contentVersion: 3, selectedAnswer: "B", status: "answering" });
      if (change === "completed") remoteSession.status = "completed";
      h.context.catalogueRemote = { configured: true, exists: true, version: 1, state: remote, deletedSessionIds: change === "deleted" ? [id] : [] };
      h.run("acceptRemoteProgress(catalogueRemote)");
      release();
      await grading;
      assert.deepEqual(h.json("assessmentRecords().map(record => record.questionId)"), [unchanged.id]);
      assert.equal(h.run("practiceRecords().length"), 2);
      assert.deepEqual(h.json("content.questionQuality"), after.questionQuality);
      h.context.refreshedSessionId = id;
      const saved = h.json("state.sessions.find(item => item.id === refreshedSessionId) || null");
      if (change === "deleted") {
        assert.equal(saved, null);
        assert.equal(h.run("activeSession"), null);
        assert.equal(h.run("currentView"), "practice");
      } else if (change === "attempt") {
        assert.equal(saved.attempts[question.id].contentVersion, 3);
        assert.equal(saved.attempts[question.id].selectedAnswer, "B");
        assert.equal(h.run("activeSession"), null);
        assert.equal(h.run("currentView"), "practice");
      } else if (change === "completed") {
        assert.equal(saved.status, "completed");
        assert.equal(h.run("activeSession"), null);
        assert.equal(h.run("currentView"), "practice");
      } else {
        assert.equal(saved.label, "台帳取得中に同期した演習");
        if (status === 409) {
          assert.equal(h.run("activeSession === state.sessions.find(item => item.id === refreshedSessionId)"), true);
          assert.equal(saved.attempts[question.id].contentVersion, 2);
          assert.equal(saved.attempts[question.id].selectedAnswer, "");
        } else {
          assert.equal(saved.questionIds.includes(question.id), false);
          assert.equal(h.run("currentView"), "practice");
        }
      }
    }
  }
});

test("台帳更新に失敗した場合は旧成績を保留し、演習の再開時に台帳を再取得する", async () => {
  for (const status of [409, 404]) {
    const h = await prepared();
    const id = h.run("activeSession.id");
    const { after, question, unchanged } = catalogueUpdate(h, status);
    const original = h.context.fetch;
    let online = false;
    h.context.fetch = async (url, options) => {
      if (url === "/api/grade") return h.response({}, status);
      if (url === "/api/content") return h.response(online ? after : {}, online ? 200 : 503);
      if (url.startsWith("/api/questions")) {
        const ids = new URL(url, "http://localhost").searchParams.get("ids").split(",");
        return h.response({ questions: [{ ...question, contentVersion: 2 }, { ...unchanged, minimumCourse: 70, foundationCheckpoint: null }].filter((item) => ids.includes(item.id)), total: ids.length });
      }
      return original(url, options);
    };
    await h.run("gradeCurrent()");
    assert.equal(h.run("currentView"), "practice");
    assert.equal(h.run("activeSession"), null);
    assert.equal(h.run("practiceRecords().length"), 2);
    assert.deepEqual(h.json("assessmentRecords().map(record => record.questionId)"), [unchanged.id]);
    assert.ok(h.calls.some((call) => /成績判定を保留/.test(call.alert || "")));
    online = true;
    await h.run(`resumePracticeSession(${JSON.stringify(id)})`);
    assert.deepEqual(h.json("content.questionQuality"), after.questionQuality);
    assert.equal(h.run("pendingContentReviewIds.size"), 0);
    assert.equal(h.run("assessmentRecords()[0].minimumCourse"), 70);
    assert.equal(h.run("currentAttempt().selectedAnswer"), "");
  }
});

test("軽微な新版でminimumScoringVersionが変わらない場合は有効な旧成績を除外し続けない", async () => {
  const h = await prepared();
  const { after, question } = catalogueUpdate(h, 409);
  after.questionQuality.questions[question.id].minimumScoringVersion = 1;
  const original = h.context.fetch;
  h.context.fetch = async (url, options) => {
    if (url === "/api/grade") return h.response({}, 409);
    if (url === "/api/content") return h.response(after);
    if (url.startsWith("/api/questions")) return h.response({ questions: [{ ...question, contentVersion: 2 }], total: 1 });
    return original(url, options);
  };
  await h.run("gradeCurrent()");
  assert.equal(h.run("assessmentRecords().length"), 2);
  assert.equal(h.run("pendingContentReviewIds.size"), 0);
  assert.equal(h.run("currentAttempt().contentVersion"), 2);
  assert.equal(h.run("currentAttempt().selectedAnswer"), "");
});

test("台帳取得が通信エラーになっても同期された新しい試行や削除を上書きしない", async () => {
  for (const status of [409, 404]) {
    for (const deleted of [false, true]) {
      const h = await prepared();
      const id = h.run("activeSession.id");
      const { question, unchanged } = catalogueUpdate(h, status);
      const original = h.context.fetch;
      let entered, fail;
      const started = new Promise((resolve) => { entered = resolve; });
      h.context.fetch = async (url, options) => {
        if (url === "/api/grade") return h.response({}, status);
        if (url === "/api/content") {
          entered();
          return new Promise((_, reject) => { fail = () => reject(new Error("offline")); });
        }
        return original(url, options);
      };
      const grading = h.run("gradeCurrent()");
      await started;
      const remote = h.json("state");
      const remoteSession = remote.sessions.find((item) => item.id === id);
      remoteSession.lastActivityAt = new Date(h.clock.now + 1000).toISOString();
      Object.assign(remoteSession.attempts[question.id], { attemptId: "remote-version-3", contentVersion: 3, selectedAnswer: "B", status: "answering" });
      h.context.failedCatalogueRemote = { configured: true, exists: true, version: 1, state: remote, deletedSessionIds: deleted ? [id] : [] };
      h.run("acceptRemoteProgress(failedCatalogueRemote)");
      fail();
      await grading;
      assert.equal(h.run("currentView"), "practice");
      assert.equal(h.run("activeSession"), null);
      assert.deepEqual(h.json("assessmentRecords().map(record => record.questionId)"), [unchanged.id]);
      const saved = h.json("state.sessions").find((item) => item.id === id);
      if (deleted) assert.equal(saved, undefined);
      else {
        assert.equal(saved.attempts[question.id].contentVersion, 3);
        assert.equal(saved.attempts[question.id].selectedAnswer, "B");
        assert.equal(saved.questionIds.includes(question.id), true);
      }
    }
  }
});

test("新版の未回答ドラフトを保存する間に届いたさらに新しい版を最終描画で消さない", async () => {
  const h = await prepared();
  const { after, question } = catalogueUpdate(h, 409);
  const original = h.context.fetch;
  h.context.fetch = async (url, options) => {
    if (url === "/api/grade") return h.response({}, 409);
    if (url === "/api/content") return h.response(after);
    if (url.startsWith("/api/questions")) return h.response({ questions: [{ ...question, contentVersion: 2 }], total: 1 });
    return original(url, options);
  };
  // queueSave can apply server progress before its Promise resolves.
  h.run(`queueSave = async function () {
    const remote = JSON.parse(JSON.stringify(state));
    const remoteSession = remote.sessions.find(item => item.id === activeSession.id);
    remoteSession.lastActivityAt = new Date(Date.now() + 1000).toISOString();
    Object.assign(remoteSession.attempts[session[currentIndex].id], {
      attemptId: 'remote-version-3-after-save', contentVersion: 3, selectedAnswer: 'B', status: 'answering'
    });
    acceptRemoteProgress({ configured: true, exists: true, version: 1, state: remote, deletedSessionIds: [] });
  }`);
  await h.run("gradeCurrent()");
  assert.equal(h.json("state.sessions[0].attempts")[question.id].contentVersion, 3);
  assert.equal(h.json("state.sessions[0].attempts")[question.id].selectedAnswer, "B");
  assert.equal(h.run("currentView"), "practice");
});
