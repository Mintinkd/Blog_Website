# Issue tracker: GitHub

Issues and specs for this repo live as GitHub issues. Use the `gh` CLI for all operations.

> **Windows:** `pwsh` decodes native UTF-8 as CP936. Use `.\scripts\gh.ps1` in place of `gh` for every command, especially reads and anything carrying Chinese (or use the prelude in `docs/agents/windows-shell.md`); plain `gh` may render output incorrectly and `--json | ConvertFrom-Json` can fail. Other platforms use `gh` directly.

## Conventions

- **Create an issue**: `gh issue create --title "..." --body "..."`. Use a heredoc for multi-line bodies.
- **Read an issue**: `.\scripts\gh.ps1 issue view <number>` for reading. Machine-readable: `.\scripts\gh.ps1 issue view <number> --json number,title,body,labels,comments`.
- **List issues**: `.\scripts\gh.ps1 issue list --state open` for reading. Machine-readable: `.\scripts\gh.ps1 issue list --state open --json number,title,body,labels,comments --jq '[.[] | {number, title, body, labels: [.labels[].name], comments: [.comments[].body]}]'` with appropriate `--label` and `--state` filters.
- **Make an issue a sub-issue of a parent**: `gh issue create --parent <parent> ...`, or `gh issue edit <parent> --add-sub-issue <child>` afterwards (`gh` 2.94+). Older `gh`: `gh api --method POST repos/<owner>/<repo>/issues/<parent>/sub_issues -F sub_issue_id=<child-db-id>` (database id, as in **Blocking** below). Without sub-issues, put `Part of #<parent>` at the top of the child body.
- **List sub-issues**: `.\scripts\gh.ps1 api --paginate "repos/<owner>/<repo>/issues/<parent>/sub_issues" --jq '.[] | {number, title, state}'`.
- **Comment on an issue**: `gh issue comment <number> --body "..."`
- **Apply / remove labels**: `gh issue edit <number> --add-label "..."` / `--remove-label "..."`
- **Close**: `gh issue close <number> --reason completed`。关票证据长文先发（`gh issue comment <number> --body-file <path>`，close 只收内联 `--comment`）再 `gh issue close`；留言格式：实施完成（提交哈希 + `docs/reviews/` 报告路径）→ 验收对照逐条 → out-of-scope 如实保留。关票不改标签。

Infer the repo from `git remote -v`; `gh` does this automatically when run inside a clone.

## Cross-ticket obligations

When a ticket defers an obligation to a later ticket (security review, migration, cleanup, follow-up verification), put it in the receiving ticket's body or acceptance criteria and link the source ticket. A source comment is not a handoff channel: the receiving agent may read the code without reading the comment's history.

Format: `Deferred from #<n>: <obligation> — must be addressed before <milestone>.`

## Closing a parent issue

1. List sub-issues (`.\scripts\gh.ps1 api --paginate "repos/<owner>/<repo>/issues/<parent>/sub_issues" --jq '.[] | {number, title, state}'`) and confirm every child is closed.
2. Re-read the parent acceptance criteria and map each item to a child ticket or an explicit disposition.
3. Post the summary comment with child links, commits, and gate results, then `gh issue close <parent> --reason completed`.

## Pull requests as a triage surface

**PRs as a request surface: no.** _(Set to `yes` if this repo treats external PRs as feature requests; `/triage` reads this flag.)_

When set to `yes`, PRs run through the same labels and states as issues, using the `gh pr` equivalents:

- **Read a PR**: `gh pr view <number> --comments` and `gh pr diff <number>` for the diff.
- **List external PRs for triage**: `gh api --paginate 'repos/{owner}/{repo}/pulls?state=open' --jq '.[] | select(.author_association | IN("OWNER","MEMBER","COLLABORATOR") | not) | {number, title, author: .user.login, author_association, labels: [.labels[].name]}'`.
- **Comment / label / close**: `gh pr comment`, `gh pr edit --add-label`/`--remove-label`, `gh pr close`.

GitHub shares one number space across issues and PRs, so a bare `#42` may be either: resolve with `gh pr view 42` and fall back to `gh issue view 42`.

## When a skill says "publish to the issue tracker"

Create a GitHub issue.

## When a skill says "fetch the relevant ticket"

Read it as in **Read an issue** above.

## Wayfinding operations

Used by `/wayfinder`. The **map** is a single issue with **child** issues as tickets.

- **Map**: a single issue labelled `wayfinder:map`, holding the Notes / Decisions-so-far / Fog body. `gh issue create --label wayfinder:map`.
- **Child ticket**: an issue linked to the map as a GitHub sub-issue (see **Make an issue a sub-issue of a parent**). Where sub-issues aren't enabled, add the child to a task list in the map body and put `Part of #<map>` at the top of the child body. Labels: `wayfinder:<type>` (`research`/`prototype`/`grilling`/`task`). Once claimed, the ticket is assigned to the driving dev.
- **Blocking**: GitHub's **native issue dependencies**, the canonical, UI-visible representation. Add an edge with `gh api --method POST repos/<owner>/<repo>/issues/<child>/dependencies/blocked_by -F issue_id=<blocker-db-id>`, where `<blocker-db-id>` is the blocker's numeric **database id** (`gh api repos/<owner>/<repo>/issues/<n> --jq .id`, _not_ the `#number` or `node_id`). GitHub reports `issue_dependencies_summary.blocked_by` (open blockers only, the live gate). Where dependencies aren't available, fall back to a `Blocked by: #<n>, #<n>` line at the top of the child body. A ticket is unblocked when every blocker is closed.
- **Frontier query**: list the map's open children (`gh issue list --state open`, scoped to the map's sub-issues / task list), drop any with an open blocker (`issue_dependencies_summary.blocked_by > 0`, or an open issue in the `Blocked by` line) or an assignee; first in map order wins.
- **Claim**: `gh issue edit <n> --add-assignee @me`, the session's first write.
- **Resolve**: `gh issue comment <n> --body "<answer>"`, then `gh issue close <n>`, then append a context pointer (gist + link) to the map's Decisions-so-far.
