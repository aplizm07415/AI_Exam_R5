function normalizeText(value) {
  return String(value ?? "").normalize("NFKC").trim().replace(/\s+/g, " ").toLocaleLowerCase("ja");
}

function normalizeNumber(value) {
  const normalized = String(value ?? "")
    .normalize("NFKC")
    .replace(/[，,￥¥%円\s]/g, "")
    .replace(/[－−]/g, "-");
  return normalized !== "" && Number.isFinite(Number(normalized)) ? Number(normalized) : null;
}

function gradeQuestion(question, submitted) {
  let normalizedAnswer = submitted;
  let correct = false;

  if (question.type === "single_choice") {
    normalizedAnswer = String(submitted ?? "");
    correct = normalizedAnswer === String(question.answer);
  } else if (question.type === "multiple_choice") {
    normalizedAnswer = [...new Set(Array.isArray(submitted) ? submitted.map(String) : [])].sort();
    const expected = [...question.answer.map(String)].sort();
    correct = normalizedAnswer.length === expected.length && normalizedAnswer.every((value, index) => value === expected[index]);
  } else if (question.type === "numeric") {
    normalizedAnswer = normalizeNumber(submitted);
    const tolerance = Number(question.tolerance || 0);
    correct = normalizedAnswer !== null && Math.abs(normalizedAnswer - Number(question.answer)) <= tolerance;
  } else if (question.type === "text") {
    normalizedAnswer = normalizeText(submitted);
    const accepted = [question.answer, ...(question.aliases || [])].map(normalizeText);
    correct = accepted.includes(normalizedAnswer);
  }

  return {
    questionId: question.id,
    subject: question.subject,
    topic: question.topic,
    topicId: question.topicId,
    difficulty: question.difficulty,
    minimumCourse: question.minimumCourse,
    foundationCheckpoint: question.foundationCheckpoint || null,
    correct,
    score: correct ? Number(question.points) : 0,
    maxScore: Number(question.points),
    normalizedAnswer,
    correctAnswer: question.answer,
    correctAnswerText: question.options?.find((option) => String(option.id) === String(question.answer))?.label || String(question.answer),
    explanation: question.explanation || "",
    originalExplanation: question.originalExplanation || question.explanation || ""
  };
}

function gradeOfficialExam(officialExam, subjectId, submitted = {}) {
  const subject = officialExam.subjects[subjectId];
  if (!subject) return null;
  const details = subject.answers.map((item) => {
    const answer = String(submitted[item.id] || "");
    const correct = answer === item.answer;
    return { ...item, submitted: answer, correct, earned: correct ? item.points : 0 };
  });
  return {
    subjectId,
    score: details.reduce((sum, item) => sum + item.earned, 0),
    maxScore: subject.totalPoints,
    correct: details.filter((item) => item.correct).length,
    total: details.length,
    details
  };
}

module.exports = { gradeQuestion, gradeOfficialExam, normalizeNumber, normalizeText };
