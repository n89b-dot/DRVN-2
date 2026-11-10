#!/usr/bin/env node
// Plan 2 item A0: says whether a pull request changes documents only, so the
// `e2e` job (20 to 30 minutes) can be skipped for it. Used by the `changes`
// job in .github/workflows/ci.yml; release-gate reads the answer.
//
// The answer is "documents only" only when all of these hold:
//   - the event is a pull request (a push to main and a manual run always get
//     the full suite, so every commit on main is proven by the browser tests);
//   - the diff against the base lists at least one path;
//   - every path in it is a document (isDocument below).
// Anything else, including any error reading the diff, answers "full".
//
// No dependencies: it runs on the runner's own Node before `npm ci`.
import { execFileSync } from "node:child_process";
import { appendFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

// What a file under docs/ may be and still count as a document. A script kept
// under docs/ (docs/review-evidence/**/*.cjs) is code, and gets the full suite.
const DOCS_DIR_EXTENSIONS = new Set([
  "md", "txt", "log", "json", "jsonl", "csv", "html", "pdf",
  "png", "jpg", "jpeg", "gif", "webp", "svg",
]);

/** One path, as git prints it (repository-relative, forward slashes). */
export function isDocument(file) {
  if (typeof file !== "string" || file === "") return false;
  // git never prints these for a tracked file; refuse rather than reason about them.
  if (file.startsWith("/") || file.split("/").includes("..")) return false;
  // Workflows decide what runs. Nothing under .github/workflows is a document,
  // whatever its extension.
  if (file.startsWith(".github/workflows/")) return false;
  const name = file.slice(file.lastIndexOf("/") + 1);
  const dot = name.lastIndexOf(".");
  if (dot <= 0) return false;
  const extension = name.slice(dot + 1).toLowerCase();
  if (extension === "md") return true;
  return file.startsWith("docs/") && DOCS_DIR_EXTENSIONS.has(extension);
}

/**
 * @param {{ event: string, files: string[] }} input
 * @returns {{ docsOnly: boolean, reason: string }}
 */
export function classify({ event, files }) {
  if (event !== "pull_request") {
    return { docsOnly: false, reason: `event is '${event}', not a pull request: the full suite runs` };
  }
  if (!Array.isArray(files) || files.length === 0) {
    return { docsOnly: false, reason: "the diff lists no files: the full suite runs" };
  }
  const code = files.filter((file) => !isDocument(file));
  if (code.length > 0) {
    const shown = code.slice(0, 5).join(", ");
    return {
      docsOnly: false,
      reason: `${code.length} of ${files.length} changed paths are not documents (${shown}${code.length > 5 ? ", …" : ""})`,
    };
  }
  return { docsOnly: true, reason: `all ${files.length} changed paths are documents` };
}

/**
 * The pull request's changed paths. On a pull_request event HEAD is GitHub's
 * merge commit and HEAD^1 is the base branch, so this is exactly what the
 * merge would change. --no-renames lists a moved file as a deletion and an
 * addition: with rename detection, `src/a.ts -> docs/a.md` would print only
 * the new name and hide that code was removed.
 */
export function changedFiles(base = "HEAD^1", head = "HEAD") {
  const out = execFileSync("git", ["diff", "--name-only", "--no-renames", "-z", base, head], {
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
    // stderr is captured so a failure's reason lands in the error message.
    stdio: ["ignore", "pipe", "pipe"],
  });
  return out.split("\0").filter(Boolean);
}

function main() {
  const event = process.env.GITHUB_EVENT_NAME ?? "";
  let result;
  try {
    const files = event === "pull_request" ? changedFiles(process.env.CHANGE_SCOPE_BASE || "HEAD^1") : [];
    result = classify({ event, files });
  } catch (error) {
    result = { docsOnly: false, reason: `could not read the diff (${error instanceof Error ? error.message.split("\n")[0] : error}): the full suite runs` };
  }
  const line = `docs_only=${result.docsOnly ? "true" : "false"}`;
  console.log(line);
  console.log(result.reason);
  if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `${line}\n`);
  if (process.env.GITHUB_STEP_SUMMARY) {
    appendFileSync(
      process.env.GITHUB_STEP_SUMMARY,
      `### Change scope: ${result.docsOnly ? "documents only (browser suite skipped)" : "full suite"}\n\n${result.reason}\n`
    );
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
