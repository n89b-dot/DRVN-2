# DRVN progress tracker

Run `node scripts/serve-readiness-progress.mjs` from the repository, then open
[the local tracker](http://127.0.0.1:4317). It checks for updated checkpoint data
every five seconds. The server binds only to this computer and serves only the
tracker and its progress data.

`progress.json` is the source of truth. Update checkpoint states only after work
or verification occurs, with evidence for each completed checkpoint. Update the
timestamp, current work, next step, and activity log together. Completed checkpoints
are counted equally; percentages measure checklist completion, not effort, time,
or a production-readiness score. External acceptance remains incomplete until
its evidence exists.

Run `node scripts/readiness-progress.mjs` after an update to regenerate `index.html`.
That file also opens directly as a portable snapshot. It clearly labels snapshot
mode; it cannot refresh from the repository when opened without the local server.
The served view stays current as the source data changes. This is agent-maintained
progress, not automatic inference from agent activity or passing test counts.

Design source: Distill in `n89b-dot/YT-Digest-2`, commit
`37feb29a22a62f2b5abe4f39af7b547b4b2bd219`, `apps/web/styles/design.css` and
`apps/web/index.html`, read from GitHub on 2026-09-05. Uses its canvas `#f5f2e9`,
ink `#09090b`, accent `#dc2626`, 16px white cards, Fraunces display type, Inter body
type, and pill controls. Fonts have local serif/sans fallbacks when offline.

Keep this artifact separate from the production app. Do not place secrets,
customer information, tokens, sensitive traces, or private provider payloads in
the progress data. Source and evidence links should remain sanitized.
