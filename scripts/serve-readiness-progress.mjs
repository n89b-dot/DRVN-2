import { createServer } from "node:http";
import { readProgress, renderProgress } from "./readiness-progress.mjs";

const port = Number(process.env.DRVN_PROGRESS_PORT || 4317);
if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error("Invalid progress port");
// This serves only the tracker and sanitized progress data, never the workspace.
const server = createServer((request, response) => {
  response.setHeader("Cache-Control", "no-store");
  response.setHeader("X-Content-Type-Options", "nosniff");
  response.setHeader("Referrer-Policy", "no-referrer");
  if (!["GET", "HEAD"].includes(request.method)) {
    response.writeHead(405, { Allow: "GET, HEAD" }); response.end(); return;
  }
  const path = new URL(request.url, `http://127.0.0.1:${port}`).pathname;
  try {
    let body;
    if (path === "/" || path === "/index.html") {
      response.setHeader("Content-Type", "text/html; charset=utf-8");
      body = renderProgress();
    } else if (path === "/progress.json") {
      response.setHeader("Content-Type", "application/json; charset=utf-8");
      body = JSON.stringify(readProgress());
    } else { response.writeHead(404); response.end("Not found"); return; }
    response.end(request.method === "HEAD" ? undefined : body);
  } catch {
    response.writeHead(503); response.end("Progress update unavailable; retry shortly.");
  }
});
server.listen(port, "127.0.0.1", () => console.log(`DRVN progress: http://127.0.0.1:${port}`));
