const app = document.querySelector("#app");
const pageTitle = document.querySelector("#pageTitle");
const saveStatus = document.querySelector("#saveStatus");

let content = null;
let currentView = "home";
let session = [];
let activeSession = null;
let currentIndex = 0;
let databaseEnabled = false;
let saveTimer = null;
let saveInFlight = false;
let savePending = false;
let remoteVersion = 0;
let studySubject = "finance";
let mockSubject = null;
let mockEndAt = null;
let mockStartedAt = null;
let mockTimer = null;
let state = freshState();
const feedbackCache = new Map();
const eliminatedChoices = new Map();
const dirtySessionRevisions = new Map();
const deletedSessionIds = new Set();
let calculatorState = CalculatorCore.initialState({ minimized: true });

function freshState() {
  return {
    schemaVersion: 5,
    answers: {},
    results: {},
    flags: {},
    archived: {},
    archiveResets: {},
    notes: {},
    attempts: {},
    recent: [],
    mockResults: {},
    activity: {},
    sessions: [],
    plan: { targetScore: 60, foundationCheckpoint: 1, completed: {}, autoCompleted: {} },
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
  return escapeHtml(value)
    .replace(/\[([^\]]+)\]\((https:\/\/[^\s)]+)\)/g, '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>')
    .replace(/(^|[\s（「『【、,:：」』】])(https:\/\/[^\s<>"）)]+)/gu, '$1<a href="$2" target="_blank" rel="noopener noreferrer">$2</a>')
    .replace(/`([^`]+)`/g, "<code>$1</code>")
    .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>");
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
      index += 1;
      continue;
    }
    const heading = line.match(/^#{2,4}\s+(.+)/);
    if (heading) {
      blocks.push(`<h4>${inlineMarkdown(heading[1])}</h4>`);
      index += 1;
      continue;
    }
    if (/^\s*\d+[.)]\s+/.test(line)) {
      const items = [];
      while (index < lines.length && /^\s*\d+[.)]\s+/.test(lines[index])) {
        items.push(lines[index].replace(/^\s*\d+[.)]\s+/, ""));
        index += 1;
      }
      blocks.push(`<ol>${items.map((item) => `<li>${inlineMarkdown(item)}</li>`).join("")}</ol>`);
      continue;
    }
    if (/^\s*[-*・]\s+/.test(line)) {
      const items = [];
      while (index < lines.length && /^\s*[-*・]\s+/.test(lines[index])) {
        items.push(lines[index].replace(/^\s*[-*・]\s+/, ""));
        index += 1;
      }
      blocks.push(`<ul>${items.map((item) => `<li>${inlineMarkdown(item)}</li>`).join("")}</ul>`);
      continue;
    }
    if (/^>\s?/.test(line)) {
      blocks.push(`<blockquote>${inlineMarkdown(line.replace(/^>\s?/, ""))}</blockquote>`);
      index += 1;
      continue;
    }
    blocks.push(`<p>${inlineMarkdown(line)}</p>`);
    index += 1;
  }
  return blocks.join("");
}

function mergeState(value) {
  const base = freshState();
  const merged = {
    ...base,
    ...(value || {}),
    answers: { ...(value?.answers || {}) },
    results: { ...(value?.results || {}) },
    flags: { ...(value?.flags || {}) },
    archived: { ...(value?.archived || {}) },
    archiveResets: { ...(value?.archiveResets || {}) },
    notes: { ...(value?.notes || {}) },
    attempts: { ...(value?.attempts || {}) },
    recent: Array.isArray(value?.recent) ? value.recent.slice(0, 100) : [],
    mockResults: { ...(value?.mockResults || {}) },
    sessions: Array.isArray(value?.sessions) ? value.sessions.filter((item) => item && item.id).slice(-2000) : [],
    activity: Object.fromEntries(Object.entries(value?.activity || {}).map(([date, item]) => [date, {
      answered: Math.max(0, Number(item?.answered) || 0),
      correct: Math.max(0, Number(item?.correct) || 0),
      mockMinutes: Math.max(0, Number(item?.mockMinutes) || 0),
      planChecks: Math.max(0, Number(item?.planChecks) || 0)
    }])),
    plan: { ...base.plan, ...(value?.plan || {}), completed: { ...(value?.plan?.completed || {}) }, autoCompleted: { ...(value?.plan?.autoCompleted || {}) } }
  };
  merged.schemaVersion = 5;
  if (!Object.keys(merged.activity).length) {
    for (const result of Object.values(merged.results)) {
      if (!result.answeredAt) continue;
      const key = localDateKey(result.answeredAt);
      const current = merged.activity[key] || { answered: 0, correct: 0, mockMinutes: 0, planChecks: 0 };
      current.answered += 1;
      current.correct += result.correct ? 1 : 0;
      merged.activity[key] = current;
    }
  }
  if (!merged.sessions.length && Object.keys(merged.results).length) {
    const legacyGroups = new Map();
    for (const [questionId, result] of Object.entries(merged.results)) {
      const date = localDateKey(result.answeredAt || merged.savedAt || new Date());
      const current = legacyGroups.get(date) || { id: `legacy-${date}`, type: "legacy", label: "移行前の演習記録", course: result.minimumCourse || 60, startedAt: `${date}T00:00:00`, lastActivityAt: `${date}T23:59:59`, results: [] };
      current.results.push({ ...result, questionId: result.questionId || questionId });
      legacyGroups.set(date, current);
    }
    merged.sessions = [...legacyGroups.values()];
  }
  for (const [subjectId, result] of Object.entries(merged.mockResults)) {
    if (merged.sessions.some((item) => item.type === "official-mock" && item.subject === subjectId)) continue;
    const finishedAt = result.finishedAt || merged.savedAt || new Date().toISOString();
    merged.sessions.push({ id: `legacy-mock-${subjectId}-${localDateKey(finishedAt)}`, type: "official-mock", label: `令和8年度 ${subjectLabel(subjectId)} 公式模試`, subject: subjectId, course: 80, startedAt: finishedAt, finishedAt, lastActivityAt: finishedAt, questionCount: content.officialExam.subjects[subjectId]?.answerSlots.length || 0, mockMinutes: 0, summary: { score: result.score || 0, maxScore: result.maxScore || 100, answered: 0 }, results: [] });
  }
  if (![60, 70, 80].includes(Number(merged.plan.targetScore))) merged.plan.targetScore = 60;
  if (![1, 2, 3].includes(Number(merged.plan.foundationCheckpoint))) merged.plan.foundationCheckpoint = 1;
  return merged;
}

async function initializePersistence() {
  let local = null;
  try { local = JSON.parse(localStorage.getItem(storageKey()) || "null"); } catch { local = null; }
  try {
    const response = await fetch("/api/progress");
    const saved = await response.json();
    databaseEnabled = Boolean(saved.configured);
    remoteVersion = Math.max(0, Number(saved.version) || 0);
    const localIsNewer = local?.savedAt && (!saved.updatedAt || new Date(local.savedAt) > new Date(saved.updatedAt));
    const selected = saved.exists && !localIsNewer ? saved.state : local;
    state = mergeState(selected);
    rebuildAggregatesFromSessions();
    saveStatus.textContent = databaseEnabled ? "Neonへ自動保存" : "この端末に自動保存";
    if (databaseEnabled && local && (!saved.exists || localIsNewer)) {
      for (const item of state.sessions) markSessionDirty(item.id);
      await persistNow();
    }
  } catch {
    state = mergeState(local);
    rebuildAggregatesFromSessions();
    saveStatus.textContent = "この端末に自動保存";
  }
}

function compactStateForRemote() {
  const { sessions, results, attempts, recent, mockResults, ...snapshot } = state;
  const plan = { ...(snapshot.plan || {}) };
  delete plan.autoCompleted;
  return { ...snapshot, plan };
}

function markSessionDirty(sessionId) {
  if (!sessionId) return;
  dirtySessionRevisions.set(sessionId, (dirtySessionRevisions.get(sessionId) || 0) + 1);
  deletedSessionIds.delete(sessionId);
}

function storeLocally() {
  try {
    localStorage.setItem(storageKey(), JSON.stringify(state));
    return true;
  } catch {
    saveStatus.textContent = "端末の保存容量を確認してください";
    return false;
  }
}

function dirtySessionBatch(maximumCount = 20, maximumCharacters = 200_000) {
  const batch = new Map();
  let characters = 0;
  for (const [id, revision] of dirtySessionRevisions) {
    const sessionItem = state.sessions.find((item) => item.id === id);
    if (!sessionItem) continue;
    const size = JSON.stringify(sessionItem).length;
    if (batch.size && (batch.size >= maximumCount || characters + size > maximumCharacters)) break;
    batch.set(id, revision);
    characters += size;
  }
  return batch;
}

function queueSave() {
  state.savedAt = new Date().toISOString();
  if (storeLocally()) saveStatus.textContent = "保存中…";
  clearTimeout(saveTimer);
  saveTimer = setTimeout(persistNow, 450);
}

async function persistNow() {
  const storedLocally = storeLocally();
  if (!databaseEnabled) { if (storedLocally) saveStatus.textContent = "この端末に保存済み"; return; }
  if (saveInFlight) { savePending = true; return; }
  saveInFlight = true;
  const sentSessions = dirtySessionBatch();
  const sentDeleted = [...deletedSessionIds].slice(0, 50);
  try {
    const response = await fetch("/api/progress", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        state: compactStateForRemote(),
        sessions: state.sessions.filter((item) => sentSessions.has(item.id)),
        deletedSessionIds: sentDeleted,
        expectedVersion: remoteVersion
      })
    });
    if (response.status === 409) {
      savePending = false;
      clearTimeout(saveTimer);
      saveStatus.textContent = "別端末の更新あり・再読込してください";
      return;
    }
    if (!response.ok) throw new Error("save_failed");
    const saved = await response.json();
    remoteVersion = Math.max(remoteVersion, Number(saved.version) || 0);
    for (const [id, revision] of sentSessions) {
      if (dirtySessionRevisions.get(id) === revision) dirtySessionRevisions.delete(id);
    }
    for (const id of sentDeleted) deletedSessionIds.delete(id);
    if (dirtySessionRevisions.size || deletedSessionIds.size) savePending = true;
    saveStatus.textContent = "Neonへ保存済み";
  } catch { saveStatus.textContent = "端末へ一時保存"; }
  finally {
    saveInFlight = false;
    if (savePending) {
      savePending = false;
      clearTimeout(saveTimer);
      saveTimer = setTimeout(persistNow, 0);
    }
  }
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
  if (view === "overview") renderOverview();
  if (view === "history") renderHistory();
  if (view === "archive") renderArchive();
}

function allResults() {
  return Object.values(state.results);
}

function isArchived(questionId) {
  const entry = state.archived[questionId];
  return entry === true || Boolean(entry?.archivedAt);
}

function archiveCount() {
  return Object.keys(state.archived).filter(isArchived).length;
}

function archiveQuestion(questionId, reason = "manual", correctDayStreak = 0) {
  state.archived[questionId] = {
    archivedAt: new Date().toISOString(),
    reason,
    correctDayStreak
  };
}

function restoreArchivedQuestion(questionId) {
  delete state.archived[questionId];
  state.archiveResets[questionId] = new Date().toISOString();
}

function stats(results = allResults()) {
  const correct = results.filter((result) => result.correct).length;
  return { answered: results.length, correct, rate: results.length ? Math.round(correct / results.length * 100) : 0 };
}

function subjectStats(subjectId) {
  return stats(allResults().filter((result) => result.subject === subjectId));
}

function clamp(value, minimum = 0, maximum = 100) {
  return Math.min(maximum, Math.max(minimum, value));
}

function localDateKey(value = new Date()) {
  const date = new Date(value);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function inferredActivity(dateKey) {
  const results = allResults().filter((result) => localDateKey(result.answeredAt) === dateKey);
  return {
    answered: results.length,
    correct: results.filter((result) => result.correct).length,
    mockMinutes: 0,
    planChecks: 0
  };
}

function activityFor(dateKey = localDateKey()) {
  return state.activity[dateKey] || inferredActivity(dateKey);
}

function recordActivity(type, value = 1) {
  const key = localDateKey();
  const current = { ...(state.activity[key] || { answered: 0, correct: 0, mockMinutes: 0, planChecks: 0 }) };
  if (type === "answer") {
    current.answered += 1;
    current.correct += value ? 1 : 0;
  }
  if (type === "mock") current.mockMinutes += Math.max(0, Number(value) || 0);
  if (type === "plan") current.planChecks = Math.max(0, current.planChecks + Number(value || 0));
  state.activity[key] = current;
}

function phaseTiming(phase) {
  const start = new Date(`${phase.start}T00:00:00`);
  const end = new Date(`${phase.end}T23:59:59`);
  const now = new Date();
  const total = Math.max(1, end - start);
  const percent = clamp(Math.round((now - start) / total * 100));
  const daysLeft = Math.max(0, Math.ceil((end - now) / 86400000));
  const status = now < start ? "upcoming" : now > end ? "past" : "current";
  return { percent, daysLeft, status };
}

function overallTiming() {
  const start = new Date(`${content.learningPhases[0].start}T00:00:00`);
  const end = new Date(`${content.exam.targetExamDate}T00:00:00`);
  return clamp(Math.round((new Date() - start) / Math.max(1, end - start) * 100));
}

function milestoneKey(phaseId, index) {
  return `milestone:${phaseId}:${index}`;
}

function phaseMilestoneProgress(phase) {
  const milestones = phase.milestones || [];
  const done = milestones.filter((_, index) => state.plan.completed[milestoneKey(phase.id, index)]).length;
  return { done, total: milestones.length, percent: milestones.length ? Math.round(done / milestones.length * 100) : 0 };
}

function financeMilestoneKey(id) {
  return `finance-track:${id}`;
}

function financeMilestoneProgress() {
  const milestones = content.financeTrack?.milestones || [];
  const done = milestones.filter((item) => state.plan.completed[financeMilestoneKey(item.id)]).length;
  return { done, total: milestones.length, percent: milestones.length ? Math.round(done / milestones.length * 100) : 0 };
}

function recentActivity(days = 7) {
  return Array.from({ length: days }, (_, index) => {
    const date = new Date();
    date.setHours(12, 0, 0, 0);
    date.setDate(date.getDate() - (days - 1 - index));
    const value = activityFor(localDateKey(date));
    return {
      key: localDateKey(date),
      label: new Intl.DateTimeFormat("ja-JP", { weekday: "short" }).format(date),
      ...value,
      total: value.answered + (value.mockMinutes ? Math.max(1, Math.round(value.mockMinutes / 4)) : 0)
    };
  });
}

function studyStreak() {
  let streak = 0;
  const date = new Date();
  date.setHours(12, 0, 0, 0);
  for (let offset = 0; offset < 366; offset += 1) {
    const value = activityFor(localDateKey(date));
    if (value.answered || value.mockMinutes || value.planChecks) streak += 1;
    else if (offset > 0) break;
    date.setDate(date.getDate() - 1);
  }
  return streak;
}

function subjectWeight(subjectId, phase = currentPhase()) {
  return Number(phase.subjectWeights?.[subjectId] ?? content.subjects.find((subject) => subject.id === subjectId)?.weeklyWeight ?? 0);
}

function formatMonthDay(value) {
  return new Intl.DateTimeFormat("ja-JP", { month: "numeric", day: "numeric" }).format(new Date(`${value}T00:00:00`));
}

function newSessionId(prefix = "session") {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function practiceRecords() {
  return state.sessions.flatMap((item) => (item.results || []).map((result) => ({ ...result, sessionId: item.id, sessionStartedAt: item.startedAt })));
}

function beginTrackedSession(questions, meta = {}) {
  const subjects = [...new Set(questions.map((question) => question.subject))];
  activeSession = {
    id: newSessionId(meta.type || "practice"),
    type: meta.type || "practice",
    label: meta.label || (subjects.length === 1 ? `${subjectLabel(subjects[0])} 演習` : "横断演習"),
    subject: subjects.length === 1 ? subjects[0] : null,
    course: Number(state.plan.targetScore),
    startedAt: new Date().toISOString(),
    lastActivityAt: null,
    questionCount: questions.length,
    filters: meta.filters || {},
    results: []
  };
}

function recordSessionResult(result) {
  if (!activeSession) beginTrackedSession(session);
  if (!state.sessions.some((item) => item.id === activeSession.id)) state.sessions.push(activeSession);
  const record = {
    questionId: result.questionId,
    subject: result.subject,
    topic: result.topic,
    topicId: result.topicId,
    minimumCourse: result.minimumCourse,
    foundationCheckpoint: result.foundationCheckpoint || null,
    difficulty: result.difficulty,
    correct: result.correct,
    answeredAt: new Date().toISOString()
  };
  activeSession.results.push(record);
  activeSession.lastActivityAt = record.answeredAt;
  markSessionDirty(activeSession.id);
}

function consecutiveCorrectDayCount(questionId) {
  const resetAt = state.archiveResets[questionId] ? new Date(state.archiveResets[questionId]) : null;
  const dailyResults = new Map();
  const records = practiceRecords()
    .filter((record) => record.questionId === questionId && (!resetAt || new Date(record.answeredAt) > resetAt))
    .sort((a, b) => new Date(a.answeredAt) - new Date(b.answeredAt));
  for (const record of records) dailyResults.set(localDateKey(record.answeredAt), record.correct);
  let streak = 0;
  for (const correct of [...dailyResults.values()].reverse()) {
    if (!correct) break;
    streak += 1;
  }
  return streak;
}

function autoArchiveMasteredQuestion(questionId) {
  if (isArchived(questionId)) return false;
  const streak = consecutiveCorrectDayCount(questionId);
  if (streak < 3) return false;
  archiveQuestion(questionId, "auto", streak);
  return true;
}

function strictCriteria(score) {
  if (score >= 80) return { questions: 10, sessions: 3, rate: 90, recentRate: 90 };
  if (score >= 70) return { questions: 7, sessions: 2, rate: 85, recentRate: 85 };
  return { questions: 5, sessions: 2, rate: 85, recentRate: 80 };
}

function autoItemStatus(subjectId, score, item) {
  const criteria = strictCriteria(score);
  const topic = item.topicId ? content.topics.find((value) => value.id === item.topicId) : null;
  const eligibleTopicCount = Number(topic?.courseCounts?.[score] || 0);
  const mapped = Boolean(item.topicId && eligibleTopicCount);
  let records = practiceRecords().filter((record) => record.subject === subjectId && Number(record.minimumCourse || 60) <= score);
  if (mapped) records = records.filter((record) => record.topicId === item.topicId);
  const requiredQuestions = Math.max(1, Math.min(criteria.questions, mapped ? eligibleTopicCount : criteria.questions));
  const uniqueQuestions = new Set(records.map((record) => record.questionId)).size;
  const sessions = new Set(records.map((record) => record.sessionId)).size;
  const correct = records.filter((record) => record.correct).length;
  const rate = records.length ? Math.round(correct / records.length * 100) : 0;
  const recent = [...records].sort((a, b) => new Date(b.answeredAt) - new Date(a.answeredAt)).slice(0, Math.max(requiredQuestions, 10));
  const recentRate = recent.length ? Math.round(recent.filter((record) => record.correct).length / recent.length * 100) : 0;
  const passed = uniqueQuestions >= requiredQuestions && sessions >= criteria.sessions && rate >= criteria.rate && recentRate >= criteria.recentRate;
  return { passed, uniqueQuestions, requiredQuestions, sessions, requiredSessions: criteria.sessions, rate, requiredRate: criteria.rate, recentRate, requiredRecentRate: criteria.recentRate, mapped, topic: topic?.label || null };
}

function planItemKey(subjectId, score, groupIndex, itemIndex) {
  return `${subjectId}:${score}:${groupIndex}:${itemIndex}`;
}

function refreshAutoPlanCompletion() {
  const next = {};
  for (const [subjectId, plan] of Object.entries(content.studyPlans.subjects)) {
    for (const course of plan.courses) {
      course.groups.forEach((group, groupIndex) => group.items.forEach((item, itemIndex) => {
        const key = planItemKey(subjectId, course.targetScore, groupIndex, itemIndex);
        next[key] = autoItemStatus(subjectId, course.targetScore, item).passed;
      }));
    }
  }
  state.plan.autoCompleted = next;
}

function courseProgress(score, subjectId = null) {
  const results = Object.values(state.results).filter((result) => (!subjectId || result.subject === subjectId) && Number(result.minimumCourse || 60) <= score);
  const total = subjectId ? Number(content.courseCounts[score].subjects[subjectId]) : Number(content.courseCounts[score].total);
  const answered = new Set(results.map((result) => result.questionId)).size;
  const records = practiceRecords().filter((result) => (!subjectId || result.subject === subjectId) && Number(result.minimumCourse || 60) <= score);
  const rate = records.length ? Math.round(records.filter((result) => result.correct).length / records.length * 100) : 0;
  let autoDone = 0;
  let autoTotal = 0;
  const plans = subjectId ? [[subjectId, content.studyPlans.subjects[subjectId]]] : Object.entries(content.studyPlans.subjects);
  for (const [planSubject, plan] of plans) {
    const course = plan.courses.find((item) => item.targetScore === score);
    if (!course) continue;
    course.groups.forEach((group, groupIndex) => group.items.forEach((item, itemIndex) => {
      autoTotal += 1;
      if (state.plan.autoCompleted[planItemKey(planSubject, score, groupIndex, itemIndex)]) autoDone += 1;
    }));
  }
  return { score, total, answered, progress: total ? Math.round(answered / total * 100) : 0, rate, autoDone, autoTotal };
}

function layerCriteria(score) {
  if (score >= 80) return { questions: 40, sessions: 4, rate: 90, recentRate: 90 };
  if (score >= 70) return { questions: 40, sessions: 3, rate: 85, recentRate: 85 };
  return { questions: 60, sessions: 4, rate: 85, recentRate: 80 };
}

function foundationCheckpointForResult(result) {
  return Number(result.foundationCheckpoint || content.foundationQuestionCheckpoints?.[result.questionId] || 0);
}

function foundationCheckpointProgress(checkpointId, subjectId = null) {
  const checkpoint = content.foundationCheckpoints.find((item) => Number(item.id) === Number(checkpointId));
  if (!checkpoint) return { passed: false, answered: 0, total: 0, rate: 0, recentRate: 0, sessions: 0, requiredQuestions: 0 };
  const matches = (result) => (
    (!subjectId || result.subject === subjectId)
    && Number(result.minimumCourse || 60) === 60
    && foundationCheckpointForResult(result) === Number(checkpointId)
  );
  const results = Object.values(state.results).filter(matches);
  const records = practiceRecords().filter(matches);
  const total = subjectId
    ? Number(content.foundationCheckpointCounts[checkpointId]?.subjects?.[subjectId] || 0)
    : Number(content.foundationCheckpointCounts[checkpointId]?.total || 0);
  const answered = new Set(results.map((result) => result.questionId)).size;
  const sessions = new Set(records.map((record) => record.sessionId)).size;
  const rate = records.length ? Math.round(records.filter((record) => record.correct).length / records.length * 100) : 0;
  const recent = [...records].sort((left, right) => new Date(right.answeredAt) - new Date(left.answeredAt)).slice(0, 20);
  const recentRate = recent.length ? Math.round(recent.filter((record) => record.correct).length / recent.length * 100) : 0;
  const requiredQuestions = subjectId
    ? Math.min(total, Number(checkpoint.requiredQuestionsPerSubject) || 15)
    : (Number(checkpoint.requiredQuestionsPerSubject) || 15) * content.subjects.length;
  const requiredSessions = subjectId ? Number(checkpoint.requiredSessionsPerSubject) || 2 : 0;
  const ownPassed = answered >= requiredQuestions
    && (!subjectId || sessions >= requiredSessions)
    && rate >= Number(checkpoint.requiredRate)
    && recentRate >= Number(checkpoint.requiredRecentRate);
  const subjects = subjectId ? [] : content.subjects.map((subject) => foundationCheckpointProgress(checkpointId, subject.id));
  const passed = subjectId ? ownPassed : subjects.every((value) => value.passed);
  return { checkpoint, total, answered, progress: total ? Math.round(answered / total * 100) : 0, rate, sessions, recentRate, requiredQuestions, requiredSessions, subjects, passed };
}

function foundationReadiness() {
  const checkpoints = content.foundationCheckpoints.map((item) => foundationCheckpointProgress(item.id));
  return { checkpoints, passed: checkpoints.every((item) => item.passed), failed: checkpoints.filter((item) => !item.passed).map((item) => item.checkpoint.id) };
}

function isFoundationCheckpointUnlocked(checkpointId) {
  if (Number(checkpointId) === 1) return true;
  return content.foundationCheckpoints
    .filter((item) => Number(item.id) < Number(checkpointId))
    .every((item) => foundationCheckpointProgress(item.id).passed);
}

function highestUnlockedFoundationCheckpoint() {
  return [3, 2, 1].find((checkpointId) => isFoundationCheckpointUnlocked(checkpointId)) || 1;
}

function refreshFoundationCheckpoint(autoAdvance = false) {
  const highest = highestUnlockedFoundationCheckpoint();
  const current = Number(state.plan.foundationCheckpoint);
  if (!isFoundationCheckpointUnlocked(current) || (autoAdvance && foundationCheckpointProgress(current).passed && highest > current)) {
    state.plan.foundationCheckpoint = highest;
  }
}

function tierProgress(score, subjectId = null) {
  const matches = (result) => (!subjectId || result.subject === subjectId) && Number(result.minimumCourse || 60) === score;
  const results = Object.values(state.results).filter(matches);
  const records = practiceRecords().filter(matches);
  const total = subjectId ? Number(content.courseCounts[score].addedSubjects[subjectId]) : Number(content.courseCounts[score].addedAtCourse);
  const answered = new Set(results.map((result) => result.questionId)).size;
  const correct = records.filter((record) => record.correct).length;
  const rate = records.length ? Math.round(correct / records.length * 100) : 0;
  const sessions = new Set(records.map((record) => record.sessionId)).size;
  const recent = [...records].sort((a, b) => new Date(b.answeredAt) - new Date(a.answeredAt)).slice(0, 20);
  const recentRate = recent.length ? Math.round(recent.filter((record) => record.correct).length / recent.length * 100) : 0;
  const criteria = layerCriteria(score);
  const requiredQuestions = Math.min(total, subjectId ? Math.ceil(criteria.questions / content.subjects.length) : criteria.questions);
  const ownPassed = answered >= requiredQuestions && sessions >= criteria.sessions && rate >= criteria.rate && recentRate >= criteria.recentRate;
  const subjectLayers = subjectId ? [] : content.subjects.map((subject) => tierProgress(score, subject.id));
  const passed = ownPassed && (subjectId || subjectLayers.every((layer) => layer.passed));
  return { score, total, answered, progress: total ? Math.round(answered / total * 100) : 0, rate, sessions, recentRate, criteria, requiredQuestions, subjectLayers, passed };
}

function courseReadiness(score) {
  const requiredScores = [70, 80].filter((value) => value <= score);
  const layers = requiredScores.map((value) => tierProgress(value));
  const cumulative = courseProgress(score);
  const foundation = foundationReadiness();
  const failedLayers = [...(!foundation.passed ? [60] : []), ...layers.filter((layer) => !layer.passed).map((layer) => layer.score)];
  return { ...cumulative, foundation, layers, passed: failedLayers.length === 0, failedLayers };
}

function isCourseUnlocked(score) {
  if (score === 60) return true;
  if (!foundationReadiness().passed) return false;
  return [70, 80].filter((value) => value < score).every((value) => tierProgress(value).passed);
}

function highestUnlockedCourse() {
  return [80, 70, 60].find((score) => isCourseUnlocked(score)) || 60;
}

function weightedAllocation(total, weights) {
  const entries = Object.entries(weights || {});
  const floors = Object.fromEntries(entries.map(([id, weight]) => [id, Math.floor(total * Number(weight) / 100)]));
  let remainder = total - Object.values(floors).reduce((sum, value) => sum + value, 0);
  const order = entries
    .map(([id, weight]) => ({ id, fraction: total * Number(weight) / 100 - floors[id] }))
    .sort((left, right) => right.fraction - left.fraction || left.id.localeCompare(right.id));
  for (let index = 0; index < order.length && remainder > 0; index += 1, remainder -= 1) floors[order[index].id] += 1;
  return floors;
}

function phaseWorkload(phase = currentPhase()) {
  const now = new Date();
  const start = new Date(`${phase.start}T00:00:00`);
  const end = new Date(`${phase.end}T23:59:59`);
  const elapsedDays = now < start ? 0 : Math.max(0, Math.floor((Math.min(now, end) - start) / 86400000) + 1);
  const expected = Math.round(elapsedDays * phase.sessionSize * 6 / 7);
  const creditStart = new Date(`${phase.creditFrom || phase.start}T00:00:00`);
  const actual = practiceRecords().filter((record) => {
    const date = new Date(record.answeredAt);
    return date >= creditStart && date <= end;
  }).length;
  const variance = actual - expected;
  const backlog = Math.max(0, -variance);
  const remainingDays = Math.max(1, Math.ceil((end - Math.max(now, start)) / 86400000));
  const recoveryDays = Math.max(1, Math.round(remainingDays * 6 / 7));
  const extra = Math.min(Math.ceil(phase.sessionSize * .5), Math.ceil(backlog / recoveryDays));
  const adjustedTarget = phase.sessionSize + extra;
  const allocation = weightedAllocation(adjustedTarget, Object.fromEntries(content.subjects.map((subject) => [subject.id, subjectWeight(subject.id, phase)])));
  const paceStatus = variance > phase.sessionSize ? "ahead" : variance < -phase.sessionSize ? "behind" : "on-track";
  const prelearning = phase.creditFrom ? practiceRecords().filter((record) => { const date = new Date(record.answeredAt); return date >= creditStart && date < start; }).length : 0;
  return { expected, actual, variance, backlog, extra, adjustedTarget, allocation, delayed: paceStatus === "behind", paceStatus, prelearning };
}

function rebuildAggregatesFromSessions() {
  const results = {};
  const attempts = {};
  const recentRecords = [...practiceRecords()].sort((a, b) => new Date(a.answeredAt) - new Date(b.answeredAt));
  for (const record of recentRecords) {
    const id = record.questionId;
    results[id] = { ...record };
    delete results[id].sessionId;
    delete results[id].sessionStartedAt;
    const current = attempts[id] || { count: 0, correct: 0, lastAt: null };
    current.count += 1;
    current.correct += record.correct ? 1 : 0;
    current.lastAt = record.answeredAt;
    attempts[id] = current;
  }
  state.results = results;
  state.attempts = attempts;
  state.recent = [...new Set(recentRecords.reverse().map((record) => record.questionId))].slice(0, 100);
  const mockResults = {};
  for (const item of [...state.sessions].filter((value) => value.type === "official-mock").sort((a, b) => new Date(a.finishedAt || a.startedAt) - new Date(b.finishedAt || b.startedAt))) {
    mockResults[item.subject] = { score: item.summary?.score || 0, maxScore: item.summary?.maxScore || 100, finishedAt: item.finishedAt || item.startedAt };
  }
  state.mockResults = mockResults;
  for (const id of Object.keys(state.answers)) if (!results[id]) delete state.answers[id];
  refreshAutoPlanCompletion();
  refreshFoundationCheckpoint();
}

function removeSession(sessionId) {
  const target = state.sessions.find((item) => item.id === sessionId);
  if (!target) return;
  for (const result of target.results || []) {
    const key = localDateKey(result.answeredAt || target.lastActivityAt || target.startedAt);
    if (!state.activity[key]) continue;
    state.activity[key].answered = Math.max(0, state.activity[key].answered - 1);
    state.activity[key].correct = Math.max(0, state.activity[key].correct - (result.correct ? 1 : 0));
  }
  if (target.mockMinutes) {
    const key = localDateKey(target.finishedAt || target.startedAt);
    if (state.activity[key]) state.activity[key].mockMinutes = Math.max(0, state.activity[key].mockMinutes - target.mockMinutes);
  }
  state.sessions = state.sessions.filter((item) => item.id !== sessionId);
  dirtySessionRevisions.delete(sessionId);
  deletedSessionIds.add(sessionId);
  if (activeSession?.id === sessionId) activeSession = null;
  rebuildAggregatesFromSessions();
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
  const phase = currentPhase();
  const workload = phaseWorkload(phase);
  const todayKey = localDateKey();
  const todayCounts = Object.fromEntries(content.subjects.map((subject) => [subject.id, practiceRecords().filter((record) => record.subject === subject.id && localDateKey(record.answeredAt) === todayKey).length]));
  const scored = content.subjects.map((subject) => ({ subject, weight: subjectWeight(subject.id, phase), todayDeficit: Math.max(0, workload.allocation[subject.id] - todayCounts[subject.id]), ...subjectStats(subject.id) }));
  const pending = scored.filter((item) => item.todayDeficit > 0).sort((a, b) => b.todayDeficit - a.todayDeficit || (a.rate - a.weight) - (b.rate - b.weight));
  if (pending.length) return pending[0].subject;
  const untouched = scored.filter((item) => item.answered === 0).sort((a, b) => b.weight - a.weight);
  return untouched[0]?.subject || scored.sort((a, b) => (a.rate - a.weight) - (b.rate - b.weight) || a.answered - b.answered)[0]?.subject || content.subjects[0];
}

function courseSelector() {
  return `<div class="course-selector" aria-label="演習する問題層">${[60, 70, 80].map((score) => {
    const unlocked = isCourseUnlocked(score);
    const previous = score === 70 ? 60 : 70;
    return `<button class="course-chip ${Number(state.plan.targetScore) === score ? "is-active" : ""} ${unlocked ? "" : "is-locked"}" data-set-course="${score}" ${unlocked ? "" : `disabled title="${previous}点層の到達判定に合格すると開放されます"`}><strong>${score}</strong><span>${unlocked ? "点層" : "🔒"}</span></button>`;
  }).join("")}</div>`;
}

function foundationCheckpointSelector() {
  if (Number(state.plan.targetScore) !== 60) return "";
  return `<div class="foundation-selector" aria-label="60点コースのチェックポイント">${content.foundationCheckpoints.map((checkpoint) => {
    const unlocked = isFoundationCheckpointUnlocked(checkpoint.id);
    const progress = foundationCheckpointProgress(checkpoint.id);
    return `<button class="foundation-chip ${Number(state.plan.foundationCheckpoint) === Number(checkpoint.id) ? "is-active" : ""} ${unlocked ? "" : "is-locked"}" data-set-foundation="${checkpoint.id}" ${unlocked ? "" : "disabled"}><span>${checkpoint.id}</span><strong>${escapeHtml(checkpoint.shortLabel)}</strong><small>${progress.passed ? "達成" : `${progress.answered}/${progress.requiredQuestions}問`}</small></button>`;
  }).join("")}</div>`;
}

function renderHome() {
  pageTitle.textContent = "ダッシュボード";
  const phase = currentPhase();
  const phaseIndex = content.learningPhases.indexOf(phase);
  const timing = phaseTiming(phase);
  const milestoneProgress = phaseMilestoneProgress(phase);
  const recommendation = recommendedSubject();
  const today = activityFor();
  const workload = phaseWorkload(phase);
  const dailyTarget = workload.adjustedTarget;
  const effectiveDone = today.mockMinutes >= 45 ? dailyTarget : today.answered;
  const remaining = Math.max(0, dailyTarget - effectiveDone);
  const todayRate = today.answered ? Math.round(today.correct / today.answered * 100) : 0;
  const week = recentActivity();
  const weekMaximum = Math.max(dailyTarget, ...week.map((item) => item.total));
  const financeProgress = financeMilestoneProgress();
  const nextFinance = content.financeTrack?.milestones.find((item) => !state.plan.completed[financeMilestoneKey(item.id)]);
  const financeDays = Math.max(0, Math.ceil((new Date(`${content.financeTrack.targetDate}T00:00:00`) - new Date()) / 86400000));
  app.innerHTML = `<section class="view-stack">
    <div class="hero dashboard-hero">
      <div class="hero-copy"><span class="eyebrow">${escapeHtml(content.exam.shortName)}</span><h2>${escapeHtml(content.exam.fullName)}</h2><p>${escapeHtml(content.exam.description)}</p>
        <div class="hero-actions"><button class="primary warm" data-adaptive>今日のおすすめを始める</button><button class="ghost" data-view="plan">学習計画を見る</button></div>
      </div>
      <div class="hero-metrics"><div class="target-dial"><small>本試験まで</small><strong>${daysUntilTarget()}</strong><span>days</span><i>目標 各80点</i></div><div class="today-badge ${remaining ? "" : "complete"}"><small>TODAY</small><strong>${remaining ? `あと${remaining}問` : "今日分完了"}</strong><span>${today.answered}問実施${today.mockMinutes ? `・模試${today.mockMinutes}分` : ""}</span></div></div>
    </div>
    <div class="dashboard-lead">
      <article class="panel daily-mission"><div class="dashboard-card-head"><div><span class="eyebrow">TODAY'S MISSION</span><h3>${remaining ? `あと${remaining}問で今日の目安` : "今日の目安を達成しました"}</h3></div><b>${effectiveDone}<small> / ${dailyTarget}問</small></b></div><p>推奨科目は <strong>${escapeHtml(recommendation.label)}</strong>。${today.answered ? `今日の正答率は${todayRate}%です。` : "まず1セッション始めましょう。"}</p><div class="mission-meter"><i style="width:${clamp(effectiveDone / dailyTarget * 100)}%"></i></div><div class="mission-facts"><span>基準 ${phase.sessionSize}問${workload.extra ? ` + 遅延補正 ${workload.extra}問` : ""}</span><span>未消化 ${workload.backlog}問</span><span>連続 ${studyStreak()}日</span><span>見直し ${Object.values(state.flags).filter(Boolean).length}問</span></div><button class="primary" data-start-subject="${recommendation.id}" data-limit="${Math.min(remaining || dailyTarget, dailyTarget)}">${escapeHtml(recommendation.shortLabel)}を${Math.min(remaining || dailyTarget, dailyTarget)}問始める</button></article>
      <article class="panel phase-focus"><div class="phase-ring" style="--progress:${timing.percent * 3.6}deg"><div><strong>${timing.percent}%</strong><small>日程消化</small></div></div><div class="phase-focus-copy"><span class="phase-number">PHASE ${phaseIndex + 1}</span><h3>${escapeHtml(phase.label)}</h3><p>${escapeHtml(phase.goal)}</p><div class="phase-facts"><span>残り${timing.daysLeft}日</span><span>達成項目 ${milestoneProgress.done}/${milestoneProgress.total}</span><span>全期間 ${overallTiming()}%</span></div>${courseSelector()}${foundationCheckpointSelector()}</div></article>
    </div>
    <div class="roadmap-dashboard">${content.learningPhases.map((item, index) => { const itemTiming = phaseTiming(item); const itemProgress = phaseMilestoneProgress(item); return `<article class="roadmap-step ${itemTiming.status}"><div><span>0${index + 1}</span><small>${formatMonthDay(item.start)}〜${formatMonthDay(item.end)}</small></div><strong>${escapeHtml(item.label)}</strong><i><b style="width:${itemTiming.percent}%"></b></i><p>日程 ${itemTiming.percent}%・項目 ${itemProgress.done}/${itemProgress.total}</p></article>`; }).join("")}</div>
    <div class="dashboard-secondary">
      <article class="panel weekly-pulse"><div class="dashboard-card-head"><div><span class="eyebrow">LAST 7 DAYS</span><h3>毎日の学習リズム</h3></div><strong>${week.reduce((sum, item) => sum + item.answered, 0)}<small>問 / 7日</small></strong></div><div class="week-chart">${week.map((item) => `<div><span>${item.total || ""}</span><i><b style="height:${clamp(item.total / weekMaximum * 100)}%"></b></i><small>${escapeHtml(item.label)}</small></div>`).join("")}</div><p>問題演習に加え、公式模試4分を1問相当として高さに反映します。</p></article>
      <article class="panel finance-track"><div class="dashboard-card-head"><div><span class="eyebrow">FINANCE ROUTE</span><h3>${escapeHtml(content.financeTrack.title)}</h3></div><strong>${financeProgress.percent}<small>%</small></strong></div><p>${escapeHtml(content.financeTrack.description)}</p><div class="finance-route"><span style="--share:${phase.financeSplit.bookkeeping}%">簿記2級 <b>${phase.financeSplit.bookkeeping}%</b></span><span style="--share:${phase.financeSplit.primary}%">一次財務 <b>${phase.financeSplit.primary}%</b></span><span style="--share:${phase.financeSplit.case4}%">事例Ⅳ <b>${phase.financeSplit.case4}%</b></span></div><div class="next-milestone"><small>簿記2級目標まで ${financeDays}日</small><strong>${nextFinance ? `${formatMonthDay(nextFinance.date)} ${escapeHtml(nextFinance.label)}` : "財務ルートの節目を完了"}</strong></div><button class="secondary" data-view="plan">財務ルートを確認する</button></article>
    </div>
    <div class="section-heading"><div><span class="eyebrow">SUBJECTS</span><h2>4科目の現在地</h2></div><p>今日の推奨：${escapeHtml(recommendation.label)}</p></div>
    <div class="subject-grid">${content.subjects.map((subject, index) => {
      const value = subjectStats(subject.id);
      const baseline = content.baselineScores?.[subject.id];
      return `<article class="subject-card tone-${index + 1}"><div class="subject-head"><span>${String(index + 1).padStart(2, "0")}</span><small>配分 ${subjectWeight(subject.id, phase)}%</small></div><h3>${escapeHtml(subject.label)}</h3><p>${escapeHtml(subject.description)}</p><div class="subject-scoreline"><span>基準 ${baseline ?? "—"}点</span><strong>${value.answered ? `${value.rate}%` : "未着手"}</strong></div><div class="meter"><i style="width:${value.rate}%"></i></div><div class="subject-foot"><span>${value.answered}問採点</span><button data-start-subject="${subject.id}">演習する →</button></div></article>`;
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
    <div class="section-heading"><div><span class="eyebrow">QUESTION LAB</span><h2>演習セッションを組む</h2><p>${content.totals.questions.toLocaleString()}問を、科目・論点・難易度・目標点で絞り込みます。</p></div><div class="library-stage-selectors">${courseSelector()}${foundationCheckpointSelector()}</div></div>
    <div class="panel filter-panel">
      <label><span>科目</span><select id="subjectFilter">${subjectOptions()}</select></label>
      <label><span>論点</span><select id="topicFilter"><option value="">すべて</option>${topicOptions()}</select></label>
      <label><span>難易度</span><select id="difficultyFilter"><option value="">すべて</option><option>基礎</option><option>標準</option><option>発展</option></select></label>
      <label><span>出題数</span><select id="limitFilter"><option value="10">10問</option><option value="15">15問</option><option value="20" selected>20問</option><option value="30">30問</option><option value="50">50問</option></select></label>
      <button class="primary" data-start-filtered>この条件で開始</button>
    </div>
    <div class="quick-grid">
      <button class="quick-card" data-review="incorrect"><span>RETRY</span><strong>誤答だけ</strong><small>${Object.entries(state.results).filter(([id, result]) => !result.correct && !isArchived(id)).length}問</small></button>
      <button class="quick-card" data-review="flagged"><span>FLAGGED</span><strong>見直しだけ</strong><small>${Object.entries(state.flags).filter(([id, value]) => value && !isArchived(id)).length}問</small></button>
      <button class="quick-card" data-review="adaptive"><span>ADAPTIVE</span><strong>弱点優先</strong><small>誤答 → 見直し → 未着手</small></button>
      <button class="quick-card" data-view="archive"><span>ARCHIVE</span><strong>除外問題を管理</strong><small>${archiveCount()}問</small></button>
    </div>
    <div class="panel legend"><strong>段階開放のルール</strong><p><b>60点</b>：core論点中心　<b>70点</b>：standardまで拡張　<b>80点</b>：発展・新傾向を含む全範囲</p></div>
  </section>`;
}

async function fetchQuestions(params = {}) {
  const queryParams = { ...params, course: state.plan.targetScore, tier: "exact", seed: params.seed || `${Date.now()}` };
  if (Number(state.plan.targetScore) === 60 && !params.ids) queryParams.checkpoint = state.plan.foundationCheckpoint;
  const query = new URLSearchParams(queryParams);
  const response = await fetch(`/api/questions?${query}`);
  if (!response.ok) throw new Error("questions_failed");
  return response.json();
}

async function beginRemote(params, meta = {}) {
  app.innerHTML = '<div class="panel loading">演習セッションを組み立てています…</div>';
  try {
    const desired = Math.max(1, Math.min(100, Number(params.limit) || 20));
    const result = await fetchQuestions({ ...params, limit: params.ids ? desired : 100 });
    const available = result.questions.filter((question) => !isArchived(question.id)).slice(0, desired);
    begin(available, { ...meta, filters: params });
  } catch {
    app.innerHTML = '<div class="panel empty">問題を読み込めませんでした。接続を確認してください。</div>';
  }
}

function begin(questions, meta = {}) {
  if (!questions.length) { alert("条件に合う問題がありません。"); return; }
  session = [...questions];
  beginTrackedSession(session, meta);
  currentIndex = 0;
  state.startedAt ||= new Date().toISOString();
  renderQuestion();
}

function subjectLabel(id) {
  return content.subjects.find((subject) => subject.id === id)?.label || id;
}

function answerMarkup(question, feedback) {
  const saved = state.answers[question.id];
  const selected = new Set(Array.isArray(saved) ? saved : [saved]);
  const eliminated = eliminatedChoices.get(question.id) || new Set();
  const correctAnswers = new Set(Array.isArray(feedback?.correctAnswer) ? feedback.correctAnswer.map(String) : [feedback?.correctAnswer].filter((value) => value !== undefined).map(String));
  return `<p class="choice-help">左の縦チェックは「除外」、選択肢の本文は「回答」です。採点前の回答は薄い青、採点後の正答は緑で表示されます。</p><div class="choices" role="radiogroup" aria-label="回答の選択肢">${question.options.map((option) => {
    const isSelected = selected.has(option.id);
    const resultClass = feedback ? (correctAnswers.has(String(option.id)) ? "is-correct" : isSelected ? "is-incorrect" : "") : "";
    return `<div role="radio" tabindex="${eliminated.has(option.id) ? -1 : 0}" aria-checked="${isSelected}" aria-disabled="${eliminated.has(option.id)}" class="choice ${isSelected ? "is-selected" : ""} ${eliminated.has(option.id) ? "is-eliminated" : ""} ${resultClass}" data-select-choice="${escapeHtml(option.id)}"><button type="button" role="checkbox" class="eliminate-toggle" data-eliminate-choice="${escapeHtml(option.id)}" aria-checked="${eliminated.has(option.id)}" aria-label="選択肢${escapeHtml(option.id)}を除外">${eliminated.has(option.id) ? "×" : ""}</button><span class="choice-key">${escapeHtml(option.id)}</span><span class="choice-text">${richText(option.label)}</span></div>`;
  }).join("")}</div>`;
}

function calculatorMarkup() {
  const keys = [
    ["AC", "clear", "", "calc-function"], ["⌫", "backspace", "", "calc-function"], ["%", "percent", "", "calc-function"], ["÷", "operator", "÷", "calc-operator"],
    ["7", "digit", "7", ""], ["8", "digit", "8", ""], ["9", "digit", "9", ""], ["×", "operator", "×", "calc-operator"],
    ["4", "digit", "4", ""], ["5", "digit", "5", ""], ["6", "digit", "6", ""], ["−", "operator", "−", "calc-operator"],
    ["1", "digit", "1", ""], ["2", "digit", "2", ""], ["3", "digit", "3", ""], ["＋", "operator", "+", "calc-operator"],
    ["±", "sign", "", ""], ["0", "digit", "0", ""], [".", "decimal", "", ""], ["＝", "equals", "", "calc-equals"]
  ];
  return `<div class="calculator ${calculatorState.minimized ? "is-minimized" : ""}"><div class="calculator-bar"><span class="calculator-title">⠿ 電卓</span><button type="button" data-calc-minimize aria-label="電卓を最小化">−</button></div><div class="calculator-body"><div class="calculator-expression">${escapeHtml(calculatorState.expression)}</div><output class="calculator-display">${escapeHtml(calculatorState.display)}</output><div class="calculator-keys">${keys.map(([label, action, value, className]) => `<button type="button" class="${className}" data-calc-action="${action}"${value ? ` data-calc-value="${value}"` : ""}>${label}</button>`).join("")}</div></div><button type="button" class="calculator-compact" data-calc-minimize aria-label="電卓を開く"><span>電卓</span><strong>${escapeHtml(calculatorState.display)}</strong></button></div>`;
}

function useCalculator(action, value) {
  calculatorState = CalculatorCore.reduceCalculator(calculatorState, action, value);
  renderQuestion();
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
    <div class="session-progress"><span>${currentIndex + 1} / ${session.length}</span><i><b style="width:${((currentIndex + 1) / session.length) * 100}%"></b></i><small>${escapeHtml(question.difficulty)}・${question.minimumCourse === 60 ? `60点 ${escapeHtml(content.foundationCheckpoints.find((item) => item.id === question.foundationCheckpoint)?.shortLabel || "基礎")}` : `${question.minimumCourse}点追加層`}</small></div>
    <article class="question-card"><div class="question-meta"><span>${escapeHtml(subjectLabel(question.subject))}</span><span>${escapeHtml(question.topic)}</span><span>${escapeHtml(question.sourceId)}</span>${question.calculationRequired ? "<span>計算</span>" : ""}</div><h2>Q${currentIndex + 1}. ${escapeHtml(question.topic)}</h2><div class="prompt">${richText(question.prompt)}</div><div class="answer-area">${answerMarkup(question, feedback)}</div>
      <div id="feedback" aria-live="polite">${feedback ? feedbackMarkup(feedback, question) : stored ? storedFeedbackMarkup(stored) : ""}</div>
      <label class="note-wrap"><span>自分用メモ</span><textarea class="note-input" id="questionNote" placeholder="間違えた理由、覚え方、再確認日など">${escapeHtml(state.notes[question.id] || "")}</textarea></label>
    </article>
    <div class="actions"><button class="secondary" data-prev ${currentIndex === 0 ? "disabled" : ""}>← 前へ</button><button class="secondary" data-flag>${state.flags[question.id] ? "★ 見直し中" : "☆ 見直す"}</button>${feedback ? `<button class="secondary archive-action" data-archive>${isArchived(question.id) ? "アーカイブを解除" : "アーカイブにする"}</button>` : ""}<button class="primary" data-grade ${feedback ? "disabled" : ""}>${feedback ? "採点済み" : "採点・解説"}</button><button class="secondary" data-next ${currentIndex === session.length - 1 ? "disabled" : ""}>次へ →</button></div>
  </div><aside class="panel navigator"><span class="eyebrow">QUESTION MAP</span><h3>${escapeHtml(subjectLabel(question.subject))}</h3><div class="question-map">${session.map((item, index) => `<button class="map-button ${index === currentIndex ? "current" : ""} ${state.results[item.id] ? "done" : ""} ${state.flags[item.id] ? "flagged" : ""}" data-jump="${index}">${index + 1}</button>`).join("")}</div><button class="text-button" data-view="progress">学習記録を見る →</button></aside>${question.calculationRequired ? calculatorMarkup() : ""}</section>`;
}

function feedbackMarkup(result, question = session[currentIndex]) {
  return `<div class="feedback visual-feedback ${result.correct ? "correct" : "incorrect"}"><div class="feedback-result-banner"><span>${result.correct ? "CORRECT" : "REVIEW"}</span><strong>${result.correct ? "正解です" : "不正解です"}</strong><p>${result.correct ? "判断の流れを確認して、次も再現できる形にします。" : "正答との差を、条件と判断順序から確認します。"}</p></div>${guidedFeedbackExplanationMarkup(question, result)}</div>`;
}

function storedFeedbackMarkup(result) {
  return `<div class="feedback ${result.correct ? "correct" : "incorrect"}"><strong>前回：${result.correct ? "正解" : "不正解"}</strong><p>「採点・解説」を押すと解説を再表示します。</p></div>`;
}

const sampleVisualConfig = {
  finance: {
    eyebrow: "FINANCE MAP",
    title: "数値と会計上の行き先をつなぐ",
    route: ["条件・数値", "計算／会計ルール", "財務諸表への影響", "正答"]
  },
  operations: {
    eyebrow: "OPERATION FLOW",
    title: "現場の流れと評価軸で捉える",
    route: ["投入・前提", "工程／管理手法", "QCD・効率への効果", "正答"]
  },
  law: {
    eyebrow: "LEGAL FRAME",
    title: "主体・原則・例外を分けて照合する",
    route: ["誰が・何を", "原則の手続", "要件・例外", "法的効果と正答"]
  },
  sme: {
    eyebrow: "POLICY & DATA",
    title: "対象・基準・年度を固定して読む",
    route: ["制度／統計の対象", "人数・金額・年度", "支援内容／傾向", "正答"]
  }
};

const sampleKeywords = {
  finance: ["資産", "負債", "純資産", "利益", "キャッシュフロー", "原価", "ROA", "NPV", "資本コスト", "税効果", "仕訳", "リスク"],
  operations: ["4M", "QCD", "PQCDSME", "ECRS", "SLP", "在庫", "発注", "物流", "レイアウト", "品質", "生産性", "工程", "店舗"],
  law: ["会社法", "民法", "株主", "取締役", "特許", "商標", "著作権", "契約", "対抗要件", "決議", "期間", "例外"],
  sme: ["中小企業", "小規模事業者", "白書", "補助金", "融資", "共済", "従業員", "開業率", "倒産", "支援", "認定", "年度"]
};

function compactSampleText(value, maximum = 190) {
  const text = String(value || "")
    .replace(/[#*_`]/g, "")
    .replace(/^\s*[-・]\s*/gmu, "")
    .replace(/^(?:まず|次に|続いて|最後に)[、,]\s*/u, "")
    .replace(/\s+/gu, " ")
    .trim();
  return text.length > maximum ? `${text.slice(0, maximum).trim()}…` : text;
}

function sampleExplanationSteps(sample) {
  let blocks = String(sample.explanation || "").split(/\n{2,}/u).map((block) => compactSampleText(block)).filter(Boolean);
  if (blocks.length < 3) {
    blocks = (String(sample.explanation || "").match(/[^。！？\n]+[。！？]?/gu) || []).map((block) => compactSampleText(block)).filter(Boolean);
  }
  const fallback = [
    "問題文から主体・数値・時点などの条件を拾います。",
    "科目固有のルールや計算式に当てはめます。",
    "各選択肢との差分を確認して答案へ落とし込みます。"
  ];
  return [0, 1, 2].map((index) => blocks[index] || fallback[index]);
}

function sampleConditionTokens(sample) {
  const text = `${sample.prompt || ""}\n${sample.originalExplanation || sample.explanation || ""}`;
  const tokens = [sample.topic];
  for (const match of text.matchAll(/[「【]([^」】]{2,28})[」】]/gu)) tokens.push(match[1]);
  for (const keyword of sampleKeywords[sample.subject] || []) if (text.includes(keyword)) tokens.push(keyword);
  for (const match of text.matchAll(/(?:19|20)\d{2}年度?|\d+(?:[,.]\d+)*(?:万円|千円|百万円|億円|人|社|年|か月|%|％|倍)/gu)) tokens.push(match[0]);
  return [...new Set(tokens.map((token) => compactSampleText(token, 30)).filter(Boolean))].slice(0, 9);
}

function financeSampleVisual(sample, tokens) {
  const text = `${sample.prompt || ""}\n${sample.originalExplanation || sample.explanation || ""}`;
  const formulaCandidates = (text.match(/[^。！？\n]{0,70}(?:＝|=|÷|×)[^。！？\n]{0,90}/gu) || [])
    .map((item) => compactSampleText(item, 140)).filter((item, index, values) => item && values.indexOf(item) === index).slice(0, 2);
  const destinations = [
    ["B/S", "貸借対照表", /資産|負債|純資産|貸借対照表/u],
    ["P/L", "損益計算書", /利益|収益|費用|売上|損益計算書/u],
    ["C/F", "資金の流れ", /キャッシュ|CF|現金|資金/u],
    ["COST", "原価の集計", /原価|仕掛品|材料|賃金/u]
  ].filter(([, , pattern]) => pattern.test(text));
  return `<div class="finance-visual">
    <div class="formula-stack">${formulaCandidates.length ? formulaCandidates.map((formula) => `<div><small>式・関係</small><strong>${escapeHtml(formula)}</strong></div>`).join("") : `<div><small>拾った条件</small><strong>${tokens.slice(1, 5).map(escapeHtml).join(" ／ ") || "会計ルールを確認"}</strong></div>`}</div>
    <span class="visual-arrow" aria-hidden="true">→</span>
    <div class="statement-destinations">${(destinations.length ? destinations : [["RULE", "会計上の分類"]]).map(([code, label]) => `<div><b>${code}</b><span>${label}</span></div>`).join("")}</div>
  </div>`;
}

function operationsSampleVisual(sample, tokens) {
  const route = [tokens.slice(1, 3).join("・") || "現場条件", sample.topic, tokens.find((token) => /QCD|品質|生産性|効率|在庫/u.test(token)) || "品質・コスト・納期", `選択肢 ${sample.answer}`];
  return `<div class="process-visual">${route.map((item, index) => `<div><small>${index + 1}</small><strong>${escapeHtml(item)}</strong></div>${index < route.length - 1 ? '<span aria-hidden="true">→</span>' : ""}`).join("")}</div>`;
}

function lawSampleVisual(sample, tokens) {
  const labels = ["主体", "原則", "要件・例外", "効果"];
  const values = [tokens.find((token) => /会社|株主|取締役|権利者|当事者/u.test(token)) || "誰に適用されるか", "どの手続・決議が原則か", "期間・対抗要件・例外は何か", `選択肢 ${sample.answer} と一致`];
  return `<div class="legal-visual">${labels.map((label, index) => `<div><small>${label}</small><strong>${escapeHtml(values[index])}</strong></div>`).join("")}</div>`;
}

function smeSampleVisual(sample, tokens) {
  const period = tokens.find((token) => /年度|年$|%|％/u.test(token)) || "基準時点を確認";
  const target = tokens.find((token) => /企業|事業者|従業員/u.test(token)) || "対象企業を確認";
  return `<div class="policy-visual"><div><span>TARGET</span><strong>${escapeHtml(target)}</strong><small>対象者・業種</small></div><div><span>WHEN / VALUE</span><strong>${escapeHtml(period)}</strong><small>年度・人数・金額</small></div><div><span>OUTCOME</span><strong>選択肢 ${escapeHtml(sample.answer)}</strong><small>支援内容・統計傾向</small></div></div>`;
}

function subjectSampleVisual(sample, tokens) {
  const config = sampleVisualConfig[sample.subject] || sampleVisualConfig.operations;
  const diagram = sample.subject === "finance" ? financeSampleVisual(sample, tokens)
    : sample.subject === "law" ? lawSampleVisual(sample, tokens)
      : sample.subject === "sme" ? smeSampleVisual(sample, tokens)
        : operationsSampleVisual(sample, tokens);
  return `<section class="sample-section subject-visual-card subject-${sample.subject}"><header><div><span class="eyebrow">${config.eyebrow}</span><h3>${config.title}</h3></div><span class="visual-kind">科目別ビュー</span></header>${diagram}<div class="visual-route-legend">${config.route.map((item, index) => `<span><b>${index + 1}</b>${item}</span>`).join("")}</div></section>`;
}

function originalExplanationMarkup(sample) {
  return `<details class="original-explanation"><summary><span><small>ORIGINAL</small>元教材の解説</span><em>クリックして表示</em></summary><div class="original-explanation-body">${richText(sample.originalExplanation || sample.explanation || "解説はありません。")}</div></details>`;
}

function guidedFeedbackExplanationMarkup(question = {}, result = {}) {
  const answer = Array.isArray(result.correctAnswer) ? result.correctAnswer.join("・") : String(result.correctAnswer ?? "—");
  const answerText = result.correctAnswerText || question.options?.find((option) => String(option.id) === answer)?.label || answer;
  const explanation = {
    ...question,
    subject: result.subject || question.subject,
    topic: result.topic || question.topic,
    answer,
    correctAnswerText: answerText,
    explanation: result.explanation || "解説はありません。",
    originalExplanation: result.originalExplanation || result.explanation || "解説はありません。"
  };
  const tokens = sampleConditionTokens(explanation);
  const steps = sampleExplanationSteps(explanation);
  return `<div class="guided-feedback-explanation">
    <section class="sample-section feedback-stage feedback-conditions"><div class="sample-section-label"><span>01</span><div><small>READ</small><strong>条件を整理する</strong></div></div><p class="feedback-stage-lead">${escapeHtml(steps[0])}</p><div class="condition-tokens" aria-label="注目する条件">${tokens.map((token) => `<span>${escapeHtml(token)}</span>`).join("")}</div></section>
    <section class="sample-section feedback-stage"><div class="sample-section-label"><span>02</span><div><small>THINK</small><strong>判断の順序</strong></div></div><div class="reasoning-steps">${steps.map((step, stepIndex) => `<div><span>STEP ${stepIndex + 1}</span><strong>${["条件を固定", "ルールを適用", "答案と照合"][stepIndex]}</strong><p>${escapeHtml(step)}</p></div>`).join("")}</div></section>
    ${subjectSampleVisual(explanation, tokens)}
    <section class="sample-section feedback-stage"><div class="sample-section-label"><span>03</span><div><small>ANSWER</small><strong>正答へ落とし込む</strong></div></div><div class="sample-answer-callout"><span>正答</span><strong>${escapeHtml(answer)}</strong><p>${escapeHtml(answerText)}</p></div></section>
    ${originalExplanationMarkup(explanation)}
  </div>`;
}

function collectAnswer() {
  return state.answers[session[currentIndex].id] || "";
}

async function gradeCurrent() {
  const question = session[currentIndex];
  if (feedbackCache.has(question.id)) return;
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
      foundationCheckpoint: fullResult.foundationCheckpoint || question.foundationCheckpoint || null,
      correct: fullResult.correct,
      answeredAt: new Date().toISOString()
    };
    const previous = state.attempts[question.id] || { count: 0, correct: 0 };
    state.attempts[question.id] = { count: previous.count + 1, correct: previous.correct + (fullResult.correct ? 1 : 0), lastAt: new Date().toISOString() };
    state.recent = [question.id, ...state.recent.filter((id) => id !== question.id)].slice(0, 100);
    recordSessionResult(state.results[question.id]);
    autoArchiveMasteredQuestion(question.id);
    recordActivity("answer", fullResult.correct);
    refreshAutoPlanCompletion();
    refreshFoundationCheckpoint(true);
    queueSave();
    renderQuestion();
  } catch { alert("採点できませんでした。接続を確認してください。"); }
}

function renderPlanCourse(course, plan, autoCompleted) {
  const unlocked = isCourseUnlocked(course.targetScore);
  const previous = course.targetScore === 70 ? 60 : 70;
  const groups = course.groups.map((group, groupIndex) => `<section><h3>${escapeHtml(group.title)}</h3>${group.items.map((item, itemIndex) => {
    const key = planItemKey(studySubject, course.targetScore, groupIndex, itemIndex);
    const status = autoItemStatus(studySubject, course.targetScore, item);
    return `<label class="plan-check auto-check depth-${Math.min(item.depth, 2)} ${status.passed ? "is-auto-complete" : ""}" title="${status.uniqueQuestions}/${status.requiredQuestions}問・${status.sessions}/${status.requiredSessions}セッション・正答率${status.rate}%・直近${status.recentRate}%"><input type="checkbox" disabled ${autoCompleted[key] ? "checked" : ""}><span>${escapeHtml(item.text)}<small>${status.mapped ? escapeHtml(status.topic || "対応論点") : "科目全体"}：${status.uniqueQuestions}/${status.requiredQuestions}問・${status.sessions}/${status.requiredSessions}回・${status.rate}%</small></span></label>`;
  }).join("") || '<p class="muted">この層に追加される項目はありません。</p>'}</section>`).join("");
  return `<details class="plan-course ${unlocked ? "" : "is-locked"}" ${unlocked && course.targetScore === Number(state.plan.targetScore) ? "open" : ""}><summary><span>${unlocked ? course.targetScore : "🔒"}</span><div><small>${unlocked ? "LAYER" : "LOCKED"}</small><strong>${escapeHtml(course.title)}</strong>${unlocked ? "" : `<em>${previous}点層の到達判定に合格すると開放</em>`}</div><i>${course.groups.reduce((sum, group) => sum + group.items.length, 0)}項目</i></summary><div class="plan-groups">${groups}</div></details>`;
}

function renderPlan() {
  pageTitle.textContent = "学習計画";
  const phase = currentPhase();
  const plan = content.studyPlans.subjects[studySubject];
  const completed = state.plan.completed || {};
  const autoCompleted = state.plan.autoCompleted || {};
  const totalItems = plan.courses.flatMap((course) => course.groups.flatMap((group) => group.items)).length;
  const completedCount = Object.keys(autoCompleted).filter((key) => key.startsWith(`${studySubject}:`) && autoCompleted[key]).length;
  app.innerHTML = `<section class="view-stack">
    <div class="section-heading"><div><span class="eyebrow">ROADMAP TO 80</span><h2>長期目標を、今日の行動へつなぐ</h2><p>試験日は未発表のため、2027年8月7日を仮置きしています。</p></div>${courseSelector()}</div>
    <div class="timeline">${content.learningPhases.map((item, index) => { const timing = phaseTiming(item); const progress = phaseMilestoneProgress(item); return `<article class="timeline-item ${item.id === phase.id ? "current" : ""} ${timing.status}"><span>${index + 1}</span><div><small>${item.start.replaceAll("-", ".")} — ${item.end.replaceAll("-", ".")}</small><strong>${escapeHtml(item.label)}</strong><p>${escapeHtml(item.goal)}</p><div class="timeline-progress"><i><b style="width:${timing.percent}%"></b></i><small>日程 ${timing.percent}%・達成 ${progress.done}/${progress.total}</small></div></div></article>`; }).join("")}</div>
    <div class="plan-overview-grid"><article class="panel phase-milestones"><div class="dashboard-card-head"><div><span class="eyebrow">CURRENT PHASE</span><h3>${escapeHtml(phase.label)}の達成項目</h3></div><strong>${phaseMilestoneProgress(phase).percent}<small>%</small></strong></div><div class="milestone-list">${(phase.milestones || []).map((item, index) => { const key = milestoneKey(phase.id, index); return `<label><input type="checkbox" data-milestone-check="${key}" ${completed[key] ? "checked" : ""}><span>${escapeHtml(item)}</span></label>`; }).join("")}</div></article>
      <article class="panel finance-plan"><div class="dashboard-card-head"><div><span class="eyebrow">BOOKKEEPING / CASE IV</span><h3>${escapeHtml(content.financeTrack.title)}</h3></div><strong>${financeMilestoneProgress().done}<small> / ${financeMilestoneProgress().total}</small></strong></div><div class="milestone-list finance-milestones">${content.financeTrack.milestones.map((item) => { const key = financeMilestoneKey(item.id); return `<label><input type="checkbox" data-finance-milestone="${key}" ${completed[key] ? "checked" : ""}><span><small>${formatMonthDay(item.date)}</small>${escapeHtml(item.label)}</span></label>`; }).join("")}</div></article></div>
    <div class="plan-tabs">${content.subjects.map((subject) => `<button class="${studySubject === subject.id ? "is-active" : ""}" data-plan-subject="${subject.id}">${escapeHtml(subject.shortLabel)}</button>`).join("")}<span>${completedCount} / ${totalItems} 完了</span></div>
    <div class="auto-rule panel"><strong>自動達成ルール</strong><p>60点：5問・2セッション・正答率85%以上 ／ 70点：7問・2セッション・正答率85%以上 ／ 80点：10問・3セッション・正答率90%以上。直近成績も同水準を要求します。</p></div>
    <div class="plan-courses">${plan.courses.map((course) => renderPlanCourse(course, plan, autoCompleted)).join("")}</div>
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
  mockStartedAt = Date.now();
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
    const elapsedMinutes = mockStartedAt ? Math.max(1, Math.min(content.officialExam.subjects[mockSubject].minutes, Math.round((Date.now() - mockStartedAt) / 60000))) : content.officialExam.subjects[mockSubject].minutes;
    state.sessions.push({
      id: newSessionId("official"),
      type: "official-mock",
      label: `令和8年度 ${subjectLabel(mockSubject)} 公式模試`,
      subject: mockSubject,
      course: 80,
      startedAt: new Date(mockStartedAt || Date.now()).toISOString(),
      finishedAt: new Date().toISOString(),
      lastActivityAt: new Date().toISOString(),
      questionCount: result.details.length,
      mockMinutes: elapsedMinutes,
      summary: { score: result.score, maxScore: result.maxScore, answered: result.details.filter((item) => item.submitted).length },
      results: []
    });
    markSessionDirty(state.sessions.at(-1).id);
    recordActivity("mock", elapsedMinutes);
    queueSave();
    renderMockSession(result);
    window.scrollTo({ top: 0, behavior: "smooth" });
  } catch { alert("模試を採点できませんでした。"); }
}

function topicPerformance() {
  const groups = new Map();
  for (const result of practiceRecords()) {
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
  app.innerHTML = `<section class="view-stack"><div class="section-heading"><div><span class="eyebrow">LEARNING LOG</span><h2>層別進捗とコース到達度</h2><p>問題は60点基礎層・70点追加層・80点追加層に分離し、到達度だけを下位層込みで判定します。</p></div><button class="secondary" data-view="history">すべての実施記録 →</button></div>
    <div class="section-subhead"><div><span class="eyebrow">FOUNDATION / 3 STEPS</span><h3>60点コースのチェックポイント</h3></div><p>全${Number(content.courseCounts[60].addedAtCourse).toLocaleString()}問は補強プール。解除判定は4科目を均等に確認します。</p></div>
    <div class="foundation-progress-grid">${content.foundationCheckpoints.map((checkpoint) => { const value = foundationCheckpointProgress(checkpoint.id); const unlocked = isFoundationCheckpointUnlocked(checkpoint.id); return `<article class="foundation-progress-card ${unlocked ? "" : "is-locked"}"><header><span>${unlocked ? `0${checkpoint.id}` : "🔒"}</span><div><small>${formatMonthDay(checkpoint.start)}〜${formatMonthDay(checkpoint.end)}</small><h3>${escapeHtml(checkpoint.label)}</h3></div></header><p>${escapeHtml(checkpoint.goal)}</p><strong>${value.answered}<small> / 判定${value.requiredQuestions}問</small></strong><i><b style="width:${clamp(value.answered / Math.max(1, value.requiredQuestions) * 100)}%"></b></i><footer>${value.passed ? "達成・次の区分を開放" : unlocked ? `正答${checkpoint.requiredRate}%・各科目${checkpoint.requiredQuestionsPerSubject}問` : "前の区分を達成すると開放"}</footer></article>`; }).join("")}</div>
    <div class="section-subhead"><div><span class="eyebrow">EXCLUSIVE LAYERS</span><h3>層別進捗</h3></div><p>各問題は1つの層だけに集計されます。</p></div>
    <div class="course-progress-grid">${[60, 70, 80].map((score) => { const value = tierProgress(score); const unlocked = isCourseUnlocked(score); const label = score === 60 ? "基礎層" : "追加層"; return `<article class="course-progress-card course-${score} ${unlocked ? "" : "is-locked"}"><div><span>${unlocked ? score : "🔒"}</span><small>${score}点${label}</small></div><strong>${value.answered.toLocaleString()}<small> / ${value.total.toLocaleString()}問</small></strong><p>進捗 ${value.progress}%・正答率 ${value.rate}%・直近 ${value.recentRate}%</p><i><b style="width:${value.progress}%"></b></i><footer>${score === 60 ? "補強プールの消化率・解除判定は上の3区分" : unlocked ? `科目ごとに${Math.ceil(value.criteria.questions / content.subjects.length)}問 / ${value.criteria.sessions}回 / 正答${value.criteria.rate}%` : `${score - 10}点層の合格後に開放`}</footer></article>`; }).join("")}</div>
    <div class="section-subhead"><div><span class="eyebrow">CUMULATIVE READINESS</span><h3>コース到達度</h3></div><p>下位層をすべて合格していることが条件です。</p></div>
    <div class="course-progress-grid readiness-grid">${[60, 70, 80].map((score) => { const value = courseReadiness(score); const unlocked = isCourseUnlocked(score); const status = value.passed ? "合格" : unlocked ? "判定中" : "ロック中"; return `<article class="course-progress-card course-${score} ${unlocked ? "" : "is-locked"}"><div><span>${score}</span><small>点到達</small></div><strong class="readiness-status">${status}</strong><p>累積 ${value.answered.toLocaleString()} / ${value.total.toLocaleString()}問・正答率 ${value.rate}%</p><i><b style="width:${value.progress}%"></b></i><footer>${value.passed ? "全必要層の判定に合格" : `未合格層：${value.failedLayers.join("・")}点`}</footer></article>`; }).join("")}</div>
    <div class="panel course-matrix"><div class="dashboard-card-head"><div><span class="eyebrow">LAYER × SUBJECT</span><h3>科目別の層別進捗</h3></div></div><div class="table-scroll"><table><thead><tr><th>科目</th>${[60,70,80].map((score) => `<th>${score}点${score === 60 ? "基礎" : "追加"}層</th>`).join("")}</tr></thead><tbody>${content.subjects.map((subject) => `<tr><th>${escapeHtml(subject.label)}</th>${[60,70,80].map((score) => { const value = tierProgress(score, subject.id); return `<td><strong>${value.answered}/${value.total}問</strong><small>進捗${value.progress}%・正答${value.rate}%<br>直近${value.recentRate}%</small></td>`; }).join("")}</tr>`).join("")}</tbody></table></div></div>
    <div class="subject-progress">${content.subjects.map((subject) => { const value = subjectStats(subject.id); return `<article><div><strong>${escapeHtml(subject.label)}</strong><span>${value.answered}問</span></div><b>${value.rate}<small>%</small></b><i><em style="width:${value.rate}%"></em><u></u></i></article>`; }).join("")}</div>
    <div class="two-column progress-columns"><div><div class="section-heading"><div><span class="eyebrow">WEAK TOPICS</span><h2>80%未満の論点</h2></div></div><div class="weak-list">${weak.map((item) => `<button data-weak-topic="${escapeHtml(item.topic)}" data-weak-subject="${item.subject}"><span><strong>${escapeHtml(item.topic)}</strong><small>${escapeHtml(subjectLabel(item.subject))}・${item.answered}問</small></span><b>${item.rate}%</b></button>`).join("") || '<div class="panel empty">採点すると弱点論点が表示されます。</div>'}</div></div>
      <div><div class="section-heading"><div><span class="eyebrow">OFFICIAL MOCK</span><h2>令和8年度 模試結果</h2></div></div><div class="mock-history">${content.subjects.map((subject) => { const result = state.mockResults[subject.id]; return `<article><span>${escapeHtml(subject.shortLabel)}</span><strong>${result ? result.score : "—"}<small>/100</small></strong><button data-start-mock="${subject.id}">${result ? "再挑戦" : "開始"}</button></article>`; }).join("")}</div></div></div>
  </section>`;
}

function archivedQuestionSummaries() {
  return Object.entries(state.archived)
    .filter(([id]) => isArchived(id))
    .map(([id, archive]) => ({
      id,
      ...(state.results[id] || {}),
      archivedAt: archive === true ? state.results[id]?.answeredAt : archive.archivedAt,
      archiveReason: archive === true ? "manual" : archive.reason,
      correctDayStreak: archive === true ? 0 : Number(archive.correctDayStreak) || 0
    }))
    .sort((a, b) => new Date(b.archivedAt || b.answeredAt || 0) - new Date(a.archivedAt || a.answeredAt || 0));
}

function renderArchive() {
  pageTitle.textContent = "アーカイブ";
  const archived = archivedQuestionSummaries();
  app.innerHTML = `<section class="view-stack"><div class="section-heading"><div><span class="eyebrow">ARCHIVE</span><h2>演習対象から外した問題</h2><p>異なる3日で連続正解した問題は自動で追加されます。戻すと通常演習・復習・自動割当の対象へ復帰します。</p></div><span class="archive-total">${archived.length}問</span></div>
    <div class="archive-subjects">${content.subjects.map((subject) => {
      const items = archived.filter((item) => item.subject === subject.id);
      return `<section class="archive-subject panel"><header><div><span class="eyebrow">${escapeHtml(subject.shortLabel)}</span><h3>${escapeHtml(subject.label)}</h3></div><strong>${items.length}<small>問</small></strong></header><div class="archive-list">${items.map((item) => `<article class="archive-row"><div><span>${item.archiveReason === "auto" ? `自動・${item.correctDayStreak}日連続正解` : "手動で追加"}</span><strong>${escapeHtml(item.topic || item.id)}</strong><small>${escapeHtml(item.id)}${item.archivedAt ? `・${escapeHtml(new Intl.DateTimeFormat("ja-JP", { dateStyle: "medium" }).format(new Date(item.archivedAt)))}に追加` : ""}</small></div><button class="secondary" data-unarchive="${escapeHtml(item.id)}">演習対象に戻す</button></article>`).join("") || '<div class="archive-empty">この科目のアーカイブはありません。</div>'}</div></section>`;
    }).join("")}</div>
  </section>`;
}

function sessionSummary(item) {
  if (item.summary) return { answered: Number(item.summary.answered) || item.questionCount || 0, correct: null, rate: Math.round(Number(item.summary.score) / Math.max(1, Number(item.summary.maxScore)) * 100), label: `${item.summary.score}/${item.summary.maxScore}点` };
  const results = item.results || [];
  const correct = results.filter((result) => result.correct).length;
  return { answered: results.length, correct, rate: results.length ? Math.round(correct / results.length * 100) : 0, label: `${correct}/${results.length}問正解` };
}

function sessionTierBreakdown(item) {
  const counts = { 60: 0, 70: 0, 80: 0 };
  for (const result of item.results || []) counts[Number(result.minimumCourse || 60)] += 1;
  return [60, 70, 80].filter((score) => counts[score]).map((score) => `${score}点層 ${counts[score]}問`).join(" / ");
}

function renderHistory() {
  pageTitle.textContent = "すべての実施記録";
  const sessions = [...state.sessions].sort((a, b) => new Date(b.lastActivityAt || b.finishedAt || b.startedAt) - new Date(a.lastActivityAt || a.finishedAt || a.startedAt));
  app.innerHTML = `<section class="view-stack"><div class="section-heading"><div><span class="eyebrow">ALL SESSIONS</span><h2>すべての実施記録</h2><p>通常演習、復習、公式模試を実施単位で保存しています。不要な記録だけを個別に削除できます。</p></div><span class="session-total">${sessions.length}セッション</span></div>
    <div class="session-list">${sessions.map((item) => { const summary = sessionSummary(item); const breakdown = sessionTierBreakdown(item); const date = new Intl.DateTimeFormat("ja-JP", { dateStyle: "medium", timeStyle: "short" }).format(new Date(item.lastActivityAt || item.finishedAt || item.startedAt)); return `<article class="session-row"><div class="session-kind ${item.type}">${item.type === "official-mock" ? "模試" : item.type === "legacy" ? "移行" : "演習"}</div><div class="session-main"><small>${escapeHtml(date)}・目標${item.course || 60}点</small><strong>${escapeHtml(item.label || "演習セッション")}</strong><span>${item.subject ? escapeHtml(subjectLabel(item.subject)) : "科目横断"}・${summary.answered}問${breakdown ? `・${breakdown}` : ""}${item.mockMinutes ? `・${item.mockMinutes}分` : ""}</span></div><div class="session-score"><strong>${summary.rate}%</strong><small>${escapeHtml(summary.label)}</small></div><button class="session-delete" data-delete-session="${escapeHtml(item.id)}" aria-label="このセッションを削除">削除</button></article>`; }).join("") || '<div class="panel empty">まだ実施記録がありません。問題演習を開始すると、ここへセッション単位で保存されます。</div>'}</div>
  </section>`;
}

function phaseChart(phase) {
  const workload = phaseWorkload(phase);
  const start = new Date(`${phase.start}T00:00:00`);
  const end = new Date(`${phase.end}T23:59:59`);
  const totalDays = Math.max(1, Math.ceil((end - start) / 86400000));
  const elapsed = clamp(Math.floor((Math.min(new Date(), end) - start) / 86400000) + 1, 0, totalDays);
  const totalPlan = Math.round(totalDays * phase.sessionSize * 6 / 7);
  const creditStart = new Date(`${phase.creditFrom || phase.start}T00:00:00`);
  const records = practiceRecords().filter((record) => { const date = new Date(record.answeredAt); return date >= creditStart && date <= end; });
  const maxY = Math.max(totalPlan, records.length, 1);
  const yTicks = [100, 75, 50, 25, 0].map((ratio) => Math.round(maxY * ratio / 100));
  const plot = { left: 5, right: 98, top: 5, bottom: 60 };
  const x = (day) => plot.left + day / totalDays * (plot.right - plot.left);
  const y = (count) => plot.bottom - count / maxY * (plot.bottom - plot.top);
  const points = [`${x(0)},${y(workload.prelearning)}`];
  for (let day = Math.min(7, elapsed); day <= elapsed && day > 0; day += 7) {
    const sampleDay = Math.min(day, elapsed);
    const boundary = new Date(start.getTime() + sampleDay * 86400000);
    const count = records.filter((record) => new Date(record.answeredAt) < boundary).length;
    points.push(`${x(sampleDay)},${y(count)}`);
    if (sampleDay === elapsed) break;
  }
  if (elapsed > 0 && elapsed % 7) {
    const boundary = new Date(start.getTime() + elapsed * 86400000);
    const count = records.filter((record) => new Date(record.answeredAt) < boundary).length;
    points.push(`${x(elapsed)},${y(count)}`);
  }
  const actualEnd = points.at(-1).split(",");
  const status = workload.paceStatus === "ahead" ? "予定より進んでいます" : workload.paceStatus === "behind" ? "予定より遅れています" : "予定どおりです";
  const midpoint = new Date(start.getTime() + (end - start) / 2);
  const gridLines = [0, 25, 50, 75, 100].map((ratio) => plot.top + ratio / 100 * (plot.bottom - plot.top));
  return `<article class="panel phase-chart"><div class="dashboard-card-head"><div><span class="eyebrow">PLAN / ACTUAL</span><h3>現在フェーズの予実</h3></div><strong class="pace-${workload.paceStatus}">${workload.variance >= 0 ? "+" : ""}${workload.variance}<small>問・${status}</small></strong></div><div class="phase-chart-frame"><div class="phase-chart-y" aria-hidden="true">${yTicks.map((tick) => `<span>${tick.toLocaleString()}</span>`).join("")}</div><svg viewBox="0 0 100 65" preserveAspectRatio="none" role="img" aria-label="横軸が期間、縦軸が累計演習量の予実グラフ">${gridLines.map((lineY) => `<line class="gridline" x1="${plot.left}" y1="${lineY}" x2="${plot.right}" y2="${lineY}"/>`).join("")}<polyline class="planned" points="${plot.left},${plot.bottom} ${plot.right},${y(totalPlan)}"/><polyline class="actual" points="${points.join(" ")}"/><circle class="actual-point" cx="${actualEnd[0]}" cy="${actualEnd[1]}" r="1.5"/></svg></div><div class="phase-chart-x"><span>${formatMonthDay(phase.start)}</span><span>${new Intl.DateTimeFormat("ja-JP", { month: "numeric", day: "numeric" }).format(midpoint)}</span><span>${formatMonthDay(phase.end)}</span></div><div class="chart-axis-title">累計演習量（問）</div><div class="chart-legend"><span><i class="planned"></i>予定 ${workload.expected}問</span><span><i class="actual"></i>実績 ${workload.actual}問</span><span>${formatMonthDay(phase.start)}〜${formatMonthDay(phase.end)}</span></div>${phase.creditFrom ? `<p>8/17〜8/23の${workload.prelearning}問は先取り学習として実績へ加算します。</p>` : ""}</article>`;
}

function renderOverview() {
  pageTitle.textContent = "全体確認";
  const phase = currentPhase();
  const workload = phaseWorkload(phase);
  const phaseIndex = content.learningPhases.indexOf(phase);
  app.innerHTML = `<section class="view-stack"><div class="section-heading"><div><span class="eyebrow">MASTER OVERVIEW</span><h2>試験までの全体像と現在地</h2><p>日程、達成項目、演習量、コース進捗、財務ルートを一画面で確認します。</p></div><div class="overview-position"><strong>${overallTiming()}%</strong><span>全期間の経過</span></div></div>
    <div class="overview-now"><article class="panel"><span class="phase-number">NOW / PHASE ${phaseIndex + 1}</span><h3>${escapeHtml(phase.label)}</h3><p>${escapeHtml(phase.goal)}</p><div class="overview-big-facts"><div><strong>${phaseTiming(phase).daysLeft}</strong><small>フェーズ残日数</small></div><div><strong>${phaseMilestoneProgress(phase).percent}%</strong><small>達成項目</small></div><div><strong>${workload.actual}</strong><small>期間内実施問数</small></div><div class="${workload.delayed ? "delay" : ""}"><strong>${workload.variance >= 0 ? `+${workload.variance}` : workload.variance}</strong><small>${workload.paceStatus === "ahead" ? "予定より進行" : workload.paceStatus === "behind" ? "予定より遅延" : "予定どおり"}</small></div></div></article><article class="panel load-adjust"><span class="eyebrow">AUTO LOAD</span><h3>本日の自動割当</h3><strong>${workload.adjustedTarget}<small>問</small></strong><p>基準${phase.sessionSize}問${workload.extra ? `に遅延補正${workload.extra}問を追加` : "。遅延補正はありません"}。</p><div class="allocation-list">${content.subjects.map((subject) => `<span>${escapeHtml(subject.shortLabel)} <b>${workload.allocation[subject.id]}問</b></span>`).join("")}</div><button class="primary" data-adaptive>自動割当で始める</button></article></div>
    ${phaseChart(phase)}
    <div class="overview-phases">${content.learningPhases.map((item, index) => { const timing = phaseTiming(item); const progress = phaseMilestoneProgress(item); const records = practiceRecords().filter((record) => { const date = new Date(record.answeredAt); return date >= new Date(`${item.start}T00:00:00`) && date <= new Date(`${item.end}T23:59:59`); }); return `<article class="overview-phase ${timing.status}"><header><span>PHASE ${index + 1}</span><small>${formatMonthDay(item.start)}〜${formatMonthDay(item.end)}</small></header><h3>${escapeHtml(item.label)}</h3><p>${escapeHtml(item.goal)}</p><div class="overview-phase-bars"><label>日程 <i><b style="width:${timing.percent}%"></b></i><span>${timing.percent}%</span></label><label>項目 <i><b style="width:${progress.percent}%"></b></i><span>${progress.percent}%</span></label></div><footer>${records.length}問実施・1日${item.sessionSize}問基準</footer></article>`; }).join("")}</div>
    <div class="dashboard-secondary"><article class="panel"><div class="dashboard-card-head"><div><span class="eyebrow">COURSE READINESS</span><h3>累積の到達判定</h3></div></div><div class="overview-courses">${[60,70,80].map((score) => { const value = courseReadiness(score); const unlocked = isCourseUnlocked(score); return `<div class="${unlocked ? "" : "is-locked"}"><span>${score}</span><i><b style="width:${value.progress}%"></b></i><strong>${value.passed ? "合格" : unlocked ? "判定中" : "🔒"}</strong><small>累積 ${value.answered}/${value.total}問${value.failedLayers.length ? `・未合格 ${value.failedLayers.join("・")}点層` : ""}</small></div>`; }).join("")}</div></article><article class="panel"><div class="dashboard-card-head"><div><span class="eyebrow">FINANCE ROUTE</span><h3>${escapeHtml(content.financeTrack.title)}</h3></div><strong>${financeMilestoneProgress().percent}<small>%</small></strong></div><div class="milestone-list finance-milestones">${content.financeTrack.milestones.map((item) => `<label><input type="checkbox" disabled ${state.plan.completed[financeMilestoneKey(item.id)] ? "checked" : ""}><span><small>${formatMonthDay(item.date)}</small>${escapeHtml(item.label)}</span></label>`).join("")}</div></article></div>
  </section>`;
}

async function startReview(mode) {
  const incorrect = Object.entries(state.results).filter(([id, result]) => !result.correct && !isArchived(id)).map(([id]) => id);
  const flagged = Object.entries(state.flags).filter(([id, value]) => value && !isArchived(id)).map(([id]) => id);
  let ids = mode === "incorrect" ? incorrect : mode === "flagged" ? flagged : [...new Set([...incorrect, ...flagged])];
  if (ids.length) return beginRemote({ ids: ids.slice(0, 50).join(","), limit: Math.min(50, ids.length) }, { type: "review", label: mode === "incorrect" ? "誤答復習" : mode === "flagged" ? "見直し復習" : "弱点優先復習" });
  const subject = recommendedSubject();
  return beginRemote({ subject: subject.id, limit: phaseWorkload().adjustedTarget }, { type: "adaptive", label: `${subject.label} 自動割当` });
}

async function beginDailyAllocation() {
  const workload = phaseWorkload();
  const todayKey = localDateKey();
  const todayRecords = practiceRecords().filter((record) => localDateKey(record.answeredAt) === todayKey);
  const requests = content.subjects.map((subject) => {
    const done = todayRecords.filter((record) => record.subject === subject.id).length;
    const remaining = Math.max(0, workload.allocation[subject.id] - done);
    return remaining ? fetchQuestions({ subject: subject.id, limit: Math.min(100, Math.max(remaining * 4, remaining)), seed: `${todayKey}:${subject.id}` }).then((result) => ({ questions: result.questions.filter((question) => !isArchived(question.id)).slice(0, remaining) })) : Promise.resolve({ questions: [] });
  });
  app.innerHTML = '<div class="panel loading">本日の遅延補正と科目配分からセッションを組み立てています…</div>';
  try {
    const results = await Promise.all(requests);
    const questions = results.flatMap((result) => result.questions);
    if (!questions.length) return startReview("adaptive");
    begin(questions, { type: "adaptive", label: `本日の自動割当 ${questions.length}問`, filters: { workload } });
  } catch {
    app.innerHTML = '<div class="panel empty">自動割当を作成できませんでした。接続を確認してください。</div>';
  }
}

document.addEventListener("click", (event) => {
  if (event.target.closest("[data-skip-main]")) {
    document.querySelector("#app")?.focus();
    return;
  }
  const unarchiveButton = event.target.closest("[data-unarchive]");
  if (unarchiveButton) {
    restoreArchivedQuestion(unarchiveButton.dataset.unarchive);
    queueSave();
    return renderArchive();
  }
  const eliminateButton = event.target.closest("[data-eliminate-choice]");
  if (eliminateButton && currentView === "session") {
    const question = session[currentIndex];
    const eliminated = eliminatedChoices.get(question.id) || new Set();
    const choiceId = eliminateButton.dataset.eliminateChoice;
    eliminated.has(choiceId) ? eliminated.delete(choiceId) : eliminated.add(choiceId);
    eliminatedChoices.set(question.id, eliminated);
    if (state.answers[question.id] === choiceId) delete state.answers[question.id];
    feedbackCache.delete(question.id);
    return renderQuestion();
  }
  const choice = event.target.closest("[data-select-choice]");
  if (choice && currentView === "session" && !choice.classList.contains("is-eliminated")) {
    feedbackCache.delete(session[currentIndex].id);
    state.answers[session[currentIndex].id] = choice.dataset.selectChoice;
    queueSave();
    return renderQuestion();
  }
  const calcKey = event.target.closest("[data-calc-action]");
  if (calcKey) return useCalculator(calcKey.dataset.calcAction, calcKey.dataset.calcValue);
  if (event.target.closest("[data-calc-minimize]")) { calculatorState.minimized = !calculatorState.minimized; return renderQuestion(); }
  const viewButton = event.target.closest("[data-view]");
  if (viewButton) return setView(viewButton.dataset.view);
  const courseButton = event.target.closest("[data-set-course]");
  if (courseButton) {
    const nextScore = Number(courseButton.dataset.setCourse);
    if (!isCourseUnlocked(nextScore)) return;
    state.plan.targetScore = nextScore;
    queueSave();
    return setView(currentView === "session" ? "practice" : currentView);
  }
  const foundationButton = event.target.closest("[data-set-foundation]");
  if (foundationButton) {
    const checkpointId = Number(foundationButton.dataset.setFoundation);
    if (!isFoundationCheckpointUnlocked(checkpointId)) return;
    state.plan.foundationCheckpoint = checkpointId;
    queueSave();
    return setView(currentView === "session" ? "practice" : currentView);
  }
  const subjectButton = event.target.closest("[data-start-subject]");
  if (subjectButton) return beginRemote({ subject: subjectButton.dataset.startSubject, limit: subjectButton.dataset.limit || currentPhase().sessionSize }, { label: `${subjectLabel(subjectButton.dataset.startSubject)} 演習` });
  if (event.target.closest("[data-adaptive]")) return beginDailyAllocation();
  if (event.target.closest("[data-start-filtered]")) {
    const filteredSubject = document.querySelector("#subjectFilter").value;
    return beginRemote({
      subject: filteredSubject,
      topic: document.querySelector("#topicFilter").value,
      difficulty: document.querySelector("#difficultyFilter").value,
      limit: document.querySelector("#limitFilter").value
    }, { label: filteredSubject ? `${subjectLabel(filteredSubject)} 条件演習` : "4科目 条件演習" });
  }
  const review = event.target.closest("[data-review]")?.dataset.review;
  if (review) return startReview(review);
  const jump = event.target.closest("[data-jump]");
  if (jump) { currentIndex = Number(jump.dataset.jump); return renderQuestion(); }
  if (event.target.closest("[data-prev]")) { currentIndex -= 1; return renderQuestion(); }
  if (event.target.closest("[data-next]")) { currentIndex += 1; return renderQuestion(); }
  if (event.target.closest("[data-grade]")) return gradeCurrent();
  if (event.target.closest("[data-archive]")) {
    const id = session[currentIndex].id;
    if (isArchived(id)) restoreArchivedQuestion(id);
    else archiveQuestion(id, "manual");
    queueSave();
    return renderQuestion();
  }
  if (event.target.closest("[data-flag]")) { const id = session[currentIndex].id; state.flags[id] = !state.flags[id]; queueSave(); return renderQuestion(); }
  const planSubjectButton = event.target.closest("[data-plan-subject]");
  if (planSubjectButton) { studySubject = planSubjectButton.dataset.planSubject; return renderPlan(); }
  const mockButton = event.target.closest("[data-start-mock]");
  if (mockButton) return startOfficialMock(mockButton.dataset.startMock);
  if (event.target.closest("[data-grade-mock]")) return gradeMock();
  const weakButton = event.target.closest("[data-weak-topic]");
  if (weakButton) {
    const topic = content.topics.find((item) => item.subject === weakButton.dataset.weakSubject && item.label === weakButton.dataset.weakTopic);
    return beginRemote({ subject: weakButton.dataset.weakSubject, topic: topic?.id || "", limit: 20 }, { type: "review", label: `${weakButton.dataset.weakTopic} 弱点補強` });
  }
  const deleteButton = event.target.closest("[data-delete-session]");
  if (deleteButton) {
    const target = state.sessions.find((item) => item.id === deleteButton.dataset.deleteSession);
    if (target && confirm(`「${target.label || "演習セッション"}」の実施記録を削除しますか？\nこのセッションに由来する正答率と自動チェックも再計算されます。`)) {
      removeSession(target.id);
      queueSave();
      renderHistory();
    }
  }
});

document.addEventListener("change", (event) => {
  if (event.target.matches("#subjectFilter")) {
    const topic = document.querySelector("#topicFilter");
    topic.innerHTML = `<option value="">すべて</option>${topicOptions(event.target.value)}`;
  }
  if (event.target.matches("[data-milestone-check], [data-finance-milestone]")) {
    const key = event.target.dataset.milestoneCheck || event.target.dataset.financeMilestone;
    state.plan.completed[key] = event.target.checked;
    recordActivity("plan", event.target.checked ? 1 : -1);
    queueSave();
    renderPlan();
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

document.addEventListener("keydown", (event) => {
  const choice = event.target.closest?.("[data-select-choice]");
  if (!choice || !["Enter", " "].includes(event.key) || choice.classList.contains("is-eliminated")) return;
  event.preventDefault();
  feedbackCache.delete(session[currentIndex].id);
  state.answers[session[currentIndex].id] = choice.dataset.selectChoice;
  queueSave();
  renderQuestion();
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
    const targetBeforeValidation = Number(state.plan.targetScore);
    refreshAutoPlanCompletion();
    if (!isCourseUnlocked(Number(state.plan.targetScore))) state.plan.targetScore = highestUnlockedCourse();
    if (Number(state.plan.targetScore) !== targetBeforeValidation) queueSave();
    else storeLocally();
    renderHome();
  } catch (error) {
    console.error(error);
    app.innerHTML = '<div class="panel empty">R4のデータを読み込めませんでした。生成済みデータとAPIを確認してください。</div>';
  }
}

boot();
