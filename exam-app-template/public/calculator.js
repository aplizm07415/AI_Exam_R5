(function exposeCalculatorCore(root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.CalculatorCore = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function calculatorFactory() {
  const operators = new Set(["+", "−", "×", "÷"]);

  function initialState(overrides = {}) {
    return {
      display: "0",
      accumulator: null,
      operator: null,
      waitingForOperand: false,
      expression: "",
      minimized: false,
      x: null,
      y: null,
      ...overrides
    };
  }

  function tidyNumber(value) {
    if (!Number.isFinite(value)) return "エラー";
    const rounded = Number.parseFloat(value.toPrecision(12));
    return String(Object.is(rounded, -0) ? 0 : rounded);
  }

  function calculate(left, right, operator) {
    if (operator === "+") return left + right;
    if (operator === "−") return left - right;
    if (operator === "×") return left * right;
    if (operator === "÷") return right === 0 ? Number.NaN : left / right;
    return right;
  }

  function reduceCalculator(source, action, value) {
    const state = initialState(source);
    if (action === "clear") return initialState({ minimized: state.minimized, x: state.x, y: state.y });

    if (action === "digit") {
      const digit = String(value || "").replace(/\D/g, "").slice(0, 1);
      if (!digit) return state;
      const display = state.waitingForOperand || state.display === "0" || state.display === "エラー"
        ? digit
        : `${state.display}${digit}`.slice(0, 15);
      return { ...state, display, waitingForOperand: false };
    }

    if (action === "decimal") {
      if (state.waitingForOperand || state.display === "エラー") return { ...state, display: "0.", waitingForOperand: false };
      return state.display.includes(".") ? state : { ...state, display: `${state.display}.` };
    }

    if (action === "sign") {
      if (state.display === "0" || state.display === "エラー") return state;
      return { ...state, display: state.display.startsWith("-") ? state.display.slice(1) : `-${state.display}` };
    }

    if (action === "backspace") {
      if (state.waitingForOperand || state.display === "エラー") return state;
      const next = state.display.length <= 1 || (state.display.startsWith("-") && state.display.length === 2)
        ? "0"
        : state.display.slice(0, -1);
      return { ...state, display: next };
    }

    if (action === "percent") {
      const result = tidyNumber(Number(state.display) / 100);
      return { ...state, display: result, waitingForOperand: result === "エラー" };
    }

    if (action === "operator" && operators.has(value)) {
      const input = Number(state.display);
      let accumulator = state.accumulator;
      let display = state.display;
      if (accumulator !== null && state.operator && !state.waitingForOperand) {
        display = tidyNumber(calculate(accumulator, input, state.operator));
        accumulator = display === "エラー" ? null : Number(display);
      } else if (accumulator === null) {
        accumulator = input;
      }
      if (display === "エラー") return initialState({ display, waitingForOperand: true, minimized: state.minimized, x: state.x, y: state.y });
      return { ...state, display, accumulator, operator: value, waitingForOperand: true, expression: `${tidyNumber(accumulator)} ${value}` };
    }

    if (action === "equals" && state.operator && state.accumulator !== null) {
      const right = Number(state.display);
      const result = tidyNumber(calculate(state.accumulator, right, state.operator));
      return {
        ...state,
        display: result,
        expression: `${tidyNumber(state.accumulator)} ${state.operator} ${tidyNumber(right)} ＝`,
        accumulator: null,
        operator: null,
        waitingForOperand: true
      };
    }

    return state;
  }

  return { initialState, reduceCalculator };
});
