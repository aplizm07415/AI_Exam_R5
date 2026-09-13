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
let gradingQuestionId = null;
let remoteVersion = 0;
let studySubject = "finance";
let mockSubject = null;
let mockEndAt = null;
let mockStartedAt = null;
let mockTimer = null;
let activeMockId = null;
let mockGrading = false;
let state = freshState();
const feedbackCache = new Map();
const eliminatedChoices = new Map();
const dirtySessionRevisions = new Map();
const deletedSessionIds = new Set();
const knownDeletedSessionIds = new Set();
const pendingStateChanges = new Map();
let observedSnapshot = null;
let syncRevision = 0;
let databaseAvailabilityKnown = false;
let localSaveFailed = false;
let assessmentCache = null;
const pendingContentReviewIds = new Set();
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
    plan: { targetScore: 60, foundationCheckpoint: 1, completed: {}, autoCompleted: {}, schedule: { phases: {}, excludedDates: [] } },
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
    sessions: Array.isArray(value?.sessions) ? value.sessions.filter((item) => item && item.id) : [],
    activity: Object.fromEntries(Object.entries(value?.activity || {}).map(([date, item]) => [date, {
      answered: Math.max(0, Number(item?.answered) || 0),
      correct: Math.max(0, Number(item?.correct) || 0),
      mockMinutes: Math.max(0, Number(item?.mockMinutes) || 0),
      planChecks: Math.max(0, Number(item?.planChecks) || 0)
    }])),
    plan: {
      ...base.plan,
      ...(value?.plan || {}),
      completed: { ...(value?.plan?.completed || {}) },
      autoCompleted: { ...(value?.plan?.autoCompleted || {}) },
      schedule: normalizeSchedule(value?.plan?.schedule)
    }
  };
  delete merged._sync;
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

function capturePendingChanges() {
  const current = ProgressSync.snapshot(state);
  if (observedSnapshot) {
    for (const change of ProgressSync.changes(observedSnapshot, current)) {
      pendingStateChanges.delete(ProgressSync.changeKey(change));
      pendingStateChanges.set(ProgressSync.changeKey(change), { ...change, revision: ++syncRevision });
    }
  }
  observedSnapshot = current;
  for (const id of deletedSessionIds) knownDeletedSessionIds.add(id);
}

function restoreSyncQueue(local) {
  dirtySessionRevisions.clear();
  deletedSessionIds.clear();
  knownDeletedSessionIds.clear();
  pendingStateChanges.clear();
  const queue = local?._sync;
  syncRevision = Number(queue?.revision) || 0;
  remoteVersion = Number(queue?.remoteVersion) || 0;
  if (queue?.schemaVersion === 1) {
    for (const [id, revision] of queue.dirtySessions || []) dirtySessionRevisions.set(id, revision);
    for (const id of queue.deletedSessionIds || []) deletedSessionIds.add(id);
    for (const id of queue.knownDeletedSessionIds || []) knownDeletedSessionIds.add(id);
    for (const change of queue.changes || []) pendingStateChanges.set(ProgressSync.changeKey(change), change);
  } else if (local) {
    // Pre-queue installs have no edit baseline: preserve their populated values.
    for (const change of ProgressSync.changes(ProgressSync.snapshot(freshState()), ProgressSync.snapshot(state))) {
      pendingStateChanges.set(ProgressSync.changeKey(change), { ...change, revision: ++syncRevision });
    }
    for (const item of state.sessions) markSessionDirty(item.id);
  }
  state.sessions = ProgressSync.mergeSessions([], state.sessions, knownDeletedSessionIds);
  observedSnapshot = ProgressSync.snapshot(state);
}

function acceptRemoteProgress(saved) {
  databaseEnabled = Boolean(saved.configured);
  databaseAvailabilityKnown = true;
  if (!databaseEnabled) return;
  capturePendingChanges();
  remoteVersion = Math.max(0, Number(saved.version) || 0);
  for (const id of saved.deletedSessionIds || []) knownDeletedSessionIds.add(id);
  const remote = mergeState(saved.exists ? saved.state : null);
  const queuedSessions = state.sessions.filter((item) => dirtySessionRevisions.has(item.id));
  const merged = ProgressSync.applyChanges(remote, [...pendingStateChanges.values()]);
  merged.sessions = ProgressSync.mergeSessions(remote.sessions, queuedSessions, knownDeletedSessionIds);
  state = mergeState(merged);
  // A concurrently removed session must not be revived by its old draft.
  for (const id of knownDeletedSessionIds) dirtySessionRevisions.delete(id);
  if (activeSession) activeSession = state.sessions.find((item) => item.id === activeSession.id) || null;
  // The question text on screen can be older than a synced draft. Stop using
  // that text before any selection or navigation can replace the newer draft.
  if (currentView === "session" && hasNewerPracticeAttempt(activeSession, session)) activeSession = null;
  rebuildAggregatesFromSessions();
  observedSnapshot = ProgressSync.snapshot(state);
  if (currentView === "session" && !activeSession && !gradingQuestionId) { session = []; setView("practice"); }
  if (currentView === "mock-session" && !currentMock() && !mockGrading) setView("mock");
}

async function readRemoteProgress() {
  const response = await fetch("/api/progress", { cache: "no-store" });
  if (!response.ok) throw new Error("progress_read_failed");
  const saved = await response.json();
  acceptRemoteProgress(saved);
  return saved;
}

async function initializePersistence() {
  let local = null;
  try { local = JSON.parse(localStorage.getItem(storageKey()) || "null"); }
  catch { saveStatus.textContent = "端末の保存データを読み込めませんでした"; }
  state = mergeState(local);
  restoreSyncQueue(local);
  rebuildAggregatesFromSessions();
  observedSnapshot = ProgressSync.snapshot(state);
  try {
    await readRemoteProgress();
    if (storeLocally()) saveStatus.textContent = databaseEnabled ? "Neonへ自動保存" : "この端末に自動保存";
    if (databaseEnabled && (pendingStateChanges.size || dirtySessionRevisions.size || deletedSessionIds.size)) await persistNow();
  } catch {
    databaseAvailabilityKnown = false;
    if (storeLocally()) saveStatus.textContent = "端末へ保存済み・接続回復後に同期";
  }
}

function compactStateForRemote() {
  return { ...ProgressSync.snapshot(state), savedAt: state.savedAt };
}

function markSessionDirty(sessionId) {
  if (!sessionId || knownDeletedSessionIds.has(sessionId)) return;
  dirtySessionRevisions.set(sessionId, ++syncRevision);
  deletedSessionIds.delete(sessionId);
}

function storeLocally() {
  capturePendingChanges();
  try {
    localStorage.setItem(storageKey(), JSON.stringify({ ...state, _sync: {
      schemaVersion: 1,
      revision: syncRevision,
      remoteVersion,
      changes: [...pendingStateChanges.values()],
      dirtySessions: [...dirtySessionRevisions],
      deletedSessionIds: [...deletedSessionIds],
      knownDeletedSessionIds: [...knownDeletedSessionIds]
    } }));
    localSaveFailed = false;
    return true;
  } catch {
    localSaveFailed = true;
    saveStatus.textContent = "端末に保存できません。同期完了まで画面を閉じず、端末の空き容量を確認してください";
    return false;
  }
}

function dirtySessionBatch(maximumCount = 20, maximumCharacters = 200_000) {
  const batch = new Map();
  let characters = 0;
  const byId = new Map(state.sessions.map((item) => [item.id, item]));
  for (const [id, revision] of dirtySessionRevisions) {
    const sessionItem = byId.get(id);
    if (!sessionItem || knownDeletedSessionIds.has(id)) { dirtySessionRevisions.delete(id); continue; }
    const size = JSON.stringify(sessionItem).length;
    if (batch.size && (batch.size >= maximumCount || characters + size > maximumCharacters)) break;
    batch.set(id, revision);
    characters += size;
  }
  return batch;
}

function queueSave({ immediate = false } = {}) {
  state.savedAt = new Date().toISOString();
  if (storeLocally()) saveStatus.textContent = "保存中…";
  clearTimeout(saveTimer);
  if (immediate) return persistNow();
  saveTimer = setTimeout(persistNow, 450);
}

async function persistNow() {
  const storedLocally = storeLocally();
  if (saveInFlight) { savePending = true; return; }
  if (!databaseEnabled && databaseAvailabilityKnown) {
    if (storedLocally) saveStatus.textContent = "この端末に保存済み";
    return;
  }
  saveInFlight = true;
  let succeeded = false;
  try {
    if (!databaseAvailabilityKnown) await readRemoteProgress();
    if (!databaseEnabled) {
      if (!localSaveFailed) saveStatus.textContent = "この端末に保存済み";
      return;
    }
    for (let conflictCount = 0; conflictCount < 3; conflictCount += 1) {
      storeLocally();
      const sentSessions = dirtySessionBatch();
      const sentDeleted = [...deletedSessionIds].slice(0, 50);
      const sentChanges = new Map([...pendingStateChanges].map(([key, change]) => [key, change.revision]));
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
        await readRemoteProgress();
        storeLocally();
        continue;
      }
      if (!response.ok) throw new Error("save_failed");
      const saved = await response.json();
      if (!saved.configured) throw new Error("database_unavailable");
      remoteVersion = Math.max(remoteVersion, Number(saved.version) || 0);
      // Capture edits made during the request before acknowledging its revisions.
      capturePendingChanges();
      for (const [key, revision] of sentChanges) {
        if (pendingStateChanges.get(key)?.revision === revision) pendingStateChanges.delete(key);
      }
      for (const [id, revision] of sentSessions) {
        if (dirtySessionRevisions.get(id) === revision) dirtySessionRevisions.delete(id);
      }
      for (const id of sentDeleted) deletedSessionIds.delete(id);
      succeeded = true;
      if (storeLocally()) saveStatus.textContent = "Neonへ保存済み";
      else saveStatus.textContent = "Neonへ保存済み・端末保存容量を確認してください";
      break;
    }
    if (!succeeded && !localSaveFailed) saveStatus.textContent = "別端末と更新が重なっています。端末に保存済み・次の保存時に再同期";
  } catch {
    if (!localSaveFailed) saveStatus.textContent = "端末へ保存済み・接続回復後に同期";
  } finally {
    saveInFlight = false;
    const remaining = savePending || pendingStateChanges.size || dirtySessionRevisions.size || deletedSessionIds.size;
    savePending = false;
    if (succeeded && remaining) {
      clearTimeout(saveTimer);
      saveTimer = setTimeout(persistNow, 0);
    }
  }
}

window.addEventListener?.("online", () => {
  databaseAvailabilityKnown = false;
  void persistNow();
});
window.addEventListener?.("beforeunload", (event) => {
  pausePracticeAttempt();
  if (!storeLocally()) {
    event.preventDefault();
    event.returnValue = "";
  }
});
document.addEventListener("visibilitychange", () => {
  if (document.hidden) {
    pausePracticeAttempt();
    storeLocally();
  } else if (currentView === "session" && activeSession) {
    renderQuestion();
  }
});

function setView(view) {
  if (gradingQuestionId || mockGrading) return;
  if (currentView === "session" && activeSession) {
    pausePracticeAttempt();
    if (activeSession.status !== "completed") activeSession.status = "paused";
    markSessionDirty(activeSession.id);
    queueSave();
  }
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
  return [...new Map(assessmentRecords().map((record) => [record.questionId, record])).values()];
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

function validDateKey(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(value || ""))) return false;
  const date = new Date(`${value}T12:00:00`);
  return !Number.isNaN(date.getTime()) && localDateKey(date) === value;
}

function defaultSchedule() {
  return { phases: {}, excludedDates: [] };
}

function schedulePhasesFor(overrides = {}) {
  if (!content?.learningPhases) return [];
  return content.learningPhases.map((phase) => {
    const override = overrides[phase.id] || {};
    return {
      ...phase,
      start: validDateKey(override.start) ? override.start : phase.start,
      end: validDateKey(override.end) ? override.end : phase.end
    };
  });
}

function scheduleValidation(phases) {
  for (let index = 0; index < phases.length; index += 1) {
    const phase = phases[index];
    if (!validDateKey(phase.start) || !validDateKey(phase.end) || phase.start > phase.end) return "各フェーズの開始日は終了日以前にしてください。";
    if (index && phases[index - 1].end >= phase.start) return "フェーズの日程が重ならないようにしてください。";
  }
  if (phases.at(-1)?.end > content.exam.targetExamDate) return "最終フェーズの終了日は試験日以前にしてください。";
  return "";
}

function normalizeSchedule(value) {
  const candidate = value && typeof value === "object" && !Array.isArray(value) ? value : {};
  const allowedIds = new Set((content?.learningPhases || []).map((phase) => phase.id));
  const phases = Object.fromEntries(Object.entries(candidate.phases || {})
    .filter(([id, phase]) => allowedIds.has(id) && phase && typeof phase === "object")
    .map(([id, phase]) => [id, {
      ...(validDateKey(phase.start) ? { start: phase.start } : {}),
      ...(validDateKey(phase.end) ? { end: phase.end } : {})
    }]));
  const excludedDates = [...new Set((Array.isArray(candidate.excludedDates) ? candidate.excludedDates : []).filter(validDateKey))].sort();
  return scheduleValidation(schedulePhasesFor(phases)) ? defaultSchedule() : { phases, excludedDates };
}

function learningPhases() {
  return schedulePhasesFor(state.plan.schedule?.phases);
}

function excludedStudyDates() {
  return new Set(state.plan.schedule?.excludedDates || []);
}

function dateKeysBetween(startKey, endKey) {
  const keys = [];
  const date = new Date(`${startKey}T12:00:00`);
  const end = new Date(`${endKey}T12:00:00`);
  while (date <= end) {
    keys.push(localDateKey(date));
    date.setDate(date.getDate() + 1);
  }
  return keys;
}

function phaseCalendar(phase, through = phase.end) {
  const end = through < phase.start ? null : through > phase.end ? phase.end : through;
  if (!end) return [];
  const excluded = excludedStudyDates();
  return dateKeysBetween(phase.start, end).filter((key) => !excluded.has(key));
}

function isExcludedStudyDate(value = new Date()) {
  return excludedStudyDates().has(localDateKey(value));
}

function phaseCreditStart(phase) {
  return phase.creditFrom && phase.creditFrom < phase.start ? phase.creditFrom : phase.start;
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
  const todayKey = localDateKey(now);
  const total = Math.max(1, phaseCalendar(phase).length);
  const elapsed = now < start ? 0 : phaseCalendar(phase, todayKey).length;
  const percent = clamp(Math.round(elapsed / total * 100));
  const daysLeft = now > end ? 0 : phaseCalendar(phase).filter((key) => key > todayKey).length;
  const status = now < start ? "upcoming" : now > end ? "past" : "current";
  return { percent, daysLeft, status };
}

function overallTiming() {
  const phases = learningPhases();
  const startKey = phases[0].start;
  const endKey = content.exam.targetExamDate;
  const excluded = excludedStudyDates();
  const available = dateKeysBetween(startKey, endKey).filter((key) => !excluded.has(key));
  const todayKey = localDateKey();
  const elapsed = available.filter((key) => key <= todayKey).length;
  return clamp(Math.round(elapsed / Math.max(1, available.length) * 100));
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
  return state.sessions.filter((item) => item.type !== "official-mock").flatMap((item) => (item.results || []).map((result) => ({ ...result, sessionId: item.id, sessionStartedAt: item.startedAt })));
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
    lastActivityAt: new Date().toISOString(),
    questionCount: questions.length,
    questionIds: questions.map((question) => question.id),
    currentIndex: 0,
    status: "in-progress",
    attempts: {},
    filters: meta.filters || {},
    results: []
  };
  state.sessions.push(activeSession);
  markSessionDirty(activeSession.id);
}

function recordSessionResult(result, trackedSession = activeSession) {
  if (!activeSession) beginTrackedSession(session);
  trackedSession ||= activeSession;
  if (!state.sessions.some((item) => item.id === trackedSession.id)) state.sessions.push(trackedSession);
  const attemptId = result.attemptId || LearningCore.attemptId(trackedSession.id, result.questionId);
  if (trackedSession.results.some((item) => item.attemptId === attemptId)) return false;
  const record = {
    ...result,
    attemptId,
    questionId: result.questionId,
    subject: result.subject,
    topic: result.topic,
    topicId: result.topicId,
    minimumCourse: result.minimumCourse,
    foundationCheckpoint: result.foundationCheckpoint || null,
    difficulty: result.difficulty,
    correct: result.correct,
    answeredAt: result.answeredAt || new Date().toISOString()
  };
  trackedSession.results.push(record);
  trackedSession.lastActivityAt = record.answeredAt;
  markSessionDirty(trackedSession.id);
  return true;
}

function consecutiveCorrectDayCount(questionId) {
  const resetAt = state.archiveResets[questionId] ? new Date(state.archiveResets[questionId]) : null;
  const records = practiceRecords()
    .filter((record) => record.questionId === questionId && (!resetAt || new Date(record.answeredAt) > resetAt));
  let streak = 0;
  for (const record of LearningCore.firstDailyAssessments(records, questionId).reverse()) {
    if (!record.correct) break;
    streak += 1;
  }
  return streak;
}

function autoArchiveMasteredQuestion(questionId) {
  // 習得後も期限を持って復習する。旧版の自動除外だけを解除する。
  if (state.archived[questionId]?.reason === "auto") delete state.archived[questionId];
  return false;
}

function hasNewerPracticeAttempt(tracked, questions) {
  return questions.some((question) => Number(tracked?.attempts?.[question.id]?.contentVersion || 1) > Number(question.contentVersion || 1));
}

function currentAttempt(question = session[currentIndex]) {
  if (!question || !activeSession) return null;
  activeSession.attempts ||= {};
  if (activeSession.attempts[question.id] && Number(activeSession.attempts[question.id].contentVersion || 1) !== Number(question.contentVersion || 1)) {
    delete activeSession.attempts[question.id];
    delete state.answers[question.id];
  }
  if (!activeSession.attempts[question.id]) {
    const now = new Date().toISOString();
    activeSession.attempts[question.id] = {
      attemptId: `${LearningCore.attemptId(activeSession.id, question.id)}:v${question.contentVersion || 1}`,
      questionId: question.id,
      presentedAt: now,
      activeSince: now,
      elapsedMs: 0,
      selectedAnswer: "",
      eliminatedChoices: [],
      status: "answering",
      ...LearningCore.assessmentContext(practiceRecords(), question.id, now, question)
    };
    markSessionDirty(activeSession.id);
  }
  return activeSession.attempts[question.id];
}

function pausePracticeAttempt() {
  const attempt = activeSession?.attempts?.[session[currentIndex]?.id];
  if (!attempt || !attempt.activeSince) return;
  attempt.elapsedMs = LearningCore.elapsedMs(attempt, new Date().toISOString());
  attempt.activeSince = null;
  activeSession.currentIndex = currentIndex;
  activeSession.lastActivityAt = new Date().toISOString();
  markSessionDirty(activeSession.id);
}

function navigatePractice(index) {
  if (gradingQuestionId || !activeSession || !Number.isInteger(index) || index < 0 || index >= session.length) return;
  pausePracticeAttempt();
  currentIndex = index;
  activeSession.currentIndex = index;
  activeSession.lastActivityAt = new Date().toISOString();
  markSessionDirty(activeSession.id);
  renderQuestion();
  queueSave();
}

function selectCurrentAnswer(answer) {
  const attempt = currentAttempt();
  if (!attempt || attempt.status !== "answering" || gradingQuestionId) return;
  pausePracticeAttempt();
  attempt.selectedAnswer = answer;
  state.answers[attempt.questionId] = answer;
  activeSession.lastActivityAt = new Date().toISOString();
  markSessionDirty(activeSession.id);
  queueSave();
}

function strictCriteria(score) {
  if (score >= 80) return { questions: 10, sessions: 3, rate: 90, recentRate: 90 };
  if (score >= 70) return { questions: 7, sessions: 2, rate: 85, recentRate: 85 };
  return { questions: 5, sessions: 2, rate: 85, recentRate: 80 };
}

function assessmentRecords() {
  if (!assessmentCache || assessmentCache.sessions !== state.sessions || assessmentCache.revision !== syncRevision || assessmentCache.quality !== content.questionQuality) {
    assessmentCache = { sessions: state.sessions, revision: syncRevision, quality: content.questionQuality,
      records: Assessment.eligibleRecords(practiceRecords().filter((record) => !pendingContentReviewIds.has(record.questionId)), content.questionQuality) };
  }
  return assessmentCache.records;
}

function assessmentEvidence() {
  const evidence = { ...(state.plan.evidence || {}) };
  for (const entry of state.sessions) {
    if (entry.type !== "official-mock" || !entry.finishedAt || !entry.summary) continue;
    evidence[entry.id] = {
      kind: "assessment", subject: entry.subject,
      source: entry.assessmentSource || `公式 ${entry.examYear || 2026} ${entry.subject}`,
      firstSeen: entry.firstSeen === true, calculatorUsed: entry.calculatorUsed !== false,
      score: entry.summary.score, maxScore: entry.summary.maxScore,
      minutes: entry.mockMinutes, timeLimit: content.subjects.find((subject) => subject.id === entry.subject)?.examMinutes,
      completedAt: entry.finishedAt
    };
  }
  return evidence;
}

function autoItemStatus(subjectId, score, item, recordsIndex = Assessment.indexRecords(assessmentRecords())) {
  const criteria = strictCriteria(score);
  const status = Assessment.topicStatus(subjectId, score, item, content.topics, recordsIndex, criteria);
  const kind = item.evidenceType || "topic";
  if (kind === "topic") return status;
  status.mapped = false;
  status.passed = false;
  if (kind === "assessment") {
    const eligible = Assessment.independentAssessments(assessmentEvidence(), subjectId, 80);
    status.passed = eligible.length >= 2;
    status.reason = `初見・電卓なし・時間内80点以上：${eligible.length}/2セット（自己申告を含む）`;
  } else if (kind === "prerequisite") {
    const prerequisiteScore = Number(item.prerequisiteScore);
    const previous = prerequisiteScore < score && content.studyPlans.subjects[subjectId].courses.find((course) => course.targetScore === prerequisiteScore);
    const items = previous ? previous.groups.flatMap((group) => group.items) : [];
    status.passed = items.length > 0 && items.every((previousItem) => autoItemStatus(subjectId, prerequisiteScore, previousItem, recordsIndex).passed);
    status.reason = `${prerequisiteScore}点コースの各項目で確認`;
  } else {
    const entries = Object.values(state.plan.evidence || {}).filter((entry) => entry.kind === "activity" && entry.subject === subjectId && entry.itemText === item.text);
    const completed = entries.some((entry) => entry.source?.trim() && entry.completedAt && Number(entry.minutes) > 0 && entry.confirmedCompletion === true);
    status.passed = completed;
    status.reason = completed ? "実施記録あり（自己申告）" : "教材・実施日・学習時間の記録が必要";
  }
  return status;
}

function planItemKey(subjectId, score, groupIndex, itemIndex) {
  return `${subjectId}:${score}:${groupIndex}:${itemIndex}`;
}

function refreshAutoPlanCompletion() {
  const next = {};
  const recordsIndex = Assessment.indexRecords(assessmentRecords());
  for (const [subjectId, plan] of Object.entries(content.studyPlans.subjects)) {
    for (const course of plan.courses) {
      course.groups.forEach((group, groupIndex) => group.items.forEach((item, itemIndex) => {
        const key = planItemKey(subjectId, course.targetScore, groupIndex, itemIndex);
        next[key] = autoItemStatus(subjectId, course.targetScore, item, recordsIndex).passed;
      }));
    }
  }
  state.plan.autoCompleted = next;
}

function courseProgress(score, subjectId = null) {
  const results = assessmentRecords().filter((result) => (!subjectId || result.subject === subjectId) && Number(result.minimumCourse || 60) <= score);
  const total = subjectId ? Number(content.courseCounts[score].subjects[subjectId]) : Number(content.courseCounts[score].total);
  const answered = new Set(results.map((result) => result.questionId)).size;
  const records = assessmentRecords().filter((result) => (!subjectId || result.subject === subjectId) && Number(result.minimumCourse || 60) <= score);
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
  const results = assessmentRecords().filter(matches);
  const records = assessmentRecords().filter(matches);
  const total = subjectId
    ? Number(content.foundationCheckpointCounts[checkpointId]?.subjects?.[subjectId] || 0)
    : Number(content.foundationCheckpointCounts[checkpointId]?.total || 0);
  const answered = new Set(results.map((result) => result.questionId)).size;
  const sessions = new Set(records.map((record) => record.sessionId)).size;
  const rate = records.length ? Math.round(records.filter((record) => record.correct).length / records.length * 100) : 0;
  const recent = [...records].sort((left, right) => new Date(right.answeredAt) - new Date(left.answeredAt)).slice(0, 20);
  const recentRate = recent.length ? Math.round(recent.filter((record) => record.correct).length / recent.length * 100) : 0;
  const subjects = subjectId ? [] : content.subjects.map((subject) => foundationCheckpointProgress(checkpointId, subject.id));
  const requiredQuestions = subjectId
    ? Math.min(total, Number(checkpoint.requiredQuestionsPerSubject) || 15)
    : subjects.reduce((sum, value) => sum + value.requiredQuestions, 0);
  const requiredSessions = subjectId ? Number(checkpoint.requiredSessionsPerSubject) || 2 : 0;
  const ownPassed = total > 0 && answered >= requiredQuestions
    && (!subjectId || sessions >= requiredSessions)
    && rate >= Number(checkpoint.requiredRate)
    && recentRate >= Number(checkpoint.requiredRecentRate);
  const passed = Boolean(subjectId ? ownPassed : subjects.length && subjects.every((value) => value.passed));
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
  const results = assessmentRecords().filter(matches);
  const records = assessmentRecords().filter(matches);
  const total = subjectId ? Number(content.courseCounts[score].addedSubjects[subjectId]) : Number(content.courseCounts[score].addedAtCourse);
  const answered = new Set(results.map((result) => result.questionId)).size;
  const correct = records.filter((record) => record.correct).length;
  const rate = records.length ? Math.round(correct / records.length * 100) : 0;
  const sessions = new Set(records.map((record) => record.sessionId)).size;
  const recent = [...records].sort((a, b) => new Date(b.answeredAt) - new Date(a.answeredAt)).slice(0, 20);
  const recentRate = recent.length ? Math.round(recent.filter((record) => record.correct).length / recent.length * 100) : 0;
  const criteria = layerCriteria(score);
  const subjectLayers = subjectId ? [] : content.subjects.map((subject) => tierProgress(score, subject.id));
  const requiredQuestions = subjectId
    ? Math.min(total, Math.ceil(criteria.questions / content.subjects.length))
    : subjectLayers.reduce((sum, layer) => sum + layer.requiredQuestions, 0);
  const ownPassed = total > 0 && answered >= requiredQuestions && sessions >= criteria.sessions && rate >= criteria.rate && recentRate >= criteria.recentRate;
  // 全体の判定は科目別条件の達成を表す。科目ごとの対象数の差を追加ノルマにしない。
  const passed = Boolean(subjectId ? ownPassed : subjectLayers.length && subjectLayers.every((layer) => layer.passed));
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
  const todayKey = localDateKey(now);
  const elapsedDays = now < start ? 0 : phaseCalendar(phase, todayKey).length;
  const expected = Math.round(elapsedDays * phase.sessionSize * 6 / 7);
  const creditStartKey = phaseCreditStart(phase);
  const creditStart = new Date(`${creditStartKey}T00:00:00`);
  const actual = practiceRecords().filter((record) => {
    const date = new Date(record.answeredAt);
    return date >= creditStart && date <= end;
  }).length;
  const variance = actual - expected;
  const backlog = Math.max(0, -variance);
  const remainingDays = now > end ? 0 : phaseCalendar(phase).filter((key) => key > todayKey).length;
  const recoveryDays = Math.max(1, Math.round(remainingDays * 6 / 7));
  const extra = Math.min(Math.ceil(phase.sessionSize * .5), Math.ceil(backlog / recoveryDays));
  const excludedToday = isExcludedStudyDate(now) && todayKey >= phase.start && todayKey <= phase.end;
  const adjustedTarget = excludedToday ? 0 : phase.sessionSize + extra;
  const allocation = weightedAllocation(adjustedTarget, Object.fromEntries(content.subjects.map((subject) => [subject.id, subjectWeight(subject.id, phase)])));
  const paceStatus = variance > phase.sessionSize ? "ahead" : variance < -phase.sessionSize ? "behind" : "on-track";
  const prelearning = creditStartKey < phase.start ? practiceRecords().filter((record) => { const date = new Date(record.answeredAt); return date >= creditStart && date < start; }).length : 0;
  return { expected, actual, variance, backlog, extra: excludedToday ? 0 : extra, adjustedTarget, allocation, delayed: paceStatus === "behind", paceStatus, prelearning, creditStartKey, excludedToday, elapsedDays, remainingDays };
}

function rebuildAggregatesFromSessions() {
  const results = {};
  const attempts = {};
  for (const [id, entry] of Object.entries(state.archived)) if (entry?.reason === "auto") delete state.archived[id];
  const activity = Object.fromEntries(Object.entries(state.activity || {}).map(([date, value]) => [date, { answered: 0, correct: 0, mockMinutes: 0, planChecks: value.planChecks || 0 }]));
  const activityDay = (date) => (activity[localDateKey(date)] ||= { answered: 0, correct: 0, mockMinutes: 0, planChecks: 0 });
  const recentRecords = [...practiceRecords()].sort((a, b) => new Date(a.answeredAt) - new Date(b.answeredAt));
  for (const record of recentRecords) {
    const day = activityDay(record.answeredAt);
    day.answered += 1;
    day.correct += record.correct ? 1 : 0;
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
  for (const item of [...state.sessions].filter((value) => value.type === "official-mock" && value.summary).sort((a, b) => new Date(a.finishedAt || a.startedAt) - new Date(b.finishedAt || b.startedAt))) {
    mockResults[item.subject] = { ...(item.mockResult || {}), score: item.summary.score || 0, maxScore: item.summary.maxScore || 100, finishedAt: item.finishedAt || item.startedAt };
    activityDay(item.finishedAt || item.startedAt).mockMinutes += Number(item.mockMinutes) || 0;
  }
  state.activity = activity;
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
  const phases = learningPhases();
  return phases.find((phase) => today >= new Date(`${phase.start}T00:00:00`) && today <= new Date(`${phase.end}T23:59:59`))
    || phases.find((phase) => today < new Date(`${phase.start}T00:00:00`))
    || phases.at(-1);
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
  const phaseIndex = learningPhases().findIndex((item) => item.id === phase.id);
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
  const weekMaximum = Math.max(1, dailyTarget, ...week.map((item) => item.total));
  const financeProgress = financeMilestoneProgress();
  const nextFinance = content.financeTrack?.milestones.find((item) => !state.plan.completed[financeMilestoneKey(item.id)]);
  const financeDays = Math.max(0, Math.ceil((new Date(`${content.financeTrack.targetDate}T00:00:00`) - new Date()) / 86400000));
  app.innerHTML = `<section class="view-stack">
    <div class="hero dashboard-hero">
      <div class="hero-copy"><span class="eyebrow">${escapeHtml(content.exam.shortName)}</span><h2>${escapeHtml(content.exam.fullName)}</h2><p>${escapeHtml(content.exam.description)}</p>
        <div class="hero-actions">${workload.excludedToday ? '<button class="primary warm" data-view="overview">除外日設定を確認する</button>' : '<button class="primary warm" data-adaptive>今日のおすすめを始める</button>'}<button class="ghost" data-view="plan">学習計画を見る</button></div>
      </div>
      <div class="hero-metrics"><div class="target-dial"><small>本試験まで</small><strong>${daysUntilTarget()}</strong><span>days</span><i>目標 各80点</i></div><div class="today-badge ${remaining ? "" : "complete"}"><small>TODAY</small><strong>${workload.excludedToday ? "学習除外日" : remaining ? `あと${remaining}問` : "今日分完了"}</strong><span>${today.answered}問実施${today.mockMinutes ? `・模試${today.mockMinutes}分` : ""}</span></div></div>
    </div>
    <div class="dashboard-lead">
      <article class="panel daily-mission"><div class="dashboard-card-head"><div><span class="eyebrow">TODAY'S MISSION</span><h3>${workload.excludedToday ? "今日は学習除外日です" : remaining ? `あと${remaining}問で今日の目安` : "今日の目安を達成しました"}</h3></div>${workload.excludedToday ? "<b>OFF</b>" : `<b>${effectiveDone}<small> / ${dailyTarget}問</small></b>`}</div><p>${workload.excludedToday ? "今日の予定量と遅延補正は進みません。任意の学習実績はそのまま加算されます。" : `推奨科目は <strong>${escapeHtml(recommendation.label)}</strong>。${today.answered ? `今日の正答率は${todayRate}%です。` : "まず1セッション始めましょう。"}`}</p><div class="mission-meter"><i style="width:${clamp(effectiveDone / Math.max(1, dailyTarget) * 100)}%"></i></div><div class="mission-facts"><span>基準 ${phase.sessionSize}問${workload.extra ? ` + 遅延補正 ${workload.extra}問` : ""}</span><span>未消化 ${workload.backlog}問</span><span>連続 ${studyStreak()}日</span><span>見直し ${Object.values(state.flags).filter(Boolean).length}問</span></div>${workload.excludedToday ? '<button class="secondary" data-view="overview">スケジュール設定を開く</button>' : `<button class="primary" data-start-subject="${recommendation.id}" data-limit="${Math.min(remaining || dailyTarget, dailyTarget)}">${escapeHtml(recommendation.shortLabel)}を${Math.min(remaining || dailyTarget, dailyTarget)}問始める</button>`}</article>
      <article class="panel phase-focus"><div class="phase-ring" style="--progress:${timing.percent * 3.6}deg"><div><strong>${timing.percent}%</strong><small>日程消化</small></div></div><div class="phase-focus-copy"><span class="phase-number">PHASE ${phaseIndex + 1}</span><h3>${escapeHtml(phase.label)}</h3><p>${escapeHtml(phase.goal)}</p><div class="phase-facts"><span>残り${timing.daysLeft}日</span><span>達成項目 ${milestoneProgress.done}/${milestoneProgress.total}</span><span>全期間 ${overallTiming()}%</span></div>${courseSelector()}${foundationCheckpointSelector()}</div></article>
    </div>
    <div class="roadmap-dashboard">${learningPhases().map((item, index) => { const itemTiming = phaseTiming(item); const itemProgress = phaseMilestoneProgress(item); return `<article class="roadmap-step ${itemTiming.status}"><div><span>0${index + 1}</span><small>${formatMonthDay(item.start)}〜${formatMonthDay(item.end)}</small></div><strong>${escapeHtml(item.label)}</strong><i><b style="width:${itemTiming.percent}%"></b></i><p>日程 ${itemTiming.percent}%・項目 ${itemProgress.done}/${itemProgress.total}</p></article>`; }).join("")}</div>
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
  const pending = state.sessions.filter((item) => item.type !== "official-mock" && item.questionIds?.length && item.status !== "completed");
  app.innerHTML = `<section class="view-stack">
    <div class="section-heading"><div><span class="eyebrow">QUESTION LAB</span><h2>演習セッションを組む</h2><p>${content.totals.questions.toLocaleString()}問を、科目・論点・難易度・目標点で絞り込みます。</p></div><div class="library-stage-selectors">${courseSelector()}${foundationCheckpointSelector()}</div></div>
    ${content.questionQuality?.quarantinedQuestionIds?.length ? `<p class="muted">必要な図表を確認中の${content.questionQuality.quarantinedQuestionIds.length}問は出題を停止しています。訂正前の不成立問題の成績は、理解度判定から除きます。</p>` : ""}
    ${pending.length ? `<div class="panel"><h3>中断した演習</h3>${pending.slice(-5).reverse().map((item) => `<button class="secondary" data-resume-session="${escapeHtml(item.id)}">${escapeHtml(item.label)}（${item.results.length}/${item.questionCount}問）を再開</button>`).join("")}</div>` : ""}
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
      <button class="quick-card" data-review="adaptive"><span>ADAPTIVE</span><strong>弱点優先</strong><small>復習期限 → 誤答 → 見直し → 未着手</small></button>
      <button class="quick-card" data-view="archive"><span>ARCHIVE</span><strong>除外問題を管理</strong><small>${archiveCount()}問</small></button>
    </div>
    <div class="panel legend"><strong>段階開放のルール</strong><p><b>60点</b>：core論点中心　<b>70点</b>：standardまで拡張　<b>80点</b>：発展・新傾向を含む全範囲</p></div>
  </section>`;
}

async function refreshContentCatalogue() {
  const response = await fetch("/api/content", { cache: "no-store" });
  if (!response.ok) throw new Error("content_refresh_failed");
  const latest = await response.json();
  if (latest.exam?.id !== content.exam.id || !latest.questionQuality?.questions
      || !latest.courseCounts || !latest.foundationCheckpointCounts || !Array.isArray(latest.topics)) {
    throw new Error("content_refresh_failed");
  }
  // Quality rules and pool sizes/classifications describe the same revision.
  // Replacing the whole catalogue also invalidates the cached assessment records.
  content = latest;
  pendingContentReviewIds.clear();
  rebuildAggregatesFromSessions();
}

async function fetchQuestions(params = {}) {
  // Retry a failed catalogue refresh before resuming or starting more practice.
  if (pendingContentReviewIds.size) await refreshContentCatalogue();
  const queryParams = { ...params, course: state.plan.targetScore, tier: "exact", seed: params.seed || `${Date.now()}` };
  if (Number(state.plan.targetScore) === 60 && !params.ids) queryParams.checkpoint = state.plan.foundationCheckpoint;
  const query = new URLSearchParams(queryParams);
  const response = await fetch(`/api/questions?${query}`);
  if (!response.ok) throw new Error("questions_failed");
  return response.json();
}

async function beginRemote(params, meta = {}) {
  if (gradingQuestionId) return;
  app.innerHTML = '<div class="panel loading">演習セッションを組み立てています…</div>';
  try {
    const desired = Math.max(1, Math.min(100, Number(params.limit) || 20));
    const available = await availableQuestions(params, desired);
    begin(available, { ...meta, filters: params });
  } catch {
    app.innerHTML = '<div class="panel empty">問題を読み込めませんでした。接続を確認してください。</div>';
  }
}

function begin(questions, meta = {}) {
  if (gradingQuestionId) return;
  if (!questions.length) { alert("条件に合う問題がありません。"); return; }
  pausePracticeAttempt();
  if (activeSession?.status === "in-progress") activeSession.status = "paused";
  session = [...questions];
  feedbackCache.clear();
  eliminatedChoices.clear();
  beginTrackedSession(session, meta);
  currentIndex = 0;
  state.startedAt ||= new Date().toISOString();
  renderQuestion();
  queueSave();
}

async function availableQuestions(params, desired, excludedIds = new Set()) {
  if (desired <= 0) return [];
  const available = [];
  const seed = params.seed || `${Date.now()}`;
  for (let offset = 0; offset < 5000; offset += 100) {
    const result = await fetchQuestions({ ...params, seed, offset, limit: 100 });
    available.push(...result.questions.filter((question) => !isArchived(question.id) && !excludedIds.has(question.id)));
    if (available.length >= desired || params.ids || offset + result.questions.length >= result.total || !result.questions.length) break;
  }
  return available.slice(0, desired);
}

async function resumePracticeSession(sessionId) {
  if (gradingQuestionId) return;
  let saved = state.sessions.find((item) => item.id === sessionId && item.type !== "official-mock" && item.status !== "completed");
  if (!saved?.questionIds?.length) return;
  try {
    const requestedIds = saved.questionIds.join(",");
    const result = await fetchQuestions({ ids: requestedIds, limit: 100 });
    saved = state.sessions.find((item) => item.id === sessionId && item.type !== "official-mock" && item.status !== "completed");
    if (!saved || knownDeletedSessionIds.has(sessionId)) {
      alert("この演習は削除または完了しています。演習一覧を確認してください。");
      return setView("practice");
    }
    if (saved.questionIds?.join(",") !== requestedIds) {
      alert("中断した演習の問題が更新されました。演習一覧からもう一度再開してください。");
      return setView("practice");
    }
    const byId = new Map(result.questions.map((question) => [question.id, question]));
    const questions = saved.questionIds.map((id) => byId.get(id)).filter((question) => question && !isArchived(question.id));
    if (hasNewerPracticeAttempt(saved, questions)) {
      activeSession = null;
      session = [];
      alert("中断した演習の問題が更新されました。演習一覧からもう一度再開してください。");
      return setView("practice");
    }
    if (!questions.length) { saved.status = "completed"; markSessionDirty(saved.id); queueSave(); return setView("practice"); }
    pausePracticeAttempt();
    for (const attempt of Object.values(saved.attempts || {})) {
      // A saved clock stops at the last known activity, never at reload time.
      if (attempt.activeSince) attempt.elapsedMs = LearningCore.elapsedMs(attempt, saved.lastActivityAt || attempt.activeSince);
      attempt.activeSince = null;
      const record = saved.results.find((item) => item.attemptId === attempt.attemptId);
      attempt.status = record ? "graded" : "answering";
      if (record) attempt.selectedAnswer = record.submittedAnswer ?? attempt.selectedAnswer;
    }
    session = questions;
    activeSession = saved;
    saved.status = "in-progress";
    const isUnanswered = (question) => !saved.results.some((record) => record.questionId === question.id && Number(record.contentVersion || 1) === Number(question.contentVersion || 1));
    const resumeIndex = questions.findIndex((question) => question.id === saved.questionIds[saved.currentIndex || 0]);
    const unanswered = questions.findIndex(isUnanswered);
    currentIndex = resumeIndex >= 0 && isUnanswered(questions[resumeIndex]) ? resumeIndex : unanswered >= 0 ? unanswered : Math.max(0, resumeIndex);
    saved.questionIds = questions.map((question) => question.id);
    saved.questionCount = questions.length;
    saved.currentIndex = currentIndex;
    feedbackCache.clear();
    renderQuestion();
    markSessionDirty(saved.id);
    queueSave();
  } catch { alert("中断した演習を読み込めませんでした。接続を確認してください。"); }
}

function subjectLabel(id) {
  return content.subjects.find((subject) => subject.id === id)?.label || id;
}

function answerMarkup(question, feedback) {
  const attempt = currentAttempt(question);
  const saved = attempt?.selectedAnswer;
  const selected = new Set(Array.isArray(saved) ? saved : [saved]);
  const eliminated = new Set(attempt?.eliminatedChoices || []);
  const correctAnswers = new Set(Array.isArray(feedback?.correctAnswer) ? feedback.correctAnswer.map(String) : [feedback?.correctAnswer].filter((value) => value !== undefined).map(String));
  const isGrading = Boolean(gradingQuestionId);
  const locked = isGrading || attempt?.status === "graded";
  return `<div class="choices ${isGrading ? "is-grading" : ""}" role="radiogroup" aria-label="回答の選択肢" aria-busy="${isGrading}">${question.options.map((option) => {
    const isSelected = selected.has(option.id);
    const resultClass = feedback ? (correctAnswers.has(String(option.id)) ? "is-correct" : isSelected ? "is-incorrect" : "") : "";
    return `<div role="radio" tabindex="${eliminated.has(option.id) || locked ? -1 : 0}" aria-checked="${isSelected}" aria-disabled="${eliminated.has(option.id) || locked}" class="choice ${isSelected ? "is-selected" : ""} ${eliminated.has(option.id) ? "is-eliminated" : ""} ${resultClass}" data-select-choice="${escapeHtml(option.id)}"><button type="button" role="checkbox" class="eliminate-toggle" data-eliminate-choice="${escapeHtml(option.id)}" aria-checked="${eliminated.has(option.id)}" aria-label="選択肢${escapeHtml(option.id)}を除外" ${locked ? "disabled" : ""}>×</button><span class="choice-key">${escapeHtml(option.id)}</span><span class="choice-text">${richText(option.label)}</span></div>`;
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
  const attempt = currentView === "session" ? currentAttempt() : null;
  if (attempt?.status === "answering" && !attempt.calculatorUsed) {
    attempt.calculatorUsed = true;
    attempt.assessmentEligible = false;
    attempt.assessmentReason = "calculator_used";
    markSessionDirty(activeSession.id);
    queueSave();
  }
  calculatorState = CalculatorCore.reduceCalculator(calculatorState, action, value);
  renderQuestion();
}

function nextSessionActionMarkup(className = "secondary") {
  return currentIndex === session.length - 1
    ? `<button class="${className} finish-session" data-finish-session ${gradingQuestionId ? "disabled" : ""}>演習を完了してトップへ</button>`
    : `<button class="${className}" data-next ${gradingQuestionId ? "disabled" : ""}>次へ →</button>`;
}

function renderQuestion() {
  if (!activeSession) { session = []; return setView("practice"); }
  clearInterval(mockTimer);
  currentView = "session";
  pageTitle.textContent = "演習中";
  document.querySelectorAll(".nav-item").forEach((button) => button.classList.toggle("is-active", button.dataset.view === "practice"));
  const question = session[currentIndex];
  if (!question) return;
  const attempt = currentAttempt(question);
  if (attempt.status === "answering" && !attempt.activeSince && !document.hidden) attempt.activeSince = new Date().toISOString();
  const stored = activeSession.results.find((record) => record.attemptId === attempt.attemptId);
  const feedback = feedbackCache.get(attempt.attemptId);
  if (feedback && stored && Date.parse(stored.explanationViewedAt || "") !== Date.now()) {
    stored.explanationViewedAt = new Date().toISOString();
    activeSession.lastActivityAt = stored.explanationViewedAt;
    markSessionDirty(activeSession.id);
    queueSave();
  }
  const isGrading = Boolean(gradingQuestionId);
  app.innerHTML = `<section class="practice-layout"><div>
    <div class="session-progress"><span>${currentIndex + 1} / ${session.length}</span><i><b style="width:${((currentIndex + 1) / session.length) * 100}%"></b></i><small>${escapeHtml(question.difficulty)}・${question.minimumCourse === 60 ? `60点 ${escapeHtml(content.foundationCheckpoints.find((item) => item.id === question.foundationCheckpoint)?.shortLabel || "基礎")}` : `${question.minimumCourse}点追加層`}</small><button class="danger quit-session" data-quit-session ${isGrading ? "disabled" : ""}>一旦やめる</button></div>
    <article class="question-card"><div class="question-meta"><span>${escapeHtml(subjectLabel(question.subject))}</span><span>${escapeHtml(question.topic)}</span><span>${escapeHtml(question.sourceId)}</span>${question.calculationRequired ? "<span>計算</span>" : ""}</div><h2>Q${currentIndex + 1}. ${escapeHtml(question.topic)}</h2><div class="prompt">${richText(question.prompt)}</div><div class="answer-area">${answerMarkup(question, feedback)}</div>
      <div id="feedback" aria-live="polite">${feedback ? feedbackMarkup(feedback, question) : stored ? storedFeedbackMarkup(stored) : ""}${stored?.assessmentEligible === false ? `<p class="muted">${stored.calculatorUsed ? "電卓を使った回答" : "解説確認から24時間未満の再回答など"}は練習として記録し、理解度の達成判定には加えません。</p>` : ""}</div>
      <label class="note-wrap"><span>自分用メモ</span><textarea class="note-input" id="questionNote" placeholder="間違えた理由、覚え方、再確認日など">${escapeHtml(state.notes[question.id] || "")}</textarea></label>
    </article>
    <div class="actions"><button class="secondary" data-prev ${currentIndex === 0 || isGrading ? "disabled" : ""}>← 前へ</button><button class="secondary" data-flag>${state.flags[question.id] ? "★ 見直し中" : "☆ 見直す"}</button>${feedback ? `<button class="secondary archive-action" data-archive>${isArchived(question.id) ? "アーカイブを解除" : "アーカイブにする"}</button>` : ""}<button class="primary" data-grade ${feedback || isGrading ? "disabled" : ""} aria-busy="${isGrading}">${feedback ? "採点済み" : isGrading ? "採点・保存中…" : stored ? "解説を再表示" : "採点・解説"}</button>${nextSessionActionMarkup()}</div>
  </div><aside class="panel navigator"><h3>問題一覧・${escapeHtml(subjectLabel(question.subject))}</h3><div class="question-map">${session.map((item, index) => `<button class="map-button ${index === currentIndex ? "current" : ""} ${activeSession.results.some((record) => record.questionId === item.id) ? "done" : ""} ${state.flags[item.id] ? "flagged" : ""}" data-jump="${index}" ${isGrading ? "disabled" : ""}>${index + 1}</button>`).join("")}</div><button class="text-button" data-view="progress">学習記録を見る →</button></aside>${question.calculationRequired ? calculatorMarkup() : ""}</section>`;
}

function feedbackMarkup(result, question = session[currentIndex]) {
  const questionId = question.id;
  const resultBanner = result.correct ? "<strong>正解</strong>" : "<strong>不正解</strong><p>正答との差を、条件と判断順序から確認します。</p>";
  return `<div class="feedback visual-feedback ${result.correct ? "correct" : "incorrect"}"><div class="feedback-result-banner">${resultBanner}</div><div class="feedback-quick-actions"><button class="secondary archive-action" data-archive>${isArchived(questionId) ? "アーカイブを解除" : "アーカイブにする"}</button>${nextSessionActionMarkup()}</div>${guidedFeedbackExplanationMarkup(question, result)}</div>`;
}

function storedFeedbackMarkup(result) {
  return `<div class="feedback ${result.correct ? "correct" : "incorrect"}"><strong>この試行：${result.correct ? "正解" : "不正解"}</strong><p>「解説を再表示」で確認できます。採点記録は追加されません。</p></div>`;
}

function sampleExplanationSteps(sample) {
  return String(sample.explanation || "").split(/\n{2,}/u)
    .map((block) => block.replace(/^(?:まず|次に|続いて|最後に)[、,]\s*/u, "").trim())
    .filter(Boolean);
}

function originalExplanationMarkup(sample) {
  return `<details class="original-explanation"><summary><span>解説全文</span></summary><div class="original-explanation-body">${richText(sample.originalExplanation || sample.explanation || "解説はありません。")}</div></details>`;
}

function guidedFeedbackExplanationMarkup(question = {}, result = {}) {
  const explanation = result.explanation || "解説はありません。";
  const steps = sampleExplanationSteps({ explanation });
  const reference = question.sourceReference;
  return `<div class="guided-feedback-explanation">
    <section class="sample-section feedback-stage"><div class="sample-section-label"><strong>判断の根拠</strong></div><div class="reasoning-steps">${steps.map((step, index) => `<div><span>${index + 1}</span><div class="reasoning-body">${richText(step)}</div></div>`).join("")}</div></section>
    ${reference?.url?.startsWith("https://") ? `<p class="explanation-reference">出典：${inlineMarkdown(`[${reference.title || "根拠資料"}](${reference.url})`)}</p>` : ""}
    ${originalExplanationMarkup({ explanation, originalExplanation: result.originalExplanation || explanation })}
  </div>`;
}

function collectAnswer() {
  return currentAttempt()?.selectedAnswer || "";
}

function removeUnavailableQuestion(trackedId, questionId) {
  const tracked = state.sessions.find((item) => item.id === trackedId);
  if (!tracked || knownDeletedSessionIds.has(trackedId)) return;
  const oldAttempt = tracked.attempts?.[questionId];
  if (oldAttempt) feedbackCache.delete(oldAttempt.attemptId);
  delete tracked.attempts?.[questionId];
  delete state.answers[questionId];
  tracked.questionIds = (tracked.questionIds || []).filter((id) => id !== questionId);
  tracked.questionCount = tracked.questionIds.length;
  tracked.currentIndex = Math.min(tracked.currentIndex || 0, Math.max(0, tracked.questionCount - 1));
  tracked.status = tracked.questionCount ? "paused" : "completed";
  tracked.lastActivityAt = new Date().toISOString();
  markSessionDirty(tracked.id);
  if (activeSession?.id === trackedId) {
    activeSession = null;
    session = [];
    currentIndex = 0;
  }
}

async function gradeCurrent() {
  const question = session[currentIndex];
  if (!question || !activeSession || gradingQuestionId) return;
  let tracked = activeSession;
  let attempt = currentAttempt(question);
  const trackedId = tracked.id;
  const submittedAttemptId = attempt.attemptId;
  if (feedbackCache.has(attempt.attemptId)) return;
  const answer = attempt.selectedAnswer;
  if (!answer) { alert("選択肢を選んでください。"); return; }
  let alreadyGraded = tracked.results.some((record) => record.attemptId === attempt.attemptId);
  let contentChangeStatus = null;
  let refreshingContent = false;
  gradingQuestionId = question.id;
  attempt.status = alreadyGraded ? "graded" : "grading";
  pausePracticeAttempt();
  renderQuestion();
  try {
    const response = await fetch("/api/grade", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ questionId: question.id, answer, contentVersion: question.contentVersion || 1 }) });
    const fullResult = response.ok ? await response.json() : null;
    if (response.status === 404 || response.status === 409) {
      contentChangeStatus = response.status;
      // Do not keep using known-stale grades while the quality review is loading,
      // including when a connection failure delays the authoritative catalogue.
      pendingContentReviewIds.add(question.id);
      assessmentCache = null;
      rebuildAggregatesFromSessions();
      refreshingContent = true;
      await refreshContentCatalogue();
      refreshingContent = false;
    }
    // A save may have merged remote progress during grading or catalogue loading.
    // Always write into the live session; a removed session stays removed.
    tracked = state.sessions.find((item) => item.id === trackedId);
    if (!tracked || knownDeletedSessionIds.has(trackedId)) {
      if (activeSession?.id === trackedId) activeSession = null;
      alert("この演習は別の操作で削除されました。演習一覧に戻ります。");
      return;
    }
    attempt = tracked.attempts?.[question.id];
    if (!attempt || attempt.attemptId !== submittedAttemptId || (contentChangeStatus && tracked.status === "completed")) {
      if (activeSession?.id === trackedId) activeSession = null;
      alert("この演習は別の操作で更新されました。演習一覧から再開してください。");
      return;
    }
    alreadyGraded = tracked.results.some((record) => record.attemptId === submittedAttemptId);
    if (response.status === 404) {
      removeUnavailableQuestion(trackedId, question.id);
      await queueSave({ immediate: true });
      alert("この問題は確認中のため出題を停止しました。残りの演習は一覧から再開できます。");
      return;
    }
    if (response.status === 409) {
      const fresh = await fetchQuestions({ ids: question.id, limit: 1 });
      // Fetching the revised question is another synchronization boundary.
      tracked = state.sessions.find((item) => item.id === trackedId);
      if (!tracked || knownDeletedSessionIds.has(trackedId)) {
        if (activeSession?.id === trackedId) activeSession = null;
        alert("この演習は別の操作で削除されました。演習一覧に戻ります。");
        return;
      }
      attempt = tracked.attempts?.[question.id];
      if (!attempt || attempt.attemptId !== submittedAttemptId || tracked.status === "completed") {
        // A newer draft or completed attempt belongs to the synced state.
        // Leave it intact rather than rendering the old question over it.
        if (activeSession?.id === trackedId) activeSession = null;
        alert("この演習は別の操作で更新されました。演習一覧から再開してください。");
        return;
      }
      const updatedQuestion = fresh.questions.find((item) => item.id === question.id);
      if (!updatedQuestion) {
        removeUnavailableQuestion(trackedId, question.id);
        await queueSave({ immediate: true });
        alert("この問題は確認中のため出題を停止しました。残りの演習は一覧から再開できます。");
        return;
      }
      if (activeSession?.id !== trackedId) return;
      activeSession = tracked;
      const index = session.findIndex((item) => item.id === question.id);
      if (index >= 0) session[index] = updatedQuestion;
      feedbackCache.delete(submittedAttemptId);
      delete tracked.attempts[question.id];
      delete state.answers[question.id];
      // Persist a fresh versioned draft before a save can merge old drafts.
      attempt = currentAttempt(updatedQuestion);
      tracked.lastActivityAt = new Date().toISOString();
      markSessionDirty(tracked.id);
      await queueSave({ immediate: true });
      alert("問題が更新されました。新しい内容を確認して回答してください。");
      return;
    }
    if (!response.ok) throw new Error("grade_failed");
    const recorded = tracked.results.find((item) => item.attemptId === attempt.attemptId);
    if (recorded) {
      attempt.selectedAnswer = recorded.submittedAnswer ?? attempt.selectedAnswer;
      fullResult.correct = recorded.correct;
    }
    feedbackCache.set(attempt.attemptId, fullResult);
    attempt.status = "graded";
    const answeredAt = new Date().toISOString();
    if (!alreadyGraded) {
      const atSubmission = LearningCore.assessmentContext(practiceRecords(), question.id, answeredAt, question);
      const record = {
        questionId: question.id,
        attemptId: attempt.attemptId,
        subject: fullResult.subject,
        topic: fullResult.topic,
        topicId: fullResult.topicId,
        difficulty: fullResult.difficulty,
        minimumCourse: fullResult.minimumCourse,
        foundationCheckpoint: fullResult.foundationCheckpoint || question.foundationCheckpoint || null,
        correct: fullResult.correct,
        submittedAnswer: answer,
        correctAnswer: fullResult.correctAnswer,
        contentVersion: fullResult.contentVersion || question.contentVersion || 1,
        calculatorUsed: Boolean(attempt.calculatorUsed),
        exposure: attempt.exposure,
        assessmentEligible: attempt.assessmentEligible && atSubmission.assessmentEligible && fullResult.qualityStatus !== "quarantined",
        assessmentReason: atSubmission.assessmentEligible ? attempt.assessmentReason : atSubmission.assessmentReason,
        elapsedMs: attempt.elapsedMs,
        presentedAt: attempt.presentedAt,
        answeredAt,
        explanationViewedAt: answeredAt
      };
      recordSessionResult(record, tracked);
      rebuildAggregatesFromSessions();
      refreshFoundationCheckpoint(true);
      markSessionDirty(tracked.id);
      await queueSave({ immediate: true });
    } else {
      const record = tracked.results.find((item) => item.attemptId === attempt.attemptId);
      record.explanationViewedAt = answeredAt;
      tracked.lastActivityAt = answeredAt;
      markSessionDirty(tracked.id);
      await queueSave({ immediate: true });
    }
  } catch (error) {
    const live = state.sessions.find((item) => item.id === trackedId);
    const liveAttempt = live?.attempts?.[question.id];
    if (!alreadyGraded && liveAttempt?.attemptId === submittedAttemptId && liveAttempt.status === "grading") liveAttempt.status = "answering";
    if (refreshingContent) {
      if (live && live.status !== "completed" && liveAttempt?.attemptId === submittedAttemptId && !knownDeletedSessionIds.has(trackedId)) {
        if (contentChangeStatus === 404) removeUnavailableQuestion(trackedId, question.id);
        else {
          live.status = "paused";
          markSessionDirty(trackedId);
        }
      }
      if (activeSession?.id === trackedId) activeSession = null;
      await queueSave({ immediate: true });
      alert("教材の更新情報を取得できませんでした。この問題の成績判定を保留しています。接続を確認し、演習一覧から再開してください。");
    } else {
      alert(error.message === "question_unavailable" ? "この問題は確認中のため出題を停止しました。演習一覧から再開してください。" : "採点できませんでした。接続を確認してください。");
    }
  } finally {
    gradingQuestionId = null;
    if (currentView === "session" && activeSession?.id === trackedId) {
      const live = state.sessions.find((item) => item.id === trackedId);
      const displayed = session[currentIndex];
      const liveAttempt = live?.attempts?.[displayed?.id];
      // Saving can deliver another version. Rendering an older question would
      // replace that newer draft through currentAttempt's version check.
      activeSession = !live || knownDeletedSessionIds.has(trackedId)
        || (liveAttempt && Number(liveAttempt.contentVersion || 1) !== Number(displayed?.contentVersion || 1))
        ? null : live;
    }
    if (currentView === "session" && !activeSession) { session = []; setView("practice"); }
    else if (currentView === "session" && activeSession?.id === trackedId && session[currentIndex]?.id === question.id) renderQuestion();
  }
}

function renderPlanCourse(course, plan, autoCompleted) {
  const unlocked = isCourseUnlocked(course.targetScore);
  const previous = course.targetScore === 70 ? 60 : 70;
  const recordsIndex = Assessment.indexRecords(assessmentRecords());
  const groups = course.groups.map((group, groupIndex) => `<section><h3>${escapeHtml(group.title)}</h3>${group.items.map((item, itemIndex) => {
    const key = planItemKey(studySubject, course.targetScore, groupIndex, itemIndex);
    const status = autoItemStatus(studySubject, course.targetScore, item, recordsIndex);
    const detail = status.reason || `${status.topic || "対応論点"}：${status.uniqueQuestions}/${status.requiredQuestions}問・${status.sessions}/${status.requiredSessions}回・${status.rate}%`;
    return `<label class="plan-check auto-check depth-${Math.min(item.depth, 2)} ${status.passed ? "is-auto-complete" : ""}"><input type="checkbox" disabled ${autoCompleted[key] ? "checked" : ""}><span>${escapeHtml(item.text)}<small>${escapeHtml(detail)}</small></span></label>`;
  }).join("") || '<p class="muted">この層に追加される項目はありません。</p>'}</section>`).join("");
  return `<details class="plan-course ${unlocked ? "" : "is-locked"}" ${unlocked && course.targetScore === Number(state.plan.targetScore) ? "open" : ""}><summary><span>${unlocked ? course.targetScore : "🔒"}</span><div><small>${unlocked ? "LAYER" : "LOCKED"}</small><strong>${escapeHtml(course.title)}</strong>${unlocked ? "" : `<em>${previous}点層の到達判定に合格すると開放</em>`}</div><i>${course.groups.reduce((sum, group) => sum + group.items.length, 0)}項目</i></summary><div class="plan-groups">${groups}</div></details>`;
}

function studyEvidenceMarkup() {
  const evidence = Object.entries(state.plan.evidence || {}).sort(([, left], [, right]) => new Date(right.completedAt) - new Date(left.completedAt));
  const subject = content.subjects.find((item) => item.id === studySubject);
  const activities = content.studyPlans.subjects[studySubject].courses.flatMap((course) => course.groups.flatMap((group) => group.items)).filter((item) => item.evidenceType === "external");
  const independent = Assessment.independentAssessments(assessmentEvidence(), studySubject);
  const recentMinutes = evidence.filter(([, item]) => new Date(item.completedAt) >= new Date(Date.now() - 7 * 86400000)).reduce((sum, [, item]) => sum + item.minutes, 0);
  return `<section class="panel study-evidence"><h3>教材の実施・本試験形式の得点を記録</h3><p>${escapeHtml(subject.label)}：初見・電卓なし・時間内80点以上 ${independent.length}/2セット。直近7日間の外部教材 ${recentMinutes}分。</p><p class="muted">教材名には年度・回を含めてください。同じセットの再得点は初見判定に使いません。記録は自己申告として保存します。</p>
    <form data-evidence-form class="study-form"><label>記録の種類<select name="kind"><option value="activity">教材・学習項目の実施</option><option value="assessment">一次の本試験形式（100点満点）</option></select></label><label>教材名・年度・回<input name="source" required maxlength="300" placeholder="例：R5再試験、簿記第3章、事例Ⅰ第1問"></label><label>実施日<input type="date" name="date" value="${localDateKey()}" max="${localDateKey()}" required></label><label>学習時間（分）<input type="number" name="minutes" min="1" max="1440" required></label><label>得点（模試のみ、100点満点）<input type="number" name="score" min="0" max="100"></label><label>対応する学習項目（任意）<select name="itemText"><option value="">実施量だけを記録</option>${activities.map((item) => `<option value="${escapeHtml(item.text)}">${escapeHtml(item.text)}</option>`).join("")}</select></label><label class="check-line"><input type="checkbox" name="confirmedCompletion">選んだ学習項目の条件をすべて満たした</label><label class="check-line"><input type="checkbox" name="firstSeen">模試の問題はすべて初見だった</label><label class="check-line"><input type="checkbox" name="calculatorUsed">電卓を使用した</label><label>振り返り・誤答原因<textarea name="note" maxlength="1000" rows="2"></textarea></label><button type="submit">実施記録を保存</button></form>
    <div class="evidence-history">${evidence.filter(([, item]) => item.subject === studySubject).slice(0, 20).map(([id, item]) => `<article><div><strong>${escapeHtml(item.source)}</strong><p>${escapeHtml(String(item.completedAt).slice(0, 10))}・${item.minutes}分${item.kind === "assessment" ? `・${item.score}/100点・${item.firstSeen ? "初見" : "既見"}・${item.calculatorUsed ? "電卓あり" : "電卓なし"}` : "・学習実施"}</p><small>${escapeHtml(item.note)}</small></div><button class="secondary" type="button" data-delete-evidence="${escapeHtml(id)}">削除</button></article>`).join("") || '<p class="muted">この科目の実施記録はまだありません。</p>'}</div></section>`;
}

function studyProfileMarkup() {
  const profile = state.plan.studyProfile || {};
  const otherSubjects = { economics: "経済学・経済政策", management: "企業経営理論", information: "経営情報システム" };
  const year = Number(content.exam.targetYear);
  return `<details class="panel"><summary>受験条件・週の学習時間</summary><p>収録4科目を中心にした計画です。残り3科目の免除期間・申請を対象年度の試験案内で確認してください。</p><form data-study-profile class="study-form"><label>週の学習時間（時間、未確定なら空欄）<input name="weeklyHours" type="number" min="0.5" max="168" step="0.5" value="${profile.weeklyMinutes ? profile.weeklyMinutes / 60 : ""}"></label>${Object.entries(otherSubjects).map(([id, label]) => `<label>${label}<select name="${id}">${[["", "未確認"], ["none", "免除なし"], [String(year - 1), `${year - 1}年度科目合格`], [String(year - 2), `${year - 2}年度科目合格`], [String(year - 3), `${year - 3}年度以前の科目合格`], ["qualification", "他資格による免除を確認する"]].map(([value, text]) => `<option value="${value}" ${profile.exemptions?.[id] === value ? "selected" : ""}>${text}</option>`).join("")}</select><small>${escapeHtml(StudyEvidence.exemptionStatus(profile.exemptions?.[id], year))}</small></label>`).join("")}<button type="submit">受験条件を保存</button></form><p class="muted">一次の合格基準は受験科目の総点60%以上、各科目40%未満なし。各80点は学習目標です。免除は申請が必要で、最終的な条件は対象年度の公式案内に従います。</p></details>`;
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
    <div class="timeline">${learningPhases().map((item, index) => { const timing = phaseTiming(item); const progress = phaseMilestoneProgress(item); return `<article class="timeline-item ${item.id === phase.id ? "current" : ""} ${timing.status}"><span>${index + 1}</span><div><small>${item.start.replaceAll("-", ".")} — ${item.end.replaceAll("-", ".")}</small><strong>${escapeHtml(item.label)}</strong><p>${escapeHtml(item.goal)}</p><div class="timeline-progress"><i><b style="width:${timing.percent}%"></b></i><small>日程 ${timing.percent}%・達成 ${progress.done}/${progress.total}</small></div></div></article>`; }).join("")}</div>
    <div class="plan-overview-grid"><article class="panel phase-milestones"><div class="dashboard-card-head"><div><span class="eyebrow">CURRENT PHASE</span><h3>${escapeHtml(phase.label)}の達成項目</h3></div><strong>${phaseMilestoneProgress(phase).percent}<small>%</small></strong></div><div class="milestone-list">${(phase.milestones || []).map((item, index) => { const key = milestoneKey(phase.id, index); return `<label><input type="checkbox" data-milestone-check="${key}" ${completed[key] ? "checked" : ""}><span>${escapeHtml(item)}</span></label>`; }).join("")}</div></article>
      <article class="panel finance-plan"><div class="dashboard-card-head"><div><span class="eyebrow">BOOKKEEPING / CASE IV</span><h3>${escapeHtml(content.financeTrack.title)}</h3></div><strong>${financeMilestoneProgress().done}<small> / ${financeMilestoneProgress().total}</small></strong></div><div class="milestone-list finance-milestones">${content.financeTrack.milestones.map((item) => { const key = financeMilestoneKey(item.id); return `<label><input type="checkbox" data-finance-milestone="${key}" ${completed[key] ? "checked" : ""}><span><small>${formatMonthDay(item.date)}</small>${escapeHtml(item.label)}</span></label>`; }).join("")}</div></article></div>
    <div class="plan-tabs">${content.subjects.map((subject) => `<button class="${studySubject === subject.id ? "is-active" : ""}" data-plan-subject="${subject.id}">${escapeHtml(subject.shortLabel)}</button>`).join("")}<span>${completedCount} / ${totalItems} 完了</span></div>
    <div class="auto-rule panel"><strong>自動達成ルール</strong><p>60点：5問・2セッション・正答率85%以上 ／ 70点：7問・2セッション・正答率85%以上 ／ 80点：10問・3セッション・正答率90%以上。解説直後の再回答・不成立の旧版は評価から除きます。対応のない論点は未判定、外部教材・模試は実施記録で確認します。</p></div>
    ${studyProfileMarkup()}
    ${studyEvidenceMarkup()}
    <div class="plan-courses">${plan.courses.map((course) => renderPlanCourse(course, plan, autoCompleted)).join("")}</div>
  </section>`;
}

function renderMockLibrary() {
  pageTitle.textContent = "公式模試";
  const official = content.officialExam;
  app.innerHTML = `<section class="view-stack">
    <div class="section-heading"><div><span class="eyebrow">OFFICIAL MOCK / ${official.eraYear}</span><h2>令和8年度 第1次試験</h2><p>公式問題PDFを別タブで開き、R4のマークシートで回答・採点します。</p></div><a class="secondary link-button" href="https://www.jf-cmca.jp/contents/010_c_/shikenmondai.html" target="_blank" rel="noopener">公式 問題一覧</a></div>
    <div class="notice"><strong>実戦ルール</strong><p>一次試験では電卓を使用できません。時間終了まで答え合わせをせず、本試験と同じ順序で解いてください。時間終了後は答案を固定します。</p></div>
    <div class="mock-grid">${content.subjects.map((subject, index) => {
      const exam = official.subjects[subject.id];
      const last = state.mockResults[subject.id];
      const trends = content.officialAnalysis.subjects[subject.id]?.topTopics || [];
      return `<article class="mock-card tone-${index + 1}"><div class="mock-title"><span>${exam.code}</span><div><small>${official.eraYear}</small><h3>${escapeHtml(subject.label)}</h3></div></div><div class="mock-facts"><span>${exam.minutes}分</span><span>${exam.totalPoints}点</span><span>${exam.answerSlots.length}解答欄</span></div><div class="trend-list">${trends.slice(0, 3).map((item) => `<span>${escapeHtml(item.topic)} <b>${item.count}</b></span>`).join("")}</div>${last ? `<p class="last-score">前回 <strong>${last.score}</strong>点</p>` : ""}<label class="check-line"><input type="checkbox" id="mock-first-seen-${subject.id}">この年度・科目の問題は初見</label><button class="primary" data-start-mock="${subject.id}">${state.sessions.some((entry) => entry.type === "official-mock" && entry.subject === subject.id && !entry.finishedAt) ? "中断した模試を再開" : "問題PDFを開いて開始"}</button></article>`;
    }).join("")}</div>
  </section>`;
}

function currentMock() {
  return state.sessions.find((item) => item.id === activeMockId && item.type === "official-mock");
}

function startOfficialMock(subjectId) {
  if (gradingQuestionId || mockGrading) return;
  pausePracticeAttempt();
  const exam = content.officialExam.subjects[subjectId];
  let tracked = state.sessions.find((item) => item.type === "official-mock" && item.subject === subjectId && !item.finishedAt && item.endsAt);
  if (!tracked) {
    const now = Date.now();
    tracked = { id: newSessionId("official"), type: "official-mock", label: `${content.officialExam.eraYear} ${subjectLabel(subjectId)} 公式模試`,
      subject: subjectId, course: 80, examYear: content.officialExam.year || 2026,
      assessmentSource: `公式 ${content.officialExam.year || 2026} ${subjectId}`,
      firstSeen: Boolean(document.querySelector(`#mock-first-seen-${subjectId}`)?.checked)
        && !state.sessions.some((entry) => entry.type === "official-mock" && entry.subject === subjectId),
      calculatorUsed: false, startedAt: new Date(now).toISOString(), endsAt: new Date(now + exam.minutes * 60000).toISOString(),
      lastActivityAt: new Date(now).toISOString(), questionCount: exam.answerSlots.length, answers: {}, results: [], status: "in-progress" };
    state.sessions.push(tracked);
    markSessionDirty(tracked.id);
  }
  activeMockId = tracked.id;
  mockSubject = subjectId;
  mockStartedAt = new Date(tracked.startedAt).getTime();
  mockEndAt = new Date(tracked.endsAt).getTime();
  window.open(exam.question_url, "_blank", "noopener");
  renderMockSession(tracked.mockResult || null);
  queueSave();
}

function renderMockSession(result = currentMock()?.mockResult || null) {
  const tracked = currentMock();
  if (!tracked) return setView("mock");
  const exam = content.officialExam.subjects[mockSubject];
  const expired = Date.now() >= mockEndAt;
  const locked = Boolean(result || expired || mockGrading);
  currentView = "mock-session";
  pageTitle.textContent = `公式模試・${subjectLabel(mockSubject)}`;
  document.querySelectorAll(".nav-item").forEach((button) => button.classList.toggle("is-active", button.dataset.view === "mock"));
  clearInterval(mockTimer);
  app.innerHTML = `<section class="view-stack mock-session">
    <div class="mock-bar"><div><span class="eyebrow">${escapeHtml(content.officialExam.eraYear)} / ${exam.code}</span><h2>${escapeHtml(exam.label)}</h2></div><div class="timer"><small>残り時間</small><strong id="timerValue">${exam.minutes}:00</strong></div><div class="mock-links"><a href="${exam.question_url}" target="_blank" rel="noopener">問題PDF ↗</a>${result ? `<a href="${exam.answer_url}" target="_blank" rel="noopener">正解PDF ↗</a>` : "<span>正解は採点後に表示</span>"}</div></div>
    <p>一次試験・電卓なし・${tracked.firstSeen ? "初見" : "既見"}${expired && !result ? "。時間終了のため答案を固定しました。" : ""}</p>
    ${result ? mockResultMarkup(result) : ""}
    <div class="answer-sheet">${exam.answerSlots.map((item) => { const detail = result?.details?.find((value) => value.id === item.id); const submitted = detail?.submitted || tracked.answers?.[item.id] || ""; return `<label class="answer-slot ${detail?.correct === false ? "wrong" : ""}"><span>第${item.number}問${item.subquestion ? `-${item.subquestion}` : ""}</span><select data-mock-answer="${item.id}" ${locked ? "disabled" : ""}><option value="">—</option>${["ア", "イ", "ウ", "エ", "オ"].map((choice) => `<option ${submitted === choice ? "selected" : ""}>${choice}</option>`).join("")}</select><small>${item.points}点</small>${detail ? `<b>${escapeHtml(detail.answer)}</b>` : ""}</label>`; }).join("")}</div>
    <div class="actions mock-actions"><button class="secondary" data-view="mock" ${mockGrading ? "disabled" : ""}>模試一覧へ</button><button class="primary" data-grade-mock ${result || mockGrading ? "disabled" : ""}>${result ? "採点済み" : mockGrading ? "採点中…" : "採点する"}</button></div>
  </section>`;
  updateTimer();
  if (!result && !expired) mockTimer = setInterval(updateTimer, 1000);
}

function updateTimer() {
  const timer = document.querySelector("#timerValue");
  if (!timer || !mockEndAt) return;
  const remaining = Math.max(0, mockEndAt - Date.now());
  timer.textContent = `${Math.floor(remaining / 60000)}:${String(Math.floor((remaining % 60000) / 1000)).padStart(2, "0")}`;
  timer.closest?.(".timer")?.classList.toggle("urgent", remaining < 10 * 60000);
  if (!remaining) {
    clearInterval(mockTimer);
    document.querySelectorAll("[data-mock-answer]").forEach((select) => { select.disabled = true; });
    const tracked = currentMock();
    if (tracked && tracked.status === "in-progress") {
      tracked.status = "time-ended";
      tracked.timeLimitAnswers = { ...(tracked.answers || {}) };
      markSessionDirty(tracked.id);
      queueSave();
    }
  }
}

function mockResultMarkup(result) {
  return `<div class="mock-result ${result.score >= 80 ? "excellent" : result.score >= 60 ? "pass" : "retry"}"><div><small>SCORE</small><strong>${result.score}<span>/ ${result.maxScore}</span></strong></div><p>${result.score >= 80 ? "このセットは80点以上です。初見と再演習を区別して評価します。" : result.score >= 60 ? "このセットは60点以上です。誤答原因と時間配分を確認しましょう。" : "誤答原因を整理し、基礎論点を補強しましょう。"}</p></div>`;
}

async function gradeMock() {
  let tracked = currentMock();
  if (!tracked || mockGrading) return;
  if (tracked.mockResult) return renderMockSession(tracked.mockResult);
  const trackedId = tracked.id;
  mockGrading = true;
  const finishedAt = new Date().toISOString();
  const answers = { ...(tracked.timeLimitAnswers || tracked.answers || {}) };
  renderMockSession();
  try {
    const response = await fetch("/api/mock/grade", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ subjectId: tracked.subject, answers }) });
    if (!response.ok) throw new Error("mock_grade_failed");
    const result = await response.json();
    tracked = state.sessions.find((item) => item.id === trackedId);
    if (!tracked) { alert("この模試は別の操作で削除されました。模試一覧に戻ります。"); return; }
    if (tracked.mockResult) return;
    const elapsedMinutes = Math.max(1 / 60, Math.min(content.officialExam.subjects[tracked.subject].minutes, (new Date(finishedAt) - new Date(tracked.startedAt)) / 60000));
    Object.assign(tracked, { finishedAt, lastActivityAt: finishedAt, status: "completed", mockMinutes: elapsedMinutes,
      summary: { score: result.score, maxScore: result.maxScore, answered: result.details.filter((item) => item.submitted).length },
      timeLimitAnswers: answers, mockResult: result,
      results: result.details.map((detail) => ({ ...detail, questionId: `official:${tracked.examYear}:${tracked.subject}:${detail.id}`, answeredAt: finishedAt })) });
    markSessionDirty(tracked.id);
    rebuildAggregatesFromSessions();
    await queueSave({ immediate: true });
  } catch { alert("模試を採点できませんでした。答案は端末に保持しています。"); }
  finally {
    mockGrading = false;
    if (currentView === "mock-session" && activeMockId === trackedId) renderMockSession();
  }
}

function topicPerformance() {
  const groups = new Map();
  for (const result of assessmentRecords()) {
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
  app.innerHTML = `<section class="view-stack"><div class="section-heading"><div><span class="eyebrow">ARCHIVE</span><h2>演習対象から外した問題</h2><p>手動で除外した問題を管理します。習得した問題も期限を設けて復習します。戻すと通常演習・復習・自動割当の対象へ復帰します。</p></div><span class="archive-total">${archived.length}問</span></div>
    <div class="archive-subjects">${content.subjects.map((subject) => {
      const items = archived.filter((item) => item.subject === subject.id);
      return `<section class="archive-subject panel"><header><div><span class="eyebrow">${escapeHtml(subject.shortLabel)}</span><h3>${escapeHtml(subject.label)}</h3></div><strong>${items.length}<small>問</small></strong></header><div class="archive-list">${items.map((item) => `<article class="archive-row"><div><span>${item.archiveReason === "auto" ? `自動・${item.correctDayStreak}日連続正解` : "手動で追加"}</span><strong>${escapeHtml(item.topic || item.id)}</strong><small>${escapeHtml(item.id)}${item.archivedAt ? `・${escapeHtml(new Intl.DateTimeFormat("ja-JP", { dateStyle: "medium" }).format(new Date(item.archivedAt)))}に追加` : ""}</small></div><button class="secondary" data-unarchive="${escapeHtml(item.id)}">演習対象に戻す</button></article>`).join("") || '<div class="archive-empty">この科目のアーカイブはありません。</div>'}</div></section>`;
    }).join("")}</div>
  </section>`;
}

function sessionSummary(item) {
  if (item.summary) return { answered: Number(item.summary.answered ?? item.questionCount) || 0, correct: null, rate: Math.round(Number(item.summary.score) / Math.max(1, Number(item.summary.maxScore)) * 100), label: `${item.summary.score}/${item.summary.maxScore}点` };
  const results = item.results || [];
  const correct = results.filter((result) => result.correct).length;
  return { answered: results.length, correct, rate: results.length ? Math.round(correct / results.length * 100) : 0, label: `${correct}/${results.length}問正解` };
}

function sessionTierBreakdown(item) {
  if (item.type === "official-mock") return "";
  const counts = { 60: 0, 70: 0, 80: 0 };
  for (const result of item.results || []) counts[Number(result.minimumCourse || 60)] += 1;
  return [60, 70, 80].filter((score) => counts[score]).map((score) => `${score}点層 ${counts[score]}問`).join(" / ");
}

function sessionHistoryActions(item) {
  const action = item.type === "official-mock"
    ? item.mockResult ? `<button class="secondary" data-open-mock="${escapeHtml(item.id)}">答案・結果</button>`
      : !item.finishedAt ? `<button class="secondary" data-start-mock="${escapeHtml(item.subject)}">再開</button>` : ""
    : item.questionIds?.length && item.status !== "completed" ? `<button class="secondary" data-resume-session="${escapeHtml(item.id)}">再開</button>` : "";
  return `<div class="session-actions">${action}<button class="session-delete" data-delete-session="${escapeHtml(item.id)}" aria-label="このセッションを削除">削除</button></div>`;
}

function openMockResult(sessionId) {
  if (gradingQuestionId || mockGrading) return;
  const tracked = state.sessions.find((item) => item.id === sessionId && item.type === "official-mock" && item.mockResult);
  if (!tracked) return;
  pausePracticeAttempt();
  activeMockId = tracked.id;
  mockSubject = tracked.subject;
  mockStartedAt = new Date(tracked.startedAt).getTime();
  mockEndAt = new Date(tracked.endsAt || tracked.finishedAt).getTime();
  renderMockSession();
}

function renderHistory() {
  pageTitle.textContent = "すべての実施記録";
  const sessions = [...state.sessions].sort((a, b) => new Date(b.lastActivityAt || b.finishedAt || b.startedAt) - new Date(a.lastActivityAt || a.finishedAt || a.startedAt));
  app.innerHTML = `<section class="view-stack"><div class="section-heading"><div><span class="eyebrow">ALL SESSIONS</span><h2>すべての実施記録</h2><p>通常演習、復習、公式模試を実施単位で保存しています。不要な記録だけを個別に削除できます。</p></div><span class="session-total">${sessions.length}セッション</span></div>
    <div class="session-list">${sessions.map((item) => { const summary = sessionSummary(item); const breakdown = sessionTierBreakdown(item); const date = new Intl.DateTimeFormat("ja-JP", { dateStyle: "medium", timeStyle: "short" }).format(new Date(item.lastActivityAt || item.finishedAt || item.startedAt)); return `<article class="session-row"><div class="session-kind ${item.type}">${item.type === "official-mock" ? "模試" : item.type === "legacy" ? "移行" : "演習"}</div><div class="session-main"><small>${escapeHtml(date)}・目標${item.course || 60}点</small><strong>${escapeHtml(item.label || "演習セッション")}</strong><span>${item.subject ? escapeHtml(subjectLabel(item.subject)) : "科目横断"}・${summary.answered}問${breakdown ? `・${breakdown}` : ""}${item.mockMinutes ? `・${item.mockMinutes}分` : ""}</span></div><div class="session-score"><strong>${summary.rate}%</strong><small>${escapeHtml(summary.label)}</small></div>${sessionHistoryActions(item)}</article>`; }).join("") || '<div class="panel empty">まだ実施記録がありません。問題演習を開始すると、ここへセッション単位で保存されます。</div>'}</div>
  </section>`;
}

function phaseChart(phase) {
  const workload = phaseWorkload(phase);
  const start = new Date(`${phase.start}T00:00:00`);
  const end = new Date(`${phase.end}T23:59:59`);
  const calendarDays = dateKeysBetween(phase.start, phase.end);
  const totalDays = Math.max(1, calendarDays.length);
  const todayKey = localDateKey();
  const elapsed = new Date() < start ? 0 : calendarDays.filter((key) => key <= todayKey).length;
  const included = new Set(phaseCalendar(phase));
  const totalPlan = Math.round(included.size * phase.sessionSize * 6 / 7);
  const creditStart = new Date(`${workload.creditStartKey}T00:00:00`);
  const records = practiceRecords().filter((record) => { const date = new Date(record.answeredAt); return date >= creditStart && date <= end; });
  const maxY = Math.max(totalPlan, records.length, 1);
  const yTicks = [100, 75, 50, 25, 0].map((ratio) => Math.round(maxY * ratio / 100));
  const plot = { left: 5, right: 98, top: 5, bottom: 60 };
  const x = (day) => plot.left + day / totalDays * (plot.right - plot.left);
  const y = (count) => plot.bottom - count / maxY * (plot.bottom - plot.top);
  let plannedDays = 0;
  const plannedPoints = [`${x(0)},${y(0)}`, ...calendarDays.map((key, index) => {
    if (included.has(key)) plannedDays += 1;
    return `${x(index + 1)},${y(Math.round(plannedDays * phase.sessionSize * 6 / 7))}`;
  })];
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
  const excludedCount = calendarDays.length - included.size;
  return `<article class="panel phase-chart"><div class="dashboard-card-head"><div><span class="eyebrow">PLAN / ACTUAL</span><h3>現在フェーズの予実</h3></div><strong class="pace-${workload.paceStatus}">${workload.variance >= 0 ? "+" : ""}${workload.variance}<small>問・${status}</small></strong></div><div class="phase-chart-frame"><div class="phase-chart-y" aria-hidden="true">${yTicks.map((tick) => `<span>${tick.toLocaleString()}</span>`).join("")}</div><svg viewBox="0 0 100 65" preserveAspectRatio="none" role="img" aria-label="横軸が期間、縦軸が累計演習量の予実グラフ。学習除外日は予定線が増加しません">${gridLines.map((lineY) => `<line class="gridline" x1="${plot.left}" y1="${lineY}" x2="${plot.right}" y2="${lineY}"/>`).join("")}<polyline class="planned" points="${plannedPoints.join(" ")}"/><polyline class="actual" points="${points.join(" ")}"/><circle class="actual-point" cx="${actualEnd[0]}" cy="${actualEnd[1]}" r="1.5"/></svg></div><div class="phase-chart-x"><span>${formatMonthDay(phase.start)}</span><span>${new Intl.DateTimeFormat("ja-JP", { month: "numeric", day: "numeric" }).format(midpoint)}</span><span>${formatMonthDay(phase.end)}</span></div><div class="chart-axis-title">累計演習量（問）</div><div class="chart-legend"><span><i class="planned"></i>予定 ${workload.expected}問</span><span><i class="actual"></i>実績 ${workload.actual}問</span><span>${formatMonthDay(phase.start)}〜${formatMonthDay(phase.end)}</span>${excludedCount ? `<span>除外 ${excludedCount}日</span>` : ""}</div>${workload.creditStartKey < phase.start ? `<p>${formatMonthDay(workload.creditStartKey)}〜${formatMonthDay(phase.start)}開始前の${workload.prelearning}問は先取り学習として実績へ加算します。</p>` : ""}</article>`;
}

function scheduleManager() {
  const phases = learningPhases();
  const excludedDates = [...excludedStudyDates()].sort();
  return `<article class="panel schedule-master"><div class="dashboard-card-head"><div><span class="eyebrow">SCHEDULE MASTER</span><h3>学習スケジュール設定</h3></div><button class="secondary" data-reset-schedule ${Object.keys(state.plan.schedule?.phases || {}).length || excludedDates.length ? "" : "disabled"}>初期設定に戻す</button></div><p>ここで変更したフェーズ日程と学習除外日を、ダッシュボード・学習計画・予実・自動割当に共通で反映します。</p><div class="schedule-phase-list">${phases.map((phase, index) => `<div class="schedule-phase-row" data-schedule-phase="${escapeHtml(phase.id)}"><span><b>PHASE ${index + 1}</b>${escapeHtml(phase.label)}</span><label>開始<input type="date" data-schedule-start value="${phase.start}" required></label><label>終了<input type="date" data-schedule-end value="${phase.end}" required></label></div>`).join("")}</div><div class="schedule-actions"><button class="secondary" data-save-schedule>フェーズ日程を保存</button></div><div class="excluded-date-editor"><div><strong>学習除外日</strong><p>不可抗力などで学習できない日は、予定量・遅延補正・グラフの予定線を進めません。</p></div><div class="excluded-date-add"><input id="scheduleExclusionDate" type="date" aria-label="追加する学習除外日"><button class="secondary" data-add-excluded-date>除外日に追加</button></div></div><div class="excluded-date-list">${excludedDates.map((date) => `<span><b>${formatMonthDay(date)}</b><button data-remove-excluded-date="${date}" aria-label="${formatMonthDay(date)}を学習除外日から削除">×</button></span>`).join("") || "<small>学習除外日はありません。</small>"}</div></article>`;
}

function renderOverview() {
  pageTitle.textContent = "全体確認";
  const phase = currentPhase();
  const workload = phaseWorkload(phase);
  const phaseIndex = learningPhases().findIndex((item) => item.id === phase.id);
  app.innerHTML = `<section class="view-stack"><div class="section-heading"><div><span class="eyebrow">MASTER OVERVIEW</span><h2>試験までの全体像と現在地</h2><p>日程、達成項目、演習量、コース進捗、財務ルートを一画面で確認します。</p></div><div class="overview-position"><strong>${overallTiming()}%</strong><span>全期間の経過</span></div></div>
    ${scheduleManager()}
    <div class="overview-now"><article class="panel"><span class="phase-number">NOW / PHASE ${phaseIndex + 1}</span><h3>${escapeHtml(phase.label)}</h3><p>${escapeHtml(phase.goal)}</p><div class="overview-big-facts"><div><strong>${phaseTiming(phase).daysLeft}</strong><small>残り学習日数</small></div><div><strong>${phaseMilestoneProgress(phase).percent}%</strong><small>達成項目</small></div><div><strong>${workload.actual}</strong><small>期間内実施問数</small></div><div class="${workload.delayed ? "delay" : ""}"><strong>${workload.variance >= 0 ? `+${workload.variance}` : workload.variance}</strong><small>${workload.paceStatus === "ahead" ? "予定より進行" : workload.paceStatus === "behind" ? "予定より遅延" : "予定どおり"}</small></div></div></article><article class="panel load-adjust"><span class="eyebrow">AUTO LOAD</span><h3>本日の自動割当</h3><strong>${workload.adjustedTarget}<small>問</small></strong><p>${workload.excludedToday ? "今日は学習除外日のため、予定量と遅延補正を0問にしています。" : `基準${phase.sessionSize}問${workload.extra ? `に遅延補正${workload.extra}問を追加` : "。遅延補正はありません"}。`}</p><div class="allocation-list">${content.subjects.map((subject) => `<span>${escapeHtml(subject.shortLabel)} <b>${workload.allocation[subject.id]}問</b></span>`).join("")}</div><button class="primary" data-adaptive ${workload.excludedToday ? "disabled" : ""}>自動割当で始める</button></article></div>
    ${phaseChart(phase)}
    <div class="overview-phases">${learningPhases().map((item, index) => { const timing = phaseTiming(item); const progress = phaseMilestoneProgress(item); const records = practiceRecords().filter((record) => { const date = new Date(record.answeredAt); return date >= new Date(`${item.start}T00:00:00`) && date <= new Date(`${item.end}T23:59:59`); }); return `<article class="overview-phase ${timing.status}"><header><span>PHASE ${index + 1}</span><small>${formatMonthDay(item.start)}〜${formatMonthDay(item.end)}</small></header><h3>${escapeHtml(item.label)}</h3><p>${escapeHtml(item.goal)}</p><div class="overview-phase-bars"><label>日程 <i><b style="width:${timing.percent}%"></b></i><span>${timing.percent}%</span></label><label>項目 <i><b style="width:${progress.percent}%"></b></i><span>${progress.percent}%</span></label></div><footer>${records.length}問実施・1日${item.sessionSize}問基準</footer></article>`; }).join("")}</div>
    <div class="dashboard-secondary"><article class="panel"><div class="dashboard-card-head"><div><span class="eyebrow">COURSE READINESS</span><h3>累積の到達判定</h3></div></div><div class="overview-courses">${[60,70,80].map((score) => { const value = courseReadiness(score); const unlocked = isCourseUnlocked(score); return `<div class="${unlocked ? "" : "is-locked"}"><span>${score}</span><i><b style="width:${value.progress}%"></b></i><strong>${value.passed ? "合格" : unlocked ? "判定中" : "🔒"}</strong><small>累積 ${value.answered}/${value.total}問${value.failedLayers.length ? `・未合格 ${value.failedLayers.join("・")}点層` : ""}</small></div>`; }).join("")}</div></article><article class="panel"><div class="dashboard-card-head"><div><span class="eyebrow">FINANCE ROUTE</span><h3>${escapeHtml(content.financeTrack.title)}</h3></div><strong>${financeMilestoneProgress().percent}<small>%</small></strong></div><div class="milestone-list finance-milestones">${content.financeTrack.milestones.map((item) => `<label><input type="checkbox" disabled ${state.plan.completed[financeMilestoneKey(item.id)] ? "checked" : ""}><span><small>${formatMonthDay(item.date)}</small>${escapeHtml(item.label)}</span></label>`).join("")}</div></article></div>
  </section>`;
}

function reviewQuestionIds(mode) {
  const records = assessmentRecords();
  const byQuestion = new Map();
  for (const record of records) {
    if (!byQuestion.has(record.questionId)) byQuestion.set(record.questionId, []);
    byQuestion.get(record.questionId).push(record);
  }
  const latest = new Map(records.map((record) => [record.questionId, record]));
  const candidates = new Set([...latest.keys(), ...Object.keys(state.flags)]);
  const blocked = new Set(content.questionQuality?.quarantinedQuestionIds || []);
  return [...candidates].filter((id) => !isArchived(id) && !blocked.has(id)).map((id) => {
    const due = LearningCore.reviewSchedule(byQuestion.get(id) || [], id);
    return { id, flagged: Boolean(state.flags[id]), incorrect: latest.get(id)?.correct === false,
      dueAt: due?.dueAt || new Date().toISOString() };
  }).filter((item) => mode === "incorrect" ? item.incorrect : mode === "flagged" ? item.flagged : item.flagged || item.incorrect || new Date(item.dueAt) <= new Date())
    .sort((a, b) => Number(b.flagged) - Number(a.flagged) || new Date(a.dueAt) - new Date(b.dueAt)).map((item) => item.id);
}

async function startReview(mode) {
  const ids = reviewQuestionIds(mode);
  if (ids.length) return beginRemote({ ids: ids.slice(0, 50).join(","), limit: Math.min(50, ids.length) }, { type: "review", label: mode === "incorrect" ? "誤答復習" : mode === "flagged" ? "見直し復習" : "期限・弱点の復習" });
  const subject = recommendedSubject();
  return beginRemote({ subject: subject.id, limit: phaseWorkload().adjustedTarget }, { type: "adaptive", label: `${subject.label} 補強演習` });
}

async function beginDailyAllocation() {
  if (gradingQuestionId || mockGrading) return;
  const workload = phaseWorkload();
  if (workload.excludedToday) { alert("今日は学習除外日です。必要な場合は通常演習から任意に学習できます。"); return setView("overview"); }
  const todayKey = localDateKey();
  const unfinished = state.sessions.find((item) => item.type === "adaptive" && item.filters?.dailyDate === todayKey && item.status !== "completed"
    && item.questionIds?.some((id) => !item.results.some((record) => record.questionId === id)));
  if (unfinished) return resumePracticeSession(unfinished.id);
  const todayRecords = practiceRecords().filter((record) => localDateKey(record.answeredAt) === todayKey);
  const excludedIds = new Set(todayRecords.map((record) => record.questionId));
  app.innerHTML = '<div class="panel loading">本日の科目配分と未回答の問題から演習を組み立てています…</div>';
  try {
    const dueIds = reviewQuestionIds("adaptive").filter((id) => !excludedIds.has(id));
    const requests = content.subjects.map(async (subject) => {
      const done = new Set(todayRecords.filter((record) => record.subject === subject.id).map((record) => record.questionId)).size;
      const remaining = Math.max(0, workload.allocation[subject.id] - done);
      if (!remaining) return [];
      const due = dueIds.filter((id) => id.startsWith(`${subject.id}:`)).slice(0, Math.max(1, Math.floor(remaining / 3)));
      const review = due.length ? (await fetchQuestions({ ids: due.join(","), limit: due.length })).questions : [];
      const omit = new Set([...excludedIds, ...review.map((question) => question.id)]);
      const fresh = await availableQuestions({ subject: subject.id, seed: `${todayKey}:${subject.id}` }, remaining - review.length, omit);
      return [...review, ...fresh];
    });
    const questions = (await Promise.all(requests)).flat();
    if (!questions.length) { renderHome(); return; }
    begin(questions, { type: "adaptive", label: `本日の自動割当 ${questions.length}問`, filters: { dailyDate: todayKey, workload } });
  } catch { app.innerHTML = '<div class="panel empty">自動割当を作成できませんでした。接続を確認してください。</div>'; }
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
    if (gradingQuestionId || currentAttempt()?.status !== "answering") return;
    const attempt = currentAttempt();
    const eliminated = new Set(attempt.eliminatedChoices || []);
    const choiceId = eliminateButton.dataset.eliminateChoice;
    eliminated.has(choiceId) ? eliminated.delete(choiceId) : eliminated.add(choiceId);
    attempt.eliminatedChoices = [...eliminated];
    if (attempt.selectedAnswer === choiceId) attempt.selectedAnswer = "";
    markSessionDirty(activeSession.id);
    queueSave();
    return renderQuestion();
  }
  const choice = event.target.closest("[data-select-choice]");
  if (choice && currentView === "session" && !choice.classList.contains("is-eliminated")) {
    if (gradingQuestionId || currentAttempt()?.status !== "answering") return;
    selectCurrentAnswer(choice.dataset.selectChoice);
    return renderQuestion();
  }
  const calcKey = event.target.closest("[data-calc-action]");
  if (calcKey) return useCalculator(calcKey.dataset.calcAction, calcKey.dataset.calcValue);
  if (event.target.closest("[data-calc-minimize]")) { calculatorState.minimized = !calculatorState.minimized; return renderQuestion(); }
  const mobileNavToggle = event.target.closest("[data-mobile-nav-toggle]");
  if (mobileNavToggle) {
    const sidebar = mobileNavToggle.closest(".sidebar");
    const expanded = !sidebar.classList.contains("is-menu-open");
    sidebar.classList.toggle("is-menu-open", expanded);
    mobileNavToggle.setAttribute("aria-expanded", String(expanded));
    return;
  }
  const viewButton = event.target.closest("[data-view]");
  if (viewButton) {
    document.querySelector(".sidebar")?.classList.remove("is-menu-open");
    document.querySelector("[data-mobile-nav-toggle]")?.setAttribute("aria-expanded", "false");
    return setView(viewButton.dataset.view);
  }
  if (event.target.closest("[data-save-schedule]")) {
    const rows = [...document.querySelectorAll("[data-schedule-phase]")];
    const phaseValues = Object.fromEntries(rows.map((row) => [row.dataset.schedulePhase, {
      start: row.querySelector("[data-schedule-start]").value,
      end: row.querySelector("[data-schedule-end]").value
    }]));
    if (Object.values(phaseValues).some((phase) => !validDateKey(phase.start) || !validDateKey(phase.end))) return alert("すべての開始日と終了日を入力してください。");
    const phases = schedulePhasesFor(phaseValues);
    const error = scheduleValidation(phases);
    if (error) return alert(error);
    state.plan.schedule = { ...normalizeSchedule(state.plan.schedule), phases: phaseValues };
    queueSave();
    return renderOverview();
  }
  if (event.target.closest("[data-add-excluded-date]")) {
    const date = document.querySelector("#scheduleExclusionDate")?.value;
    if (!validDateKey(date)) return alert("追加する日付を選択してください。");
    if (!learningPhases().some((phase) => date >= phase.start && date <= phase.end)) return alert("学習除外日はフェーズ期間内の日付を指定してください。");
    state.plan.schedule = normalizeSchedule({
      ...state.plan.schedule,
      excludedDates: [...(state.plan.schedule?.excludedDates || []), date]
    });
    queueSave();
    return renderOverview();
  }
  const removeExcluded = event.target.closest("[data-remove-excluded-date]");
  if (removeExcluded) {
    state.plan.schedule = normalizeSchedule({
      ...state.plan.schedule,
      excludedDates: (state.plan.schedule?.excludedDates || []).filter((date) => date !== removeExcluded.dataset.removeExcludedDate)
    });
    queueSave();
    return renderOverview();
  }
  if (event.target.closest("[data-reset-schedule]")) {
    if (!confirm("フェーズ日程と学習除外日を初期設定に戻しますか？")) return;
    state.plan.schedule = defaultSchedule();
    queueSave();
    return renderOverview();
  }
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
  const resumeButton = event.target.closest("[data-resume-session]");
  if (resumeButton) return resumePracticeSession(resumeButton.dataset.resumeSession);
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
  if (jump) return navigatePractice(Number(jump.dataset.jump));
  if (event.target.closest("[data-prev]")) return navigatePractice(currentIndex - 1);
  if (event.target.closest("[data-next]")) {
    navigatePractice(currentIndex + 1);
    window.scrollTo({ top: 0, left: 0, behavior: "auto" });
    return;
  }
  if (event.target.closest("[data-quit-session], [data-finish-session]")) {
    if (gradingQuestionId) return;
    pausePracticeAttempt();
    if (activeSession) {
      activeSession.status = event.target.closest("[data-finish-session]") ? "completed" : "paused";
      markSessionDirty(activeSession.id);
      queueSave();
    }
    session = [];
    activeSession = null;
    currentIndex = 0;
    setView("home");
    window.scrollTo({ top: 0, left: 0, behavior: "auto" });
    return;
  }
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
  const mockResultButton = event.target.closest("[data-open-mock]");
  if (mockResultButton) return openMockResult(mockResultButton.dataset.openMock);
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
  if (!choice || !["Enter", " "].includes(event.key) || choice.classList.contains("is-eliminated") || gradingQuestionId === session[currentIndex]?.id) return;
  event.preventDefault();
  if (currentView !== "session" || currentAttempt()?.status !== "answering") return;
  selectCurrentAnswer(choice.dataset.selectChoice);
  renderQuestion();
});

document.addEventListener("change", (event) => {
  if (!event.target.matches?.("[data-mock-answer]")) return;
  const tracked = currentMock();
  if (!tracked || tracked.finishedAt || mockGrading) return;
  if (Date.now() >= new Date(tracked.endsAt).getTime()) { renderMockSession(); return; }
  tracked.answers[event.target.dataset.mockAnswer] = event.target.value;
  tracked.lastActivityAt = new Date().toISOString();
  markSessionDirty(tracked.id);
  queueSave();
});

document.addEventListener("submit", (event) => {
  const form = event.target;
  if (!form.matches?.("[data-evidence-form], [data-study-profile]")) return;
  event.preventDefault();
  const value = (name) => form.elements.namedItem(name)?.value || "";
  if (form.matches("[data-study-profile]")) {
    const hours = value("weeklyHours") === "" ? null : Number(value("weeklyHours"));
    if (hours !== null && (!Number.isFinite(hours) || hours < .5 || hours > 168)) return alert("週の学習時間は0.5〜168時間で指定してください。");
    state.plan.studyProfile = { weeklyMinutes: hours === null ? null : hours * 60,
      exemptions: Object.fromEntries(["economics", "management", "information"].map((id) => [id, value(id)])) };
  } else {
    try {
      const input = Object.fromEntries(["kind", "source", "date", "minutes", "score", "itemText", "note"].map((name) => [name, value(name)]));
      for (const name of ["confirmedCompletion", "firstSeen", "calculatorUsed"]) input[name] = Boolean(form.elements.namedItem(name)?.checked);
      const entry = StudyEvidence.parseEvidence(input, content.subjects.find((subject) => subject.id === studySubject), localDateKey());
      state.plan.evidence ||= {};
      state.plan.evidence[newSessionId("evidence")] = entry;
    } catch (error) { return alert(error.message); }
  }
  refreshAutoPlanCompletion();
  queueSave({ immediate: true });
  renderPlan();
});

document.addEventListener("click", (event) => {
  const button = event.target.closest("[data-delete-evidence]");
  if (!button) return;
  delete state.plan.evidence?.[button.dataset.deleteEvidence];
  refreshAutoPlanCompletion();
  queueSave({ immediate: true });
  renderPlan();
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
