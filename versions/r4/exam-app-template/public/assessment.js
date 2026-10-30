(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.Assessment = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  // Old clients could append several grades after displaying the answer.
  // Retain the first response to each question in each session for assessment.
  function eligibleRecords(records, quality = {}) {
    const seen = new Set();
    const quarantined = new Set(quality.quarantinedQuestionIds || []);
    const completeCatalog = Number.isInteger(quality.bankTotal) && quality.bankTotal >= 0 && quality.questions;
    return [...records].sort((a, b) => new Date(a.answeredAt) - new Date(b.answeredAt)).filter((record) => {
      const review = quality.questions?.[record.questionId];
      const version = Number(record.contentVersion ?? 1);
      // A full catalogue is authoritative about IDs and known versions. Keep
      // history from removed questions or newer clients, but await a matching
      // catalogue before using it as evidence of current proficiency.
      if (completeCatalog && (!Object.hasOwn(quality.questions, record.questionId)
          || !Number.isInteger(version) || version < 1
          || version > Number(review?.contentVersion || 1))) return false;
      if (quarantined.has(record.questionId) || review?.status === "quarantined"
          || version < Number(review?.minimumScoringVersion || 1)) return false;
      const key = `${record.sessionId || record.attemptId || record.answeredAt}:${record.questionId}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return record.assessmentEligible !== false;
    }).map((record) => {
      const current = quality.questions?.[record.questionId] || {};
      const attributes = Object.fromEntries(["subject", "topicId", "topic", "minimumCourse", "foundationCheckpoint", "difficulty"]
        .filter((key) => current[key] !== undefined).map((key) => [key, current[key]]));
      return { ...record, ...attributes };
    });
  }

  function indexRecords(records) {
    const bySubject = new Map();
    for (const record of records) {
      if (!bySubject.has(record.subject)) bySubject.set(record.subject, new Map());
      const topics = bySubject.get(record.subject);
      if (!topics.has(record.topicId)) topics.set(record.topicId, []);
      topics.get(record.topicId).push(record);
    }
    return bySubject;
  }

  function topicStatus(subjectId, score, item, topics, recordsIndex, criteria) {
    const ids = new Set(item.topicIds || (item.topicId ? [item.topicId] : []));
    const matchingTopics = topics.filter((topic) => topic.subject === subjectId && ids.has(topic.id));
    const available = matchingTopics.reduce((sum, topic) => sum + Number(topic.courseCounts?.[score] || 0), 0);
    const mapped = available > 0 && ids.size > 0;
    const records = mapped ? [...ids].flatMap((id) => recordsIndex.get(subjectId)?.get(id) || [])
      .filter((record) => Number(record.minimumCourse || 60) <= score) : [];
    const requiredQuestions = mapped ? Math.min(criteria.questions, available) : criteria.questions;
    const uniqueQuestions = new Set(records.map((record) => record.questionId)).size;
    const sessions = new Set(records.map((record) => record.sessionId)).size;
    const rate = records.length ? Math.round(records.filter((record) => record.correct).length / records.length * 100) : 0;
    const recent = [...records].sort((a, b) => new Date(b.answeredAt) - new Date(a.answeredAt)).slice(0, Math.max(requiredQuestions, 10));
    const recentRate = recent.length ? Math.round(recent.filter((record) => record.correct).length / recent.length * 100) : 0;
    return {
      mapped, topic: matchingTopics.map((topic) => topic.label).join("・") || null,
      uniqueQuestions, requiredQuestions, sessions, requiredSessions: criteria.sessions,
      rate, requiredRate: criteria.rate, recentRate, requiredRecentRate: criteria.recentRate,
      passed: mapped && uniqueQuestions >= requiredQuestions && sessions >= criteria.sessions
        && rate >= criteria.rate && recentRate >= criteria.recentRate,
      reason: mapped ? null : "対応教材なし・未判定"
    };
  }

  function independentAssessments(evidence, subjectId, targetScore = 80) {
    const seen = new Set();
    return Object.values(evidence || {}).filter((entry) => {
      if (entry?.kind !== "assessment" || entry.subject !== subjectId || entry.firstSeen !== true
          || entry.calculatorUsed !== false || !entry.source?.trim() || !entry.completedAt
          || !Number.isFinite(entry.score) || !Number.isFinite(entry.maxScore) || entry.maxScore <= 0
          || entry.score < 0 || entry.score > entry.maxScore
          || !Number.isFinite(entry.minutes) || entry.minutes <= 0
          || !Number.isFinite(entry.timeLimit) || entry.timeLimit <= 0 || entry.minutes > entry.timeLimit
          || entry.score / entry.maxScore * 100 < targetScore) return false;
      const key = entry.source.normalize("NFKC").trim().replace(/\s+/g, " ").toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }

  return { eligibleRecords, indexRecords, topicStatus, independentAssessments };
});
