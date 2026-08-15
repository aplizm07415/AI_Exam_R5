const fs = require("node:fs");
const path = require("node:path");

const rawConfig = require("../content/exam.json");
const questionIndex = require("../content/question-index.json");
const studyPlans = require("../content/analysis/study-plans.json");
const officialExam = require("../content/official/r8.json");
const officialAnalysis = require("../content/official/r8-analysis.json");

const contentRoot = path.resolve(__dirname, "..", "content");
const SUPPORTED_TYPES = new Set(["single_choice", "multiple_choice", "numeric", "text"]);

function stripComplexMarker(value) {
  return String(value || "").replace(/^\s*※複雑\s*/, "").trim();
}

function normalizeChoiceText(choice) {
  const label = String(choice.label || "").trim();
  const text = String(choice.text || "").trim();
  return text.replace(new RegExp(`^${label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}[\\s　:：.．、-]*`), "").trim() || text;
}

function normalizeQuestion(subject, rawQuestion) {
  const id = `${subject.id}:${rawQuestion.id}`;
  const metadata = questionIndex.questions[id];
  if (!metadata) throw new Error(`問題インデックスがありません: ${id}`);
  const prompt = stripComplexMarker(rawQuestion.question_text);
  const calculationRequired = subject.id === "finance" && /(計算|算出|求め|金額|利益率|原価|NPV|現在価値|損益分岐|回転率|標準偏差|万円|円|%)/.test(prompt);
  return {
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
    options: rawQuestion.choices.map((choice) => ({ id: String(choice.label), label: normalizeChoiceText(choice) })),
    answer: String(rawQuestion.answer),
    points: 1,
    calculationRequired,
    explanation: typeof rawQuestion.explanation === "object" ? rawQuestion.explanation?.text || "" : rawQuestion.explanation || ""
  };
}

function loadQuestions() {
  return rawConfig.subjects.flatMap((subject) => {
    const sourcePath = path.join(contentRoot, "source", subject.sourceFile);
    const questions = JSON.parse(fs.readFileSync(sourcePath, "utf8"));
    return questions.map((question) => normalizeQuestion(subject, question));
  });
}

function validateContent(value) {
  if (!value.exam?.id || !/^[a-z0-9][a-z0-9_-]*$/.test(value.exam.id)) {
    throw new Error("exam.id は半角英数字・ハイフン・アンダースコアで指定してください");
  }
  if (!value.exam.name || !Array.isArray(value.subjects) || !Array.isArray(value.questions)) {
    throw new Error("exam.name、subjects、questions は必須です");
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
    questionIds.add(question.id);
  }
  return value;
}

const content = validateContent({ ...rawConfig, questions: loadQuestions() });
const questionsById = new Map(content.questions.map((question) => [question.id, question]));

function publicQuestion(question) {
  const { answer, aliases, tolerance, explanation, ...visible } = question;
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
    ));
    matches = shuffled(matches, params.seed);
  }
  const limit = Math.max(1, Math.min(100, Number(params.limit) || 20));
  return { total: matches.length, questions: matches.slice(0, limit).map(publicQuestion) };
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
      minimumCourse: question.minimumCourse
    };
    current.count += 1;
    current.minimumCourse = Math.min(current.minimumCourse, question.minimumCourse);
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
  return {
    exam: content.exam,
    baselineScores: content.baselineScores,
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
    totals: {
      questions: content.questions.length,
      subjects: content.subjects.length,
      topics: new Set(content.questions.map((question) => question.topicId)).size
    }
  };
}

module.exports = {
  content,
  officialExam,
  publicContent,
  publicQuestion,
  queryQuestions,
  questionsById,
  validateContent
};
