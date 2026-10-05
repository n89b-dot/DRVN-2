import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import { describePlan, parseArgs, planAccounts } from "./stripe-negative-balances.mjs";

const account = (id, value) => ({ id, settings: { payouts: value === undefined ? {} : { debit_negative_balances: value } } });

test("plans an update only for accounts with the setting off", () => {
  const plan = planAccounts([account("acct_on", true), account("acct_off", false), account("acct_unknown", undefined)]);
  assert.deepEqual(plan, { update: ["acct_off"], unknown: ["acct_unknown"], alreadyOn: 1 });
});

test("describes a dry run and an empty plan", () => {
  assert.match(describePlan({ update: ["acct_off"], unknown: [], alreadyOn: 2 }, { apply: false }), /Would turn on debit_negative_balances for 1:\n  acct_off/);
  assert.match(describePlan({ update: [], unknown: [], alreadyOn: 3 }, { apply: true }), /Nothing to change\./);
});

test("takes no key or unknown argument on the command line", () => {
  assert.deepEqual(parseArgs(["--apply", "--live"]), { apply: true, live: true, help: false });
  assert.throws(() => parseArgs(["sk_test_123"]), /Unknown argument/);
});

test("new connected accounts are created with the setting on", () => {
  const connect = readFileSync("src/lib/payments/connect.ts", "utf8");
  assert.match(connect, /settings: \{ payouts: \{ debit_negative_balances: true \} \}/);
});
