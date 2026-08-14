const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");
const { URL } = require("node:url");

const { content, officialExam, publicContent, queryQuestions, questionsById } = require("./src/content");
const { gradeQuestion, gradeOfficialExam } = require("./src/grading");
const { databaseConfigured, getState, saveState } = require("./src/database");

const HOST = process.env.HOST || "127.0.0.1";
const PORT = Number(process.env.PORT || 4173);
const publicRoot = path.join(__dirname, "public");
const contentTypes = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg"
};

function sendJson(response, status, value) {
  response.writeHead(status, { "Content-Type": contentTypes[".json"], "Cache-Control": "no-store" });
  response.end(JSON.stringify(value));
}

function readJson(request, maximumBytes = 1_000_000) {
  return new Promise((resolve, reject) => {
    let body = "";
    request.setEncoding("utf8");
    request.on("data", (chunk) => {
      body += chunk;
      if (Buffer.byteLength(body, "utf8") > maximumBytes) {
        request.destroy();
        reject(new Error("request_too_large"));
      }
    });
    request.on("end", () => {
      try { resolve(body ? JSON.parse(body) : {}); }
      catch { reject(new Error("invalid_json")); }
    });
    request.on("error", reject);
  });
}

function validState(state) {
  if (!state || typeof state !== "object" || Array.isArray(state)) return false;
  const allowed = new Set(["schemaVersion", "answers", "results", "flags", "notes", "attempts", "recent", "mockResults", "plan", "startedAt", "savedAt"]);
  return Object.keys(state).every((key) => allowed.has(key));
}

function serveStatic(response, pathname) {
  const requested = pathname === "/" ? "index.html" : pathname.replace(/^\/+/, "");
  const filePath = path.resolve(publicRoot, requested);
  if (!filePath.startsWith(`${publicRoot}${path.sep}`)) return sendJson(response, 403, { error: "forbidden" });
  fs.readFile(filePath, (error, data) => {
    if (error) return sendJson(response, 404, { error: "not_found" });
    response.writeHead(200, { "Content-Type": contentTypes[path.extname(filePath).toLowerCase()] || "application/octet-stream", "Cache-Control": "no-cache" });
    response.end(data);
  });
}

async function handler(request, response) {
  const url = new URL(request.url, `http://${request.headers.host || `${HOST}:${PORT}`}`);

  if (request.method === "GET" && url.pathname === "/api/health") {
    return sendJson(response, 200, { status: "ok", appId: content.exam.id, questionCount: content.questions.length, database: databaseConfigured() ? "configured" : "not_configured" });
  }
  if (request.method === "GET" && url.pathname === "/api/content") {
    return sendJson(response, 200, publicContent());
  }
  if (request.method === "GET" && url.pathname === "/api/questions") {
    return sendJson(response, 200, queryQuestions(Object.fromEntries(url.searchParams)));
  }
  if (request.method === "POST" && url.pathname === "/api/grade") {
    try {
      const body = await readJson(request, 100_000);
      const question = questionsById.get(body.questionId);
      return question ? sendJson(response, 200, gradeQuestion(question, body.answer)) : sendJson(response, 404, { error: "question_not_found" });
    } catch (error) {
      return sendJson(response, error.message === "request_too_large" ? 413 : 400, { error: error.message });
    }
  }
  if (request.method === "POST" && url.pathname === "/api/mock/grade") {
    try {
      const body = await readJson(request, 200_000);
      const result = gradeOfficialExam(officialExam, body.subjectId, body.answers);
      return result ? sendJson(response, 200, result) : sendJson(response, 404, { error: "subject_not_found" });
    } catch (error) {
      return sendJson(response, error.message === "request_too_large" ? 413 : 400, { error: error.message });
    }
  }
  if (request.method === "GET" && url.pathname === "/api/progress") {
    try { return sendJson(response, 200, await getState()); }
    catch (error) { console.error("progress_read_failed", error); return sendJson(response, 500, { error: "progress_read_failed" }); }
  }
  if (request.method === "PUT" && url.pathname === "/api/progress") {
    try {
      const body = await readJson(request);
      if (!validState(body.state)) return sendJson(response, 400, { error: "invalid_state" });
      const saved = await saveState(body.state);
      return sendJson(response, 200, saved);
    } catch (error) {
      return sendJson(response, error.message === "request_too_large" ? 413 : 400, { error: error.message });
    }
  }
  if (request.method !== "GET") return sendJson(response, 405, { error: "method_not_allowed" });
  return serveStatic(response, decodeURIComponent(url.pathname));
}

const server = http.createServer(handler);
if (require.main === module) {
  server.listen(PORT, HOST, () => console.log(`${content.exam.name} を http://${HOST}:${PORT} で起動しました`));
}

module.exports = { handler, server, validState };
