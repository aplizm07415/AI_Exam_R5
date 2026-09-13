const { content, questionBank } = require("../src/content");
const { normalizeStudyText } = require("../src/question-quality");

const CONTENT_WARNING = /AIにより不確実|AIによる(?:注意|分析|注記|補足)|問題(?:設定|文|自体)?[^。！？\n]{0,45}(?:不整合|不備|曖昧)|出題ミス|公式(?:の)?(?:正答|解答)[^。！？\n]{0,100}(?:矛盾|異な|不可能)|選択肢に(?:は)?(?:存在しない|ない|ありません)|この通りの選択肢は存在しません|も正しい記述|どちらも正しい|複数(?:の)?(?:正解|解答)/u;
const QUALITY_STATUSES = new Set(["unreviewed", "corrected", "verified", "quarantined"]);
const MATERIAL_OMISSION = /(?:図|表|資料|データ)[^。\n]{0,30}(?:省略|欠落|プレースホルダー)|(?:省略|欠落)[^。\n]{0,25}(?:図|表|資料|データ)/u;
const MATERIAL_ASSUMPTION = /(?:欠落してい(?:た|る)|省略されてい(?:ます|る))[^。\n]{0,35}(?:図|表|データ)|(?:図(?!る)|表|データ)[^。\n]{0,30}(?:補完|一般的な[^。\n]{0,20}想定)/u;

function normalizedText(value) {
  return normalizeStudyText(value).replace(/\s+/g, " ").trim();
}

function issue(id, detail = "") {
  return { id, detail };
}

function auditQuestions(questions, { availableQuestions } = {}) {
  const report = {
    scope: "全対象の機械的構造検査。内容の専門的正確性・正答の一意性・図表の充足を全問保証するものではありません。内容検証は品質台帳に記載した重点点検の範囲です。",
    total: questions.length,
    availableTotal: availableQuestions?.length ?? questions.filter((question) => question.qualityStatus !== "quarantined").length,
    qualityStatusCounts: { unreviewed: 0, corrected: 0, verified: 0, quarantined: 0 },
    quarantinedQuestions: [],
    quarantinedAvailableQuestions: [],
    invalidQualityMetadata: [],
    missingSourceReferences: [],
    missingMaterialCandidates: [],
    assumedMaterialCandidates: [],
    explanationLossCandidates: [],
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
    const originalExplanation = String(question.originalExplanation ?? explanation);
    const qualityStatus = question.qualityStatus || "unreviewed";
    if (QUALITY_STATUSES.has(qualityStatus)) report.qualityStatusCounts[qualityStatus] += 1;
    if (!QUALITY_STATUSES.has(qualityStatus)
      || (question.contentVersion !== undefined && (!Number.isInteger(question.contentVersion) || question.contentVersion < 1))
      || (qualityStatus !== "unreviewed" && !/^\d{4}-\d{2}-\d{2}$/.test(question.reviewedAt || ""))) {
      report.invalidQualityMetadata.push(issue(question.id, "品質状態・教材版・確認日の形式を確認"));
    }
    if (qualityStatus === "quarantined") report.quarantinedQuestions.push(issue(question.id));
    if (!question.sourceReference?.url || !question.sourceReference?.checkedAt) {
      report.missingSourceReferences.push(issue(question.id, "構造化した出典URL・確認日が未登録（本文内の出典の有無とは別）"));
    }
    // A reference without a machine-recognizable attachment or replacement is
    // only a review candidate. Prose can supply enough information to answer.
    const prompt = String(question.prompt || "");
    const hasMaterial = question.images?.length || question.attachments?.length || question.figures?.length
      || /\|[^\n]+\||図の説明|画像[：:]|【(?:資料|条件|表|データ)/u.test(prompt);
    if (MATERIAL_OMISSION.test(prompt) || (/(?:下図|下表|(?:以下|次)の(?:図|表)|図中)/u.test(prompt) && !hasMaterial)) {
      report.missingMaterialCandidates.push(issue(question.id, MATERIAL_OMISSION.test(prompt)
        ? "図表等の省略・欠落への言及あり。省略した範囲が解答に必要か、本文と原資料を要確認"
        : "図表参照あり。添付・構造化表・明示された代替説明を検出できないため、本文と原資料を要確認"));
    }
    const assumption = originalExplanation.match(MATERIAL_ASSUMPTION);
    if (assumption) report.assumedMaterialCandidates.push(issue(question.id, `元解説の資料補完・想定を要確認: ${assumption[0]}`));
    if (originalExplanation.length >= 80 && explanation.length < originalExplanation.length * 0.6) {
      report.explanationLossCandidates.push(issue(question.id, `元解説${originalExplanation.length}字 → 表示${explanation.length}字。理由・条件の欠落は要確認`));
    }
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
    // Read both effective source and displayed explanation: deleting a warning
    // during formatting must never make a content problem disappear from audit.
    const sourceWarning = originalExplanation.match(CONTENT_WARNING);
    const displayedWarning = explanation.match(CONTENT_WARNING);
    if (sourceWarning || displayedWarning) report.unresolvedContentWarnings.push(issue(question.id, `${sourceWarning ? "元解説" : "表示解説"}: ${(sourceWarning || displayedWarning)[0]}`));
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
  const quarantinedIds = new Set(report.quarantinedQuestions.map((item) => item.id));
  report.quarantinedAvailableQuestions = (availableQuestions || []).filter((question) => quarantinedIds.has(question.id) || question.qualityStatus === "quarantined").map((question) => issue(question.id));
  return report;
}

function markdown(report) {
  const row = (label, value) => `| ${label} | ${value.toLocaleString()} |`;
  return [
    "# 問題データ構造監査",
    "",
    `機械検査対象：${report.total.toLocaleString()}問 / 出題対象：${report.availableTotal.toLocaleString()}問 / 隔離：${report.quarantinedQuestions.length.toLocaleString()}問`,
    "",
    report.scope,
    "",
    `品質台帳：未点検 ${report.qualityStatusCounts.unreviewed.toLocaleString()}問 / 重点訂正 ${report.qualityStatusCounts.corrected.toLocaleString()}問 / 検証済み ${report.qualityStatusCounts.verified.toLocaleString()}問 / 隔離 ${report.qualityStatusCounts.quarantined.toLocaleString()}問。体裁の候補件数は合否判定に使わず、根拠を削ってゼロにしないでください。`,
    "",
    "| 検査 | 件数 |",
    "|---|---:|",
    row("解説が空", report.emptyExplanations.length),
    row("正答IDが選択肢にない", report.missingCorrectOptions.length),
    row("選択肢本文が重複", report.duplicateOptionTexts.length),
    row("Unicode置換文字", report.replacementCharacters.length),
    row("文字化け候補", report.mojibakeCandidates.length),
    row("辞書・配列を文字列化した解説候補", report.serializedExplanationCandidates.length),
    row("品質メタデータの形式不正", report.invalidQualityMetadata.length),
    row("隔離問題が出題対象へ混入", report.quarantinedAvailableQuestions.length),
    row("構造化出典・確認日が未登録（本文内の出典とは別）", report.missingSourceReferences.length),
    row("図表の充足を要確認（欠落の確定件数ではない）", report.missingMaterialCandidates.length),
    row("元解説による図表の補完・想定を要確認", report.assumedMaterialCandidates.length),
    row("解説の大幅短縮を要確認", report.explanationLossCandidates.length),
    row("未解決・不確実記述の点検候補（元解説も検査）", report.unresolvedContentWarnings.length),
    row("まず・次に・最後にが揃わない（体裁のみ）", report.missingThoughtFlow.length),
    row("正答に言及する解説（体裁候補のみ）", report.directAnswerSummaries.length),
    row("正答候補に言及する結び（体裁候補のみ）", report.answerConclusionRecaps.length),
    row("選択肢の正誤ラベル（体裁のみ）", report.explicitOptionJudgments.length),
    row("区切り見出し（体裁のみ）", report.explanationSectionLabels.length),
    row("独立した注意喚起（体裁のみ）", report.standaloneCautions.length),
    row("1,200字以上の解説（編集優先度のみ）", report.longExplanations.length),
    row("問題文・選択肢・正答が完全一致", report.exactDuplicateQuestions.length),
    row("問題文が同じ類題グループ", report.samePromptGroups.length),
    row("年・年度を含む更新確認対象", report.datedQuestions.length),
    "",
    `計算フラグ：${Object.entries(report.calculationBySubject).map(([subject, count]) => `${subject} ${count}問`).join(" / ") || "0問"}`
  ].join("\n");
}

if (require.main === module) {
  const report = auditQuestions(questionBank, { availableQuestions: content.questions });
  process.stdout.write(process.argv.includes("--markdown") ? `${markdown(report)}\n` : `${JSON.stringify(report, null, 2)}\n`);
}

module.exports = { auditQuestions, markdown };
