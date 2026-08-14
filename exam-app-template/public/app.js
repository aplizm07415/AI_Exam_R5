const app = document.querySelector("#app");
const pageTitle = document.querySelector("#pageTitle");
const saveStatus = document.querySelector("#saveStatus");

let content = null;
let currentView = "home";
let session = [];
let currentIndex = 0;
let databaseEnabled = false;
let saveTimer = null;
let state = freshState();

function freshState() {
  return { schemaVersion: 1, answers: {}, results: {}, flags: {}, notes: {}, startedAt: null, savedAt: null };
}

function storageKey() {
  return `exam-kit:${content?.exam.id || "loading"}:progress`;
}

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>'"]/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" })[character]);
}

function mergeState(value) {
  return { ...freshState(), ...(value || {}), answers: { ...(value?.answers || {}) }, results: { ...(value?.results || {}) }, flags: { ...(value?.flags || {}) }, notes: { ...(value?.notes || {}) } };
}

async function initializePersistence() {
  const local = JSON.parse(localStorage.getItem(storageKey()) || "null");
  try {
    const response = await fetch("/api/progress");
    const saved = await response.json();
    databaseEnabled = Boolean(saved.configured);
    state = mergeState(saved.exists ? saved.state : local);
    saveStatus.textContent = databaseEnabled ? "クラウド自動保存" : "この端末に自動保存";
    if (databaseEnabled && !saved.exists && local) await persistNow();
  } catch {
    state = mergeState(local);
    saveStatus.textContent = "この端末に自動保存";
  }
}

function queueSave() {
  state.savedAt = new Date().toISOString();
  localStorage.setItem(storageKey(), JSON.stringify(state));
  saveStatus.textContent = "保存中…";
  clearTimeout(saveTimer);
  saveTimer = setTimeout(persistNow, 450);
}

async function persistNow() {
  localStorage.setItem(storageKey(), JSON.stringify(state));
  if (!databaseEnabled) { saveStatus.textContent = "この端末に保存済み"; return; }
  try {
    const response = await fetch("/api/progress", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ state }) });
    if (!response.ok) throw new Error("save_failed");
    saveStatus.textContent = "クラウドへ保存済み";
  } catch { saveStatus.textContent = "端末へ一時保存"; }
}

function setView(view) {
  currentView = view;
  document.querySelectorAll(".nav-item").forEach((button) => button.classList.toggle("is-active", button.dataset.view === view));
  if (view === "home") renderHome();
  if (view === "practice") renderLibrary();
  if (view === "progress") renderProgress();
}

function stats() {
  const results = Object.values(state.results);
  const correct = results.filter((result) => result.correct).length;
  const score = results.reduce((sum, result) => sum + result.score, 0);
  const possible = results.reduce((sum, result) => sum + result.maxScore, 0);
  return { answered: results.length, correct, rate: results.length ? Math.round(correct / results.length * 100) : 0, score, possible };
}

function statCards() {
  const value = stats();
  return `<div class="stats">
    <div class="stat"><small>収録問題</small><strong>${content.totals.questions}</strong></div>
    <div class="stat"><small>採点済み</small><strong>${value.answered}</strong></div>
    <div class="stat"><small>正答率</small><strong>${value.rate}%</strong></div>
    <div class="stat"><small>見直し</small><strong>${Object.values(state.flags).filter(Boolean).length}</strong></div>
  </div>`;
}

function renderHome() {
  pageTitle.textContent = "ホーム";
  app.innerHTML = `<section class="view-stack">
    <div class="hero"><span class="eyebrow">${escapeHtml(content.exam.shortName || "EXAM PRACTICE")}</span><h2>${escapeHtml(content.exam.name)}</h2><p>${escapeHtml(content.exam.description)}</p><div><button class="primary" data-start-all>問題演習を始める →</button></div></div>
    ${statCards()}
    <div class="section-heading"><div><span class="eyebrow">SUBJECTS</span><h2>科目から始める</h2></div></div>
    <div class="topic-grid">${content.subjects.map((subject) => {
      const count = content.questions.filter((question) => question.subject === subject.id).length;
      return `<button class="topic-card" data-subject="${escapeHtml(subject.id)}"><strong>${escapeHtml(subject.label)}</strong><small>${escapeHtml(subject.description || "")} · ${count}問</small></button>`;
    }).join("")}</div>
  </section>`;
}

function renderLibrary() {
  pageTitle.textContent = "問題演習";
  const topics = [...new Set(content.questions.map((question) => question.topic))];
  app.innerHTML = `<section class="view-stack">
    <div class="section-heading"><div><span class="eyebrow">QUESTION LIBRARY</span><h2>出題条件を選ぶ</h2><p>${content.totals.questions}問・${content.totals.points}点分を収録しています。</p></div></div>
    <div class="panel filter-row">
      <label>科目<select id="subjectFilter"><option value="">すべて</option>${content.subjects.map((subject) => `<option value="${escapeHtml(subject.id)}">${escapeHtml(subject.label)}</option>`).join("")}</select></label>
      <label>論点<select id="topicFilter"><option value="">すべて</option>${topics.map((topic) => `<option>${escapeHtml(topic)}</option>`).join("")}</select></label>
      <label>難易度<select id="difficultyFilter"><option value="">すべて</option>${[...new Set(content.questions.map((question) => question.difficulty))].map((difficulty) => `<option>${escapeHtml(difficulty)}</option>`).join("")}</select></label>
      <label>出題数<select id="limitFilter"><option value="10">10問</option><option value="20">20問</option><option value="all">すべて</option></select></label>
      <button class="primary" data-start-filtered>この条件で始める</button>
    </div>
    <div class="panel"><div class="section-heading"><div><span class="eyebrow">REVIEW</span><h2>復習演習</h2></div></div><div class="actions"><button class="secondary" data-review="incorrect">不正解だけ (${Object.values(state.results).filter((result) => !result.correct).length})</button><button class="secondary" data-review="flagged">見直しだけ (${Object.values(state.flags).filter(Boolean).length})</button></div></div>
  </section>`;
}

function begin(questions) {
  if (!questions.length) { alert("条件に合う問題がありません。"); return; }
  session = [...questions];
  currentIndex = 0;
  state.startedAt ||= new Date().toISOString();
  renderQuestion();
}

function subjectLabel(id) {
  return content.subjects.find((subject) => subject.id === id)?.label || id;
}

function answerMarkup(question) {
  const saved = state.answers[question.id];
  if (question.type === "single_choice" || question.type === "multiple_choice") {
    const type = question.type === "single_choice" ? "radio" : "checkbox";
    const selected = new Set(Array.isArray(saved) ? saved : [saved]);
    return `<div class="choices">${question.options.map((option) => `<label class="choice"><input type="${type}" name="answer" value="${escapeHtml(option.id)}" ${selected.has(option.id) ? "checked" : ""}>${escapeHtml(option.label)}</label>`).join("")}</div>`;
  }
  return `<input class="answer-input" id="answerInput" type="${question.type === "numeric" ? "text" : "text"}" inputmode="${question.type === "numeric" ? "decimal" : "text"}" value="${escapeHtml(saved ?? "")}" placeholder="${escapeHtml(question.placeholder || "回答を入力")}"> ${escapeHtml(question.suffix || "")}`;
}

function displayAnswer(answer) {
  if (Array.isArray(answer)) return answer.join(" / ");
  return String(answer ?? "");
}

function renderQuestion() {
  currentView = "session";
  pageTitle.textContent = "演習中";
  document.querySelectorAll(".nav-item").forEach((button) => button.classList.toggle("is-active", button.dataset.view === "practice"));
  const question = session[currentIndex];
  const result = state.results[question.id];
  app.innerHTML = `<section class="practice-layout"><div>
    <article class="question-card"><span class="question-meta">${escapeHtml(subjectLabel(question.subject))} / ${escapeHtml(question.topic)} / ${escapeHtml(question.difficulty)}</span><h2>Q${currentIndex + 1}. ${escapeHtml(question.title)}</h2><p class="prompt">${escapeHtml(question.prompt)}</p><div class="answer-area">${answerMarkup(question)}</div>
      <div id="feedback">${result ? feedbackMarkup(result) : ""}</div><textarea class="note-input" id="questionNote" placeholder="この問題のメモ">${escapeHtml(state.notes[question.id] || "")}</textarea>
    </article>
    <div class="actions"><button class="secondary" data-prev ${currentIndex === 0 ? "disabled" : ""}>← 前へ</button><button class="secondary" data-flag>${state.flags[question.id] ? "★ 見直し中" : "☆ 見直す"}</button><button class="primary" data-grade>採点する</button><button class="secondary" data-next ${currentIndex === session.length - 1 ? "disabled" : ""}>次へ →</button></div>
  </div><aside class="panel navigator"><span class="eyebrow">QUESTION MAP</span><h3>${currentIndex + 1} / ${session.length}</h3><div class="question-map">${session.map((item, index) => `<button class="map-button ${index === currentIndex ? "current" : ""} ${state.results[item.id] ? "done" : ""} ${state.flags[item.id] ? "flagged" : ""}" data-jump="${index}">${index + 1}</button>`).join("")}</div></aside></section>`;
}

function feedbackMarkup(result) {
  return `<div class="feedback ${result.correct ? "correct" : "incorrect"}"><strong>${result.correct ? "正解です" : "不正解です"}（${result.score} / ${result.maxScore}点）</strong>${result.correct ? "" : `<p>正答：${escapeHtml(displayAnswer(result.correctAnswer))}</p>`}<p>${escapeHtml(result.explanation)}</p></div>`;
}

function collectAnswer(question) {
  if (question.type === "single_choice") return document.querySelector('input[name="answer"]:checked')?.value || "";
  if (question.type === "multiple_choice") return [...document.querySelectorAll('input[name="answer"]:checked')].map((input) => input.value);
  return document.querySelector("#answerInput")?.value || "";
}

async function gradeCurrent() {
  const question = session[currentIndex];
  const answer = collectAnswer(question);
  state.answers[question.id] = answer;
  try {
    const response = await fetch("/api/grade", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ questionId: question.id, answer }) });
    if (!response.ok) throw new Error("grade_failed");
    state.results[question.id] = await response.json();
    document.querySelector("#feedback").innerHTML = feedbackMarkup(state.results[question.id]);
    document.querySelector(`.map-button[data-jump="${currentIndex}"]`)?.classList.add("done");
    queueSave();
  } catch { alert("採点できませんでした。接続を確認してください。"); }
}

function renderProgress() {
  pageTitle.textContent = "学習記録";
  const value = stats();
  const rows = content.questions.filter((question) => state.results[question.id]).map((question) => {
    const result = state.results[question.id];
    return `<div class="result"><div><strong>${escapeHtml(question.title)}</strong><small>${escapeHtml(subjectLabel(question.subject))} / ${escapeHtml(question.topic)}${state.notes[question.id] ? ` · ${escapeHtml(state.notes[question.id])}` : ""}</small></div><span class="badge ${result.correct ? "correct" : "incorrect"}">${result.correct ? "正解" : "不正解"}</span></div>`;
  }).join("");
  app.innerHTML = `<section class="view-stack"><div class="section-heading"><div><span class="eyebrow">LEARNING LOG</span><h2>学習記録</h2><p>得点 ${value.score} / ${value.possible || 0}点</p></div><button class="danger" data-reset>記録をリセット</button></div>${statCards()}<div class="results">${rows || '<div class="panel empty">まだ採点記録がありません。</div>'}</div></section>`;
}

document.addEventListener("click", (event) => {
  const viewButton = event.target.closest("[data-view]");
  if (viewButton) return setView(viewButton.dataset.view);
  if (event.target.closest("[data-start-all]")) return begin(content.questions);
  const subjectButton = event.target.closest("[data-subject]");
  if (subjectButton) return begin(content.questions.filter((question) => question.subject === subjectButton.dataset.subject));
  if (event.target.closest("[data-start-filtered]")) {
    const subject = document.querySelector("#subjectFilter").value;
    const topic = document.querySelector("#topicFilter").value;
    const difficulty = document.querySelector("#difficultyFilter").value;
    const limit = document.querySelector("#limitFilter").value;
    const filtered = content.questions.filter((question) => (!subject || question.subject === subject) && (!topic || question.topic === topic) && (!difficulty || question.difficulty === difficulty));
    return begin(limit === "all" ? filtered : filtered.slice(0, Number(limit)));
  }
  const review = event.target.closest("[data-review]")?.dataset.review;
  if (review === "incorrect") return begin(content.questions.filter((question) => state.results[question.id] && !state.results[question.id].correct));
  if (review === "flagged") return begin(content.questions.filter((question) => state.flags[question.id]));
  const jump = event.target.closest("[data-jump]");
  if (jump) { currentIndex = Number(jump.dataset.jump); return renderQuestion(); }
  if (event.target.closest("[data-prev]")) { currentIndex -= 1; return renderQuestion(); }
  if (event.target.closest("[data-next]")) { currentIndex += 1; return renderQuestion(); }
  if (event.target.closest("[data-grade]")) return gradeCurrent();
  if (event.target.closest("[data-flag]")) { const id = session[currentIndex].id; state.flags[id] = !state.flags[id]; queueSave(); return renderQuestion(); }
  if (event.target.closest("[data-reset]") && confirm("この試験の回答・採点・メモをすべて削除しますか？")) { state = freshState(); queueSave(); renderProgress(); }
});

document.addEventListener("input", (event) => {
  if (!session.length || currentView !== "session") return;
  const question = session[currentIndex];
  if (event.target.matches("#questionNote")) state.notes[question.id] = event.target.value;
  else if (event.target.matches('input[name="answer"], #answerInput')) state.answers[question.id] = collectAnswer(question);
  else return;
  queueSave();
});

async function boot() {
  try {
    const response = await fetch("/api/content");
    if (!response.ok) throw new Error("content_failed");
    content = await response.json();
    document.title = content.exam.name;
    document.querySelector("#brandName").textContent = content.exam.name;
    document.querySelector("#brandShort").textContent = content.exam.shortName || "EXAM KIT";
    document.querySelector("#todayLabel").textContent = new Intl.DateTimeFormat("ja-JP", { dateStyle: "long" }).format(new Date());
    const theme = content.exam.theme || {};
    if (theme.primary) document.documentElement.style.setProperty("--primary", theme.primary);
    if (theme.accent) document.documentElement.style.setProperty("--accent", theme.accent);
    if (theme.ink) document.documentElement.style.setProperty("--ink", theme.ink);
    await initializePersistence();
    renderHome();
  } catch (error) {
    console.error(error);
    app.innerHTML = '<div class="panel">試験データを読み込めませんでした。content/exam.json の形式を確認してください。</div>';
  }
}

boot();
