const test = require("node:test");
const assert = require("node:assert/strict");
const { questionBank } = require("../src/content");

const ids = ["finance:S-5489", "finance:S-5490"];
const questions = ids.map((id) => questionBank.find((question) => question.id === id));
const questionUrl = "https://www.jf-cmca.jp/attach/test/shikenmondai/1ji2025/B1JI2025.pdf";
const answerUrl = "https://www.jf-cmca.jp/attach/test/r07/1ji_seikai/2025b.pdf";

function riskReturnRows(question) {
  return question.prompt.split("\n").filter((line) => /^\| [A-I] \|/.test(line)).map((line) => {
    const [, asset, risk, expectedReturn] = line.split("|").map((cell) => cell.trim());
    return { asset, risk: Number(risk), expectedReturn: Number(expectedReturn) };
  });
}

test("H23第18問の全9候補を公式表から復元し、Cだけが他候補に支配されない", () => {
  const question = questionBank.find((item) => item.id === "finance:S-5188");
  const rows = riskReturnRows(question);
  // Official table, printed page 14 / PDF page 15, visually checked 2026-09-13.
  assert.deepEqual(rows.map(({asset,risk,expectedReturn}) => [asset,risk,expectedReturn]), [
    ["A",3,4], ["B",3,5], ["C",3,6], ["D",4,4], ["E",4,5], ["F",4,6], ["G",5,4], ["H",5,5], ["I",5,6]
  ]);
  const dominates = (left, right) => left.risk <= right.risk && left.expectedReturn >= right.expectedReturn
    && (left.risk < right.risk || left.expectedReturn > right.expectedReturn);
  const undominated = rows.filter((candidate) => !rows.some((other) => dominates(other, candidate)));
  assert.deepEqual(undominated.map((item) => item.asset), ["C"]);
  assert.deepEqual(question.options.filter((option) => undominated.some((item) => item.asset === option.label)).map((option) => option.id), [question.answer]);
  assert.equal(question.answer, "イ");
  assert.equal(question.options.find((option) => option.id === "エ").label, "H");
  assert.match(question.explanation, /リスクがすべて3%/);
  assert.doesNotMatch(question.explanation, /リスク10%|リターン8%|リスク12%/);
  assert.equal(question.sourceReference.answerUrl, "https://www.jf-cmca.jp/attach/test/H23/h23_1ji_seikai/b2011.pdf");
  assert.equal(question.minimumCourse, 60);
  assert.equal(question.calculationRequired, false, "与えられた数値の比較だけなので電卓は不要");
});

test("R6第20問の公式座標から期待収益率最大のAとBを同等に評価する", () => {
  const question = questionBank.find((item) => item.id === "finance:S-5469");
  const rows = riskReturnRows(question);
  // Official graph, printed page 14 / PDF page 15, visually checked 2026-09-13.
  assert.deepEqual(rows.map(({asset,risk,expectedReturn}) => [asset,risk,expectedReturn]), [
    ["A",1,15], ["B",3,15], ["C",3,5], ["D",5,5]
  ]);
  const maximum = Math.max(...rows.map((item) => item.expectedReturn));
  const best = rows.filter((item) => item.expectedReturn === maximum).map((item) => item.asset);
  assert.deepEqual(best, ["A","B"]);
  const correctOptions = question.options.filter((option) => JSON.stringify([...option.label.matchAll(/[A-D]/g)].map(([asset]) => asset)) === JSON.stringify(best));
  assert.deepEqual(correctOptions.map((item) => item.id), [question.answer]);
  assert.equal(question.answer, "イ");
  assert.match(question.explanation, /A自体が不利な資産という意味ではありません/);
  assert.doesNotMatch(question.explanation, /と推測され|と想定され|正解であることから/);
  assert.equal(question.sourceReference.answerUrl, "https://www.jf-cmca.jp/attach/test/r06/1ji_seikai/2024b.pdf");
  assert.equal(question.minimumCourse, 60);
  assert.equal(question.calculationRequired, false, "与えられた期待収益率の比較だけなので電卓は不要");
});

// Limited regression for the two restored questions. The reference geometry
// below was visually checked against the official PDF, printed page 18.
test("ポートフォリオ2問は同じ原図の接点・上下関係を復元し、図にない数値を与えない", () => {
  const commonPrompts = questions.map((question) => question.prompt.split(/（設問[12]）/)[0]);
  assert.equal(commonPrompts[0], commonPrompts[1]);
  const rows = Object.fromEntries(commonPrompts[0].split("\n")
    .filter((line) => line.startsWith("|")).slice(2)
    .map((line) => line.split("|").slice(1, -1).map((cell) => cell.trim())));
  assert.deepEqual(rows, {
    縦軸: "期待収益率",
    横軸: "リスク",
    曲線AD: "下側のAから左上のBへ、その後は右上のCを経てDへ続く曲線。",
    直線EG: "E、F、C、Gをこの順に通る右上がりの直線。",
    E: "縦軸上にあり、リスクは0。",
    B: "曲線ADの中でリスクが最小となる左端の点。",
    C: "直線EGと曲線ADの接点。",
    F: "EとCの間にある、直線EG上の点。",
    G: "Cより右上にある、直線EG上の点。"
  });
  assert.match(commonPrompts[0], /数値の目盛りは示されていない/);
  for (const question of questions) {
    assert.equal(question.sourceReference.url, questionUrl);
    assert.equal(question.sourceReference.answerUrl, answerUrl);
    assert.equal(question.sourceReference.checkedAt, "2026-09-09");
    assert.match(question.sourceReference.page, /紙面18頁（PDF19頁）/);
    assert.equal(question.difficulty, "標準");
  }
});

test("安全資産の有無を混ぜず、公式正解の設問1エ・設問2アと条件を対応させる", () => {
  const [withoutSafe, withSafe] = questions;
  assert.match(withoutSafe.prompt, /（設問1）安全資産が存在しない場合/);
  assert.match(withSafe.prompt, /（設問2）安全資産が存在する場合/);
  // Answers independently read from the official answer sheet, Q20 (1)/(2).
  assert.deepEqual(questions.map((question) => question.answer), ["エ", "ア"]);
  assert.equal(withoutSafe.options.find((option) => option.id === "エ").label,
    "リスク回避的な投資家は、自身のリスク回避度に基づいて、点Bと点Dを結ぶ曲線上から最適なポートフォリオを決定する。");
  assert.equal(withSafe.options.find((option) => option.id === "ア").label,
    "安全資産による資金の貸借ができるならば、効率的フロンティアは点Eと点Gを結ぶ直線である。");
  assert.match(withoutSafe.explanation, /点BからCを経てDに至る上側の曲線BD/);
  assert.match(withoutSafe.explanation, /全員の最適なポートフォリオが点Cに固定されるわけではありません/);
  assert.match(withSafe.explanation, /GがCと同じ点である必要はなく/);
  assert.match(withSafe.explanation, /点C自体は危険資産だけ/);
  assert.match(withSafe.explanation, /横軸をベータとする証券市場線とは区別/);
  assert.doesNotMatch(withSafe.explanation, /Gは効率的フロンティア上の任意の点|GがCと一致する場合/);
});

test("リスク回避でも借入投資を選ぶ反例があり、設問2エの一般断定を否定できる", () => {
  // This is an independent mean-variance example, NOT numerical data from the
  // exam figure. Borrowing/lending use the same risk-free rate without a cap.
  const riskFreeReturn = 0.02;
  const marketPremium = 0.06;
  const marketRisk = 0.2;
  const riskAversion = 1;
  const utility = (weight) => riskFreeReturn + weight * marketPremium
    - riskAversion * (weight * marketRisk) ** 2 / 2;
  const optimum = marketPremium / (riskAversion * marketRisk ** 2);
  assert.ok(riskAversion > 0, "同じ期待収益率なら分散が小さい方を好む");
  assert.ok(-riskAversion * marketRisk ** 2 < 0, "効用は投資比率について厳密に凹");
  assert.ok(Math.abs(optimum - 1.5) < 1e-12);
  assert.ok(utility(optimum) > utility(1));
  assert.ok(utility(optimum) > utility(optimum - 0.1));
  assert.ok(utility(optimum) > utility(optimum + 0.1));
  const portfolioPremium = optimum * marketPremium;
  assert.ok(Math.abs(portfolioPremium - 0.09) < 1e-12);
  assert.ok(portfolioPremium > marketPremium);
  assert.match(questions[1].explanation, /リスク回避的であることは、市場ポートフォリオCより必ず小さいリスクしか取らないという意味ではありません/);
  assert.match(questions[1].explanation, /w>1ではCより大きくなります/);
  assert.match(questions[1].explanation, /エの断定は成立しません/);
});
