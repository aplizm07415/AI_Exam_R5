const test = require("node:test");
const assert = require("node:assert/strict");
const { Readable } = require("node:stream");

const { content, questionBank, questionsById, publicContent, queryQuestions } = require("../src/content");
const { gradeQuestion } = require("../src/grading");
const { cleanSourceText, formatExplanation } = require("../src/explanation-format");
const { difficultyFor } = require("../src/question-quality");
const { auditQuestions, markdown } = require("../tools/audit-questions");
const { handler } = require("../server");

const QUARANTINED = [
  "finance:S-5299", "finance:S-5320", "finance:S-5092",
  "finance:S-5357", "operations:S-4999", "operations:S-5010",
  "finance:S-5089", "finance:S-5423",
  "operations:S-4706", "operations:S-4722", "operations:S-4796", "operations:S-4820",
  "operations:S-4835", "operations:S-4837", "operations:S-4865", "operations:S-4891",
  "operations:S-4914", "operations:S-4949", "operations:S-4964", "operations:S-4975",
  "operations:S-5020", "sme:S-0582"
];
const CORRECTED = ["law:S-CV-10-291", "operations:S-4687", "finance:S-5312", "law:S-OT-03-426",
  "finance:S-5248", "finance:S-5309", "operations:S-4814", "operations:S-4632", "finance:S-5126", "operations:S-4785", "operations:S-4839", "operations:S-4897", "operations:S-4775", "finance:S-5489", "finance:S-5490", "finance:S-5188", "finance:S-5469"];

// These regressions cover the reviewed defects. They are not a semantic
// certification of the other questions in the bank.
test("確認済みの図表欠落問題は保存されるが、ID指定・全ページ出題・採点から隔離される", () => {
  const catalog = publicContent();
  assert.equal(questionBank.length, 2474);
  assert.equal(content.questions.length, 2474 - QUARANTINED.length);
  assert.deepEqual([...catalog.questionQuality.quarantinedQuestionIds].sort(), [...QUARANTINED].sort());
  assert.equal(catalog.questionQuality.bankTotal - catalog.questionQuality.availableTotal, QUARANTINED.length);
  assert.deepEqual(queryQuestions({ ids: QUARANTINED.join(","), limit: 100 }).questions, []);
  for (const id of QUARANTINED) {
    const stored = questionBank.find((question) => question.id === id);
    assert.ok(stored, `${id}: 原資料の復元確認用に保存`);
    assert.equal(questionsById.has(id), false, `${id}: 採点用lookupから除外`);
    assert.throws(() => gradeQuestion(stored, stored.answer), /出題停止中/);
  }
  const deliveredIds = [];
  for (let offset = 0; offset < content.questions.length; offset += 100) {
    const page = queryQuestions({ course: 80, limit: 100, offset, seed: "quality-all-pages" });
    assert.equal(page.total, content.questions.length);
    deliveredIds.push(...page.questions.map((question) => question.id));
  }
  assert.equal(new Set(deliveredIds).size, content.questions.length);
  assert.ok(QUARANTINED.every((id) => !deliveredIds.includes(id)));
});

test("ABC単価を提示表から独立再計算すると、選択肢はaとdだけに絞れる", () => {
  const question = questionsById.get("operations:S-4687");
  const prices = {};
  for (const line of question.prompt.split("\n")) {
    const cells = line.split("|").map((cell) => cell.trim());
    if (!/^(?:ピッキング|梱包|検品|出荷)$/.test(cells[1] || "")) continue;
    const cost = Number(cells[3].replace(/[^\d.]/g, "")) * (/千円/.test(cells[3]) ? 1000 : 1);
    const amount = Number(cells[4].replace(/[^\d.]/g, ""));
    prices[cells[1]] = cost / amount;
  }
  assert.deepEqual(prices, { ピッキング: 60, 梱包: 80, 検品: 30, 出荷: 40 });
  const statements = [...question.prompt.matchAll(/([a-e]):\s*(ピッキング|梱包|検品|出荷)単価\s*(\d+)円\/(行|ケース)/g)];
  assert.equal(statements.length, 5);
  const trueStatements = new Set(statements.filter(([, , activity, price]) => prices[activity] === Number(price)).map(([, id]) => id));
  assert.deepEqual([...trueStatements], ["a", "d"]);
  const valid = question.options.filter((option) => [...option.label.matchAll(/[a-e]/g)].every(([id]) => trueStatements.has(id)));
  assert.equal(valid.length, 1, "正しい組み合わせが複数にならない");
  assert.equal(valid[0].id, question.answer);
  assert.doesNotMatch(question.explanation, /どちらも正しい|曖昧|複数正解/);
});

test("法定相続分は民法900条の配分と照合してCだけが成立する", () => {
  const question = questionsById.get("law:S-CV-10-291");
  // Official reference checked during the review:
  // https://www.nta.go.jp/taxes/shiraberu/taxanswer/sozoku/4132.htm
  const valid = question.options.filter((option) => {
    const fractions = [...option.label.matchAll(/(\d+)分の(\d+)/g)].map(([, denominator, numerator]) => Number(numerator) / Number(denominator));
    if (option.label.includes("嫡出でない子")) return fractions.length === 1 && fractions[0] === 1;
    const expected = option.label.includes("配偶者と子") ? [1 / 2, 1 / 2]
      : option.label.includes("直系尊属") ? [2 / 3, 1 / 3]
        : [3 / 4, 1 / 4];
    return fractions.length === 2 && fractions.every((fraction, index) => fraction === expected[index]);
  });
  assert.deepEqual(valid.map((option) => option.id), ["C"]);
  assert.equal(question.answer, valid[0].id);
  assert.match(question.sourceReference.url, /^https:\/\/www\.nta\.go\.jp\//);
  assert.doesNotMatch(question.explanation, /Bも正しい|最も明確な区分/);
  assert.match(question.explanation, /嫡出でない子の相続分は嫡出である子と同じ/);
});

test("S-5312は選択肢を逆の文に読み替えず、直接作業と間接作業を区別して説明する", () => {
  const question = questionsById.get("finance:S-5312");
  assert.match(question.options.find((option) => option.id === "ア").label, /直接従事した時間.*必ず含まれる/);
  assert.match(question.explanation, /直接従事した時間の賃金は直接労務費/);
  assert.match(question.explanation, /必ず間接労務費へ含めるものではありません/);
  assert.match(question.explanation, /間接作業時間等に対応する部分は区別/);
  assert.match(question.explanation, /減価償却費は経費に含まれる/);
  assert.match(question.explanation, /加工費は直接材料費以外の原価で、直接労務費も含まれます/);
  assert.doesNotMatch(question.explanation, /アも事実として正しい|記述内容は正しい/);
  assert.match(question.sourceReference.url, /^https:\/\/www\.asb-j\.jp\//);
});

test("取適法問題は発注日の適用範囲を明示し、合意による振込手数料控除を認めない", () => {
  const question = questionsById.get("law:S-OT-03-426");
  // JFTC Q96 / Q99: even prior agreement does not permit the deduction.
  assert.match(question.prompt, /2026年1月1日以降に発注する取適法の対象取引/);
  assert.match(question.prompt, /第5条第1項第3号/);
  assert.match(question.options.find((option) => option.id === "D").label, /契約で定めていれば.*減額には該当しない/);
  assert.match(question.explanation, /合意の有無にかかわらず本法違反/);
  assert.match(question.explanation, /Dの説明は現行の取扱いと異なります/);
  assert.doesNotMatch(question.explanation, /実費の範囲内.*該当しない/);
  assert.equal(question.answer, "B");
  assert.equal(question.sourceReference.effectiveFrom, "2026-01-01");
  assert.equal(question.sourceReference.url, "https://www.jftc.go.jp/toriteki/toriteki_qa.html");
  assert.equal(question.sourceReference.section, "Q96・Q99");
});

test("正答ラベルを減らしても、正答であるSeverabilityとEntire Agreementの根拠文を保つ", () => {
  const severability = questionsById.get("law:S-OT-08-472").explanation;
  const entireAgreement = questionsById.get("law:S-OT-08-471").explanation;
  assert.match(severability, /Severability.*契約の一部が法的に無効.*残りの有効な条項を維持/);
  assert.match(entireAgreement, /Entire Agreement.*最終的かつ完全な合意/);
  assert.doesNotMatch(severability, /Bが正解/);
  assert.equal(cleanSourceText("正解はBです。残りの有効な条項を維持します（Bが正解）。"), "残りの有効な条項を維持します。");
});

test("正答に言及する計算・限定条件・不成立警告と出典URLを整形で消さない", () => {
  const formula = "安全資産利子率2%、市場期待収益率8%、ベータ2.0より、2% + 2.0 × (8% - 2%) = 14%なのでBが正解です。";
  assert.ok(formatExplanation(formula).includes("2% + 2.0 × (8% - 2%) = 14%"));
  const condition = "Bが正解となるのは、書面による合意がある場合だけです。条件を満たさなければ適用されません。";
  assert.ok(formatExplanation(condition).includes("書面による合意がある場合だけ"));
  assert.ok(formatExplanation(condition).includes("条件を満たさなければ適用されません"));
  assert.match(formatExplanation("問題に不整合があり、複数正解となります。正解はBです。"), /問題に不整合.*複数正解/);
  const url = "https://example.test/reference?year=2026#section-3";
  assert.ok(formatExplanation(`計算には期末値を使います。出典: ${url}`).includes(url));
  assert.match(formatExplanation("【注意点：税率は30%とする】\n注意点：課税対象の場合のみ"), /税率は30%とする[\s\S]*課税対象の場合のみ/);
  assert.equal(formatExplanation("参考価格は100円です。"), "参考価格は100円です。");
  assert.equal(formatExplanation("期末値を使います。"), "期末値を使います。");
  const table = "| 項目 | 金額 |\n| --- | --- |\n| A | 100 |\n| B | 200 |";
  assert.equal(formatExplanation(table), table);
  assert.equal(formatExplanation("-100 + 200 = 100\n100 * A = B"), "-100 + 200 = 100\n100 * A = B");
});

test("割引の指数・分散の二乗・仮説の添字を普通の数字へ変換しない", () => {
  const bond = questionsById.get("finance:S-5126");
  assert.match(bond.options.find((o) => o.id === "イ").label, /\(1 \+ r\)².*\(1 \+ r\)³/);
  assert.match(bond.explanation, /\(1\+r\)².*\(1\+r\)³/);
  const hypothesis = questionsById.get("operations:S-4785");
  assert.equal(hypothesis.options.find((o) => o.id === "ア").label, "H₁:σ² < 1.1²");
  assert.match(hypothesis.explanation, /σ₀² = 1\.1²/);
  assert.equal(formatExplanation("σ² = １．１²、CO₂、m²、H₁"), "σ² = 1.1²、CO₂、m²、H₁");
  const special = /[\u00b2\u00b3\u00b9\u2070-\u209f]/gu;
  for (const question of questionBank) {
    for (const symbol of new Set(question.originalExplanation.match(special) || [])) {
      assert.ok(question.explanation.includes(symbol), `${question.id}: ${symbol}を保持`);
    }
  }
});

test("公開品質台帳は訂正問題の版と現在の集計属性を示し、未点検問題を検証済みにしない", () => {
  const catalog = publicContent();
  for (const question of questionBank) {
    const quality = catalog.questionQuality.questions[question.id];
    for (const key of ["subject", "topicId", "topic", "minimumCourse", "difficulty"]) assert.equal(quality[key], question[key]);
    assert.equal(quality.foundationCheckpoint, question.foundationCheckpoint || null);
    assert.equal("answer" in quality, false);
    assert.equal("explanation" in quality, false);
    if (CORRECTED.includes(question.id)) {
      assert.equal(quality.status, "corrected");
      assert.equal(quality.contentVersion, 2);
      assert.equal(quality.minimumScoringVersion, 2);
      assert.match(quality.reviewedAt, /^\d{4}-\d{2}-\d{2}$/);
    } else if (!QUARANTINED.includes(question.id)) {
      assert.equal(quality.status, "unreviewed");
      assert.equal(quality.contentVersion, 1);
      assert.equal(quality.reviewedAt, null);
    }
  }
  for (const id of CORRECTED) {
    const question = questionsById.get(id);
    const visible = queryQuestions({ ids: id }).questions[0];
    assert.equal(visible.contentVersion, 2);
    assert.equal("answer" in visible, false);
    assert.equal(gradeQuestion(question, question.answer).contentVersion, 2);
  }
});

test("既出IDを除外してからページ件数を決めるので最初の100件を使い切っても補充できる", () => {
  const params = { course: 80, subject: "operations", seed: "exclusion-before-limit" };
  const first = queryQuestions({ ...params, limit: 100 });
  const next = queryQuestions({ ...params, offset: 100, limit: 20 });
  const afterExclusion = queryQuestions({ ...params, excludeIds: first.questions.map((question) => question.id).join(","), limit: 20 });
  assert.equal(afterExclusion.questions.length, 20);
  assert.equal(afterExclusion.total, first.total - 100);
  assert.deepEqual(afterExclusion.questions.map((question) => question.id), next.questions.map((question) => question.id));
  assert.deepEqual(queryQuestions({ ...params, offset: -100, limit: 5 }).questions, first.questions.slice(0, 5));
  assert.equal(queryQuestions({ ...params, offset: Infinity }).questions.length, 0);
});

test("旧ソースの複雑マーカーだけで基礎知識問題を発展へ昇格させない", () => {
  const question = { question_text: "用語の定義として最も適切なものはどれか。", choices: [{ text: "a" }, { text: "b" }] };
  assert.equal(difficultyFor(question), "基礎");
  assert.equal(difficultyFor({ ...question, question_text: `※複雑 ${question.question_text}` }), "基礎");
});

test("監査は元解説の不成立警告と資料確認候補を検出し、全問の内容検証とは区別する", () => {
  const question = {
    ...questionsById.get("law:S-OT-08-472"),
    id: "fixture:lost-explanation",
    prompt: "下図の①と②のうち、曲線に対応する番号を選べ。",
    originalExplanation: "問題に不整合があり、複数正解となります。".repeat(8),
    explanation: "まず、定義を確認。次に、条件を確認。最後に、比較。"
  };
  const report = auditQuestions([question]);
  assert.equal(report.unresolvedContentWarnings.length, 1);
  assert.match(report.unresolvedContentWarnings[0].detail, /元解説/);
  assert.equal(report.missingMaterialCandidates.length, 1);
  assert.equal(report.explanationLossCandidates.length, 1);
  const materialAssumed = auditQuestions([{
    ...question,
    prompt: "下表を参照。ただし図は省略されています。\n| 項目 | 数量 |\n| A | 10 |",
    originalExplanation: "欠落していた販売予算表を補完して計算します。"
  }]);
  assert.equal(materialAssumed.missingMaterialCandidates.length, 1, "一部の表があっても図の省略を見逃さない");
  assert.equal(materialAssumed.assumedMaterialCandidates.length, 1, "解説だけで補ったデータを点検対象に残す");
  assert.match(markdown(report), /全問保証するものではありません/);
  assert.match(markdown(report), /欠落の確定件数ではない/);
  const quarantined = questionBank.find((item) => item.id === QUARANTINED[0]);
  assert.equal(auditQuestions([quarantined], { availableQuestions: [quarantined] }).quarantinedAvailableQuestions.length, 1);
  const wholeBank = auditQuestions(questionBank, { availableQuestions: content.questions });
  assert.deepEqual(wholeBank.qualityStatusCounts, { unreviewed: 2474 - CORRECTED.length - QUARANTINED.length, corrected: CORRECTED.length, verified: 0, quarantined: QUARANTINED.length });
  assert.equal(wholeBank.quarantinedAvailableQuestions.length, 0);
  assert.equal(wholeBank.invalidQualityMetadata.length, 0);
});

test("連産品は明示した正常市価基準で78,000円だけが正答となる", () => {
  const question = questionsById.get("finance:S-5248");
  const rows = question.prompt.split("\n").map((line) => line.split("|").map((cell) => cell.trim()))
    .filter((cells) => /^(A|B)製品$/.test(cells[1]));
  const values = rows.map((cells) => Number(cells[2].replace(/[^\d]/g, "")) * Number(cells[3].replace(/[^\d]/g, "")));
  const allocated = 702000 * values[0] / values.reduce((a, b) => a + b, 0);
  assert.equal(allocated, 78000);
  const matching = question.options.filter((option) => Number(option.label.replace(/[^\d]/g, "")) === allocated);
  assert.deepEqual(matching.map((option) => option.id), [question.answer]);
  assert.match(question.prompt, /学習用改題.*正常市価/s);
  assert.doesNotMatch(question.explanation, /試験センターから複数正解|公式に正解とされた/);
});

test("残高増減の改題は表の差と費用からアのみ成立し、旧試験の復元とは表示しない", () => {
  const question = questionsById.get("finance:S-5309");
  const rows = question.prompt.split("\n").map((line) => line.split("|").map((cell) => cell.trim()));
  const deltas = Object.fromEntries(rows.filter((cells) => /売上債権|取得原価|仕入債務/.test(cells[1]))
    .map((cells) => [cells[1], Number(cells[3].replaceAll(",", "")) - Number(cells[2].replaceAll(",", ""))]));
  assert.deepEqual(Object.values(deltas), [35000, 115000, -20000]);
  assert.match(question.options.find((o) => o.id === "エ").label, /20,000千円増加/);
  assert.equal(question.answer, "ア");
  assert.match(question.prompt, /元試験の財務諸表を復元したものではない/);
  assert.match(question.explanation, /20,000千円の減少/);
});

test("5Sと発注方式の改題は条件を揃え、消去法で不整合な正答へ誘導しない", () => {
  const fiveS = questionsById.get("operations:S-4814");
  const mapping = { 整理: "c", 整頓: "b", 清掃: "d", 清潔: "e", しつけ: "a" };
  const order = Object.values(mapping).join("→");
  assert.deepEqual(fiveS.options.filter((o) => o.label === order).map((o) => o.id), [fiveS.answer]);
  assert.match(fiveS.prompt, /d：.*掃除と点検[\s\S]*e：.*手順を定め/);
  assert.doesNotMatch(fiveS.explanation, /逆になって|消去法|選択肢は存在しません/);
  const inventory = questionsById.get("operations:S-4632");
  assert.match(inventory.options.find((o) => o.id === "ア").label, /在庫ポジション/);
  assert.match(inventory.options.find((o) => o.id === "イ").label, /同じ容量/);
  assert.match(inventory.explanation, /100 − \(30 \+ 20 − 0\) = 50/);
  assert.equal(inventory.answer, "ウ");
});

function gradeRequest(body) {
  return new Promise((resolve, reject) => {
    const request = new Readable({ read() {} });
    request.method = "POST";
    request.url = "/api/grade";
    request.headers = { host: "test.local" };
    request.push(JSON.stringify(body));
    request.push(null);
    const response = {
      statusCode: 200,
      writeHead(status) { this.statusCode = status; },
      end(chunk) { resolve({ status: this.statusCode, body: JSON.parse(String(chunk)) }); }
    };
    Promise.resolve(handler(request, response)).catch(reject);
  });
}

test("採点APIは旧版・版未指定の訂正問題を409、隔離問題を404にし新版だけ採点する", async () => {
  const question = questionsById.get("law:S-CV-10-291");
  for (const version of [undefined, 1]) {
    const response = await gradeRequest({ questionId: question.id, answer: "C", contentVersion: version });
    assert.equal(response.status, 409);
    assert.equal(response.body.error, "question_version_changed");
  }
  const response = await gradeRequest({ questionId: question.id, answer: "C", contentVersion: 2 });
  assert.equal(response.status, 200);
  assert.equal(response.body.correct, true);
  assert.equal(response.body.contentVersion, 2);
  assert.equal((await gradeRequest({ questionId: QUARANTINED[0], answer: "イ", contentVersion: 1 })).status, 404);
  const original = content.questions.find((item) => item.contentVersion === 1);
  assert.equal((await gradeRequest({ questionId: original.id, answer: original.answer })).status, 200);
});
