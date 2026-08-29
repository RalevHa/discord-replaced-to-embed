# 06 · Database

- Use a transaction when modifying multiple tables.
- Name tables and columns meaningfully.
- Write readable SQL with consistent formatting.
- Use indexes where appropriate.
- **Every schema change ships a re-runnable (idempotent) `.sql` migration script** in the project's SQL folder — the task is not done without it.
- Always specify columns — never `SELECT *`.
- Optimize an existing query before writing a new one.

## Project specifics

- **Database / driver:** No relational database. Persistence is Upstash Redis via its REST API
  (`@upstash/redis`), accessed only through `src/storage.js`'s `createStorage()` interface (sets
  and hashes: disabled guilds, roll-channel allowlists, fixer-host overrides, stats counters,
  admin passkeys). When Upstash env vars are absent, `storage.js` falls back to in-memory state
  that resets on restart — every new piece of state needs both code paths, mirrored the same way
  existing entries (`rollChannels`, `fixerOverrides`, `passkeys`) already are.
- **Migration folder:** None — Redis is schemaless (JSON blobs in hash fields), so the
  "idempotent migration script" rule above doesn't apply here. A shape change to a stored value
  just needs the malformed-entry guards on load (see `storage.js`'s `init()`) to tolerate old data.
- **Timezone / encoding gotchas:** None known; timestamps stored as ms epoch integers
  (e.g. `stats:since`).
