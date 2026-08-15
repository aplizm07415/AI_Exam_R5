const SECTION_NAMES = "結論|解法|判断の軸|各?選択肢の根拠|難易度|注意点|ミスしやすい点|考え方のポイント|知識のポイント|各選択肢の検討|選択肢の検討|各選択肢の評価|選択肢の評価|各選択肢の分析|選択肢の分析|解説|思考プロセス|自分で再確認|ファクトチェック|参考|補足|検算";
const SECTION_LABELS = new RegExp(`^(?:#+\\s*)?(?:\\d+[.)、]\\s*)?(?:${SECTION_NAMES})(?:\\([^)]*\\)|[：:][^。！？]*)?\\s*[：:]?\\s*$`, "u");

function withoutSectionLabels(value) {
  return String(value)
    .replace(new RegExp(`[【\\[]\\s*(?:${SECTION_NAMES})(?:\\s*[：:][^】\\]\\n]*)?\\s*[】\\]]`, "gu"), "\n")
    .replace(/(?:思考プロセス|解説)(?=\s)/gu, "")
    .replace(new RegExp(`(?:${SECTION_NAMES})\\s*(?=(?:\\d+[.)、]|各選択肢|$))`, "gu"), "")
    .replace(new RegExp(`(^|[。！？\\n])\\s*(?:\\d+[.)、]\\s*)?(?:${SECTION_NAMES})(?:\\([^)]*\\))?\\s*(?:は以下の通り(?:です|である)?|を確認する|を検討する)?\\s*[：:]?\\s*`, "gu"), "$1");
}

function withoutExplicitJudgments(value) {
  return String(value)
    .replace(/正解への(?:鍵|手掛かり)/gu, "判断の手掛かり")
    .replace(/正解になり得る|正解になりうる/gu, "条件に合う可能性がある")
    .replace(/複数正解/gu, "複数の解答")
    .replace(/[【\[]\s*(?:正解|正答)\s*[】\]]\s*[^。！？\n]*[。！？]?/gu, "")
    .replace(/(?:^|[\n。！？])\s*(?:・\s*)?(?:選択肢\s*)?[ア-オA-E](?:\([^)]*\))?\s*[：:]\s*(?:正解|正答)(?:です|である|となります|となる)?\s*[。．]?/gu, "$1")
    .replace(/(?:以上(?:の検討|の計算)?(?:から|より)|以上のことから|したがって|よって)[^。！？\n]{0,320}(?:正解|正答)[^。！？\n]*[。！？]?/gu, "")
    .replace(/[^。！？\n]{0,180}(?:選択肢|記述)[「『]?[ア-オA-Eァ-ォ][」』]?[^。！？\n]{0,100}(?:正解|正答)[^。！？\n]*[。！？]?/gu, "")
    .replace(/[^。！？\n]{0,180}(?:正解|正答)[^。！？\n]*[。！？]?/gu, "")
    .replace(/((?:^|[\n。！？])\s*(?:・\s*)?(?:選択肢\s*)?[ア-オA-E](?:\([^)]*\))?\s*[：:])\s*(?:適切|不適切|正しい|誤り)(?:です|である)?[。．、:]?\s*/gu, "$1")
    .replace(/((?:^|[\n。！？])\s*(?:・\s*)?(?:選択肢\s*)?[ア-オA-E])\s*\(\s*(?:適切|不適切|正しい|誤り)\s*\)\s*[：:]?/gu, "$1：")
    .replace(/(?:この|その|どの)?点(?:に|にも)?注意(?:が必要(?:です|である)?|してください|しましょう)[。．]?/gu, "この点も確認します。")
    .replace(/混同しないよう注意(?:が必要(?:です|である)?|してください|しましょう)[。．]?/gu, "両者を区別します。")
    .replace(/(?:典型的な)?(?:誤答|引っかけ)パターン(?:なので|であるため)?注意(?:が必要(?:です|である)?|してください|しましょう)[。．]?/gu, "")
    .replace(/ことに注意(?:が必要(?:です|である)?|してください|しましょう)/gu, "ことを確認します")
    .replace(/に注意(?:が必要(?:です|である)?|してください|しましょう)/gu, "を確認します")
    .replace(/注意(?:が必要(?:です|である)?|してください|しましょう)/gu, "確認します")
    .replace(/(?:^|\n)\s*(?:選択肢\s*)?[ア-オA-E]\s*[：:]?\s*(?=\n|$)/gu, "\n");
}

function withoutAnswerSummary(value) {
  return withoutExplicitJudgments(value)
    .replace(/(?:正解|正答)\s*(?:は|[：:])\s*[^。！？\n]+[。！？]?/gu, "")
    .replace(/(?:正解|正答)\s*(?:は|[：:])\s*[ア-オA-Dァ-ォ](?:\s*です)?[。．.]?/gu, "")
    .replace(/(?:以上(?:の検討|の計算)?(?:から|より)|したがって|よって)[^。\n]{0,100}(?:選択肢|記述)?[「『]?[ア-オA-Dァ-ォ][」』]?[^。\n]{0,40}(?:正解|正答)[^。\n]*[。．]?/gu, "")
    .replace(/(?:選択肢|記述)[「『]?[ア-オA-Dァ-ォ][」』]?\s*が\s*(?:正解|正答)(?:です|となります|である)?[。．]?/gu, "")
    .replace(/(?:これ|以上)が(?:本問の)?(?:正解|正答)(?:です|となります|である)?[。．]?/gu, "")
    .replace(/(?:以上(?:[^。！？\n]{0,40})(?:から|より)|以上のことから)[^。！？\n]{0,320}(?:最も)?(?:適切|不適切|正しい|誤り)[^。！？\n]*[。！？]?/gu, "")
    .replace(/[^。！？\n]*(?:(?:選択肢|記述)[「『]?[ア-オA-Eァ-ォ][」』]?(?:が|は)[^。！？\n]{0,100}最も(?:適切|不適切)|最も(?:適切|不適切)[^。！？\n]{0,100}(?:選択肢|記述)[「『]?[ア-オA-Eァ-ォ][」』]?)[^。！？\n]*[。！？]?/gu, "")
    .replace(/(?:最も適切|最も不適切)(?:な(?:もの|記述|選択肢))?\s*は[^。！？\n]+[。！？]?/gu, "")
    .replace(/[^。！？\n]*(?:最も適切|最も不適切)[^。！？\n]*[。！？]?/gu, "");
}

function cleanSourceText(value) {
  let text = String(value || "").normalize("NFKC").replace(/\r\n?/g, "\n").replace(/\*\*/gu, "");
  text = withoutSectionLabels(withoutAnswerSummary(text))
    .replace(/\*\*(?:ステップ|Step)\s*\d+\s*[：:][^*]+\*\*/giu, "\n")
    .replace(/\*\*\s*\d+[.)]\s*[^*]+\*\*/gu, "\n")
    .replace(/\s*#{1,6}\s*/gu, "\n")
    .replace(/したがって、?\s*となります[。．]?/gu, "")
    .replace(/\*\*/gu, "")
    .replace(/\s*\*\s*(?=(?:選択肢\s*)?[ア-オA-E][：:]?)/gu, "\n\n")
    .replace(/^[ \t]*[-*・]\s*/gmu, "")
    .replace(/[ \t]+(?=[ア-オA-D][：:]\s*(?:適切|不適切|正しい|誤り|○|×))/gu, "\n\n")
    .replace(/[ \t]+/gu, " ")
    .replace(/\n[ \t]+/gu, "\n")
    .replace(/[ \t]+\n/gu, "\n")
    .replace(/\n{3,}/gu, "\n\n")
    .trim();

  return text.split(/\n+/u)
    .map((line) => line.trim())
    .filter((line) => line && !SECTION_LABELS.test(line))
    .join("\n\n");
}

function sentenceGroups(text, groupCount = 3) {
  const sentences = text.match(/[^。！？\n]+[。！？]?/gu)?.map((sentence) => sentence.trim()).filter(Boolean) || [];
  if (sentences.length < groupCount) return [text];
  const groups = [];
  for (let index = 0; index < groupCount; index += 1) {
    const start = Math.round(index * sentences.length / groupCount);
    const end = Math.round((index + 1) * sentences.length / groupCount);
    groups.push(sentences.slice(start, end).join(""));
  }
  return groups.filter(Boolean);
}

function stripTransition(value) {
  return value.replace(/^(?:まず|最初に|次に|続いて|その後|最後に|以上より|したがって|よって)\s*[、,]\s*/u, "").trim();
}

function formatExplanation(value) {
  const cleaned = cleanSourceText(value);
  if (!cleaned) return "";
  let blocks = cleaned.split(/\n{2,}/u).map(stripTransition).filter(Boolean);
  if (blocks.length < 3) blocks = sentenceGroups(blocks.join(" "), 3).map(stripTransition).filter(Boolean);
  if (blocks.length < 3) {
    blocks = [
      "問題文で問われている条件と用語を整理します。",
      blocks.join(" "),
      "問題文の条件と照らし、各記述が同じ基準を満たすかを確認します。"
    ].filter(Boolean);
  }
  return blocks.map((block, index) => {
    if (index === 0) return `まず、${block}`;
    if (index === blocks.length - 1) return `最後に、${block}`;
    return `${index === 1 ? "次に" : "続いて"}、${block}`;
  }).join("\n\n");
}

module.exports = { cleanSourceText, formatExplanation, withoutAnswerSummary };
