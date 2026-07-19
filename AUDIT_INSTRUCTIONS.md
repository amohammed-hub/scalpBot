# Full Codebase Audit — Zero Tolerance for Missed Bugs

## RULES (NON-NEGOTIABLE):
1. **NO SHORTCUTS.** Do not skip files. Do not skim. Do not assume anything works.
2. **NO PREMATURE CLOSURE.** You are NOT done until you explicitly confirm every checklist item below is green.
3. **DOCUMENT FIRST, FIX SECOND.** Before fixing anything, produce a full bug inventory with file paths, line numbers, and severity.
4. **VERIFY EVERY FIX.** After each fix, run the relevant test. If it fails, fix again. Do not move on with broken code.
5. **NO SILENT FAILURES.** If a test fails, a build breaks, or a command errors — report it, fix it, re-run. Never swallow errors.

## EXECUTION PHASES (Follow in strict order):

### PHASE 1: DISCOVERY (Do NOT fix anything yet)
- List ALL files in the project (tree/find command)
- Read each file end-to-end
- For each file, document:
  - File path
  - Purpose/role
  - Bugs found (with line numbers)
  - Code smells / logic errors / missing error handling
  - Dependency issues
- Produce a **MASTER BUG LIST** as a markdown table:
  | # | File | Line | Bug Description | Severity | Category |

**STOP HERE. Show me the bug list. Do NOT proceed to Phase 2 until I confirm.**

### PHASE 2: FIX (Only after Phase 1 is approved)
- Fix bugs in dependency order (utilities first, then modules that depend on them)
- For EACH fix:
  - State what you're changing and why
  - Show the before/after
  - Run the specific test for that module
  - Confirm PASS before moving to next fix
- Update the master bug list with status: ✅ Fixed | ❌ Still broken | ⚠️ Needs review

### PHASE 3: INTEGRATION VERIFICATION
- Run full test suite
- Run linter/formatter
- Run build command
- If ANY failure: go back and fix, then re-run ALL checks
- Produce final report:
  - Total bugs found
  - Total bugs fixed
  - Any remaining issues (with explanation why)
  - Test results (full pass/fail output)

### PHASE 4: DEPLOYMENT (Only after Phase 3 is fully green)
- Deploy only after explicit confirmation from me
- Verify deployment health post-deploy

## ACCOUNTABILITY CHECKPOINTS:
At the end of EVERY phase, output this status block:

📊 STATUS:
- Phase: [current]
- Files reviewed: X / Y total
- Bugs found: X
- Bugs fixed: X
- Tests passing: X / Y
- Blockers: [list or "none"]
- Next action: [what you'll do next]

## WHAT "DONE" LOOKS LIKE:
- ✅ Every file has been read (not skimmed)
- ✅ Every bug is logged with file + line number
- ✅ Every fix is verified with a test
- ✅ Full test suite passes
- ✅ Build succeeds
- ✅ Linter passes
- ✅ Final report is produced
- ✅ I have explicitly approved deployment

## ANTI-PATTERNS (Things you did last time — DO NOT repeat):
- ❌ Skipping files because they "look fine"
- ❌ Fixing 3 bugs and declaring "audit complete"
- ❌ Not running tests after fixes
- ❌ Ignoring failing tests
- ❌ Closing out without showing me the full bug list
- ❌ Saying "everything looks good" without evidence
