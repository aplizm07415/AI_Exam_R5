const app = document.querySelector("#app");
const pageTitle = document.querySelector("#pageTitle");
const saveStatus = document.querySelector("#saveStatus");

let content = null;
let currentView = "home";
let session = [];
let currentIndex = 0;
let databaseEnabled = false;
let saveTimer = null;
let studySubject = "finance";
let mockSubject = null;
let mockEndAt = null;
let mockTimer = null;
let state = freshState();
const feedbackCache = new Map();

function freshState() {
  return {
    schemaVersion: 2,
    answers: {},
    results: {},
    flags: {},
    notes: {},
    attempts: {},
    recent: [],
    mockResults: {},
    plan: { targetScore: 60, completed: {} },
    startedAt: null,
    savedAt: null
  };
}

function storageKey() {
  return `exam-kit:${content?.exam.id || "loading"}:progress`;
}

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>'"]/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" })[character]);
}

function inlineMarkdown(value) {
  return escapeHtml(value).replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>");
}

function richText(value) {
  const lines = String(value ?? "").replace(/\r/g, "").split("\n");
  const blocks = [];
  for (let index = 0; index < lines.length;) {
    const line = lines[index];
    if (line.includes("|") && lines[index + 1]?.match(/^\s*\|?\s*:?-{2,}/)) {
      const rows = [];
      while (index < lines.length && lines[index].includes("|")) {
        if (!lines[index].match(/^\s*\|?\s*:?-{2,}/)) {
          rows.push(lines[index].replace(/^\s*\||\|\s*$/g, "").split("|").map((cell) => cell.trim()));
        }
        index += 1;
      }
      const [head, ...body] = rows;
      blocks.push(`<div class="table-scroll"><table><thead><tr>${(head || []).map((cell) => `<th>${inlineMarkdown(cell)}</th>`).join("")}</tr></thead><tbody>${body.map((row) => `<tr>${row.map((cell) => `<td>${inlineMarkdown(cell)}</td>`).join("")}</tr>`).join("")}</tbody></table></div>`);
      continue;
    }
    if (!line.trim()) {
      blocks.push("<br>");
      index += 1;
      continue;
    }
    blocks.push(`<span>${inlineMarkdown(line)}</span>`);
    index += 1;
  }
  return blocks.join("<br>").replace(/<br><br><br>/g, "<br><br>");
}

function mergeState(value) {
  const base = freshState();
  const merged = {
    ...base,
    ...(value || {}),
    answers: { ...(value?.answers || {}) },
    results: { ...(value?.results || {}) },
    flags: { ...(value?.flags || {}) },
    notes: { ...(value?.notes || {}) },
    attempts: { ...(value?.attempts || {}) },
    recent: Array.isArray(value?.recent) ? value.recent.slice(0, 100) : [],
    mockResults: { ...(value?.mockResults || {}) },
    plan: { ...base.plan, ...(value?.plan || {}), completed: { ...(value?.plan?.completed || {}) } }
  };
  if (![60, 70, 80].includes(Number(merged.plan.targetScore))) merged.plan.targetScore = 60;
  return merged;
}

async function initializePersistence() {
  let local = null;
  try { local = JSON.parse(localStorage.getItem(storageKey()) || "null"); } catch { local = null; }
  try {
    const response = await fetch("/api/progress");
    const saved = await response.json();
    databaseEnabled = Boolean(saved.configured);
    state = mergeState(saved.exists ? saved.state : local);
    saveStatus.textContent = databaseEnabled ? "Neonへ自動保存" : "この端末に自動保存";
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
    saveStatus.textContent = "Neonへ保存済み";
  } catch { saveStatus.textContent = "端末へ一時保存"; }
}

function setView(view) {
  clearInterval(mockTimer);
  currentView = view;
  document.querySelectorAll(".nav-item").forEach((button) => button.classList.toggle("is-active", button.dataset.view === view));
  if (view === "home") renderHome();
  if (view === "practice") renderLibrary();
  if (view === "plan") renderPlan();
  if (view === "mock") renderMockLibrary();
  if (view === "progress") renderProgress();
}

function allResults() {
  return Object.values(state.results);
}

function stats(results = allResults()) {
  const correct = results.filter((result) => result.correct).length;
  return { answered: results.length, correct, rate: results.length ? Math.round(correct / results.length * 100) : 0 };
}

function subjectStats(subjectId) {
  return stats(allResults().filter((result) => result.subject === subjectId));
}

function statCards() {
  const value = stats();
  return `<div class="stats">
    <div class="stat"><small>収録問題</small><strong>${content.totals.questions.toLocaleString()}</strong><span>${content.totals.topics}論点</span></div>
    <div class="stat"><small>採点済み</small><strong>${value.answered.toLocaleString()}</strong><span>${value.correct}問正解</span></div>
    <div class="stat"><small>正答率</small><strong>${value.rate}%</strong><span>目標 80%</span></div>
    <div class="stat"><small>見直し</small><strong>${Object.values(state.flags).filter(Boolean).length}</strong><span>誤答 ${allResults().filter((result) => !result.correct).length}</span></div>
  </div>`;
}

function currentPhase() {
  const today = new Date();
  return content.learningPhases.find((phase) => today >= new Date(`${phase.start}T00:00:00`) && today <= new Date(`${phase.end}T23:59:59`))
    || content.learningPhases.find((phase) => today < new Date(`${phase.start}T00:00:00`))
    || content.learningPhases.at(-1);
}

function daysUntilTarget() {
  return Math.max(0, Math.ceil((new Date(`${content.exam.targetExamDate}T00:00:00`) - new Date()) / 86400000));
}

function recommendedSubject() {
  const scored = content.subjects.map((subject) => ({ subject, ...subjectStats(subject.id) }));
  const untouched = scored.filter((item) => item.answered === 0).sort((a, b) => b.subject.weeklyWeight - a.subject.weeklyWeight);
  return untouched[0]?.subject || scored.sort((a, b) => a.rate - b.rate || a.answered - b.answered)[0]?.subject || content.subjects[0];
}

function courseSelector() {
  return `<div class="course-selector" aria-label="目標コース">${[60, 70, 80].map((score) => `<button class="course-chip ${Number(state.plan.targetScore) === score ? "is-active" : ""}" data-set-course="${score}"><strong>${score}</strong><span>点コース</span></button>`).join("")}</div>`;
}

function renderHome() {
  pageTitle.textContent = "ホーム";
  const phase = currentPhase();
  const recommendation = recommendedSubject();
  app.innerHTML = `<section class="view-stack">
    <div class="hero">
      <div class="hero-copy"><span class="eyebrow">${escapeHtml(content.exam.shortName)}</span><h2>${escapeHtml(content.exam.fullName)}</h2><p>${escapeHtml(content.exam.description)}</p>
        <div class="hero-actions"><button class="primary warm" data-adaptive>今日のおすすめを始める</button><button class="ghost" data-view="plan">学習計画を見る</button></div>
      </div>
      <div class="target-dial"><small>本試験まで</small><strong>${daysUntilTarget()}</strong><span>days</span><i>目標 各80点</i></div>
    </div>
    <div class="phase-strip"><div><span class="phase-number">PHASE ${content.learningPhases.indexOf(phase) + 1}</span><strong>${escapeHtml(phase.label)}</strong><small>${escapeHtml(phase.goal)}</small></div>${courseSelector()}</div>
    ${statCards()}
    <div class="section-heading"><div><span class="eyebrow">SUBJECTS</span><h2>4科目の現在地</h2></div><p>今日の推奨：${escapeHtml(recommendation.label)}</p></div>
    <div class="subject-grid">${content.subjects.map((subject, index) => {
      const value = subjectStats(subject.id);
      return `<article class="subject-card tone-${index + 1}"><div class="subject-head"><span>${String(index + 1).padStart(2, "0")}</span><small>${subject.questionCount}問</small></div><h3>${escapeHtml(subject.label)}</h3><p>${escapeHtml(subject.description)}</p><div class="meter"><i style="width:${value.rate}%"></i></div><div class="subject-foot"><span>${value.answered ? `正答率 ${value.rate}%` : "未着手"}</span><button data-start-subject="${subject.id}">演習する →</button></div></article>`;
    }).join("")}</div>
    <div class="two-column"><div class="panel callout"><span class="eyebrow">REVIEW FIRST</span><h3>誤答から始める</h3><p>正解済みの周回より、誤答と見直し問題を優先します。</p><button class="secondary" data-review="adaptive">復習セッションを作る</button></div><div class="panel callout latest"><span class="eyebrow">LATEST / 2026</span><h3>令和8年度 公式模試</h3><p>公式問題PDFと正解・配点で、時間を測って100点換算します。</p><button class="secondary" data-view="mock">公式模試へ</button></div></div>
  </section>`;
}

function subjectOptions(includeAll = true) {
  return `${includeAll ? '<option value="">すべて</option>' : ""}${content.subjects.map((subject) => `<option value="${subject.id}">${escapeHtml(subject.label)}</option>`).join("")}`;
}

function topicOptions(subjectId = "") {
  return content.topics.filter((topic) => !subjectId || topic.subject === subjectId).map((topic) => `<option value="${escapeHtml(topic.id)}">${escapeHtml(topic.label)} (${topic.count})</option>`).join("");
}

function renderLibrary() {
  pageTitle.textContent = "問題演習";
  app.innerHTML = `<section class="view-stack">
    <div class="section-heading"><div><span class="eyebrow">QUESTION LAB</span><h2>演習セッションを組む</h2><p>${content.totals.questions.toLocaleString()}問を、科目・論点・難易度・目標点で絞り込みます。</p></div>${courseSelector()}</div>
    <div class="panel filter-panel">
      <label><span>科目</span><select id="subjectFilter">${subjectOptions()}</select></label>
      <label><span>論点</span><select id="topicFilter"><option value="">すべて</option>${topicOptions()}</select></label>
      <label><span>難易度</span><select id="difficultyFilter"><option value="">すべて</option><option>基礎</option><option>標準</option><option>発展</option></select></label>
      <label><span>出題数</span><select id="limitFilter"><option value="10">10問</option><option value="15">15問</option><option value="20" selected>20問</option><option value="30">30問</option><option value="50">50問</option></select></label>
      <button class="primary" data-start-filtered>この条件で開始</button>
    </div>
    <div class="quick-grid">
      <button class="quick-card" data-review="incorrect"><span>RETRY</span><strong>誤答だけ</strong><small>${allResults().filter((result) => !result.correct).length}問</small></button>
      <button class="quick-card" data-review="flagged"><span>FLAGGED</span><strong>見直しだけ</strong><small>${Object.values(state.flags).filter(Boolean).length}問</small></button>
      <button class="quick-card" data-review="adaptive"><span>ADAPTIVE</span><strong>弱点優先</strong><small>誤答 → 見直し → 未着手</small></button>
    </div>
    <div class="panel legend"><strong>段階開放のルール</strong><p><b>60点</b>：core論点中心　<b>70点</b>：standardまで拡張　<b>80点</b>：発展・新傾向を含む全範囲</p></div>
  </section>`;
}

async function fetchQuestions(params = {}) {
  const query = new URLSearchParams({ ...params, course: state.plan.targetScore, seed: params.seed || `${Date.now()}` });
  const response = await fetch(`/api/questions?${query}`);
  if (!response.ok) throw new Error("questions_failed");
  return response.json();
}

async function beginRemote(params) {
  app.innerHTML = '<div class="panel loading">演習セッションを組み立てています…</div>';
  try {
    const result = await fetchQuestions(params);
    begin(result.questions);
  } catch {
    app.innerHTML = '<div class="panel empty">問題を読み込めませんでした。接続を確認してください。</div>';
  }
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
  const selected = new Set(Array.isArray(saved) ? saved : [saved]);
  return `<div class="choices">${question.options.map((option) => `<label class="choice"><input type="radio" name="answer" value="${escapeHtml(option.id)}" ${selected.has(option.id) ? "checked" : ""}><span class="choice-key">${escapeHtml(option.id)}</span><span class="choice-text">${richText(option.label)}</span></label>`).join("")}</div>`;
}

function displayAnswer(answer) {
  return Array.isArray(answer) ? answer.join(" / ") : String(answer ?? "");
}

function renderQuestion() {
  clearInterval(mockTimer);
  currentView = "session";
  pageTitle.textContent = "演習中";
  document.querySelectorAll(".nav-item").forEach((button) => button.classList.toggle("is-active", button.dataset.view === "practice"));
  const question = session[currentIndex];
  const stored = state.results[question.id];
  const feedback = feedbackCache.get(question.id);
  app.innerHTML = `<section class="practice-layout"><div>
    <div class="session-progress"><span>${currentIndex + 1} / ${session.length}</span><i><b style="width:${((currentIndex + 1) / session.length) * 100}%"></b></i><small>${escapeHtml(question.difficulty)}・${question.minimumCourse}点コース</small></div>
    <article class="question-card"><div class="question-meta"><span>${escapeHtml(subjectLabel(question.subject))}</span><span>${escapeHtml(question.topic)}</span><span>${escapeHtml(question.sourceId)}</span></div><h2>Q${currentIndex + 1}. ${escapeHtml(question.topic)}</h2><div class="prompt">${richText(question.prompt)}</div><div class="answer-area">${answerMarkup(question)}</div>
      <div id="feedback">${feedback ? feedbackMarkup(feedback) : stored ? storedFeedbackMarkup(stored) : ""}</div>
      <label class="note-wrap"><span>自分用メモ</span><textarea class="note-input" id="questionNote" placeholder="間違えた理由、覚え方、再確認日など">${escapeHtml(state.notes[question.id] || "")}</textarea></label>
    </article>
    <div class="actions"><button class="secondary" data-prev ${currentIndex === 0 ? "disabled" : ""}>← 前へ</button><button class="secondary" data-flag>${state.flags[question.id] ? "★ 見直し中" : "☆ 見直す"}</button><button class="primary" data-grade>採点・解説</button><button class="secondary" data-next ${currentIndex === session.length - 1 ? "disabled" : ""}>次へ →</button></div>
  </div><aside class="panel navigator"><span class="eyebrow">QUESTION MAP</span><h3>${escapeHtml(subjectLabel(question.subject))}</h3><div class="question-map">${session.map((item, index) => `<button class="map-button ${index === currentIndex ? "current" : ""} ${state.results[item.id] ? "done" : ""} ${state.flags[item.id] ? "flagged" : ""}" data-jump="${index}">${index + 1}</button>`).join("")}</div><button class="text-button" data-view="progress">学習記録を見る →</button></aside></section>`;
}

function feedbackMarkup(result) {
  return `<div class="feedback ${result.correct ? "correct" : "incorrect"}"><strong>${result.correct ? "正解です" : "不正解です"}</strong>${result.correct ? "" : `<p>正答：${escapeHtml(displayAnswer(result.correctAnswer))}　${escapeHtml(result.correctAnswerText || "")}</p>`}<div class="explanation">${richText(result.explanation || "解説はありません。")}</div></div>`;
}

function storedFeedbackMarkup(result) {
  return `<div class="feedback ${result.correct ? "correct" : "incorrect"}"><strong>前回：${result.correct ? "正解" : "不正解"}</strong><p>「採点・解説」を押すと解説を再表示します。</p></div>`;
}

function collectAnswer() {
  return document.querySelector('input[name="answer"]:checked')?.value || "";
}

async function gradeCurrent() {
  const question = session[currentIndex];
  const answer = collectAnswer();
  if (!answer) { alert("選択肢を選んでください。"); return; }
  state.answers[question.id] = answer;
  try {
    const response = await fetch("/api/grade", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ questionId: question.id, answer }) });
    if (!response.ok) throw new Error("grade_failed");
    const fullResult = await response.json();
    feedbackCache.set(question.id, fullResult);
    state.results[question.id] = {
      questionId: question.id,
      subject: fullResult.subject,
      topic: fullResult.topic,
      topicId: fullResult.topicId,
      difficulty: fullResult.difficulty,
      minimumCourse: fullResult.minimumCourse,
      correct: fullResult.correct,
      answeredAt: new Date().toISOString()
    };
    const previous = state.attempts[question.id] || { count: 0, correct: 0 };
    state.attempts[question.id] = { count: previous.count + 1, correct: previous.correct + (fullResult.correct ? 1 : 0), lastAt: new Date().toISOString() };
    state.recent = [question.id, ...state.recent.filter((id) => id !== question.id)].slice(0, 100);
    document.querySelector("#feedback").innerHTML = feedbackMarkup(fullResult);
    document.querySelector(`.map-button[data-jump="${currentIndex}"]`)?.classList.add("done");
    queueSave();
  } catch { alert("採点できませんでした。接続を確認してください。"); }
}

function renderPlan() {
  pageTitle.textContent = "学習計画";
  const phase = currentPhase();
  const plan = content.studyPlans.subjects[studySubject];
  const completed = state.plan.completed || {};
  const totalItems = plan.courses.flatMap((course) => course.groups.flatMap((group) => group.items)).length;
  const completedCount = Object.keys(completed).filter((key) => key.startsWith(`${studySubject}:`) && completed[key]).length;
  app.innerHTML = `<section class="view-stack">
    <div class="section-heading"><div><span class="eyebrow">ROADMAP TO 80</span><h2>60 → 70 → 80点の段階計画</h2><p>試験日は未発表のため、2027年8月7日を仮置きしています。</p></div>${courseSelector()}</div>
    <div class="timeline">${content.learningPhases.map((item, index) => `<article class="timeline-item ${item.id === phase.id ? "current" : ""}"><span>${index + 1}</span><div><small>${item.start.replaceAll("-", ".")} — ${item.end.replaceAll("-", ".")}</small><strong>${escapeHtml(item.label)}</strong><p>${escapeHtml(item.goal)}</p></div></article>`).join("")}</div>
    <div class="plan-tabs">${content.subjects.map((subject) => `<button class="${studySubject === subject.id ? "is-active" : ""}" data-plan-subject="${subject.id}">${escapeHtml(subject.shortLabel)}</button>`).join("")}<span>${completedCount} / ${totalItems} 完了</span></div>
    <div class="plan-courses">${plan.courses.map((course) => `<details class="plan-course" ${course.targetScore === Number(state.plan.targetScore) ? "open" : ""}><summary><span>${course.targetScore}</span><div><small>COURSE</small><strong>${escapeHtml(course.title)}</strong></div><i>${course.groups.reduce((sum, group) => sum + group.items.length, 0)}項目</i></summary><div class="plan-groups">${course.groups.map((group, groupIndex) => `<section><h3>${escapeHtml(group.title)}</h3>${group.items.map((item, itemIndex) => { const key = `${studySubject}:${course.targetScore}:${groupIndex}:${itemIndex}`; return `<label class="plan-check depth-${Math.min(item.depth, 2)}"><input type="checkbox" data-plan-check="${key}" ${completed[key] ? "checked" : ""}><span>${escapeHtml(item.text)}</span></label>`; }).join("") || '<p class="muted">上位コースの全項目を含みます。</p>'}</section>`).join("")}</div></details>`).join("")}</div>
  </section>`;
}

function renderMockLibrary() {
  pageTitle.textContent = "公式模試";
  const official = content.officialExam;
  app.innerHTML = `<section class="view-stack">
    <div class="section-heading"><div><span class="eyebrow">OFFICIAL MOCK / ${official.eraYear}</span><h2>令和8年度 第1次試験</h2><p>公式問題PDFを別タブで開き、R4のマークシートで回答・採点します。</p></div><a class="secondary link-button" href="https://www.jf-cmca.jp/contents/010_c_/shikenmondai.html" target="_blank" rel="noopener">公式 問題一覧</a></div>
    <div class="notice"><strong>実戦ルール</strong><p>机上は電卓・筆記用具のみ。時間終了まで答え合わせをせず、本試験と同じ順序で解いてください。</p></div>
    <div class="mock-grid">${content.subjects.map((subject, index) => {
      const exam = official.subjects[subject.id];
      const last = state.mockResults[subject.id];
      const trends = content.officialAnalysis.subjects[subject.id]?.topTopics || [];
      return `<article class="mock-card tone-${index + 1}"><div class="mock-title"><span>${exam.code}</span><div><small>${official.eraYear}</small><h3>${escapeHtml(subject.label)}</h3></div></div><div class="mock-facts"><span>${exam.minutes}分</span><span>${exam.totalPoints}点</span><span>${exam.answerSlots.length}解答欄</span></div><div class="trend-list">${trends.slice(0, 3).map((item) => `<span>${escapeHtml(item.topic)} <b>${item.count}</b></span>`).join("")}</div>${last ? `<p class="last-score">前回 <strong>${last.score}</strong>点</p>` : ""}<button class="primary" data-start-mock="${subject.id}">問題PDFを開いて開始</button></article>`;
    }).join("")}</div>
  </section>`;
}

function startOfficialMock(subjectId) {
  const exam = content.officialExam.subjects[subjectId];
  mockSubject = subjectId;
  mockEndAt = Date.now() + exam.minutes * 60000;
  window.open(exam.question_url, "_blank", "noopener");
  renderMockSession();
}

function renderMockSession(result = null) {
  const exam = content.officialExam.subjects[mockSubject];
  currentView = "mock-session";
  pageTitle.textContent = `公式模試・${subjectLabel(mockSubject)}`;
  document.querySelectorAll(".nav-item").forEach((button) => button.classList.toggle("is-active", button.dataset.view === "mock"));
  clearInterval(mockTimer);
  app.innerHTML = `<section class="view-stack mock-session">
    <div class="mock-bar"><div><span class="eyebrow">${escapeHtml(content.officialExam.eraYear)} / ${exam.code}</span><h2>${escapeHtml(exam.label)}</h2></div><div class="timer"><small>残り時間</small><strong id="timerValue">${exam.minutes}:00</strong></div><div class="mock-links"><a href="${exam.question_url}" target="_blank" rel="noopener">問題PDF ↗</a>${result ? `<a href="${exam.answer_url}" target="_blank" rel="noopener">正解PDF ↗</a>` : "<span>正解は採点後に表示</span>"}</div></div>
    ${result ? mockResultMarkup(result) : ""}
    <div class="answer-sheet">${exam.answerSlots.map((item) => `<label class="answer-slot ${result?.details.find((detail) => detail.id === item.id)?.correct === false ? "wrong" : ""}"><span>第${item.number}問${item.subquestion ? `-${item.subquestion}` : ""}</span><select data-mock-answer="${item.id}"><option value="">—</option>${["ア", "イ", "ウ", "エ", "オ"].map((choice) => `<option ${result?.details.find((detail) => detail.id === item.id)?.submitted === choice ? "selected" : ""}>${choice}</option>`).join("")}</select><small>${item.points}点</small>${result ? `<b>${result.details.find((detail) => detail.id === item.id)?.answer}</b>` : ""}</label>`).join("")}</div>
    <div class="actions mock-actions"><button class="secondary" data-view="mock">模試一覧へ</button><button class="primary" data-grade-mock>採点する</button></div>
  </section>`;
  updateTimer();
  mockTimer = setInterval(updateTimer, 1000);
}

function updateTimer() {
  const timer = document.querySelector("#timerValue");
  if (!timer || !mockEndAt) return;
  const remaining = Math.max(0, mockEndAt - Date.now());
  const minutes = Math.floor(remaining / 60000);
  const seconds = Math.floor((remaining % 60000) / 1000);
  timer.textContent = `${minutes}:${String(seconds).padStart(2, "0")}`;
  timer.closest(".timer")?.classList.toggle("urgent", remaining < 10 * 60000);
  if (!remaining) clearInterval(mockTimer);
}

function mockResultMarkup(result) {
  return `<div class="mock-result ${result.score >= 80 ? "excellent" : result.score >= 60 ? "pass" : "retry"}"><div><small>SCORE</small><strong>${result.score}<span>/ ${result.maxScore}</span></strong></div><p>${result.score >= 80 ? "80点到達。誤答論点だけを通常演習で補強しましょう。" : result.score >= 60 ? "合格ライン到達。あと20点を誤答分野から積み上げます。" : "まず60点ラインのcore論点へ戻りましょう。"}</p></div>`;
}

async function gradeMock() {
  const answers = Object.fromEntries([...document.querySelectorAll("[data-mock-answer]")].map((select) => [select.dataset.mockAnswer, select.value]));
  if (!Object.values(answers).some(Boolean)) { alert("少なくとも1問に回答してください。"); return; }
  try {
    const response = await fetch("/api/mock/grade", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ subjectId: mockSubject, answers }) });
    if (!response.ok) throw new Error("mock_grade_failed");
    const result = await response.json();
    state.mockResults[mockSubject] = { ...result, finishedAt: new Date().toISOString() };
    queueSave();
    renderMockSession(result);
    window.scrollTo({ top: 0, behavior: "smooth" });
  } catch { alert("模試を採点できませんでした。"); }
}

function topicPerformance() {
  const groups = new Map();
  for (const result of allResults()) {
    const key = result.topicId || `${result.subject}:${result.topic}`;
    const current = groups.get(key) || { subject: result.subject, topic: result.topic, answered: 0, correct: 0 };
    current.answered += 1;
    current.correct += result.correct ? 1 : 0;
    groups.set(key, current);
  }
  return [...groups.values()].map((item) => ({ ...item, rate: Math.round(item.correct / item.answered * 100) }));
}

function renderProgress() {
  pageTitle.textContent = "学習記録";
  const weak = topicPerformance().filter((item) => item.rate < 80).sort((a, b) => a.rate - b.rate || b.answered - a.answered).slice(0, 12);
  app.innerHTML = `<section class="view-stack"><div class="section-heading"><div><span class="eyebrow">LEARNING LOG</span><h2>80点までの差分</h2><p>正答率80%未満の論点を、次の演習へ戻します。</p></div><button class="danger" data-reset>記録をリセット</button></div>
    ${statCards()}
    <div class="subject-progress">${content.subjects.map((subject) => { const value = subjectStats(subject.id); return `<article><div><strong>${escapeHtml(subject.label)}</strong><span>${value.answered}問</span></div><b>${value.rate}<small>%</small></b><i><em style="width:${value.rate}%"></em><u></u></i></article>`; }).join("")}</div>
    <div class="two-column progress-columns"><div><div class="section-heading"><div><span class="eyebrow">WEAK TOPICS</span><h2>80%未満の論点</h2></div></div><div class="weak-list">${weak.map((item) => `<button data-weak-topic="${escapeHtml(item.topic)}" data-weak-subject="${item.subject}"><span><strong>${escapeHtml(item.topic)}</strong><small>${escapeHtml(subjectLabel(item.subject))}・${item.answered}問</small></span><b>${item.rate}%</b></button>`).join("") || '<div class="panel empty">採点すると弱点論点が表示されます。</div>'}</div></div>
      <div><div class="section-heading"><div><span class="eyebrow">OFFICIAL MOCK</span><h2>令和8年度 模試結果</h2></div></div><div class="mock-history">${content.subjects.map((subject) => { const result = state.mockResults[subject.id]; return `<article><span>${escapeHtml(subject.shortLabel)}</span><strong>${result ? result.score : "—"}<small>/100</small></strong><button data-start-mock="${subject.id}">${result ? "再挑戦" : "開始"}</button></article>`; }).join("")}</div></div></div>
  </section>`;
}

async function startReview(mode) {
  const incorrect = Object.entries(state.results).filter(([, result]) => !result.correct).map(([id]) => id);
  const flagged = Object.entries(state.flags).filter(([, value]) => value).map(([id]) => id);
  let ids = mode === "incorrect" ? incorrect : mode === "flagged" ? flagged : [...new Set([...incorrect, ...flagged])];
  if (ids.length) return beginRemote({ ids: ids.slice(0, 50).join(","), limit: Math.min(50, ids.length) });
  const subject = recommendedSubject();
  return beginRemote({ subject: subject.id, limit: 20 });
}

document.addEventListener("click", (event) => {
  const viewButton = event.target.closest("[data-view]");
  if (viewButton) return setView(viewButton.dataset.view);
  const courseButton = event.target.closest("[data-set-course]");
  if (courseButton) {
    state.plan.targetScore = Number(courseButton.dataset.setCourse);
    queueSave();
    return setView(currentView === "session" ? "practice" : currentView);
  }
  const subjectButton = event.target.closest("[data-start-subject]");
  if (subjectButton) return beginRemote({ subject: subjectButton.dataset.startSubject, limit: currentPhase().sessionSize });
  if (event.target.closest("[data-adaptive]")) return startReview("adaptive");
  if (event.target.closest("[data-start-filtered]")) {
    return beginRemote({
      subject: document.querySelector("#subjectFilter").value,
      topic: document.querySelector("#topicFilter").value,
      difficulty: document.querySelector("#difficultyFilter").value,
      limit: document.querySelector("#limitFilter").value
    });
  }
  const review = event.target.closest("[data-review]")?.dataset.review;
  if (review) return startReview(review);
  const jump = event.target.closest("[data-jump]");
  if (jump) { currentIndex = Number(jump.dataset.jump); return renderQuestion(); }
  if (event.target.closest("[data-prev]")) { currentIndex -= 1; return renderQuestion(); }
  if (event.target.closest("[data-next]")) { currentIndex += 1; return renderQuestion(); }
  if (event.target.closest("[data-grade]")) return gradeCurrent();
  if (event.target.closest("[data-flag]")) { const id = session[currentIndex].id; state.flags[id] = !state.flags[id]; queueSave(); return renderQuestion(); }
  const planSubjectButton = event.target.closest("[data-plan-subject]");
  if (planSubjectButton) { studySubject = planSubjectButton.dataset.planSubject; return renderPlan(); }
  const mockButton = event.target.closest("[data-start-mock]");
  if (mockButton) return startOfficialMock(mockButton.dataset.startMock);
  if (event.target.closest("[data-grade-mock]")) return gradeMock();
  const weakButton = event.target.closest("[data-weak-topic]");
  if (weakButton) {
    const topic = content.topics.find((item) => item.subject === weakButton.dataset.weakSubject && item.label === weakButton.dataset.weakTopic);
    return beginRemote({ subject: weakButton.dataset.weakSubject, topic: topic?.id || "", limit: 20 });
  }
  if (event.target.closest("[data-reset]") && confirm("R4の回答・採点・模試・メモをすべて削除しますか？")) { state = freshState(); queueSave(); renderProgress(); }
});

document.addEventListener("change", (event) => {
  if (event.target.matches("#subjectFilter")) {
    const topic = document.querySelector("#topicFilter");
    topic.innerHTML = `<option value="">すべて</option>${topicOptions(event.target.value)}`;
  }
  if (event.target.matches("[data-plan-check]")) {
    state.plan.completed[event.target.dataset.planCheck] = event.target.checked;
    queueSave();
  }
});

document.addEventListener("input", (event) => {
  if (!session.length || currentView !== "session") return;
  const question = session[currentIndex];
  if (event.target.matches("#questionNote")) state.notes[question.id] = event.target.value;
  else if (event.target.matches('input[name="answer"]')) state.answers[question.id] = collectAnswer();
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
    document.querySelector("#brandShort").textContent = content.exam.shortName || "ROAD TO 80";
    document.querySelector("#todayLabel").textContent = new Intl.DateTimeFormat("ja-JP", { dateStyle: "long" }).format(new Date());
    const theme = content.exam.theme || {};
    if (theme.primary) document.documentElement.style.setProperty("--primary", theme.primary);
    if (theme.accent) document.documentElement.style.setProperty("--accent", theme.accent);
    if (theme.ink) document.documentElement.style.setProperty("--ink", theme.ink);
    await initializePersistence();
    renderHome();
  } catch (error) {
    console.error(error);
    app.innerHTML = '<div class="panel empty">R4のデータを読み込めませんでした。生成済みデータとAPIを確認してください。</div>';
  }
}

boot();
