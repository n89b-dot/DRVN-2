# Evidence packets for production releases

A production deploy needs an evidence packet. The production job in `.github/workflows/deploy.yml` reads the folder `docs/release-evidence/candidates/<tag>/` from `main` and runs `node scripts/release-candidate.mjs promote` on it before it builds anything. A release tag with no folder here, or with a packet that fails the check, is not deployed.

Before 24 November 2026 the job checked the tag, the `release-gate` run, the migrations and the host's variables, and never asked for the 15 gates. A person approving the run was the only thing standing between a green CI run and production.

## What a folder holds

| File | What it is |
|---|---|
| `candidate.json` | The manifest `release-candidate.mjs build` wrote for the candidate commit, unedited |
| `reports.json` | One report per gate in `REQUIRED_GATES` (`docs/staging-setup.md` §13) |
| the evidence files | Each file a report names in `evidencePath`, beside `reports.json` or in a folder under it |

## What the deploy checks

1. The packet is for the tagged commit: `candidate.json`'s `sourceSha` is the commit the tag points at, and its migrations and lockfile digests match that commit's own files.
2. Every gate has exactly one report, it passed, and it carries the candidate's commit, build and migrations.
3. Every evidence file is there and its bytes match the digest in its report.
4. Every piece of evidence was gathered in the seven days before the tag was made, and none after it.

The check judges freshness as of the tag's own date, not the day of the deploy. Making the tag is the sign-off. The same tag can then be deployed again later (a rollback, runbook §7a, or a changed variable) without new evidence.

The check does not read the evidence. The owner, or a reviewer they name, reads every file, and approving the run in the `production` environment says they have.

The build digest in the packet is the staging candidate's. Production is built again with production's variables, so the two builds differ and the digest is not compared. What ties them together is the commit.

## The order to do it in

1. The candidate commit is on `main` and staging is serving it. Build the candidate and gather the evidence (`docs/staging-setup.md` §13), then run `release-candidate.mjs verify`.
2. Add the folder here by a pull request and merge it. The folder's name is the tag you are about to make.
3. Tag the candidate commit, not the commit that added the folder: `git tag -a rc-YYYYMMDD <candidate sha> -m "<what this release is>"`, then push the tag. Make the tag after the last piece of evidence and within seven days of the first.
4. Actions → Deploy → Run workflow, with the tag.

A staging soak longer than seven days would make the earliest evidence stale. Gather the quick gates (unit, typecheck, lint, sql, schema parity, build) again at the end of the soak; they take minutes.

## This folder is public

The repository is public, so everything in a packet is too. Put no secret, no personal data and no real customer's details in it. Stripe test-mode ids and CI run links are fine.

Evidence that cannot be public stays private. Commit a short text file in its place that says what the evidence is, where it is kept and its SHA-256, and have the report name that file.
