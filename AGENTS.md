## Agent skills

### Issue tracker

GitHub issues (`Mintinkd/Blog_Website`), operated via the `gh` CLI. See `docs/agents/issue-tracker.md`.

### Triage labels

The five canonical triage roles use their default label strings. See `docs/agents/triage-labels.md`.

### Domain docs

Single-context: one `GLOSSARY.md` and `docs/adr/` at the repo root. See `docs/agents/domain.md`.

### Worker tests

vitest in `worker/tests/`; shared-pipeline seams first, handler seams on request. See `docs/agents/testing.md`.

## Shell environment

Windows `pwsh` runs `-NoProfile` with CP936; UTF-8 native output (`gh`, Chinese docs) needs an explicit prelude, and `rg` is unavailable. See `docs/agents/windows-shell.md`.

## CI/CD

GitHub Actions at `.github/workflows/` — `deploy.yml` gates then deploys (floor: settings-rules / security-headers drift checks). Dotted directories (`.github`, `.agents`) are hidden from the glob tool; list them with the shell, not glob.

## Repo docs

- `README.md` — main contract (API surface, structure, behaviour, deployment); the source of truth for implementation and review.
- `CODING_STANDARDS.md` — judgement-call coding rules enforced by the `code-review` Standards axis.
- `docs/reviews/YYYY-MM-DD-<topic>.md` — code-review reports.
