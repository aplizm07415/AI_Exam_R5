const SMALL_KATAKANA = new Map([
  ["ァ", "ア"], ["ィ", "イ"], ["ゥ", "ウ"], ["ェ", "エ"], ["ォ", "オ"]
]);

function normalizeChoiceId(value) {
  return String(value ?? "")
    .normalize("NFKC")
    .trim()
    .replace(/[ァィゥェォ]/g, (character) => SMALL_KATAKANA.get(character));
}

function normalizeChoiceText(choice) {
  const sourceLabel = String(choice?.label ?? "").normalize("NFKC").trim();
  const text = String(choice?.text ?? "").normalize("NFKC").trim();
  if (!sourceLabel || !text) return text;
  const escapedLabel = sourceLabel.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  // ハイフンは区切りではなく負号の可能性があるため、ここでは除去しない。
  return text.replace(new RegExp(`^${escapedLabel}[\\s　:：.．、]*`), "").trim() || text;
}

function numericTokens(value) {
  return String(value ?? "").match(/[+−-]?\d[\d,.]*(?:\.\d+)?(?:\s*(?:%|％|円|千円|万円|億円|個|台|人|日|時間|分|年|月|点|倍))?/g) || [];
}

function calculationRequired(question) {
  const prompt = String(question?.question_text ?? question?.prompt ?? "").normalize("NFKC");
  const numbers = numericTokens(prompt);
  const explicitlyCalculates = /(計算|算出|導出|求め(?!られ)|いくら)/.test(prompt);
  const asksForNumericAnswer = /(何(?:%|％|円|千円|万円|億円|個|台|時間|分|点|倍)|数値を選べ|金額として|率として)/.test(prompt);
  const suppliedData = /(【(?:資料|条件|データ)|次の資料|下記の資料|以下の資料)/.test(prompt);
  const formulaTopic = /(NPV|現在価値|内部収益率|損益分岐|原価|差異|回転率|標準偏差|期待収益率|WACC|EOQ|経済的発注量|PERT|最短所要時間|稼働率)/i.test(prompt);
  return numbers.length > 0 && (explicitlyCalculates || ((asksForNumericAnswer || formulaTopic) && suppliedData && numbers.length >= 2));
}

function difficultyFor(question) {
  const prompt = String(question?.question_text ?? "").normalize("NFKC");
  const choices = (question?.choices || []).map((choice) => String(choice?.text ?? "")).join("\n");
  const numbers = numericTokens(prompt);
  const markedComplex = /^\s*※複雑/.test(prompt);
  const calculation = calculationRequired(question);
  const multiStageCalculation = calculation && (
    numbers.length >= 6
    || /(複数年度|差異分析|加重平均|キャッシュフロー|現在価値|NPV|WACC|標準原価|総合原価|連立)/i.test(prompt)
  );
  const needsSeveralJudgments = /(組み合わせ|空欄.{0,20}(?:A|B|C|ア|イ|ウ).{0,20}(?:A|B|C|ア|イ|ウ)|正しいものはいくつ|誤っているものはいくつ)/s.test(prompt);
  const caseAndException = /(中小企業診断士|会話|事例|相談を受け|ただし|なお).*(例外|場合|要件|条件|適用|該当)/s.test(`${prompt}\n${choices}`);
  const comparesSeveralRules = /(それぞれ|両者|比較|A社.*B社|複数).*(適切|不適切|正しい|誤り)/s.test(prompt);

  if (markedComplex || multiStageCalculation || (needsSeveralJudgments && caseAndException)) return "発展";
  if (calculation || needsSeveralJudgments || caseAndException || comparesSeveralRules || (question?.choices || []).length >= 5) return "標準";
  return "基礎";
}

module.exports = {
  calculationRequired,
  difficultyFor,
  normalizeChoiceId,
  normalizeChoiceText,
  numericTokens
};
