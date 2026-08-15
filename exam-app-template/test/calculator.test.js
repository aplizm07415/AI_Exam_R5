const test = require("node:test");
const assert = require("node:assert/strict");

const { initialState, reduceCalculator } = require("../public/calculator");

function press(sequence, source = initialState()) {
  return sequence.reduce((state, [action, value]) => reduceCalculator(state, action, value), source);
}

test("BOKI_2ndと同じ電卓コアで四則演算できる", () => {
  const result = press([
    ["digit", "1"], ["digit", "2"], ["digit", "5"],
    ["operator", "×"], ["digit", "8"], ["equals"]
  ]);
  assert.equal(result.display, "1000");
  assert.equal(result.expression, "125 × 8 ＝");
});

test("ゼロ除算を安全に処理し、クリア後も最小化状態を保つ", () => {
  const error = press([["digit", "8"], ["operator", "÷"], ["digit", "0"], ["equals"]], initialState({ minimized: true }));
  assert.equal(error.display, "エラー");
  assert.equal(error.minimized, true);
  const cleared = reduceCalculator(error, "clear");
  assert.equal(cleared.display, "0");
  assert.equal(cleared.minimized, true);
});
