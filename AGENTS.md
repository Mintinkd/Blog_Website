## Agent skills

### Issue tracker

GitHub issues (`Mintinkd/Blog_Website`), operated via the `gh` CLI. See `docs/agents/issue-tracker.md`.

### Triage labels

The five canonical triage roles use their default label strings. See `docs/agents/triage-labels.md`.

### Domain docs

Single-context: one `GLOSSARY.md` and `docs/adr/` at the repo root. See `docs/agents/domain.md`.

### Worker tests

vitest in `worker/tests/`; shared-pipeline seams first, handler seams on request. See `docs/agents/testing.md`.

## Repo docs

- `README.md` — main contract (API surface, structure, behaviour, deployment); the source of truth for implementation and review.
- `docs/reviews/YYYY-MM-DD-<topic>.md` — code-review reports.
