const { normalizeStudyText } = require("./question-quality");

const SECTION_NAMES = "結論|解法|判断の軸|各?選択肢の根拠|難易度|注意点|ミスしやすい点|考え方のポイント|知識のポイント|各選択肢の検討|選択肢の検討|各選択肢の評価|選択肢の評価|各選択肢の分析|選択肢の分析|解説|思考プロセス|自分で再確認|ファクトチェック|参考|補足|検算";
const SECTION_LABELS = new RegExp(`^(?:#+\\s*)?(?:\\d+[.)、]\\s*)?(?:${SECTION_NAMES})\\s*[：:]?\\s*$`, "u");

function withoutSectionLabels(value) {
  // A heading containing conditions is content. Only an empty heading is noise.
  return String(value).replace(
    new RegExp(`[【\\[]\\s*(${SECTION_NAMES})\\s*(?:[：:]([^】\\]\\n]*))?\\s*[】\\]]`, "gu"),
    (_, title, body) => body?.trim() ? `\n${title}：${body.trim()}\n` : "\n"
  );
}

function withoutExplicitJudgments(value) {
  // Remove labels, not the sentence that explains the answer. In particular,
  // "…という条項です（Bが正解）" must retain the definition before the label.
  return String(value)
    .replace(/[（(]\s*(?:選択肢\s*)?[ア-オA-E](?:\s*[・、,]\s*[ア-オA-E])*\s*(?:が|は)?\s*(?:正解|正答)(?:です|である)?\s*[）)]/gu, "")
    .replace(/([【\[])(?:正解|正答)([】\]])/gu, "");
}

function withoutAnswerSummary(value) {
  // Only a complete standalone answer recap may be removed. A sentence with
  // a calculation, definition, condition, or uncertainty must survive.
  return withoutExplicitJudgments(value)
    .replace(/(^|[。！？\n])\s*(?:(?:以上(?:の検討|の計算)?(?:から|より)|以上のことから|したがって|よって)[、,]?\s*)?(?:(?:正解|正答)\s*(?:は|[：:])\s*(?:選択肢\s*)?[「『]?[ア-オA-E][」』]?|(?:選択肢\s*)?[「『]?[ア-オA-E][」』]?\s*(?:が|は|[：:])\s*(?:正解|正答))(?:です|である|となります|となる)?\s*(?=[。！？\n]|$)/gu, "$1")
    .replace(/(^|[。！？\n])\s*(?:これ|以上)が(?:本問の)?(?:正解|正答)(?:です|となります|である)?\s*(?=[。！？\n]|$)/gu, "$1")
    .replace(/(^|[。！？\n])\s*(?:(?:以上(?:の検討|の計算)?(?:から|より)|したがって|よって)[、,]?\s*)?(?:最も適切|最も不適切)(?:な(?:もの|記述|選択肢))?\s*は\s*(?:選択肢\s*)?[「『]?[ア-オA-E][」』]?(?:です|である|となります|となる)?\s*(?=[。！？\n]|$)/gu, "$1");
}

function cleanSourceText(value) {
  let text = normalizeStudyText(value).replace(/\r\n?/g, "\n").replace(/\*\*/gu, "");
  text = withoutSectionLabels(withoutAnswerSummary(text))
    .replace(/^[ \t]*#{1,6}[ \t]+/gmu, "")
    .replace(/[ \t]+/gu, " ")
    .replace(/\n[ \t]+/gu, "\n")
    .replace(/[ \t]+\n/gu, "\n")
    .replace(/\n{3,}/gu, "\n\n")
    .replace(/^[。！？\s]+/u, "")
    .replace(/[。！？]{2,}/gu, (match) => match[0])
    .trim();

  return text.split("\n")
    .map((line) => line.trim())
    .filter((line) => !SECTION_LABELS.test(line))
    .join("\n")
    .replace(/\n{3,}/gu, "\n\n")
    .trim();
}

function formatExplanation(value) {
  // Preserve the source's paragraph, table and formula boundaries. A fixed
  // number of steps would invent filler and split conditions from their rules.
  return cleanSourceText(value);
}

module.exports = { cleanSourceText, formatExplanation, withoutAnswerSummary };
