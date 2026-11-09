# Rotating the seed-account password

The dev seed scripts (`.seed-community.mjs`, `.seed-stories.mjs`,
`.seed-supercars.mjs`) sign in as ten shared test accounts
(`kaito@drvn.test`, `marisol@drvn.test`, `tommy@drvn.test`, `lena@`,
`marcus@`, `jade@`, `ryo@`, `dario@`, `imani@`, `felix@drvn.test`). They read
the password from `DRVN_SEED_PASSWORD`, which lives only in `.env.local` and
the password manager, never in the repository.

**Rotated on 7 November 2026** on the shared dev project, together with the
console-admin and viz-check passwords (R-password; `README.md` in this folder
records it). The password that was once hard-coded is still in git history,
and that is harmless: it opens nothing since the rotation, and rewriting
history would disrupt every clone. What remains for the owner is to say so in
the Intelligence OS, which closes the item on the owner's word, not on this
page.

These are test accounts on the dev project, not real members. Rotate again
whenever the value may have leaked (a shared screen, a pasted `.env.local`),
and before any new project is seeded. The browser suite's own throwaway
accounts (`e2e-*@drvn.test`) take a random password per account from
`e2e/helpers.ts` and need no rotation.

Script: `scripts/owner/rotate-seed-password.mjs`. Who: owner, or an engineer
with the dev project's secret key. About 5 minutes.

## Steps

1. Generate a new password and store it in the password manager entry for
   DRVN dev:
   ```bash
   openssl rand -base64 24
   ```
2. In the repo root, put it in `.env.local` (which is not committed) as
   `DRVN_SEED_PASSWORD=…`, or export it in the shell for this session only.
3. Dry run. It reads `.env.local`, checks it points at the dev project
   `grunnjojhdevhuckujmc`, and lists which seed accounts exist. It changes
   nothing:
   ```bash
   node scripts/owner/rotate-seed-password.mjs
   ```
4. Apply:
   ```bash
   node scripts/owner/rotate-seed-password.mjs --apply
   ```
   It prints each address as `updated` or `FAILED`. It never prints the
   password or the key.
5. Check one account: sign in on dev as `kaito@drvn.test` with the new
   password. The old one must fail.
6. Tell anyone who runs the seed scripts to update their own `.env.local`
   from the password manager.

## Safety rails

- Refuses any project other than `grunnjojhdevhuckujmc` unless you pass
  `--project <ref>`, and that ref must match what `.env.local` points at. A
  local stack counts as `--project local`.
- Dry run unless `--apply`.
- Refuses a password shorter than 16 characters.
- Looks accounts up through `account_emails` (service-role only), so it
  touches only those ten addresses.

Existing sessions on those accounts are not signed out by a password change.
Refresh tokens keep working until they expire or are revoked. If you think
someone is actively using one, ban that user for a while in the Supabase
dashboard (Authentication → Users → the user), which ends its sessions.

Rewriting git history to remove the old value is not needed once the password
is changed, and would disrupt every clone.
