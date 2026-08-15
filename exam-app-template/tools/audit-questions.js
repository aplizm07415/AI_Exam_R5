const { content } = require("../src/content");

function normalizedText(value) {
  return String(value ?? "").normalize("NFKC").replace(/\s+/g, " ").trim();
}

function issue(id, detail = "") {
  return { id, detail };
}

function auditQuestions(questions) {
  const report = {
    total: questions.length,
    emptyExplanations: [],
    missingCorrectOptions: [],
    duplicateOptionTexts: [],
    replacementCharacters: [],
    mojibakeCandidates: [],
    serializedExplanationCandidates: [],
    longExplanations: [],
    exactDuplicatePrompts: [],
    datedQuestions: [],
    calculationBySubject: {}
  };
  const prompts = new Map();

  for (const question of questions) {
    const explanation = String(question.explanation || "");
    const optionIds = new Set(question.options.map((option) => String(option.id)));
    const optionTexts = question.options.map((option) => normalizedText(option.label));
    const combined = [question.prompt, ...question.options.map((option) => option.label), explanation].join("\n");
    if (!explanation.trim()) report.emptyExplanations.push(issue(question.id));
    if (!optionIds.has(String(question.answer))) report.missingCorrectOptions.push(issue(question.id, String(question.answer)));
    if (optionTexts.length !== new Set(optionTexts).size) report.duplicateOptionTexts.push(issue(question.id));
    if (combined.includes("�")) report.replacementCharacters.push(issue(question.id));
    if (/(?:縺|蜿|譁|繧|謗|驟|鬆){2,}|\?{4,}/.test(combined)) report.mojibakeCandidates.push(issue(question.id));
    if (/^\s*[\[{]\s*['"]?(?:summary|steps|conclusion|title|description)['"]?\s*:/i.test(explanation)) report.serializedExplanationCandidates.push(issue(question.id));
    if (explanation.length >= 1200) report.longExplanations.push(issue(question.id, `${explanation.length}字`));
    if (/\b(?:19|20)\d{2}年|令和\s*\d+年度|平成\s*\d+年度/.test(combined)) report.datedQuestions.push(issue(question.id));
    if (question.calculationRequired) report.calculationBySubject[question.subject] = (report.calculationBySubject[question.subject] || 0) + 1;

    const promptKey = normalizedText(question.prompt);
    if (promptKey) {
      const ids = prompts.get(promptKey) || [];
      ids.push(question.id);
      prompts.set(promptKey, ids);
    }
  }

  report.exactDuplicatePrompts = [...prompts.values()].filter((ids) => ids.length > 1).map((ids) => ({ ids }));
  return report;
}

function markdown(report) {
  const row = (label, value) => `| ${label} | ${value.toLocaleString()} |`;
  return [
    "# 問題データ構造監査",
    "",
    `対象：${report.total.toLocaleString()}問`,
    "",
    "| 検査 | 件数 |",
    "|---|---:|",
    row("解説が空", report.emptyExplanations.length),
    row("正答IDが選択肢にない", report.missingCorrectOptions.length),
    row("選択肢本文が重複", report.duplicateOptionTexts.length),
    row("Unicode置換文字", report.replacementCharacters.length),
    row("文字化け候補", report.mojibakeCandidates.length),
    row("辞書・配列を文字列化した解説候補", report.serializedExplanationCandidates.length),
    row("1,200字以上の解説（編集優先度のみ）", report.longExplanations.length),
    row("同一問題文グループ", report.exactDuplicatePrompts.length),
    row("年・年度を含む更新確認対象", report.datedQuestions.length),
    "",
    `計算フラグ：${Object.entries(report.calculationBySubject).map(([subject, count]) => `${subject} ${count}問`).join(" / ") || "0問"}`
  ].join("\n");
}

if (require.main === module) {
  const report = auditQuestions(content.questions);
  process.stdout.write(process.argv.includes("--markdown") ? `${markdown(report)}\n` : `${JSON.stringify(report, null, 2)}\n`);
}

module.exports = { auditQuestions, markdown };
