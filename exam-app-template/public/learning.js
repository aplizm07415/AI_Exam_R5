(function (root) {
  "use strict";
  const DAY = 86400000;
  const REVIEW_DAYS = [1, 7, 30];

  function dateKey(value) {
    const date = new Date(value);
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
  }

  function assessmentContext(records, questionId, now, quality = {}) {
    const previous = records.filter((record) => record.questionId === questionId)
      .sort((left, right) => new Date(right.answeredAt) - new Date(left.answeredAt));
    const last = previous[0];
    const contentVersion = Number(quality.contentVersion) || 1;
    const latestExposure = previous.reduce((latest, record) => Math.max(latest,
      Date.parse(record.explanationViewedAt || record.answeredAt) || 0), 0);
    const immediateRetry = Boolean(latestExposure && new Date(now) - latestExposure < DAY);
    const eligibleQuality = quality.qualityStatus !== "quarantined" && quality.status !== "quarantined"
      && contentVersion >= (Number(quality.minimumScoringVersion) || 1);
    return {
      exposure: last ? "seen_before" : "first_seen",
      assessmentEligible: eligibleQuality && !immediateRetry,
      assessmentReason: !eligibleQuality ? "content_unavailable" : immediateRetry ? "immediate_retry" : last ? "delayed_retrieval" : "first_attempt",
      contentVersion
    };
  }

  function firstDailyAssessments(records, questionId) {
    const days = new Map();
    for (const record of [...records].filter((item) => item.questionId === questionId && item.assessmentEligible !== false)
      .sort((left, right) => new Date(left.answeredAt) - new Date(right.answeredAt))) {
      const day = dateKey(record.answeredAt);
      if (!days.has(day)) days.set(day, record);
    }
    return [...days.values()];
  }

  function reviewSchedule(records, questionId) {
    const daily = firstDailyAssessments(records, questionId);
    if (!daily.length) return null;
    let streak = 0;
    for (const record of [...daily].reverse()) {
      if (!record.correct) break;
      streak += 1;
    }
    const latest = daily.at(-1);
    const intervalDays = latest.correct ? REVIEW_DAYS[Math.min(REVIEW_DAYS.length - 1, Math.max(0, streak - 1))] : 1;
    return { streak, intervalDays, dueAt: new Date(new Date(latest.answeredAt).getTime() + intervalDays * DAY).toISOString(), lastCorrect: Boolean(latest.correct) };
  }

  function attemptId(sessionId, questionId) {
    return `${sessionId}:${questionId}`;
  }

  function elapsedMs(attempt, now) {
    return Math.max(0, Number(attempt.elapsedMs) || 0)
      + (attempt.activeSince ? Math.max(0, new Date(now) - new Date(attempt.activeSince)) : 0);
  }

  const api = { DAY, REVIEW_DAYS, dateKey, assessmentContext, firstDailyAssessments, reviewSchedule, attemptId, elapsedMs };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  root.LearningCore = api;
})(typeof globalThis !== "undefined" ? globalThis : this);
