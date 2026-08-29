# hooks/

Checklists the AI engineer runs at each stage of `/project-os`. These are **markdown
checklists** the AI reads and follows — not automated event hooks — so they work on any
project regardless of harness.

| Stage | File | When |
|-------|------|------|
| BeforeTask | `before-task.md` | Before any plan, analysis, or code |
| BeforeCommit | `before-commit.md` | Before committing |
| AfterTask | `after-task.md` | After the work, before closing |
| BeforeRelease | `before-release.md` | Before a release (hard to reverse) |
| AfterRelease | `after-release.md` | After a release |

Edit these to match the project's real commands and process.
