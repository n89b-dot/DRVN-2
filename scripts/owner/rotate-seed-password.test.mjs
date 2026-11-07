import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import {
  DEV_PROJECT_REF,
  SEED_EMAILS,
  checkPassword,
  checkTarget,
  matchAccounts,
  parseArgs,
  parseEnvFile,
  projectRefFromUrl,
} from "./rotate-seed-password.mjs";

const root = fileURLToPath(new URL("../../", import.meta.url));

test("SEED_EMAILS covers every address the seed scripts sign in with", () => {
  const files = readdirSync(root).filter((name) => /^\.seed-.*\.mjs$/.test(name));
  assert.ok(files.length > 0, "no .seed-*.mjs files found");
  const emails = new Set();
  for (const file of files) {
    for (const match of readFileSync(root + file, "utf8").matchAll(/email:\s*"([a-z0-9._-]+@drvn\.test)"/g)) emails.add(match[1]);
  }
  assert.deepEqual([...emails].sort(), [...SEED_EMAILS].sort());
});

test("only the dev project runs without --project", () => {
  assert.equal(projectRefFromUrl(`https://${DEV_PROJECT_REF}.supabase.co`), DEV_PROJECT_REF);
  assert.equal(projectRefFromUrl("http://127.0.0.1:54321"), "local");
  assert.throws(() => projectRefFromUrl("https://example.com"));
  assert.throws(() => projectRefFromUrl(undefined));
  assert.equal(checkTarget(DEV_PROJECT_REF, null), DEV_PROJECT_REF);
  assert.throws(() => checkTarget("abcdefghijklmnopqrst", null), /--project/);
  assert.equal(checkTarget("abcdefghijklmnopqrst", "abcdefghijklmnopqrst"), "abcdefghijklmnopqrst");
  assert.throws(() => checkTarget(DEV_PROJECT_REF, "abcdefghijklmnopqrst"), /does not match/);
  assert.throws(() => checkTarget("local", null));
});

test("arguments: dry run by default", () => {
  assert.deepEqual(parseArgs([]), { apply: false, project: null });
  assert.equal(parseArgs(["--apply"]).apply, true);
  assert.equal(parseArgs(["--project", "local"]).project, "local");
  assert.throws(() => parseArgs(["--project"]));
  assert.throws(() => parseArgs(["--password", "x"]), /Unknown/);
});

test("password must be set and long; error text never echoes it", () => {
  assert.throws(() => checkPassword(undefined), /DRVN_SEED_PASSWORD/);
  try {
    checkPassword("short-secret");
    assert.fail("short password accepted");
  } catch (error) {
    assert.ok(!String(error.message).includes("short-secret"));
  }
  assert.doesNotThrow(() => checkPassword("x".repeat(24)));
});

test("lookup rows split into found and missing", () => {
  const { found, missing } = matchAccounts([{ email: "Kaito@drvn.test", user_id: "u1" }]);
  assert.deepEqual(found, [{ email: "kaito@drvn.test", id: "u1" }]);
  assert.equal(missing.length, SEED_EMAILS.length - 1);
});

test(".env.local parsing matches the seed scripts", () => {
  assert.deepEqual(parseEnvFile('# c\nA=1\nB="two=2"\n\n'), { A: "1", B: "two=2" });
});

test("seed scripts take the password from DRVN_SEED_PASSWORD and carry no literal", () => {
  const files = readdirSync(root).filter((name) => /^\.seed-.*\.mjs$/.test(name));
  for (const file of files) {
    const text = readFileSync(root + file, "utf8");
    if (!/signInWithPassword|password\s*:/i.test(text)) continue;
    assert.match(text, /process\.env\.DRVN_SEED_PASSWORD/, `${file} must read DRVN_SEED_PASSWORD`);
    assert.doesNotMatch(text, /\bPASSWORD\s*=\s*["'`]/, `${file} assigns a literal password`);
    assert.doesNotMatch(text, /password\s*:\s*["'`]/i, `${file} signs in with a literal password`);
  }
});

test("the console-admin smoke script stays out of the tree", () => {
  const tracked = execFileSync("git", ["ls-files", "--", ".page-test.mjs"], { cwd: root, encoding: "utf8" });
  assert.equal(tracked.trim(), "", ".page-test.mjs is tracked again");
  const ignored = readFileSync(root + ".gitignore", "utf8").split("\n").map((line) => line.trim());
  assert.ok(ignored.includes(".page-test.mjs"), ".page-test.mjs is not gitignored");
});
