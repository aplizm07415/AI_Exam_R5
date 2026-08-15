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
    missingThoughtFlow: [],
    directAnswerSummaries: [],
    answerConclusionRecaps: [],
    explicitOptionJudgments: [],
    standaloneCautions: [],
    explanationSectionLabels: [],
    unresolvedContentWarnings: [],
    longExplanations: [],
    samePromptGroups: [],
    exactDuplicateQuestions: [],
    datedQuestions: [],
    calculationBySubject: {}
  };
  const prompts = new Map();
  const signatures = new Map();

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
    if (!/^まず、/.test(explanation) || !/^次に、/m.test(explanation) || !/^最後に、/m.test(explanation)) report.missingThoughtFlow.push(issue(question.id));
    if (/(?:正解|正答)(?!率)/u.test(explanation)) report.directAnswerSummaries.push(issue(question.id));
    if (/(?:最も適切|最も不適切)|(?:以上(?:[^。\n]{0,40})(?:から|より)|以上のことから)[^。\n]{0,240}(?:正しい|誤り)/u.test(explanation)) report.answerConclusionRecaps.push(issue(question.id));
    if (/(?:^|[\n。！？])\s*(?:選択肢\s*)?[ア-オA-E](?:\([^)]*\))?\s*(?:[：:]\s*|\(\s*)(?:適切|不適切|正しい|誤り)/mu.test(explanation)) report.explicitOptionJudgments.push(issue(question.id));
    if (/(?:^|[\n。！？])\s*(?:#+\s*)?(?:\d+[.)、]\s*)?(?:結論|解法|判断の軸|各?選択肢の根拠|難易度|注意点|ミスしやすい点|考え方のポイント|知識のポイント|各選択肢の検討|選択肢の検討|各選択肢の評価|選択肢の評価|各選択肢の分析|選択肢の分析|解説|思考プロセス|自分で再確認|ファクトチェック|参考|補足|検算)\s*[：:]?/mu.test(explanation)) report.explanationSectionLabels.push(issue(question.id));
    if (/注意(?:が必要|してください|しましょう)|注意点/u.test(explanation)) report.standaloneCautions.push(issue(question.id));
    if (/AIにより不確実|AIによる(?:注意|分析|注記|補足)|問題設定.{0,30}(?:不整合|不備|誤り)|出題ミス|公式(?:の)?(?:正答|解答).{0,100}(?:矛盾|異な|不可能)|選択肢に(?:は)?(?:存在しない|ない|ありません)/s.test(explanation)) report.unresolvedContentWarnings.push(issue(question.id));
    if (explanation.length >= 1200) report.longExplanations.push(issue(question.id, `${explanation.length}字`));
    if (/\b(?:19|20)\d{2}年|令和\s*\d+年度|平成\s*\d+年度/.test(combined)) report.datedQuestions.push(issue(question.id));
    if (question.calculationRequired) report.calculationBySubject[question.subject] = (report.calculationBySubject[question.subject] || 0) + 1;

    const promptKey = normalizedText(question.prompt);
    if (promptKey) {
      const ids = prompts.get(promptKey) || [];
      ids.push(question.id);
      prompts.set(promptKey, ids);
    }
    const signature = JSON.stringify([promptKey, optionTexts, String(question.answer)]);
    const signatureIds = signatures.get(signature) || [];
    signatureIds.push(question.id);
    signatures.set(signature, signatureIds);
  }

  report.samePromptGroups = [...prompts.values()].filter((ids) => ids.length > 1).map((ids) => ({ ids }));
  report.exactDuplicateQuestions = [...signatures.values()].filter((ids) => ids.length > 1).map((ids) => ({ ids }));
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
    row("思考順序が不足", report.missingThoughtFlow.length),
    row("正答を再掲した解説", report.directAnswerSummaries.length),
    row("正答に当たる選択肢を末尾で再掲", report.answerConclusionRecaps.length),
    row("選択肢へ正誤ラベルを明記", report.explicitOptionJudgments.length),
    row("不要な区切り見出し", report.explanationSectionLabels.length),
    row("独立した注意喚起", report.standaloneCautions.length),
    row("未解決・不確実の警告が残る問題", report.unresolvedContentWarnings.length),
    row("1,200字以上の解説（編集優先度のみ）", report.longExplanations.length),
    row("問題文・選択肢・正答が完全一致", report.exactDuplicateQuestions.length),
    row("問題文が同じ類題グループ", report.samePromptGroups.length),
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
