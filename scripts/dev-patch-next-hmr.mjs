#!/usr/bin/env node
// Stops the dev-server reload loop ("every page flashes and is slow").
//
// Next 16.4.x Turbopack regression, vercel/next.js issue #100251: when the dev
// server restarts while a tab is open, the first hot-reload message for the
// page's main chunk list can be a `restart`. The hot reloader forwards it, the
// tab reloads, subscribes again, gets `restart` again, and reloads about five
// times a second for as long as any tab is open. Every reload renders the page
// on the server and reads the database, so the shared dev database's
// connections fill up and every other page times out with it.
//
// The fix is upstream pull request #100291, one line: on a new subscription,
// forward only a `partial` update, never a `restart`. It is not merged and no
// 16.4.x release carries it (checked 12 Nov 2026, latest 16.4.6), so the dev
// start script (scripts/dev-server.sh) applies it to the installed copy before
// every start. That way it survives `npm install`.
//
// Development only: this file is the dev hot reloader, never part of a build.
// It changes nothing when the buggy line is absent, so once Next ships the fix
// this prints "already fixed" and the script and its call can be deleted.

import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const BUGGY = "if (!initial.done && initial.value.value.type !== 'issues') {";
const FIXED = "if (!initial.done && initial.value.value.type === 'partial') {";
const FILES = [
  "node_modules/next/dist/server/dev/hot-reloader-turbopack.js",
  "node_modules/next/dist/esm/server/dev/hot-reloader-turbopack.js",
];

let version = "unknown";
try {
  version = JSON.parse(readFileSync(join(root, "node_modules/next/package.json"), "utf8")).version;
} catch {
  // Not installed yet: nothing to patch, and `next dev` will say so itself.
}

for (const file of FILES) {
  const path = join(root, file);
  let source;
  try {
    source = readFileSync(path, "utf8");
  } catch {
    console.log(`[dev-patch] next ${version}: ${file} not found, skipped`);
    continue;
  }
  if (source.includes(FIXED)) {
    console.log(`[dev-patch] next ${version}: ${file} already fixed`);
  } else if (source.split(BUGGY).length === 2) {
    writeFileSync(path, source.replace(BUGGY, FIXED));
    console.log(`[dev-patch] next ${version}: ${file} patched (reload loop, next.js #100251)`);
  } else {
    // Next changed this code. Leave it alone and say so: if tabs start
    // reloading in a loop again, this is the first place to look.
    console.log(`[dev-patch] next ${version}: ${file} no longer matches, left untouched`);
  }
}
