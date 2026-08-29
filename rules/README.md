# rules/

Cross-cutting rules the AI engineer must load at task startup (Step 1 of `/project-os`).
Organized in six categories:

| # | File | Covers |
|---|------|--------|
| 01 | `01-general.md` | Production-ready code, ask-before-coding, explain-first, reuse |
| 02 | `02-code-quality.md` | Readability, SRP, DRY, naming, no dead code, SOLID/KISS |
| 03 | `03-error-handling.md` | try/catch, no silent errors, user-friendly messages, logging with context |
| 04 | `04-security.md` | SQL injection, input validation, no hardcoded secrets, parameterized queries, authorization |
| 05 | `05-performance.md` | Right algorithm, avoid N+1, avoid needless loops, async, measure first |
| 06 | `06-database.md` | Transactions, naming, readable SQL, indexes, idempotent migrations, no `SELECT *` |

Add more rule files as the project needs them (e.g. `api.md`, `ui.md`, `testing.md`).
Keep each rule in exactly one place — link, do not duplicate.
