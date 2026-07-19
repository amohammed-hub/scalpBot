# Audit PDF Notes

Source: `/home/ubuntu/upload/Audit.pdf`

## Summary of instructions

- **Mission:** complete codebase audit with zero tolerance for missed bugs.
- **Rules:** no shortcuts; no premature closure; document first and fix second; verify every fix; no silent failures.
- **Phase 1 — Discovery:** list all files, read each end-to-end, document purpose, bugs with line numbers, code smells, missing error handling, and dependency issues; produce a **MASTER BUG LIST** table.
- **Stop after Phase 1** and show the user the bug list before any fixes.
- **Phase 2 — Fix:** only after user approval; fix in dependency order; state what is changing and why; show before/after; run the relevant test after each fix; confirm pass before the next fix; update bug status.
- **Phase 3 — Integration Verification:** run full test suite, linter/formatter, and build; if any fail, fix and rerun; produce a final report.
- **Phase 4 — Deployment:** deploy only after explicit user confirmation; verify deployment health post-deploy.
- **Status block required at end of every phase:** phase, files reviewed, bugs found, bugs fixed, tests passing, blockers, next action.
- **Done means:** every file read, every bug logged with file + line, every fix verified with a test, full suite passes, build succeeds, linter passes, final report produced, and deployment explicitly approved.

## Source pages

- Pages 1–2: mission, rules, execution phases 1–3
- Page 3: deployment rules and status block format
- Page 4: completion checklist and anti-patterns
