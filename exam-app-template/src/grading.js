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
    correct,
    score: correct ? Number(question.points) : 0,
    maxScore: Number(question.points),
    normalizedAnswer,
    correctAnswer: question.answer,
    explanation: question.explanation || ""
  };
}

module.exports = { gradeQuestion, normalizeNumber, normalizeText };
