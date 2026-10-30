const test = require("node:test");
const assert = require("node:assert/strict");
const { questionsById } = require("../src/content");
const { gradeQuestion } = require("../src/grading");

// This test covers one restored table, not the semantic accuracy of the bank.
// Symbols/counts were visually read from the official H29 PDF, page 5.
// Symbol meanings were separately checked against JEED report No.162, p.259.
test("S-4775は原表の6記号を復元し、加工25%・数量検査1回・滞留0回からウのみ成立する", () => {
  const question = questionsById.get("operations:S-4775");
  assert.equal(question.difficulty, "標準", "記号の読取と比率計算は、復元表の数字の個数だけで発展にしない");
  assert.equal(question.minimumCourse, 60);
  const rows = question.prompt.split("\n")
    .filter((line) => line.startsWith("|"))
    .map((line) => line.split("|").slice(1, -1).map((cell) => cell.trim()))
    .filter((cells) => cells.length === 2 && /^\d+$/.test(cells[1]));
  const counts = Object.fromEntries(rows.map(([symbol, count]) => [symbol, Number(count)]));
  assert.deepEqual(counts, {
    "○（大きい円）": 7,
    "◦（小さい円）": 15,
    "▽（逆三角形）": 3,
    "D形（左が直線・右が半円）": 0,
    "□（正方形）": 1,
    "◇（ひし形）": 2,
    合計: 28
  });

  // Resolve meanings separately from the question explanation, then calculate.
  const symbols = {
    加工: "○（大きい円）", 運搬: "◦（小さい円）", 貯蔵: "▽（逆三角形）",
    滞留: "D形（左が直線・右が半円）", 数量検査: "□（正方形）", 品質検査: "◇（ひし形）"
  };
  const total = Object.values(symbols).reduce((sum, symbol) => sum + counts[symbol], 0);
  assert.equal(total, counts.合計);
  const processingPercentage = counts[symbols.加工] / total * 100;
  assert.equal(processingPercentage, 25);
  assert.equal(Math.round(counts[symbols.運搬] / total * 1000) / 10, 53.6);
  const statedPercentage = Number(question.prompt.match(/a 加工の割合は約([\d.]+)%/)[1]);
  const statedQuantity = Number(question.prompt.match(/b 数量検査の出現回数は(\d+)/)[1]);
  const statedDelay = Number(question.prompt.match(/c 滞留の出現回数は(\d+)/)[1]);
  const truth = {
    a: Math.round(processingPercentage * 10) / 10 === statedPercentage,
    b: counts[symbols.数量検査] === statedQuantity,
    c: counts[symbols.滞留] === statedDelay
  };
  assert.deepEqual(truth, { a: false, b: true, c: false });
  const valid = question.options.filter((option) => {
    const statements = [...option.label.matchAll(/([abc])\s*[:：]\s*(正|誤)/g)];
    return statements.length === 3 && statements.every(([, id, result]) => truth[id] === (result === "正"));
  });
  assert.deepEqual(valid.map((option) => option.id), ["ウ"]);
  assert.equal(question.answer, valid[0].id);
  assert.equal(gradeQuestion(question, "ウ").correct, true);
  assert.equal(gradeQuestion(question, "ア").correct, false);
  assert.match(question.explanation, /正方形は数量検査、ひし形は品質検査/);
  assert.match(question.explanation, /滞留はD形の0回/);
  assert.match(question.explanation, /7÷28×100=25%/);
  assert.equal(question.sourceReference.url, "https://www.jf-cmca.jp/attach/test/shikenmondai/1ji2017/d1ji2017.pdf");
  assert.equal(question.sourceReference.checkedAt, "2026-09-07");
});
