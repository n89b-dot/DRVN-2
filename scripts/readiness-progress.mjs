import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";

export const progressDirectory = fileURLToPath(new URL("../docs/readiness-progress/", import.meta.url));
export function readProgress() {
  const data = JSON.parse(readFileSync(resolve(progressDirectory, "progress.json"), "utf8"));
  const ids = new Set();
  for (const item of data.workstreams) {
    if (ids.has(item.id) || !item.checkpoints.length) throw new Error("Invalid workstream inventory");
    ids.add(item.id);
    for (const checkpoint of item.checkpoints) {
      if (!["todo", "doing", "done", "blocked"].includes(checkpoint.state)) throw new Error("Invalid checkpoint state");
      if (checkpoint.state === "done" && !checkpoint.evidence) throw new Error("Completed checkpoints require evidence");
    }
  }
  return data;
}
export function renderProgress() {
  // Safe inside script text, including if an evidence description contains HTML.
  const json = JSON.stringify(readProgress()).replaceAll("<", "\\u003c").replaceAll("\u2028", "\\u2028").replaceAll("\u2029", "\\u2029");
  return readFileSync(resolve(progressDirectory, "template.html"), "utf8").replace("/*__PROGRESS_DATA__*/null", json);
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  writeFileSync(resolve(progressDirectory, "index.html"), renderProgress());
  console.log("Built docs/readiness-progress/index.html with validated checkpoint evidence.");
}
