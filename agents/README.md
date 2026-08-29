# agents/

The `/project-os` command selects a specialist agent automatically by the nature of the work.
These are the roles and when each applies. Add project-specific notes under any role.

| Agent | Use for |
|-------|---------|
| `architect` | System design, module boundaries, breaking multi-layer work into tasks, trade-offs |
| `backend-developer` | Server / API / business logic |
| `frontend-developer` | UI / client code |
| `database-engineer` | Schema, queries, migrations (every DB change ships a migration) |
| `debugger` | Reproduce & fix defects at the root cause |
| `documentation` | README / API / database / architecture docs |
| `tester` | Verify end-to-end, review the diff, hunt edge cases — the last gate before commit |
| `security-engineer` | Auth, secret handling, injection, vulnerabilities |
| `performance-engineer` | Profile & optimize (measure before and after) |

Agents may collaborate. Complex work usually flows `architect` → specialists → `tester`.

## Project-specific notes

- `backend-developer` owns everything under `src/` (bot logic, Discord events/commands, the
  admin API in `src/adminApi.js`) — this is a Node.js/Express/discord.js project, not a typed
  backend framework.
- `frontend-developer` owns `admin-panel/src/` (React + Vite admin panel only — there is no
  other frontend; the Discord side has no UI beyond slash commands/embeds).
- `database-engineer` here means Redis/`storage.js` changes, not SQL — there's no relational
  database or migration folder (see `rules/06-database.md`'s Project specifics).
- `documentation` maintains `README.md` (the only user-facing doc) plus this `project_rules.md`/
  `skills/` structure.
