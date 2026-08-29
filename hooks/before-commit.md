# BeforeCommit checklist

- [ ] Direct commits to `main` are the established convention here (solo repo, no PR
      workflow) — no branch needed unless the user asks for one.
- [ ] `git diff` reviewed — no secrets, tokens, keys, or connection strings.
- [ ] No debug leftovers, dead code, or `SELECT *`.
- [ ] Tests / lint pass (or the reason they were skipped is stated).
- [ ] N/A here — no relational DB (see `rules/06-database.md`); Redis-shape changes just need
      the malformed-entry load guards, not a migration script.
- [ ] Docs updated for any changed contract/flow/schema.
- [ ] Commit message is a plain imperative subject line (`Add X`, `Fix X`) matching this
      repo's actual `git log` style — **not** Conventional Commits type prefixes.
