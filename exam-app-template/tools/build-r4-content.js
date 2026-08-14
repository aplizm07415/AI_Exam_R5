const fs = require("node:fs");
const path = require("node:path");

const appRoot = path.resolve(__dirname, "..");
const repoRoot = path.resolve(appRoot, "..");
const contentRoot = path.join(appRoot, "content");
const analysisRoot = path.join(contentRoot, "analysis");
const officialRoot = path.join(contentRoot, "official");
const pdfTextRoot = path.join(repoRoot, "tmp", "pdfs", "r8");
const config = JSON.parse(fs.readFileSync(path.join(contentRoot, "exam.json"), "utf8"));

fs.mkdirSync(analysisRoot, { recursive: true });
fs.mkdirSync(officialRoot, { recursive: true });

function normalize(value) {
  return String(value ?? "").normalize("NFKC").toLocaleLowerCase("ja").replace(/\s+/g, " ");
}

function termsFor(topic) {
  const weighted = [
    [topic.display_name, 14],
    ...(topic.aliases || []).map((term) => [term, 9]),
    ...(topic.keywords || []).map((term) => [term, 4])
  ];
  const seen = new Set();
  return weighted.filter(([term]) => {
    const key = normalize(term);
    if (key.length < 2 || seen.has(key)) return false;
    seen.add(key);
    return true;
  }).map(([term, weight]) => [normalize(term), weight]);
}

function createClassifier(taxonomy) {
  const topics = taxonomy.topics.map((topic) => ({ ...topic, terms: termsFor(topic) }));
  return (value, category = "") => {
    const text = normalize(value);
    const categoryText = normalize(category);
    let best = null;
    for (const topic of topics) {
      let score = 0;
      for (const [term, weight] of topic.terms) {
        if (text.includes(term)) score += weight + Math.min(6, Math.floor(term.length / 3));
        if (categoryText && categoryText.includes(term)) score += weight * 2;
      }
      if (!best || score > best.score) best = { topic, score };
    }
    return best && best.score > 0 ? best : null;
  };
}

function percentile(values, ratio) {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.round((sorted.length - 1) * ratio)] || 0;
}

function difficultyThresholds(questions) {
  const prompts = questions.map((question) => String(question.question_text || "").length);
  const explanations = questions.map((question) => String(typeof question.explanation === "object" ? question.explanation?.text || "" : question.explanation || "").length);
  return {
    promptStandard: percentile(prompts, 0.55),
    promptAdvanced: percentile(prompts, 0.88),
    explanationStandard: percentile(explanations, 0.62),
    explanationAdvanced: percentile(explanations, 0.92)
  };
}

function difficultyFor(question, thresholds) {
  const prompt = String(question.question_text || "");
  const explanation = typeof question.explanation === "object" ? question.explanation?.text || "" : question.explanation || "";
  if (/^\s*※複雑/.test(prompt) || prompt.length > thresholds.promptAdvanced || explanation.length > thresholds.explanationAdvanced) return "発展";
  if (prompt.length > thresholds.promptStandard || explanation.length > thresholds.explanationStandard || (question.choices || []).length >= 5) return "標準";
  return "基礎";
}

function priorityFor(topic) {
  const tags = new Set(topic?.tags || []);
  if (tags.has("core")) return "must";
  if (tags.has("standard") || tags.has("legacy")) return "standard";
  if (tags.has("trending") || tags.has("emerging")) return "stretch";
  return "stretch";
}

function minimumCourse(priority, difficulty) {
  let course = priority === "must" ? 60 : priority === "standard" ? 70 : 80;
  if (difficulty === "発展") course = Math.max(course, 80);
  return course;
}

function parseStudyPlan(markdown) {
  const courses = [];
  let course = null;
  let group = null;
  for (const rawLine of markdown.split(/\r?\n/)) {
    const line = rawLine.trimEnd();
    const courseMatch = line.match(/^##\s*(60|70|80)点/);
    if (courseMatch) {
      course = { targetScore: Number(courseMatch[1]), title: line.replace(/^##\s*/, ""), groups: [] };
      courses.push(course);
      group = null;
      continue;
    }
    if (!course) continue;
    const groupMatch = line.match(/^###\s+(.+)/);
    if (groupMatch) {
      group = { title: groupMatch[1], items: [] };
      course.groups.push(group);
      continue;
    }
    const itemMatch = line.match(/^(\s*)-\s*\[\s*\]\s*(.+)/);
    if (itemMatch) {
      if (!group) {
        group = { title: "重点論点", items: [] };
        course.groups.push(group);
      }
      group.items.push({
        text: itemMatch[2].replace(/\*\*/g, ""),
        depth: Math.floor(itemMatch[1].length / 2)
      });
    }
  }
  return { courses };
}

function questionText(question) {
  const explanation = typeof question.explanation === "object" ? question.explanation?.text : question.explanation;
  return [
    question.question_text,
    ...(question.choices || []).map((choice) => choice.text),
    question.category,
    explanation
  ].filter(Boolean).join("\n");
}

function splitOfficialQuestions(text) {
  const normalized = String(text).normalize("NFKC");
  const matches = [...normalized.matchAll(/第\s*(\d+)\s*問/g)];
  return matches.map((match, index) => {
    const start = match.index + match[0].length;
    const end = matches[index + 1]?.index ?? normalized.length;
    const body = normalized.slice(start, end).replace(/\s+/g, " ").trim();
    return { number: Number(match[1]), excerpt: body.slice(0, 180) };
  });
}

const questionIndex = {
  version: 1,
  generatedAt: new Date().toISOString(),
  questions: {}
};
const studyPlans = { version: 1, subjects: {} };
const officialAnalysisPath = path.join(officialRoot, "r8-analysis.json");
const officialAnalysis = fs.existsSync(officialAnalysisPath)
  ? JSON.parse(fs.readFileSync(officialAnalysisPath, "utf8"))
  : { version: 1, year: 2026, subjects: {} };

for (const subject of config.subjects) {
  const taxonomySource = path.join(repoRoot, subject.taxonomyFile);
  const planSource = path.join(repoRoot, subject.studyPlanFile);
  const taxonomyTarget = path.join(analysisRoot, subject.taxonomyFile);
  const planTarget = path.join(analysisRoot, subject.studyPlanFile);
  fs.copyFileSync(taxonomySource, taxonomyTarget);
  fs.copyFileSync(planSource, planTarget);

  const taxonomy = JSON.parse(fs.readFileSync(taxonomySource, "utf8"));
  const planMarkdown = fs.readFileSync(planSource, "utf8");
  const questions = JSON.parse(fs.readFileSync(path.join(contentRoot, "source", subject.sourceFile), "utf8"));
  const classify = createClassifier(taxonomy);
  const thresholds = difficultyThresholds(questions);
  const counts = { 基礎: 0, 標準: 0, 発展: 0, unmapped: 0 };

  for (const question of questions) {
    const id = `${subject.id}:${question.id}`;
    const match = classify(questionText(question), question.category);
    const difficulty = difficultyFor(question, thresholds);
    const priority = priorityFor(match?.topic);
    counts[difficulty] += 1;
    if (!match) counts.unmapped += 1;
    questionIndex.questions[id] = {
      originalId: question.id,
      topicId: match?.topic.topic_id || `${subject.id}:unclassified`,
      topic: match?.topic.display_name || "未分類",
      parent: match?.topic.parent_id || "未分類",
      tags: match?.topic.tags || [],
      priority,
      difficulty,
      minimumCourse: minimumCourse(priority, difficulty)
    };
  }

  const structuredPlan = parseStudyPlan(planMarkdown);
  for (const course of structuredPlan.courses) {
    for (const group of course.groups) {
      for (const item of group.items) {
        const match = classify(item.text, group.title);
        item.topicId = match?.topic.topic_id || null;
        item.topic = match?.topic.display_name || null;
      }
    }
  }
  studyPlans.subjects[subject.id] = {
    subject: subject.label,
    ...structuredPlan
  };

  const pdfText = path.join(pdfTextRoot, `${subject.officialCode}1JC2026.txt`);
  if (fs.existsSync(pdfText)) {
    const officialQuestions = splitOfficialQuestions(fs.readFileSync(pdfText, "utf8"));
    const topicCounts = new Map();
    const classified = officialQuestions.map((question) => {
      const match = classify(question.excerpt);
      const topic = match?.topic.display_name || "未分類";
      topicCounts.set(topic, (topicCounts.get(topic) || 0) + 1);
      return { ...question, topic, topicId: match?.topic.topic_id || `${subject.id}:unclassified` };
    });
    officialAnalysis.subjects[subject.id] = {
      questions: classified,
      topTopics: [...topicCounts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8).map(([topic, count]) => ({ topic, count }))
    };
  }

  console.log(`${subject.label}: ${questions.length}問`, counts);
}

fs.writeFileSync(path.join(contentRoot, "question-index.json"), `${JSON.stringify(questionIndex, null, 2)}\n`);
fs.writeFileSync(path.join(analysisRoot, "study-plans.json"), `${JSON.stringify(studyPlans, null, 2)}\n`);
fs.writeFileSync(officialAnalysisPath, `${JSON.stringify(officialAnalysis, null, 2)}\n`);
