(function (root) {
  "use strict";
  function validDate(value) {
    const date = new Date(`${value}T12:00:00Z`);
    return /^\d{4}-\d{2}-\d{2}$/.test(value || "") && Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
  }

  function parseEvidence(input, subject, today) {
    if (!subject || !["activity", "assessment"].includes(input.kind)) throw new Error("記録する科目と種類を選択してください。");
    const source = String(input.source || "").trim();
    const minutes = Number(input.minutes);
    if (!source || source.length > 300) throw new Error("教材名を300文字以内で入力してください。");
    if (!validDate(input.date) || input.date > today) throw new Error("実施日は今日までの有効な日付を指定してください。");
    if (!Number.isFinite(minutes) || minutes < 1 || minutes > 1440) throw new Error("学習時間を1〜1,440分で入力してください。");
    const result = { kind: input.kind, subject: subject.id, source, minutes, completedAt: `${input.date}T12:00:00`, note: String(input.note || "").trim().slice(0, 1000) };
    if (input.kind === "assessment") {
      const score = Number(input.score);
      if (input.score === "" || !Number.isFinite(score) || score < 0 || score > 100) throw new Error("本試験形式の得点を0〜100点で入力してください。");
      return { ...result, score, maxScore: 100, timeLimit: subject.examMinutes, firstSeen: input.firstSeen === true, calculatorUsed: input.calculatorUsed === true };
    }
    return { ...result, itemText: String(input.itemText || "").slice(0, 500), confirmedCompletion: input.confirmedCompletion === true };
  }

  function exemptionStatus(year, targetYear) {
    if (year === "qualification") return "資格免除の要件・申請を年度案内で確認";
    if (year === "none") return "免除なし：このアプリにない科目の対策が必要";
    const value = Number(year);
    if (!value) return "未確認";
    return value < targetYear && targetYear <= value + 2 ? "科目合格による免除対象の見込み（申請が必要）" : "この合格年度では対象年度の免除期間外";
  }

  const api = { validDate, parseEvidence, exemptionStatus };
  if (typeof module === "object" && module.exports) module.exports = api;
  root.StudyEvidence = api;
})(typeof globalThis !== "undefined" ? globalThis : this);
