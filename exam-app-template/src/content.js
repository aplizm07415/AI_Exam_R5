const rawContent = require("../content/exam.json");

const SUPPORTED_TYPES = new Set(["single_choice", "multiple_choice", "numeric", "text"]);

function validateContent(content = rawContent) {
  if (!content.exam?.id || !/^[a-z0-9][a-z0-9_-]*$/.test(content.exam.id)) {
    throw new Error("exam.id は半角英数字・ハイフン・アンダースコアで指定してください");
  }
  if (!content.exam.name || !Array.isArray(content.subjects) || !Array.isArray(content.questions)) {
    throw new Error("exam.name、subjects、questions は必須です");
  }
  const subjectIds = new Set(content.subjects.map((subject) => subject.id));
  const questionIds = new Set();
  for (const question of content.questions) {
    if (!question.id || questionIds.has(question.id)) throw new Error(`問題IDが未設定または重複しています: ${question.id || "(空)"}`);
    if (!subjectIds.has(question.subject)) throw new Error(`問題 ${question.id} の科目 ${question.subject} がsubjectsにありません`);
    if (!SUPPORTED_TYPES.has(question.type)) throw new Error(`問題 ${question.id} のtypeは未対応です: ${question.type}`);
    if (question.answer === undefined || !Number.isFinite(Number(question.points)) || Number(question.points) <= 0) {
      throw new Error(`問題 ${question.id} のanswerまたはpointsが不正です`);
    }
    questionIds.add(question.id);
  }
  return content;
}

const content = validateContent();

function publicQuestion(question) {
  const { answer, aliases, tolerance, explanation, ...visible } = question;
  return visible;
}

function publicContent() {
  return {
    exam: content.exam,
    subjects: content.subjects,
    questions: content.questions.map(publicQuestion),
    totals: {
      questions: content.questions.length,
      points: content.questions.reduce((sum, question) => sum + Number(question.points), 0)
    }
  };
}

module.exports = { content, publicContent, publicQuestion, validateContent };
