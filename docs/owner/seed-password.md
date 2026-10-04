# Rotating the seed-account password

The dev seed scripts (`.seed-community.mjs`, `.seed-stories.mjs`,
`.seed-supercars.mjs`) sign in as ten shared test accounts
(`kaito@drvn.test`, `marisol@drvn.test`, `tommy@drvn.test`, `lena@`,
`marcus@`, `jade@`, `ryo@`, `dario@`, `imani@`, `felix@drvn.test`). They now
read the password from `DRVN_SEED_PASSWORD`, but the old hard-coded password
is still in git history. Anyone with a copy of the repo can sign in to those
accounts on the shared dev project until the password changes.

These are test accounts on the dev project, not real members. The risk is
someone posting or messaging as them on dev, or using them to poke at dev
data. It is not a production risk, but it should be closed before the repo is
shared more widely (for example, made public for branch protection).

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
