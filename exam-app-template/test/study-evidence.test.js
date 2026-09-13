const test = require("node:test");
const assert = require("node:assert/strict");
const { parseEvidence, exemptionStatus } = require("../public/study-evidence");

test("実力判定の記録は未来日・無得点・不正な時間を受け付けない", () => {
  const input = { kind: "assessment", source: "公式R5再試験", date: "2026-09-05", minutes: "60", score: "80", firstSeen: true, calculatorUsed: false };
  const subject = { id: "finance", examMinutes: 60 };
  const result = parseEvidence(input, subject, "2026-09-06");
  assert.equal(result.timeLimit, 60);
  assert.equal(result.maxScore, 100);
  for (const change of [{ date: "2026-09-07" }, { date: "2026-02-30" }, { date: "2026-99-99" }, { score: "" }, { score: 101 }, { minutes: 0 }, { minutes: 0.5 }]) {
    assert.throws(() => parseEvidence({ ...input, ...change }, subject, "2026-09-06"));
  }
});

test("免除期間と未確認を区別する", () => {
  assert.match(exemptionStatus("2024", 2027), /期間外/);
  assert.match(exemptionStatus("2025", 2027), /申請が必要/);
  assert.equal(exemptionStatus("", 2027), "未確認");
  assert.match(exemptionStatus("none", 2027), /対策が必要/);
});
