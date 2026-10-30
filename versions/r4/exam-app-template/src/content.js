const fs = require("node:fs");
const path = require("node:path");

const rawConfig = require("../content/exam.json");
const questionIndex = require("../content/question-index.json");
const studyPlans = require("../content/analysis/study-plans.json");
const explanationOverrides = require("../content/analysis/explanation-text-overrides.json");
const officialExam = require("../content/official/r8.json");
const officialAnalysis = require("../content/official/r8-analysis.json");
const corrections = require("../content/corrections.json");
const qualityReview = require("../content/quality-review.json");
const exclusions = require("../content/exclusions.json");
const supplementalQuestions = require("../content/supplemental/whitepaper-2026.json");
const { calculationRequired, normalizeChoiceId, normalizeChoiceText } = require("./question-quality");
const { formatExplanation } = require("./explanation-format");

const contentRoot = path.resolve(__dirname, "..", "content");
const SUPPORTED_TYPES = new Set(["single_choice", "multiple_choice", "numeric", "text"]);
const excludedQuestionIds = new Set(exclusions.map((item) => item.id));

function questionQuality(id) {
  return {
    status: "unreviewed",
    contentVersion: 1,
    minimumScoringVersion: 1,
    reviewedAt: null,
    ...qualityReview.questions[id]
  };
}

function withQuestionQuality(question) {
  const quality = questionQuality(question.id);
  return { ...question, contentVersion: quality.contentVersion, qualityStatus: quality.status, reviewedAt: quality.reviewedAt };
}

function stripComplexMarker(value) {
  return String(value || "").replace(/^\s*※複雑\s*/, "").trim();
}

function normalizeExplanationChoiceReferences(value, optionIds) {
  const ids = new Set(optionIds);
  const kana = ["ア", "イ", "ウ", "エ", "オ"];
  const latin = ["A", "B", "C", "D", "E"];
  const target = kana.every((id, index) => !ids.has(id) || !ids.has(latin[index])) ? (ids.has("ア") ? kana : latin) : null;
  if (!target) return value;
  return String(value).replace(/選択肢\s*([ア-オA-E])/gu, (match, id) => {
    const index = kana.includes(id) ? kana.indexOf(id) : latin.indexOf(id);
    return index >= 0 && ids.has(target[index]) ? `選択肢${target[index]}` : match;
  });
}

function normalizeQuestion(subject, rawQuestion) {
  const id = `${subject.id}:${rawQuestion.id}`;
  const metadata = questionIndex.questions[id];
  if (!metadata) throw new Error(`問題インデックスがありません: ${id}`);
  const correction = corrections[id] || {};
  const replaceText = (value) => Object.entries(correction.replacements || {}).reduce(
    (current, [from, to]) => current.replaceAll(from, to),
    String(value || "")
  );
  const prompt = stripComplexMarker(replaceText(correction.questionText || `${rawQuestion.question_text}${correction.appendQuestionText ? `\n${correction.appendQuestionText}` : ""}`));
  const correctedQuestion = { ...rawQuestion, question_text: prompt };
  if (correction.calculationRequired !== undefined && typeof correction.calculationRequired !== "boolean") {
    throw new Error(`計算フラグの訂正値が不正です: ${id}`);
  }
  const needsCalculator = correction.calculationRequired ?? calculationRequired(correctedQuestion);
  const rawExplanation = typeof rawQuestion.explanation === "object" ? rawQuestion.explanation?.text || "" : rawQuestion.explanation || "";
  const options = rawQuestion.choices.map((choice) => {
    const choiceId = normalizeChoiceId(choice.label);
    const correctedText = correction.choiceText?.[choiceId] || replaceText(choice.text);
    return { id: choiceId, label: normalizeChoiceText({ ...choice, text: correctedText }) };
  });
  const explanation = normalizeExplanationChoiceReferences(
    formatExplanation(correction.explanation || explanationOverrides[id] || rawExplanation),
    options.map((option) => option.id)
  );
  return withQuestionQuality({
    id,
    sourceId: rawQuestion.id,
    source: "azure",
    subject: subject.id,
    topicId: metadata.topicId,
    topic: metadata.topic,
    parent: metadata.parent,
    tags: metadata.tags,
    priority: metadata.priority,
    minimumCourse: metadata.minimumCourse,
    difficulty: metadata.difficulty,
    type: "single_choice",
    title: `${metadata.topic} / ${rawQuestion.id}`,
    prompt,
    options,
    answer: normalizeChoiceId(correction.answer || rawQuestion.answer),
    points: 1,
    calculationRequired: needsCalculator,
    explanation,
    originalExplanation: correction.explanation || explanationOverrides[id] || rawExplanation,
    ...(correction.sourceReference ? { sourceReference: correction.sourceReference } : {})
  });
}

function normalizeSupplementalQuestion(rawQuestion) {
  const options = rawQuestion.options.map((option) => ({ id: normalizeChoiceId(option.id), label: String(option.label).trim() }));
  const question = {
    ...rawQuestion,
    type: rawQuestion.type || "single_choice",
    points: Number(rawQuestion.points || 1),
    options,
    answer: normalizeChoiceId(rawQuestion.answer),
    calculationRequired: rawQuestion.calculationRequired ?? calculationRequired({ question_text: rawQuestion.prompt }),
    explanation: normalizeExplanationChoiceReferences(formatExplanation(rawQuestion.explanation), options.map((option) => option.id)),
    originalExplanation: rawQuestion.explanation
  };
  return withQuestionQuality(question);
}

const DIFFICULTY_ORDER = { "基礎": 0, "標準": 1, "発展": 2 };

function assignFoundationCheckpoints(questions) {
  for (const subject of rawConfig.subjects) {
    const foundation = questions.filter((question) => question.subject === subject.id && question.minimumCourse === 60);
    const groups = new Map();
    for (const question of foundation) {
      const current = groups.get(question.topicId) || [];
      current.push(question);
      groups.set(question.topicId, current);
    }
    const leaders = [];
    const remaining = [];
    for (const [, values] of [...groups.entries()].sort(([left], [right]) => left.localeCompare(right, "ja"))) {
      values.sort((left, right) => (DIFFICULTY_ORDER[left.difficulty] - DIFFICULTY_ORDER[right.difficulty]) || left.id.localeCompare(right.id));
      leaders.push(values[0]);
      remaining.push(...values.slice(1));
    }
    remaining.sort((left, right) => (
      (DIFFICULTY_ORDER[left.difficulty] - DIFFICULTY_ORDER[right.difficulty])
      || left.topicId.localeCompare(right.topicId, "ja")
      || left.id.localeCompare(right.id)
    ));
    const ordered = [...leaders, ...remaining];
    const firstSize = Math.ceil(ordered.length / 3);
    const secondSize = Math.ceil((ordered.length - firstSize) / 2);
    ordered.forEach((question, index) => {
      question.foundationCheckpoint = index < firstSize ? 1 : index < firstSize + secondSize ? 2 : 3;
    });
  }
  return questions;
}

function loadQuestions() {
  const sourceQuestions = rawConfig.subjects.flatMap((subject) => {
    const sourcePath = path.join(contentRoot, "source", subject.sourceFile);
    const questions = JSON.parse(fs.readFileSync(sourcePath, "utf8"));
    return questions
      .filter((question) => !excludedQuestionIds.has(`${subject.id}:${question.id}`))
      .map((question) => normalizeQuestion(subject, question));
  });
  return assignFoundationCheckpoints([...sourceQuestions, ...supplementalQuestions.map(normalizeSupplementalQuestion)]);
}

function validateContent(value) {
  if (!value.exam?.id || !/^[a-z0-9][a-z0-9_-]*$/.test(value.exam.id)) {
    throw new Error("exam.id は半角英数字・ハイフン・アンダースコアで指定してください");
  }
  if (!value.exam.name || !Array.isArray(value.subjects) || !Array.isArray(value.questions)) {
    throw new Error("exam.name、subjects、questions は必須です");
  }
  if (!Array.isArray(value.foundationCheckpoints) || value.foundationCheckpoints.length !== 3 || new Set(value.foundationCheckpoints.map((item) => Number(item.id))).size !== 3) {
    throw new Error("foundationCheckpoints は重複しない3区分で指定してください");
  }
  const subjectIds = new Set(value.subjects.map((subject) => subject.id));
  const questionIds = new Set();
  for (const question of value.questions) {
    if (!question.id || questionIds.has(question.id)) throw new Error(`問題IDが未設定または重複しています: ${question.id || "(空)"}`);
    if (!subjectIds.has(question.subject)) throw new Error(`問題 ${question.id} の科目 ${question.subject} がsubjectsにありません`);
    if (!SUPPORTED_TYPES.has(question.type)) throw new Error(`問題 ${question.id} のtypeは未対応です: ${question.type}`);
    if (question.answer === undefined || !Number.isFinite(Number(question.points)) || Number(question.points) <= 0) {
      throw new Error(`問題 ${question.id} のanswerまたはpointsが不正です`);
    }
    if (question.type === "single_choice") {
      const optionIds = question.options.map((option) => String(option.id));
      if (optionIds.length !== new Set(optionIds).size) throw new Error(`問題 ${question.id} の選択肢IDが重複しています`);
      if (!optionIds.includes(String(question.answer))) throw new Error(`問題 ${question.id} の正答 ${question.answer} が選択肢にありません`);
    }
    if (String(question.source || "").startsWith("official")) {
      const reference = question.sourceReference;
      if (!reference?.title || !/^https:\/\//.test(reference.url || "") || !/^\d{4}-\d{2}-\d{2}$/.test(reference.checkedAt || "")) {
        throw new Error(`公式補充問題 ${question.id} の出典または確認日が不正です`);
      }
    }
    if (question.minimumCourse === 60 && ![1, 2, 3].includes(Number(question.foundationCheckpoint))) {
      throw new Error(`60点問題 ${question.id} のfoundationCheckpointが不正です`);
    }
    questionIds.add(question.id);
  }
  return value;
}

// Checkpoints are assigned before quarantine so removing a broken question does
// not move every later question between existing learning checkpoints.
const questionBank = loadQuestions();
const bankIds = new Set(questionBank.map((question) => question.id));
for (const [id, review] of Object.entries(qualityReview.questions)) {
  if (!bankIds.has(id)) throw new Error(`品質レビューの問題IDが教材にありません: ${id}`);
  if (!["corrected", "verified", "quarantined"].includes(review.status)
    || !Number.isInteger(review.contentVersion) || review.contentVersion < 1
    || !Number.isInteger(review.minimumScoringVersion) || review.minimumScoringVersion < 1
    || (review.status !== "quarantined" && review.minimumScoringVersion > review.contentVersion)
    || !/^\d{4}-\d{2}-\d{2}$/.test(review.reviewedAt || "")) {
    throw new Error(`品質レビューの状態または教材版が不正です: ${id}`);
  }
}
const content = validateContent({ ...rawConfig, questions: questionBank.filter((question) => question.qualityStatus !== "quarantined") });
const questionsById = new Map(content.questions.map((question) => [question.id, question]));

function publicQuestion(question) {
  const { answer, aliases, tolerance, explanation, originalExplanation, ...visible } = question;
  return visible;
}

function hashSeed(value) {
  let hash = 2166136261;
  for (const character of String(value)) {
    hash ^= character.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function shuffled(values, seed) {
  const copy = [...values];
  let state = hashSeed(seed || new Date().toISOString().slice(0, 10));
  for (let index = copy.length - 1; index > 0; index -= 1) {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    const target = state % (index + 1);
    [copy[index], copy[target]] = [copy[target], copy[index]];
  }
  return copy;
}

function queryQuestions(params = {}) {
  const requestedIds = String(params.ids || "").split(",").filter(Boolean).slice(0, 100);
  const excludedIds = new Set(String(params.excludeIds || "").slice(0, 640000).split(",").filter((id) => id && id.length <= 128).slice(0, 5000));
  let matches;
  if (requestedIds.length) {
    matches = requestedIds.map((id) => questionsById.get(id)).filter(Boolean);
  } else {
    const targetScore = [60, 70, 80].includes(Number(params.course)) ? Number(params.course) : 80;
    const exactTier = params.tier === "exact";
    matches = content.questions.filter((question) => (
      (!params.subject || question.subject === params.subject)
      && (!params.topic || question.topicId === params.topic)
      && (!params.difficulty || question.difficulty === params.difficulty)
      && (!params.priority || question.priority === params.priority)
      && (exactTier ? question.minimumCourse === targetScore : question.minimumCourse <= targetScore)
      && (!params.checkpoint || targetScore !== 60 || question.foundationCheckpoint === Number(params.checkpoint))
    ));
    matches = shuffled(matches, params.seed);
  }
  matches = matches.filter((question) => !excludedIds.has(question.id));
  const limit = Math.max(1, Math.min(100, Number(params.limit) || 20));
  const offset = Math.max(0, Math.min(5000, Math.floor(Number(params.offset) || 0)));
  return { total: matches.length, questions: matches.slice(offset, offset + limit).map(publicQuestion) };
}

function topicSummaries() {
  const counts = new Map();
  for (const question of content.questions) {
    const current = counts.get(question.topicId) || {
      id: question.topicId,
      subject: question.subject,
      label: question.topic,
      parent: question.parent,
      tags: question.tags,
      count: 0,
      minimumCourse: question.minimumCourse,
      courseCounts: { 60: 0, 70: 0, 80: 0 }
    };
    current.count += 1;
    current.minimumCourse = Math.min(current.minimumCourse, question.minimumCourse);
    for (const score of [60, 70, 80]) if (question.minimumCourse <= score) current.courseCounts[score] += 1;
    counts.set(question.topicId, current);
  }
  return [...counts.values()].sort((a, b) => a.subject.localeCompare(b.subject) || b.count - a.count || a.label.localeCompare(b.label, "ja"));
}

function courseSummaries() {
  return Object.fromEntries([60, 70, 80].map((score) => {
    const eligible = content.questions.filter((question) => question.minimumCourse <= score);
    const exact = content.questions.filter((question) => question.minimumCourse === score);
    return [score, {
      total: eligible.length,
      addedAtCourse: exact.length,
      subjects: Object.fromEntries(content.subjects.map((subject) => [subject.id, eligible.filter((question) => question.subject === subject.id).length])),
      addedSubjects: Object.fromEntries(content.subjects.map((subject) => [subject.id, exact.filter((question) => question.subject === subject.id).length]))
    }];
  }));
}

function publicOfficialExam() {
  return {
    ...officialExam,
    subjects: Object.fromEntries(Object.entries(officialExam.subjects).map(([id, subject]) => [id, {
      ...subject,
      answers: undefined,
      answerSlots: subject.answers.map(({ id: answerId, number, subquestion, points }) => ({ id: answerId, number, subquestion, points }))
    }]))
  };
}

function publicContent() {
  const foundationQuestions = content.questions.filter((question) => question.minimumCourse === 60);
  return {
    exam: content.exam,
    baselineScores: content.baselineScores,
    foundationCheckpoints: content.foundationCheckpoints,
    foundationQuestionCheckpoints: Object.fromEntries(foundationQuestions.map((question) => [question.id, question.foundationCheckpoint])),
    foundationCheckpointCounts: Object.fromEntries(content.foundationCheckpoints.map((checkpoint) => {
      const matches = foundationQuestions.filter((question) => question.foundationCheckpoint === checkpoint.id);
      return [checkpoint.id, {
        total: matches.length,
        subjects: Object.fromEntries(content.subjects.map((subject) => [subject.id, matches.filter((question) => question.subject === subject.id).length]))
      }];
    })),
    financeTrack: content.financeTrack,
    subjects: content.subjects.map((subject) => ({
      ...subject,
      sourceFile: undefined,
      taxonomyFile: undefined,
      studyPlanFile: undefined,
      questionCount: content.questions.filter((question) => question.subject === subject.id).length
    })),
    learningPhases: content.learningPhases,
    courseCounts: courseSummaries(),
    topics: topicSummaries(),
    studyPlans,
    officialExam: publicOfficialExam(),
    officialAnalysis,
    questionQuality: {
      reviewedAt: qualityReview.reviewedAt,
      scope: qualityReview.scope,
      bankTotal: questionBank.length,
      availableTotal: content.questions.length,
      quarantinedQuestionIds: questionBank.filter((question) => question.qualityStatus === "quarantined").map((question) => question.id),
      questions: Object.fromEntries(questionBank.map((question) => [question.id, {
        ...questionQuality(question.id),
        subject: question.subject,
        topicId: question.topicId,
        topic: question.topic,
        minimumCourse: question.minimumCourse,
        foundationCheckpoint: question.foundationCheckpoint || null,
        difficulty: question.difficulty
      }]))
    },
    totals: {
      questions: content.questions.length,
      subjects: content.subjects.length,
      topics: new Set(content.questions.map((question) => question.topicId)).size
    }
  };
}

module.exports = {
  content,
  questionBank,
  officialExam,
  publicContent,
  publicQuestion,
  queryQuestions,
  questionsById,
  validateContent
};
