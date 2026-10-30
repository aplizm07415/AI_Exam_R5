(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.ProgressSync = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  const clone = (value) => value === undefined ? undefined : JSON.parse(JSON.stringify(value));
  const object = (value) => value !== null && typeof value === "object" && !Array.isArray(value);
  const safeKey = (key) => !["__proto__", "prototype", "constructor"].includes(key);

  // Only user-owned values are synchronized. Totals are rebuilt from sessions.
  function snapshot(state = {}) {
    const { sessions, results, attempts, recent, mockResults, _sync, savedAt, ...value } = state;
    const result = clone(value);
    if (result.plan) delete result.plan.autoCompleted;
    result.activity = Object.fromEntries(Object.entries(state.activity || {})
      .filter(([, item]) => item?.planChecks)
      .map(([day, item]) => [day, { planChecks: item.planChecks }]));
    return result;
  }

  function changes(before, after, path = []) {
    if (JSON.stringify(before) === JSON.stringify(after)) return [];
    // Each excluded date is a separate edit, so concurrent schedule edits survive.
    if (path.join(".") === "plan.schedule.excludedDates" && Array.isArray(before) && Array.isArray(after)) {
      return [...new Set([...before, ...after])].filter((day) => before.includes(day) !== after.includes(day))
        .map((day) => ({ path, member: day, remove: !after.includes(day) }));
    }
    if (object(after) && (object(before) || before === undefined)) {
      return [...new Set([...Object.keys(before || {}), ...Object.keys(after)])]
        .filter(safeKey).flatMap((key) => changes(before?.[key], after[key], [...path, key]));
    }
    return [{ path, ...(after === undefined ? { remove: true } : { value: clone(after) }) }];
  }

  function changeKey(change) {
    return JSON.stringify([change.path, change.member ?? null]);
  }

  function applyChanges(source, edits) {
    const result = clone(source || {});
    for (const edit of edits) {
      if (!Array.isArray(edit.path) || !edit.path.length || !edit.path.every(safeKey)) continue;
      let target = result;
      for (const key of edit.path.slice(0, -1)) {
        if (!object(target[key])) target[key] = {};
        target = target[key];
      }
      const key = edit.path.at(-1);
      if (edit.member !== undefined) {
        const members = new Set(Array.isArray(target[key]) ? target[key] : []);
        if (edit.remove) members.delete(edit.member); else members.add(edit.member);
        target[key] = [...members].sort();
      } else if (edit.remove) delete target[key];
      else target[key] = clone(edit.value);
    }
    return result;
  }

  function recordKey(record) {
    return record.attemptId || JSON.stringify([record.questionId, record.answeredAt]);
  }

  function mergeSession(left, right) {
    if (!left) return clone(right);
    if (!right) return clone(left);
    const time = (item) => Date.parse(item.lastActivityAt || item.finishedAt || item.startedAt || "") || 0;
    const [older, newer] = time(left) <= time(right) ? [left, right] : [right, left];
    const records = new Map((older.results || []).map((record) => [recordKey(record), clone(record)]));
    for (const record of newer.results || []) {
      const key = recordKey(record);
      const previous = records.get(key);
      if (!previous) records.set(key, clone(record));
      else {
        const first = Date.parse(record.answeredAt) < Date.parse(previous.answeredAt) ? record : previous;
        const exposure = [record.explanationViewedAt, previous.explanationViewedAt].filter(Boolean)
          .sort((a, b) => Date.parse(b) - Date.parse(a))[0];
        records.set(key, { ...clone(first), ...(exposure ? { explanationViewedAt: exposure } : {}) });
      }
    }
    const merged = { ...clone(older), ...clone(newer), results: [...records.values()] };
    if (older.attempts || newer.attempts) {
      merged.attempts = { ...clone(older.attempts || {}), ...clone(newer.attempts || {}) };
      for (const record of records.values()) {
        const attempt = merged.attempts[record.questionId];
        if (attempt?.attemptId === record.attemptId) merged.attempts[record.questionId] = {
          ...attempt, status: "graded", activeSince: null, selectedAnswer: record.submittedAnswer ?? attempt.selectedAnswer
        };
      }
    }
    if (merged.type === "official-mock") {
      const finished = [left, right].filter((item) => item.finishedAt && item.mockResult)
        .sort((a, b) => Date.parse(a.finishedAt) - Date.parse(b.finishedAt))[0];
      if (finished) return { ...merged, ...clone(finished) };
    }
    return merged;
  }

  function mergeSessions(remote = [], local = [], deleted = []) {
    const tombstones = new Set(deleted);
    const sessions = new Map();
    for (const item of [...remote, ...local]) {
      if (item?.id && !tombstones.has(item.id)) sessions.set(item.id, mergeSession(sessions.get(item.id), item));
    }
    return [...sessions.values()];
  }

  return { clone, snapshot, changes, changeKey, applyChanges, mergeSession, mergeSessions };
});
