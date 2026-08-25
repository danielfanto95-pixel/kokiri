# Change Requests — structural work for headless Claude Code runs

This folder is how Daniel hands off **structural** Kokiri changes (new tables, RLS
policies, multi-file batch edits, new portals/sections) to an unattended, CI-run
Claude Code process — distinct from the routine/recurring tasks tracked in the
"Claude Code Tasks" portal (`portals.html#claude-tasks`), which are lower-stakes
and don't need this level of ceremony.

## Why a file instead of just a database row

A headless run triggered from GitHub Actions doesn't necessarily have the Supabase
MCP server configured the way an interactive session does. A markdown file in the
repo is something `claude -p` can read directly with zero extra wiring — the request
travels with the code, not in a separate system the CI runner has to be taught to query.

## The process

1. **Write a change request.** Copy `TEMPLATE.md` to a new file named
   `CR-YYYY-MM-DD-short-slug.md` in this folder. Fill in every section — the more
   precisely scoped, the better the unattended result. Commit it to a branch or
   directly to `master` (the file existing doesn't trigger anything by itself).
2. **Fire it off.** Go to the `change-request.yml` workflow in GitHub Actions →
   "Run workflow" → enter the CR's filename. Nothing runs automatically just because
   a CR file exists — this manual trigger is the actual approval gate.
3. **It always opens a PR, never pushes to master directly.** The workflow creates a
   branch, does the work, and opens a pull request for review. You read the diff,
   you merge or don't.
4. **It must self-verify before marking the PR ready.** Any change to a `.html` page
   gets syntax-checked; if the CR touches a live deploy target, the workflow loads
   the actual live page with Playwright and checks for console errors before
   considering the task done — the same discipline used in interactive sessions,
   because static review alone has missed real bugs before (a stray closing `</div>`
   and a missing `id` attribute both slipped past code review and were only caught
   by actually loading the page).
5. **Database migrations are never auto-applied.** If a CR requires a Supabase
   migration, the SQL goes into the PR as a reviewable file — the workflow does not
   call `apply_migration` against the live project. Daniel applies it manually after
   reading it, the same way any other schema change would be reviewed.

## Standing guardrails (apply to every CR, not just what's written in it)

- PR only. Never `git push` directly to `master`.
- Never touch `auth.users` or any RLS policy in a way that could expose data neither
  the owner nor an explicitly-permissioned user should see.
- Never fabricate content, data, or verification results — if something can't be
  confirmed, say so in the PR description rather than claiming it works.
- If the CR is ambiguous or under-specified, stop and note the ambiguity in the PR
  description rather than guessing on a structural decision.
