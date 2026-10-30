const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { publicContent, queryQuestions, questionsById, officialExam } = require("../../src/content");
const { gradeQuestion, gradeOfficialExam } = require("../../src/grading");

function harness({ storage = new Map(), progressFetch, now = "2026-09-06T03:00:00Z" } = {}) {
  const clock = { now: new Date(now).getTime() };
  class ClockDate extends Date {
    constructor(...args) { super(...(args.length ? args : [clock.now])); }
    static now() { return clock.now; }
  }
  const elements = new Map();
  const listeners = new Map();
  const timers = new Map();
  let timerSequence = 0;
  const element = (selector) => {
    if (!elements.has(selector)) elements.set(selector, { innerHTML: "", textContent: "", value: "", style: { setProperty() {} }, classList: { toggle() {}, remove() {}, contains() { return false; } }, closest() { return null; }, focus() {} });
    return elements.get(selector);
  };
  const calls = [];
  const response = (body, status = 200) => ({ ok: status >= 200 && status < 300, status, json: async () => structuredClone(body) });
  const fetch = async (url, options = {}) => {
    calls.push({ url, options });
    if (url.startsWith("/api/progress")) return progressFetch ? progressFetch(url, options, response) : response({ configured: false, exists: false });
    if (url === "/api/content") return response(publicContent());
    if (url.startsWith("/api/questions")) return response(queryQuestions(Object.fromEntries(new URL(url, "http://localhost").searchParams)));
    const body = JSON.parse(options.body || "{}");
    if (url === "/api/grade") {
      const question = questionsById.get(body.questionId);
      if (!question) return response({ error: "question_not_found" }, 404);
      if (Number(body.contentVersion || 1) !== Number(question.contentVersion || 1)) return response({ error: "question_version_changed" }, 409);
      return response(gradeQuestion(question, body.answer, { answerStatus: body.answerStatus }));
    }
    if (url === "/api/mock/grade") return response(gradeOfficialExam(officialExam, body.subjectId, body.answers));
    throw new Error(`Unexpected API: ${url}`);
  };
  const context = vm.createContext({ console, Date: ClockDate, Math, Map, Set, Intl, URLSearchParams, URL, Promise,
    document: { documentElement: { style: { setProperty() {} } }, querySelector: element, querySelectorAll() { return []; }, addEventListener(type, handler) { if (!listeners.has(type)) listeners.set(type, []); listeners.get(type).push(handler); } },
    window: { open() {}, scrollTo() {}, addEventListener() {} },
    localStorage: { getItem(key) { return storage.get(key) || null; }, setItem(key, value) { storage.set(key, value); } },
    alert(message) { calls.push({ alert: message }); }, confirm() { return true; }, fetch,
    setTimeout(fn) { const id = ++timerSequence; timers.set(id, fn); return id; }, clearTimeout(id) { timers.delete(id); },
    setInterval(fn) { const id = ++timerSequence; timers.set(id, fn); return id; }, clearInterval(id) { timers.delete(id); }
  });
  for (const name of ["calculator", "assessment", "study-evidence", "learning", "progress-sync", "app"]) {
    let source = fs.readFileSync(path.join(__dirname, "../../public", `${name}.js`), "utf8");
    if (name === "app") source = source.replace(/\bboot\(\);\s*$/, "");
    vm.runInContext(source, context, { filename: `${name}.js` });
  }
  context.testContent = publicContent();
  vm.runInContext("content = testContent; databaseAvailabilityKnown = true; observedSnapshot = ProgressSync.snapshot(state)", context);
  const run = (code) => vm.runInContext(code, context);
  const json = (code) => JSON.parse(JSON.stringify(run(code)));
  const dispatch = async (type, target) => { for (const listener of listeners.get(type) || []) await listener({ target, preventDefault() {} }); };
  const click = (attribute, value = "") => {
    const key = attribute.replace(/-([a-z])/g, (_, letter) => letter.toUpperCase());
    const target = { dataset: { [key]: value }, classList: { contains() { return false; } }, closest(selector) { return selector.split(",").some((part) => part.trim() === `[data-${attribute}]`) ? this : null; }, matches() { return false; } };
    return dispatch("click", target);
  };
  return { context, run, json, storage, calls, response, clock, element, dispatch, click, timers };
}

module.exports = { harness };
