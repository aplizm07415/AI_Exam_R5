const test = require("node:test");
const assert = require("node:assert/strict");
const { questionsById } = require("../src/content");

test("S-4839は公式図の在庫・配送数を復元し、Bと下流だけから170を算出する", () => {
  const question = questionsById.get("operations:S-4839");
  assert.equal(question.difficulty, "標準", "定義に基づく合算は、復元した全拠点の数字の個数だけで発展にしない");
  assert.equal(question.minimumCourse, 60);
  const rows = question.prompt.split("\n").filter((line) => line.startsWith("|")).map((line) => line.split("|").slice(1, -1).map((cell) => cell.trim()));
  const stocks = Object.fromEntries(rows.filter((cells) => cells.length === 2 && /^\d+$/.test(cells[1])).map(([name, quantity]) => [name, Number(quantity)]));
  const shipments = rows.filter((cells) => cells.length === 3 && /^\d+$/.test(cells[2])).map(([from, to, quantity]) => ({ from, to, quantity: Number(quantity) }));
  // Values independently read from the official PDF, printed page 2 (PDF page 3).
  assert.deepEqual(stocks, {
    工場: 200, 配送センターA: 50, 配送センターB: 45, 配送センターC: 60,
    店舗a: 60, 店舗b: 75, 店舗c: 40, 店舗d: 55, 店舗e: 65, 店舗f: 25
  });
  assert.equal(shipments.length, 9);
  const downstream = new Set(["配送センターB"]);
  for (const node of downstream) {
    for (const shipment of shipments.filter((item) => item.from === node)) downstream.add(shipment.to);
  }
  assert.deepEqual([...downstream].sort(), ["店舗c", "店舗d", "配送センターB"].sort());
  const nodeInventory = [...downstream].reduce((sum, name) => sum + stocks[name], 0);
  const downstreamInTransit = shipments.filter((item) => downstream.has(item.from)).reduce((sum, item) => sum + item.quantity, 0);
  const upstreamInTransit = shipments.filter((item) => item.to === "配送センターB").reduce((sum, item) => sum + item.quantity, 0);
  assert.equal(nodeInventory, 140);
  assert.equal(downstreamInTransit, 30);
  assert.equal(upstreamInTransit, 20);
  const echelonStock = nodeInventory + downstreamInTransit;
  assert.equal(echelonStock, 170);
  assert.deepEqual(question.options.filter((option) => Number(option.label) === echelonStock).map((option) => option.id), [question.answer]);
  assert.match(question.explanation, /工場からBへ配送中の20.*加えません/);
  assert.equal(question.calculationRequired, true);
  assert.equal(question.sourceReference.url, "https://www.jf-cmca.jp/attach/test/shikenmondai/1ji2020/D1ji2020.pdf");
  assert.equal(question.sourceReference.checkedAt, "2026-09-06");
});

test("S-4897は公式の27.7分と先行関係から5工程・約79.14%を独立に求める", () => {
  const question = questionsById.get("operations:S-4897");
  const rows = question.prompt.split("\n").map((line) => line.split("|").slice(1, -1).map((cell) => cell.trim()))
    .filter((cells) => /^[a-h]$/.test(cells[0] || ""));
  const tasks = rows.map(([id, time, predecessors]) => ({
    id, duration: Math.round(Number(time) * 10), predecessors: predecessors === "なし" ? [] : predecessors.split("・")
  }));
  // Official PDF page 3, visually checked independently of the explanation.
  assert.deepEqual(tasks.map((task) => task.duration), [29, 38, 25, 57, 12, 47, 20, 49]);
  assert.deepEqual(tasks.map((task) => task.predecessors), [[], ["a"], ["a"], ["b"], ["b"], ["c"], ["d", "e"], ["f", "g"]]);
  const cycleTime = Math.floor(700 * 60 / 5900) * 10;
  assert.equal(cycleTime, 70);
  const total = tasks.reduce((sum, task) => sum + task.duration, 0);
  assert.equal(total, 277);
  function canAssign(stationCount) {
    const loads = Array(stationCount).fill(0);
    const assignments = {};
    function place(index) {
      if (index === tasks.length) return true;
      const task = tasks[index];
      const earliest = Math.max(0, ...task.predecessors.map((id) => assignments[id]));
      for (let station = earliest; station < stationCount; station += 1) {
        if (loads[station] + task.duration > cycleTime) continue;
        loads[station] += task.duration;
        assignments[task.id] = station;
        if (place(index + 1)) return true;
        loads[station] -= task.duration;
        delete assignments[task.id];
      }
      return false;
    }
    return place(0);
  }
  assert.equal(Math.ceil(total / cycleTime), 4);
  assert.equal(canAssign(4), false, "理論最少4工程では先行関係を満たせない");
  assert.equal(canAssign(5), true);
  const efficiency = total / (5 * cycleTime) * 100;
  assert.ok(Math.abs(efficiency - 79.14285714285714) < 1e-10);
  const ranked = question.options.map((option) => ({ id: option.id, distance: Math.abs(Number(option.label) - efficiency) }))
    .sort((left, right) => left.distance - right.distance);
  assert.equal(ranked[0].id, question.answer);
  assert.ok(ranked[0].distance < ranked[1].distance);
  assert.equal(question.sourceReference.url, "https://www.jf-cmca.jp/attach/test/shikenmondai/1ji2022/D1ji2022.pdf");
  assert.doesNotMatch(question.explanation, /16\.0分|76\.19%/);
});
